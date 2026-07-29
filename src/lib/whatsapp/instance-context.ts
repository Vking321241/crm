// ============================================================
// Server-side helpers shared by the UAZAPI instance API routes
// (connect / status) and the /admin per-client connect flow.
//
// Both routes need the same two things: (1) figure out WHICH
// account's instance the caller is allowed to operate on, and (2)
// load/save that instance's row with the token encrypted at rest.
// Centralising it here keeps that logic — and its permission
// check — in one place instead of duplicated per route.
// ============================================================

import { eq } from "drizzle-orm";

import { decrypt, encrypt } from "./encryption";
import { whatsappInstances } from "@/db/schema";
import {
  ForbiddenError,
  isCurrentAccountPlatform,
  type AccountContext,
} from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import type { UazapiInstanceConfig } from "./uazapi-client";

/**
 * Resolves which account's WhatsApp instance a request should
 * operate on.
 *
 *   - No `requestedAccountId` (or it matches the caller's own):
 *     the caller must be admin+ in their own account (this is the
 *     "I'm a client admin connecting my own WhatsApp" path).
 *   - A different `requestedAccountId`: the caller must belong to
 *     the platform account (this is the "I'm the platform owner,
 *     picking which client to connect" path in /admin).
 */
export async function resolveInstanceAccountId(
  ctx: AccountContext,
  requestedAccountId?: string | null,
): Promise<string> {
  if (requestedAccountId && requestedAccountId !== ctx.accountId) {
    if (!isCurrentAccountPlatform(ctx)) {
      throw new ForbiddenError(
        "Only a platform owner can manage another account's WhatsApp instance",
      );
    }
    return requestedAccountId;
  }

  if (!hasMinRole(ctx.role, "admin")) {
    throw new ForbiddenError(
      "This action requires the 'admin' role or higher",
    );
  }
  return ctx.accountId;
}

export interface InstanceRow {
  id: string;
  accountId: string;
  instanceName: string;
  uazapiUrl: string | null;
  status: "not_created" | "qrcode" | "connecting" | "connected" | "disconnected";
  phoneNumber: string | null;
  /** Decrypted — never send this back to the client. */
  token?: string;
}

export async function loadInstance(
  ctx: AccountContext,
  accountId: string,
): Promise<InstanceRow | null> {
  const [data] = await ctx.db
    .select()
    .from(whatsappInstances)
    .where(eq(whatsappInstances.accountId, accountId))
    .limit(1);

  if (!data) return null;

  return {
    id: data.id,
    accountId: data.accountId,
    instanceName: data.instanceName,
    uazapiUrl: data.uazapiUrl,
    status: data.status,
    phoneNumber: data.phoneNumber,
    token: data.uazapiToken ? decrypt(data.uazapiToken) : undefined,
  };
}

export function toUazapiConfig(instance: InstanceRow): UazapiInstanceConfig {
  return { baseUrl: instance.uazapiUrl ?? "", token: instance.token };
}

export async function saveInstanceToken(
  ctx: AccountContext,
  instanceId: string,
  token: string,
): Promise<void> {
  await ctx.db
    .update(whatsappInstances)
    .set({ uazapiToken: encrypt(token), updatedAt: new Date() })
    .where(eq(whatsappInstances.id, instanceId));
}

export async function updateInstanceStatus(
  ctx: AccountContext,
  instanceId: string,
  fields: {
    status: InstanceRow["status"];
    qrCodeBase64?: string | null;
    phoneNumber?: string | null;
    connectedAt?: string | null;
  },
): Promise<void> {
  await ctx.db
    .update(whatsappInstances)
    .set({
      status: fields.status,
      updatedAt: new Date(),
      ...(fields.qrCodeBase64 !== undefined ? { qrCodeBase64: fields.qrCodeBase64 } : {}),
      ...(fields.phoneNumber !== undefined ? { phoneNumber: fields.phoneNumber } : {}),
      ...(fields.connectedAt !== undefined
        ? { connectedAt: fields.connectedAt ? new Date(fields.connectedAt) : null }
        : {}),
    })
    .where(eq(whatsappInstances.id, instanceId));
}
