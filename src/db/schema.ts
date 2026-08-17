// ============================================================
// DivaryTalk — main application database schema.
//
// Plain Postgres, no Supabase. Authorization has no database-level
// safety net (no RLS) — every query in the codebase MUST filter by
// `accountId` explicitly. `src/lib/auth/account.ts` is the single
// place that resolves "who is calling, and which account do they
// belong to"; every data-access function downstream takes that
// account id as an explicit parameter rather than relying on an
// ambient session like Supabase's `auth.uid()` + RLS did.
//
// Fatia 3 ported the rest of the CRM (contacts, conversations,
// pipelines, broadcasts, notifications, presence) off the old
// Supabase-era schema onto this file.
// Business logic that used to live in SECURITY DEFINER functions or
// RLS-dependent triggers (notify_conversation_assigned,
// filter_contacts_by_tags, touch_presence, set_member_role, …) now
// lives in the API routes that touch these tables — see each
// route's comments for the SQL migration it replaces. Aggregate
// triggers with no auth.uid() dependency (broadcast recipient
// counts, updated_at) stayed as plain SQL triggers, added via raw
// SQL in the generated migration.
//
// Dropped entirely (not ported): `whatsapp_config` / `message_templates`
// (Meta Cloud API — the product now sends everything through UAZAPI,
// see src/lib/whatsapp/uazapi-client.ts) and `account_invitations`
// (superseded by `auth_tokens`, Fatia 2).
// ============================================================

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accountRoleEnum = pgEnum("account_role", [
  "owner",
  "manager",
  "agent",
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
    defaultCurrency: text("default_currency").notNull().default("BRL"),
    // Predefined domain used to auto-build an atendente's login email
    // (e.g. "cliente1.com" -> admin types "joao", user becomes
    // joao@cliente1.com). Null until the platform owner or account
    // admin sets it; POST /api/account/members requires it.
    emailDomain: text("email_domain"),
    // Platform-wide UAZAPI credentials, set from /admin (see
    // src/lib/whatsapp/platform-config.ts). Only meaningful on the
    // single is_platform=true row — every other account's own
    // instance lives in whatsapp_instances. Null falls back to the
    // UAZAPI_SERVER_URL / UAZAPI_ADMIN_TOKEN env vars. Token is
    // encrypted at rest with the same AES-256-GCM scheme as
    // whatsapp_instances.uazapi_token (src/lib/whatsapp/encryption.ts).
    uazapiServerUrl: text("uazapi_server_url"),
    uazapiAdminToken: text("uazapi_admin_token"),
    // Kiwify subscription state (see src/app/api/kiwify/webhook and
    // src/app/(dashboard)/subscription). `subscriptionPlan` is the
    // seat-tier key ('3'|'5'|'7'|'10', matching the Kiwify checkout
    // links) — kept separate from maxAgentSeats so an expired/
    // canceled subscription doesn't silently rewrite the seat count
    // an admin may have set manually.
    subscriptionPlan: text("subscription_plan"),
    subscriptionStatus: text("subscription_status").notNull().default("none"), // 'none' | 'active' | 'past_due' | 'canceled'
    subscriptionRenewsAt: timestamp("subscription_renews_at", { withTimezone: true }),
    subscriptionCanceledAt: timestamp("subscription_canceled_at", { withTimezone: true }),
    kiwifyCustomerEmail: text("kiwify_customer_email"),
    // Kiwify's own subscription id, captured from the webhook payload —
    // needed to call their Subscriptions API to cancel (see
    // src/lib/kiwify/api-client.ts). Null until the first webhook event
    // for this account carries one.
    kiwifySubscriptionId: text("kiwify_subscription_id"),
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
  // Which "setor" this member belongs to — drives the bold WhatsApp
  // signature (e.g. "*Atendimento - Cleiton*") prepended to their
  // outbound text/image/document sends. Null means no signature is
  // added. See src/db/schema.ts `departments` below.
  departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, {
    onDelete: "set null",
  }),
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
// api_keys — dashboard-managed machine credentials for /api/v1.
// Plaintext keys are shown once; only keyHash is stored.
// ------------------------------------------------------------
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_api_keys_account").on(table.accountId),
    index("idx_api_keys_key_hash").on(table.keyHash),
  ],
);

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

