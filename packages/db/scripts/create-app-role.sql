-- Run once per environment as the owner/admin role, replacing the password.
-- Creates the login role the app uses in DATABASE_URL.
CREATE ROLE bookalyze_app LOGIN PASSWORD 'change-me' NOBYPASSRLS;
GRANT app_runtime TO bookalyze_app;
