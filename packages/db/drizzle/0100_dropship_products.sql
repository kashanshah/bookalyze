ALTER TABLE "products" ADD COLUMN "dropship" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "supplier_unit_cost" numeric(24, 4);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_supplier_idx" ON "products" USING btree ("organization_id","supplier_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_cost_valid" CHECK ("products"."supplier_unit_cost" is null or "products"."supplier_unit_cost" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_dropship_not_stocked" CHECK (not ("products"."dropship" and "products"."tracks_stock"));