// ============================================================
// Fatia 3 — core CRM tables
// ============================================================

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "pending",
  "closed",
]);

export const senderTypeEnum = pgEnum("sender_type", ["customer", "agent", "bot"]);

export const messageContentTypeEnum = pgEnum("message_content_type", [
  "text",
  "image",
  "document",
  "audio",
  "video",
  "location",
  "interactive",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const reactionActorTypeEnum = pgEnum("reaction_actor_type", ["customer", "agent"]);

export const quickReplyKindEnum = pgEnum("quick_reply_kind", ["text", "interactive"]);

export const broadcastStatusEnum = pgEnum("broadcast_status", [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
]);

export const broadcastRecipientStatusEnum = pgEnum("broadcast_recipient_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "replied",
  "failed",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "conversation_assigned",
  // A visitor finished the public checkout + onboarding form
  // (src/app/assinar/obrigado) — fires on the platform account's
  // admins so Divary's team can send the new client their access
  // link. See signup_leads below.
  "signup_lead",
]);

export const presenceStatusEnum = pgEnum("presence_status", ["online", "away"]);

const DEFAULT_WELCOME_MESSAGE =
  "Olá! 👋 Obrigado por entrar em contato. Em instantes um de nossos atendentes vai te responder.";
const DEFAULT_AFTER_HOURS_MESSAGE =
  "No momento estamos fora do horário de atendimento. Deixe sua mensagem que responderemos assim que possível!";
const DEFAULT_AWAY_MESSAGE =
  "Estamos temporariamente fora do ar. Assim que retornarmos, respondemos sua mensagem.";

/**
 * Default weekly business-hours grid: Mon–Fri 09:00–18:00, Sat/Sun
 * closed. `start`/`end` are "HH:mm" (24h, account's local time —
 * this app has no per-account timezone field yet, so it's read as
 * the server's TZ). Shape mirrors what the settings UI edits
 * directly, so no separate parsing layer is needed.
 */
export const DEFAULT_BUSINESS_HOURS = {
  mon: { enabled: true, start: "09:00", end: "18:00" },
  tue: { enabled: true, start: "09:00", end: "18:00" },
  wed: { enabled: true, start: "09:00", end: "18:00" },
  thu: { enabled: true, start: "09:00", end: "18:00" },
  fri: { enabled: true, start: "09:00", end: "18:00" },
  sat: { enabled: false, start: "09:00", end: "13:00" },
  sun: { enabled: false, start: "09:00", end: "13:00" },
};

// ------------------------------------------------------------
// auto_reply_settings — one row per account, rule-based (no AI)
// automated replies: welcome message for first-ever contact,
// after-hours message based on a weekly schedule, and a manual
// "away" override (vacation/closure) that takes priority over both.
// Sending is throttled per-conversation via
// `conversations.lastAutoReplyAt` (see the webhook handler) so a
// customer texting repeatedly doesn't get spammed.
// ------------------------------------------------------------
export const autoReplySettings = pgTable("auto_reply_settings", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  welcomeEnabled: boolean("welcome_enabled").notNull().default(true),
  welcomeMessage: text("welcome_message").notNull().default(DEFAULT_WELCOME_MESSAGE),
  afterHoursEnabled: boolean("after_hours_enabled").notNull().default(true),
  afterHoursMessage: text("after_hours_message").notNull().default(DEFAULT_AFTER_HOURS_MESSAGE),
  businessHours: jsonb("business_hours").notNull().default(DEFAULT_BUSINESS_HOURS),
  awayEnabled: boolean("away_enabled").notNull().default(false),
  awayMessage: text("away_message").notNull().default(DEFAULT_AWAY_MESSAGE),
  // Owner/manager-only toggle (see /api/settings/auto-reply): when on,
  // the business-hours cron sweep (src/app/api/cron/business-hours/route.ts)
  // auto-pauses every open conversation the moment `businessHours`
  // says the account is closed (after-hours, lunch break, …), and
  // flags them for re-acknowledgment when hours resume.
  autoPauseOutsideBusinessHours: boolean("auto_pause_outside_business_hours")
    .notNull()
    .default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------------
// contacts — `phoneNormalized` is a STORED generated column, kept
// in lockstep with `phone` by Postgres (mirrors normalizePhone()).
// UNIQUE(account_id, phone_normalized) is the dedupe guarantee
// (migration 022) — every write path (manual create, CSV import,
// inbound webhook) relies on this, not app-level checks alone.
// ------------------------------------------------------------
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    phone: text("phone").notNull(),
    phoneNormalized: text("phone_normalized").generatedAlwaysAs(
      sql`regexp_replace(phone, '\\D', '', 'g')`,
    ),
    name: text("name"),
    email: text("email"),
    company: text("company"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_contacts_account").on(table.accountId),
    uniqueIndex("idx_contacts_account_phone_normalized")
      .on(table.accountId, table.phoneNormalized)
      .where(sql`${table.phoneNormalized} <> ''`),
  ],
);

// ------------------------------------------------------------
// departments — "setores" (e.g. Vendas, Suporte). Conversations can
// be transferred between them; transferring clears the current
// assignment so the conversation lands in the new department's
// shared queue instead of staying with the previous agent (see the
// PATCH /api/conversations/[id] handler).
// ------------------------------------------------------------
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#3b82f6"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_departments_account").on(table.accountId)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#3b82f6"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_tags_account").on(table.accountId)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_contact_tags_unique").on(table.contactId, table.tagId),
    index("idx_contact_tags_tag").on(table.tagId),
  ],
);

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    fieldName: text("field_name").notNull(),
    fieldType: text("field_type").notNull().default("text"),
    fieldOptions: jsonb("field_options"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_custom_fields_account").on(table.accountId)],
);

