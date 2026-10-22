CREATE TABLE "app"."autolaris_callback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" text NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "autolaris_callback_value_check" CHECK (char_length("app"."autolaris_callback"."content_type") between 0 and 120 AND octet_length("app"."autolaris_callback"."body") between 0 and 16384 AND "app"."autolaris_callback"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."autolaris_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"source" text NOT NULL,
	"rc" text,
	"ket" text,
	"classification" text NOT NULL,
	"amount" bigint,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" text,
	"reason" text,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "autolaris_observation_value_check" CHECK ("app"."autolaris_observation"."source" IN ('advice','manual') AND "app"."autolaris_observation"."classification" IN ('pending','settled','unknown','failed')
  AND ("app"."autolaris_observation"."classification"='settled')=("app"."autolaris_observation"."amount" IS NOT NULL) AND ("app"."autolaris_observation"."amount" IS NULL OR "app"."autolaris_observation"."amount" between 1 and 9007199254740991)
  AND (("app"."autolaris_observation"."source"='advice' AND "app"."autolaris_observation"."actor_id" IS NULL AND "app"."autolaris_observation"."reason" IS NULL AND "app"."autolaris_observation"."evidence" IS NULL AND char_length("app"."autolaris_observation"."rc") between 1 and 8 AND char_length("app"."autolaris_observation"."ket") between 0 and 120)
   OR ("app"."autolaris_observation"."source"='manual' AND "app"."autolaris_observation"."classification"='settled' AND "app"."autolaris_observation"."rc" IS NULL AND "app"."autolaris_observation"."ket" IS NULL AND "app"."autolaris_observation"."actor_id" IS NOT NULL AND char_length("app"."autolaris_observation"."reason") between 1 and 200 AND char_length("app"."autolaris_observation"."evidence") between 1 and 500)))
);
--> statement-breakpoint
CREATE TABLE "app"."autolaris_payment" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid,
	"environment" text NOT NULL,
	"reff_id" text NOT NULL,
	"channel_code" text NOT NULL,
	"requested_amount" bigint NOT NULL,
	"trx_id" text,
	"instruction_kind" text,
	"instruction_value" text,
	"provider_amount" bigint,
	"admin_fee" bigint,
	"provider_total" bigint,
	"refusal_code" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "autolaris_payment_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "autolaris_payment_reff_unique" UNIQUE("environment","reff_id"),
	CONSTRAINT "autolaris_payment_trx_unique" UNIQUE("environment","trx_id"),
	CONSTRAINT "autolaris_payment_value_check" CHECK ("app"."autolaris_payment"."environment" IN ('local','test') AND "app"."autolaris_payment"."reff_id" ~ '^[A-Za-z0-9_-]{8,64}$' AND "app"."autolaris_payment"."channel_code" ~ '^[A-Z0-9_]{2,20}$' AND "app"."autolaris_payment"."requested_amount" between 1 and 9007199254740991
  AND (("app"."autolaris_payment"."responded_at" IS NULL AND "app"."autolaris_payment"."trx_id" IS NULL AND "app"."autolaris_payment"."instruction_kind" IS NULL AND "app"."autolaris_payment"."instruction_value" IS NULL AND "app"."autolaris_payment"."provider_amount" IS NULL AND "app"."autolaris_payment"."admin_fee" IS NULL AND "app"."autolaris_payment"."provider_total" IS NULL AND "app"."autolaris_payment"."refusal_code" IS NULL)
   OR ("app"."autolaris_payment"."responded_at" IS NOT NULL AND "app"."autolaris_payment"."operation_id" IS NOT NULL AND "app"."autolaris_payment"."trx_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "app"."autolaris_payment"."instruction_kind" IN ('virtual_account','qr','payment_code','url') AND char_length("app"."autolaris_payment"."instruction_value") between 1 and 2048
    AND "app"."autolaris_payment"."provider_amount" between 1 and 9007199254740991 AND "app"."autolaris_payment"."admin_fee" between 0 and 9007199254740991 AND "app"."autolaris_payment"."provider_total" between 1 and 9007199254740991
    AND ("app"."autolaris_payment"."refusal_code" IS NULL OR "app"."autolaris_payment"."refusal_code" IN ('AUTOLARIS_TOTAL_MISMATCH','AUTOLARIS_AMOUNT_MISMATCH'))
    AND ("app"."autolaris_payment"."refusal_code" IS NOT NULL OR ("app"."autolaris_payment"."provider_amount"="app"."autolaris_payment"."requested_amount" AND "app"."autolaris_payment"."provider_total"="app"."autolaris_payment"."requested_amount")))))
);
--> statement-breakpoint
CREATE TABLE "app"."local_autolaris_transaction" (
	"trx_id" text PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"reff_id" text NOT NULL,
	"channel_code" text NOT NULL,
	"amount" bigint NOT NULL,
	"admin_fee" bigint NOT NULL,
	"total" bigint NOT NULL,
	"instruction_kind" text NOT NULL,
	"instruction_value" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "local_autolaris_transaction_reff_unique" UNIQUE("environment","reff_id"),
	CONSTRAINT "local_autolaris_transaction_value_check" CHECK ("app"."local_autolaris_transaction"."environment" IN ('local','test') AND "app"."local_autolaris_transaction"."status" IN ('pending','paid','expired','generic_success')
  AND "app"."local_autolaris_transaction"."amount">0 AND "app"."local_autolaris_transaction"."admin_fee">=0 AND "app"."local_autolaris_transaction"."total">0 AND ("app"."local_autolaris_transaction"."status"='paid')=("app"."local_autolaris_transaction"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" DROP CONSTRAINT "checkout_quote_payment_check";--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_payment_check";--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" DROP CONSTRAINT "payment_attempt_identity_check";--> statement-breakpoint
ALTER TABLE "app"."autolaris_observation" ADD CONSTRAINT "autolaris_observation_attempt_id_autolaris_payment_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."autolaris_payment"("attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."autolaris_payment" ADD CONSTRAINT "autolaris_payment_attempt_id_payment_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."payment_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."autolaris_payment" ADD CONSTRAINT "autolaris_payment_operation_id_local_payment_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_payment_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autolaris_callback_received_idx" ON "app"."autolaris_callback" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "autolaris_observation_attempt_idx" ON "app"."autolaris_observation" USING btree ("attempt_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "autolaris_observation_settled_unique" ON "app"."autolaris_observation" USING btree ("attempt_id") WHERE "app"."autolaris_observation"."classification"='settled';--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD CONSTRAINT "checkout_quote_payment_check" CHECK (("app"."checkout_quote"."payment_channel" IS NULL OR ("app"."checkout_quote"."payment_method"='cod' AND "app"."checkout_quote"."payment_channel"='cod') OR ("app"."checkout_quote"."payment_method"='prepaid' AND "app"."checkout_quote"."payment_channel" IN ('local-prepaid','manual-bank','autolaris'))) AND "app"."checkout_quote"."payment_charge_amount" between 0 and 9007199254740991 AND ("app"."checkout_quote"."cod_fee_bps" IS NULL OR "app"."checkout_quote"."cod_fee_bps" between 0 and 2000) AND ("app"."checkout_quote"."payment_method"='cod' OR ("app"."checkout_quote"."payment_charge_amount"=0 AND "app"."checkout_quote"."cod_fee_bps" IS NULL)));--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_payment_check" CHECK (("app"."commerce_order"."payment_channel" IS NULL OR ("app"."commerce_order"."payment_method"='cod' AND "app"."commerce_order"."payment_channel"='cod') OR ("app"."commerce_order"."payment_method"='prepaid' AND "app"."commerce_order"."payment_channel" IN ('local-prepaid','manual-bank','autolaris'))) AND "app"."commerce_order"."payment_charge_amount" between 0 and 9007199254740991 AND ("app"."commerce_order"."cod_fee_bps" IS NULL OR "app"."commerce_order"."cod_fee_bps" between 0 and 2000) AND (("app"."commerce_order"."payment_channel"='manual-bank')=("app"."commerce_order"."transfer_code" IS NOT NULL)) AND ("app"."commerce_order"."transfer_code" IS NULL OR ("app"."commerce_order"."transfer_code" between 1 and 999 AND "app"."commerce_order"."payment_charge_amount"="app"."commerce_order"."transfer_code" AND "app"."commerce_order"."payment_policy_version_id" IS NOT NULL)) AND ("app"."commerce_order"."payment_method"='cod' OR "app"."commerce_order"."payment_channel"='manual-bank' OR ("app"."commerce_order"."payment_charge_amount"=0 AND "app"."commerce_order"."cod_fee_bps" IS NULL)));--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_identity_check" CHECK ("app"."payment_attempt"."method_id" IN ('local-prepaid','manual-bank','autolaris') AND "app"."payment_attempt"."key" ~ '^[A-Za-z0-9_-]{16,200}$' AND "app"."payment_attempt"."request_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
-- S93 (DEC-008): AutoLaris request identity. reff_id and channel are persisted with
-- the attempt before any provider call; the adapter binds the attempt's own payment
-- operation once and records the single Create Payment response once.
CREATE FUNCTION app.guard_autolaris_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt; p app.local_payment_operation;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AutoLaris payments are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM app.payment_attempt WHERE id=NEW.attempt_id;
 IF a.id IS NULL OR a.method_id<>'autolaris' OR NEW.requested_amount IS DISTINCT FROM a.expected_amount
 THEN RAISE EXCEPTION 'An AutoLaris payment binds one AutoLaris attempt and its expected amount' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.operation_id IS NOT NULL OR NEW.responded_at IS NOT NULL THEN RAISE EXCEPTION 'AutoLaris identity is persisted before any provider effect' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF (NEW.attempt_id,NEW.environment,NEW.reff_id,NEW.channel_code,NEW.requested_amount,NEW.created_at) IS DISTINCT FROM (OLD.attempt_id,OLD.environment,OLD.reff_id,OLD.channel_code,OLD.requested_amount,OLD.created_at)
  OR (OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id)
  OR (OLD.responded_at IS NOT NULL AND (NEW.trx_id,NEW.instruction_kind,NEW.instruction_value,NEW.provider_amount,NEW.admin_fee,NEW.provider_total,NEW.refusal_code,NEW.responded_at)
      IS DISTINCT FROM (OLD.trx_id,OLD.instruction_kind,OLD.instruction_value,OLD.provider_amount,OLD.admin_fee,OLD.provider_total,OLD.refusal_code,OLD.responded_at))
 THEN RAISE EXCEPTION 'AutoLaris operation and response are recorded once' USING ERRCODE='23514'; END IF;
 IF NEW.operation_id IS NOT NULL THEN
  SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.operation_id;
  IF p.attempt_id IS DISTINCT FROM a.id OR p.environment IS DISTINCT FROM NEW.environment THEN RAISE EXCEPTION 'AutoLaris payment binds its own attempt operation' USING ERRCODE='23514'; END IF;
 END IF;
 IF OLD.responded_at IS NULL AND NEW.responded_at IS NOT NULL THEN NEW.responded_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER autolaris_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON app.autolaris_payment FOR EACH ROW EXECUTE FUNCTION app.guard_autolaris_payment();
--> statement-breakpoint
-- Advice reads and manual confirmations are append-only and require the recorded,
-- unrefused provider transaction (a trx_id to reconcile against).
CREATE FUNCTION app.guard_autolaris_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l app.autolaris_payment;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AutoLaris observations are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO l FROM app.autolaris_payment WHERE attempt_id=NEW.attempt_id;
 IF l.trx_id IS NULL OR l.refusal_code IS NOT NULL THEN RAISE EXCEPTION 'An AutoLaris observation needs the accepted provider transaction' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER autolaris_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.autolaris_observation FOR EACH ROW EXECUTE FUNCTION app.guard_autolaris_observation();
--> statement-breakpoint
-- Callback rows are raw discovery evidence only (contract unpublished).
CREATE FUNCTION app.guard_autolaris_callback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AutoLaris callbacks are retained raw' USING ERRCODE='23514'; END IF;
 NEW.received_at:=clock_timestamp();RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER autolaris_callback_guard BEFORE INSERT OR UPDATE OR DELETE ON app.autolaris_callback FOR EACH ROW EXECUTE FUNCTION app.guard_autolaris_callback();
--> statement-breakpoint
-- An AutoLaris collection becomes confirmed only with the attempt's settled
-- observation (explicit advice settlement status or audited manual confirmation)
-- for exactly the collected amount; a callback can never produce one.
CREATE FUNCTION app.seal_autolaris_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt; p app.local_payment_operation; l app.autolaris_payment; o app.autolaris_observation;
BEGIN
 SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.id;
 SELECT * INTO a FROM app.payment_attempt WHERE id=p.attempt_id;
 IF a.method_id='autolaris' THEN
  SELECT * INTO l FROM app.autolaris_payment WHERE attempt_id=a.id;
  IF l.operation_id IS DISTINCT FROM p.id THEN RAISE EXCEPTION 'An AutoLaris operation is bound to its payment identity' USING ERRCODE='23514'; END IF;
  IF p.status='confirmed' THEN
   SELECT * INTO o FROM app.autolaris_observation WHERE attempt_id=a.id AND classification='settled';
   IF l.refusal_code IS NOT NULL OR l.trx_id IS NULL OR o.id IS NULL OR o.amount IS DISTINCT FROM p.collected_amount
   THEN RAISE EXCEPTION 'An AutoLaris collection requires its settled observation' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER autolaris_operation_sealed AFTER INSERT OR UPDATE ON app.local_payment_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_autolaris_operation();
