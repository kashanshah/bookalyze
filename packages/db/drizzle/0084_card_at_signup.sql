ALTER TABLE "billing_accounts" ALTER COLUMN "stripe_customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "card_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "trial_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_trial_days_valid" CHECK ("billing_accounts"."trial_days" between 0 and 90);