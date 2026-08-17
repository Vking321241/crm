// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";
import { asc, count, eq } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers } from "@/lib/auth/roles";
import { accounts, users, userPermissions } from "@/db/schema";
import { hashPassword } from "@/lib/auth/session";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isPermissionModule } from "@/lib/auth/permissions";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await ctx.db
      .select({
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: users.accountRole,
        joinedAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.accountId, ctx.accountId))
      .orderBy(asc(users.createdAt));

    const canSeeEmails = canManageMembers(ctx.role);

    const members = rows.map((row) => ({
      user_id: row.userId,
      full_name: row.fullName,
      email: canSeeEmails ? row.email : null,
      avatar_url: row.avatarUrl,
      role: row.role,
      joined_at: row.joinedAt,
    }));

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// POST /api/account/members
//
// Admin+ creates a user directly — no invite link, no
// self-registration. The admin types the person's real e-mail and a
// password, and picks exactly which modules that person can access
// (src/lib/auth/permissions.ts) right here, instead of choosing a
// predefined role. The underlying `accountRole` is always "agent"
// (the minimum baseline the auth layer needs), but the modules the
// admin selects are what actually determine what the person sees —
// checking every module makes them a de-facto "gerente" without a
// role promotion; leaving just one checked locks them to that one
// screen. Admins/owners still go through the separate invite-link
// flow (src/app/api/auth/accept-token) since promoting to admin/
// owner is a different, higher-trust action than granting modules.
// ============================================================

const MIN_PASSWORD_LEN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const [[accountRow], [{ value: memberCount }]] = await Promise.all([
      ctx.db.select().from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1),
      ctx.db.select({ value: count() }).from(users).where(eq(users.accountId, ctx.accountId)),
    ]);

    if (!accountRow) {
      return NextResponse.json({ error: "Falha ao carregar a conta" }, { status: 500 });
    }

    if (memberCount >= accountRow.maxAgentSeats) {
      return NextResponse.json(
        {
          error:
            "Limite de usuários atingido. Fale com o administrador da plataforma para liberar mais vagas.",
        },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; email?: unknown; password?: unknown; modules?: unknown }
      | null;

    const fullName = typeof body?.name === "string" ? body.name.trim() : "";
    if (!fullName) {
      return NextResponse.json({ error: "Informe o nome do usuário" }, { status: 400 });
    }
    if (fullName.length > 80) {
      return NextResponse.json(
        { error: "Nome deve ter no máximo 80 caracteres" },
        { status: 400 },
      );
    }

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Informe um e-mail válido" }, { status: 400 });
    }

    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `A senha deve ter pelo menos ${MIN_PASSWORD_LEN} caracteres` },
        { status: 400 },
      );
    }

    const modules = Array.isArray(body?.modules)
      ? Array.from(new Set(body.modules.filter(isPermissionModule)))
      : [];

    const passwordHash = await hashPassword(password);

    try {
      const [created] = await ctx.db
        .insert(users)
        .values({
          email,
          passwordHash,
          fullName,
          accountId: ctx.accountId,
          accountRole: "agent",
        })
        .returning({
          userId: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.accountRole,
          joinedAt: users.createdAt,
        });

      if (modules.length > 0) {
        await ctx.db.insert(userPermissions).values(
          modules.map((module) => ({
            userId: created.userId,
            accountId: ctx.accountId,
            module,
            canAccess: true,
          })),
        );
      }

      return NextResponse.json(
        {
          member: {
            user_id: created.userId,
            full_name: created.fullName,
            email: created.email,
            avatar_url: null,
            role: created.role,
            joined_at: created.joinedAt,
          },
        },
        { status: 201 },
      );
    } catch (err) {
      const pgErr = err as { code?: string; cause?: { code?: string } };
      if (pgErr?.code === "23505" || pgErr?.cause?.code === "23505") {
        return NextResponse.json(
          { error: "Já existe um usuário com este e-mail." },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
