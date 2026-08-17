CREATE TYPE "public"."signup_lead_status" AS ENUM('new', 'contacted');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'signup_lead';--> statement-breakpoint
CREATE TABLE "signup_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"domain" text,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"status" "signup_lead_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_signup_leads_created" ON "signup_leads" USING btree ("created_at");