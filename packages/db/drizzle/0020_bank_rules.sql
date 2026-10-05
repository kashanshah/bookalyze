CREATE TABLE "bank_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"match_text" text NOT NULL,
	"direction" text DEFAULT 'any' NOT NULL,
	"amount_min" numeric(20, 4),
	"amount_max" numeric(20, 4),
	"account_id" uuid,
	"category_account_id" uuid NOT NULL,
	"contact_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_rules_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_rules_direction_valid" CHECK ("bank_rules"."direction" in ('any', 'in', 'out')),
	CONSTRAINT "bank_rules_match_text_present" CHECK (length(trim("bank_rules"."match_text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "bank_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rule_applications" (
	"organization_id" uuid NOT NULL,
	"journal_entry_id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_category_fk" FOREIGN KEY ("organization_id","category_account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_applications" ADD CONSTRAINT "rule_applications_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_applications" ADD CONSTRAINT "rule_applications_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_applications" ADD CONSTRAINT "rule_applications_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."bank_rules"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_rules_org_position_idx" ON "bank_rules" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX "rule_applications_rule_idx" ON "rule_applications" USING btree ("rule_id");--> statement-breakpoint
CREATE POLICY "bank_rules_tenant_isolation" ON "bank_rules" AS PERMISSIVE FOR ALL TO public USING ("bank_rules"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("bank_rules"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rule_applications_tenant_isolation" ON "rule_applications" AS PERMISSIVE FOR ALL TO public USING ("rule_applications"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("rule_applications"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);