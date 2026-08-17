// ============================================================
// GET   /api/settings/birthday-messages — the two editable message
//        templates /api/cron/birthdays sends. Falls back to the
//        DEFAULT_BIRTHDAY_* constants if the account never
//        customized them (no row yet).
// PATCH /api/settings/birthday-messages — upsert either/both.
//        Manager+ (settings-class, same tier as Mensagens automáticas).
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  birthdaySettings,
  DEFAULT_BIRTHDAY_INDIVIDUAL_MESSAGE,
  DEFAULT_BIRTHDAY_MONTHLY_MESSAGE,
} from "@/db/schema";

export async function GET() {
  try {
    const ctx = await requireRole("agent");

    const [row] = await ctx.db
      .select()
      .from(birthdaySettings)
      .where(eq(birthdaySettings.accountId, ctx.accountId))
      .limit(1);

    return NextResponse.json({
      individual_message: row?.individualMessage ?? DEFAULT_BIRTHDAY_INDIVIDUAL_MESSAGE,
      monthly_message: row?.monthlyMessage ?? DEFAULT_BIRTHDAY_MONTHLY_MESSAGE,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("manager");

    const body = (await request.json().catch(() => null)) as
      | { individual_message?: unknown; monthly_message?: unknown }
      | null;

    const individualMessage =
      typeof body?.individual_message === "string" && body.individual_message.trim()
        ? body.individual_message.trim()
        : DEFAULT_BIRTHDAY_INDIVIDUAL_MESSAGE;
    const monthlyMessage =
      typeof body?.monthly_message === "string" && body.monthly_message.trim()
        ? body.monthly_message.trim()
        : DEFAULT_BIRTHDAY_MONTHLY_MESSAGE;

    if (!individualMessage.includes("{nome}")) {
      return NextResponse.json(
        { error: "A mensagem individual precisa conter {nome}" },
        { status: 400 },
      );
    }
    if (!monthlyMessage.includes("{lista}")) {
      return NextResponse.json(
        { error: "A mensagem mensal precisa conter {lista}" },
        { status: 400 },
      );
    }

    await ctx.db
      .insert(birthdaySettings)
      .values({ accountId: ctx.accountId, individualMessage, monthlyMessage })
      .onConflictDoUpdate({
        target: birthdaySettings.accountId,
        set: { individualMessage, monthlyMessage, updatedAt: new Date() },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
