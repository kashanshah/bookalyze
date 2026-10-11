CREATE TABLE "noon_stock_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"date" date NOT NULL,
	"location" text NOT NULL,
	"sku" text NOT NULL,
	"nfsku" text,
	"condition" text NOT NULL,
	"opening" integer NOT NULL,
	"closing" integer NOT NULL,
	"movements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "noon_stock_days_key" UNIQUE("organization_id","date","location","sku","condition")
);
--> statement-breakpoint
ALTER TABLE "noon_stock_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "noon_stock_days" ADD CONSTRAINT "noon_stock_days_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "noon_stock_days_sku_idx" ON "noon_stock_days" USING btree ("organization_id","sku","date");--> statement-breakpoint
CREATE POLICY "noon_stock_days_tenant_isolation" ON "noon_stock_days" AS PERMISSIVE FOR ALL TO public USING ("noon_stock_days"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("noon_stock_days"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);