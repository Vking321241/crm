// ============================================================
// POST /api/conversations/[id]/internal-notes/[noteId] — mark this
// note read by the caller. Idempotent (unique index on note+user).
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conversationInternalNotes, internalNoteReads } from "@/db/schema";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { noteId } = await params;

    const [note] = await ctx.db
      .select({ id: conversationInternalNotes.id })
      .from(conversationInternalNotes)
      .where(eq(conversationInternalNotes.id, noteId))
      .limit(1);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    await ctx.db
      .insert(internalNoteReads)
      .values({ noteId, userId: ctx.userId })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
