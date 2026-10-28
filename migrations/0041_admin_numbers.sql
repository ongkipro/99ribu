-- S145 admin numeric ids (owner decision 2026-10-28): every entity with an admin detail page gets a stable,
-- immutable, unique `admin_no bigint GENERATED ALWAYS AS IDENTITY` so /admin/<area>/<number> replaces the UUID in the URL.
-- It is an admin-only handle: public order numbers and every UUID key stay as they are, and the API paths keep taking UUIDs.
--
-- Populated tables: the column is added nullable, existing rows are numbered once in creation order (created_at, id;
-- product by its first revision time; warehouse by physical order because it records no creation time), then the column
-- becomes NOT NULL + identity with the sequence moved past the highest number and a unique constraint. The backfill
-- UPDATE runs with the table's own user triggers disabled (finance/commerce guard and seal triggers reject writes outside
-- their transition rules); the same triggers are re-enabled before the migration ends. The whole file is one
-- transaction. Numbers are never reused: a deleted row leaves a gap, and `admin_no` cannot be changed afterwards
-- (guard trigger below; GENERATED ALWAYS already refuses an explicit value).
-- On a large database, schedule a quiet window: the backfill holds locks on all nine tables without a statement timeout.
--
-- Rollback (documented, not scripted): first DROP TRIGGER <t>_admin_no_guard ON app.<t> on all nine tables listed here,
-- then ALTER TABLE app.<t> DROP COLUMN admin_no on each (its identity sequence, unique constraint and index go with it),
-- then DROP FUNCTION app.guard_admin_no(). Alternatively DROP COLUMN admin_no CASCADE also drops its dependent trigger.
-- Numbers already printed in links or exports would be lost, so roll forward whenever the admin URLs have been shared.
CREATE FUNCTION app.guard_admin_no() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.admin_no IS DISTINCT FROM OLD.admin_no THEN RAISE EXCEPTION 'admin_no never changes' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
SET LOCAL statement_timeout = 0;
--> statement-breakpoint
ALTER TABLE "app"."warehouse" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."product" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."return_case" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."refund" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."affiliate_account" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."commerce_exception" DISABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."warehouse" t SET "admin_no"=o.n FROM (select ctid as c, row_number() over (order by ctid) as n from app.warehouse) o WHERE o.c=t.ctid;--> statement-breakpoint
ALTER TABLE "app"."warehouse" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.warehouse','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."warehouse";--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD CONSTRAINT "warehouse_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER warehouse_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."warehouse" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."product" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."product" t SET "admin_no"=o.n FROM (select p.id, row_number() over (order by (select min(r.created_at) from app.product_revision r where r.product_id=p.id) nulls last, p.id) as n from app.product p) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."product" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.product','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."product";--> statement-breakpoint
ALTER TABLE "app"."product" ADD CONSTRAINT "product_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER product_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."product" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."commerce_order" t SET "admin_no"=o.n FROM (select id, row_number() over (order by created_at, id) as n from app.commerce_order) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.commerce_order','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."commerce_order";--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER commerce_order_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."commerce_order" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."return_case" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."return_case" t SET "admin_no"=o.n FROM (select id, row_number() over (order by created_at, id) as n from app.return_case) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."return_case" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.return_case','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."return_case";--> statement-breakpoint
ALTER TABLE "app"."return_case" ADD CONSTRAINT "return_case_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER return_case_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."return_case" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."refund" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."refund" t SET "admin_no"=o.n FROM (select id, row_number() over (order by created_at, id) as n from app.refund) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."refund" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.refund','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."refund";--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER refund_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."refund" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."provider_settlement" t SET "admin_no"=o.n FROM (select id, row_number() over (order by created_at, id) as n from app.provider_settlement) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.provider_settlement','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."provider_settlement";--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER provider_settlement_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."provider_settlement" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."affiliate_account" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."affiliate_account" t SET "admin_no"=o.n FROM (select id, row_number() over (order by created_at, id) as n from app.affiliate_account) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."affiliate_account" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.affiliate_account','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."affiliate_account";--> statement-breakpoint
ALTER TABLE "app"."affiliate_account" ADD CONSTRAINT "affiliate_account_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER affiliate_account_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."affiliate_account" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."affiliate_payout" t SET "admin_no"=o.n FROM (select id, row_number() over (order by created_at, id) as n from app.affiliate_payout) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.affiliate_payout','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."affiliate_payout";--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout" ADD CONSTRAINT "affiliate_payout_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER affiliate_payout_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."affiliate_payout" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."commerce_exception" ADD COLUMN "admin_no" bigint;--> statement-breakpoint
UPDATE "app"."commerce_exception" t SET "admin_no"=o.n FROM (select id, row_number() over (order by created_at, id) as n from app.commerce_exception) o WHERE o.id=t.id;--> statement-breakpoint
ALTER TABLE "app"."commerce_exception" ALTER COLUMN "admin_no" SET NOT NULL, ALTER COLUMN "admin_no" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('app.commerce_exception','admin_no'), coalesce(max("admin_no"),1), max("admin_no") IS NOT NULL) FROM "app"."commerce_exception";--> statement-breakpoint
ALTER TABLE "app"."commerce_exception" ADD CONSTRAINT "commerce_exception_admin_no_unique" UNIQUE("admin_no");--> statement-breakpoint
CREATE TRIGGER commerce_exception_admin_no_guard BEFORE UPDATE OF admin_no ON "app"."commerce_exception" FOR EACH ROW EXECUTE FUNCTION app.guard_admin_no();--> statement-breakpoint
ALTER TABLE "app"."warehouse" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."product" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."return_case" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."refund" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."affiliate_account" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "app"."commerce_exception" ENABLE TRIGGER USER;
--> statement-breakpoint
RESET statement_timeout;
