// ============================================================
// GET  /api/contacts/[id]/notes — list, newest first.
// POST /api/contacts/[id]/notes — add a note. Body: { noteText }.
// Both agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contactNotes, contacts } from "@/db/schema";

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

    const notes = await ctx.db
      .select()
      .from(contactNotes)
      .where(eq(contactNotes.contactId, id))
      .orderBy(desc(contactNotes.createdAt));

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

    const body = (await request.json().catch(() => null)) as { noteText?: unknown } | null;
    const noteText = typeof body?.noteText === "string" ? body.noteText.trim() : "";
    if (!noteText) {
      return NextResponse.json({ error: "'noteText' is required" }, { status: 400 });
    }

    const [note] = await ctx.db
      .insert(contactNotes)
      .values({
        contactId: id,
        accountId: ctx.accountId,
        userId: ctx.userId,
        noteText,
      })
      .returning();

    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
