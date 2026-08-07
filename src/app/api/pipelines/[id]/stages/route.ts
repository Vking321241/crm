// ============================================================
// POST /api/pipelines/[id]/stages — create a stage on a pipeline.
//
// Admin+ (settings-class write). `pipeline_stages` has no
// `account_id` column of its own — ownership is only reachable
// through its parent pipeline, so every query here joins/filters
// through `pipelines.account_id` to keep this account-scoped.
// ============================================================

import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { pipelines, pipelineStages } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_STAGE_NAME_LEN = 80;
const DEFAULT_COLOR = "#3b82f6";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id: pipelineId } = await params;

    const limit = checkRateLimit(`admin:stageCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const [pipeline] = await ctx.db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.accountId, ctx.accountId)))
      .limit(1);
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; color?: unknown; position?: unknown }
      | null;

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }
    if (name.length > MAX_STAGE_NAME_LEN) {
      return NextResponse.json(
        { error: `'name' must be ${MAX_STAGE_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const color = typeof body?.color === "string" && body.color.trim() ? body.color.trim() : DEFAULT_COLOR;

    let position = typeof body?.position === "number" ? Math.trunc(body.position) : NaN;
    if (!Number.isFinite(position)) {
      const [{ value: stageCount }] = await ctx.db
        .select({ value: count() })
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineId, pipelineId));
      position = stageCount;
    }

    const [stage] = await ctx.db
      .insert(pipelineStages)
      .values({ pipelineId, name, color, position })
      .returning();

    return NextResponse.json({ stage }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
