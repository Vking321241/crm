-- Renaming the enum value (instead of drop+recreate) keeps every
-- existing row's role intact: whoever was 'admin' reads as 'manager'
-- immediately, no data migration/backfill needed. drizzle-kit's
-- default diff for a changed enum array drops and recreates the type,
-- which would throw on any pre-existing 'admin' row once cast back —
-- hand-written on purpose.
ALTER TYPE "public"."account_role" RENAME VALUE 'admin' TO 'manager';
