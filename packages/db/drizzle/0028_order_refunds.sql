CREATE TABLE "order_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"sku" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" char(3),
	CONSTRAINT "order_refunds_order_external_key" UNIQUE("order_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "order_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_refund_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "refunds_synced_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "refunds_next_token" text;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "refunds_window_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "order_refunds_tenant_isolation" ON "order_refunds" AS PERMISSIVE FOR ALL TO public USING ("order_refunds"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("order_refunds"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);