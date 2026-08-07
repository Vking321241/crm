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
// Supabase-flavored tables in supabase/migrations/ onto this file.
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

export const dealStatusEnum = pgEnum("deal_status", ["active", "won", "lost"]);

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

export const notificationTypeEnum = pgEnum("notification_type", ["conversation_assigned"]);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_conversations_account").on(table.accountId),
    uniqueIndex("idx_conversations_account_contact").on(table.accountId, table.contactId),
    index("idx_conversations_department").on(table.departmentId),
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
    kind: quickReplyKindEnum("kind").notNull().default("text"),
    contentText: text("content_text"),
    interactivePayload: jsonb("interactive_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_quick_replies_account").on(table.accountId)],
);

// ------------------------------------------------------------
// pipelines / deals
// ------------------------------------------------------------
export const pipelines = pgTable(
  "pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_pipelines_account").on(table.accountId)],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    color: text("color").notNull().default("#3b82f6"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_pipeline_stages_pipeline").on(table.pipelineId)],
);

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    value: numeric("value", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: text("currency").default("BRL"),
    notes: text("notes"),
    expectedCloseDate: date("expected_close_date"),
    status: dealStatusEnum("status").notNull().default("active"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_deals_account").on(table.accountId),
    index("idx_deals_pipeline").on(table.pipelineId),
    index("idx_deals_stage").on(table.stageId),
  ],
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
