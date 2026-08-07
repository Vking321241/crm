import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requirePlatformOwner, toErrorResponse } from "@/lib/auth/account";
import { accounts } from "@/db/schema";

// PATCH /api/admin/clients/[accountId] — platform-owner-only edit of
// a client's name and/or seat quota. The invitations route
// (src/app/api/account/invitations) is the enforcement point that
// reads maxAgentSeats back; this route is the only writer.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformOwner();
    const { accountId } = await params;

    const body = (await request.json().catch(() => null)) as {
      name?: string;
      maxAgentSeats?: number;
    } | null;

    const updates: Partial<typeof accounts.$inferInsert> = {};

    if (body?.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "O nome não pode ficar vazio" }, { status: 400 });
      }
      updates.name = name;
    }

    if (body?.maxAgentSeats !== undefined) {
      if (typeof body.maxAgentSeats !== "number" || body.maxAgentSeats < 1) {
        return NextResponse.json(
          { error: "maxAgentSeats deve ser um número maior ou igual a 1" },
          { status: 400 },
        );
      }
      updates.maxAgentSeats = Math.floor(body.maxAgentSeats);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
    }

    updates.updatedAt = new Date();

    const [updated] = await ctx.db
      .update(accounts)
      .set(updates)
      .where(and(eq(accounts.id, accountId), eq(accounts.isPlatform, false)))
      .returning({ id: accounts.id });

    if (!updated) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/admin/clients/[accountId] — platform-owner-only. Removes
// the client's account row; every dependent table (users, contacts,
// conversations, messages, pipelines, broadcasts, the whatsapp
// instance, …) cascades via ON DELETE CASCADE in src/db/schema.ts, so
// this single delete is enough to fully remove a client's data.
// Irreversible — the confirm step lives client-side (DeleteClientButton).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformOwner();
    const { accountId } = await params;

    const [deleted] = await ctx.db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.isPlatform, false)))
      .returning({ id: accounts.id });

    if (!deleted) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