export const contactCustomValues = pgTable(
  "contact_custom_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    customFieldId: uuid("custom_field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    value: text("value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_contact_custom_values_unique").on(table.contactId, table.customFieldId)],
);

export const contactNotes = pgTable(
  "contact_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    noteText: text("note_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_contact_notes_contact").on(table.contactId)],
);

// ------------------------------------------------------------
// conversation_internal_notes — a "post-it" dropped straight into
// the message timeline from the composer's note button. Distinct
// from `contact_notes` (a running free-text log in the sidebar) —
// this renders inline among the messages, with a per-agent read
// receipt (internal_note_reads) so a team can tell who's actually
// seen it. Never reaches the customer — no UAZAPI send, ever.
// ------------------------------------------------------------
export const conversationInternalNotes = pgTable(
  "conversation_internal_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_conversation_internal_notes_conversation").on(table.conversationId, table.createdAt)],
);

export const internalNoteReads = pgTable(
  "internal_note_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => conversationInternalNotes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_internal_note_reads_unique").on(table.noteId, table.userId)],
);

// ------------------------------------------------------------
// conversations — UNIQUE(account_id, contact_id) is the dedupe
// guarantee (migration 036): one conversation per contact per
// account.
// ------------------------------------------------------------
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: conversationStatusEnum("status").notNull().default("open"),
    assignedAgentId: uuid("assigned_agent_id").references(() => users.id, {
      onDelete: "set null",
    }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    lastMessageText: text("last_message_text"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    // Throttle for rule-based auto-replies (welcome/after-hours/away) —
    // at most one automated message per conversation per
    // AUTO_REPLY_THROTTLE_HOURS window, so a customer sending several
    // messages in a row doesn't get the same auto-reply repeated.
    lastAutoReplyAt: timestamp("last_auto_reply_at", { withTimezone: true }),
    // Set true whenever assignedAgentId changes to someone new (a
    // transfer) or a business-hours auto-pause lifts on a conversation
    // that has an assignee. The assignee sees a pop-up ("iniciar
    // atendimento" or "apenas visualizar") the next time they open it;
    // choosing "apenas visualizar" leaves this true so the pop-up
    // reappears on their next visit, while "iniciar" clears it. Only a
    // NEW transfer/resume event flips it back to true.
    needsAcknowledgment: boolean("needs_acknowledgment").notNull().default(false),
    acknowledgmentReason: text("acknowledgment_reason"), // 'transferred' | 'resumed'
    // Manual pause (agent/admin toggled, e.g. end of shift) or
    // automatic pause outside the account's configured business hours
    // (see auto_reply_settings.auto_pause_outside_business_hours +
    // the cron sweep that sets/clears this). Independent of `status`
    // — a paused conversation stays open/pending, just flagged.
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseReason: text("pause_reason"), // 'manual' | 'business_hours'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_conversations_account").on(table.accountId),
    uniqueIndex("idx_conversations_account_contact").on(table.accountId, table.contactId),
    index("idx_conversations_department").on(table.departmentId),
  ],
);

