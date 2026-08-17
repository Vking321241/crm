// ============================================================
// GET  /api/account/permissions — admin+ only. Returns every
//      non-owner member of the account with their module grants,
//      plus the module catalog so the client doesn't hardcode it.
// PATCH /api/account/permissions — admin+ only. Upserts a single
//      (userId, module) grant. One cell per request keeps the
//      matrix UI's checkbox clicks independent — no risk of one
//      slow save clobbering another cell's optimistic state.
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq, ne } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { users, userPermissions } from "@/db/schema";
import {
  DEFAULT_AGENT_MODULES,
  PERMISSION_MODULES,
  isPermissionModule,
  roleHasFullAccess,
} from "@/lib/auth/permissions";

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const [memberRows, grantRows] = await Promise.all([
      ctx.db
        .select({
          userId: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.accountRole,
        })
        .from(users)
        .where(and(eq(users.accountId, ctx.accountId), ne(users.accountRole, "owner")))
        .orderBy(asc(users.createdAt)),
      ctx.db
        .select({
          userId: userPermissions.userId,
          module: userPermissions.module,
          canAccess: userPermissions.canAccess,
        })
        .from(userPermissions)
        .where(eq(userPermissions.accountId, ctx.accountId)),
    ]);

    const grantsByUser = new Map<string, Set<string>>();
    for (const row of grantRows) {
      if (!row.canAccess) continue;
      const set = grantsByUser.get(row.userId) ?? new Set<string>();
      set.add(row.module);
      grantsByUser.set(row.userId, set);
    }

    const members = memberRows.map((m) => ({
      user_id: m.userId,
      full_name: m.fullName,
      email: m.email,
      role: m.role,
      full_access: roleHasFullAccess(m.role),
      granted_modules: Array.from(grantsByUser.get(m.userId) ?? []),
    }));

    return NextResponse.json({ members, modules: PERMISSION_MODULES });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface PatchBody {
  userId?: unknown;
  module?: unknown;
  canAccess?: unknown;
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as PatchBody | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const canAccess = typeof body?.canAccess === "boolean" ? body.canAccess : null;

    if (!userId || canAccess === null || !isPermissionModule(body?.module)) {
      return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
    }
    const moduleKey = body!.module as string;

    const [target] = await ctx.db
      .select({ id: users.id, role: users.accountRole })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.accountId, ctx.accountId)))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "O proprietário sempre tem acesso total" },
        { status: 400 },
      );
    }

    await ctx.db
      .insert(userPermissions)
      .values({
        userId,
        accountId: ctx.accountId,
        module: moduleKey,
        canAccess,
      })
      .onConflictDoUpdate({
        target: [userPermissions.userId, userPermissions.module],
        set: { canAccess, updatedAt: new Date() },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Exported for the create-agent flow so a freshly created atendente
// starts with the same baseline as everyone else instead of zero
// access until an admin visits the matrix.
export { DEFAULT_AGENT_MODULES };
