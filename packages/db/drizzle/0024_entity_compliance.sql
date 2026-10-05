CREATE TABLE "compliance_completions" (
	"organization_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"due_date" date NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_completions_key" UNIQUE("organization_id","item_key","due_date")
);
--> statement-breakpoint
ALTER TABLE "compliance_completions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "compliance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"first_due" date NOT NULL,
	"recurrence" text DEFAULT 'once' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_items_title_present" CHECK (length(trim("compliance_items"."title")) > 0),
	CONSTRAINT "compliance_items_recurrence_valid" CHECK ("compliance_items"."recurrence" in ('once', 'monthly', 'quarterly', 'yearly'))
);
--> statement-breakpoint
ALTER TABLE "compliance_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "compliance_reminders" (
	"organization_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"due_date" date NOT NULL,
	"lead_days" smallint NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_reminders_key" UNIQUE("organization_id","item_key","due_date","lead_days")
);
--> statement-breakpoint
ALTER TABLE "compliance_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_details" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"jurisdiction" text,
	"registered_address" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"expires_on" date,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_documents_title_present" CHECK (length(trim("entity_documents"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "entity_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"value" text NOT NULL,
	"expires_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_identifiers_value_present" CHECK (length(trim("entity_identifiers"."value")) > 0)
);
--> statement-breakpoint
ALTER TABLE "entity_identifiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"title" text,
	"ownership_percent" numeric(7, 4),
	"email" text,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_people_name_present" CHECK (length(trim("entity_people"."name")) > 0),
	CONSTRAINT "entity_people_ownership_range" CHECK ("entity_people"."ownership_percent" is null or ("entity_people"."ownership_percent" >= 0 and "entity_people"."ownership_percent" <= 100))
);
--> statement-breakpoint
ALTER TABLE "entity_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_links" DROP CONSTRAINT "attachment_links_entity_type_valid";--> statement-breakpoint
ALTER TABLE "compliance_completions" ADD CONSTRAINT "compliance_completions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_completions" ADD CONSTRAINT "compliance_completions_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reminders" ADD CONSTRAINT "compliance_reminders_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_details" ADD CONSTRAINT "entity_details_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_documents" ADD CONSTRAINT "entity_documents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_documents" ADD CONSTRAINT "entity_documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_documents" ADD CONSTRAINT "entity_documents_attachment_fk" FOREIGN KEY ("organization_id","attachment_id") REFERENCES "public"."attachments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifiers" ADD CONSTRAINT "entity_identifiers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_people" ADD CONSTRAINT "entity_people_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_items_org_idx" ON "compliance_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "entity_documents_org_idx" ON "entity_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "entity_identifiers_org_idx" ON "entity_identifiers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "entity_people_org_idx" ON "entity_people" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "attachment_links" ADD CONSTRAINT "attachment_links_entity_type_valid" CHECK ("attachment_links"."entity_type" in ('journal_entry', 'entity_document'));--> statement-breakpoint
CREATE POLICY "compliance_completions_tenant_isolation" ON "compliance_completions" AS PERMISSIVE FOR ALL TO public USING ("compliance_completions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("compliance_completions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "compliance_items_tenant_isolation" ON "compliance_items" AS PERMISSIVE FOR ALL TO public USING ("compliance_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("compliance_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "compliance_reminders_tenant_isolation" ON "compliance_reminders" AS PERMISSIVE FOR ALL TO public USING ("compliance_reminders"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("compliance_reminders"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entity_details_tenant_isolation" ON "entity_details" AS PERMISSIVE FOR ALL TO public USING ("entity_details"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("entity_details"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entity_documents_tenant_isolation" ON "entity_documents" AS PERMISSIVE FOR ALL TO public USING ("entity_documents"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("entity_documents"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entity_identifiers_tenant_isolation" ON "entity_identifiers" AS PERMISSIVE FOR ALL TO public USING ("entity_identifiers"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("entity_identifiers"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entity_people_tenant_isolation" ON "entity_people" AS PERMISSIVE FOR ALL TO public USING ("entity_people"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("entity_people"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);