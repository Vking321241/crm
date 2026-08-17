// ============================================================
// POST /api/account/subscription/cancel — owner-only. Cancels the
// account's Kiwify subscription via the API (src/lib/kiwify/api-client),
// then reflects that locally right away rather than waiting for the
// async webhook confirmation, so the UI updates instantly. The
// webhook (src/app/api/kiwify/webhook) still runs when Kiwify fires
// its own cancellation event and just re-applies the same state.
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { accounts } from "@/db/schema";
import { cancelKiwifySubscription, KiwifyApiError } from "@/lib/kiwify/api-client";

export async function POST() {
  try {
    const ctx = await requireRole("owner");

    const [row] = await ctx.db
      .select({ kiwifySubscriptionId: accounts.kiwifySubscriptionId, status: accounts.subscriptionStatus })
      .from(accounts)
      .where(eq(accounts.id, ctx.accountId))
      .limit(1);

    if (!row?.kiwifySubscriptionId) {
      return NextResponse.json(
        {
          error:
            "Não encontramos o identificador da sua assinatura na Kiwify. Fale com o suporte para cancelar manualmente.",
        },
        { status: 409 },
      );
    }

    if (row.status !== "active" && row.status !== "past_due") {
      return NextResponse.json({ error: "Não há assinatura ativa para cancelar." }, { status: 409 });
    }

    await cancelKiwifySubscription(row.kiwifySubscriptionId);

    await ctx.db
      .update(accounts)
      .set({ subscriptionStatus: "canceled", subscriptionCanceledAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, ctx.accountId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof KiwifyApiError) {
      return NextResponse.json(
        { error: "Não foi possível cancelar com a Kiwify agora. Tente novamente em instantes." },
        { status: 502 },
      );
    }
    return toErrorResponse(err);
  }
}
