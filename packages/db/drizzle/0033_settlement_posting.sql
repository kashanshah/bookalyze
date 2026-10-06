CREATE TABLE "settlement_accounts" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_accounts_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
ALTER TABLE "settlement_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settlement_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"post_from" date NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD CONSTRAINT "settlement_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD CONSTRAINT "settlement_accounts_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_settings" ADD CONSTRAINT "settlement_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_settings" ADD CONSTRAINT "settlement_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_journal_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import', 'settlement'));--> statement-breakpoint
CREATE POLICY "settlement_accounts_tenant_isolation" ON "settlement_accounts" AS PERMISSIVE FOR ALL TO public USING ("settlement_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("settlement_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "settlement_settings_tenant_isolation" ON "settlement_settings" AS PERMISSIVE FOR ALL TO public USING ("settlement_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("settlement_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);