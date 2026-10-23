-- S83: one-time production roles and database, mirroring src/db/bootstrap.sql. Run once as the PostgreSQL
-- superuser with psql (`psql -v ON_ERROR_STOP=1 -f src/db/bootstrap-production.sql`), then set both role passwords
-- interactively with `\password "99ribu_production_owner"` and `\password "99ribu_production_app"` (psql sends a
-- SCRAM-SHA-256 verifier; no password is ever written in this file, a shell argument or history).
-- A second run stops at the first statement: both roles are created in one transaction, so nothing is half-created.
-- Partial failure: if CREATE DATABASE or a later statement fails on the FIRST run, the roles already exist. Inspect,
-- then either finish the remaining statements by hand or, while nothing else uses them, DROP DATABASE IF EXISTS
-- "99ribu_production" and DROP ROLE both roles before re-running. Never do that against a database holding data.
-- If the Postgres resource was created with its own POSTGRES_DB (Coolify sets one), also run, once:
--   REVOKE CONNECT ON DATABASE "<that database>" FROM PUBLIC;
-- Web and worker never use the superuser; migrations run as the owner role and grant only DML to the app role.
\set ON_ERROR_STOP on
SET password_encryption = 'scram-sha-256';
BEGIN;
CREATE ROLE "99ribu_production_owner" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE "99ribu_production_app" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
COMMIT;
CREATE DATABASE "99ribu_production" OWNER "99ribu_production_owner";
REVOKE CONNECT, TEMPORARY ON DATABASE "99ribu_production" FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE "99ribu_production" TO "99ribu_production_owner", "99ribu_production_app";
\connect 99ribu_production
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
