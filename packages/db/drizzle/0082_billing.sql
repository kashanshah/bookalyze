CREATE TABLE "billing_accounts" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"starts_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"stripe_item_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	CONSTRAINT "subscription_items_key_valid" CHECK ("subscription_items"."item_key" in ('books', 'seller', 'seller_plus', 'stock', 'reviews'))
);
--> statement-breakpoint
ALTER TABLE "subscription_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"interval" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"payment_failed_at" timestamp with time zone,
	"stripe_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_interval_valid" CHECK ("subscriptions"."interval" in ('month', 'year'))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."subscriptions"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_customer_key" ON "billing_accounts" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_items_key" ON "subscription_items" USING btree ("organization_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_key" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE POLICY "billing_accounts_read" ON "billing_accounts" AS PERMISSIVE FOR SELECT TO public USING ("billing_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "billing_accounts_insert" ON "billing_accounts" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("billing_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "billing_accounts_update" ON "billing_accounts" AS PERMISSIVE FOR UPDATE TO public USING ("billing_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on') WITH CHECK ("billing_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "billing_accounts_delete" ON "billing_accounts" AS PERMISSIVE FOR DELETE TO public USING ("billing_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "subscription_items_read" ON "subscription_items" AS PERMISSIVE FOR SELECT TO public USING ("subscription_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subscription_items_insert" ON "subscription_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("subscription_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "subscription_items_update" ON "subscription_items" AS PERMISSIVE FOR UPDATE TO public USING ("subscription_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on') WITH CHECK ("subscription_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "subscription_items_delete" ON "subscription_items" AS PERMISSIVE FOR DELETE TO public USING ("subscription_items"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "subscriptions_read" ON "subscriptions" AS PERMISSIVE FOR SELECT TO public USING ("subscriptions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_insert" ON "subscriptions" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("subscriptions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "subscriptions_update" ON "subscriptions" AS PERMISSIVE FOR UPDATE TO public USING ("subscriptions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on') WITH CHECK ("subscriptions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
CREATE POLICY "subscriptions_delete" ON "subscriptions" AS PERMISSIVE FOR DELETE TO public USING ("subscriptions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and current_setting('app.billing_writer', true) = 'on');--> statement-breakpoint
-- Stripe's invoice events name only the customer. This finds the company it belongs to, without
-- opening any tenant's rows.
CREATE OR REPLACE FUNCTION billing_org_for_customer(p_customer text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.organization_id FROM billing_accounts b WHERE b.stripe_customer_id = p_customer
$$;
