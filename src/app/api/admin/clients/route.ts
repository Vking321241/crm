import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requirePlatformOwner, toErrorResponse } from "@/lib/auth/account";
import { accounts, authTokens, users, whatsappInstances } from "@/db/schema";
import { generateRawToken } from "@/lib/auth/session";
import { createInstance } from "@/lib/whatsapp/uazapi-client";
import { encrypt } from "@/lib/whatsapp/encryption";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const SET_PASSWORD_TOKEN_TTL_DAYS = 7;

function baseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

// POST /api/admin/clients
//
// The single entry point for "create a new client" — only the
// platform owner can ever call this (requirePlatformOwner below).
// Fatia 2: no more Supabase Admin API / RPC dance — the account and
// the user row are created together, in the right place, in one
// transaction. There's no "orphan personal account" to clean up
// because nothing auto-creates a user the way Supabase's signup
// trigger used to; a user only ever exists already attached to the
// right account.
export async function POST(request: Request) {
  try {
    const ctx = await requirePlatformOwner();

    const limit = checkRateLimit(
      `platform:createClient:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      clientName?: string;
      adminEmail?: string;
      adminName?: string;
      maxAgentSeats?: number;
    } | null;

    const clientName = body?.clientName?.trim();
    const adminEmail = body?.adminEmail?.trim().toLowerCase();
    const adminName = body?.adminName?.trim() || clientName;
    const maxAgentSeats =
      typeof body?.maxAgentSeats === "number" && body.maxAgentSeats >= 1
        ? Math.floor(body.maxAgentSeats)
        : 1;

    if (!clientName || !adminEmail || !adminName) {
      return NextResponse.json(
        { error: "Informe o nome do cliente e o e-mail do administrador" },
        { status: 400 },
      );
    }

    const { token, hash } = generateRawToken();

    let newAccountId: string;
    try {
      newAccountId = await ctx.db.transaction(async (tx) => {
        const [account] = await tx
          .insert(accounts)
          .values({ name: clientName, isPlatform: false, maxAgentSeats })
          .returning({ id: accounts.id });

        const [user] = await tx
          .insert(users)
          .values({
            email: adminEmail,
            fullName: adminName,
            accountId: account.id,
            accountRole: "owner",
          })
          .returning({ id: users.id });

        await tx
          .update(accounts)
          .set({ ownerUserId: user.id })
          .where(eq(accounts.id, account.id));

        await tx.insert(authTokens).values({
          purpose: "set_password",
          tokenHash: hash,
          targetUserId: user.id,
          createdByUserId: ctx.userId,
          expiresAt: new Date(Date.now() + SET_PASSWORD_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
        });

        return account.id;
      });
    } catch (err) {
      const pgErr = err as { code?: string; cause?: { code?: string } };
      if (pgErr?.code === "23505" || pgErr?.cause?.code === "23505") {
        return NextResponse.json(
          { error: "Já existe um usuário com este e-mail" },
          { status: 409 },
        );
      }
      throw err;
    }

    // Provision the UAZAPI instance. Non-fatal if it fails — the
    // client account exists either way; the platform owner can
    // retry the connection from /admin/[accountId].
    const uazapiBaseUrl = process.env.UAZAPI_SERVER_URL;
    const uazapiAdminToken = process.env.UAZAPI_ADMIN_TOKEN;
    let instanceWarning: string | null = null;

    if (uazapiBaseUrl && uazapiAdminToken) {
      const instanceResult = await createInstance(
        { baseUrl: uazapiBaseUrl, adminToken: uazapiAdminToken },
        `divarytalk-${newAccountId}`,
      );
      if (instanceResult.ok && instanceResult.data) {
        await ctx.db.insert(whatsappInstances).values({
          accountId: newAccountId,
          instanceName: instanceResult.data.instanceName,
          uazapiUrl: uazapiBaseUrl,
          uazapiToken: encrypt(instanceResult.data.instanceToken),
          status: "disconnected",
        });
      } else {
        instanceWarning = instanceResult.error || "Falha ao provisionar a instância UAZAPI";
      }
    } else {
      instanceWarning =
        "UAZAPI_SERVER_URL / UAZAPI_ADMIN_TOKEN não configurados — instância não provisionada.";
    }

    return NextResponse.json(
      {
        accountId: newAccountId,
        adminEmail,
        setPasswordLink: `${baseUrl(request)}/accept/${token}`,
        instanceWarning,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
