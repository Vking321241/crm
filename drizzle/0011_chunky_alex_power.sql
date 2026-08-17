CREATE TABLE "conversation_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"from_agent_id" uuid,
	"to_agent_id" uuid,
	"from_department_id" uuid,
	"to_department_id" uuid,
	"transferred_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_reply_settings" ADD COLUMN "auto_pause_outside_business_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "needs_acknowledgment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "acknowledgment_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "conversation_transfers" ADD CONSTRAINT "conversation_transfers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transfers" ADD CONSTRAINT "conversation_transfers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transfers" ADD CONSTRAINT "conversation_transfers_from_agent_id_users_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transfers" ADD CONSTRAINT "conversation_transfers_to_agent_id_users_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transfers" ADD CONSTRAINT "conversation_transfers_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transfers" ADD CONSTRAINT "conversation_transfers_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_transfers" ADD CONSTRAINT "conversation_transfers_transferred_by_users_id_fk" FOREIGN KEY ("transferred_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_transfers_account_created" ON "conversation_transfers" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_transfers_conversation" ON "conversation_transfers" USING btree ("conversation_id");