// ============================================================
// GET    /api/contacts/[id] — detail: contact + tags + custom
//        values + notes.
// PATCH  /api/contacts/[id] — update fields (and, optionally,
//        sync the tag set in the same call).
// DELETE /api/contacts/[id]
//
// All agent+. Every query is scoped by `ctx.accountId` — there is
// no RLS backing this table.
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { Db } from "@/db/client";
import {
  contactCustomValues,
  contactNotes,
  contactTags,
  contacts,
  customFields,
  tags,
} from "@/db/schema";

async function loadContact(db: Db, accountId: string, id: string) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.accountId, accountId)))
    .limit(1);
  return contact ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const contact = await loadContact(ctx.db, ctx.accountId, id);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const [tagRows, customValueRows, noteRows] = await Promise.all([
      ctx.db
        .select({ id: tags.id, name: tags.name, color: tags.color })
        .from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(eq(contactTags.contactId, id))
        .orderBy(asc(tags.name)),
      ctx.db
        .select({
          customFieldId: contactCustomValues.customFieldId,
          fieldName: customFields.fieldName,
          fieldType: customFields.fieldType,
          value: contactCustomValues.value,
        })
        .from(contactCustomValues)
        .innerJoin(customFields, eq(customFields.id, contactCustomValues.customFieldId))
        .where(eq(contactCustomValues.contactId, id)),
      ctx.db
        .select()
        .from(contactNotes)
        .where(eq(contactNotes.contactId, id))
        .orderBy(desc(contactNotes.createdAt)),
    ]);

    return NextResponse.json({
      contact,
      tags: tagRows,
      customValues: customValueRows,
      notes: noteRows,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadContact(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          name?: unknown;
          phone?: unknown;
          email?: unknown;
          company?: unknown;
          avatarUrl?: unknown;
          tagIds?: unknown;
        }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const update: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.name === "string") update.name = body.name.trim() || null;
    if (typeof body.email === "string") update.email = body.email.trim() || null;
    if (typeof body.company === "string") update.company = body.company.trim() || null;
    if (typeof body.avatarUrl === "string") update.avatarUrl = body.avatarUrl.trim() || null;
    if (typeof body.phone === "string") {
      const phone = body.phone.trim();
      if (!phone) {
        return NextResponse.json({ error: "'phone' cannot be empty" }, { status: 400 });
      }
      update.phone = phone;
    }

    let updated = existing;
    try {
      const [row] = await ctx.db
        .update(contacts)
        .set(update)
        .where(and(eq(contacts.id, id), eq(contacts.accountId, ctx.accountId)))
        .returning();
      if (row) updated = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return NextResponse.json(
          { error: "Já existe um contato com este telefone" },
          { status: 409 },
        );
      }
      throw err;
    }

    if (Array.isArray(body.tagIds)) {
      const tagIds = body.tagIds.filter((t): t is string => typeof t === "string");
      await ctx.db.delete(contactTags).where(eq(contactTags.contactId, id));
      if (tagIds.length > 0) {
        const ownedTags = await ctx.db
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.accountId, ctx.accountId), inArray(tags.id, tagIds)));
        if (ownedTags.length > 0) {
          await ctx.db
            .insert(contactTags)
            .values(ownedTags.map((t) => ({ contactId: id, tagId: t.id })))
            .onConflictDoNothing();
        }
      }
    }

    return NextResponse.json({ contact: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadContact(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    await ctx.db
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.accountId, ctx.accountId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Drizzle wraps the raw pg error in a DrizzleQueryError whose `.code`
 * is undefined — the real SQLSTATE is on `.cause.code`.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
}
