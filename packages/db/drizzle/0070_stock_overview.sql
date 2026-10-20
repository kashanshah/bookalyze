CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"counted_on" date NOT NULL,
	"quantity" integer NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_quantity_valid" CHECK ("stock_counts"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_skus" ADD COLUMN "reserved" integer;--> statement-breakpoint
ALTER TABLE "channel_skus" ADD COLUMN "inbound" integer;--> statement-breakpoint
ALTER TABLE "channel_skus" ADD COLUMN "unfulfillable" integer;--> statement-breakpoint
ALTER TABLE "channel_skus" ADD COLUMN "researching" integer;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_counts_product_idx" ON "stock_counts" USING btree ("organization_id","product_id","counted_on");--> statement-breakpoint
CREATE POLICY "stock_counts_tenant_isolation" ON "stock_counts" AS PERMISSIVE FOR ALL TO public USING ("stock_counts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("stock_counts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);