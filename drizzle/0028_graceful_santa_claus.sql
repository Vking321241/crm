CREATE TABLE "birthday_settings" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"individual_message" text DEFAULT '🎉 Feliz aniversário, {nome}! Desejamos um ótimo dia. 🎂' NOT NULL,
	"monthly_message" text DEFAULT 'Aniversariantes de {mes}:

{lista}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birthday_settings" ADD CONSTRAINT "birthday_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;