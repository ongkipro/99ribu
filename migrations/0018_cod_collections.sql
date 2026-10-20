CREATE TABLE "app"."cod_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cod_confirmation_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "cod_confirmation_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."cod_event_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"receipt_id" uuid,
	"transaction_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cod_event_result_value_check" CHECK ("app"."cod_event_result"."outcome" IN ('collected','refused','duplicate','recovery') AND "app"."cod_event_result"."reason" IN ('verified_collection','recipient_refused','duplicate_callback','amount_mismatch','conflicting_allocation') AND (("app"."cod_event_result"."outcome"='collected' AND "app"."cod_event_result"."receipt_id" IS NOT NULL AND "app"."cod_event_result"."transaction_id" IS NOT NULL) OR ("app"."cod_event_result"."outcome"='refused' AND "app"."cod_event_result"."receipt_id" IS NULL AND "app"."cod_event_result"."transaction_id" IS NULL) OR ("app"."cod_event_result"."outcome"='recovery' AND "app"."cod_event_result"."receipt_id" IS NULL AND "app"."cod_event_result"."transaction_id" IS NOT NULL) OR ("app"."cod_event_result"."outcome"='duplicate' AND ("app"."cod_event_result"."receipt_id" IS NULL OR "app"."cod_event_result"."transaction_id" IS NOT NULL))))
);
--> statement-breakpoint
CREATE TABLE "app"."cod_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cod_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "cod_provider_event_hash_check" CHECK ("app"."cod_provider_event"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_cod_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_cod_event_value_check" CHECK ("app"."local_cod_event"."signature" ~ '^[0-9a-f]{64}$' AND (("app"."local_cod_event"."status"='collected' AND "app"."local_cod_event"."amount" between 1 and 9007199254740991) OR ("app"."local_cod_event"."status"='refused' AND "app"."local_cod_event"."amount"=0)))
);
--> statement-breakpoint
CREATE TABLE "app"."local_cod_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"environment" text NOT NULL,
	"status" text NOT NULL,
	"requested_amount" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_cod_operation_reference_unique" UNIQUE("shipment_id","reference"),
	CONSTRAINT "local_cod_operation_value_check" CHECK ("app"."local_cod_operation"."environment" IN ('local','test') AND "app"."local_cod_operation"."reference" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."local_cod_operation"."requested_amount" between 1 and 9007199254740991 AND (("app"."local_cod_operation"."status"='collected' AND "app"."local_cod_operation"."amount" between 1 and 9007199254740991) OR ("app"."local_cod_operation"."status"='refused' AND "app"."local_cod_operation"."amount"=0)))
);
--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_state_check";--> statement-breakpoint
ALTER TABLE "app"."order_event" DROP CONSTRAINT "order_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."cod_confirmation" ADD CONSTRAINT "cod_confirmation_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_confirmation" ADD CONSTRAINT "cod_confirmation_operation_id_commerce_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."commerce_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_event_result" ADD CONSTRAINT "cod_event_result_event_id_cod_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."cod_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_event_result" ADD CONSTRAINT "cod_event_result_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_event_result" ADD CONSTRAINT "cod_event_result_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_provider_event" ADD CONSTRAINT "cod_provider_event_id_local_cod_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_cod_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_provider_event" ADD CONSTRAINT "cod_provider_event_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_provider_event" ADD CONSTRAINT "cod_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_cod_event" ADD CONSTRAINT "local_cod_event_operation_id_local_cod_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_cod_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_cod_operation" ADD CONSTRAINT "local_cod_operation_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cod_collected_receipt_unique" ON "app"."cod_event_result" USING btree ("receipt_id") WHERE "app"."cod_event_result"."outcome"='collected';--> statement-breakpoint
CREATE INDEX "local_cod_event_operation_idx" ON "app"."local_cod_event" USING btree ("operation_id","recorded_at","id");--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_state_check" CHECK (("app"."commerce_order"."status"='preparing' AND "app"."commerce_order"."revision"=0 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."revision"=1 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='confirmed' AND "app"."commerce_order"."payment_method"='prepaid' AND "app"."commerce_order"."actionable_at" IS NOT NULL) OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."payment_method"='cod' AND "app"."commerce_order"."actionable_at" IS NOT NULL AND (("app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='cod_due') OR ("app"."commerce_order"."revision">=3 AND "app"."commerce_order"."payment_status" IN ('partially_collected','confirmed')))) OR ("app"."commerce_order"."status"='cancelled' AND "app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='expired' AND "app"."commerce_order"."actionable_at" IS NULL));--> statement-breakpoint
ALTER TABLE "app"."order_event" ADD CONSTRAINT "order_event_value_check" CHECK (char_length("app"."order_event"."reason") between 1 and 500 AND (("app"."order_event"."revision"=1 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status"='pending') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='cancelled' AND "app"."order_event"."payment_status"='expired') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status" IN ('confirmed','cod_due')) OR ("app"."order_event"."revision">=3 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status" IN ('partially_collected','confirmed'))));
--> statement-breakpoint
ALTER TABLE app.cod_confirmation ALTER CONSTRAINT cod_confirmation_operation_id_commerce_operation_id_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION app.guard_cod_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
 IF o.id IS NULL OR o.payment_method<>'cod' OR o.status<>'pending' OR o.payment_status<>'pending' OR o.revision<>1
  OR o.expires_at<=app.reservation_clock(o.clock_namespace) OR NEW.operation_id IS DISTINCT FROM o.operation_id
  OR NOT EXISTS(SELECT 1 FROM app.stock_reservation WHERE id=o.stock_reservation_id AND status='active')
  OR EXISTS(SELECT 1 FROM app.order_shipment s WHERE s.order_id=o.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.snapshot->'options') option WHERE option->>'id'=s.snapshot->>'selected_option_id' AND option->>'supports_cod'='true'))
 THEN RAISE EXCEPTION 'COD confirmation requires the original complete supported current order' USING ERRCODE='23514'; END IF;
 NEW.accepted_at:=o.created_at;NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cod_confirmation_guard BEFORE INSERT ON app.cod_confirmation FOR EACH ROW EXECUTE FUNCTION app.guard_cod_confirmation();
--> statement-breakpoint
CREATE FUNCTION app.assert_cod_order(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; c app.cod_confirmation%ROWTYPE; paid bigint; parcels bigint; expected text;
BEGIN
 SELECT * INTO c FROM app.cod_confirmation WHERE order_id=selected;IF c.id IS NULL THEN RETURN; END IF;
 SELECT * INTO o FROM app.commerce_order WHERE id=selected;
 SELECT count(*) INTO paid FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.outcome='collected' AND e.order_id=selected;
 SELECT count(*) INTO parcels FROM app.order_shipment WHERE order_id=selected;
 expected:=CASE WHEN paid=0 THEN 'cod_due' WHEN paid=parcels THEN 'confirmed' ELSE 'partially_collected' END;
 IF o.payment_method IS DISTINCT FROM 'cod' OR o.status IS DISTINCT FROM 'pending' OR o.payment_status IS DISTINCT FROM expected OR o.revision<>2+paid OR paid>parcels
  OR o.actionable_at IS DISTINCT FROM c.accepted_at OR c.accepted_at IS DISTINCT FROM o.created_at OR c.operation_id IS DISTINCT FROM o.operation_id
  OR NOT EXISTS(SELECT 1 FROM app.commerce_operation WHERE id=c.operation_id AND action='order.create' AND resource_id=o.id)
  OR NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND revision=2 AND status='pending' AND payment_status='cod_due' AND source_id=c.id AND created_at=c.accepted_at)
 THEN RAISE EXCEPTION 'Confirmed COD, original actionability and qualified parcel receipts seal together' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_cod_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='cod_confirmation' THEN PERFORM app.assert_cod_order(NEW.order_id);ELSE PERFORM app.assert_cod_order(NEW.id);END IF;RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cod_confirmation_sealed AFTER INSERT ON app.cod_confirmation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_cod_order();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cod_order_sealed AFTER INSERT OR UPDATE ON app.commerce_order DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_cod_order();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_cod_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s app.order_shipment%ROWTYPE; o app.commerce_order%ROWTYPE; accepted timestamptz;
BEGIN
 SELECT * INTO s FROM app.order_shipment WHERE id=NEW.shipment_id;SELECT * INTO o FROM app.commerce_order WHERE id=s.order_id FOR UPDATE;
 SELECT accepted_at INTO accepted FROM app.cod_confirmation WHERE order_id=o.id;
 IF accepted IS NULL OR o.payment_method<>'cod' OR o.status<>'pending' OR o.actionable_at IS DISTINCT FROM accepted
  OR current_database()<>'99ribu_'||NEW.environment OR NEW.requested_amount IS DISTINCT FROM s.cod_due
  OR NEW.occurred_at<accepted OR NEW.occurred_at>app.reservation_clock(o.clock_namespace) OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',NEW.occurred_at)
 THEN RAISE EXCEPTION 'Local COD effect requires its original confirmed parcel and profile' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_cod_operation_guard BEFORE INSERT ON app.local_cod_operation FOR EACH ROW EXECUTE FUNCTION app.guard_local_cod_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_cod_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation app.local_cod_operation%ROWTYPE;
BEGIN
 SELECT * INTO operation FROM app.local_cod_operation WHERE id=NEW.operation_id FOR SHARE;
 IF operation.id IS NULL OR (NEW.status,NEW.amount,NEW.occurred_at) IS DISTINCT FROM (operation.status,operation.amount,operation.occurred_at)
 THEN RAISE EXCEPTION 'COD source delivery preserves its original financial effect' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_cod_event_guard BEFORE INSERT ON app.local_cod_event FOR EACH ROW EXECUTE FUNCTION app.guard_local_cod_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_local_cod_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.local_cod_event WHERE operation_id=NEW.id) THEN RAISE EXCEPTION 'COD original effect and immutable source event seal together' USING ERRCODE='23514';END IF;RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_cod_operation_sealed AFTER INSERT ON app.local_cod_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_cod_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_cod_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.local_cod_event e JOIN app.local_cod_operation o ON o.id=e.operation_id WHERE e.id=NEW.id AND o.shipment_id=NEW.shipment_id)
  OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=NEW.callback_job_id AND kind='cod.callback' AND payload=jsonb_build_object('eventId',NEW.id) AND dedup_key='cod-callback:'||NEW.id::text)
 THEN RAISE EXCEPTION 'COD registration requires original source and exact durable callback' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cod_provider_event_guard BEFORE INSERT ON app.cod_provider_event FOR EACH ROW EXECUTE FUNCTION app.guard_cod_provider_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_cod_event_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e app.local_cod_event%ROWTYPE; operation app.local_cod_operation%ROWTYPE; s app.order_shipment%ROWTYPE; journal app.finance_transaction%ROWTYPE; receipt app.economic_receipt%ROWTYPE; selected uuid;
