DROP TABLE "deals" CASCADE;--> statement-breakpoint
DROP TABLE "pipeline_stages" CASCADE;--> statement-breakpoint
DROP TABLE "pipelines" CASCADE;--> statement-breakpoint
ALTER TABLE "automation_steps" ALTER COLUMN "step_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."automation_step_type";--> statement-breakpoint
CREATE TYPE "public"."automation_step_type" AS ENUM('send_message', 'send_buttons', 'send_list', 'send_template', 'add_tag', 'remove_tag', 'assign_conversation', 'update_contact_field', 'wait', 'condition', 'send_webhook', 'close_conversation');--> statement-breakpoint
ALTER TABLE "automation_steps" ALTER COLUMN "step_type" SET DATA TYPE "public"."automation_step_type" USING "step_type"::"public"."automation_step_type";--> statement-breakpoint
DROP TYPE "public"."deal_status";