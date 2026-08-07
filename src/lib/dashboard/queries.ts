import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  broadcasts,
  contacts,
  conversations,
  deals,
  messages,
  pipelineStages,
} from "@/db/schema";
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from "./date-utils";
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from "./types";

// ------------------------------------------------------------
// Fatia 3: Drizzle instead of a Supabase client + RLS. Every query
// here MUST filter by accountId explicitly — there is no database-
// level isolation anymore. Perf is acceptable at current scale (low
// thousands of rows); revisit if a tenant's dataset outgrows this.
// ------------------------------------------------------------

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(db: Db, accountId: string): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay();
  const yesterdayStart = daysAgoStart(1);

  const [
    [openConvCur],
    [newConvToday],
    [newConvYesterday],
    [newContactsToday],
    [newContactsYesterday],
    openDealsRows,
    [messagesToday],
    [messagesYesterday],
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(eq(conversations.accountId, accountId), eq(conversations.status, "open"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountId, accountId),
          eq(conversations.status, "open"),
          gte(conversations.createdAt, todayStart),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountId, accountId),
          eq(conversations.status, "open"),
          gte(conversations.createdAt, yesterdayStart),
          lt(conversations.createdAt, todayStart),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), gte(contacts.createdAt, todayStart))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(
        and(
          eq(contacts.accountId, accountId),
          gte(contacts.createdAt, yesterdayStart),
          lt(contacts.createdAt, todayStart),
        ),
      ),
    db
      .select({ value: deals.value })
      .from(deals)
      .where(and(eq(deals.accountId, accountId), eq(deals.status, "active"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(conversations.accountId, accountId),
          eq(messages.senderType, "agent"),
          gte(messages.createdAt, todayStart),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(conversations.accountId, accountId),
          eq(messages.senderType, "agent"),
          gte(messages.createdAt, yesterdayStart),
          lt(messages.createdAt, todayStart),
        ),
      ),
  ]);

  const openDealsValue = openDealsRows.reduce((sum, d) => sum + Number(d.value ?? 0), 0);

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContactsToday: {
      current: newContactsToday.count ?? 0,
      previous: newContactsYesterday.count ?? 0,
    },
    openDealsValue,
    openDealsCount: openDealsRows.length,
    messagesSentToday: {
      current: messagesToday.count ?? 0,
      previous: messagesYesterday.count ?? 0,
    },
  };
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: Db,
  accountId: string,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1);
  const rows = await db
    .select({ createdAt: messages.createdAt, senderType: messages.senderType })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.accountId, accountId), gte(messages.createdAt, start)))
    .orderBy(messages.createdAt);

  const keys = lastNDayKeys(rangeDays);
  const buckets = new Map<string, { incoming: number; outgoing: number }>();
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 });

  for (const row of rows) {
    const key = localDayKey(row.createdAt.toISOString());
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (row.senderType === "customer") bucket.incoming += 1;
    else bucket.outgoing += 1;
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }));
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(db: Db, accountId: string): Promise<PipelineDonutData> {
  // pipeline_stages has no account_id of its own — join through
  // pipelines to scope it.
  const stages = await db
    .select({
      id: pipelineStages.id,
      name: pipelineStages.name,
      color: pipelineStages.color,
    })
    .from(pipelineStages)
    .innerJoin(
      sql`pipelines`,
      sql`pipelines.id = ${pipelineStages.pipelineId} AND pipelines.account_id = ${accountId}`,
    )
    .orderBy(pipelineStages.position);

  const dealsRows = await db
    .select({ stageId: deals.stageId, value: deals.value })
    .from(deals)
    .where(and(eq(deals.accountId, accountId), eq(deals.status, "active")));

  const byStage = new Map<string, { count: number; total: number }>();
  for (const d of dealsRows) {
    const row = byStage.get(d.stageId) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total += Number(d.value ?? 0);
    byStage.set(d.stageId, row);
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || "#64748b",
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0);

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  };
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(db: Db, accountId: string): Promise<ResponseTimeSummary> {
  const fourteenDaysAgo = daysAgoStart(13);
  const rows = await db
    .select({
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.accountId, accountId), gte(messages.createdAt, fourteenDaysAgo)))
    .orderBy(messages.conversationId, messages.createdAt);

  interface Sample {
    customerAt: Date;
    responseAt: Date;
  }
  const samples: Sample[] = [];

  let currentConv = "";
  let pendingCustomer: Date | null = null;
  for (const row of rows) {
    if (row.conversationId !== currentConv) {
      currentConv = row.conversationId;
      pendingCustomer = null;
    }
    const ts = row.createdAt;
    if (row.senderType === "customer") {
      if (!pendingCustomer) pendingCustomer = ts;
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts });
      pendingCustomer = null;
    }
  }

  const now = new Date();
  const thisWeekStart = daysAgoStart(mondayIndex(now));
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7);

  const byDow = new Map<number, number[]>();
  for (let i = 0; i < 7; i++) byDow.set(i, []);
  const thisWeekMins: number[] = [];
  const lastWeekMins: number[] = [];

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000;
    if (diffMin < 0) continue;
    const dow = mondayIndex(s.customerAt);
    byDow.get(dow)!.push(diffMin);
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin);
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin);
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const s = byDow.get(dow) ?? [];
    return { dow, avgMinutes: avg(s), samples: s.length };
  });

  void DOW_SHORT_MON_FIRST;

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  };
}

