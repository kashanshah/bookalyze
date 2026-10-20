CREATE TABLE "organization_branding" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"accent_color" text,
	"footer" text,
	"name_arabic" text,
	"logo_attachment_id" uuid,
	"letterhead_attachment_id" uuid,
	"letterhead_top" smallint DEFAULT 120 NOT NULL,
	"letterhead_bottom" smallint DEFAULT 72 NOT NULL,
	"letterhead_pages" text DEFAULT 'first' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_branding_valid" CHECK (("organization_branding"."accent_color" is null or "organization_branding"."accent_color" ~ '^#[0-9A-F]{6}$')
        and "organization_branding"."letterhead_top" between 0 and 300 and "organization_branding"."letterhead_bottom" between 0 and 300
        and "organization_branding"."letterhead_pages" in ('first', 'all'))
);
--> statement-breakpoint
ALTER TABLE "organization_branding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_links" DROP CONSTRAINT "attachment_links_entity_type_valid";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "shipping_discount" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_logo_fk" FOREIGN KEY ("organization_id","logo_attachment_id") REFERENCES "public"."attachments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_letterhead_fk" FOREIGN KEY ("organization_id","letterhead_attachment_id") REFERENCES "public"."attachments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_links" ADD CONSTRAINT "attachment_links_entity_type_valid" CHECK ("attachment_links"."entity_type" in ('journal_entry', 'entity_document', 'brand_asset'));--> statement-breakpoint
CREATE POLICY "organization_branding_tenant_isolation" ON "organization_branding" AS PERMISSIVE FOR ALL TO public USING ("organization_branding"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("organization_branding"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);