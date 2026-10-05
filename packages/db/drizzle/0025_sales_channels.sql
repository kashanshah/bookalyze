CREATE TABLE "sales_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"marketplace_id" text,
	"country" char(2),
	"currency" char(3) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_channels_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "sales_channels_connection_marketplace_key" UNIQUE("connection_id","marketplace_id"),
	CONSTRAINT "sales_channels_kind_valid" CHECK ("sales_channels"."kind" in ('amazon'))
);
--> statement-breakpoint
ALTER TABLE "sales_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_valid";--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_channels_org_idx" ON "sales_channels" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_valid" CHECK ("connections"."provider" in ('wise', 'csv', 'amazon_sp'));--> statement-breakpoint
CREATE POLICY "sales_channels_tenant_isolation" ON "sales_channels" AS PERMISSIVE FOR ALL TO public USING ("sales_channels"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("sales_channels"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The daily bank sync only covers bank connections; Amazon connections sync orders separately.
CREATE OR REPLACE FUNCTION syncable_connections() RETURNS TABLE (organization_id uuid, connection_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organization_id, c.id FROM connections c
  WHERE c.status <> 'disconnected' AND c.secret IS NOT NULL AND c.provider = 'wise'
  ORDER BY c.last_synced_at NULLS FIRST
$$;