// ------------------------------------------------------------
// conversation_transfers — audit trail of every reassignment
// (agent-to-agent) and department transfer, so a manager/owner can
// see who handed a conversation to whom and how often (Relatórios).
// Plain agent members never see this — gated to `reports` access,
// same as the rest of Estatísticas (see /api/conversations/transfers).
// ------------------------------------------------------------
export const conversationTransfers = pgTable(
  "conversation_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    fromAgentId: uuid("from_agent_id").references(() => users.id, { onDelete: "set null" }),
    toAgentId: uuid("to_agent_id").references(() => users.id, { onDelete: "set null" }),
    fromDepartmentId: uuid("from_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    toDepartmentId: uuid("to_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    transferredBy: uuid("transferred_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_conversation_transfers_account_created").on(table.accountId, table.createdAt),
    index("idx_conversation_transfers_conversation").on(table.conversationId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderType: senderTypeEnum("sender_type").notNull(),
    senderId: uuid("sender_id"),
    contentType: messageContentTypeEnum("content_type").notNull().default("text"),
    contentText: text("content_text"),
    mediaUrl: text("media_url"),
    messageId: text("message_id"), // UAZAPI/WhatsApp message id, for status webhooks + dedupe
    status: messageStatusEnum("status").notNull().default("sent"),
    replyToMessageId: uuid("reply_to_message_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    interactivePayload: jsonb("interactive_payload"),
    interactiveReplyId: text("interactive_reply_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_messages_conversation").on(table.conversationId),
    index("idx_messages_message_id").on(table.messageId),
    index("idx_messages_reply_to").on(table.replyToMessageId).where(sql`${table.replyToMessageId} is not null`),
  ],
);

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    actorType: reactionActorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_message_reactions_unique").on(
      table.messageId,
      table.actorType,
      table.actorId,
    ),
    index("idx_message_reactions_conversation").on(table.conversationId),
  ],
);

export const quickReplies = pgTable(
  "quick_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    // Trigger keyword for the composer's "/" popover (e.g. "pix" ->
    // typing "/pix" filters straight to this reply). Optional —
    // replies without one are only reachable by browsing the list.
    shortcut: text("shortcut"),
    kind: quickReplyKindEnum("kind").notNull().default("text"),
    contentText: text("content_text"),
    interactivePayload: jsonb("interactive_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_quick_replies_account").on(table.accountId)],
);

// ------------------------------------------------------------
// broadcasts — no `template_name`/`template_language` (Meta-only
// concepts, dropped); broadcasts now send plain text/media through
// UAZAPI directly, no template approval step.
// ------------------------------------------------------------
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    contentText: text("content_text").notNull(),
    mediaUrl: text("media_url"),
    audienceFilter: jsonb("audience_filter"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    status: broadcastStatusEnum("status").notNull().default("draft"),
    totalRecipients: integer("total_recipients").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    readCount: integer("read_count").notNull().default(0),
    repliedCount: integer("replied_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_broadcasts_account").on(table.accountId)],
);

export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: broadcastRecipientStatusEnum("status").notNull().default("pending"),
    whatsappMessageId: text("whatsapp_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_broadcast_recipients_broadcast").on(table.broadcastId),
    uniqueIndex("idx_broadcast_recipients_wamid")
      .on(table.whatsappMessageId)
      .where(sql`${table.whatsappMessageId} is not null`),
  ],
);

// ------------------------------------------------------------
// notifications — writes happen from application code (the
// conversation-assign route), not a DB trigger, since the old
// trigger's logic depended on auth.uid().
// ------------------------------------------------------------
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull().default("conversation_assigned"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_notifications_user_created").on(table.userId, table.createdAt),
    index("idx_notifications_user_unread")
      .on(table.userId)
      .where(sql`${table.readAt} is null`),
  ],
);

export const signupLeadStatusEnum = pgEnum("signup_lead_status", ["new", "contacted"]);

