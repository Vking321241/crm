// ============================================================
// Platform-wide UAZAPI credentials — the server URL + admin token
// used by /admin to create and browse instances across every client.
// Stored on the single is_platform=true account row (see
// accounts.uazapiServerUrl / uazapiAdminToken in src/db/schema.ts),
// editable from the admin UI instead of being locked to env vars.
// Falls back to UAZAPI_SERVER_URL / UAZAPI_ADMIN_TOKEN when the DB
// columns are empty, so existing deployments keep working unchanged
// until an admin saves a value through the UI.
// ============================================================

import { eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { accounts } from "@/db/schema";
import { decrypt, encrypt } from "./encryption";
import type { UazapiAdminConfig } from "./uazapi-client";

export async function loadPlatformUazapiConfig(db: Db): Promise<UazapiAdminConfig | null> {
  const [platform] = await db
    .select({
      uazapiServerUrl: accounts.uazapiServerUrl,
      uazapiAdminToken: accounts.uazapiAdminToken,
    })
    .from(accounts)
    .where(eq(accounts.isPlatform, true))
    .limit(1);

  const baseUrl = platform?.uazapiServerUrl || process.env.UAZAPI_SERVER_URL || "";
  const adminToken = platform?.uazapiAdminToken
    ? decrypt(platform.uazapiAdminToken)
    : process.env.UAZAPI_ADMIN_TOKEN || "";

  if (!baseUrl || !adminToken) return null;
  return { baseUrl, adminToken };
}

export async function savePlatformUazapiConfig(
  db: Db,
  fields: { serverUrl: string; adminToken?: string },
): Promise<void> {
  const update: Partial<typeof accounts.$inferInsert> = {
    uazapiServerUrl: fields.serverUrl,
    updatedAt: new Date(),
  };
  if (fields.adminToken) {
    update.uazapiAdminToken = encrypt(fields.adminToken);
  }
  await db.update(accounts).set(update).where(eq(accounts.isPlatform, true));
}
