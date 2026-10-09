CREATE TABLE "noon_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"key" text NOT NULL,
	"contract" text,
	"reference_nr" text NOT NULL,
	"order_nr" text,
	"item_nr" text,
	"order_date" date,
	"transaction_date" date NOT NULL,
	"title" text,
	"sku" text,
	"partner_sku" text,
	"transaction_type" text NOT NULL,
	"currency" char(3) NOT NULL,
	"net_proceeds" numeric(20, 4) NOT NULL,
	"referral_fee" numeric(20, 4) NOT NULL,
	"fulfilment_fee" numeric(20, 4) NOT NULL,
	"shipping_credits" numeric(20, 4) NOT NULL,
	"other_order_fees" numeric(20, 4) NOT NULL,
	"order_subsidies" numeric(20, 4) NOT NULL,
	"non_order_fees" numeric(20, 4) NOT NULL,
	"non_order_subsidies" numeric(20, 4) NOT NULL,
	"others" numeric(20, 4) NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	"balanced" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "noon_transactions_channel_key" UNIQUE("organization_id","channel_id","key"),
	CONSTRAINT "noon_transactions_source_valid" CHECK ("noon_transactions"."source" in ('api', 'upload'))
);
--> statement-breakpoint
ALTER TABLE "noon_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "noon_transactions" ADD CONSTRAINT "noon_transactions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_transactions" ADD CONSTRAINT "noon_transactions_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "noon_transactions_channel_date_idx" ON "noon_transactions" USING btree ("organization_id","channel_id","transaction_date");--> statement-breakpoint
CREATE POLICY "noon_transactions_tenant_isolation" ON "noon_transactions" AS PERMISSIVE FOR ALL TO public USING ("noon_transactions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("noon_transactions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);