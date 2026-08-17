// ============================================================
// Shared helpers for the /api/conversations/** routes.
//
// The frontend types in `@/types` (Conversation, Message, Contact,
// MessageReaction) mirror the old Supabase row shape (snake_case).
// Keeping the API responses in that same shape means the inbox
// components barely have to change beyond swapping their data
// source from `supabase.from(...)` to `fetch(...)` — only the
// transport changed, not the wire shape.
// ============================================================

import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import { conversations, contacts, messages, messageReactions, contactTags, tags } from "@/db/schema";

type ContactRow = typeof contacts.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type ReactionRow = typeof messageReactions.$inferSelect;

export interface ApiTag {
  id: string;
  name: string;
  color: string;
}

/**
 * Batch-loads tags for a set of contacts (one query, not N+1) — used
 * to attach the "etiquetas de produtos" chips to the conversation
 * list without a join-and-group in the main conversations query.
 */
export async function loadTagsByContactId(
  db: Db,
  contactIds: string[],
): Promise<Map<string, ApiTag[]>> {
  const map = new Map<string, ApiTag[]>();
  if (contactIds.length === 0) return map;

  const rows = await db
    .select({
      contactId: contactTags.contactId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(contactTags)
    .innerJoin(tags, eq(contactTags.tagId, tags.id))
    .where(inArray(contactTags.contactId, contactIds));

  for (const row of rows) {
    const list = map.get(row.contactId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.contactId, list);
  }
  return map;
}

export function toApiContact(row: ContactRow) {
  return {
    id: row.id,
    user_id: row.userId,
    account_id: row.accountId,
    phone: row.phone,
    phone_normalized: row.phoneNormalized ?? undefined,
    name: row.name ?? undefined,
    email: row.email ?? undefined,
    company: row.company ?? undefined,
    avatar_url: row.avatarUrl ?? undefined,
    is_group: row.isGroup,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function toApiConversation(
  row: ConversationRow,
  contact?: ContactRow | null,
  tags?: ApiTag[],
) {
  return {
    id: row.id,
    user_id: row.userId ?? undefined,
    contact_id: row.contactId,
    status: row.status,
    assigned_agent_id: row.assignedAgentId ?? undefined,
    department_id: row.departmentId ?? undefined,
    last_message_text: row.lastMessageText ?? undefined,
    last_message_at: row.lastMessageAt ?? undefined,
    unread_count: row.unreadCount,
    needs_acknowledgment: row.needsAcknowledgment,
    acknowledgment_reason: row.acknowledgmentReason ?? undefined,
    paused_at: row.pausedAt ?? undefined,
    pause_reason: row.pauseReason ?? undefined,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    contact: contact ? toApiContact(contact) : undefined,
    tags: tags ?? [],
  };
}

export function toApiMessage(row: MessageRow) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    sender_type: row.senderType,
    sender_id: row.senderId ?? undefined,
    content_type: row.contentType,
    content_text: row.contentText ?? undefined,
    media_url: row.mediaUrl ?? undefined,
    message_id: row.messageId ?? undefined,
    status: row.status,
    created_at: row.createdAt,
    reply_to_message_id: row.replyToMessageId ?? undefined,
    interactive_reply_id: row.interactiveReplyId ?? undefined,
    interactive_payload: row.interactivePayload ?? undefined,
    deleted_at: row.deletedAt ?? undefined,
    edited_at: row.editedAt ?? undefined,
  };
}

export function toApiReaction(row: ReactionRow) {
  return {
    id: row.id,
    message_id: row.messageId,
    conversation_id: row.conversationId,
    actor_type: row.actorType,
    actor_id: row.actorId ?? undefined,
    emoji: row.emoji,
    created_at: row.createdAt,
  };
}

/**
 * Loads a conversation row scoped to the caller's account, or null
 * if it doesn't exist / belongs to another account. Every route
 * under /api/conversations/[id]/** starts with this check.
 */
export async function loadOwnedConversation(
  db: Db,
  accountId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.accountId, accountId)))
    .limit(1);
  return row ?? null;
}
