// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account / default currency. Manager+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import { accounts } from "@/db/schema";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { CURRENCIES } from "@/lib/currency";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("manager");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; defaultCurrency?: unknown; emailDomain?: unknown }
      | null;

    const updates: {
      name?: string;
      defaultCurrency?: string;
      emailDomain?: string | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (body?.name !== undefined) {
      if (typeof body.name !== "string") {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 },
        );
      }

      const name = body.name.trim();
      if (name.length === 0) {
        return NextResponse.json(
          { error: "Account name cannot be empty" },
          { status: 400 },
        );
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      updates.name = name;
    }

    if (body?.defaultCurrency !== undefined) {
      if (
        typeof body.defaultCurrency !== "string" ||
        !CURRENCIES.some((currency) => currency.code === body.defaultCurrency)
      ) {
        return NextResponse.json(
          { error: "Invalid default currency" },
          { status: 400 },
        );
      }
      updates.defaultCurrency = body.defaultCurrency;
    }

    if (body?.emailDomain !== undefined) {
      if (body.emailDomain === null) {
        updates.emailDomain = null;
      } else if (typeof body.emailDomain === "string") {
        // Bare hostname only — no scheme, no "@", no path. Lower-cased
        // so "Cliente1.com" and "cliente1.com" build the same emails.
        const domain = body.emailDomain.trim().toLowerCase();
        if (domain === "") {
          updates.emailDomain = null;
        } else if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
          return NextResponse.json(
            { error: "Domínio inválido. Use apenas o domínio, ex: cliente1.com" },
            { status: 400 },
          );
        } else {
          updates.emailDomain = domain;
        }
      } else {
        return NextResponse.json(
          { error: "'emailDomain' must be a string or null" },
          { status: 400 },
        );
      }
    }

    if (
      updates.name === undefined &&
      updates.defaultCurrency === undefined &&
      updates.emailDomain === undefined
    ) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 },
      );
    }

    // requireRole already guaranteed the caller is manager+ of this
    // account — the WHERE clause is the tenancy boundary (no RLS).
    const [data] = await ctx.db
      .update(accounts)
      .set(updates)
      .where(eq(accounts.id, ctx.accountId))
      .returning({
        id: accounts.id,
        name: accounts.name,
        defaultCurrency: accounts.defaultCurrency,
        emailDomain: accounts.emailDomain,
      });

    if (!data) {
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
