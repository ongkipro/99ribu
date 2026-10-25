CREATE TABLE "app"."marketing_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"policy_version" text NOT NULL,
	"source" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "marketing_consent_value_check" CHECK ("app"."marketing_consent"."channel" IN ('whatsapp','email') AND "app"."marketing_consent"."source" IN ('account') AND char_length("app"."marketing_consent"."policy_version") between 1 and 64 AND ("app"."marketing_consent"."withdrawn_at" IS NULL OR "app"."marketing_consent"."withdrawn_at">="app"."marketing_consent"."granted_at"))
);
--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD COLUMN "birth_day" smallint;--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD COLUMN "birth_month" smallint;--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD COLUMN "birth_year" smallint;--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD COLUMN "favourite_category_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD COLUMN "details_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."marketing_consent" ADD CONSTRAINT "marketing_consent_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_consent_active_unique" ON "app"."marketing_consent" USING btree ("user_id","channel") WHERE "app"."marketing_consent"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "marketing_consent_user_idx" ON "app"."marketing_consent" USING btree ("user_id","granted_at");--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD CONSTRAINT "buyer_profile_birth_check" CHECK (("app"."buyer_profile"."birth_day" IS NULL)=("app"."buyer_profile"."birth_month" IS NULL) AND ("app"."buyer_profile"."birth_year" IS NULL OR "app"."buyer_profile"."birth_day" IS NOT NULL) AND ("app"."buyer_profile"."birth_month" IS NULL OR ("app"."buyer_profile"."birth_month" between 1 and 12 AND "app"."buyer_profile"."birth_day" between 1 and CASE WHEN "app"."buyer_profile"."birth_month"=2 THEN 29 WHEN "app"."buyer_profile"."birth_month" IN (4,6,9,11) THEN 30 ELSE 31 END)) AND ("app"."buyer_profile"."birth_year" IS NULL OR ("app"."buyer_profile"."birth_year" between 1900 and 2100 AND ("app"."buyer_profile"."birth_month"<>2 OR "app"."buyer_profile"."birth_day"<>29 OR ("app"."buyer_profile"."birth_year"%4=0 AND ("app"."buyer_profile"."birth_year"%100<>0 OR "app"."buyer_profile"."birth_year"%400=0))))));--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD CONSTRAINT "buyer_profile_details_check" CHECK (("app"."buyer_profile"."gender" IS NULL OR "app"."buyer_profile"."gender" IN ('male','female','undisclosed')) AND cardinality("app"."buyer_profile"."favourite_category_ids")<=5 AND array_position("app"."buyer_profile"."favourite_category_ids",NULL) IS NULL AND "app"."buyer_profile"."details_revision">0);--> statement-breakpoint
-- S126/DEC-017 (expand-only; the trigger is hand-written and outside the Drizzle snapshot). A consent row is the
-- record of one grant: identity, channel, policy version, source and grant time never change, and the only update
-- stamps withdrawn_at once (re-granting appends a new row). DELETE stays possible for account erasure (UU PDP).
CREATE FUNCTION app.guard_marketing_consent() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'A consent starts granted' USING ERRCODE='23514'; END IF;
  NEW.granted_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.channel<>OLD.channel OR NEW.policy_version<>OLD.policy_version
  OR NEW.source<>OLD.source OR NEW.granted_at<>OLD.granted_at OR OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL THEN
  RAISE EXCEPTION 'A consent record only gains its withdrawal time' USING ERRCODE='23514';
 END IF;
 NEW.withdrawn_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER marketing_consent_guard BEFORE INSERT OR UPDATE ON app.marketing_consent FOR EACH ROW EXECUTE FUNCTION app.guard_marketing_consent();
