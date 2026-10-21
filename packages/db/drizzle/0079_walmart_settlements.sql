CREATE TABLE "walmart_settlement_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "walmart_settlement_rows_line_key" UNIQUE("settlement_id","line")
);
--> statement-breakpoint
ALTER TABLE "walmart_settlement_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "walmart_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"period_from" date,
	"period_to" date,
	"currency" char(3),
	"payout" numeric(20, 4),
	"rows" integer NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brought_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "walmart_settlements_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "walmart_settlements_channel_date_key" UNIQUE("organization_id","channel_id","report_date"),
	CONSTRAINT "walmart_settlements_rows_valid" CHECK ("walmart_settlements"."rows" >= 0)
);
--> statement-breakpoint
ALTER TABLE "walmart_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "walmart_settlement_rows" ADD CONSTRAINT "walmart_settlement_rows_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settlement_rows" ADD CONSTRAINT "walmart_settlement_rows_settlement_fk" FOREIGN KEY ("organization_id","settlement_id") REFERENCES "public"."walmart_settlements"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD CONSTRAINT "walmart_settlements_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD CONSTRAINT "walmart_settlements_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "walmart_settlement_rows_org_idx" ON "walmart_settlement_rows" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "walmart_settlement_rows_tenant_isolation" ON "walmart_settlement_rows" AS PERMISSIVE FOR ALL TO public USING ("walmart_settlement_rows"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("walmart_settlement_rows"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "walmart_settlements_tenant_isolation" ON "walmart_settlements" AS PERMISSIVE FOR ALL TO public USING ("walmart_settlements"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("walmart_settlements"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);