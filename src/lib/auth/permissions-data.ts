// ============================================================
// DB access for the granular permissions table. Kept separate from
// src/lib/auth/permissions.ts (pure catalog/logic, no I/O) so the
// pure module can be unit-tested without a database.
// ============================================================

import { eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { userPermissions } from "@/db/schema";

/** The set of module keys explicitly granted (`can_access = true`)
 *  to a single user. Empty for owner/admin — callers should check
 *  `roleHasFullAccess` first and skip this query entirely for them. */
export async function getGrantedModules(db: Db, userId: string): Promise<Set<string>> {
  const granted = await db
    .select({ module: userPermissions.module, canAccess: userPermissions.canAccess })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));
  return new Set(granted.filter((r) => r.canAccess).map((r) => r.module));
}
