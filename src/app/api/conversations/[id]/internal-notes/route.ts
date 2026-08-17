// ============================================================
// GET  /api/conversations/[id]/internal-notes — list, oldest first,
//      with author name + which teammates have marked it read.
// POST /api/conversations/[id]/internal-notes — drop a note into
//      the timeline. Body: { body }. Never sent to the customer.
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conversationInternalNotes, internalNoteReads, users } from "@/db/schema";
import { loadOwnedConversation } from "../../_shared";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const notes = await ctx.db
      .select({
        note: conversationInternalNotes,
        authorName: users.fullName,
      })
      .from(conversationInternalNotes)
      .leftJoin(users, eq(users.id, conversationInternalNotes.authorId))
      .where(eq(conversationInternalNotes.conversationId, id))
      .orderBy(asc(conversationInternalNotes.createdAt));

    const noteIds = notes.map((n) => n.note.id);
    const reads = noteIds.length
      ? await ctx.db
          .select({
            noteId: internalNoteReads.noteId,
            userId: internalNoteReads.userId,
            userName: users.fullName,
          })
          .from(internalNoteReads)
          .leftJoin(users, eq(users.id, internalNoteReads.userId))
          .where(inArray(internalNoteReads.noteId, noteIds))
      : [];

    const readersByNote = new Map<string, { user_id: string; name: string | null }[]>();
    for (const r of reads) {
      const list = readersByNote.get(r.noteId) ?? [];
      list.push({ user_id: r.userId, name: r.userName });
      readersByNote.set(r.noteId, list);
    }

    return NextResponse.json({
      notes: notes.map(({ note, authorName }) => ({
        id: note.id,
        conversation_id: note.conversationId,
        author_id: note.authorId ?? undefined,
        author_name: authorName ?? undefined,
        body: note.body,
        created_at: note.createdAt,
        read_by: readersByNote.get(note.id) ?? [],
        read_by_me: (readersByNote.get(note.id) ?? []).some((r) => r.user_id === ctx.userId),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { body?: unknown } | null;
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "'body' is required" }, { status: 400 });
    }

    const [row] = await ctx.db
      .insert(conversationInternalNotes)
      .values({ accountId: ctx.accountId, conversationId: id, authorId: ctx.userId, body: text })
      .returning();

    const [author] = await ctx.db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    // The author has, definitionally, already "read" their own note.
    await ctx.db.insert(internalNoteReads).values({ noteId: row.id, userId: ctx.userId });

    return NextResponse.json(
      {
        note: {
          id: row.id,
          conversation_id: row.conversationId,
          author_id: row.authorId ?? undefined,
          author_name: author?.fullName ?? undefined,
          body: row.body,
          created_at: row.createdAt,
          read_by: [{ user_id: ctx.userId, name: author?.fullName ?? null }],
          read_by_me: true,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
