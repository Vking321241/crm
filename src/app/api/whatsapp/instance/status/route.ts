import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  loadInstance,
  resolveInstanceAccountId,
  toUazapiConfig,
  updateInstanceStatus,
} from "@/lib/whatsapp/instance-context";
import { configureWebhook, getInstanceStatus } from "@/lib/whatsapp/uazapi-client";

// The webhook URL is per-instance (`/webhook/<instanceId>`), not a
// single shared endpoint — that's what lets the receiving route
// identify which client's data to write to without having to parse
// an instance identifier out of UAZAPI's payload (whose field names
// aren't guaranteed stable across versions/installs; the URL path
// is under our control instead).
function webhookUrl(request: Request, instanceId: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const origin = base || new URL(request.url).origin;
  return `${origin}/api/whatsapp/uazapi/webhook/${instanceId}`;
}

// GET /api/whatsapp/instance/status?accountId=<uuid>
//
// Polled by the QR-code card every few seconds while a connection
// is in progress. On the transition into "connected" it also wires
// up the instance's webhook, so inbound messages start flowing the
// moment the phone finishes pairing without a separate manual step.
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const accountId = await resolveInstanceAccountId(
      ctx,
      searchParams.get("accountId"),
    );

    const instance = await loadInstance(ctx, accountId);
    if (!instance) {
      return NextResponse.json({ status: "not_created" });
    }
    if (!instance.uazapiUrl || !instance.token) {
      return NextResponse.json({ status: instance.status });
    }

    const result = await getInstanceStatus(toUazapiConfig(instance));
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { error: result.error || "Falha ao consultar o status da instância" },
        { status: 502 },
      );
    }

    const wasConnected = instance.status === "connected";
    const nowConnected = result.data.status === "connected";

    await updateInstanceStatus(ctx, instance.id, {
      status: result.data.status,
      phoneNumber: result.data.phoneNumber ?? null,
      connectedAt: nowConnected && !wasConnected ? new Date().toISOString() : undefined,
      qrCodeBase64: nowConnected ? null : undefined,
    });

    if (nowConnected && !wasConnected) {
      const webhookResult = await configureWebhook(
        toUazapiConfig(instance),
        webhookUrl(request, instance.id),
      );
      if (!webhookResult.ok) {
        console.error(
          "[GET /api/whatsapp/instance/status] webhook config failed:",
          webhookResult.error,
        );
      }
    }

    return NextResponse.json({
      status: result.data.status,
      phoneNumber: result.data.phoneNumber ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
