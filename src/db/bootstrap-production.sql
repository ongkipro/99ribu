-- S83: one-time production roles and database, mirroring src/db/bootstrap.sql. Run once as the PostgreSQL
-- superuser with psql (`psql -v ON_ERROR_STOP=1 -f src/db/bootstrap-production.sql`), then set both role passwords
-- interactively with `\password "99ribu_production_owner"` and `\password "99ribu_production_app"` (psql sends a
-- SCRAM-SHA-256 verifier; no password is ever written in this file, a shell argument or history).
-- A second run stops at the first statement: both roles are created in one transaction, so nothing is half-created.
-- Web and worker never use the superuser; migrations run as the owner role and grant only DML to the app role.
\set ON_ERROR_STOP on
SET password_encryption = 'scram-sha-256';
BEGIN;
CREATE ROLE "99ribu_production_owner" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE "99ribu_production_app" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
COMMIT;
CREATE DATABASE "99ribu_production" OWNER "99ribu_production_owner";
REVOKE CONNECT ON DATABASE "99ribu_production" FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE "99ribu_production" TO "99ribu_production_owner", "99ribu_production_app";
\connect 99ribu_production
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
