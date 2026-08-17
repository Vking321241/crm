// ============================================================
// DivaryTalk's 4 Kiwify subscription plans — seat tier, checkout
// link, and pricing. Single source of truth for both the
// subscription page and (loosely) the webhook's plan-matching.
// ============================================================

export interface KiwifyPlan {
  /** Seat tier key — also what accounts.subscription_plan stores. */
  key: "3" | "5" | "7" | "10";
  seats: number;
  checkoutUrl: string;
  priceLabel: string;
  firstMonthLabel: string;
}

export const KIWIFY_PLANS: readonly KiwifyPlan[] = [
  {
    key: "3",
    seats: 3,
    checkoutUrl: "https://pay.kiwify.com.br/HhHp5uI",
    priceLabel: "R$ 129,90/mês",
    firstMonthLabel: "R$ 99,90 no primeiro mês",
  },
  {
    key: "5",
    seats: 5,
    checkoutUrl: "https://pay.kiwify.com.br/H94BFI6",
    priceLabel: "R$ 189,90/mês",
    firstMonthLabel: "R$ 159,90 no primeiro mês",
  },
  {
    key: "7",
    seats: 7,
    checkoutUrl: "https://pay.kiwify.com.br/cM27DiM",
    priceLabel: "R$ 249,90/mês",
    firstMonthLabel: "R$ 219,00 no primeiro mês",
  },
  {
    key: "10",
    seats: 10,
    checkoutUrl: "https://pay.kiwify.com.br/j8p83mS",
    priceLabel: "R$ 299,00/mês",
    firstMonthLabel: "R$ 279,90 no primeiro mês",
  },
] as const;

/** Best-effort match from a Kiwify webhook's product name/seat count
 *  back to one of our 4 plan keys — tries an exact seat-count phrase
 *  first, then falls back to matching the checkout link if Kiwify's
 *  payload happens to include it. Returns null if nothing matches;
 *  callers should log the raw payload for you to inspect rather than
 *  guess wrong. */
export function matchPlanFromText(text: string): KiwifyPlan | null {
  const normalized = text.toLowerCase();
  for (const plan of KIWIFY_PLANS) {
    if (normalized.includes(plan.checkoutUrl.toLowerCase())) return plan;
    if (new RegExp(`\\b${plan.seats}\\b`).test(normalized)) return plan;
  }
  return null;
}
