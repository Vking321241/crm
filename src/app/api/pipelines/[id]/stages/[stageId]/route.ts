// ============================================================
// PATCH  /api/pipelines/[id]/stages/[stageId] — rename / recolor /
//        reposition a stage.
// DELETE /api/pipelines/[id]/stages/[stageId] — delete a stage.
//        Refuses if any deal still references it (the FK has no
//        ON DELETE behavior for `deals.stage_id`, so this would
//        otherwise 500 on a constraint violation — checking first
//        gives the admin an actionable 409 instead).
//
// Both admin+. `pipeline_stages` has no `account_id` of its own —
// every query joins/filters through the parent `pipelines.account_id`
// to keep this account-scoped.
// ============================================================

import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { Db } from "@/db/client";
import { deals, pipelines, pipelineStages } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_STAGE_NAME_LEN = 80;

async function loadOwnedStage(db: Db, accountId: string, pipelineId: string, stageId: string) {
  const [row] = await db
    .select({ stage: pipelineStages })
    .from(pipelineStages)
    .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
    .where(
      and(
        eq(pipelineStages.id, stageId),
        eq(pipelineStages.pipelineId, pipelineId),
        eq(pipelines.accountId, accountId),
      ),
    )
    .limit(1);
  return row?.stage ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id: pipelineId, stageId } = await params;

    const limit = checkRateLimit(`admin:stageUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const existing = await loadOwnedStage(ctx.db, ctx.accountId, pipelineId, stageId);
    if (!existing) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; color?: unknown; position?: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const update: Partial<typeof pipelineStages.$inferInsert> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "'name' cannot be empty" }, { status: 400 });
      }
      if (name.length > MAX_STAGE_NAME_LEN) {
        return NextResponse.json(
          { error: `'name' must be ${MAX_STAGE_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      update.name = name;
    }
    if (typeof body.color === "string" && body.color.trim()) {
      update.color = body.color.trim();
    }
    if (typeof body.position === "number" && Number.isFinite(body.position)) {
      update.position = Math.trunc(body.position);
    }

    let updated = existing;
    if (Object.keys(update).length > 0) {
      const [row] = await ctx.db
        .update(pipelineStages)
        .set(update)
        .where(eq(pipelineStages.id, stageId))
        .returning();
      if (row) updated = row;
    }

    return NextResponse.json({ stage: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id: pipelineId, stageId } = await params;

    const limit = checkRateLimit(`admin:stageDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const existing = await loadOwnedStage(ctx.db, ctx.accountId, pipelineId, stageId);
    if (!existing) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const [{ value: dealCount }] = await ctx.db
      .select({ value: count() })
      .from(deals)
      .where(eq(deals.stageId, stageId));
    if (dealCount > 0) {
      return NextResponse.json(
        { error: "Move or delete the deals in this stage before removing it" },
        { status: 409 },
      );
    }

    await ctx.db.delete(pipelineStages).where(eq(pipelineStages.id, stageId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
