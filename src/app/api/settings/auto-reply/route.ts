// ============================================================
// GET  /api/settings/auto-reply — this account's rule-based
//      auto-reply configuration (welcome / after-hours / away).
//      Creates the default row on first read, so every account has
//      one without needing a migration-time backfill.
// PUT  /api/settings/auto-reply — update it (admin+).
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { Db } from "@/db/client";
import { autoReplySettings, DEFAULT_BUSINESS_HOURS } from "@/db/schema";
import type { BusinessHours } from "@/lib/auto-reply/auto-reply-rules";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidBusinessHours(value: unknown): value is BusinessHours {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return DAY_KEYS.every((day) => {
    const d = v[day] as Record<string, unknown> | undefined;
    if (
      !d ||
      typeof d.enabled !== "boolean" ||
      typeof d.start !== "string" ||
      typeof d.end !== "string" ||
      !TIME_RE.test(d.start) ||
      !TIME_RE.test(d.end)
    ) {
      return false;
    }
    // Lunch-break fields are optional, but if either is present both
    // must be valid "HH:mm" strings.
    if (d.breakStart !== undefined || d.breakEnd !== undefined) {
      if (typeof d.breakStart !== "string" || !TIME_RE.test(d.breakStart)) return false;
      if (typeof d.breakEnd !== "string" || !TIME_RE.test(d.breakEnd)) return false;
    }
    return true;
  });
}

async function loadOrCreate(db: Db, accountId: string) {
  const [existing] = await db
    .select()
    .from(autoReplySettings)
    .where(eq(autoReplySettings.accountId, accountId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(autoReplySettings)
    .values({ accountId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [row] = await db
    .select()
    .from(autoReplySettings)
    .where(eq(autoReplySettings.accountId, accountId))
    .limit(1);
  return row;
}

export async function GET() {
  try {
    const ctx = await requireRole("agent");
    const row = await loadOrCreate(ctx.db, ctx.accountId);
    return NextResponse.json({
      welcome_enabled: row.welcomeEnabled,
      welcome_message: row.welcomeMessage,
      after_hours_enabled: row.afterHoursEnabled,
      after_hours_message: row.afterHoursMessage,
      business_hours: row.businessHours ?? DEFAULT_BUSINESS_HOURS,
      away_enabled: row.awayEnabled,
      away_message: row.awayMessage,
      auto_pause_outside_business_hours: row.autoPauseOutsideBusinessHours,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface Body {
  welcome_enabled?: boolean;
  welcome_message?: string;
  after_hours_enabled?: boolean;
  after_hours_message?: string;
  business_hours?: unknown;
  away_enabled?: boolean;
  away_message?: string;
  auto_pause_outside_business_hours?: boolean;
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("manager");
    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    if (body.business_hours !== undefined && !isValidBusinessHours(body.business_hours)) {
      return NextResponse.json({ error: "Invalid business_hours" }, { status: 400 });
    }
    if (body.welcome_message !== undefined && !body.welcome_message.trim()) {
      return NextResponse.json({ error: "welcome_message can't be empty" }, { status: 400 });
    }
    if (body.after_hours_message !== undefined && !body.after_hours_message.trim()) {
      return NextResponse.json({ error: "after_hours_message can't be empty" }, { status: 400 });
    }
    if (body.away_message !== undefined && !body.away_message.trim()) {
      return NextResponse.json({ error: "away_message can't be empty" }, { status: 400 });
    }

    await loadOrCreate(ctx.db, ctx.accountId);

    const [updated] = await ctx.db
      .update(autoReplySettings)
      .set({
        ...(body.welcome_enabled !== undefined ? { welcomeEnabled: body.welcome_enabled } : {}),
        ...(body.welcome_message !== undefined ? { welcomeMessage: body.welcome_message.trim() } : {}),
        ...(body.after_hours_enabled !== undefined ? { afterHoursEnabled: body.after_hours_enabled } : {}),
        ...(body.after_hours_message !== undefined
          ? { afterHoursMessage: body.after_hours_message.trim() }
          : {}),
        ...(body.business_hours !== undefined ? { businessHours: body.business_hours } : {}),
        ...(body.away_enabled !== undefined ? { awayEnabled: body.away_enabled } : {}),
        ...(body.away_message !== undefined ? { awayMessage: body.away_message.trim() } : {}),
        ...(body.auto_pause_outside_business_hours !== undefined
          ? { autoPauseOutsideBusinessHours: body.auto_pause_outside_business_hours }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(autoReplySettings.accountId, ctx.accountId))
      .returning();

    return NextResponse.json({
      welcome_enabled: updated.welcomeEnabled,
      welcome_message: updated.welcomeMessage,
      after_hours_enabled: updated.afterHoursEnabled,
      after_hours_message: updated.afterHoursMessage,
      business_hours: updated.businessHours,
      away_enabled: updated.awayEnabled,
      away_message: updated.awayMessage,
      auto_pause_outside_business_hours: updated.autoPauseOutsideBusinessHours,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
