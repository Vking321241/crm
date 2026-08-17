// ============================================================
// GET  /api/birthdays — list every collaborator, newest first, with
//      the assigned group's display name joined in.
// POST /api/birthdays — create one. Manager+ (settings-class, same
//      tier as Departamentos/Etiquetas).
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { collaboratorBirthdays, contacts } from "@/db/schema";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toApi(row: typeof collaboratorBirthdays.$inferSelect, groupName: string | null) {
  return {
    id: row.id,
    name: row.name,
    birth_date: row.birthDate,
    phone: row.phone ?? undefined,
    group_contact_id: row.groupContactId ?? undefined,
    group_name: groupName ?? undefined,
    created_at: row.createdAt,
  };
}

export async function GET() {
  try {
    const ctx = await requireRole("manager");

    const rows = await ctx.db
      .select({ birthday: collaboratorBirthdays, groupName: contacts.name })
      .from(collaboratorBirthdays)
      .leftJoin(contacts, eq(contacts.id, collaboratorBirthdays.groupContactId))
      .where(eq(collaboratorBirthdays.accountId, ctx.accountId))
      .orderBy(asc(collaboratorBirthdays.name));

    return NextResponse.json({
      birthdays: rows.map((r) => toApi(r.birthday, r.groupName)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("manager");

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; birthDate?: unknown; phone?: unknown; groupContactId?: unknown }
      | null;

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Informe o nome" }, { status: 400 });
    }

    const birthDate = typeof body?.birthDate === "string" ? body.birthDate : "";
    if (!DATE_RE.test(birthDate)) {
      return NextResponse.json({ error: "Data de aniversário inválida" }, { status: 400 });
    }

    const phone =
      typeof body?.phone === "string" && body.phone.trim() ? body.phone.replace(/\D/g, "") : null;

    let groupContactId: string | null = null;
    if (typeof body?.groupContactId === "string" && body.groupContactId) {
      const [group] = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.id, body.groupContactId),
            eq(contacts.accountId, ctx.accountId),
            eq(contacts.isGroup, true),
          ),
        )
        .limit(1);
      if (!group) {
        return NextResponse.json({ error: "Grupo não encontrado" }, { status: 400 });
      }
      groupContactId = group.id;
    }

    const [created] = await ctx.db
      .insert(collaboratorBirthdays)
      .values({ accountId: ctx.accountId, name, birthDate, phone, groupContactId })
      .returning();

    return NextResponse.json({ birthday: toApi(created, null) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
