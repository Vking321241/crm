// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

export interface ContactsGrowthPoint {
  day: string // YYYY-MM-DD local
  count: number
}

export interface ConversationStatusBreakdown {
  open: number
  pending: number
  closed: number
  /** Avg time from a conversation's creation to its last update while
   *  closed, in minutes. Null when there are no closed conversations. */
  avgHandlingMinutes: number | null
}

export interface AgentStat {
  agentId: string
  name: string
  openCount: number
  closedCount: number
  totalCount: number
}

// ============================================================
// Advanced analytics (Dashboard Analytics e Relatórios) — filtered
// by date range + optional department/agent.
// ============================================================

export interface HeatmapCell {
  /** 0 = Mon … 6 = Sun (Monday-first), matches ResponseTimeBucket. */
  dow: number
  /** 0..23, local time. */
  hour: number
  count: number
}

export interface DepartmentSlice {
  id: string | null
  name: string
  color: string
  count: number
}

export interface AdvancedAnalytics {
  totalContactsInBase: number
  totalConversationsInPeriod: number
  receptiveCount: number
  activeCount: number
  pendingCount: number
  avgHandlingMinutes: number | null
  avgResponseMinutes: number | null
  heatmap: HeatmapCell[]
  departmentBreakdown: DepartmentSlice[]
  agentBreakdown: AgentStat[]
}
