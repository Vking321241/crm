// ============================================================
// POST /api/admin/clients/[accountId]/instance — platform-owner
// only. Assigns a WhatsApp instance to a client and immediately
// configures its webhook, instead of waiting for the connect/poll
// cycle (src/app/api/whatsapp/instance/status) to do it on first
// connect.
//
// Two ways to pick the instance:
//   - { mode: "pick", instanceName }  — re-resolves the real token
//     server-side from listInstances() by name, so the token itself
//     never has to round-trip through the browser.
//   - { mode: "manual", token, name?, baseUrl? } — paste a token you
//     already have (e.g. from the UAZAPI dashboard directly).
//     baseUrl defaults to the platform's configured UAZAPI server.
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requirePlatformOwner, toErrorResponse } from "@/lib/auth/account";
import { accounts, whatsappInstances } from "@/db/schema";
import { loadPlatformUazapiConfig } from "@/lib/whatsapp/platform-config";
import { encrypt } from "@/lib/whatsapp/encryption";
import { configureWebhook, getInstanceStatus, listInstances } from "@/lib/whatsapp/uazapi-client";

function webhookUrl(request: Request, instanceId: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const origin = base || new URL(request.url).origin;
  return `${origin}/api/whatsapp/uazapi/webhook/${instanceId}`;
}

interface AssignBody {
  mode?: unknown;
  instanceName?: unknown;
  token?: unknown;
  name?: unknown;
  baseUrl?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformOwner();
    const { accountId } = await params;

    const [client] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (!client) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as AssignBody | null;
    const admin = await loadPlatformUazapiConfig(ctx.db);

    let resolvedToken: string;
    let resolvedName: string;
    let resolvedBaseUrl: string;

    if (body?.mode === "manual") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!token) {
        return NextResponse.json({ error: "Informe o token da instância" }, { status: 400 });
      }
      resolvedToken = token;
      resolvedName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "manual";
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      resolvedBaseUrl = baseUrl || admin?.baseUrl || "";
      if (!resolvedBaseUrl) {
        return NextResponse.json(
          { error: "Informe a URL do servidor UAZAPI (ou configure a padrão em Configurações)" },
          { status: 400 },
        );
      }
    } else {
      const instanceName = typeof body?.instanceName === "string" ? body.instanceName.trim() : "";
      if (!instanceName) {
        return NextResponse.json({ error: "Informe qual instância usar" }, { status: 400 });
      }
      if (!admin) {
        return NextResponse.json(
          { error: "Configure a URL e o admin token da UAZAPI antes." },
          { status: 409 },
        );
      }
      const list = await listInstances(admin);
      if (!list.ok || !list.data) {
        return NextResponse.json(
          { error: list.error || "Falha ao consultar a UAZAPI" },
          { status: 502 },
        );
      }
      const match = list.data.find((i) => i.name === instanceName);
      if (!match) {
        return NextResponse.json(
          { error: "Instância não encontrada na UAZAPI (pode ter sido removida)" },
          { status: 404 },
        );
      }
      resolvedToken = match.token;
      resolvedName = match.name;
      resolvedBaseUrl = admin.baseUrl;
    }

    // Confirm the token actually works and grab the live status before
    // writing anything — an assignment that silently points at a dead
    // instance would be worse than the previous "not_created" state.
    const statusResult = await getInstanceStatus({ baseUrl: resolvedBaseUrl, token: resolvedToken });
    if (!statusResult.ok) {
      return NextResponse.json(
        { error: `Não foi possível validar a instância: ${statusResult.error}` },
        { status: 502 },
      );
    }

    const [existing] = await ctx.db
      .select({ id: whatsappInstances.id })
      .from(whatsappInstances)
      .where(eq(whatsappInstances.accountId, accountId))
      .limit(1);

    const encryptedToken = encrypt(resolvedToken);
    let instanceId: string;

    if (existing) {
      await ctx.db
        .update(whatsappInstances)
        .set({
          instanceName: resolvedName,
          uazapiUrl: resolvedBaseUrl,
          uazapiToken: encryptedToken,
          status: statusResult.data!.status,
          phoneNumber: statusResult.data!.phoneNumber ?? null,
          connectedAt: statusResult.data!.status === "connected" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(whatsappInstances.id, existing.id));
      instanceId = existing.id;
    } else {
      const [created] = await ctx.db
        .insert(whatsappInstances)
        .values({
          accountId,
          instanceName: resolvedName,
          uazapiUrl: resolvedBaseUrl,
          uazapiToken: encryptedToken,
          status: statusResult.data!.status,
          phoneNumber: statusResult.data!.phoneNumber ?? null,
          connectedAt: statusResult.data!.status === "connected" ? new Date() : null,
          createdBy: ctx.userId,
        })
        .returning({ id: whatsappInstances.id });
      instanceId = created.id;
    }

    // Point the webhook at this deployment right away — the whole
    // point of this flow is not waiting on the connect/poll cycle.
    const webhookResult = await configureWebhook(
      { baseUrl: resolvedBaseUrl, token: resolvedToken },
      webhookUrl(request, instanceId),
    );

    return NextResponse.json({
      ok: true,
      status: statusResult.data!.status,
      webhookConfigured: webhookResult.ok,
      ...(webhookResult.ok ? {} : { webhookWarning: webhookResult.error }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
