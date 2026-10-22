CREATE TABLE "app"."manual_bank_reference" (
	"account_number" text NOT NULL,
	"reference_key" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "manual_bank_reference_pk" PRIMARY KEY("account_number","reference_key"),
	CONSTRAINT "manual_bank_reference_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "manual_bank_reference_value_check" CHECK ("app"."manual_bank_reference"."account_number" ~ '^[0-9]{6,20}$' AND "app"."manual_bank_reference"."reference_key" ~ '^[A-Z0-9][A-Z0-9_./:-]{2,79}$')
);
--> statement-breakpoint
ALTER TABLE "app"."autolaris_callback" DROP CONSTRAINT "autolaris_callback_value_check";--> statement-breakpoint
ALTER TABLE "app"."autolaris_callback" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."manual_bank_reference" ADD CONSTRAINT "manual_bank_reference_attempt_id_manual_bank_confirmation_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."manual_bank_confirmation"("attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."autolaris_callback" ADD CONSTRAINT "autolaris_callback_value_check" CHECK (char_length("app"."autolaris_callback"."content_type") between 0 and 120 AND octet_length("app"."autolaris_callback"."body") between 0 and 16384 AND "app"."autolaris_callback"."body_sha256" ~ '^[0-9a-f]{64}$' AND ("app"."autolaris_callback"."redacted_at" IS NULL OR "app"."autolaris_callback"."body"=''));--> statement-breakpoint
-- R4 (S92 finding 1): a bank reference row binds one confirmation; the key is the
-- confirmation's own reference, trimmed and upper-cased, and the receiving account must
-- be one of the accounts pinned by the order's payment policy version.
CREATE FUNCTION app.guard_manual_bank_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.manual_bank_confirmation; v_accounts jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Manual bank references are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM app.manual_bank_confirmation WHERE attempt_id=NEW.attempt_id;
 IF c.attempt_id IS NULL THEN RAISE EXCEPTION 'A bank reference binds one manual-bank confirmation' USING ERRCODE='23514'; END IF;
 SELECT v.values->'manual_bank_accounts' INTO v_accounts FROM app.payment_attempt a JOIN app.commerce_order o ON o.id=a.order_id
  JOIN app.policy_version v ON v.id=o.payment_policy_version_id WHERE a.id=NEW.attempt_id;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(v_accounts,'[]'::jsonb)) x WHERE x->>'account_number'=NEW.account_number)
 THEN RAISE EXCEPTION 'The receiving account must be one of the order''s pinned company accounts' USING ERRCODE='23514'; END IF;
 NEW.reference_key:=upper(btrim(c.bank_reference));NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER manual_bank_reference_guard BEFORE INSERT OR UPDATE OR DELETE ON app.manual_bank_reference FOR EACH ROW EXECUTE FUNCTION app.guard_manual_bank_reference();
--> statement-breakpoint
-- Every new confirmation must claim its bank reference in the same transaction.
CREATE FUNCTION app.seal_manual_bank_confirmation_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.manual_bank_reference WHERE attempt_id=NEW.attempt_id)
 THEN RAISE EXCEPTION 'A manual-bank confirmation requires its unique bank reference' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER manual_bank_confirmation_reference_sealed AFTER INSERT ON app.manual_bank_confirmation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_manual_bank_confirmation_reference();
--> statement-breakpoint
-- R4 (S92 finding 5): raw callback bodies may hold payer data. Rows stay append-only
-- except one redaction that empties the body and stamps redacted_at (retention worker).
CREATE OR REPLACE FUNCTION app.guard_autolaris_callback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.redacted_at IS NOT NULL THEN RAISE EXCEPTION 'A new callback is not redacted' USING ERRCODE='23514'; END IF;
  NEW.received_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.redacted_at IS NULL AND NEW.body='' AND NEW.redacted_at IS NOT NULL
  AND (NEW.id,NEW.content_type,NEW.body_sha256,NEW.received_at) IS NOT DISTINCT FROM (OLD.id,OLD.content_type,OLD.body_sha256,OLD.received_at)
 THEN NEW.redacted_at:=clock_timestamp();RETURN NEW; END IF;
 RAISE EXCEPTION 'AutoLaris callbacks are retained raw until redacted once' USING ERRCODE='23514';
END $$;