BEGIN
 SELECT * INTO e FROM app.local_cod_event WHERE id=NEW.event_id;SELECT * INTO operation FROM app.local_cod_operation WHERE id=e.operation_id;SELECT * INTO s FROM app.order_shipment WHERE id=operation.shipment_id;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM app.cod_provider_event p JOIN app.outbox_job j ON j.id=p.callback_job_id WHERE p.id=e.id AND p.shipment_id=s.id AND j.status='completed' AND j.result->>'event_id'=e.id::text AND j.result->>'outcome'=NEW.outcome)
 THEN RAISE EXCEPTION 'COD result and exact callback completion seal together' USING ERRCODE='23514'; END IF;
 IF NEW.outcome IN ('collected','recovery') THEN
  SELECT * INTO journal FROM app.finance_transaction WHERE id=NEW.transaction_id;
  IF e.status<>'collected' OR journal.id IS NULL OR journal.order_id IS DISTINCT FROM s.order_id OR journal.environment IS DISTINCT FROM operation.environment OR journal.effect_reference IS DISTINCT FROM operation.id::text OR journal.occurred_at IS DISTINCT FROM e.occurred_at
   OR (SELECT count(*) FROM app.finance_posting WHERE transaction_id=journal.id)<>2
   OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='provider_receivable' AND side='debit' AND amount=e.amount)
   OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='buyer_funds_liability' AND side='credit' AND amount=e.amount)
  THEN RAISE EXCEPTION 'COD money requires the exact original balanced receivable and liability' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='collected' THEN
   SELECT * INTO receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
   IF NEW.reason<>'verified_collection' OR journal.kind<>'economic_receipt' OR journal.source<>'local.cod' OR receipt.id IS NULL
    OR (receipt.order_id,receipt.shipment_id,receipt.transaction_id,receipt.source,receipt.environment,receipt.effect_reference,receipt.amount,receipt.occurred_at) IS DISTINCT FROM (s.order_id,s.id,journal.id,'local.cod'::text,operation.environment,operation.id::text,e.amount,e.occurred_at)
    OR receipt.kind<>'cod' OR receipt.amount<>s.cod_due
    OR NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=s.order_id AND source_id=e.id AND payment_status IN ('partially_collected','confirmed') AND created_at=e.occurred_at)
   THEN RAISE EXCEPTION 'Accepted COD receipt belongs only to its original parcel and state event' USING ERRCODE='23514';END IF;
   SELECT id INTO selected FROM app.commerce_event WHERE receipt_id=receipt.id AND name='Purchase';PERFORM app.assert_commerce_event(selected);
  ELSE
   IF journal.kind<>'adjustment' OR journal.source<>'local.cod.recovery' OR NEW.receipt_id IS NOT NULL
    OR (NEW.reason='amount_mismatch' AND e.amount=s.cod_due)
    OR (NEW.reason='conflicting_allocation' AND (e.amount<>s.cod_due OR NOT EXISTS(SELECT 1 FROM app.economic_receipt WHERE shipment_id=s.id AND kind='cod' AND effect_reference<>operation.id::text)))
    OR NEW.reason NOT IN ('amount_mismatch','conflicting_allocation')
   THEN RAISE EXCEPTION 'COD recovery preserves extra or mismatched funds without more merchandise' USING ERRCODE='23514';END IF;
  END IF;
 ELSIF NEW.outcome='refused' THEN
  IF e.status<>'refused' OR e.amount<>0 OR NEW.reason<>'recipient_refused' OR NEW.receipt_id IS NOT NULL OR NEW.transaction_id IS NOT NULL THEN RAISE EXCEPTION 'COD refusal is zero economic money' USING ERRCODE='23514';END IF;
 ELSIF NEW.outcome='duplicate' THEN
  IF NEW.reason<>'duplicate_callback' OR NOT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.local_cod_event original ON original.id=r.event_id WHERE original.operation_id=operation.id AND r.outcome IN ('collected','recovery','refused') AND r.receipt_id IS NOT DISTINCT FROM NEW.receipt_id AND r.transaction_id IS NOT DISTINCT FROM NEW.transaction_id)
  THEN RAISE EXCEPTION 'Duplicate COD preserves its original accepted outcome' USING ERRCODE='23514';END IF;
 END IF;
 PERFORM app.assert_cod_order(s.order_id);RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cod_event_result_sealed AFTER INSERT ON app.cod_event_result DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_cod_event_result();
