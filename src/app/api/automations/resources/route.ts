import { asc, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { customFields, pipelineStages, pipelines, tags } from '@/db/schema'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    const [tagRows, customFieldRows, pipelineRows] = await Promise.all([
      ctx.db
        .select({
          id: tags.id,
          account_id: tags.accountId,
          user_id: tags.userId,
          name: tags.name,
          color: tags.color,
          created_at: tags.createdAt,
        })
        .from(tags)
        .where(eq(tags.accountId, ctx.accountId))
        .orderBy(asc(tags.name)),
      ctx.db
        .select({
          id: customFields.id,
          account_id: customFields.accountId,
          user_id: customFields.userId,
          field_name: customFields.fieldName,
          field_type: customFields.fieldType,
          field_options: customFields.fieldOptions,
          created_at: customFields.createdAt,
        })
        .from(customFields)
        .where(eq(customFields.accountId, ctx.accountId))
        .orderBy(asc(customFields.fieldName)),
      ctx.db
        .select({ id: pipelines.id, name: pipelines.name })
        .from(pipelines)
        .where(eq(pipelines.accountId, ctx.accountId))
        .orderBy(asc(pipelines.name)),
    ])

    const pipelineIds = pipelineRows.map((pipeline) => pipeline.id)
    const stageRows = pipelineIds.length
      ? await ctx.db
          .select({
            id: pipelineStages.id,
            name: pipelineStages.name,
            pipeline_id: pipelineStages.pipelineId,
            position: pipelineStages.position,
          })
          .from(pipelineStages)
          .where(inArray(pipelineStages.pipelineId, pipelineIds))
          .orderBy(asc(pipelineStages.position))
      : []

    return NextResponse.json({
      tags: tagRows,
      // Meta templates were intentionally dropped with the Supabase/Meta
      // config. Keep this as an empty list so the builder falls back to
      // manual UAZAPI template name/language fields when needed.
      templates: [],
      customFields: customFieldRows,
      pipelines: pipelineRows,
      stages: stageRows,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
