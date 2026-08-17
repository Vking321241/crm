ALTER TABLE "accounts" ADD COLUMN "subscription_plan" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "subscription_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "subscription_renews_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "subscription_canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "kiwify_customer_email" text;