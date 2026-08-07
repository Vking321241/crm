// ============================================================
// DELETE /api/contacts/[id]/tags/[tagId] — detach a tag. Agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contactTags, contacts } from "@/db/schema";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id, tagId } = await params;

    const [contact] = await ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.accountId, ctx.accountId)))
      .limit(1);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    await ctx.db
      .delete(contactTags)
      .where(and(eq(contactTags.contactId, id), eq(contactTags.tagId, tagId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
