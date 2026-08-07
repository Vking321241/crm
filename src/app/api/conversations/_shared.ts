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

import { and, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { conversations, contacts, messages, messageReactions } from "@/db/schema";

type ContactRow = typeof contacts.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type ReactionRow = typeof messageReactions.$inferSelect;

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
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function toApiConversation(
  row: ConversationRow,
  contact?: ContactRow | null,
) {
  return {
    id: row.id,
    user_id: row.userId ?? undefined,
    contact_id: row.contactId,
    status: row.status,
    assigned_agent_id: row.assignedAgentId ?? undefined,
    last_message_text: row.lastMessageText ?? undefined,
    last_message_at: row.lastMessageAt ?? undefined,
    unread_count: row.unreadCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    contact: contact ? toApiContact(contact) : undefined,
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
