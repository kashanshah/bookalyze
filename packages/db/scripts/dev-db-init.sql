-- Local/CI database bootstrap (run once as a superuser). Not for production: see docs/SETUP.md.
CREATE ROLE bookalyze_owner LOGIN PASSWORD 'bookalyze_owner' CREATEROLE;
CREATE ROLE bookalyze_app LOGIN PASSWORD 'bookalyze_app' NOBYPASSRLS;
CREATE DATABASE bookalyze OWNER bookalyze_owner;
CREATE DATABASE bookalyze_test OWNER bookalyze_owner;
