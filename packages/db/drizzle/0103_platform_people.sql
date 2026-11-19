-- The admin People list: everyone who signed up in [p_from, p_to), newest first, with what a
-- platform admin needs to see how sign-ups are going: how they signed up, whether they confirmed
-- their email, their first company (name, country) and its plan, where they came from, and when
-- they were last active. Never any of a company's books. p_search matches name or email; platform
-- admins (p_exclude, lower-case emails) are left out. `total` is the number of matching people.
CREATE OR REPLACE FUNCTION platform_people(
  p_from timestamptz, p_to timestamptz, p_exclude text[], p_search text, p_limit integer, p_offset integer
)
RETURNS TABLE (
  user_id uuid, name text, email text, signed_up_at timestamptz, email_verified boolean,
  sign_in text, source text, medium text, campaign text, landing text,
  companies bigint, company_name text, company_country text, company_created_at timestamptz,
  plan_status text, plan_ending boolean, last_seen_at timestamptz, changes_30d bigint, total bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH people AS (
    SELECT u.id, u.name, u.email, u.created_at, u.email_verified FROM "user" u
    WHERE u.created_at >= p_from AND u.created_at < p_to
      AND lower(u.email) <> ALL (p_exclude)
      AND (coalesce(p_search, '') = ''
        OR u.email ILIKE '%' || p_search || '%' OR u.name ILIKE '%' || p_search || '%')
  ), page AS (
    SELECT p.*, count(*) OVER () AS total FROM people p
    ORDER BY p.created_at DESC, p.id
    LIMIT least(greatest(p_limit, 1), 200) OFFSET greatest(p_offset, 0)
  )
  SELECT
    p.id, p.name, p.email, p.created_at, p.email_verified,
    (SELECT string_agg(DISTINCT CASE a.provider_id WHEN 'credential' THEN 'email' ELSE a.provider_id END, ', ')
      FROM account a WHERE a.user_id = p.id),
    src.source, src.medium, src.campaign, coalesce(src.landing, src.referrer),
    (SELECT count(*) FROM member m WHERE m.user_id = p.id),
    first_co.name, first_co.country_code, first_co.created_at,
    sub.status, coalesce(sub.cancel_at_period_end, false),
    greatest(
      (SELECT max(greatest(s.created_at, s.updated_at)) FROM session s WHERE s.user_id = p.id),
      (SELECT max(al.created_at) FROM audit_logs al WHERE al.actor_user_id = p.id)
    ),
    (SELECT count(*) FROM audit_logs al
      WHERE al.actor_user_id = p.id AND al.created_at > now() - interval '30 days'),
    p.total
  FROM page p
  LEFT JOIN signup_sources src ON src.user_id = p.id
  LEFT JOIN LATERAL (
    SELECT o.id, o.name, o.created_at, op.country_code FROM member m
    JOIN organization o ON o.id = m.organization_id
    LEFT JOIN organization_profiles op ON op.organization_id = o.id
    WHERE m.user_id = p.id
    ORDER BY (m.role = 'owner') DESC, m.created_at
    LIMIT 1
  ) first_co ON true
  LEFT JOIN LATERAL (
    SELECT s.status, s.cancel_at_period_end FROM subscriptions s
    WHERE s.organization_id = first_co.id
    ORDER BY s.stripe_updated_at DESC NULLS LAST
    LIMIT 1
  ) sub ON true
  ORDER BY p.created_at DESC, p.id
$$;
--> statement-breakpoint
-- The same people as totals for the summary above the list: how many, confirmed, with a company,
-- by sign-in method and by country of their first company.
CREATE OR REPLACE FUNCTION platform_people_summary(p_from timestamptz, p_to timestamptz, p_exclude text[])
RETURNS TABLE (kind text, label text, people bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH people AS (
    SELECT u.id, u.email_verified FROM "user" u
    WHERE u.created_at >= p_from AND u.created_at < p_to AND lower(u.email) <> ALL (p_exclude)
  ), country AS (
    SELECT DISTINCT ON (p.id) p.id, op.country_code FROM people p
    JOIN member m ON m.user_id = p.id
    LEFT JOIN organization_profiles op ON op.organization_id = m.organization_id
    ORDER BY p.id, (m.role = 'owner') DESC, m.created_at
  ), method AS (
    SELECT p.id, coalesce(string_agg(DISTINCT CASE a.provider_id WHEN 'credential' THEN 'email' ELSE a.provider_id END, ', '), 'none') AS m
    FROM people p LEFT JOIN account a ON a.user_id = p.id GROUP BY p.id
  )
  SELECT 'total', 'People', count(*) FROM people
  UNION ALL SELECT 'total', 'Confirmed their email', count(*) FILTER (WHERE email_verified) FROM people
  UNION ALL SELECT 'total', 'Set up a company', count(*) FROM country
  UNION ALL SELECT 'method', m, count(*) FROM method GROUP BY m
  UNION ALL SELECT 'country', coalesce(country_code, '–'), count(*) FROM country GROUP BY country_code
$$;
