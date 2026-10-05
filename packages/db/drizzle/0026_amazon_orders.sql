CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"asin" text,
	"sku" text,
	"title" text,
	"quantity_ordered" integer DEFAULT 0 NOT NULL,
	"quantity_shipped" integer DEFAULT 0 NOT NULL,
	"item_price" numeric(20, 4),
	"item_tax" numeric(20, 4),
	"shipping_price" numeric(20, 4),
	"shipping_tax" numeric(20, 4),
	"promotion_discount" numeric(20, 4),
	CONSTRAINT "order_items_order_external_key" UNIQUE("order_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"last_updated_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"fulfillment" text NOT NULL,
	"currency" char(3),
	"total" numeric(20, 4),
	"items_shipped" integer DEFAULT 0 NOT NULL,
	"items_unshipped" integer DEFAULT 0 NOT NULL,
	"ship_country" char(2),
	"ship_region" text,
	"is_business" boolean DEFAULT false NOT NULL,
	"is_prime" boolean DEFAULT false NOT NULL,
	"is_replacement" boolean DEFAULT false NOT NULL,
	"latest_delivery" date,
	"items_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "orders_channel_external_key" UNIQUE("channel_id","external_id"),
	CONSTRAINT "orders_fulfillment_valid" CHECK ("orders"."fulfillment" in ('amazon', 'merchant'))
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "orders_from" date;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "orders_synced_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "orders_next_token" text;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "orders_window_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_org_sku_idx" ON "order_items" USING btree ("organization_id","sku");--> statement-breakpoint
CREATE INDEX "orders_org_purchased_idx" ON "orders" USING btree ("organization_id","purchased_at");--> statement-breakpoint
CREATE POLICY "order_items_tenant_isolation" ON "order_items" AS PERMISSIVE FOR ALL TO public USING ("order_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("order_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO public USING ("orders"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("orders"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The daily job brings in orders for every channel someone started bringing orders in for.
CREATE OR REPLACE FUNCTION syncable_sales_channels() RETURNS TABLE (organization_id uuid, channel_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.organization_id, s.id FROM sales_channels s
  JOIN connections c ON c.id = s.connection_id AND c.organization_id = s.organization_id
  WHERE s.is_active AND s.orders_from IS NOT NULL
    AND c.status <> 'disconnected' AND c.secret IS NOT NULL
  ORDER BY s.orders_synced_through NULLS FIRST
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION syncable_sales_channels() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION syncable_sales_channels() TO app_runtime;
