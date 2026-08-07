// ============================================================
// GET  /api/pipelines  — list the account's pipelines, each with
//        its `pipelineStages` (ordered by position).
// POST /api/pipelines  — create a pipeline. Admin+ (settings-class
//        write, see AGENTS.md / src/lib/auth/roles.ts
//        canEditSettings). Optionally seeds stages in the same
//        request (used by the "New Pipeline" dialog, which always
//        wants the spec-default stage set created atomically with
//        the pipeline) so the client never has to reconcile a
//        pipeline that exists with zero stages after a partial
//        failure.
//
// Every query is scoped by `ctx.accountId` — there is no RLS
// backing these tables.
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { pipelines, pipelineStages } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_NAME_LEN = 120;
const MAX_STAGE_NAME_LEN = 80;
const MAX_SEED_STAGES = 20;

interface SeedStageInput {
  name: string;
  color?: string;
  position: number;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const pipelineRows = await ctx.db
      .select()
      .from(pipelines)
      .where(eq(pipelines.accountId, ctx.accountId))
      .orderBy(asc(pipelines.createdAt));

    const pipelineIds = pipelineRows.map((p) => p.id);
    // Scoped indirectly: pipeline ids were themselves filtered by
    // accountId above, so this inArray can't leak another tenant's
    // stages.
    const stageRows =
      pipelineIds.length > 0
        ? await ctx.db
            .select()
            .from(pipelineStages)
            .where(inArray(pipelineStages.pipelineId, pipelineIds))
            .orderBy(asc(pipelineStages.position))
        : [];

    const stagesByPipeline = new Map<string, typeof pipelineStages.$inferSelect[]>();
    for (const stage of stageRows) {
      const list = stagesByPipeline.get(stage.pipelineId) ?? [];
      list.push(stage);
      stagesByPipeline.set(stage.pipelineId, list);
    }

    const result = pipelineRows.map((p) => ({
      ...p,
      pipelineStages: stagesByPipeline.get(p.id) ?? [],
    }));

    return NextResponse.json({ pipelines: result });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:pipelineCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; stages?: unknown }
      | null;

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `'name' must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const seedStages: SeedStageInput[] = [];
    if (Array.isArray(body?.stages)) {
      for (const [i, raw] of body.stages.entries()) {
        if (i >= MAX_SEED_STAGES) break;
        if (!raw || typeof raw !== "object") continue;
        const s = raw as Record<string, unknown>;
        const stageName = typeof s.name === "string" ? s.name.trim() : "";
        if (!stageName || stageName.length > MAX_STAGE_NAME_LEN) continue;
        const color = typeof s.color === "string" && s.color.trim() ? s.color.trim() : undefined;
        const position = typeof s.position === "number" ? s.position : seedStages.length;
        seedStages.push({ name: stageName, color, position });
      }
    }

    const created = await ctx.db.transaction(async (tx) => {
      const [pipeline] = await tx
        .insert(pipelines)
        .values({ accountId: ctx.accountId, userId: ctx.userId, name })
        .returning();

      let stages: (typeof pipelineStages.$inferSelect)[] = [];
      if (seedStages.length > 0) {
        stages = await tx
          .insert(pipelineStages)
          .values(
            seedStages.map((s) => ({
              pipelineId: pipeline.id,
              name: s.name,
              color: s.color ?? "#3b82f6",
              position: s.position,
            })),
          )
          .returning();
        stages.sort((a, b) => a.position - b.position);
      }

      return { ...pipeline, pipelineStages: stages };
    });

    return NextResponse.json({ pipeline: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
