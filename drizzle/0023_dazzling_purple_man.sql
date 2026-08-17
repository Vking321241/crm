ALTER TABLE "contacts" ADD COLUMN "is_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;