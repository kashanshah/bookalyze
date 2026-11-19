-- The admin Overview dashboard: totals across the whole platform, never a person or a company.
-- Platform admins (p_exclude, lower-case emails) aren't counted, and neither are the companies
-- they own. A person is "active" on a day they signed in or changed something in a company.
CREATE OR REPLACE FUNCTION platform_overview(p_now timestamptz, p_exclude text[])
RETURNS TABLE (
  users bigint, verified_users bigint, signups_7d bigint, signups_30d bigint,
  active_1d bigint, active_7d bigint, active_30d bigint,
  companies bigint, companies_new_30d bigint, companies_active_30d bigint,
  trialing bigint, paying bigint, payment_failed bigint, cancelled bigint,
  api_keys_used_30d bigint, open_tickets bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH people AS (
    SELECT u.id, u.email_verified, u.created_at FROM "user" u
    WHERE lower(u.email) <> ALL (p_exclude)
  ), companies AS (
    SELECT o.id, o.created_at FROM organization o
    WHERE NOT EXISTS (
      SELECT 1 FROM member m JOIN "user" u ON u.id = m.user_id
      WHERE m.organization_id = o.id AND m.role = 'owner' AND lower(u.email) = ANY (p_exclude)
    )
  ), seen AS (
    SELECT s.user_id, greatest(s.created_at, s.updated_at) AS at FROM session s
    WHERE s.updated_at >= p_now - interval '30 days' OR s.created_at >= p_now - interval '30 days'
    UNION ALL
    SELECT a.actor_user_id, a.created_at FROM audit_logs a
    WHERE a.actor_user_id IS NOT NULL AND a.created_at >= p_now - interval '30 days'
  ), active AS (
    SELECT seen.user_id, max(seen.at) AS last_at FROM seen JOIN people p ON p.id = seen.user_id
    WHERE seen.at <= p_now GROUP BY seen.user_id
  ), latest_sub AS (
    SELECT DISTINCT ON (s.organization_id) s.status, coalesce(s.cancel_at_period_end, false) AS ending
    FROM subscriptions s JOIN companies c ON c.id = s.organization_id
    ORDER BY s.organization_id, s.stripe_updated_at DESC NULLS LAST
  )
  SELECT
    (SELECT count(*) FROM people WHERE created_at <= p_now),
    (SELECT count(*) FROM people WHERE created_at <= p_now AND email_verified),
    (SELECT count(*) FROM people WHERE created_at > p_now - interval '7 days' AND created_at <= p_now),
    (SELECT count(*) FROM people WHERE created_at > p_now - interval '30 days' AND created_at <= p_now),
    (SELECT count(*) FROM active WHERE last_at > p_now - interval '1 day'),
    (SELECT count(*) FROM active WHERE last_at > p_now - interval '7 days'),
    (SELECT count(*) FROM active),
    (SELECT count(*) FROM companies WHERE created_at <= p_now),
    (SELECT count(*) FROM companies WHERE created_at > p_now - interval '30 days' AND created_at <= p_now),
    (SELECT count(DISTINCT a.organization_id) FROM audit_logs a JOIN companies c ON c.id = a.organization_id
      WHERE a.created_at > p_now - interval '30 days' AND a.created_at <= p_now),
    (SELECT count(*) FROM latest_sub WHERE status = 'trialing' AND NOT ending),
    (SELECT count(*) FROM latest_sub WHERE status = 'active' AND NOT ending),
    (SELECT count(*) FROM latest_sub WHERE status IN ('past_due', 'unpaid')),
    (SELECT count(*) FROM latest_sub WHERE status = 'canceled' OR (ending AND status IN ('trialing', 'active'))),
    (SELECT count(*) FROM api_keys k JOIN people p ON p.id = k.user_id
      WHERE k.revoked_at IS NULL AND k.last_used_at > p_now - interval '30 days' AND k.last_used_at <= p_now),
    (SELECT count(*) FROM support_tickets t WHERE t.status IN ('open', 'waiting_on_us'))
$$;
--> statement-breakpoint
-- The same, day by day (UTC) for the p_days days up to p_now: sign-ups, active people (signed in
-- or changed something that day) and new companies.
CREATE OR REPLACE FUNCTION platform_daily(p_now timestamptz, p_days integer, p_exclude text[])
RETURNS TABLE (day date, signups bigint, active bigint, new_companies bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (
    SELECT generate_series(
      ((p_now AT TIME ZONE 'UTC')::date - (least(greatest(p_days, 1), 400) - 1)),
      (p_now AT TIME ZONE 'UTC')::date,
      interval '1 day'
    )::date AS day
  ), people AS (
    SELECT u.id, (u.created_at AT TIME ZONE 'UTC')::date AS day FROM "user" u
    WHERE lower(u.email) <> ALL (p_exclude)
  ), companies AS (
    SELECT (o.created_at AT TIME ZONE 'UTC')::date AS day FROM organization o
    WHERE NOT EXISTS (
      SELECT 1 FROM member m JOIN "user" u ON u.id = m.user_id
      WHERE m.organization_id = o.id AND m.role = 'owner' AND lower(u.email) = ANY (p_exclude)
    )
  ), since AS (
    SELECT min(day)::timestamp AT TIME ZONE 'UTC' AS at FROM days
  ), seen AS (
    SELECT s.user_id, (s.created_at AT TIME ZONE 'UTC')::date AS day FROM session s, since
    WHERE s.created_at >= since.at
    UNION
    SELECT s.user_id, (s.updated_at AT TIME ZONE 'UTC')::date FROM session s, since
    WHERE s.updated_at >= since.at
    UNION
    SELECT a.actor_user_id, (a.created_at AT TIME ZONE 'UTC')::date FROM audit_logs a, since
    WHERE a.actor_user_id IS NOT NULL AND a.created_at >= since.at
  )
  SELECT d.day,
    (SELECT count(*) FROM people p WHERE p.day = d.day),
    (SELECT count(DISTINCT seen.user_id) FROM seen JOIN people p ON p.id = seen.user_id WHERE seen.day = d.day),
    (SELECT count(*) FROM companies c WHERE c.day = d.day)
  FROM days d
  ORDER BY d.day
$$;
