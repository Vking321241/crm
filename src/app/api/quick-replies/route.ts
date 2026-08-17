import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { quickReplies } from '@/db/schema'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'

/** Normalizes a raw shortcut input ("/Pix", " pix ") down to the bare
 *  lowercase keyword ("pix") stored in the DB — the leading "/" is
 *  only ever a UI affordance, never part of the stored value. */
function normalizeShortcut(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/^\/+/, '').toLowerCase()
  return trimmed || null
}

// Quick replies — reusable snippets (plain text or a saved interactive
// message) shared across the account. GET lists; POST creates. Ported
// off `supabaseAdmin()` onto Drizzle (Fatia: Inbox) — every query is
// scoped by `ctx.accountId` explicitly, there is no RLS backing this
// anymore.

function toApiQuickReply(row: typeof quickReplies.$inferSelect) {
  return {
    id: row.id,
    account_id: row.accountId,
    user_id: row.userId ?? undefined,
    title: row.title,
    shortcut: row.shortcut ?? undefined,
    kind: row.kind,
    content_text: row.contentText ?? undefined,
    interactive_payload: row.interactivePayload ?? undefined,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const rows = await ctx.db
      .select()
      .from(quickReplies)
      .where(eq(quickReplies.accountId, ctx.accountId))
      .orderBy(desc(quickReplies.createdAt))
    return NextResponse.json({ quick_replies: rows.map(toApiQuickReply) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const kind = body.kind === 'interactive' ? 'interactive' : 'text'
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    let contentText: string | null = null
    let interactivePayload: unknown = null

    if (kind === 'interactive') {
      const result = validateInteractivePayload(body.interactive_payload)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      interactivePayload = body.interactive_payload
    } else {
      const text = typeof body.content_text === 'string' ? body.content_text : ''
      if (!text.trim()) {
        return NextResponse.json(
          { error: 'content_text is required for text quick replies' },
          { status: 400 },
        )
      }
      contentText = text
    }

    const [row] = await ctx.db
      .insert(quickReplies)
      .values({
        accountId: ctx.accountId,
        userId: ctx.userId,
        title,
        shortcut: normalizeShortcut(body.shortcut),
        kind,
        contentText,
        interactivePayload: interactivePayload ?? undefined,
      })
      .returning()

    return NextResponse.json({ quick_reply: toApiQuickReply(row) }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
