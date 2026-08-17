// ============================================================
// GET /api/conversations/transfers — audit trail of every agent/
// department hand-off, for the "quem transferiu pra quem e quantas
// vezes" report. Gated to the "reports" permission module (owner/
// admin always pass) — a plain atendente never sees this, only a
// manager (granted reports) or the account owner.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { requireModule, toErrorResponse } from "@/lib/auth/account";
import { conversationTransfers, contacts, conversations, departments, users } from "@/db/schema";

export async function GET(request: Request) {
  try {
    const ctx = await requireModule("reports");
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);

    const rows = await ctx.db
      .select({
        transfer: conversationTransfers,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(conversationTransfers)
      .innerJoin(conversations, eq(conversationTransfers.conversationId, conversations.id))
      .innerJoin(contacts, and(eq(conversations.contactId, contacts.id), eq(contacts.isGroup, false)))
      .where(eq(conversationTransfers.accountId, ctx.accountId))
      .orderBy(desc(conversationTransfers.createdAt))
      .limit(limit);

    const userIds = new Set<string>();
    const deptIds = new Set<string>();
    for (const { transfer } of rows) {
      for (const id of [transfer.fromAgentId, transfer.toAgentId, transfer.transferredBy]) {
        if (id) userIds.add(id);
      }
      for (const id of [transfer.fromDepartmentId, transfer.toDepartmentId]) {
        if (id) deptIds.add(id);
      }
    }

    const [userRows, deptRows] = await Promise.all([
      userIds.size
        ? ctx.db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .where(inArray(users.id, Array.from(userIds)))
        : [],
      deptIds.size
        ? ctx.db
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(inArray(departments.id, Array.from(deptIds)))
        : [],
    ]);
    const nameByUser = new Map(userRows.map((u) => [u.id, u.fullName]));
    const nameByDept = new Map(deptRows.map((d) => [d.id, d.name]));

    const transfers = rows.map(({ transfer, contactName, contactPhone }) => ({
      id: transfer.id,
      conversation_id: transfer.conversationId,
      contact_name: contactName || contactPhone,
      from_agent: transfer.fromAgentId
        ? { id: transfer.fromAgentId, name: nameByUser.get(transfer.fromAgentId) ?? "—" }
        : null,
      to_agent: transfer.toAgentId
        ? { id: transfer.toAgentId, name: nameByUser.get(transfer.toAgentId) ?? "—" }
        : null,
      from_department: transfer.fromDepartmentId
        ? { id: transfer.fromDepartmentId, name: nameByDept.get(transfer.fromDepartmentId) ?? "—" }
        : null,
      to_department: transfer.toDepartmentId
        ? { id: transfer.toDepartmentId, name: nameByDept.get(transfer.toDepartmentId) ?? "—" }
        : null,
      transferred_by: transfer.transferredBy
        ? { id: transfer.transferredBy, name: nameByUser.get(transfer.transferredBy) ?? "—" }
        : null,
      created_at: transfer.createdAt,
    }));

    // Per-pair counts (who hands off to whom, and how often) — the
    // "quantas vezes" half of the client's ask.
    const pairCounts = new Map<string, { from: string; to: string; count: number }>();
    for (const t of transfers) {
      if (!t.to_agent) continue;
      const fromLabel = t.from_agent?.name ?? "Fila";
      const key = `${fromLabel}→${t.to_agent.name}`;
      const entry = pairCounts.get(key) ?? { from: fromLabel, to: t.to_agent.name, count: 0 };
      entry.count += 1;
      pairCounts.set(key, entry);
    }

    return NextResponse.json({
      transfers,
      summary: Array.from(pairCounts.values()).sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
