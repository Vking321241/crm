// ============================================================
// GET  /api/tags — list, any account member (agent+... actually
//      any authenticated member, including viewers — read access
//      is unrestricted per AGENTS.md: "qualquer membro para
//      leitura").
// POST /api/tags — create. Admin+ (settings-class).
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { tags } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await ctx.db
      .select()
      .from(tags)
      .where(eq(tags.accountId, ctx.accountId))
      .orderBy(asc(tags.name));

    return NextResponse.json({ tags: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:tagCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; color?: unknown }
      | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }
    const color = typeof body?.color === "string" && HEX_COLOR.test(body.color)
      ? body.color
      : "#3b82f6";

    const [tag] = await ctx.db
      .insert(tags)
      .values({ accountId: ctx.accountId, userId: ctx.userId, name, color })
      .returning();

    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
