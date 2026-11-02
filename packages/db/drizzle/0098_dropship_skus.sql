CREATE TABLE "dropship_skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dropship_skus_channel_sku_key" UNIQUE("organization_id","channel_id","sku"),
	CONSTRAINT "dropship_skus_sku_present" CHECK (length(trim("dropship_skus"."sku")) > 0)
);
--> statement-breakpoint
ALTER TABLE "dropship_skus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dropship_skus" ADD CONSTRAINT "dropship_skus_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropship_skus" ADD CONSTRAINT "dropship_skus_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropship_skus" ADD CONSTRAINT "dropship_skus_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "dropship_skus_tenant_isolation" ON "dropship_skus" AS PERMISSIVE FOR ALL TO public USING ("dropship_skus"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("dropship_skus"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);