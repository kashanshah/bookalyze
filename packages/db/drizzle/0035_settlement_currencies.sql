ALTER TABLE "settlement_settings" ADD COLUMN "auto_post" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "posted_fx_rate" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "payout_base_amount" numeric(20, 4);