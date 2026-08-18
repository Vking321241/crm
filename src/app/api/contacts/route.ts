// ============================================================
// GET  /api/contacts — paginated list, with search + tag filters.
// POST /api/contacts — create a contact.
//
// Both agent+ (contacts are operational data, see AGENTS.md /
// src/lib/auth/roles.ts canSendMessages doc).
//
// Tag filter semantics replace the old `filter_contacts_by_tags`
// SQL function (migration 025): `?tagId=<id>` may repeat, and a
// contact must carry EVERY tag id supplied (AND, not OR) to match —
// implemented as an inner join restricted to the requested tag ids,
// grouped by contact, with `HAVING count(distinct tag_id) = N`.
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contacts, contactTags, tags } from "@/db/schema";

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const url = new URL(request.url);

    const search = (url.searchParams.get("search") ?? "").trim();
    const tagIds = url.searchParams.getAll("tagId").filter(Boolean);

    const pageParam = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 0;

    const pageSizeParam = Number.parseInt(
      url.searchParams.get("pageSize") ?? String(PAGE_SIZE_DEFAULT),
      10,
    );
    const pageSize =
      Number.isFinite(pageSizeParam) && pageSizeParam > 0
        ? Math.min(pageSizeParam, PAGE_SIZE_MAX)
        : PAGE_SIZE_DEFAULT;

    const conditions = [eq(contacts.accountId, ctx.accountId)];
    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(
          ilike(contacts.name, like),
          ilike(contacts.phone, like),
          ilike(contacts.email, like),
        )!,
      );
    }
    const whereClause = and(...conditions)!;

    let rows: Array<typeof contacts.$inferSelect>;
    let total: number;

    if (tagIds.length > 0) {
      const matched = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .innerJoin(
          contactTags,
          and(eq(contactTags.contactId, contacts.id), inArray(contactTags.tagId, tagIds)),
        )
        .where(whereClause)
        .groupBy(contacts.id)
        .having(sql`count(distinct ${contactTags.tagId}) = ${tagIds.length}`);

      total = matched.length;

      const pagedIds = matched
        .slice(page * pageSize, page * pageSize + pageSize)
        .map((r) => r.id);

      rows =
        pagedIds.length > 0
          ? await ctx.db
              .select()
              .from(contacts)
              .where(and(eq(contacts.accountId, ctx.accountId), inArray(contacts.id, pagedIds)))
              .orderBy(desc(contacts.createdAt))
          : [];
      // Re-sort to match pagedIds order (the IN-based query above
      // doesn't preserve it).
      const byId = new Map(rows.map((r) => [r.id, r]));
      rows = pagedIds.map((id) => byId.get(id)).filter((r): r is typeof contacts.$inferSelect => !!r);
    } else {
      const [{ value: countValue }] = await ctx.db
        .select({ value: sql<number>`count(*)::int` })
        .from(contacts)
        .where(whereClause);
      total = countValue;

      rows = await ctx.db
        .select()
        .from(contacts)
        .where(whereClause)
        .orderBy(desc(contacts.createdAt))
        .limit(pageSize)
        .offset(page * pageSize);
    }

    const contactIds = rows.map((r) => r.id);
    const tagRows =
      contactIds.length > 0
        ? await ctx.db
            .select({
              contactId: contactTags.contactId,
              tagId: tags.id,
              tagName: tags.name,
              tagColor: tags.color,
            })
            .from(contactTags)
            .innerJoin(tags, eq(tags.id, contactTags.tagId))
            .where(inArray(contactTags.contactId, contactIds))
            .orderBy(asc(tags.name))
        : [];

    const tagsByContact = new Map<string, { id: string; name: string; color: string }[]>();
    for (const row of tagRows) {
      const list = tagsByContact.get(row.contactId) ?? [];
      list.push({ id: row.tagId, name: row.tagName, color: row.tagColor });
      tagsByContact.set(row.contactId, list);
    }

    const result = rows.map((r) => ({ ...r, tags: tagsByContact.get(r.id) ?? [] }));

    return NextResponse.json({ contacts: result, total });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

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

    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    if (!phone) {
      return NextResponse.json({ error: "'phone' is required" }, { status: 400 });
    }

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const company = typeof body?.company === "string" ? body.company.trim() : "";
    const avatarUrl = typeof body?.avatarUrl === "string" ? body.avatarUrl.trim() : "";
    const tagIds = Array.isArray(body?.tagIds)
      ? body.tagIds.filter((t): t is string => typeof t === "string")
      : [];

    let created: typeof contacts.$inferSelect;
    try {
      const [row] = await ctx.db
        .insert(contacts)
        .values({
          accountId: ctx.accountId,
          userId: ctx.userId,
          phone,
          name: name || null,
          nameEditedByAgent: !!name,
          email: email || null,
          company: company || null,
          avatarUrl: avatarUrl || null,
        })
        .returning();
      created = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return NextResponse.json(
          { error: "Já existe um contato com este telefone" },
          { status: 409 },
        );
      }
      throw err;
    }

    if (tagIds.length > 0) {
      // Verify the tags belong to this account before attaching —
      // an id from another tenant must silently fail to attach, not
      // be trusted.
      const ownedTags = await ctx.db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.accountId, ctx.accountId), inArray(tags.id, tagIds)));
      if (ownedTags.length > 0) {
        await ctx.db
          .insert(contactTags)
          .values(ownedTags.map((t) => ({ contactId: created.id, tagId: t.id })))
          .onConflictDoNothing();
      }
    }

    return NextResponse.json({ contact: created }, { status: 201 });
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
