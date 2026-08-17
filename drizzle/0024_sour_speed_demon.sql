CREATE TABLE "birthday_monthly_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"group_contact_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collaborator_birthdays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" date NOT NULL,
	"phone" text,
	"group_contact_id" uuid,
	"last_greeted_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birthday_monthly_summaries" ADD CONSTRAINT "birthday_monthly_summaries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_monthly_summaries" ADD CONSTRAINT "birthday_monthly_summaries_group_contact_id_contacts_id_fk" FOREIGN KEY ("group_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborator_birthdays" ADD CONSTRAINT "collaborator_birthdays_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborator_birthdays" ADD CONSTRAINT "collaborator_birthdays_group_contact_id_contacts_id_fk" FOREIGN KEY ("group_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_birthday_summaries_group_month" ON "birthday_monthly_summaries" USING btree ("group_contact_id","year_month");--> statement-breakpoint
CREATE INDEX "idx_collaborator_birthdays_account" ON "collaborator_birthdays" USING btree ("account_id");