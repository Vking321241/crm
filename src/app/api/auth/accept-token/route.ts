import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, authTokens, users, userPermissions } from "@/db/schema";
import { createSession, hashPassword, hashToken } from "@/lib/auth/session";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { DEFAULT_AGENT_MODULES, roleHasFullAccess } from "@/lib/auth/permissions";

// GET /api/auth/accept-token?token=... — anonymous peek, used by
// /accept/[token] to render "you're invited to <account>" / "set
// your password" before the visitor submits anything. Mirrors the
// old peek_invitation RPC's uniform ok/reason shape.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "not_found" });
  }

  const limit = checkRateLimit(`auth:peekToken:${token}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(authTokens)
    .where(eq(authTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) return NextResponse.json({ ok: false, reason: "not_found" });
  if (row.usedAt) return NextResponse.json({ ok: false, reason: "used" });
  if (row.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, reason: "expired" });
  }

  if (row.purpose === "invite") {
    const [account] = row.accountId
      ? await db.select().from(accounts).where(eq(accounts.id, row.accountId)).limit(1)
      : [];
    return NextResponse.json({
      ok: true,
      purpose: "invite",
      accountName: account?.name ?? null,
      role: row.role,
    });
  }

  const [user] = row.targetUserId
    ? await db.select().from(users).where(eq(users.id, row.targetUserId)).limit(1)
    : [];
  return NextResponse.json({
    ok: true,
    purpose: "set_password",
    email: user?.email ?? null,
  });
}

// POST /api/auth/accept-token
//
// One route for both single-use token purposes (see src/db/schema.ts
// `auth_tokens`):
//   - purpose='invite'        — the redeemer doesn't have a user row
//     yet; this creates one, already scoped to the inviting account,
//     with the role the token carries. Needs email/fullName/password.
//   - purpose='set_password'  — the redeemer already exists
//     (`targetUserId`); this just sets their password. Needs only
//     password.
//
// Replaces both Supabase's `redeem_invitation` RPC and the
// signup-then-verify-email dance — there's no "orphan personal
// account" problem here because nothing auto-creates a user row the
// way Supabase's signup trigger did; a user only ever comes into
// existence already attached to the right account.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    email?: string;
    fullName?: string;
    password?: string;
  } | null;

  const token = body?.token?.trim();
  const password = body?.password;
  if (!token || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Token e senha (mínimo 8 caracteres) são obrigatórios" },
      { status: 400 },
    );
  }

  const limit = checkRateLimit(`auth:acceptToken:${token}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, tokenHash), isNull(authTokens.usedAt)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Link inválido ou já utilizado" }, { status: 404 });
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Este link expirou" }, { status: 410 });
  }

  const passwordHash = await hashPassword(password);

  try {
    let userId: string;

    if (row.purpose === "invite") {
      const email = body?.email?.trim().toLowerCase();
      const fullName = body?.fullName?.trim();
      if (!email || !fullName || !row.accountId || !row.role) {
        return NextResponse.json(
          { error: "Nome e e-mail são obrigatórios" },
          { status: 400 },
        );
      }

      const [created] = await db
        .insert(users)
        .values({
          email,
          fullName,
          passwordHash,
          accountId: row.accountId,
          accountRole: row.role,
        })
        .returning({ id: users.id });
      userId = created.id;

      if (!roleHasFullAccess(row.role)) {
        await db.insert(userPermissions).values(
          DEFAULT_AGENT_MODULES.map((module) => ({
            userId,
            accountId: row.accountId!,
            module,
            canAccess: true,
          })),
        );
      }
    } else {
      if (!row.targetUserId) {
        return NextResponse.json({ error: "Link inválido" }, { status: 400 });
      }
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, row.targetUserId));
      userId = row.targetUserId;
    }

    await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    await createSession(userId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Unique violation on users.email — someone already claimed this
    // address between the token being issued and redeemed.
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === "23505" || pgErr?.cause?.code === "23505") {
      return NextResponse.json(
        { error: "Já existe uma conta com este e-mail" },
        { status: 409 },
      );
    }
    console.error("[POST /api/auth/accept-token] error:", err);
    return NextResponse.json({ error: "Falha ao concluir o cadastro" }, { status: 500 });
  }
}
