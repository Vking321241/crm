CREATE TYPE "public"."conversation_task_status" AS ENUM('pending', 'done');--> statement-breakpoint
CREATE TABLE "conversation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_by" uuid,
	"assigned_to" uuid,
	"note" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "conversation_task_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_channel_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text,
	"is_direct" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"sender_id" uuid,
	"content_text" text,
	"media_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"module" text NOT NULL,
	"can_access" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quick_replies" ADD COLUMN "shortcut" text;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_channel_members" ADD CONSTRAINT "internal_channel_members_channel_id_internal_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."internal_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_channel_members" ADD CONSTRAINT "internal_channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_channels" ADD CONSTRAINT "internal_channels_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_channels" ADD CONSTRAINT "internal_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_channel_id_internal_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."internal_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_tasks_account_due" ON "conversation_tasks" USING btree ("account_id","due_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_tasks_conversation" ON "conversation_tasks" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_internal_channel_members_unique" ON "internal_channel_members" USING btree ("channel_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_internal_channel_members_user" ON "internal_channel_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_internal_channels_account" ON "internal_channels" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_internal_messages_channel_created" ON "internal_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_permissions_unique" ON "user_permissions" USING btree ("user_id","module");--> statement-breakpoint
CREATE INDEX "idx_user_permissions_account" ON "user_permissions" USING btree ("account_id");--> statement-breakpoint
-- Backfill: every existing agent/viewer keeps the access they already
-- had under the old role-only model (inbox + tasks + internal chat +
-- contacts) so this migration doesn't silently lock anyone out.
-- Owner/admin rows are untouched — they bypass this table entirely
-- (see src/lib/auth/permissions.ts: roleHasFullAccess).
INSERT INTO "user_permissions" ("user_id", "account_id", "module", "can_access")
SELECT "id", "account_id", "module", true
FROM "users"
CROSS JOIN unnest(ARRAY['inbox', 'tasks', 'internal_chat', 'contacts']) AS "module"
WHERE "account_role" IN ('agent', 'viewer')
ON CONFLICT DO NOTHING;