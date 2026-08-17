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
import { and, asc, count, eq, gt, isNull, like } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers } from "@/lib/auth/roles";
import { accounts, authTokens, users, userPermissions } from "@/db/schema";
import { hashPassword } from "@/lib/auth/session";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { DEFAULT_AGENT_MODULES } from "@/lib/auth/permissions";

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
// Admin+ creates an atendente (agent) directly — no invite link,
// no self-registration. The admin types only a first/last name and
// a password; the login e-mail is built as
// `slug(name)[N]@<accounts.email_domain>`. Role is always "agent":
// this is deliberately NOT a general "create any role" endpoint —
// admins/viewers still go through the invite-link flow so a new
// admin has to prove control of a real inbox before getting
// elevated access.
// ============================================================

const MIN_PASSWORD_LEN = 8;

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (ã, ç, é, …)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const [[accountRow], [{ value: memberCount }], [{ value: inviteCount }]] = await Promise.all([
      ctx.db.select().from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1),
      ctx.db.select({ value: count() }).from(users).where(eq(users.accountId, ctx.accountId)),
      ctx.db
        .select({ value: count() })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.accountId, ctx.accountId),
            eq(authTokens.purpose, "invite"),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, new Date()),
          ),
        ),
    ]);

    if (!accountRow) {
      return NextResponse.json({ error: "Falha ao carregar a conta" }, { status: 500 });
    }

    if (!accountRow.emailDomain) {
      return NextResponse.json(
        {
          error:
            "Configure o domínio de e-mail da equipe antes de criar atendentes (Configurações → Membros).",
        },
        { status: 409 },
      );
    }

    const seatsUsed = memberCount + inviteCount;
    if (seatsUsed >= accountRow.maxAgentSeats) {
      return NextResponse.json(
        {
          error:
            "Limite de usuários atingido. Fale com o administrador da plataforma para liberar mais vagas.",
        },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; password?: unknown }
      | null;

    const fullName = typeof body?.name === "string" ? body.name.trim() : "";
    if (!fullName) {
      return NextResponse.json({ error: "Informe o nome do atendente" }, { status: 400 });
    }
    if (fullName.length > 80) {
      return NextResponse.json(
        { error: "Nome deve ter no máximo 80 caracteres" },
        { status: 400 },
      );
    }

    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `A senha deve ter pelo menos ${MIN_PASSWORD_LEN} caracteres` },
        { status: 400 },
      );
    }

    const localPart = slugify(fullName);
    if (!localPart) {
      return NextResponse.json(
        { error: "Não foi possível gerar um e-mail a partir desse nome" },
        { status: 400 },
      );
    }

    // Resolve a free local-part: "joao@..." then "joao2@...",
    // "joao3@..." etc, scoped to this domain (emails are globally
    // unique across the whole platform).
    const domain = accountRow.emailDomain;
    const existingLocalParts = await ctx.db
      .select({ email: users.email })
      .from(users)
      .where(like(users.email, `${localPart}%@${domain}`));

    const taken = new Set(existingLocalParts.map((r) => r.email.toLowerCase()));
    let email = `${localPart}@${domain}`;
    let suffix = 2;
    while (taken.has(email)) {
      email = `${localPart}${suffix}@${domain}`;
      suffix += 1;
    }

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

      // Seed the baseline module grants so this atendente isn't
      // locked out of everything until an admin visits the
      // permissions matrix — mirrors what agents already got under
      // the old role-only model.
      await ctx.db.insert(userPermissions).values(
        DEFAULT_AGENT_MODULES.map((module) => ({
          userId: created.userId,
          accountId: ctx.accountId,
          module,
          canAccess: true,
        })),
      );

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
          { error: "Já existe um usuário com este e-mail. Tente outro nome." },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
