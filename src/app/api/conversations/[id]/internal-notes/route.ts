// ============================================================
// GET  /api/conversations/[id]/internal-notes — list, oldest first,
//      with author name + which teammates have marked it read.
// POST /api/conversations/[id]/internal-notes — drop a note into
//      the timeline. Body: { body, mentions? }. Never sent to the
//      customer. `mentions` is [{ id, type: "user"|"department" }] —
//      a "user" mention notifies that person directly; a
//      "department" mention notifies every member of that setor.
//      Failing to notify never fails the note itself.
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  conversationInternalNotes,
  internalNoteReads,
  users,
  notifications,
  contacts,
  conversations,
} from "@/db/schema";
import type { Db } from "@/db/client";
import { loadOwnedConversation } from "../../_shared";

/** Resolves "user" mentions directly and "department" mentions to
 *  every member of that setor, dedupes, drops the note's own author
 *  (no self-notify), and inserts one `notifications` row per person. */
async function notifyMentions(
  db: Db,
  accountId: string,
  conversationId: string,
  authorId: string,
  authorName: string,
  mentions: { id: string; type: "user" | "department" }[],
): Promise<void> {
  const directUserIds = mentions.filter((m) => m.type === "user").map((m) => m.id);
  const departmentIds = mentions.filter((m) => m.type === "department").map((m) => m.id);

  const departmentMemberIds = departmentIds.length
    ? (
        await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.accountId, accountId), inArray(users.departmentId, departmentIds)))
      ).map((r) => r.id)
    : [];

  const targetUserIds = [...new Set([...directUserIds, ...departmentMemberIds])].filter(
    (id) => id !== authorId,
  );
  if (targetUserIds.length === 0) return;

  const [contactRow] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const contactLabel = contactRow?.name || contactRow?.phone || "uma conversa";

  await db.insert(notifications).values(
    targetUserIds.map((userId) => ({
      accountId,
      userId,
      type: "note_mention" as const,
      conversationId,
      actorUserId: authorId,
      title: `${authorName} marcou você numa nota`,
      body: `Em uma nota interna na conversa com ${contactLabel}`,
    })),
  );
}

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

    const body = (await request.json().catch(() => null)) as
      | { body?: unknown; mentions?: unknown }
      | null;
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "'body' is required" }, { status: 400 });
    }
    const rawMentions = Array.isArray(body?.mentions) ? body.mentions : [];
    const mentionEntries = rawMentions.filter(
      (m): m is { id: string; type: "user" | "department" } =>
        !!m &&
        typeof m === "object" &&
        typeof (m as Record<string, unknown>).id === "string" &&
        ((m as Record<string, unknown>).type === "user" || (m as Record<string, unknown>).type === "department"),
    );

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

    if (mentionEntries.length > 0) {
      await notifyMentions(ctx.db, ctx.accountId, id, ctx.userId, author?.fullName ?? "Alguém", mentionEntries).catch(
        (err) => console.error("[internal-notes POST] mention notify error:", err),
      );
    }

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
