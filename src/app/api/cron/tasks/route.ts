import { NextResponse } from "next/server";
import { and, eq, lte } from "drizzle-orm";

import { db } from "@/db/client";
import {
  conversationTasks,
  conversations,
  contacts,
  messages,
  whatsappInstances,
} from "@/db/schema";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendText } from "@/lib/whatsapp/uazapi-client";

/**
 * Scheduled-message sweep. Same external-pinger pattern as
 * /api/cron/business-hours — requires `x-cron-secret` to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * For every pending task with `send_as_message = true` whose
 * `due_at` has passed: sends `note` as a plain WhatsApp text to the
 * conversation's contact, writes a `messages` row (sender_type
 * "bot", so the inbox can tell it apart from a live agent reply),
 * and marks the task "done" — same bucket a human completing a
 * plain reminder lands in.
 *
 * On send failure the task is left "pending" so the next sweep
 * retries it — no separate "failed" state to manage; a broken
 * WhatsApp instance self-heals once reconnected and the backlog
 * drains on its own.
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

  const now = new Date();

  const due = await db
    .select({
      task: conversationTasks,
      conversationId: conversations.id,
      contactPhone: contacts.phone,
    })
    .from(conversationTasks)
    .innerJoin(conversations, eq(conversationTasks.conversationId, conversations.id))
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(conversationTasks.status, "pending"),
        eq(conversationTasks.sendAsMessage, true),
        lte(conversationTasks.dueAt, now),
      ),
    );

  let sent = 0;
  let failed = 0;
  const instanceCache = new Map<string, { baseUrl: string; token?: string } | null>();

  for (const { task, contactPhone } of due) {
    let instance = instanceCache.get(task.accountId);
    if (instance === undefined) {
      const [row] = await db
        .select()
        .from(whatsappInstances)
        .where(eq(whatsappInstances.accountId, task.accountId))
        .limit(1);
      instance =
        row && row.status === "connected"
          ? { baseUrl: row.uazapiUrl ?? "", token: row.uazapiToken ? decrypt(row.uazapiToken) : undefined }
          : null;
      instanceCache.set(task.accountId, instance);
    }

    if (!instance) {
      failed++;
      continue;
    }

    const result = await sendText(instance, contactPhone, task.note);

    if (!result.ok) {
      failed++;
      continue;
    }

    await db.insert(messages).values({
      conversationId: task.conversationId,
      senderType: "bot",
      contentType: "text",
      contentText: task.note,
      messageId: result.data?.externalId ?? null,
      status: "sent",
    });

    await db
      .update(conversations)
      .set({ lastMessageText: task.note, lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, task.conversationId));

    await db
      .update(conversationTasks)
      .set({ status: "done", completedAt: now, updatedAt: now })
      .where(eq(conversationTasks.id, task.id));

    sent++;
  }

  return NextResponse.json({ checked: due.length, sent, failed });
}
