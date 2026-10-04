CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_date_base_quote_pk" PRIMARY KEY("date","base","quote"),
	CONSTRAINT "fx_rates_rate_positive" CHECK ("fx_rates"."rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "currency" char(3);--> statement-breakpoint
-- Existing lines are all in their entry's currency. Filling the new column changes no amounts, so
-- the balance check is paused for this one statement (otherwise its deferred events would block
-- the ALTER below).
ALTER TABLE "journal_lines" DISABLE TRIGGER "journal_lines_balanced";--> statement-breakpoint
UPDATE "journal_lines" l SET "currency" = e."currency" FROM "journal_entries" e WHERE e."id" = l."journal_entry_id";--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE TRIGGER "journal_lines_balanced";--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;