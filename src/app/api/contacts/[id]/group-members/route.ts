// ============================================================
// GET /api/contacts/[id]/group-members — best-effort participant
// list for a WhatsApp group contact (contacts.is_group). Agent+.
//
// Returns 404 if the contact isn't a group, 200 with an empty list
// if UAZAPI's response can't be parsed or the instance isn't
// connected — the panel that consumes this just hides itself
// rather than surfacing an error for something this best-effort.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contacts, whatsappInstances } from "@/db/schema";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getGroupInfo } from "@/lib/whatsapp/uazapi-client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const [contact] = await ctx.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.accountId, ctx.accountId)))
      .limit(1);

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    if (!contact.isGroup) {
      return NextResponse.json({ error: "Contact is not a group" }, { status: 400 });
    }

    const [instance] = await ctx.db
      .select()
      .from(whatsappInstances)
      .where(eq(whatsappInstances.accountId, ctx.accountId))
      .limit(1);

    if (!instance || instance.status !== "connected" || !instance.uazapiToken) {
      return NextResponse.json({ participants: [] });
    }

    const result = await getGroupInfo(
      { baseUrl: instance.uazapiUrl ?? "", token: decrypt(instance.uazapiToken) },
      contact.phone,
    );

    if (!result.ok || !result.data) {
      return NextResponse.json({ participants: [] });
    }

    return NextResponse.json({ participants: result.data.participants });
  } catch (err) {
    return toErrorResponse(err);
  }
}
