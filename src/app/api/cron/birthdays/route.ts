import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  collaboratorBirthdays,
  birthdayMonthlySummaries,
  birthdaySettings,
  contacts,
  conversations,
  messages,
  whatsappInstances,
  DEFAULT_BIRTHDAY_INDIVIDUAL_MESSAGE,
  DEFAULT_BIRTHDAY_MONTHLY_MESSAGE,
} from "@/db/schema";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendText } from "@/lib/whatsapp/uazapi-client";

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Daily birthday sweep — same external-pinger pattern as the other
 * /api/cron/* routes, requires `x-cron-secret`.
 *
 *   - Every day: sends an individual "feliz aniversário" text to any
 *     collaborator whose birth_date's month/day matches today and
 *     who hasn't already been greeted this year (last_greeted_year).
 *     Sent directly via UAZAPI, not written into the CRM inbox —
 *     collaborators aren't customers, so there's no conversation to
 *     hang the message off unless one already exists for other
 *     reasons.
 *   - On the 1st of the month: for every WhatsApp group with at
 *     least one collaborator born that month, sends a roll-up
 *     listing them all (name + day), once per group per month
 *     (birthday_monthly_summaries is the idempotency guard). This
 *     one DOES write a `messages` row (sender_type "bot") into the
 *     group's own conversation, same as the scheduled-task sends —
 *     the group is a tracked contact/conversation, so the send
 *     should show up in its history like anything else sent there.
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
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const year = now.getUTCFullYear();
  const yearMonth = `${year}-${String(month).padStart(2, "0")}`;

  const instanceCache = new Map<string, { baseUrl: string; token?: string } | null>();
  async function getInstance(accountId: string) {
    let instance = instanceCache.get(accountId);
    if (instance === undefined) {
      const [row] = await db
        .select()
        .from(whatsappInstances)
        .where(eq(whatsappInstances.accountId, accountId))
        .limit(1);
      instance =
        row && row.status === "connected"
          ? { baseUrl: row.uazapiUrl ?? "", token: row.uazapiToken ? decrypt(row.uazapiToken) : undefined }
          : null;
      instanceCache.set(accountId, instance);
    }
    return instance;
  }

  const templateCache = new Map<string, { individual: string; monthly: string }>();
  async function getTemplates(accountId: string) {
    let templates = templateCache.get(accountId);
    if (!templates) {
      const [row] = await db
        .select()
        .from(birthdaySettings)
        .where(eq(birthdaySettings.accountId, accountId))
        .limit(1);
      templates = {
        individual: row?.individualMessage ?? DEFAULT_BIRTHDAY_INDIVIDUAL_MESSAGE,
        monthly: row?.monthlyMessage ?? DEFAULT_BIRTHDAY_MONTHLY_MESSAGE,
      };
      templateCache.set(accountId, templates);
    }
    return templates;
  }

  // --- Individual "happy birthday" sends ---
  const todaysBirthdays = await db
    .select()
    .from(collaboratorBirthdays)
    .where(
      and(
        isNotNull(collaboratorBirthdays.phone),
        sql`extract(month from ${collaboratorBirthdays.birthDate}) = ${month}`,
        sql`extract(day from ${collaboratorBirthdays.birthDate}) = ${day}`,
        sql`(${collaboratorBirthdays.lastGreetedYear} is null or ${collaboratorBirthdays.lastGreetedYear} <> ${year})`,
      ),
    );

  let individualSent = 0;
  for (const person of todaysBirthdays) {
    const instance = await getInstance(person.accountId);
    if (!instance || !person.phone) continue;

    const templates = await getTemplates(person.accountId);
    const text = templates.individual.replace(/\{nome\}/g, person.name);
    const result = await sendText(instance, person.phone, text);
    if (result.ok) {
      await db
        .update(collaboratorBirthdays)
        .set({ lastGreetedYear: year, updatedAt: now })
        .where(eq(collaboratorBirthdays.id, person.id));
      individualSent++;
    }
  }

  // --- Monthly roll-up per group, only on the 1st ---
  let summariesSent = 0;
  if (day === 1) {
    const monthRows = await db
      .select()
      .from(collaboratorBirthdays)
      .where(
        and(
          isNotNull(collaboratorBirthdays.groupContactId),
          sql`extract(month from ${collaboratorBirthdays.birthDate}) = ${month}`,
        ),
      );

    const byGroup = new Map<string, typeof monthRows>();
    for (const row of monthRows) {
      if (!row.groupContactId) continue;
      const list = byGroup.get(row.groupContactId) ?? [];
      list.push(row);
      byGroup.set(row.groupContactId, list);
    }

    for (const [groupContactId, people] of byGroup) {
      const [group] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, groupContactId))
        .limit(1);
      if (!group) continue;

      const [alreadySent] = await db
        .select({ id: birthdayMonthlySummaries.id })
        .from(birthdayMonthlySummaries)
        .where(
          and(
            eq(birthdayMonthlySummaries.groupContactId, groupContactId),
            eq(birthdayMonthlySummaries.yearMonth, yearMonth),
          ),
        )
        .limit(1);
      if (alreadySent) continue;

      const instance = await getInstance(group.accountId);
      if (!instance) continue;

      const sorted = [...people].sort(
        (a, b) => new Date(a.birthDate).getUTCDate() - new Date(b.birthDate).getUTCDate(),
      );
      const lines = sorted.map(
        (p) => `🎂 ${String(new Date(p.birthDate).getUTCDate()).padStart(2, "0")}/${String(month).padStart(2, "0")} — ${p.name}`,
      );
      const templates = await getTemplates(group.accountId);
      const text = templates.monthly
        .replace(/\{mes\}/g, MONTH_NAMES[month - 1])
        .replace(/\{lista\}/g, lines.join("\n"));

      const result = await sendText(instance, group.phone, text);
      if (!result.ok) continue;

      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.contactId, groupContactId))
        .limit(1);

      if (conversation) {
        await db.insert(messages).values({
          conversationId: conversation.id,
          senderType: "bot",
          contentType: "text",
          contentText: text,
          messageId: result.data?.externalId ?? null,
          status: "sent",
        });
        await db
          .update(conversations)
          .set({ lastMessageText: text, lastMessageAt: now, updatedAt: now })
          .where(eq(conversations.id, conversation.id));
      }

      await db.insert(birthdayMonthlySummaries).values({
        accountId: group.accountId,
        groupContactId,
        yearMonth,
      });
      summariesSent++;
    }
  }

  return NextResponse.json({ individualSent, summariesSent });
}
