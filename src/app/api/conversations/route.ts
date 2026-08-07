// ============================================================
// GET /api/conversations
//
// Lists the caller's account conversations, contact joined in,
// newest-first. Supports `?status=open|pending|closed` and
// `?search=<name-or-phone>`. Any account member can read (viewer
// included) — mutations are gated at agent+ in the [id] routes.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { conversations, contacts, conversationStatusEnum } from "@/db/schema";
import { toApiConversation } from "./_shared";

const VALID_STATUSES = conversationStatusEnum.enumValues;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search")?.trim();

    const conditions = [eq(conversations.accountId, ctx.accountId)];

    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(conversations.status, status as (typeof VALID_STATUSES)[number]));
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

    return NextResponse.json({
      conversations: rows.map((r) => toApiConversation(r.conversation, r.contact)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
