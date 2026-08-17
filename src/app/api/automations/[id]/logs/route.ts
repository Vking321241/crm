import { and, desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { automationLogs, automations, contacts } from '@/db/schema'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params

    const [automation] = await ctx.db
      .select({
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
      })
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.accountId, ctx.accountId)))
      .limit(1)

    if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rows = await ctx.db
      .select({
        id: automationLogs.id,
        automation_id: automationLogs.automationId,
        user_id: automationLogs.userId,
        contact_id: automationLogs.contactId,
        trigger_event: automationLogs.triggerEvent,
        steps_executed: automationLogs.stepsExecuted,
        status: automationLogs.status,
        error_message: automationLogs.errorMessage,
        created_at: automationLogs.createdAt,
        contact_id_joined: contacts.id,
        contact_name: contacts.name,
        contact_phone: contacts.phone,
      })
      .from(automationLogs)
      .leftJoin(contacts, eq(contacts.id, automationLogs.contactId))
      .where(
        and(
          eq(automationLogs.automationId, id),
          eq(automationLogs.accountId, ctx.accountId),
        ),
      )
      .orderBy(desc(automationLogs.createdAt))
      .limit(100)

    const logs = rows.map((row) => ({
      id: row.id,
      automation_id: row.automation_id,
      user_id: row.user_id,
      contact_id: row.contact_id,
      trigger_event: row.trigger_event,
      steps_executed: row.steps_executed,
      status: row.status,
      error_message: row.error_message,
      created_at: row.created_at,
      contact: row.contact_id_joined
        ? {
            id: row.contact_id_joined,
            name: row.contact_name,
            phone: row.contact_phone,
          }
        : null,
    }))

    return NextResponse.json({ automation, logs })
  } catch (err) {
    return toErrorResponse(err)
  }
}
