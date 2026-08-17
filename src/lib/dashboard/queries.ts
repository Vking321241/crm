import { and, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  broadcasts,
  contactTags,
  contacts,
  conversations,
  csatResponses,
  departments,
  messages,
  tags,
  users,
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
  AdvancedAnalytics,
  AgentStat,
  ContactsGrowthPoint,
  ConversationsSeriesPoint,
  ConversationStatusBreakdown,
  DepartmentSlice,
  HeatmapCell,
  MetricsBundle,
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
    [messagesToday],
    [messagesYesterday],
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
      .where(and(eq(conversations.accountId, accountId), eq(conversations.status, "open"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
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
      .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
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
      .where(
        and(
          eq(contacts.accountId, accountId),
          eq(contacts.isGroup, false),
          gte(contacts.createdAt, todayStart),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(
        and(
          eq(contacts.accountId, accountId),
          eq(contacts.isGroup, false),
          gte(contacts.createdAt, yesterdayStart),
          lt(contacts.createdAt, todayStart),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
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
      .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
      .where(
        and(
          eq(conversations.accountId, accountId),
          eq(messages.senderType, "agent"),
          gte(messages.createdAt, yesterdayStart),
          lt(messages.createdAt, todayStart),
        ),
      ),
  ]);

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContactsToday: {
      current: newContactsToday.count ?? 0,
      previous: newContactsYesterday.count ?? 0,
    },
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
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
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
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
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
  const [msgs, contactRows, broadcastRows] = await Promise.all([
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
      .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
      .where(and(eq(conversations.accountId, accountId), eq(messages.senderType, "customer")))
      .orderBy(desc(messages.createdAt))
      .limit(10),
    db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, createdAt: contacts.createdAt })
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), eq(contacts.isGroup, false)))
      .orderBy(desc(contacts.createdAt))
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
    const who = m.contactName || m.contactPhone || "Desconhecido";
    items.push({
      id: `msg-${m.id}`,
      kind: "message",
      text: `Nova mensagem de ${who}`,
      at: m.createdAt.toISOString(),
      href: `/inbox?c=${m.conversationId}`,
    });
  }

  for (const c of contactRows) {
    items.push({
      id: `contact-${c.id}`,
      kind: "contact",
      text: `Novo contato: ${c.name || c.phone}`,
      at: c.createdAt.toISOString(),
      href: "/contacts",
    });
  }

  const BROADCAST_STATUS_LABEL: Record<string, string> = {
    draft: "rascunho",
    scheduled: "agendado",
    sending: "enviando",
    sent: "enviado",
    failed: "falhou",
    canceled: "cancelado",
  };

  for (const b of broadcastRows) {
    const label =
      b.status === "sent"
        ? `enviado para ${b.totalRecipients} contatos`
        : `${BROADCAST_STATUS_LABEL[b.status] ?? b.status} (${b.totalRecipients} destinatários)`;
    items.push({
      id: `broadcast-${b.id}`,
      kind: "broadcast",
      text: `Disparo "${b.name}" ${label}`,
      at: b.createdAt.toISOString(),
      href: "/broadcasts",
    });
  }

  return items.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0)).slice(0, limit);
}

// --- 6. Contacts growth (Estatísticas) ----------------------------------

