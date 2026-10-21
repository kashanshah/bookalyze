CREATE TABLE "ad_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"connection_id" uuid,
	"source" text NOT NULL,
	"account_ref" text DEFAULT '' NOT NULL,
	"country" char(2),
	"date" date NOT NULL,
	"ad_type" text NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text,
	"sku" text,
	"listing_ref" text,
	"currency" char(3) NOT NULL,
	"spend" numeric(20, 4) NOT NULL,
	"fx_rate" numeric(20, 10),
	"spend_base" numeric(20, 4),
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"attributed_sales" numeric(20, 4) DEFAULT '0' NOT NULL,
	"attributed_orders" integer DEFAULT 0 NOT NULL,
	"attributed_units" integer DEFAULT 0 NOT NULL,
	"attribution_window" text DEFAULT '' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_metrics_row_key" UNIQUE NULLS NOT DISTINCT("channel_id","source","ad_type","date","campaign_id","sku"),
	CONSTRAINT "ad_metrics_source_valid" CHECK ("ad_metrics"."source" in ('amazon_ads', 'upload')),
	CONSTRAINT "ad_metrics_ad_type_valid" CHECK ("ad_metrics"."ad_type" in ('sponsored_products', 'sponsored_brands', 'sponsored_display', 'promoted_listings', 'other')),
	CONSTRAINT "ad_metrics_counts_valid" CHECK ("ad_metrics"."impressions" >= 0 and "ad_metrics"."clicks" >= 0 and "ad_metrics"."attributed_orders" >= 0 and "ad_metrics"."attributed_units" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ad_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ad_report_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"account_ref" text NOT NULL,
	"ad_type" text NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"report_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"rows" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ad_report_requests_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "ad_report_requests_status_valid" CHECK ("ad_report_requests"."status" in ('pending', 'done', 'failed')),
	CONSTRAINT "ad_report_requests_dates_valid" CHECK ("ad_report_requests"."date_from" <= "ad_report_requests"."date_to")
);
--> statement-breakpoint
ALTER TABLE "ad_report_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_valid";--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_report_requests" ADD CONSTRAINT "ad_report_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_report_requests" ADD CONSTRAINT "ad_report_requests_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_report_requests" ADD CONSTRAINT "ad_report_requests_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_metrics_org_date_idx" ON "ad_metrics" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "ad_metrics_channel_sku_idx" ON "ad_metrics" USING btree ("organization_id","channel_id","sku");--> statement-breakpoint
CREATE INDEX "ad_report_requests_channel_idx" ON "ad_report_requests" USING btree ("organization_id","channel_id","ad_type");--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_valid" CHECK ("connections"."provider" in ('wise', 'csv', 'amazon_sp', 'noon', 'ebay', 'walmart', 'amazon_ads'));--> statement-breakpoint
CREATE POLICY "ad_metrics_tenant_isolation" ON "ad_metrics" AS PERMISSIVE FOR ALL TO public USING ("ad_metrics"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ad_metrics"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "ad_report_requests_tenant_isolation" ON "ad_report_requests" AS PERMISSIVE FOR ALL TO public USING ("ad_report_requests"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ad_report_requests"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);