CREATE TABLE "listing_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"watch_id" uuid NOT NULL,
	"field" text NOT NULL,
	"summary" text NOT NULL,
	"before" text,
	"after" text,
	"checked_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "listing_changes_field_valid" CHECK ("listing_changes"."field" in ('content', 'images', 'price', 'featured', 'offers', 'rank', 'reviews'))
);
--> statement-breakpoint
ALTER TABLE "listing_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"asin" text NOT NULL,
	"title" text,
	"image_url" text,
	"checks" text[] NOT NULL,
	"cadence" text NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"observed" jsonb,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"last_change_summary" text,
	"last_change_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_watches_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "listing_watches_channel_asin_key" UNIQUE("organization_id","channel_id","asin"),
	CONSTRAINT "listing_watches_cadence_valid" CHECK ("listing_watches"."cadence" in ('hourly', 'daily', 'weekly')),
	CONSTRAINT "listing_watches_asin_valid" CHECK ("listing_watches"."asin" ~ '^[A-Z0-9]{10}$'),
	CONSTRAINT "listing_watches_checks_valid" CHECK (cardinality("listing_watches"."checks") > 0 and "listing_watches"."checks" <@ array['content','images','price','featured','offers','rank','reviews']::text[]),
	CONSTRAINT "listing_watches_hourly_valid" CHECK ("listing_watches"."cadence" <> 'hourly' or "listing_watches"."checks" <@ array['price','featured','offers']::text[])
);
--> statement-breakpoint
ALTER TABLE "listing_watches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listing_changes" ADD CONSTRAINT "listing_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_changes" ADD CONSTRAINT "listing_changes_watch_fk" FOREIGN KEY ("organization_id","watch_id") REFERENCES "public"."listing_watches"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_watches" ADD CONSTRAINT "listing_watches_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_watches" ADD CONSTRAINT "listing_watches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_watches" ADD CONSTRAINT "listing_watches_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_changes_watch_idx" ON "listing_changes" USING btree ("watch_id","checked_at");--> statement-breakpoint
CREATE INDEX "listing_changes_unnotified_idx" ON "listing_changes" USING btree ("organization_id","notified_at");--> statement-breakpoint
CREATE INDEX "listing_watches_org_idx" ON "listing_watches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "listing_watches_due_idx" ON "listing_watches" USING btree ("paused","next_check_at");--> statement-breakpoint
CREATE POLICY "listing_changes_tenant_isolation" ON "listing_changes" AS PERMISSIVE FOR ALL TO public USING ("listing_changes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("listing_changes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "listing_watches_tenant_isolation" ON "listing_watches" AS PERMISSIVE FOR ALL TO public USING ("listing_watches"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("listing_watches"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The hourly job checks products that are due. It only learns which companies, then opens each
-- one with the usual tenant scope.
CREATE OR REPLACE FUNCTION listing_watch_orgs() RETURNS TABLE (organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT organization_id FROM listing_watches
  WHERE paused = false AND next_check_at <= now()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION listing_watch_orgs() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION listing_watch_orgs() TO app_runtime;