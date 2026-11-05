ALTER TABLE "app"."role_grant" DROP CONSTRAINT "role_grant_roles_check";--> statement-breakpoint
ALTER TABLE "app"."promotion" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "app"."promotion_version" ADD COLUMN "proposed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_code_unique" ON "app"."promotion" USING btree ("code");--> statement-breakpoint
ALTER TABLE "app"."promotion" ADD CONSTRAINT "promotion_code_check" CHECK ("app"."promotion"."code" IS NULL OR "app"."promotion"."code" ~ '^[A-Z0-9][A-Z0-9-]{2,31}$');--> statement-breakpoint
ALTER TABLE "app"."promotion_version" ADD CONSTRAINT "promotion_version_proposal_check" CHECK (NOT ("app"."promotion_version"."proposed" AND "app"."promotion_version"."active"));--> statement-breakpoint
ALTER TABLE "app"."role_grant" ADD CONSTRAINT "role_grant_roles_check" CHECK ("app"."role_grant"."roles" <@ ARRAY['owner','ecommerce_admin','marketing','warehouse','customer_service','finance','buyer','affiliate']::text[] AND array_position("app"."role_grant"."roles", NULL) IS NULL);--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_promotion_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v app.promotion_version; m app.promotion_movement;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Promotion identity is permanent' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.configuration_revision<>0 OR NEW.budget_revision<>0 OR NEW.reserved_amount<>0 OR NEW.committed_amount<>0 THEN
      RAISE EXCEPTION 'Promotion starts empty' USING ERRCODE='23514'; END IF;
    NEW.created_at:=clock_timestamp(); RETURN NEW;
  END IF;
  IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Immutable promotion identity' USING ERRCODE='23514'; END IF;
  IF NEW.configuration_revision=OLD.configuration_revision+1 AND NEW.budget_revision=OLD.budget_revision
    AND NEW.reserved_amount=OLD.reserved_amount AND NEW.committed_amount=OLD.committed_amount THEN
    SELECT * INTO v FROM app.promotion_version WHERE promotion_id=NEW.id AND revision=NEW.configuration_revision;
    IF v.id IS NULL OR v.budget::numeric<NEW.reserved_amount::numeric+NEW.committed_amount::numeric THEN
      RAISE EXCEPTION 'Unfunded promotion configuration' USING ERRCODE='23514'; END IF;
  ELSIF NEW.configuration_revision=OLD.configuration_revision AND NEW.budget_revision=OLD.budget_revision+1 THEN
    SELECT * INTO m FROM app.promotion_movement WHERE promotion_id=NEW.id AND budget_revision=NEW.budget_revision;
    IF m.id IS NULL OR NEW.reserved_amount::numeric<>OLD.reserved_amount::numeric+m.reserved_delta::numeric
      OR NEW.committed_amount::numeric<>OLD.committed_amount::numeric+m.committed_delta::numeric THEN
      RAISE EXCEPTION 'Promotion counter requires exact movement' USING ERRCODE='23514'; END IF;
    SELECT * INTO v FROM app.promotion_version WHERE promotion_id=NEW.id AND revision=NEW.configuration_revision;
    IF NEW.reserved_amount::numeric+NEW.committed_amount::numeric>v.budget THEN RAISE EXCEPTION 'Campaign budget exceeded' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid promotion head transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
