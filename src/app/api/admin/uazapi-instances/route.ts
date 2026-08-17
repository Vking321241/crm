// ============================================================
// GET /api/admin/uazapi-instances — platform-owner only. Lists every
// instance that exists under the configured UAZAPI server/admin
// token, so the admin can browse what's already provisioned in
// UAZAPI itself before assigning one to a client. Instance tokens
// are deliberately left out of the response — the assign route
// (POST /api/admin/clients/[accountId]/instance) re-resolves the
// token server-side by name, so it never touches the browser.
// ============================================================

import { NextResponse } from "next/server";

import { requirePlatformOwner, toErrorResponse } from "@/lib/auth/account";
import { loadPlatformUazapiConfig } from "@/lib/whatsapp/platform-config";
import { listInstances } from "@/lib/whatsapp/uazapi-client";

export async function GET() {
  try {
    const ctx = await requirePlatformOwner();

    const admin = await loadPlatformUazapiConfig(ctx.db);
    if (!admin) {
      return NextResponse.json(
        { error: "Configure a URL e o admin token da UAZAPI antes." },
        { status: 409 },
      );
    }

    const result = await listInstances(admin);
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { error: result.error || "Falha ao listar instâncias na UAZAPI" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      instances: result.data.map((i) => ({
        name: i.name,
        status: i.status,
        phone_number: i.phoneNumber ?? null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
