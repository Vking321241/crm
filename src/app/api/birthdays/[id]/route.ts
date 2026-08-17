// ============================================================
// PATCH  /api/birthdays/[id] — edit name/birthDate/phone/group.
// DELETE /api/birthdays/[id]
// Both manager+.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { collaboratorBirthdays, contacts } from "@/db/schema";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("manager");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; birthDate?: unknown; phone?: unknown; groupContactId?: unknown }
      | null;

    const update: Partial<typeof collaboratorBirthdays.$inferInsert> = {};

    if (typeof body?.name === "string" && body.name.trim()) {
      update.name = body.name.trim();
    }
    if (typeof body?.birthDate === "string") {
      if (!DATE_RE.test(body.birthDate)) {
        return NextResponse.json({ error: "Data de aniversário inválida" }, { status: 400 });
      }
      update.birthDate = body.birthDate;
    }
    if ("phone" in (body ?? {})) {
      const raw = body?.phone;
      update.phone = typeof raw === "string" && raw.trim() ? raw.replace(/\D/g, "") : null;
    }
    if ("groupContactId" in (body ?? {})) {
      const raw = body?.groupContactId;
      if (typeof raw === "string" && raw) {
        const [group] = await ctx.db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, raw), eq(contacts.accountId, ctx.accountId), eq(contacts.isGroup, true)))
          .limit(1);
        if (!group) {
          return NextResponse.json({ error: "Grupo não encontrado" }, { status: 400 });
        }
        update.groupContactId = group.id;
      } else {
        update.groupContactId = null;
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    update.updatedAt = new Date();

    const [row] = await ctx.db
      .update(collaboratorBirthdays)
      .set(update)
      .where(and(eq(collaboratorBirthdays.id, id), eq(collaboratorBirthdays.accountId, ctx.accountId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("manager");
    const { id } = await params;

    await ctx.db
      .delete(collaboratorBirthdays)
      .where(and(eq(collaboratorBirthdays.id, id), eq(collaboratorBirthdays.accountId, ctx.accountId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
