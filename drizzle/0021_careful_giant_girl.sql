-- The "viewer" role no longer exists (no assignable role below
-- "agent" now). Reassign any existing viewer to agent *before* the
-- type swap below — the final USING cast would otherwise throw on
-- any row still holding a value the new enum doesn't have.
UPDATE "users" SET "account_role" = 'agent' WHERE "account_role" = 'viewer';--> statement-breakpoint
UPDATE "auth_tokens" SET "role" = 'agent' WHERE "role" = 'viewer';--> statement-breakpoint
ALTER TABLE "auth_tokens" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "account_role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."account_role";--> statement-breakpoint
CREATE TYPE "public"."account_role" AS ENUM('owner', 'manager', 'agent');--> statement-breakpoint
ALTER TABLE "auth_tokens" ALTER COLUMN "role" SET DATA TYPE "public"."account_role" USING "role"::"public"."account_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "account_role" SET DATA TYPE "public"."account_role" USING "account_role"::"public"."account_role";
