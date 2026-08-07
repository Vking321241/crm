// ============================================================
// PATCH  /api/tags/[id] — rename / recolor. Admin+.
// DELETE /api/tags/[id]. Admin+.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { tags } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const limit = checkRateLimit(`admin:tagUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; color?: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const update: Partial<typeof tags.$inferInsert> = {};
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

    const [tag] = await ctx.db
      .update(tags)
      .set(update)
      .where(and(eq(tags.id, id), eq(tags.accountId, ctx.accountId)))
      .returning();

    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    return NextResponse.json({ tag });
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

    const limit = checkRateLimit(`admin:tagDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const result = await ctx.db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.accountId, ctx.accountId)))
      .returning({ id: tags.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
