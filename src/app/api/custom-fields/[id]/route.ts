// ============================================================
// PATCH  /api/custom-fields/[id] — rename / retype. Admin+.
// DELETE /api/custom-fields/[id]. Admin+.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { customFields } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const limit = checkRateLimit(`admin:customFieldUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { fieldName?: unknown; fieldType?: unknown; fieldOptions?: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const update: Partial<typeof customFields.$inferInsert> = {};
    if (typeof body.fieldName === "string") {
      const fieldName = body.fieldName.trim();
      if (!fieldName) {
        return NextResponse.json({ error: "'fieldName' cannot be empty" }, { status: 400 });
      }
      const clash = await ctx.db
        .select({ id: customFields.id, fieldName: customFields.fieldName })
        .from(customFields)
        .where(and(eq(customFields.accountId, ctx.accountId), ne(customFields.id, id)));
      if (clash.some((f) => f.fieldName.toLowerCase() === fieldName.toLowerCase())) {
        return NextResponse.json(
          { error: `A custom field named "${fieldName}" already exists` },
          { status: 409 },
        );
      }
      update.fieldName = fieldName;
    }
    if (typeof body.fieldType === "string" && body.fieldType.trim()) {
      update.fieldType = body.fieldType.trim();
    }
    if ("fieldOptions" in body) {
      update.fieldOptions =
        body.fieldOptions && typeof body.fieldOptions === "object" ? body.fieldOptions : null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: true });
    }

    const [field] = await ctx.db
      .update(customFields)
      .set(update)
      .where(and(eq(customFields.id, id), eq(customFields.accountId, ctx.accountId)))
      .returning();

    if (!field) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
    }

    return NextResponse.json({ customField: field });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const limit = checkRateLimit(`admin:customFieldDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const result = await ctx.db
      .delete(customFields)
      .where(and(eq(customFields.id, id), eq(customFields.accountId, ctx.accountId)))
      .returning({ id: customFields.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
