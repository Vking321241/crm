// ============================================================
// GET /api/contacts/groups — every WhatsApp group contact
// (contacts.is_group), name + id only. Backs group pickers (e.g.
// Configurações → Aniversários) that must show the group's display
// name, never its raw chat id. Agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contacts } from "@/db/schema";

export async function GET() {
  try {
    const ctx = await requireRole("agent");

    const rows = await ctx.db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.accountId, ctx.accountId), eq(contacts.isGroup, true)))
      .orderBy(asc(contacts.name));

    return NextResponse.json({
      groups: rows.map((r) => ({ id: r.id, name: r.name || "Grupo sem nome" })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
