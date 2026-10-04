CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(7, 4) NOT NULL,
	"account_id" uuid NOT NULL,
	"is_recoverable" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "tax_rates_rate_range" CHECK ("tax_rates"."rate" >= 0 and "tax_rates"."rate" <= 100),
	CONSTRAINT "tax_rates_name_present" CHECK (length(trim("tax_rates"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"authority" text NOT NULL,
	"registration_number" text,
	"filing_frequency" text DEFAULT 'quarterly' NOT NULL,
	"effective_from" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_registrations_frequency_valid" CHECK ("tax_registrations"."filing_frequency" in ('monthly', 'quarterly', 'annual')),
	CONSTRAINT "tax_registrations_authority_present" CHECK (length(trim("tax_registrations"."authority")) > 0)
);
--> statement-breakpoint
ALTER TABLE "tax_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_org_name_key" ON "tax_rates" USING btree ("organization_id",lower("name"));--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tax_rate_fk" FOREIGN KEY ("organization_id","tax_rate_id") REFERENCES "public"."tax_rates"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_lines_org_tax_rate_idx" ON "journal_lines" USING btree ("organization_id","tax_rate_id");--> statement-breakpoint
CREATE POLICY "tax_rates_tenant_isolation" ON "tax_rates" AS PERMISSIVE FOR ALL TO public USING ("tax_rates"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("tax_rates"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tax_registrations_tenant_isolation" ON "tax_registrations" AS PERMISSIVE FOR ALL TO public USING ("tax_registrations"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("tax_registrations"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Posted transactions refer to tax rates, so a rate in use keeps its percentage, account and
-- recoverability (the sales tax report reads them). Rename or archive it instead.
CREATE OR REPLACE FUNCTION assert_tax_rate_terms_unchanged() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.rate <> OLD.rate OR NEW.account_id <> OLD.account_id
      OR NEW.is_recoverable <> OLD.is_recoverable)
     AND EXISTS (SELECT 1 FROM journal_lines WHERE tax_rate_id = OLD.id) THEN
    RAISE EXCEPTION 'Tax rate % is used by transactions; its terms can''t change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tax_rates_terms_unchanged
  BEFORE UPDATE ON tax_rates
  FOR EACH ROW EXECUTE FUNCTION assert_tax_rate_terms_unchanged();
