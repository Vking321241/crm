import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { loadTagInteractionStats } from "@/lib/dashboard/queries";

// GET /api/stats/tags?month=YYYY-MM — distinct-contact interaction
// count per product tag for the given month (defaults to the
// current month). Backs the "Interação por etiqueta" chart on the
// Estatísticas page.
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const monthParam = new URL(request.url).searchParams.get("month");

    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      year = y;
      month = m - 1;
    }

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 1);

    const stats = await loadTagInteractionStats(ctx.db, ctx.accountId, monthStart, monthEnd);

    return NextResponse.json({ month: `${year}-${String(month + 1).padStart(2, "0")}`, stats });
  } catch (err) {
    return toErrorResponse(err);
  }
}
