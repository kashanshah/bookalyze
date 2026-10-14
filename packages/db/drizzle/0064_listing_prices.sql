CREATE TABLE "listing_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"price" numeric(20, 4),
	"currency" char(3),
	"product_type" text,
	"status" text[] DEFAULT '{}'::text[] NOT NULL,
	"offer" jsonb,
	"problems" text[] DEFAULT '{}'::text[] NOT NULL,
	"found" boolean DEFAULT true NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_prices_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "listing_prices_channel_sku_key" UNIQUE("organization_id","channel_id","sku")
);
--> statement-breakpoint
ALTER TABLE "listing_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"currency" char(3) NOT NULL,
	"old_price" numeric(20, 4),
	"new_price" numeric(20, 4) NOT NULL,
	"status" text NOT NULL,
	"submission_id" text,
	"message" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	CONSTRAINT "price_changes_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "price_changes_status_valid" CHECK ("price_changes"."status" in ('sent', 'applied', 'refused')),
	CONSTRAINT "price_changes_price_positive" CHECK ("price_changes"."new_price" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listing_prices" ADD CONSTRAINT "listing_prices_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_prices" ADD CONSTRAINT "listing_prices_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_changes_channel_sku_idx" ON "price_changes" USING btree ("organization_id","channel_id","sku");--> statement-breakpoint
CREATE POLICY "listing_prices_tenant_isolation" ON "listing_prices" AS PERMISSIVE FOR ALL TO public USING ("listing_prices"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("listing_prices"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "price_changes_tenant_isolation" ON "price_changes" AS PERMISSIVE FOR ALL TO public USING ("price_changes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("price_changes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);