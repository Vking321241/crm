CREATE TABLE "auto_reply_settings" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"welcome_enabled" boolean DEFAULT true NOT NULL,
	"welcome_message" text DEFAULT 'Olá! 👋 Obrigado por entrar em contato. Em instantes um de nossos atendentes vai te responder.' NOT NULL,
	"after_hours_enabled" boolean DEFAULT true NOT NULL,
	"after_hours_message" text DEFAULT 'No momento estamos fora do horário de atendimento. Deixe sua mensagem que responderemos assim que possível!' NOT NULL,
	"business_hours" jsonb DEFAULT '{"mon":{"enabled":true,"start":"09:00","end":"18:00"},"tue":{"enabled":true,"start":"09:00","end":"18:00"},"wed":{"enabled":true,"start":"09:00","end":"18:00"},"thu":{"enabled":true,"start":"09:00","end":"18:00"},"fri":{"enabled":true,"start":"09:00","end":"18:00"},"sat":{"enabled":false,"start":"09:00","end":"13:00"},"sun":{"enabled":false,"start":"09:00","end":"13:00"}}'::jsonb NOT NULL,
	"away_enabled" boolean DEFAULT false NOT NULL,
	"away_message" text DEFAULT 'Estamos temporariamente fora do ar. Assim que retornarmos, respondemos sua mensagem.' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_auto_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auto_reply_settings" ADD CONSTRAINT "auto_reply_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;