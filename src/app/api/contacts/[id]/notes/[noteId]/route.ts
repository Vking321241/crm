// ============================================================
// DELETE /api/contacts/[id]/notes/[noteId] — agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contactNotes } from "@/db/schema";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id, noteId } = await params;

    const result = await ctx.db
      .delete(contactNotes)
      .where(
        and(
          eq(contactNotes.id, noteId),
          eq(contactNotes.contactId, id),
          eq(contactNotes.accountId, ctx.accountId),
        ),
      )
      .returning({ id: contactNotes.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
