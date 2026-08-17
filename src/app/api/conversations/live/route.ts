// ============================================================
// GET /api/conversations/live — account-wide grid feed for the Modo
// Espião supervisor panel: every open/pending conversation, who's
// assigned, how long it's been running, and the last message. Gated
// behind the "spy_mode" permission module — owner/admin always pass,
// everyone else needs an explicit grant (see requireModule).
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { requireModule, toErrorResponse } from "@/lib/auth/account";
import { conversations, contacts, users } from "@/db/schema";

export async function GET() {
  try {
    const ctx = await requireModule("spy_mode");

    const rows = await ctx.db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(
        and(
          eq(conversations.accountId, ctx.accountId),
          inArray(conversations.status, ["open", "pending"]),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt));

    const agentIds = Array.from(
      new Set(rows.map((r) => r.conversation.assignedAgentId).filter((v): v is string => !!v)),
    );
    const agentRows = agentIds.length
      ? await ctx.db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, agentIds))
      : [];
    const agentsById = new Map(agentRows.map((a) => [a.id, a.fullName]));

    const items = rows.map(({ conversation, contact }) => ({
      id: conversation.id,
      status: conversation.status,
      contact_id: contact.id,
      contact_name: contact.name || contact.phone,
      agent_id: conversation.assignedAgentId ?? null,
      agent_name: conversation.assignedAgentId
        ? (agentsById.get(conversation.assignedAgentId) ?? null)
        : null,
      last_message_text: conversation.lastMessageText,
      last_message_at: conversation.lastMessageAt,
      started_at: conversation.createdAt,
    }));

    return NextResponse.json({ conversations: items });
  } catch (err) {
    return toErrorResponse(err);
  }
}