--> statement-breakpoint
CREATE TRIGGER cod_event_result_recorded BEFORE INSERT ON app.cod_event_result FOR EACH ROW EXECUTE FUNCTION app.record_payment_result();
--> statement-breakpoint
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['cod_confirmation','local_cod_operation','local_cod_event','cod_provider_event','cod_event_result'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_commerce_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q app.checkout_quote%ROWTYPE; c app.cart%ROWTYPE; event app.order_event%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Order history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
   SELECT * INTO q FROM app.checkout_quote WHERE id=NEW.quote_id;
   SELECT * INTO c FROM app.cart WHERE id=NEW.cart_id FOR UPDATE;
   IF NEW.status<>'preparing' OR NEW.revision<>0 OR q.cart_id IS DISTINCT FROM c.id OR c.state IS DISTINCT FROM 'open'
     OR c.active_quote_id IS DISTINCT FROM q.id OR c.revision IS DISTINCT FROM q.cart_revision
     OR (NEW.owner_user_id,NEW.owner_guest_id,NEW.clock_namespace) IS DISTINCT FROM (c.owner_user_id,c.owner_guest_id,c.clock_namespace)
     OR (NEW.payment_method,NEW.merchandise_amount,NEW.shipping_amount,NEW.subsidy_amount,NEW.buyer_total) IS DISTINCT FROM (q.payment_method,q.merchandise_amount,q.shipping_amount,q.subsidy_amount,q.buyer_total)
     OR q.expires_at<=app.reservation_clock(c.clock_namespace)
   THEN RAISE EXCEPTION 'Order requires current owned quote and frozen totals' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO event FROM app.order_event WHERE order_id=OLD.id AND revision=OLD.revision+1;
   IF (to_jsonb(NEW)-'revision'-'status'-'payment_status'-'actionable_at') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'status'-'payment_status'-'actionable_at')
     OR (NEW.actionable_at IS DISTINCT FROM OLD.actionable_at AND NOT (OLD.actionable_at IS NULL AND ((NEW.payment_status='confirmed' AND EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.event_id=event.source_id AND r.outcome='confirmed' AND e.order_id=OLD.id AND e.occurred_at=NEW.actionable_at)) OR (OLD.payment_method='cod' AND NEW.payment_status='cod_due' AND EXISTS(SELECT 1 FROM app.cod_confirmation cod WHERE cod.id=event.source_id AND cod.order_id=OLD.id AND cod.accepted_at=NEW.actionable_at)))))
     OR NEW.revision<>OLD.revision+1 OR (NEW.revision,NEW.status,NEW.payment_status) IS DISTINCT FROM (event.revision,event.status,event.payment_status)
   THEN RAISE EXCEPTION 'Order head advances with exact immutable event' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; paid bigint; parcels bigint;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
 IF o.payment_method='cod' AND NEW.revision>=2 AND NEW.payment_status IN ('cod_due','partially_collected','confirmed') THEN
  IF NEW.status<>'pending' OR NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
   THEN RAISE EXCEPTION 'COD event advances the current original order' USING ERRCODE='23514';END IF;
  IF NEW.revision=2 THEN
   IF NEW.payment_status<>'cod_due' OR o.status<>'pending' OR o.payment_status<>'pending' OR NOT EXISTS(SELECT 1 FROM app.cod_confirmation c WHERE c.id=NEW.source_id AND c.order_id=o.id AND c.accepted_at=NEW.created_at)
   THEN RAISE EXCEPTION 'COD confirmation event requires its exact original source' USING ERRCODE='23514';END IF;
  ELSE
   SELECT count(*) INTO paid FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.outcome='collected' AND e.order_id=o.id;
   SELECT count(*) INTO parcels FROM app.order_shipment WHERE order_id=o.id;
   IF o.status<>'pending' OR o.payment_status NOT IN ('cod_due','partially_collected') OR o.actionable_at IS NULL
    OR NEW.payment_status IS DISTINCT FROM (CASE WHEN paid=parcels THEN 'confirmed' ELSE 'partially_collected' END)
    OR NOT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.event_id=NEW.source_id AND r.outcome='collected' AND e.kind='cod' AND e.order_id=o.id AND e.occurred_at=NEW.created_at)
   THEN RAISE EXCEPTION 'COD collection event requires original qualified parcel money' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
   OR (NEW.revision=1 AND (o.status<>'preparing' OR NEW.source_id<>o.operation_id))
   OR (NEW.revision=2 AND NEW.payment_status='expired' AND (o.status<>'pending' OR o.payment_status<>'pending' OR o.expires_at>app.reservation_clock(o.clock_namespace)
     OR EXISTS(SELECT 1 FROM app.payment_attempt a JOIN app.outbox_job j ON j.id=a.creation_job_id WHERE a.order_id=o.id AND a.status IN ('pending','unknown') AND j.status IN ('processing','unknown') AND NOT EXISTS(SELECT 1 FROM app.local_payment_operation p JOIN app.local_payment_event e ON e.operation_id=p.id WHERE p.attempt_id=a.id AND p.status IN ('confirmed','failed','expired') AND e.status=p.status))
     OR EXISTS(SELECT 1 FROM app.payment_attempt a JOIN app.local_payment_operation p ON p.attempt_id=a.id JOIN app.local_payment_event e ON e.operation_id=p.id WHERE a.order_id=o.id AND a.status IN ('pending','unknown') AND e.status='confirmed' AND e.amount=o.buyer_total AND e.occurred_at<o.expires_at AND NOT EXISTS(SELECT 1 FROM app.payment_event_result WHERE event_id=e.id))
     OR NOT EXISTS(
     SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.source_id AND (
       (j.kind='checkout.order.expire' AND j.payload->>'orderId'=o.id::text)
       OR (j.kind='inventory.reservation.expire' AND j.payload->>'reservationId'=o.stock_reservation_id::text)
       OR (j.kind='promotion.reservation.expire' AND j.payload->>'reservationId'=o.promotion_reservation_id::text)))))
   OR (NEW.revision=2 AND NEW.payment_status='confirmed' AND (o.status<>'pending' OR o.payment_status<>'pending' OR o.payment_method<>'prepaid' OR NOT EXISTS(
     SELECT 1 FROM app.payment_event_result r JOIN app.payment_provider_event v ON v.id=r.event_id
       JOIN app.local_payment_event e ON e.id=v.id JOIN app.payment_attempt a ON a.id=v.attempt_id
       JOIN app.economic_receipt receipt ON receipt.id=r.receipt_id JOIN app.stock_reservation hold ON hold.id=o.stock_reservation_id
     WHERE r.event_id=NEW.source_id AND r.outcome='confirmed' AND a.order_id=o.id AND receipt.order_id=o.id
       AND receipt.amount=o.buyer_total AND receipt.effect_reference=e.operation_id::text AND receipt.occurred_at=NEW.created_at
       AND e.status='confirmed' AND e.occurred_at<o.expires_at AND e.occurred_at>=a.created_at AND hold.status='active')))
 THEN RAISE EXCEPTION 'Order event requires current transition and trusted cause' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_order_ad_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; v app.visitor_session%ROWTYPE; c app.consent_receipt%ROWTYPE;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id;
 SELECT * INTO v FROM app.visitor_session WHERE id=NEW.visitor_id FOR UPDATE;
 SELECT * INTO c FROM app.consent_receipt WHERE id=v.current_consent_id;
 IF o.status IS DISTINCT FROM 'pending' OR (o.payment_status IS DISTINCT FROM 'pending' AND NOT (o.payment_method='cod' AND o.payment_status='cod_due' AND EXISTS(SELECT 1 FROM app.cod_confirmation WHERE order_id=o.id) AND NOT EXISTS(SELECT 1 FROM app.economic_receipt WHERE order_id=o.id))) OR o.expires_at<=app.reservation_clock(o.clock_namespace)
  OR v.status IS DISTINCT FROM 'active' OR v.expires_at<=clock_timestamp() OR c.id IS DISTINCT FROM NEW.consent_receipt_id OR c.visitor_id IS DISTINCT FROM v.id OR c.expires_at<=clock_timestamp()
  OR NOT (coalesce(c.choices->>'analytics'='granted',false) OR app.ad_measurement_allowed(c.choices,'meta') OR app.ad_measurement_allowed(c.choices,'google') OR app.ad_measurement_allowed(c.choices,'tiktok'))
  OR NOT ((v.principal_scope='browser' AND o.owner_guest_id IS NOT NULL) OR (o.owner_user_id IS NOT NULL AND left(v.principal_scope,length('user:'||o.owner_user_id||':'))='user:'||o.owner_user_id||':'))
 THEN RAISE EXCEPTION 'Optional order attribution requires an eligible current independently owned context' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.purchase_receipt_payload(selected uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN receipt.kind='prepaid' THEN app.purchase_signal_payload(receipt.order_id) ELSE (
  SELECT jsonb_build_object('currency','IDR','contents',coalesce(jsonb_agg(jsonb_build_object('id',part.catalog_id,'quantity',part.quantity,'merchandise_amount',99000::bigint*part.quantity) ORDER BY part.id),'[]'::jsonb),'content_ids',coalesce(jsonb_agg(part.catalog_id ORDER BY part.id),'[]'::jsonb)) FROM (
   SELECT i.id,o.catalog_id,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.offer o ON o.id=i.offer_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=receipt.order_id GROUP BY i.id,o.catalog_id
  ) part
 ) END FROM app.economic_receipt receipt WHERE receipt.id=selected;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_commerce_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt app.economic_receipt%ROWTYPE; operation app.commerce_operation%ROWTYPE; visitor app.visitor_session%ROWTYPE; consent app.consent_receipt%ROWTYPE; expected jsonb;
BEGIN
 IF NEW.name='Purchase' THEN
  SELECT * INTO receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
  IF receipt.id IS NULL OR receipt.kind NOT IN ('prepaid','cod') OR NEW.source_kind<>'economic_receipt' OR NEW.order_id IS DISTINCT FROM receipt.order_id OR NEW.source_reference<>receipt.id::text OR NEW.occurred_at IS DISTINCT FROM receipt.occurred_at OR NEW.merchandise_amount IS DISTINCT FROM receipt.merchandise_amount
   OR NOT ((receipt.kind='prepaid' AND EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.commerce_order o ON o.id=receipt.order_id WHERE r.receipt_id=receipt.id AND r.outcome='confirmed' AND o.payment_status='confirmed'))
    OR (receipt.kind='cod' AND EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.commerce_order o ON o.id=receipt.order_id WHERE r.receipt_id=receipt.id AND r.outcome='collected' AND o.payment_method='cod' AND o.payment_status IN ('partially_collected','confirmed') AND o.actionable_at IS NOT NULL)))
   OR NEW.payload IS DISTINCT FROM app.purchase_receipt_payload(receipt.id)
  THEN RAISE EXCEPTION 'Purchase requires accepted original receipt and frozen merchandise' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.source_kind NOT IN ('commerce_operation','browser') THEN RAISE EXCEPTION 'Observed behavior requires its actual operation or browser intake' USING ERRCODE='23514'; END IF;
  SELECT * INTO visitor FROM app.visitor_session WHERE id=NEW.visitor_id;
  SELECT * INTO consent FROM app.consent_receipt WHERE id=NEW.consent_receipt_id;
  IF visitor.status IS DISTINCT FROM 'active' OR consent.visitor_id IS DISTINCT FROM visitor.id OR consent.id IS DISTINCT FROM visitor.current_consent_id
   OR consent.effective_at>NEW.occurred_at OR consent.expires_at<=NEW.occurred_at
   OR NOT (coalesce(consent.choices->>'analytics'='granted',false) OR app.ad_measurement_allowed(consent.choices,'meta') OR app.ad_measurement_allowed(consent.choices,'google') OR app.ad_measurement_allowed(consent.choices,'tiktok'))
  THEN RAISE EXCEPTION 'Optional behavior requires captured current consent' USING ERRCODE='23514'; END IF;
  IF NEW.source_kind='commerce_operation' THEN
   SELECT * INTO operation FROM app.commerce_operation WHERE id::text=NEW.source_reference;
   expected:=app.signal_operation_payload(operation.id);
   IF expected IS NULL OR NEW.payload IS DISTINCT FROM expected OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',operation.created_at)
    OR NEW.merchandise_amount IS DISTINCT FROM (SELECT coalesce(sum((value->>'merchandise_amount')::bigint),0) FROM jsonb_array_elements(expected->'contents'))
    OR (operation.action='order.create' AND (NEW.name<>'order_placed' OR NEW.order_id IS DISTINCT FROM operation.resource_id))
    OR (operation.action<>'order.create' AND (NEW.name<>'cart_changed' OR NEW.order_id IS NOT NULL))
    OR NOT ((visitor.principal_scope='browser' AND operation.actor_scope LIKE 'guest:%') OR EXISTS(SELECT 1 FROM app.auth_session s WHERE visitor.principal_scope='user:'||s.user_id||':'||s.id AND operation.actor_scope='user:'||s.user_id))
   THEN RAISE EXCEPTION 'Server funnel signal must match its actual committed operation' USING ERRCODE='23514'; END IF;
  ELSIF NEW.source_kind='browser' THEN
   IF NEW.merchandise_amount<>0 OR NOT EXISTS(SELECT 1 FROM app.funnel_intake i WHERE i.id::text=NEW.source_reference AND i.event_id=NEW.id AND i.visitor_id=NEW.visitor_id AND i.consent_receipt_id=NEW.consent_receipt_id)
    OR NEW.occurred_at<clock_timestamp()-interval '5 minutes' OR NEW.occurred_at>clock_timestamp()+interval '5 minutes'
    OR NEW.payload-'currency'-'contents'-'content_ids'-'cart_id'-'order_id'-'product_id'-'variant_id'<>'{}'::jsonb
    OR NEW.payload->>'currency' IS DISTINCT FROM 'IDR' OR NEW.payload->'contents' IS DISTINCT FROM '[]'::jsonb OR NEW.payload->'content_ids' IS DISTINCT FROM '[]'::jsonb
   THEN RAISE EXCEPTION 'Browser observation cannot manufacture economic or optimized cart truth' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.name='Purchase' AND NEW.visitor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.order_ad_attribution a JOIN app.consent_receipt c ON c.visitor_id=a.visitor_id WHERE a.order_id=NEW.order_id AND a.visitor_id=NEW.visitor_id AND a.recorded_at<=NEW.occurred_at AND c.id=NEW.consent_receipt_id AND c.effective_at<=NEW.occurred_at AND c.expires_at>NEW.occurred_at) THEN RAISE EXCEPTION 'Purchase cannot backfill optional visitor context' USING ERRCODE='23514'; END IF;
 IF NEW.consent_receipt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.consent_receipt WHERE id=NEW.consent_receipt_id AND visitor_id=NEW.visitor_id)
 THEN RAISE EXCEPTION 'Signal consent cannot cross visitors' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_commerce_event(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE event app.commerce_event%ROWTYPE; receipt app.economic_receipt%ROWTYPE; expected jsonb; actual jsonb;
BEGIN
 SELECT * INTO event FROM app.commerce_event WHERE id=selected;
 IF event.id IS NULL OR (SELECT count(*) FROM app.ad_event_outbox WHERE event_id=selected)<>3
  OR (SELECT count(DISTINCT platform) FROM app.ad_event_outbox WHERE event_id=selected)<>3
  OR EXISTS(SELECT 1 FROM app.ad_event_outbox o JOIN app.outbox_job j ON j.id=o.job_id WHERE o.event_id=selected AND o.status='suppressed' AND j.status<>'completed')
 THEN RAISE EXCEPTION 'Canonical signal and all platform eligibility decisions seal together' USING ERRCODE='23514'; END IF;
 IF event.name='Purchase' THEN
  SELECT * INTO receipt FROM app.economic_receipt WHERE id=event.receipt_id;
  SELECT jsonb_agg(jsonb_build_array(a.order_item_id,a.quantity,a.merchandise_amount) ORDER BY a.order_item_id) INTO actual FROM app.purchase_allocation a WHERE a.event_id=event.id;
  IF receipt.kind='prepaid' THEN
   SELECT jsonb_agg(jsonb_build_array(i.id,i.quantity,99000::bigint*i.quantity) ORDER BY i.id) INTO expected FROM app.order_item i WHERE i.order_id=event.order_id;
  ELSE
   SELECT jsonb_agg(jsonb_build_array(part.id,part.quantity,99000::bigint*part.quantity) ORDER BY part.id) INTO expected FROM (SELECT i.id,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=event.order_id GROUP BY i.id) part;
  END IF;
  IF receipt.id IS NULL OR expected IS NULL OR actual IS DISTINCT FROM expected OR event.merchandise_amount IS DISTINCT FROM (SELECT sum(merchandise_amount) FROM app.purchase_allocation WHERE event_id=event.id)
   OR EXISTS(SELECT 1 FROM app.purchase_allocation a JOIN app.order_item i ON i.id=a.order_item_id WHERE i.order_id=event.order_id GROUP BY i.id,i.quantity HAVING sum(a.quantity)>i.quantity)
  THEN RAISE EXCEPTION 'Purchase allocations conserve original receipt parcel merchandise exactly once' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM app.purchase_allocation WHERE event_id=event.id) THEN RAISE EXCEPTION 'Nonfinancial observation cannot allocate purchase merchandise' USING ERRCODE='23514'; END IF;
 IF event.source_kind='browser' AND NOT EXISTS(SELECT 1 FROM app.funnel_intake WHERE event_id=event.id AND id::text=event.source_reference AND visitor_id=event.visitor_id AND consent_receipt_id=event.consent_receipt_id)
 THEN RAISE EXCEPTION 'Observed event and original intake seal together' USING ERRCODE='23514'; END IF;
END;
$$;