export async function loadContactsGrowth(
  db: Db,
  accountId: string,
  rangeDays: number,
): Promise<ContactsGrowthPoint[]> {
  const start = daysAgoStart(rangeDays - 1);
  const rows = await db
    .select({ createdAt: contacts.createdAt })
    .from(contacts)
    .where(and(eq(contacts.accountId, accountId), eq(contacts.isGroup, false), gte(contacts.createdAt, start)));

  const keys = lastNDayKeys(rangeDays);
  const buckets = new Map<string, number>();
  for (const k of keys) buckets.set(k, 0);
  for (const row of rows) {
    const key = localDayKey(row.createdAt.toISOString());
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return keys.map((day) => ({ day, count: buckets.get(day) ?? 0 }));
}

// --- 7. Conversation status breakdown + avg handling time --------------

export async function loadConversationStatusBreakdown(
  db: Db,
  accountId: string,
): Promise<ConversationStatusBreakdown> {
  const rows = await db
    .select({ status: conversations.status, count: sql<number>`count(*)::int` })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
    .where(eq(conversations.accountId, accountId))
    .groupBy(conversations.status);

  const byStatus = { open: 0, pending: 0, closed: 0 };
  for (const r of rows) byStatus[r.status] = r.count;

  // Proxy for "handling time": creation → last update, for
  // conversations currently closed. There's no dedicated
  // `closed_at` column, so this is an approximation that holds as
  // long as closing a conversation is the last thing that touches it.
  const closedRows = await db
    .select({ createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
    .where(and(eq(conversations.accountId, accountId), eq(conversations.status, "closed")));

  const mins = closedRows
    .map((r) => (r.updatedAt.getTime() - r.createdAt.getTime()) / 60_000)
    .filter((m) => m >= 0);
  const avgHandlingMinutes = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null;

  return { ...byStatus, avgHandlingMinutes };
}

// --- 8. Per-agent breakdown ----------------------------------------------

export async function loadAgentBreakdown(db: Db, accountId: string): Promise<AgentStat[]> {
  const rows = await db
    .select({
      agentId: conversations.assignedAgentId,
      status: conversations.status,
      count: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
    .where(and(eq(conversations.accountId, accountId), isNotNull(conversations.assignedAgentId)))
    .groupBy(conversations.assignedAgentId, conversations.status);

  const agentIds = [...new Set(rows.map((r) => r.agentId as string))];
  const userRows = agentIds.length
    ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, agentIds))
    : [];
  const nameById = new Map(userRows.map((u) => [u.id, u.fullName]));

  const byAgent = new Map<string, { open: number; pending: number; closed: number }>();
  for (const r of rows) {
    const agentId = r.agentId as string;
    const cur = byAgent.get(agentId) ?? { open: 0, pending: 0, closed: 0 };
    cur[r.status] = r.count;
    byAgent.set(agentId, cur);
  }

  return Array.from(byAgent.entries())
    .map(([agentId, c]) => ({
      agentId,
      name: nameById.get(agentId) ?? "—",
      openCount: c.open,
      closedCount: c.closed,
      totalCount: c.open + c.pending + c.closed,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);
}

// --- 9. Advanced analytics (filtered dashboard) -------------------------
//
// Everything here is scoped to conversations whose createdAt falls in
// [from, to], with optional department/agent narrowing — that's what
// "Total de Atendimentos no Período" means. totalContactsInBase is
// the one exception (account-wide, unaffected by the filters), per
// the "Contatos Totais na Base" KPI spec.
//
// Receptivo vs Ativo is derived from each conversation's first
// message: the customer messaged first (receptivo) or an agent/bot
// did (ativo, e.g. a broadcast or manual outbound opener).

export interface AdvancedAnalyticsFilters {
  from: Date;
  to: Date;
  departmentId?: string;
  agentId?: string;
}

export async function loadAdvancedAnalytics(
  db: Db,
  accountId: string,
  filters: AdvancedAnalyticsFilters,
): Promise<AdvancedAnalytics> {
  const { from, to, departmentId, agentId } = filters;

  const conditions = [
    eq(conversations.accountId, accountId),
    gte(conversations.createdAt, from),
    lte(conversations.createdAt, to),
  ];
  if (departmentId) conditions.push(eq(conversations.departmentId, departmentId));
  if (agentId) conditions.push(eq(conversations.assignedAgentId, agentId));

  const [convRows, totalContactsRow] = await Promise.all([
    db
      .select({
        id: conversations.id,
        status: conversations.status,
        departmentId: conversations.departmentId,
        assignedAgentId: conversations.assignedAgentId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.isGroup, false)))
      .where(and(...conditions)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), eq(contacts.isGroup, false))),
  ]);

  const conversationIds = convRows.map((c) => c.id);

  const messageRows = conversationIds.length
    ? await db
        .select({
          conversationId: messages.conversationId,
          senderType: messages.senderType,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .orderBy(messages.conversationId, messages.createdAt)
    : [];

  // First message per conversation (receptivo/ativo) + adjacent
  // customer→agent pairs per conversation (TMR samples) in one pass.
  const firstSenderByConv = new Map<string, "customer" | "agent" | "bot">();
  const responseSamplesMin: number[] = [];
  const heatmapCounts = new Map<string, number>();

  let currentConv = "";
  let pendingCustomerAt: Date | null = null;
  for (const row of messageRows) {
    if (row.conversationId !== currentConv) {
      currentConv = row.conversationId;
      pendingCustomerAt = null;
    }
    if (!firstSenderByConv.has(row.conversationId)) {
      firstSenderByConv.set(row.conversationId, row.senderType);
    }

    const dow = mondayIndex(row.createdAt);
    const hour = row.createdAt.getHours();
    const key = `${dow}-${hour}`;
    heatmapCounts.set(key, (heatmapCounts.get(key) ?? 0) + 1);

    if (row.senderType === "customer") {
      if (!pendingCustomerAt) pendingCustomerAt = row.createdAt;
    } else if (pendingCustomerAt) {
      responseSamplesMin.push((row.createdAt.getTime() - pendingCustomerAt.getTime()) / 60_000);
      pendingCustomerAt = null;
    }
  }

  let receptiveCount = 0;
  let activeCount = 0;
  for (const conv of convRows) {
    const first = firstSenderByConv.get(conv.id);
    if (first === "customer") receptiveCount += 1;
    else activeCount += 1; // agent/bot-initiated, or no messages yet — counts as an active reach-out
  }

  const pendingCount = convRows.filter((c) => c.status === "pending").length;

  const closedMins = convRows
    .filter((c) => c.status === "closed")
    .map((c) => (c.updatedAt.getTime() - c.createdAt.getTime()) / 60_000)
    .filter((m) => m >= 0);
  const avgHandlingMinutes = closedMins.length
    ? closedMins.reduce((a, b) => a + b, 0) / closedMins.length
    : null;

  const avgResponseMinutes = responseSamplesMin.length
    ? responseSamplesMin.reduce((a, b) => a + b, 0) / responseSamplesMin.length
    : null;

  const heatmap: HeatmapCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      heatmap.push({ dow, hour, count: heatmapCounts.get(`${dow}-${hour}`) ?? 0 });
    }
  }

  // Department pie — join names/colors, bucket "sem setor" separately.
  const deptIds = [...new Set(convRows.map((c) => c.departmentId).filter((v): v is string => !!v))];
  const deptRows = deptIds.length
    ? await db
        .select({ id: departments.id, name: departments.name, color: departments.color })
        .from(departments)
        .where(inArray(departments.id, deptIds))
    : [];
  const deptById = new Map(deptRows.map((d) => [d.id, d]));
  const deptCounts = new Map<string | null, number>();
  for (const c of convRows) {
    const key = c.departmentId ?? null;
    deptCounts.set(key, (deptCounts.get(key) ?? 0) + 1);
  }
  const departmentBreakdown: DepartmentSlice[] = Array.from(deptCounts.entries())
    .map(([id, count]) => ({
      id,
      name: id ? (deptById.get(id)?.name ?? "—") : "Sem setor",
      color: id ? (deptById.get(id)?.color ?? "#64748b") : "#64748b",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Agent bar — same shape as loadAgentBreakdown but scoped to this
  // filtered conversation set.
  const agentIds = [
    ...new Set(convRows.map((c) => c.assignedAgentId).filter((v): v is string => !!v)),
  ];
  const agentRows = agentIds.length
    ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, agentIds))
    : [];
  const agentNameById = new Map(agentRows.map((a) => [a.id, a.fullName]));
  const byAgent = new Map<string, { open: number; pending: number; closed: number }>();
  for (const c of convRows) {
    if (!c.assignedAgentId) continue;
    const cur = byAgent.get(c.assignedAgentId) ?? { open: 0, pending: 0, closed: 0 };
    cur[c.status] += 1;
    byAgent.set(c.assignedAgentId, cur);
  }
  const agentBreakdown: AgentStat[] = Array.from(byAgent.entries())
    .map(([id, c]) => ({
      agentId: id,
      name: agentNameById.get(id) ?? "—",
      openCount: c.open,
      closedCount: c.closed,
      totalCount: c.open + c.pending + c.closed,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);

  return {
    totalContactsInBase: totalContactsRow[0]?.count ?? 0,
    totalConversationsInPeriod: convRows.length,
    receptiveCount,
    activeCount,
    pendingCount,
    avgHandlingMinutes,
    avgResponseMinutes,
    heatmap,
    departmentBreakdown,
    agentBreakdown,
  };
}

// --- Tag interaction report ("qual produto teve mais interação") ------

export interface TagInteractionStat {
  tagId: string;
  tagName: string;
  tagColor: string;
  /** Distinct contacts carrying this tag that exchanged at least one
   *  message (either direction) in the selected month. */
  contactCount: number;
}

/**
 * One row per non-system tag (see tags.is_system — excludes the
 * auto-applied "Grupo" tag), counting distinct contacts that both
 * (a) carry the tag and (b) had at least one message land in one of
 * their conversations within [monthStart, monthEnd). Tags with zero
 * interaction in the period are included at count 0 so the chart
 * doesn't silently drop a product that just had a quiet month.
 */
export async function loadTagInteractionStats(
  db: Db,
  accountId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<TagInteractionStat[]> {
  const rows = await db
    .select({
      tagId: tags.id,
      tagName: tags.name,
      tagColor: tags.color,
      contactCount: sql<number>`count(distinct ${contacts.id})::int`,
    })
    .from(tags)
    .leftJoin(contactTags, eq(contactTags.tagId, tags.id))
    .leftJoin(contacts, eq(contacts.id, contactTags.contactId))
    .leftJoin(conversations, eq(conversations.contactId, contacts.id))
    .leftJoin(
      messages,
      and(
        eq(messages.conversationId, conversations.id),
        gte(messages.createdAt, monthStart),
        lt(messages.createdAt, monthEnd),
      ),
    )
    .where(
      and(
        eq(tags.accountId, accountId),
        eq(tags.isSystem, false),
        isNotNull(messages.id),
        eq(contacts.isGroup, false),
      ),
    )
    .groupBy(tags.id, tags.name, tags.color);

  // Tags that exist but had zero matching messages never produce a
  // row above (the inner-effect NOT NULL filter drops them) — add
  // them back at 0 so a product with no interaction this month still
  // shows up in the chart instead of vanishing.
  const seen = new Set(rows.map((r) => r.tagId));
  const zeroRows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(and(eq(tags.accountId, accountId), eq(tags.isSystem, false)));

  const result: TagInteractionStat[] = rows.map((r) => ({
    tagId: r.tagId,
    tagName: r.tagName,
    tagColor: r.tagColor,
    contactCount: r.contactCount,
  }));
  for (const t of zeroRows) {
    if (!seen.has(t.id)) {
      result.push({ tagId: t.id, tagName: t.name, tagColor: t.color, contactCount: 0 });
    }
  }

  return result.sort((a, b) => b.contactCount - a.contactCount);
}

// --- CSAT (satisfaction survey) report ---------------------------------

export interface CsatAgentStat {
  agentId: string;
  name: string;
  avgRating: number;
  responseCount: number;
}

export interface CsatStats {
  totalResponses: number;
  avgRating: number | null;
  /** Index 0 = count of rating "1", … index 4 = count of rating "5". */
  distribution: number[];
  byAgent: CsatAgentStat[];
}

/**
 * Aggregates every csat_responses row in [rangeStart, now) — one row
 * per conversation whose customer replied 1-5 to the "Enviar nota
 * para atendimento" close-flow survey (see the uazapi webhook's
 * CSAT-parsing branch).
 */
export async function loadCsatStats(db: Db, accountId: string, rangeDays: number): Promise<CsatStats> {
  const start = daysAgoStart(rangeDays - 1);

  const rows = await db
    .select({ rating: csatResponses.rating, agentId: csatResponses.agentId })
    .from(csatResponses)
    .where(and(eq(csatResponses.accountId, accountId), gte(csatResponses.createdAt, start)));

  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  const byAgentRaw = new Map<string, { sum: number; count: number }>();

  for (const r of rows) {
    distribution[r.rating - 1] += 1;
    sum += r.rating;
    if (r.agentId) {
      const cur = byAgentRaw.get(r.agentId) ?? { sum: 0, count: 0 };
      cur.sum += r.rating;
      cur.count += 1;
      byAgentRaw.set(r.agentId, cur);
    }
  }

  const agentIds = [...byAgentRaw.keys()];
  const agentRows = agentIds.length
    ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, agentIds))
    : [];
  const nameById = new Map(agentRows.map((a) => [a.id, a.fullName]));

  const byAgent: CsatAgentStat[] = agentIds
    .map((id) => {
      const { sum: s, count } = byAgentRaw.get(id)!;
      return { agentId: id, name: nameById.get(id) ?? "—", avgRating: s / count, responseCount: count };
    })
    .sort((a, b) => b.avgRating - a.avgRating);

  return {
    totalResponses: rows.length,
    avgRating: rows.length ? sum / rows.length : null,
    distribution,
    byAgent,
  };
}