// --- 5. Activity feed ----------------------------------------------------
// Automation-log entries dropped — automations aren't part of the
// product.

export async function loadActivity(db: Db, accountId: string, limit = 20): Promise<ActivityItem[]> {
  const [msgs, contactRows, dealRows, broadcastRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        contentText: messages.contentText,
        createdAt: messages.createdAt,
        conversationId: messages.conversationId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(eq(conversations.accountId, accountId), eq(messages.senderType, "customer")))
      .orderBy(desc(messages.createdAt))
      .limit(10),
    db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, createdAt: contacts.createdAt })
      .from(contacts)
      .where(eq(contacts.accountId, accountId))
      .orderBy(desc(contacts.createdAt))
      .limit(10),
    db
      .select({
        id: deals.id,
        title: deals.title,
        updatedAt: deals.updatedAt,
        stageName: pipelineStages.name,
      })
      .from(deals)
      .leftJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(eq(deals.accountId, accountId))
      .orderBy(desc(deals.updatedAt))
      .limit(10),
    db
      .select({
        id: broadcasts.id,
        name: broadcasts.name,
        status: broadcasts.status,
        totalRecipients: broadcasts.totalRecipients,
        createdAt: broadcasts.createdAt,
      })
      .from(broadcasts)
      .where(eq(broadcasts.accountId, accountId))
      .orderBy(desc(broadcasts.createdAt))
      .limit(5),
  ]);

  const items: ActivityItem[] = [];

  for (const m of msgs) {
    const who = m.contactName || m.contactPhone || "Unknown";
    items.push({
      id: `msg-${m.id}`,
      kind: "message",
      text: `New message from ${who}`,
      at: m.createdAt.toISOString(),
      href: `/inbox?c=${m.conversationId}`,
    });
  }

  for (const c of contactRows) {
    items.push({
      id: `contact-${c.id}`,
      kind: "contact",
      text: `New contact: ${c.name || c.phone}`,
      at: c.createdAt.toISOString(),
      href: "/contacts",
    });
  }

  for (const d of dealRows) {
    items.push({
      id: `deal-${d.id}`,
      kind: "deal",
      text: d.stageName ? `Deal "${d.title}" in ${d.stageName}` : `Deal "${d.title}" updated`,
      at: d.updatedAt.toISOString(),
      href: "/pipelines",
    });
  }

  for (const b of broadcastRows) {
    const label =
      b.status === "sent"
        ? `sent to ${b.totalRecipients} contacts`
        : `${b.status} (${b.totalRecipients} recipients)`;
    items.push({
      id: `broadcast-${b.id}`,
      kind: "broadcast",
      text: `Broadcast "${b.name}" ${label}`,
      at: b.createdAt.toISOString(),
      href: "/broadcasts",
    });
  }

  return items.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0)).slice(0, limit);
}
