CREATE TABLE "app"."economic_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_id" uuid,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"environment" text NOT NULL,
	"event_id" text NOT NULL,
	"effect_reference" text NOT NULL,
	"amount" bigint NOT NULL,
	"merchandise_amount" bigint NOT NULL,
	"buyer_shipping" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "economic_receipt_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "economic_receipt_event_unique" UNIQUE("source","environment","event_id"),
	CONSTRAINT "economic_receipt_effect_unique" UNIQUE("source","environment","effect_reference"),
	CONSTRAINT "economic_receipt_kind_check" CHECK (("app"."economic_receipt"."kind"='prepaid' AND "app"."economic_receipt"."source"='local.payment' AND "app"."economic_receipt"."shipment_id" IS NULL) OR ("app"."economic_receipt"."kind"='cod' AND "app"."economic_receipt"."source"='local.cod' AND "app"."economic_receipt"."shipment_id" IS NOT NULL)),
	CONSTRAINT "economic_receipt_identity_check" CHECK ("app"."economic_receipt"."environment" IN ('local','test') AND "app"."economic_receipt"."event_id" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."economic_receipt"."effect_reference" ~ '^[A-Za-z0-9_.:-]{1,200}$'),
	CONSTRAINT "economic_receipt_money_check" CHECK ("app"."economic_receipt"."amount" between 1 and 9007199254740991 AND "app"."economic_receipt"."merchandise_amount" between 1 and 9007199254740991 AND "app"."economic_receipt"."buyer_shipping" between 0 and 9007199254740991 AND "app"."economic_receipt"."amount"::numeric="app"."economic_receipt"."merchandise_amount"::numeric+"app"."economic_receipt"."buyer_shipping"::numeric)
);
--> statement-breakpoint
CREATE TABLE "app"."finance_posting" (
	"transaction_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"account" text NOT NULL,
	"side" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "finance_posting_transaction_id_ordinal_pk" PRIMARY KEY("transaction_id","ordinal"),
	CONSTRAINT "finance_posting_value_check" CHECK ("app"."finance_posting"."ordinal" between 1 and 100 AND "app"."finance_posting"."account" IN ('provider_receivable','buyer_funds_liability','company_cash') AND "app"."finance_posting"."side" IN ('debit','credit') AND "app"."finance_posting"."amount" between 1 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."finance_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"environment" text NOT NULL,
	"effect_reference" text NOT NULL,
	"request_hash" text NOT NULL,
	"order_id" uuid,
	"reverses_id" uuid,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_xid" text DEFAULT pg_current_xact_id()::text NOT NULL,
	CONSTRAINT "finance_transaction_effect_unique" UNIQUE("source","environment","effect_reference"),
	CONSTRAINT "finance_transaction_reversal_unique" UNIQUE("reverses_id"),
	CONSTRAINT "finance_transaction_kind_check" CHECK ("app"."finance_transaction"."kind" IN ('economic_receipt','adjustment','reversal') AND (("app"."finance_transaction"."kind"='reversal')=("app"."finance_transaction"."reverses_id" IS NOT NULL)) AND "app"."finance_transaction"."reverses_id" IS DISTINCT FROM "app"."finance_transaction"."id"),
	CONSTRAINT "finance_transaction_identity_check" CHECK ("app"."finance_transaction"."source" ~ '^[a-z][a-z0-9_.-]{0,99}$' AND "app"."finance_transaction"."environment" IN ('local','test') AND "app"."finance_transaction"."effect_reference" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."finance_transaction"."request_hash" ~ '^[0-9a-f]{64}$' AND char_length("app"."finance_transaction"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "app"."economic_receipt" ADD CONSTRAINT "economic_receipt_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."economic_receipt" ADD CONSTRAINT "economic_receipt_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."economic_receipt" ADD CONSTRAINT "economic_receipt_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."finance_posting" ADD CONSTRAINT "finance_posting_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" ADD CONSTRAINT "finance_transaction_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" ADD CONSTRAINT "finance_transaction_reversal_fk" FOREIGN KEY ("reverses_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "economic_receipt_prepaid_order_unique" ON "app"."economic_receipt" USING btree ("order_id") WHERE "app"."economic_receipt"."kind"='prepaid';--> statement-breakpoint
CREATE UNIQUE INDEX "economic_receipt_cod_shipment_unique" ON "app"."economic_receipt" USING btree ("shipment_id") WHERE "app"."economic_receipt"."kind"='cod';--> statement-breakpoint
CREATE INDEX "finance_transaction_order_idx" ON "app"."finance_transaction" USING btree ("order_id","recorded_at","id");
--> statement-breakpoint
CREATE FUNCTION app.guard_finance_header() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_database()<>'99ribu_'||NEW.environment OR NOT isfinite(NEW.occurred_at) OR NEW.occurred_at<timestamptz '0001-01-01 00:00:00+00'
 THEN RAISE EXCEPTION 'Finance source environment and event time must be valid' USING ERRCODE='23514'; END IF;
 NEW.created_xid:=pg_current_xact_id()::text; NEW.recorded_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_transaction_guard BEFORE INSERT ON app.finance_transaction FOR EACH ROW EXECUTE FUNCTION app.guard_finance_header();
--> statement-breakpoint
CREATE FUNCTION app.guard_finance_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h app.finance_transaction; o app.commerce_order; s app.order_shipment;
BEGIN
 SELECT * INTO h FROM app.finance_transaction WHERE id=NEW.transaction_id;
 IF h.id IS NULL THEN RAISE EXCEPTION 'Journal parent is required' USING ERRCODE='23503'; END IF;
 IF h.created_xid<>pg_current_xact_id()::text THEN RAISE EXCEPTION 'Historical journal is sealed' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='economic_receipt' THEN
  IF h.kind<>'economic_receipt' OR (h.order_id,h.source,h.environment,h.effect_reference,h.occurred_at) IS DISTINCT FROM (NEW.order_id,NEW.source,NEW.environment,NEW.effect_reference,NEW.occurred_at)
  THEN RAISE EXCEPTION 'Economic receipt and journal share one identity' USING ERRCODE='23514'; END IF;
  SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id;
  IF o.id IS NULL OR o.payment_method<>NEW.kind THEN RAISE EXCEPTION 'Receipt requires its purchased payment method' USING ERRCODE='23514'; END IF;
  IF NEW.kind='prepaid' THEN
   IF (NEW.amount,NEW.merchandise_amount,NEW.buyer_shipping) IS DISTINCT FROM (o.buyer_total,o.merchandise_amount,o.shipping_amount-o.subsidy_amount)
   THEN RAISE EXCEPTION 'Prepaid receipt equals frozen buyer total' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO s FROM app.order_shipment WHERE id=NEW.shipment_id AND order_id=NEW.order_id;
   IF s.id IS NULL OR (NEW.amount,NEW.merchandise_amount,NEW.buyer_shipping) IS DISTINCT FROM (s.cod_due,s.merchandise_amount,s.buyer_shipping)
   THEN RAISE EXCEPTION 'COD receipt equals its original parcel due' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.recorded_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_posting_guard BEFORE INSERT ON app.finance_posting FOR EACH ROW EXECUTE FUNCTION app.guard_finance_part();
--> statement-breakpoint
CREATE TRIGGER economic_receipt_guard BEFORE INSERT ON app.economic_receipt FOR EACH ROW EXECUTE FUNCTION app.guard_finance_part();
--> statement-breakpoint
CREATE FUNCTION app.seal_finance_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; h app.finance_transaction; r app.economic_receipt; original app.finance_transaction; count_lines int; debits numeric; credits numeric; actual jsonb; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='finance_transaction' THEN target:=NEW.id; ELSE target:=NEW.transaction_id; END IF;
 SELECT * INTO h FROM app.finance_transaction WHERE id=target;
 SELECT count(*),coalesce(sum(amount) FILTER(WHERE side='debit'),0),coalesce(sum(amount) FILTER(WHERE side='credit'),0) INTO count_lines,debits,credits FROM app.finance_posting WHERE transaction_id=h.id;
 IF count_lines<2 OR debits<>credits OR debits<=0 OR debits>9007199254740991 THEN RAISE EXCEPTION 'Journal requires balanced safe integer IDR' USING ERRCODE='23514'; END IF;
 IF h.kind='economic_receipt' THEN
  SELECT * INTO r FROM app.economic_receipt WHERE transaction_id=h.id;
  IF r.id IS NULL OR count_lines<>2 OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=h.id AND account='provider_receivable' AND side='debit' AND amount=r.amount)
   OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=h.id AND account='buyer_funds_liability' AND side='credit' AND amount=r.amount)
  THEN RAISE EXCEPTION 'Receipt and exact receivable/liability postings commit together' USING ERRCODE='23514'; END IF;
 END IF;
 IF h.kind='reversal' THEN
  SELECT * INTO original FROM app.finance_transaction WHERE id=h.reverses_id;
  IF original.id IS NULL OR original.kind='reversal' OR h.order_id IS DISTINCT FROM original.order_id OR h.occurred_at<original.occurred_at
  THEN RAISE EXCEPTION 'Full reversal preserves original business lineage' USING ERRCODE='23514'; END IF;
  SELECT jsonb_agg(jsonb_build_array(ordinal,account,side,amount) ORDER BY ordinal) INTO actual FROM app.finance_posting WHERE transaction_id=h.id;
  SELECT jsonb_agg(jsonb_build_array(ordinal,account,CASE side WHEN 'debit' THEN 'credit' ELSE 'debit' END,amount) ORDER BY ordinal) INTO expected FROM app.finance_posting WHERE transaction_id=original.id;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Full reversal mirrors every original posting' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER finance_transaction_sealed AFTER INSERT ON app.finance_transaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_finance_transaction();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER finance_posting_balanced AFTER INSERT ON app.finance_posting DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_finance_transaction();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER economic_receipt_posted AFTER INSERT ON app.economic_receipt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_finance_transaction();
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['finance_transaction','finance_posting','economic_receipt'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
END;
$$;
