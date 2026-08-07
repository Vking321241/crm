// ============================================================
// Deal status <-> legacy UI shape adapter.
//
// `deals.status` in the DB (see src/db/schema.ts, `dealStatusEnum`)
// is 'active' | 'won' | 'lost'. The legacy `@/types` `DealStatus`
// (still used by `PipelineBoard`/`DealCard`/`PipelineAnalytics`,
// shared with not-yet-ported call sites like the contact detail
// view) is 'open' | 'won' | 'lost'. Both directions are needed at
// the pipelines page's fetch boundary and in the deal form, so
// this lives in its own module rather than duplicated or imported
// from a Next.js page file (which would create a page <-> component
// circular import).
// ============================================================

import type { DealStatus } from "@/types";

export type ApiDealStatus = "active" | "won" | "lost";

export function apiStatusToLegacy(status: ApiDealStatus): DealStatus {
  return status === "active" ? "open" : status;
}

export function legacyStatusToApi(status: DealStatus): ApiDealStatus {
  return status === "open" ? "active" : status;
}
