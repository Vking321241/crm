// ============================================================
// GET /api/debug/tasks?token=... — TEMPORARY. Dumps every
// conversation_tasks row raw, to diagnose why a "send as message"
// task isn't firing (see /api/cron/tasks). Same token-gate pattern
// as /api/debug/webhook-log. Remove once confirmed working.
// ============================================================

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";

import { db } from "@/db/client";
import { conversationTasks } from "@/db/schema";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = process.env.DEBUG_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "DEBUG_TOKEN not configured" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  if (!tokenMatches(token, expected)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(conversationTasks)
    .orderBy(desc(conversationTasks.createdAt))
    .limit(40);

  return NextResponse.json({ now: new Date().toISOString(), count: rows.length, rows });
}
