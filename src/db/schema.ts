// ============================================================
// DivaryTalk — main application database schema (Fatia 2).
//
// Plain Postgres, no Supabase. Authorization has no database-level
// safety net (no RLS) — every query in the codebase MUST filter by
// `accountId` explicitly. `src/lib/auth/account.ts` is the single
// place that resolves "who is calling, and which account do they
// belong to"; every data-access function downstream takes that
// account id as an explicit parameter rather than relying on an
// ambient session like Supabase's `auth.uid()` + RLS did.
//
// Scope note: this schema only covers what Fatia 2 needs (auth +
// accounts + WhatsApp instances). The rest of the CRM (contacts,
// conversations, pipelines, broadcasts, …) still references the old
// Supabase-flavored tables in supabase/migrations/ and is out of
// scope until Fatia 3 ports those screens onto this same database.
// ============================================================

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accountRoleEnum = pgEnum("account_role", [
  "owner",
  "admin",
  "agent",
  "viewer",
]);

export const authTokenPurposeEnum = pgEnum("auth_token_purpose", [
  "invite",
  "set_password",
]);

export const instanceStatusEnum = pgEnum("instance_status", [
  "not_created",
  "qrcode",
  "connecting",
  "connected",
  "disconnected",
]);

// ------------------------------------------------------------
// accounts — one row per tenant. Exactly one row has
// is_platform = true (the platform owner's own "account"); every
// other row is a client. Enforced by the partial unique index below.
// ------------------------------------------------------------
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id"), // FK added after `users` below via .references() would be circular; enforced at app level + a deferred FK migration statement.
    isPlatform: boolean("is_platform").notNull().default(false),
    maxAgentSeats: integer("max_agent_seats").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_accounts_single_platform")
      .on(table.isPlatform)
      .where(sql`${table.isPlatform} = true`),
  ],
);

// ------------------------------------------------------------
// users — merges what used to be Supabase's `auth.users` (login)
// and `profiles` (app-facing profile) into one row, since this app
// is now the sole owner of both concerns.
// ------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Null until the user completes the set-password flow (see
  // auth_tokens) — a platform-owner-created client admin exists as
  // a row before they've ever logged in.
  passwordHash: text("password_hash"),
  fullName: text("full_name").notNull(),
  avatarUrl: text("avatar_url"),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  accountRole: accountRoleEnum("account_role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------------
// sessions — DB-backed (not JWT) so a logout / password change can
// actually revoke access instead of waiting out a token's lifetime.
// The cookie holds this row's id, signed so a tampered id is
// rejected before ever reaching the database (see
// src/lib/auth/session.ts).
// ------------------------------------------------------------
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------------
// auth_tokens — one primitive covering two flows that are
// mechanically identical (a single-use token that lets someone set
// a password): inviting a new user into an account, and letting an
// existing user set/reset their password. Replaces both
// `account_invitations` and Supabase Auth's `generateLink`.
// ------------------------------------------------------------
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: authTokenPurposeEnum("purpose").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  // 'invite': which account/role the redeemer joins. Null for
  // 'set_password' on an existing user (their account is already
  // fixed).
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  role: accountRoleEnum("role"),
  // 'set_password': which existing user this token belongs to. Null
  // for 'invite' — the user doesn't exist yet; accept-token creates
  // them.
  targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  label: text("label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------------
// whatsapp_instances — same shape as migration 037, ported off RLS.
// ------------------------------------------------------------
export const whatsappInstances = pgTable(
  "whatsapp_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: "cascade" }),
    instanceName: text("instance_name").notNull(),
    uazapiUrl: text("uazapi_url"),
    uazapiToken: text("uazapi_token"), // encrypted at rest — see src/lib/whatsapp/encryption.ts
    status: instanceStatusEnum("status").notNull().default("not_created"),
    qrCodeBase64: text("qr_code_base64"),
    phoneNumber: text("phone_number"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_whatsapp_instances_account").on(table.accountId)],
);
