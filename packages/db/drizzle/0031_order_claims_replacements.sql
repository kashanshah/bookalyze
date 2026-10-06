ALTER TABLE "orders" ADD COLUMN "replaced_order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_claim" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finance_checked_at" timestamp with time zone;