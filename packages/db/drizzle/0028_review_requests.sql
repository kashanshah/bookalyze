CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"due_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_requests_order_key" UNIQUE("order_id"),
	CONSTRAINT "review_requests_status_valid" CHECK ("review_requests"."status" in ('scheduled', 'sent', 'skipped', 'not_eligible', 'failed')),
	CONSTRAINT "review_requests_source_valid" CHECK ("review_requests"."source" in ('auto', 'manual', 'bulk'))
);
--> statement-breakpoint
ALTER TABLE "review_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"days_after_delivery" integer DEFAULT 7 NOT NULL,
	"send_hour" integer DEFAULT 10 NOT NULL,
	"send_days" integer[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL,
	"channel_ids" uuid[],
	"fulfillment" text DEFAULT 'all' NOT NULL,
	"skip_refunded" boolean DEFAULT true NOT NULL,
	"skip_replacements" boolean DEFAULT true NOT NULL,
	"skip_business" boolean DEFAULT false NOT NULL,
	"skip_promotions" boolean DEFAULT false NOT NULL,
	"excluded_skus" text[] DEFAULT '{}' NOT NULL,
	"starts_from" date,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_settings_days_valid" CHECK ("review_settings"."days_after_delivery" between 5 and 25),
	CONSTRAINT "review_settings_hour_valid" CHECK ("review_settings"."send_hour" between 0 and 23),
	CONSTRAINT "review_settings_fulfillment_valid" CHECK ("review_settings"."fulfillment" in ('all', 'amazon', 'merchant'))
);
--> statement-breakpoint
ALTER TABLE "review_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "earliest_delivery" date;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_settings" ADD CONSTRAINT "review_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_settings" ADD CONSTRAINT "review_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_requests_due_idx" ON "review_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "review_requests_org_status_idx" ON "review_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE POLICY "review_requests_tenant_isolation" ON "review_requests" AS PERMISSIVE FOR ALL TO public USING ("review_requests"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("review_requests"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "review_settings_tenant_isolation" ON "review_settings" AS PERMISSIVE FOR ALL TO public USING ("review_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("review_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The hourly job plans and sends review requests for companies that turned them on, plus any
-- company with a request that's due.
CREATE OR REPLACE FUNCTION review_request_orgs() RETURNS TABLE (organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.organization_id FROM review_settings s WHERE s.enabled
  UNION
  SELECT r.organization_id FROM review_requests r WHERE r.status = 'scheduled' AND r.due_at <= now()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION review_request_orgs() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION review_request_orgs() TO app_runtime;