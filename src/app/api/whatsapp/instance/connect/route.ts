import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  loadInstance,
  resolveInstanceAccountId,
  toUazapiConfig,
  updateInstanceStatus,
} from "@/lib/whatsapp/instance-context";
import { connectInstance } from "@/lib/whatsapp/uazapi-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

// POST /api/whatsapp/instance/connect
//
// Starts (or refreshes) the QR-code pairing flow for a client's
// WhatsApp instance. Two callers:
//   - A client admin connecting their own account's WhatsApp
//     (no `accountId` in the body).
//   - The platform owner, in /admin, connecting a specific client's
//     WhatsApp on their behalf (`accountId` in the body).
// Permission for both is enforced by `resolveInstanceAccountId`.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(
      `whatsapp:instanceConnect:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as {
      accountId?: string;
    };

    const accountId = await resolveInstanceAccountId(ctx, body.accountId);
    const instance = await loadInstance(ctx, accountId);

    if (!instance || !instance.uazapiUrl || !instance.token) {
      return NextResponse.json(
        { error: "Este cliente ainda não tem uma instância do WhatsApp provisionada" },
        { status: 404 },
      );
    }

    const result = await connectInstance(toUazapiConfig(instance));
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { error: result.error || "Falha ao gerar o QR code" },
        { status: 502 },
      );
    }

    await updateInstanceStatus(ctx, instance.id, {
      status: "qrcode",
      qrCodeBase64: result.data.qrCodeBase64 ?? null,
    });

    return NextResponse.json({
      qrCodeBase64: result.data.qrCodeBase64 ?? null,
      pairingCode: result.data.pairingCode ?? null,
      status: "qrcode",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
