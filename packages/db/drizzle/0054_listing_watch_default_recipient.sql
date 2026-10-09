-- Emails now go only to the addresses on each watch. Watches with email on and no address keep
-- emailing someone: whoever added the watch, or else the company's earliest owner.
UPDATE "listing_watches" w
SET "notify_emails" = ARRAY[lower(u."email")]
FROM "user" u
WHERE u."id" = w."created_by"
  AND w."notify"
  AND cardinality(w."notify_emails") = 0;
--> statement-breakpoint
UPDATE "listing_watches" w
SET "notify_emails" = ARRAY[(
  SELECT lower(u."email")
  FROM "member" m
  JOIN "user" u ON u."id" = m."user_id"
  WHERE m."organization_id" = w."organization_id" AND m."role" = 'owner'
  ORDER BY m."created_at"
  LIMIT 1
)]
WHERE w."notify"
  AND cardinality(w."notify_emails") = 0
  AND EXISTS (
    SELECT 1 FROM "member" m
    WHERE m."organization_id" = w."organization_id" AND m."role" = 'owner'
  );
