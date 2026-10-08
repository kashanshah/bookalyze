CREATE TABLE "product_skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_skus_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "product_skus_channel_sku_key" UNIQUE("organization_id","channel_id","sku"),
	CONSTRAINT "product_skus_units_valid" CHECK ("product_skus"."units" between 1 and 1000),
	CONSTRAINT "product_skus_sku_present" CHECK (length(trim("product_skus"."sku")) > 0)
);
--> statement-breakpoint
ALTER TABLE "product_skus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"notes" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "products_name_present" CHECK (length(trim("products"."name")) > 0),
	CONSTRAINT "products_sku_present" CHECK ("products"."sku" is null or length(trim("products"."sku")) > 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_skus_product_idx" ON "product_skus" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_sku_key" ON "products" USING btree ("organization_id",lower("sku")) WHERE "products"."sku" is not null;--> statement-breakpoint
CREATE POLICY "product_skus_tenant_isolation" ON "product_skus" AS PERMISSIVE FOR ALL TO public USING ("product_skus"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("product_skus"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO public USING ("products"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("products"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);