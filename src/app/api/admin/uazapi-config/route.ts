// ============================================================
// GET /api/admin/uazapi-config — platform-owner only. Returns the
//     configured UAZAPI server URL and whether an admin token is
//     set (never the token itself — write-only, like every other
//     secret in this app).
// PUT /api/admin/uazapi-config — platform-owner only. Body:
//     { serverUrl, adminToken? }. adminToken is optional on update —
//     omit it to keep the currently-stored one and only change the
//     URL.
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requirePlatformOwner, toErrorResponse } from "@/lib/auth/account";
import { accounts } from "@/db/schema";
import { savePlatformUazapiConfig } from "@/lib/whatsapp/platform-config";

export async function GET() {
  try {
    const ctx = await requirePlatformOwner();

    const [platform] = await ctx.db
      .select({
        uazapiServerUrl: accounts.uazapiServerUrl,
        uazapiAdminToken: accounts.uazapiAdminToken,
      })
      .from(accounts)
      .where(eq(accounts.isPlatform, true))
      .limit(1);

    return NextResponse.json({
      serverUrl: platform?.uazapiServerUrl || process.env.UAZAPI_SERVER_URL || "",
      hasAdminToken: !!(platform?.uazapiAdminToken || process.env.UAZAPI_ADMIN_TOKEN),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requirePlatformOwner();

    const body = (await request.json().catch(() => null)) as
      | { serverUrl?: unknown; adminToken?: unknown }
      | null;

    const serverUrl = typeof body?.serverUrl === "string" ? body.serverUrl.trim() : "";
    if (!serverUrl) {
      return NextResponse.json({ error: "Informe a URL do servidor UAZAPI" }, { status: 400 });
    }

    const adminToken = typeof body?.adminToken === "string" ? body.adminToken.trim() : undefined;

    await savePlatformUazapiConfig(ctx.db, { serverUrl, adminToken: adminToken || undefined });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
