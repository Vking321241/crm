// ============================================================
// POST /api/kiwify/webhook — receives Kiwify order/subscription
// events and updates the matching account's subscription state.
//
// ⚠️ Field names below are a best-effort reading of Kiwify's public
// webhook format, NOT verified against a live payload from this
// account's Kiwify dashboard. Send a test webhook from Kiwify
// (Configurações → Webhooks → Testar) and check this route's logs —
// if the parsed values come out wrong, the raw body is logged so the
// `pick()` paths here can be corrected without guessing twice.
//
// Verification: Kiwify signs webhooks with an HMAC in a `signature`
// query param. Set KIWIFY_WEBHOOK_SECRET to enable verification —
// without it, the webhook still runs (so it works before you wire
// the secret up) but logs a warning, since an unverified webhook is
// a spoofable way to grant/revoke subscription access.
//
// Account matching: by the buyer's e-mail against `users.email`
// where they're the account owner. There's no reliable
// order→account id we control passed through Kiwify's checkout
// links, so email is the join key — the account owner should
// subscribe using the same e-mail they log into DivaryTalk with.
// ============================================================

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { matchPlanFromText } from "@/lib/kiwify/plans";

function pick(obj: unknown, ...paths: string[]): string | undefined {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      if (!cur || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === "string" && cur.length > 0) return cur;
  }
  return undefined;
}

const ACTIVE_STATUSES = new Set(["paid", "approved", "order_approved", "active", "renewed"]);
const CANCELED_STATUSES = new Set([
  "refunded",
  "refused",
  "chargedback",
  "chargeback",
  "canceled",
  "cancelled",
  "subscription_canceled",
  "subscription_cancelled",
  "expired",
]);
const PAST_DUE_STATUSES = new Set(["late", "subscription_late", "past_due", "overdue"]);

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const signature = searchParams.get("signature");
  const rawBody = await request.text();

  const secret = process.env.KIWIFY_WEBHOOK_SECRET;
  if (secret) {
    const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
    if (!signature || signature !== expected) {
      console.error("[kiwify webhook] signature mismatch — rejecting");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    console.warn("[kiwify webhook] KIWIFY_WEBHOOK_SECRET not set — accepting unverified webhook");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = pick(
    body,
    "Customer.email",
    "customer.email",
    "buyer.email",
    "customer_email",
    "email",
  )?.toLowerCase();
  const rawStatus = (
    pick(body, "order_status", "webhook_event_type", "status", "event") ?? ""
  ).toLowerCase();
  const productText = [
    pick(body, "Product.product_name", "product.name", "product_name"),
    pick(body, "Subscription.plan.name", "subscription.plan_name"),
    pick(body, "checkout_link", "checkout_url"),
  ]
    .filter(Boolean)
    .join(" ");
  // Needed to call Kiwify's Subscriptions API for in-app cancellation
  // later (see src/lib/kiwify/api-client.ts) — not verified against a
  // live payload yet, same caveat as the rest of this file's field
  // guesses.
  const subscriptionId = pick(body, "Subscription.id", "subscription.id", "subscription_id");

  if (!email) {
    console.error("[kiwify webhook] no customer email found in payload:", rawBody.slice(0, 2000));
    return NextResponse.json({ ok: true, note: "no email — ignored" });
  }

  const [owner] = await db
    .select({ accountId: users.accountId })
    .from(users)
    .where(and(eq(users.email, email), eq(users.accountRole, "owner")))
    .limit(1);

  if (!owner) {
    console.error(`[kiwify webhook] no account owner found for email ${email}`);
    return NextResponse.json({ ok: true, note: "no matching account — ignored" });
  }

  const plan = matchPlanFromText(productText || rawBody);

  const update: Partial<typeof accounts.$inferInsert> = {
    kiwifyCustomerEmail: email,
    updatedAt: new Date(),
  };
  if (subscriptionId) update.kiwifySubscriptionId = subscriptionId;

  if (ACTIVE_STATUSES.has(rawStatus)) {
    update.subscriptionStatus = "active";
    update.subscriptionCanceledAt = null;
    if (plan) {
      update.subscriptionPlan = plan.key;
      update.maxAgentSeats = plan.seats;
    }
    const renewsRaw = pick(body, "Subscription.next_payment", "subscription.next_payment_date");
    if (renewsRaw) {
      const d = new Date(renewsRaw);
      if (!Number.isNaN(d.getTime())) update.subscriptionRenewsAt = d;
    }
  } else if (CANCELED_STATUSES.has(rawStatus)) {
    update.subscriptionStatus = "canceled";
    update.subscriptionCanceledAt = new Date();
  } else if (PAST_DUE_STATUSES.has(rawStatus)) {
    update.subscriptionStatus = "past_due";
  } else {
    console.warn(`[kiwify webhook] unrecognized status "${rawStatus}" — no state change applied`);
  }

  await db.update(accounts).set(update).where(eq(accounts.id, owner.accountId));

  return NextResponse.json({ ok: true });
}
