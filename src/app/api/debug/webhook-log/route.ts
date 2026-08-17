// ============================================================
// GET /api/debug/webhook-log?token=... — TEMPORARY. Dumps the raw
// UAZAPI webhook bodies captured by webhook_debug_log (see
// src/app/api/whatsapp/uazapi/webhook/[instanceId]/route.ts
// captureDebugLog) as plain JSON, so field-name guesses in
// parseUazapiWebhook can be checked against a real payload.
//
// Deliberately NOT session-gated — token-in-query instead, checked
// against DEBUG_TOKEN, so this can be fetched directly (curl, no
// browser login) while debugging. Remove this route + the capture
// call + the webhook_debug_log table once the parser is confirmed
// correct against real payloads (reactions, in particular).
// ============================================================

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";

import { db } from "@/db/client";
import { webhookDebugLog } from "@/db/schema";

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
    .from(webhookDebugLog)
    .orderBy(desc(webhookDebugLog.createdAt))
    .limit(40);

  return NextResponse.json({ count: rows.length, rows });
}
