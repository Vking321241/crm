// ============================================================
// POST /api/contacts/[id]/tags — attach a tag to a contact.
// Body: { tagId }. Agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contactTags, contacts, tags } from "@/db/schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as { tagId?: unknown } | null;
    const tagId = typeof body?.tagId === "string" ? body.tagId : "";
    if (!tagId) {
      return NextResponse.json({ error: "'tagId' is required" }, { status: 400 });
    }

    const [contact] = await ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.accountId, ctx.accountId)))
      .limit(1);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const [tag] = await ctx.db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.id, tagId), eq(tags.accountId, ctx.accountId)))
      .limit(1);
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    await ctx.db
      .insert(contactTags)
      .values({ contactId: id, tagId })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
