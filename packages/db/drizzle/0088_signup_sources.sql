CREATE TABLE "signup_sources" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"source" text,
	"medium" text,
	"campaign" text,
	"referrer" text,
	"landing" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signup_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signup_sources" ADD CONSTRAINT "signup_sources_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "signup_sources_insert" ON "signup_sources" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);--> statement-breakpoint
-- The admin Growth page's funnel: people who signed up in [p_from, p_to), and how far each got
-- with the first company they own. Totals only, never a person or a company; platform admins
-- (p_exclude, lower-case emails) aren't counted.
CREATE OR REPLACE FUNCTION platform_funnel(p_from timestamptz, p_to timestamptz, p_exclude text[])
RETURNS TABLE (
  signed_up bigint, verified bigint, with_company bigint, card_given bigint,
  trialing bigint, paying bigint, payment_failed bigint, cancelled bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cohort AS (
    SELECT u.id, u.email_verified FROM "user" u
    WHERE u.created_at >= p_from AND u.created_at < p_to AND lower(u.email) <> ALL (p_exclude)
  ), first_company AS (
    SELECT DISTINCT ON (c.id) c.id AS user_id, s.status, coalesce(s.cancel_at_period_end, false) AS ending
    FROM cohort c
    JOIN member m ON m.user_id = c.id AND m.role = 'owner'
    LEFT JOIN subscriptions s ON s.organization_id = m.organization_id
    ORDER BY c.id, m.created_at
  )
  SELECT
    (SELECT count(*) FROM cohort),
    (SELECT count(*) FROM cohort WHERE email_verified),
    count(*),
    count(*) FILTER (WHERE status IS NOT NULL AND status NOT IN ('incomplete', 'incomplete_expired')),
    count(*) FILTER (WHERE status = 'trialing' AND NOT ending),
    count(*) FILTER (WHERE status = 'active' AND NOT ending),
    count(*) FILTER (WHERE status IN ('past_due', 'unpaid')),
    count(*) FILTER (WHERE status = 'canceled' OR (ending AND status IN ('trialing', 'active')))
  FROM first_company
$$;
--> statement-breakpoint
-- The same people, by where they came from (utm source, else referring site, else Direct).
CREATE OR REPLACE FUNCTION platform_signup_sources(p_from timestamptz, p_to timestamptz, p_exclude text[])
RETURNS TABLE (source text, signed_up bigint, with_company bigint, card_given bigint, paying bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cohort AS (
    SELECT u.id, coalesce(src.source, src.referrer, 'Direct') AS source FROM "user" u
    LEFT JOIN signup_sources src ON src.user_id = u.id
    WHERE u.created_at >= p_from AND u.created_at < p_to AND lower(u.email) <> ALL (p_exclude)
  ), first_company AS (
    SELECT DISTINCT ON (c.id) c.id AS user_id, s.status, coalesce(s.cancel_at_period_end, false) AS ending
    FROM cohort c
    JOIN member m ON m.user_id = c.id AND m.role = 'owner'
    LEFT JOIN subscriptions s ON s.organization_id = m.organization_id
    ORDER BY c.id, m.created_at
  )
  SELECT c.source, count(*),
    count(f.user_id),
    count(*) FILTER (WHERE f.status IS NOT NULL AND f.status NOT IN ('incomplete', 'incomplete_expired')),
    count(*) FILTER (WHERE f.status = 'active' AND NOT f.ending)
  FROM cohort c LEFT JOIN first_company f ON f.user_id = c.id
  GROUP BY c.source
  ORDER BY count(*) DESC, c.source
$$;
