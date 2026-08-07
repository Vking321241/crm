// ============================================================
// PATCH  /api/pipelines/[id] — rename a pipeline.
// DELETE /api/pipelines/[id] — delete a pipeline (cascades to its
//        stages and deals via FK ON DELETE CASCADE).
//
// Both admin+ (settings-class write). Every query is scoped by
// `ctx.accountId` — there is no RLS backing this table.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { Db } from "@/db/client";
import { pipelines } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_NAME_LEN = 120;

async function loadPipeline(db: Db, accountId: string, id: string) {
  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.accountId, accountId)))
    .limit(1);
  return pipeline ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const limit = checkRateLimit(`admin:pipelineUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const existing = await loadPipeline(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const update: Partial<typeof pipelines.$inferInsert> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "'name' cannot be empty" }, { status: 400 });
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `'name' must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      update.name = name;
    }

    let updated = existing;
    if (Object.keys(update).length > 0) {
      const [row] = await ctx.db
        .update(pipelines)
        .set(update)
        .where(and(eq(pipelines.id, id), eq(pipelines.accountId, ctx.accountId)))
        .returning();
      if (row) updated = row;
    }

    return NextResponse.json({ pipeline: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const limit = checkRateLimit(`admin:pipelineDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const existing = await loadPipeline(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    await ctx.db
      .delete(pipelines)
      .where(and(eq(pipelines.id, id), eq(pipelines.accountId, ctx.accountId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
