// ============================================================
// PATCH  /api/departments/[id] — rename / recolor. Admin+.
// DELETE /api/departments/[id]. Admin+. Conversations pointing at
//        it fall back to no department (ON DELETE SET NULL).
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { departments } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const limit = checkRateLimit(`admin:departmentUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; color?: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const update: Partial<typeof departments.$inferInsert> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "'name' cannot be empty" }, { status: 400 });
      }
      update.name = name;
    }
    if (typeof body.color === "string") {
      if (!HEX_COLOR.test(body.color)) {
        return NextResponse.json({ error: "'color' must be a hex color" }, { status: 400 });
      }
      update.color = body.color;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: true });
    }

    const [department] = await ctx.db
      .update(departments)
      .set(update)
      .where(and(eq(departments.id, id), eq(departments.accountId, ctx.accountId)))
      .returning();

    if (!department) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json({ department });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const limit = checkRateLimit(`admin:departmentDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const result = await ctx.db
      .delete(departments)
      .where(and(eq(departments.id, id), eq(departments.accountId, ctx.accountId)))
      .returning({ id: departments.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
