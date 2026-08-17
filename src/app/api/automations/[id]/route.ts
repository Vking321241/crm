import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { automations } from '@/db/schema'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'
import type { AutomationTriggerType } from '@/types'

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params

    const [automation] = await ctx.db
      .select(AUTOMATION_COLUMNS)
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.accountId, ctx.accountId)))
      .limit(1)

    if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const steps = await loadStepsTree(id)
    return NextResponse.json({ automation, steps })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const [existing] = await ctx.db
      .select({
        id: automations.id,
        isActive: automations.isActive,
        triggerType: automations.triggerType,
        triggerConfig: automations.triggerConfig,
      })
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.accountId, ctx.accountId)))
      .limit(1)

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const update: {
      name?: string
      description?: string | null
      triggerType?: AutomationTriggerType
      triggerConfig?: unknown
      isActive?: boolean
      updatedAt?: Date
    } = {}

    if ('name' in body) update.name = body.name
    if ('description' in body) update.description = body.description ?? null
    if ('trigger_type' in body) update.triggerType = body.trigger_type
    if ('trigger_config' in body) update.triggerConfig = body.trigger_config ?? {}
    if ('is_active' in body) update.isActive = !!body.is_active

    const willBeActive =
      typeof update.isActive === 'boolean' ? update.isActive : existing.isActive
    if (willBeActive) {
      const mergedTriggerType = (update.triggerType ?? existing.triggerType) as string
      const mergedTriggerConfig = update.triggerConfig ?? existing.triggerConfig
      const mergedSteps = Array.isArray(body.steps)
        ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
        : await loadStepsTree(id)
      const issues = [
        ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
        ...validateStepsForActivation(mergedSteps),
      ]
      if (issues.length > 0) {
        return NextResponse.json(
          {
            error: 'Cannot keep automation active with invalid configuration',
            issues,
          },
          { status: 400 },
        )
      }
    }

    if (Object.keys(update).length > 0) {
      update.updatedAt = new Date()
      await ctx.db
        .update(automations)
        .set(update)
        .where(and(eq(automations.id, id), eq(automations.accountId, ctx.accountId)))
    }

    if (Array.isArray(body.steps)) {
      const err = await replaceSteps(id, body.steps as BuilderStepInput[])
      if (err) return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    await ctx.db
      .delete(automations)
      .where(and(eq(automations.id, id), eq(automations.accountId, ctx.accountId)))

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
