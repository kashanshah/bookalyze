-- withOrg() switches every tenant transaction to app_runtime (SET LOCAL ROLE), so row-level
-- security applies even when the app logs in as the owner (Vercel's Neon integration provides
-- only the owner login). The owner created app_runtime but, from Postgres 16, creating a role
-- doesn't grant the SET option on it. Grant it without INHERIT: the owner gains nothing else.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE 'GRANT app_runtime TO CURRENT_USER WITH INHERIT FALSE, SET TRUE';
  ELSE
    EXECUTE 'GRANT app_runtime TO CURRENT_USER';
  END IF;
END
$$;
