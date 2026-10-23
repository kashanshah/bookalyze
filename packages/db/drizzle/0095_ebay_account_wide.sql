ALTER TABLE "ebay_transactions" ADD COLUMN "account_wide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Rows already in: the whole account's unless they're on an order Bookalyze has.
UPDATE "ebay_transactions" t SET "account_wide" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "orders" o
  JOIN "sales_channels" sc ON sc."id" = o."channel_id" AND sc."kind" = 'ebay'
  WHERE o."organization_id" = t."organization_id" AND o."external_id" = t."order_id"
);
