CREATE TABLE "reorder_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"lead_time_days" smallint NOT NULL,
	"cover_days" smallint NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reorder_settings_valid" CHECK ("reorder_settings"."lead_time_days" between 0 and 730 and "reorder_settings"."cover_days" between 1 and 730)
);
--> statement-breakpoint
ALTER TABLE "reorder_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "lead_time_days" smallint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "minimum_order" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "case_pack" integer;--> statement-breakpoint
ALTER TABLE "reorder_settings" ADD CONSTRAINT "reorder_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_settings" ADD CONSTRAINT "reorder_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_reorder_valid" CHECK (("products"."lead_time_days" is null or "products"."lead_time_days" between 0 and 730)
        and ("products"."minimum_order" is null or "products"."minimum_order" > 0)
        and ("products"."case_pack" is null or "products"."case_pack" > 0));--> statement-breakpoint
CREATE POLICY "reorder_settings_tenant_isolation" ON "reorder_settings" AS PERMISSIVE FOR ALL TO public USING ("reorder_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("reorder_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);