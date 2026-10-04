CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text NOT NULL,
	"description" text,
	"currency" char(3),
	"system_key" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "accounts_org_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "accounts_org_system_key_key" UNIQUE("organization_id","system_key"),
	CONSTRAINT "accounts_type_valid" CHECK ("accounts"."type" in ('asset', 'liability', 'equity', 'income', 'expense')),
	CONSTRAINT "accounts_subtype_valid" CHECK ("accounts"."subtype" in ('cash_bank', 'money_in_transit', 'accounts_receivable', 'inventory', 'fixed_assets', 'accumulated_depreciation', 'vendor_prepayments', 'other_current_asset', 'other_long_term_asset', 'credit_card', 'loan', 'accounts_payable', 'sales_tax', 'payroll_liability', 'due_to_owners', 'customer_prepayments', 'other_current_liability', 'other_long_term_liability', 'owner_equity', 'retained_earnings', 'income', 'discount', 'other_income', 'uncategorized_income', 'fx_gain', 'operating_expense', 'cost_of_goods_sold', 'payment_processing_fee', 'payroll_expense', 'uncategorized_expense', 'fx_loss')),
	CONSTRAINT "accounts_system_key_valid" CHECK ("accounts"."system_key" is null or "accounts"."system_key" in ('accounts_receivable', 'accounts_payable', 'retained_earnings', 'uncategorized_income', 'uncategorized_expense', 'fx_gain', 'fx_loss')),
	CONSTRAINT "accounts_name_present" CHECK (length(trim("accounts"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entry_number" integer NOT NULL,
	"date" date NOT NULL,
	"reference" text,
	"memo" text,
	"currency" char(3) NOT NULL,
	"fx_rate" numeric(20, 10) DEFAULT '1' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"reverses_entry_id" uuid,
	"reversed_by_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "journal_entries_org_number_key" UNIQUE("organization_id","entry_number"),
	CONSTRAINT "journal_entries_fx_rate_positive" CHECK ("journal_entries"."fx_rate" > 0),
	CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import'))
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text,
	"amount" numeric(20, 4) NOT NULL,
	"base_amount" numeric(20, 4) NOT NULL,
	CONSTRAINT "journal_lines_entry_line_key" UNIQUE("journal_entry_id","line_no"),
	CONSTRAINT "journal_lines_amount_nonzero" CHECK ("journal_lines"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_fk" FOREIGN KEY ("organization_id","reverses_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_fk" FOREIGN KEY ("organization_id","reversed_by_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_idx" ON "journal_lines" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE POLICY "accounts_tenant_isolation" ON "accounts" AS PERMISSIVE FOR ALL TO public USING ("accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "journal_entries_tenant_isolation" ON "journal_entries" AS PERMISSIVE FOR ALL TO public USING ("journal_entries"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("journal_entries"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "journal_lines_tenant_isolation" ON "journal_lines" AS PERMISSIVE FOR ALL TO public USING ("journal_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("journal_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);