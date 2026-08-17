import { and, asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { automationSteps, automations } from '@/db/schema'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import type { AutomationStepType, AutomationTriggerType } from '@/types'

const AUTOMATION_COLUMNS = {
  id: automations.id,
  account_id: automations.accountId,
  user_id: automations.userId,
  name: automations.name,
  description: automations.description,
  trigger_type: automations.triggerType,
  trigger_config: automations.triggerConfig,
  is_active: automations.isActive,
  execution_count: automations.executionCount,
  last_executed_at: automations.lastExecutedAt,
  created_at: automations.createdAt,
  updated_at: automations.updatedAt,
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    const [original] = await ctx.db
      .select({
        id: automations.id,
        accountId: automations.accountId,
        name: automations.name,
        description: automations.description,
        triggerType: automations.triggerType,
        triggerConfig: automations.triggerConfig,
      })
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.accountId, ctx.accountId)))
      .limit(1)

    if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [copy] = await ctx.db
      .insert(automations)
      .values({
        accountId: original.accountId,
        userId: ctx.userId,
        name: `${original.name} (Copy)`,
        description: original.description,
        triggerType: original.triggerType as AutomationTriggerType,
        triggerConfig: original.triggerConfig ?? {},
        isActive: false,
      })
      .returning(AUTOMATION_COLUMNS)

    if (!copy) {
      return NextResponse.json({ error: 'copy failed' }, { status: 500 })
    }

    const steps = await ctx.db
      .select({
        id: automationSteps.id,
        parentStepId: automationSteps.parentStepId,
        branch: automationSteps.branch,
        stepType: automationSteps.stepType,
        stepConfig: automationSteps.stepConfig,
        position: automationSteps.position,
      })
      .from(automationSteps)
      .where(eq(automationSteps.automationId, id))
      .orderBy(asc(automationSteps.position))

    if (steps.length > 0) {
      const idMap = new Map<string, string>()
      const uid = () =>
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36)
      for (const row of steps) idMap.set(row.id, uid())

      const rows = steps.map((row) => ({
        id: idMap.get(row.id)!,
        automationId: copy.id,
        parentStepId: row.parentStepId ? idMap.get(row.parentStepId) ?? null : null,
        branch: row.branch as 'yes' | 'no' | null,
        stepType: row.stepType as AutomationStepType,
        stepConfig: row.stepConfig ?? {},
        position: row.position,
      }))
      await ctx.db.insert(automationSteps).values(rows)
    }

    return NextResponse.json({ automation: copy }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
