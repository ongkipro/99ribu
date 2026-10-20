CREATE TABLE "app"."local_payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_payment_event_value_check" CHECK ("app"."local_payment_event"."status" IN ('pending','confirmed','expired','failed') AND "app"."local_payment_event"."amount" between 1 and 9007199254740991 AND "app"."local_payment_event"."signature" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_payment_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"status" text NOT NULL,
	"requested_amount" bigint NOT NULL,
	"collected_amount" bigint,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_payment_operation_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "local_payment_operation_profile_check" CHECK ("app"."local_payment_operation"."environment" IN ('local','test') AND "app"."local_payment_operation"."status" IN ('pending','confirmed','expired','failed')),
	CONSTRAINT "local_payment_operation_money_check" CHECK ("app"."local_payment_operation"."requested_amount" between 1 and 9007199254740991 AND (("app"."local_payment_operation"."status"='confirmed' AND "app"."local_payment_operation"."collected_amount" IS NOT NULL AND "app"."local_payment_operation"."collected_amount" between 1 and 9007199254740991 AND "app"."local_payment_operation"."paid_at" IS NOT NULL) OR ("app"."local_payment_operation"."status"<>'confirmed' AND "app"."local_payment_operation"."collected_amount" IS NULL AND "app"."local_payment_operation"."paid_at" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."payment_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"creation_job_id" uuid NOT NULL,
	"provider_operation_id" uuid,
	"receipt_id" uuid,
	"expected_amount" bigint NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_attempt_creation_job_id_unique" UNIQUE("creation_job_id"),
	CONSTRAINT "payment_attempt_key_unique" UNIQUE("order_id","key"),
	CONSTRAINT "payment_attempt_identity_check" CHECK ("app"."payment_attempt"."method_id"='local-prepaid' AND "app"."payment_attempt"."key" ~ '^[A-Za-z0-9_-]{16,200}$' AND "app"."payment_attempt"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_attempt_value_check" CHECK ("app"."payment_attempt"."expected_amount" between 1 and 9007199254740991 AND "app"."payment_attempt"."expires_at">"app"."payment_attempt"."created_at" AND "app"."payment_attempt"."revision">=0 AND "app"."payment_attempt"."status" IN ('preparing','pending','unknown','confirmed','expired','failed') AND (("app"."payment_attempt"."status"='preparing')=("app"."payment_attempt"."revision"=0)) AND ("app"."payment_attempt"."status"<>'confirmed' OR ("app"."payment_attempt"."provider_operation_id" IS NOT NULL AND "app"."payment_attempt"."receipt_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."payment_attempt_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_operation_id" uuid,
	"receipt_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_attempt_event_revision_unique" UNIQUE("attempt_id","revision"),
	CONSTRAINT "payment_attempt_event_value_check" CHECK ("app"."payment_attempt_event"."revision">0 AND "app"."payment_attempt_event"."status" IN ('pending','unknown','confirmed','expired','failed') AND "app"."payment_attempt_event"."source_type" IN ('request','provider_link','provider_event','creation_rejected','expiry'))
);
--> statement-breakpoint
CREATE TABLE "app"."payment_event_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"receipt_id" uuid,
	"transaction_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_event_result_outcome_check" CHECK ("app"."payment_event_result"."outcome" IN ('confirmed','failed','expired','ignored','duplicate','recovery') AND "app"."payment_event_result"."reason" IN ('verified_collection','provider_rejected','provider_expired','pending_notification','out_of_order','duplicate_callback','late_payment','amount_mismatch','conflicting_allocation')),
	CONSTRAINT "payment_event_result_money_check" CHECK (("app"."payment_event_result"."outcome" IN ('confirmed','duplicate','recovery') AND "app"."payment_event_result"."transaction_id" IS NOT NULL) OR ("app"."payment_event_result"."outcome" IN ('failed','expired','ignored') AND "app"."payment_event_result"."transaction_id" IS NULL AND "app"."payment_event_result"."receipt_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."payment_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "payment_provider_event_hash_check" CHECK ("app"."payment_provider_event"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_state_check";--> statement-breakpoint
ALTER TABLE "app"."order_event" DROP CONSTRAINT "order_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "actionable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."local_payment_event" ADD CONSTRAINT "local_payment_event_operation_id_local_payment_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_payment_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_payment_operation" ADD CONSTRAINT "local_payment_operation_attempt_id_payment_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."payment_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_creation_job_id_outbox_job_id_fk" FOREIGN KEY ("creation_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_provider_operation_id_local_payment_operation_id_fk" FOREIGN KEY ("provider_operation_id") REFERENCES "app"."local_payment_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt_event" ADD CONSTRAINT "payment_attempt_event_attempt_id_payment_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."payment_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt_event" ADD CONSTRAINT "payment_attempt_event_provider_operation_id_local_payment_operation_id_fk" FOREIGN KEY ("provider_operation_id") REFERENCES "app"."local_payment_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt_event" ADD CONSTRAINT "payment_attempt_event_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_event_result" ADD CONSTRAINT "payment_event_result_event_id_payment_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."payment_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_event_result" ADD CONSTRAINT "payment_event_result_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_event_result" ADD CONSTRAINT "payment_event_result_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_provider_event" ADD CONSTRAINT "payment_provider_event_id_local_payment_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_payment_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_provider_event" ADD CONSTRAINT "payment_provider_event_attempt_id_payment_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."payment_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_provider_event" ADD CONSTRAINT "payment_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_payment_event_operation_idx" ON "app"."local_payment_event" USING btree ("operation_id","recorded_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_active_unique" ON "app"."payment_attempt" USING btree ("order_id") WHERE "app"."payment_attempt"."status" IN ('pending','unknown','confirmed');--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_state_check" CHECK (("app"."commerce_order"."status"='preparing' AND "app"."commerce_order"."revision"=0 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."revision"=1 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='confirmed' AND "app"."commerce_order"."payment_method"='prepaid' AND "app"."commerce_order"."actionable_at" IS NOT NULL) OR ("app"."commerce_order"."status"='cancelled' AND "app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='expired' AND "app"."commerce_order"."actionable_at" IS NULL));--> statement-breakpoint
ALTER TABLE "app"."order_event" ADD CONSTRAINT "order_event_value_check" CHECK (char_length("app"."order_event"."reason") between 1 and 500 AND (("app"."order_event"."revision"=1 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status"='pending') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='cancelled' AND "app"."order_event"."payment_status"='expired') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status"='confirmed')));
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
     OR (NEW.actionable_at IS DISTINCT FROM OLD.actionable_at AND NOT (OLD.actionable_at IS NULL AND NEW.payment_status='confirmed' AND EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.event_id=event.source_id AND r.outcome='confirmed' AND e.order_id=OLD.id AND e.occurred_at=NEW.actionable_at)))
     OR NEW.revision<>OLD.revision+1 OR (NEW.revision,NEW.status,NEW.payment_status) IS DISTINCT FROM (event.revision,event.status,event.payment_status)
   THEN RAISE EXCEPTION 'Order head advances with exact immutable event' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
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
CREATE FUNCTION app.guard_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; event app.payment_attempt_event%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id;
  IF NEW.revision<>0 OR NEW.status<>'preparing' OR NEW.provider_operation_id IS NOT NULL OR NEW.receipt_id IS NOT NULL
    OR o.status IS DISTINCT FROM 'pending' OR o.payment_status IS DISTINCT FROM 'pending' OR o.payment_method IS DISTINCT FROM 'prepaid'
    OR NEW.expected_amount IS DISTINCT FROM o.buyer_total OR NEW.expires_at IS DISTINCT FROM o.expires_at
    OR NEW.created_at<o.created_at OR NEW.created_at>app.reservation_clock(o.clock_namespace) OR NEW.created_at>=o.expires_at
    OR NOT EXISTS(SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.creation_job_id AND j.kind='payment.create' AND j.dedup_key='payment-create:'||NEW.id::text AND j.payload=jsonb_build_object('attemptId',NEW.id))
  THEN RAISE EXCEPTION 'Payment attempt requires original unpaid order and creation intent' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  SELECT * INTO event FROM app.payment_attempt_event WHERE attempt_id=OLD.id AND revision=OLD.revision+1;
  IF (to_jsonb(NEW)-'revision'-'status'-'provider_operation_id'-'receipt_id') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'status'-'provider_operation_id'-'receipt_id')
    OR NEW.revision<>OLD.revision+1 OR (NEW.status,NEW.provider_operation_id,NEW.receipt_id) IS DISTINCT FROM (event.status,event.provider_operation_id,event.receipt_id)
    OR (OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id)
    OR (OLD.receipt_id IS NOT NULL AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id)
  THEN RAISE EXCEPTION 'Payment head requires exact immutable event' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON app.payment_attempt FOR EACH ROW EXECUTE FUNCTION app.guard_payment_attempt();
--> statement-breakpoint
CREATE FUNCTION app.guard_payment_attempt_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt%ROWTYPE; operation app.local_payment_operation%ROWTYPE; result app.payment_event_result%ROWTYPE; valid boolean:=false;
BEGIN
 SELECT * INTO a FROM app.payment_attempt WHERE id=NEW.attempt_id FOR UPDATE;
 IF NEW.revision<>a.revision+1 OR a.status='confirmed' OR a.status IN ('failed','expired') THEN RAISE EXCEPTION 'Payment event must advance its current nonfinal head' USING ERRCODE='23514'; END IF;
 IF NEW.provider_operation_id IS NOT NULL THEN
  SELECT * INTO operation FROM app.local_payment_operation WHERE id=NEW.provider_operation_id;
  IF operation.attempt_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'Payment operation belongs to another attempt' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.source_type='request' THEN
  valid:=a.revision=0 AND NEW.status='pending' AND NEW.source_id=a.creation_job_id AND NEW.provider_operation_id IS NULL AND NEW.receipt_id IS NULL AND NEW.occurred_at=a.created_at;
 ELSIF NEW.source_type='provider_link' THEN
  valid:=a.revision>0 AND a.provider_operation_id IS NULL AND NEW.provider_operation_id IS NOT NULL AND NEW.source_id=NEW.provider_operation_id AND NEW.status=a.status AND NEW.receipt_id IS NOT DISTINCT FROM a.receipt_id;
 ELSIF NEW.source_type='provider_event' THEN
  SELECT r.* INTO result FROM app.payment_event_result r JOIN app.payment_provider_event e ON e.id=r.event_id JOIN app.local_payment_event local ON local.id=e.id
    WHERE r.event_id=NEW.source_id AND e.attempt_id=a.id AND local.operation_id=NEW.provider_operation_id AND local.occurred_at=NEW.occurred_at;
  valid:=result.event_id IS NOT NULL AND NEW.receipt_id IS NOT DISTINCT FROM result.receipt_id AND NEW.status=CASE result.outcome WHEN 'confirmed' THEN 'confirmed' WHEN 'recovery' THEN 'unknown' WHEN 'failed' THEN 'failed' WHEN 'expired' THEN 'expired' ELSE '' END;
 END IF;
 IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Payment event requires matching durable source' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_attempt_event_guard BEFORE INSERT ON app.payment_attempt_event FOR EACH ROW EXECUTE FUNCTION app.guard_payment_attempt_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt%ROWTYPE; selected uuid;
BEGIN
 IF TG_TABLE_NAME='payment_attempt' THEN selected:=NEW.id; ELSE selected:=NEW.attempt_id; END IF;
 SELECT * INTO a FROM app.payment_attempt WHERE id=selected;
 IF a.revision=0 OR a.revision<>(SELECT count(*) FROM app.payment_attempt_event WHERE attempt_id=a.id)
  OR NOT EXISTS(SELECT 1 FROM app.payment_attempt_event WHERE attempt_id=a.id AND revision=a.revision AND (status,provider_operation_id,receipt_id) IS NOT DISTINCT FROM (a.status,a.provider_operation_id,a.receipt_id))
  OR (a.status='confirmed' AND NOT EXISTS(SELECT 1 FROM app.commerce_order o JOIN app.economic_receipt e ON e.id=a.receipt_id JOIN app.payment_event_result r ON r.receipt_id=e.id JOIN app.payment_provider_event v ON v.id=r.event_id WHERE o.id=a.order_id AND o.payment_status='confirmed' AND o.actionable_at=e.occurred_at AND r.outcome='confirmed' AND v.attempt_id=a.id))
 THEN RAISE EXCEPTION 'Payment head/events/funding must seal together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_attempt_sealed AFTER INSERT OR UPDATE ON app.payment_attempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_payment_attempt();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_attempt_event_applied AFTER INSERT ON app.payment_attempt_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_payment_attempt();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_payment_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt%ROWTYPE; o app.commerce_order%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Provider effect history is retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM app.payment_attempt WHERE id=NEW.attempt_id;
 SELECT * INTO o FROM app.commerce_order WHERE id=a.order_id;
 IF NEW.environment IS NULL OR current_database()<>'99ribu_'||NEW.environment OR NEW.requested_amount IS DISTINCT FROM a.expected_amount THEN RAISE EXCEPTION 'Provider operation requires original profile/amount' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status NOT IN ('pending','failed') OR NEW.collected_amount IS NOT NULL OR NEW.paid_at IS NOT NULL
    OR (NEW.status='pending' AND (o.status<>'pending' OR o.payment_status<>'pending' OR a.expires_at<=app.reservation_clock(o.clock_namespace)))
  THEN RAISE EXCEPTION 'Provider operation starts pending or definitively rejected' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp();
 ELSE
  IF OLD.status<>'pending' OR NEW.status NOT IN ('confirmed','expired','failed')
   OR (to_jsonb(NEW)-'status'-'collected_amount'-'paid_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'collected_amount'-'paid_at')
   OR (NEW.status='confirmed' AND (NEW.paid_at<a.created_at OR NEW.paid_at>app.reservation_clock(o.clock_namespace)))
  THEN RAISE EXCEPTION 'Provider effect finality cannot be rewritten' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_payment_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.local_payment_operation FOR EACH ROW EXECUTE FUNCTION app.guard_local_payment_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p app.local_payment_operation%ROWTYPE; a app.payment_attempt%ROWTYPE; o app.commerce_order%ROWTYPE;
BEGIN
 SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.operation_id;
 SELECT * INTO a FROM app.payment_attempt WHERE id=p.attempt_id;
 SELECT * INTO o FROM app.commerce_order WHERE id=a.order_id;
 IF NEW.status IS DISTINCT FROM p.status OR NEW.amount IS DISTINCT FROM coalesce(p.collected_amount,p.requested_amount)
  OR NEW.occurred_at<a.created_at OR NEW.occurred_at>app.reservation_clock(o.clock_namespace)
  OR (p.status='confirmed' AND NEW.occurred_at IS DISTINCT FROM p.paid_at)
 THEN RAISE EXCEPTION 'Provider event must reflect actual original effect' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_payment_event_guard BEFORE INSERT ON app.local_payment_event FOR EACH ROW EXECUTE FUNCTION app.guard_local_payment_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_local_payment_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p app.local_payment_operation%ROWTYPE;
BEGIN
 SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM app.local_payment_event WHERE operation_id=p.id AND status=p.status AND amount=coalesce(p.collected_amount,p.requested_amount) AND (p.status<>'confirmed' OR occurred_at=p.paid_at))
 THEN RAISE EXCEPTION 'Provider operation and source event seal together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_payment_operation_sealed AFTER INSERT OR UPDATE ON app.local_payment_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_payment_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_payment_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.local_payment_event e JOIN app.local_payment_operation p ON p.id=e.operation_id WHERE e.id=NEW.id AND p.attempt_id=NEW.attempt_id)
  OR NOT EXISTS(SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.callback_job_id AND j.kind='payment.callback' AND j.dedup_key='payment-callback:'||NEW.id::text AND j.payload=jsonb_build_object('eventId',NEW.id))
 THEN RAISE EXCEPTION 'Verified payment event requires original source and callback intent' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_provider_event_guard BEFORE INSERT ON app.payment_provider_event FOR EACH ROW EXECUTE FUNCTION app.guard_payment_provider_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_payment_event_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e app.local_payment_event%ROWTYPE; v app.payment_provider_event%ROWTYPE; p app.local_payment_operation%ROWTYPE; a app.payment_attempt%ROWTYPE; receipt app.economic_receipt%ROWTYPE; journal app.finance_transaction%ROWTYPE;
BEGIN
 SELECT * INTO v FROM app.payment_provider_event WHERE id=NEW.event_id;
 SELECT * INTO e FROM app.local_payment_event WHERE id=NEW.event_id;
 SELECT * INTO p FROM app.local_payment_operation WHERE id=e.operation_id;
 SELECT * INTO a FROM app.payment_attempt WHERE id=v.attempt_id;
 IF NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=v.callback_job_id AND status='completed' AND result->>'event_id'=NEW.event_id::text)
 THEN RAISE EXCEPTION 'Payment result and own callback completion seal together' USING ERRCODE='23514'; END IF;
 IF NEW.outcome IN ('confirmed','duplicate','recovery') THEN
  SELECT * INTO journal FROM app.finance_transaction WHERE id=NEW.transaction_id;
  IF e.status<>'confirmed' OR journal.order_id IS DISTINCT FROM a.order_id OR journal.environment IS DISTINCT FROM p.environment OR journal.effect_reference IS DISTINCT FROM p.id::text OR journal.occurred_at IS DISTINCT FROM e.occurred_at
    OR (SELECT count(*) FROM app.finance_posting WHERE transaction_id=journal.id)<>2
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='provider_receivable' AND side='debit' AND amount=e.amount)
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='buyer_funds_liability' AND side='credit' AND amount=e.amount)
  THEN RAISE EXCEPTION 'Payment result requires actual balanced original collection' USING ERRCODE='23514'; END IF;
  IF NEW.receipt_id IS NOT NULL THEN
   SELECT * INTO receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
   IF receipt.transaction_id IS DISTINCT FROM journal.id OR receipt.order_id IS DISTINCT FROM a.order_id OR receipt.kind IS DISTINCT FROM 'prepaid' OR receipt.effect_reference IS DISTINCT FROM p.id::text OR receipt.amount IS DISTINCT FROM e.amount OR receipt.occurred_at IS DISTINCT FROM e.occurred_at OR journal.source IS DISTINCT FROM 'local.payment'
   THEN RAISE EXCEPTION 'Payment receipt must match original effect and journal' USING ERRCODE='23514'; END IF;
  ELSIF journal.source IS DISTINCT FROM 'local.payment.recovery' OR journal.kind<>'adjustment' THEN RAISE EXCEPTION 'Unallocated funds require recovery liability' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='confirmed' AND (NEW.receipt_id IS NULL OR NOT EXISTS(SELECT 1 FROM app.commerce_order o JOIN app.order_event event ON event.order_id=o.id AND event.revision=o.revision WHERE o.id=a.order_id AND o.payment_status='confirmed' AND o.actionable_at=e.occurred_at AND event.source_id=e.id AND a.status='confirmed' AND a.receipt_id=NEW.receipt_id))
  THEN RAISE EXCEPTION 'Accepted collection requires funded order and attempt' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='recovery' AND (a.status<>'unknown' OR a.provider_operation_id IS DISTINCT FROM p.id OR a.receipt_id IS DISTINCT FROM NEW.receipt_id OR NOT EXISTS(SELECT 1 FROM app.payment_attempt_event WHERE attempt_id=a.id AND source_type='provider_event' AND source_id=e.id AND status='unknown'))
  THEN RAISE EXCEPTION 'Recovery funds require durable attempt recovery state' USING ERRCODE='23514'; END IF;
 ELSIF (NEW.outcome='failed' AND (e.status<>'failed' OR a.status<>'failed')) OR (NEW.outcome='expired' AND (e.status<>'expired' OR a.status<>'expired'))
 THEN RAISE EXCEPTION 'Negative result requires actual provider outcome' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_event_result_sealed AFTER INSERT ON app.payment_event_result DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_payment_event_result();
--> statement-breakpoint
CREATE FUNCTION app.record_payment_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.recorded_at:=clock_timestamp();RETURN NEW;END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_event_result_recorded BEFORE INSERT ON app.payment_event_result FOR EACH ROW EXECUTE FUNCTION app.record_payment_result();
--> statement-breakpoint
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['payment_attempt_event','local_payment_event','payment_provider_event','payment_event_result'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
END $$;
