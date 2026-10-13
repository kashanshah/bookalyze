CREATE TABLE "ebay_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"transaction_type" text NOT NULL,
	"status" text,
	"transaction_at" timestamp with time zone NOT NULL,
	"transaction_date" date NOT NULL,
	"order_id" text,
	"payout_id" text,
	"fee_type" text,
	"currency" char(3) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"fees" numeric(20, 4) NOT NULL,
	"ebay_tax" numeric(20, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebay_transactions_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "ebay_transactions_ebay_key" UNIQUE("organization_id","transaction_id","transaction_type")
);
--> statement-breakpoint
ALTER TABLE "ebay_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ebay_transactions" ADD CONSTRAINT "ebay_transactions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_transactions" ADD CONSTRAINT "ebay_transactions_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ebay_transactions_channel_date_idx" ON "ebay_transactions" USING btree ("organization_id","channel_id","transaction_date");--> statement-breakpoint
CREATE INDEX "ebay_transactions_order_idx" ON "ebay_transactions" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE POLICY "ebay_transactions_tenant_isolation" ON "ebay_transactions" AS PERMISSIVE FOR ALL TO public USING ("ebay_transactions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ebay_transactions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);