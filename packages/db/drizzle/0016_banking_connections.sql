CREATE TABLE "bank_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"currency" char(3) NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"sync_from" date NOT NULL,
	"synced_through" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_feeds_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_feeds_connection_external_key" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "bank_feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"secret" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "connections_provider_valid" CHECK ("connections"."provider" in ('wise')),
	CONSTRAINT "connections_status_valid" CHECK ("connections"."status" in ('active', 'error', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_bank_source_key" ON "journal_entries" USING btree ("organization_id","source_id") WHERE "journal_entries"."source" = 'bank_import';--> statement-breakpoint
CREATE POLICY "bank_feeds_tenant_isolation" ON "bank_feeds" AS PERMISSIVE FOR ALL TO public USING ("bank_feeds"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("bank_feeds"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "connections_tenant_isolation" ON "connections" AS PERMISSIVE FOR ALL TO public USING ("connections"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("connections"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The daily sync runs outside any one organization. It may learn which connections to sync
-- (organization and connection IDs, nothing else) and then works on each inside withOrg().
CREATE OR REPLACE FUNCTION syncable_connections() RETURNS TABLE (organization_id uuid, connection_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organization_id, c.id FROM connections c
  WHERE c.status <> 'disconnected' AND c.secret IS NOT NULL
  ORDER BY c.last_synced_at NULLS FIRST
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION syncable_connections() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION syncable_connections() TO app_runtime;
