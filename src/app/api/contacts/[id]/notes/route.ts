// ============================================================
// GET  /api/contacts/[id]/notes — list, newest first.
// POST /api/contacts/[id]/notes — add a note. Body: { noteText }.
// Both agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contactNotes, contacts, users } from "@/db/schema";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const [contact] = await ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.accountId, ctx.accountId)))
      .limit(1);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const rows = await ctx.db
      .select({
        id: contactNotes.id,
        contactId: contactNotes.contactId,
        userId: contactNotes.userId,
        noteText: contactNotes.noteText,
        createdAt: contactNotes.createdAt,
        authorName: users.fullName,
      })
      .from(contactNotes)
      .leftJoin(users, eq(users.id, contactNotes.userId))
      .where(eq(contactNotes.contactId, id))
      .orderBy(desc(contactNotes.createdAt));

    const notes = rows.map((r) => ({
      id: r.id,
      contact_id: r.contactId,
      user_id: r.userId,
      note_text: r.noteText,
      created_at: r.createdAt,
      author_name: r.authorName,
    }));

    return NextResponse.json({ notes });
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

    const [contact] = await ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.accountId, ctx.accountId)))
      .limit(1);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { noteText?: unknown; note_text?: unknown }
      | null;
    // Accept both casings — the sidebar historically sent snake_case.
    const noteText =
      typeof body?.noteText === "string"
        ? body.noteText.trim()
        : typeof body?.note_text === "string"
          ? body.note_text.trim()
          : "";
    if (!noteText) {
      return NextResponse.json({ error: "'noteText' is required" }, { status: 400 });
    }

    const [[note], [author]] = await Promise.all([
      ctx.db
        .insert(contactNotes)
        .values({
          contactId: id,
          accountId: ctx.accountId,
          userId: ctx.userId,
          noteText,
        })
        .returning(),
      ctx.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, ctx.userId)).limit(1),
    ]);

    return NextResponse.json(
      {
        note: {
          id: note.id,
          contact_id: note.contactId,
          user_id: note.userId,
          note_text: note.noteText,
          created_at: note.createdAt,
          author_name: author?.fullName ?? null,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
