// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's session + account in one round
// trip and verifies role on demand.
//
// Fatia 2: rewritten internals (Postgres/Drizzle session lookup
// instead of Supabase Auth), SAME public shape as before, so the
// routes written in Fatia 1 (invitations, admin/clients, whatsapp
// instance endpoints) barely change — they still destructure
// `userId` / `accountId` / `role` / `account` off the returned
// context, they just get `ctx.db` (Drizzle) instead of
// `ctx.supabase` for queries.
//
// IMPORTANT: there is no RLS backing this anymore. Every query
// downstream MUST filter by `accountId` explicitly — this module
// only establishes *who is asking*, it does not enforce row-level
// isolation for you.
// ============================================================

import { NextResponse } from "next/server";

import { db, type Db } from "@/db/client";
import { getSessionUser } from "./session";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";
import { roleHasFullAccess, type PermissionModule } from "./permissions";
import { getGrantedModules } from "./permissions-data";

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Drizzle instance — plain Postgres, no RLS. Every query MUST
   *  filter by `accountId` (or `isCurrentAccountPlatform`) itself. */
  db: Db;
  userId: string;
  accountId: string;
  role: AccountRole;
  account: {
    id: string;
    name: string;
    isPlatform: boolean;
    maxAgentSeats: number;
    defaultCurrency: string;
    emailDomain: string | null;
  };
}

/**
 * Resolve the caller's user + account + role from their session
 * cookie. Throws `UnauthorizedError` if there's no valid session.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const session = await getSessionUser();
  if (!session) throw new UnauthorizedError();

  if (!isAccountRole(session.accountRole)) {
    // Defensive — the DB enum should make this impossible.
    throw new ForbiddenError(`Unknown account role: ${session.accountRole}`);
  }

  return {
    db,
    userId: session.userId,
    accountId: session.accountId,
    role: session.accountRole,
    account: session.account,
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(`This action requires the '${min}' role or higher`);
  }
  return ctx;
}

/**
 * Resolve the caller's account context and enforce access to a
 * granular permission module (src/lib/auth/permissions.ts). Owner/
 * admin always pass — see `roleHasFullAccess`; agent need an
 * explicit grant in `user_permissions`.
 */
export async function requireModule(module: PermissionModule): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (roleHasFullAccess(ctx.role)) return ctx;
  const granted = await getGrantedModules(ctx.db, ctx.userId);
  if (!granted.has(module)) {
    throw new ForbiddenError(`This action requires access to the '${module}' module`);
  }
  return ctx;
}

/**
 * Resolve the caller's account context and verify they belong to
 * the platform account (`accounts.is_platform`), i.e. they are a
 * DivaryTalk operator, not a client user.
 */
export async function requirePlatformOwner(): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!ctx.account.isPlatform) {
    throw new ForbiddenError("This action is restricted to platform owners");
  }
  return ctx;
}

/**
 * Checks whether an already-resolved `ctx` belongs to the platform
 * account, without a second session lookup. Used by routes that
 * accept an optional cross-account `accountId` (e.g. the UAZAPI
 * instance connect/status endpoints), where "is this caller a
 * platform operator" is one branch among several rather than the
 * route's sole gate.
 */
export function isCurrentAccountPlatform(ctx: Pick<AccountContext, "account">): boolean {
  return ctx.account.isPlatform;
}
