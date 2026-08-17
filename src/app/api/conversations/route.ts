// ============================================================
// GET /api/conversations
//
// Lists the caller's account conversations, contact joined in,
// newest-first. Supports `?status=open|pending|closed` and
// `?search=<name-or-phone>`. Any account member can read (viewer
// included) — mutations are gated at agent+ in the [id] routes.
//
// Visibility: owner/admin always see every conversation. A plain
// agent/viewer only sees their OWN — Ativos/Fechados are scoped to
// `assigned_agent_id = caller` automatically, no `assignedToMe`
// param needed. "Pendentes" is the one exception: it stays the
// shared department queue (unfiltered) so anyone can pick a waiting
// conversation up, matching how transfers/hand-offs actually work.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { conversations, contacts, conversationStatusEnum } from "@/db/schema";
import { roleHasFullAccess } from "@/lib/auth/permissions";
import { toApiConversation, loadTagsByContactId } from "./_shared";

const VALID_STATUSES = conversationStatusEnum.enumValues;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search")?.trim();
    const departmentId = searchParams.get("departmentId");
    const assignedToMe = searchParams.get("assignedToMe") === "1";

    const conditions = [eq(conversations.accountId, ctx.accountId)];

    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(conversations.status, status as (typeof VALID_STATUSES)[number]));
    }

    if (departmentId) {
      conditions.push(eq(conversations.departmentId, departmentId));
    }

    if (assignedToMe) {
      conditions.push(eq(conversations.assignedAgentId, ctx.userId));
    } else if (!roleHasFullAccess(ctx.role) && status !== "pending") {
      conditions.push(eq(conversations.assignedAgentId, ctx.userId));
    }

    if (search) {
      const pattern = `%${search}%`;
      const searchCond = or(ilike(contacts.name, pattern), ilike(contacts.phone, pattern));
      if (searchCond) conditions.push(searchCond);
    }

    const rows = await ctx.db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt));

    const tagsByContact = await loadTagsByContactId(
      ctx.db,
      rows.map((r) => r.contact.id),
    );

    return NextResponse.json({
      conversations: rows.map((r) =>
        toApiConversation(r.conversation, r.contact, tagsByContact.get(r.contact.id)),
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
