CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"tax_number" text,
	"address" text,
	"notes" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "contacts_type_valid" CHECK ("contacts"."type" in ('customer', 'vendor', 'both')),
	CONSTRAINT "contacts_name_present" CHECK (length(trim("contacts"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_type_name_key" ON "contacts" USING btree ("organization_id","type",lower("name"));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_org_contact_idx" ON "journal_entries" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE POLICY "contacts_tenant_isolation" ON "contacts" AS PERMISSIVE FOR ALL TO public USING ("contacts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("contacts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);