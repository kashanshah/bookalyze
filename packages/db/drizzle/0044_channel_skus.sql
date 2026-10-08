CREATE TABLE "channel_skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"title" text,
	"fulfillable" integer,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_skus_channel_sku_key" UNIQUE("channel_id","sku"),
	CONSTRAINT "channel_skus_sku_present" CHECK (length(trim("channel_skus"."sku")) > 0)
);
--> statement-breakpoint
ALTER TABLE "channel_skus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "skus_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_skus" ADD CONSTRAINT "channel_skus_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_skus" ADD CONSTRAINT "channel_skus_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_skus_org_idx" ON "channel_skus" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "channel_skus_tenant_isolation" ON "channel_skus" AS PERMISSIVE FOR ALL TO public USING ("channel_skus"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("channel_skus"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);