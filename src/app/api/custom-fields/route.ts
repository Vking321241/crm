// ============================================================
// GET  /api/custom-fields — list, any account member.
// POST /api/custom-fields — create. Manager+ (settings-class).
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { customFields } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await ctx.db
      .select()
      .from(customFields)
      .where(eq(customFields.accountId, ctx.accountId))
      .orderBy(asc(customFields.fieldName));

    return NextResponse.json({ customFields: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("manager");

    const limit = checkRateLimit(`admin:customFieldCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { fieldName?: unknown; fieldType?: unknown; fieldOptions?: unknown }
      | null;
    const fieldName = typeof body?.fieldName === "string" ? body.fieldName.trim() : "";
    if (!fieldName) {
      return NextResponse.json({ error: "'fieldName' is required" }, { status: 400 });
    }
    const fieldType = typeof body?.fieldType === "string" && body.fieldType.trim()
      ? body.fieldType.trim()
      : "text";

    // Case-insensitive name clash within the account.
    const existing = await ctx.db
      .select({ id: customFields.id, fieldName: customFields.fieldName })
      .from(customFields)
      .where(eq(customFields.accountId, ctx.accountId));
    if (existing.some((f) => f.fieldName.toLowerCase() === fieldName.toLowerCase())) {
      return NextResponse.json(
        { error: `A custom field named "${fieldName}" already exists` },
        { status: 409 },
      );
    }

    const [field] = await ctx.db
      .insert(customFields)
      .values({
        accountId: ctx.accountId,
        userId: ctx.userId,
        fieldName,
        fieldType,
        fieldOptions:
          body?.fieldOptions && typeof body.fieldOptions === "object" ? body.fieldOptions : null,
      })
      .returning();

    return NextResponse.json({ customField: field }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
