CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"transaction_type" text NOT NULL,
	"amount_type" text NOT NULL,
	"amount_description" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "settlement_lines_kind_key" UNIQUE("settlement_id","transaction_type","amount_type","amount_description")
);
--> statement-breakpoint
ALTER TABLE "settlement_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"channel_id" uuid,
	"external_id" text NOT NULL,
	"report_id" text,
	"source" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"deposit_date" date,
	"total" numeric(20, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"marketplace" text,
	"order_count" integer DEFAULT 0 NOT NULL,
	"balanced" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "settlements_org_external_key" UNIQUE("organization_id","external_id"),
	CONSTRAINT "settlements_source_valid" CHECK ("settlements"."source" in ('amazon', 'upload'))
);
--> statement-breakpoint
ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "settlements_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_fk" FOREIGN KEY ("organization_id","settlement_id") REFERENCES "public"."settlements"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlements_org_end_idx" ON "settlements" USING btree ("organization_id","end_at");--> statement-breakpoint
CREATE POLICY "settlement_lines_tenant_isolation" ON "settlement_lines" AS PERMISSIVE FOR ALL TO public USING ("settlement_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("settlement_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "settlements_tenant_isolation" ON "settlements" AS PERMISSIVE FOR ALL TO public USING ("settlements"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("settlements"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The daily job brings in settlement reports for every Amazon connection that has credentials.
CREATE OR REPLACE FUNCTION syncable_amazon_connections() RETURNS TABLE (organization_id uuid, connection_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organization_id, c.id FROM connections c
  WHERE c.provider = 'amazon_sp' AND c.status <> 'disconnected' AND c.secret IS NOT NULL
  ORDER BY c.settlements_synced_at NULLS FIRST
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION syncable_amazon_connections() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION syncable_amazon_connections() TO app_runtime;
