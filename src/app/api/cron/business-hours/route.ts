import { NextResponse } from "next/server";
import { and, eq, isNull, isNotNull } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, autoReplySettings, conversations, DEFAULT_BUSINESS_HOURS } from "@/db/schema";
import { isWithinBusinessHours, type BusinessHours } from "@/lib/auto-reply/auto-reply-rules";

/**
 * Business-hours auto-pause sweep. Meant to be hit on a schedule
 * (same external-pinger pattern as /api/automations/cron) — requires
 * `x-cron-secret` to match `AUTOMATION_CRON_SECRET`.
 *
 * For every account with `auto_pause_outside_business_hours` on:
 *   - Outside hours right now → pause every open conversation that
 *     isn't already paused (pause_reason = 'business_hours').
 *   - Inside hours right now → un-pause every conversation this same
 *     sweep paused, and flag it for re-acknowledgment if it has an
 *     assignee (AcknowledgmentModal, reason "resumed").
 *
 * Manually-paused conversations (pause_reason = 'manual') are never
 * touched here — only a human un-pauses those.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret");
  if (supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settingsRows = await db
    .select({
      accountId: autoReplySettings.accountId,
      businessHours: autoReplySettings.businessHours,
      autoPause: autoReplySettings.autoPauseOutsideBusinessHours,
    })
    .from(autoReplySettings)
    .where(eq(autoReplySettings.autoPauseOutsideBusinessHours, true));

  const now = new Date();
  let paused = 0;
  let resumed = 0;

  for (const row of settingsRows) {
    // Skip accounts that were deleted but left a dangling settings row.
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, row.accountId))
      .limit(1);
    if (!account) continue;

    const hours = (row.businessHours as BusinessHours) ?? (DEFAULT_BUSINESS_HOURS as BusinessHours);
    const open = isWithinBusinessHours(hours, now);

    if (!open) {
      const result = await db
        .update(conversations)
        .set({ pausedAt: now, pauseReason: "business_hours", updatedAt: now })
        .where(
          and(
            eq(conversations.accountId, row.accountId),
            eq(conversations.status, "open"),
            isNull(conversations.pausedAt),
          ),
        )
        .returning({ id: conversations.id });
      paused += result.length;
    } else {
      const result = await db
        .update(conversations)
        .set({
          pausedAt: null,
          pauseReason: null,
          needsAcknowledgment: true,
          acknowledgmentReason: "resumed",
          updatedAt: now,
        })
        .where(
          and(
            eq(conversations.accountId, row.accountId),
            eq(conversations.pauseReason, "business_hours"),
            isNotNull(conversations.pausedAt),
          ),
        )
        .returning({ id: conversations.id, assignedAgentId: conversations.assignedAgentId });
      resumed += result.length;
    }
  }

  return NextResponse.json({ accountsChecked: settingsRows.length, paused, resumed });
}
