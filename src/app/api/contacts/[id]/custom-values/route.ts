// ============================================================
// PUT /api/contacts/[id]/custom-values — batch upsert.
// Body: { values: { customFieldId, value }[] }. Agent+ (editing a
// contact's own field values is operational, not settings — the
// field *definitions* CRUD lives under /api/custom-fields and is
// admin+).
//
// Semantics: replace-in-place per field. A blank/empty `value`
// deletes the row (mirrors the old client behavior of only
// inserting rows with a non-empty trimmed value).
// ============================================================

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contactCustomValues, contacts, customFields } from "@/db/schema";

export async function PUT(
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
      | { values?: unknown }
      | null;
    const rawValues = Array.isArray(body?.values) ? body.values : [];

    const entries = rawValues
      .filter(
        (v): v is { customFieldId: unknown; value: unknown } =>
          !!v && typeof v === "object",
      )
      .map((v) => ({
        customFieldId: typeof v.customFieldId === "string" ? v.customFieldId : "",
        value: typeof v.value === "string" ? v.value.trim() : "",
      }))
      .filter((v) => v.customFieldId);

    if (entries.length === 0) {
      return NextResponse.json({ ok: true });
    }

    // Only allow field ids that actually belong to this account —
    // an id from another tenant must silently no-op, not write.
    const fieldIds = entries.map((e) => e.customFieldId);
    const ownedFields = await ctx.db
      .select({ id: customFields.id })
      .from(customFields)
      .where(and(eq(customFields.accountId, ctx.accountId), inArray(customFields.id, fieldIds)));
    const ownedIds = new Set(ownedFields.map((f) => f.id));

    const toUpsert = entries.filter((e) => ownedIds.has(e.customFieldId) && e.value);
    const toDelete = entries.filter((e) => ownedIds.has(e.customFieldId) && !e.value);

    if (toDelete.length > 0) {
      await ctx.db
        .delete(contactCustomValues)
        .where(
          and(
            eq(contactCustomValues.contactId, id),
            inArray(
              contactCustomValues.customFieldId,
              toDelete.map((e) => e.customFieldId),
            ),
          ),
        );
    }

    for (const entry of toUpsert) {
      await ctx.db
        .insert(contactCustomValues)
        .values({ contactId: id, customFieldId: entry.customFieldId, value: entry.value })
        .onConflictDoUpdate({
          target: [contactCustomValues.contactId, contactCustomValues.customFieldId],
          set: { value: entry.value },
        });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