// ------------------------------------------------------------
// signup_leads — durable record of what a visitor filled in on the
// public post-checkout onboarding form (src/app/assinar/obrigado),
// so the Divary team has something to work from beyond the
// notification's free-text body (which they might delete/lose). No
// accountId — this is pre-account, that's the whole point of it: the
// platform team reads it, then manually creates the client via
// /admin (same "Criar cliente" flow as always) and sends the access
// link, exactly like the process before this form existed.
// ------------------------------------------------------------
export const signupLeads = pgTable(
  "signup_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    domain: text("domain"),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    status: signupLeadStatusEnum("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_signup_leads_created").on(table.createdAt)],
);

// ------------------------------------------------------------
// webhook_debug_log — TEMPORARY capture of raw UAZAPI webhook bodies,
// used only to reverse-engineer field names this codebase has been
// guessing at (see src/lib/whatsapp/uazapi-client.ts parseUazapiWebhook
// header comment). Not account-scoped — this is operator tooling, not
// product data. Safe to drop this table entirely once UAZAPI's real
// payload shapes (in particular: reactions) are confirmed and the
// parser is verified against them.
// ------------------------------------------------------------
export const webhookDebugLog = pgTable(
  "webhook_debug_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    body: jsonb("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_webhook_debug_log_created").on(table.createdAt)],
);

// ------------------------------------------------------------
// user_permissions — per-user, per-module access grants. Layered on
// top of `users.accountRole`: owner/manager always have full access
// (see src/lib/auth/permissions.ts) regardless of what's in this
// table, so this only matters for plain agent rows. Lets a manager
// give a single agent access to modules their role wouldn't normally
// unlock (reports, spy mode, internal chat, …), or restrict another
// agent down to a single module. `module` is a free-text key validated against
// PERMISSION_MODULES in application code rather than a pgEnum, so
// adding a new module doesn't require a migration.
// ------------------------------------------------------------
export const userPermissions = pgTable(
  "user_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    canAccess: boolean("can_access").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_user_permissions_unique").on(table.userId, table.module),
    index("idx_user_permissions_account").on(table.accountId),
  ],
);

// ------------------------------------------------------------
// conversation_tasks — "Tarefas Agendadas": a reminder/to-do tied to
// a conversation, created from the inbox sidebar and surfaced again
// in the standalone Central de Tarefas (Hoje / Atrasadas / Concluídas).
// ------------------------------------------------------------
export const conversationTaskStatusEnum = pgEnum("conversation_task_status", [
  "pending",
  "done",
]);

export const conversationTasks = pgTable(
  "conversation_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    note: text("note").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: conversationTaskStatusEnum("status").notNull().default("pending"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_conversation_tasks_account_due").on(table.accountId, table.dueAt),
    index("idx_conversation_tasks_conversation").on(table.conversationId),
  ],
);

// ------------------------------------------------------------
// internal_channels / members / messages — team-only chat (never
// visible to customers), separate from the customer-facing
// conversations/messages tables. A channel is either a 1:1 DM
// (isDirect=true, exactly 2 members) or a named group/department
// channel. Read state is tracked per member via `lastReadAt` rather
// than a per-message read table, mirroring the polling-based unread
// pattern already used by conversations.unreadCount.
// ------------------------------------------------------------
export const internalChannels = pgTable(
  "internal_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name"),
    isDirect: boolean("is_direct").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_internal_channels_account").on(table.accountId)],
);

export const internalChannelMembers = pgTable(
  "internal_channel_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => internalChannels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_internal_channel_members_unique").on(table.channelId, table.userId),
    index("idx_internal_channel_members_user").on(table.userId),
  ],
);

export const internalMessageKindEnum = pgEnum("internal_message_kind", [
  "text",
  "image",
  "audio",
]);

export const internalMessages = pgTable(
  "internal_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => internalChannels.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
    kind: internalMessageKindEnum("kind").notNull().default("text"),
    contentText: text("content_text"),
    mediaUrl: text("media_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_internal_messages_channel_created").on(table.channelId, table.createdAt)],
);

// ------------------------------------------------------------
// member_presence — heartbeat written by POST /api/presence/touch
// (replaces the touch_presence() SECURITY DEFINER RPC), read via
// polling (replaces the Realtime subscription).
// ------------------------------------------------------------
export const memberPresence = pgTable("member_presence", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  status: presenceStatusEnum("status").notNull().default("online"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
