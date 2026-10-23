ALTER TABLE "listing_prices" ADD COLUMN "fees_price" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "listing_prices" ADD COLUMN "fees_referral" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "listing_prices" ADD COLUMN "fees_total" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "listing_prices" ADD COLUMN "fees_checked_at" timestamp with time zone;