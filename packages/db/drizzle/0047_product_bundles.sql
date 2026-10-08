ALTER TABLE "product_skus" DROP CONSTRAINT "product_skus_channel_sku_key";--> statement-breakpoint
CREATE INDEX "product_skus_channel_sku_idx" ON "product_skus" USING btree ("organization_id","channel_id","sku");--> statement-breakpoint
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_channel_sku_product_key" UNIQUE("organization_id","channel_id","sku","product_id");