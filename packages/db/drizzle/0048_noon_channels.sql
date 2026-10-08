ALTER TABLE "sales_channels" DROP CONSTRAINT "sales_channels_kind_valid";--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "fulfilment" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_channels_noon_marketplace_key" ON "sales_channels" USING btree ("organization_id","marketplace_id") WHERE "sales_channels"."kind" = 'noon';--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_fulfilment_valid" CHECK ("sales_channels"."fulfilment" is null or "sales_channels"."fulfilment" in ('marketplace', 'seller', 'both'));--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_kind_valid" CHECK ("sales_channels"."kind" in ('amazon', 'noon'));