CREATE TABLE "app"."fulfillment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"deadline_id" uuid,
	"booking_id" uuid,
	"calendar_error" text,
	"prepared_at" timestamp with time zone,
	"waybill_issued_at" timestamp with time zone,
	"tracking_number" text,
	"handover_at" timestamp with time zone,
	"handover_reference" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fulfillment_shipment_id_unique" UNIQUE("shipment_id"),
	CONSTRAINT "fulfillment_state_check" CHECK ("app"."fulfillment"."revision">=0 AND "app"."fulfillment"."status" IN ('preparing','ready','picking','packed','handover_pending','handed_over','exception') AND ("app"."fulfillment"."tracking_number" IS NULL OR "app"."fulfillment"."tracking_number" ~ '^LOCAL-[A-F0-9]{32}$') AND ("app"."fulfillment"."handover_reference" IS NULL OR char_length("app"."fulfillment"."handover_reference") between 1 and 200))
);
--> statement-breakpoint
CREATE TABLE "app"."fulfillment_deadline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"calendar_version_id" uuid NOT NULL,
	"calendar" jsonb NOT NULL,
	"calendar_coverage" jsonb NOT NULL,
	"handover_calendar_coverage" jsonb,
	"actionable_at" timestamp with time zone NOT NULL,
	"packing_due_at" timestamp with time zone NOT NULL,
	"handover_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "fulfillment_deadline_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "fulfillment_deadline_value_check" CHECK (jsonb_typeof("app"."fulfillment_deadline"."calendar")='object' AND "app"."fulfillment_deadline"."packing_due_at">"app"."fulfillment_deadline"."actionable_at" AND ("app"."fulfillment_deadline"."handover_due_at" IS NULL OR "app"."fulfillment_deadline"."handover_due_at">"app"."fulfillment_deadline"."actionable_at"))
);
--> statement-breakpoint
CREATE TABLE "app"."fulfillment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_id" text,
	"public_explanation" text,
	"deadline_id" uuid,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "fulfillment_event_revision_unique" UNIQUE("fulfillment_id","revision"),
	CONSTRAINT "fulfillment_event_value_check" CHECK ("app"."fulfillment_event"."revision">0 AND "app"."fulfillment_event"."status" IN ('ready','picking','packed','handover_pending','handed_over','exception') AND "app"."fulfillment_event"."kind" IN ('initialize','prepare','booking','issued','packed','handover','exception','reschedule') AND "app"."fulfillment_event"."source_kind" IN ('activation','operation','provider') AND char_length("app"."fulfillment_event"."reason") between 1 and 500 AND (("app"."fulfillment_event"."kind"='reschedule' AND "app"."fulfillment_event"."public_explanation" IS NOT NULL AND char_length("app"."fulfillment_event"."public_explanation") between 1 and 200) OR ("app"."fulfillment_event"."kind"<>'reschedule' AND "app"."fulfillment_event"."public_explanation" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."fulfillment_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"job_id" uuid NOT NULL,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone,
	CONSTRAINT "fulfillment_notice_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "fulfillment_notice_identity_unique" UNIQUE("fulfillment_id","source_id","kind"),
	CONSTRAINT "fulfillment_notice_value_check" CHECK ("app"."fulfillment_notice"."kind" IN ('calendar_missing','packing_overdue','handover_overdue','booking_failed','rescheduled') AND char_length("app"."fulfillment_notice"."message") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."local_waybill_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"tracking_number" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_waybill_event_value_check" CHECK ("app"."local_waybill_event"."status" IN ('acknowledged','issued','failed') AND "app"."local_waybill_event"."signature" ~ '^[a-f0-9]{64}$' AND (("app"."local_waybill_event"."status"='issued' AND "app"."local_waybill_event"."tracking_number" ~ '^LOCAL-[A-F0-9]{32}$') OR ("app"."local_waybill_event"."status"<>'issued' AND "app"."local_waybill_event"."tracking_number" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."local_waybill_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'acknowledged' NOT NULL,
	"tracking_number" text,
	"created_at" timestamp with time zone NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "local_waybill_operation_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "local_waybill_operation_tracking_number_unique" UNIQUE("tracking_number"),
	CONSTRAINT "local_waybill_operation_value_check" CHECK ("app"."local_waybill_operation"."environment" IN ('local','test') AND "app"."local_waybill_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND (("app"."local_waybill_operation"."status"='acknowledged' AND "app"."local_waybill_operation"."tracking_number" IS NULL AND "app"."local_waybill_operation"."terminal_at" IS NULL) OR ("app"."local_waybill_operation"."status"='issued' AND "app"."local_waybill_operation"."tracking_number" ~ '^LOCAL-[A-F0-9]{32}$' AND "app"."local_waybill_operation"."terminal_at">="app"."local_waybill_operation"."created_at") OR ("app"."local_waybill_operation"."status"='failed' AND "app"."local_waybill_operation"."tracking_number" IS NULL AND "app"."local_waybill_operation"."terminal_at">="app"."local_waybill_operation"."created_at")))
);
--> statement-breakpoint
CREATE TABLE "app"."shipment_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"creation_job_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"provider_operation_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shipment_booking_creation_job_id_unique" UNIQUE("creation_job_id"),
	CONSTRAINT "shipment_booking_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "shipment_booking_state_check" CHECK ("app"."shipment_booking"."status" IN ('queued','acknowledged','issued','failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."waybill_event_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"fulfillment_event_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "waybill_result_value_check" CHECK ("app"."waybill_event_result"."outcome" IN ('acknowledged','issued','failed','duplicate','ignored'))
);
--> statement-breakpoint
CREATE TABLE "app"."waybill_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "waybill_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "waybill_provider_hash_check" CHECK ("app"."waybill_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_state_check";--> statement-breakpoint
ALTER TABLE "app"."order_event" DROP CONSTRAINT "order_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."fulfillment" ADD CONSTRAINT "fulfillment_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_deadline" ADD CONSTRAINT "fulfillment_deadline_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_deadline" ADD CONSTRAINT "fulfillment_deadline_calendar_version_id_policy_version_id_fk" FOREIGN KEY ("calendar_version_id") REFERENCES "app"."policy_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_event" ADD CONSTRAINT "fulfillment_event_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_event" ADD CONSTRAINT "fulfillment_event_deadline_id_fulfillment_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "app"."fulfillment_deadline"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_notice" ADD CONSTRAINT "fulfillment_notice_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_notice" ADD CONSTRAINT "fulfillment_notice_job_id_outbox_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_waybill_event" ADD CONSTRAINT "local_waybill_event_operation_id_local_waybill_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_waybill_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_waybill_operation" ADD CONSTRAINT "local_waybill_operation_booking_id_shipment_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."shipment_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_booking" ADD CONSTRAINT "shipment_booking_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_booking" ADD CONSTRAINT "shipment_booking_creation_job_id_outbox_job_id_fk" FOREIGN KEY ("creation_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_event_result" ADD CONSTRAINT "waybill_event_result_event_id_waybill_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."waybill_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_event_result" ADD CONSTRAINT "waybill_event_result_fulfillment_event_id_fulfillment_event_id_fk" FOREIGN KEY ("fulfillment_event_id") REFERENCES "app"."fulfillment_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_provider_event" ADD CONSTRAINT "waybill_provider_event_id_local_waybill_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_waybill_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_provider_event" ADD CONSTRAINT "waybill_provider_event_booking_id_shipment_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."shipment_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_provider_event" ADD CONSTRAINT "waybill_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_state_check" CHECK (("app"."commerce_order"."status"='preparing' AND "app"."commerce_order"."revision"=0 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."revision"=1 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status" IN ('pending','processing') AND "app"."commerce_order"."revision">=2 AND "app"."commerce_order"."payment_status"='confirmed' AND "app"."commerce_order"."payment_method"='prepaid' AND "app"."commerce_order"."actionable_at" IS NOT NULL) OR ("app"."commerce_order"."status" IN ('pending','processing') AND "app"."commerce_order"."payment_method"='cod' AND "app"."commerce_order"."actionable_at" IS NOT NULL AND ("app"."commerce_order"."revision">=2 AND "app"."commerce_order"."payment_status" IN ('cod_due','partially_collected','confirmed'))) OR ("app"."commerce_order"."status"='cancelled' AND "app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='expired' AND "app"."commerce_order"."actionable_at" IS NULL));--> statement-breakpoint
ALTER TABLE "app"."order_event" ADD CONSTRAINT "order_event_value_check" CHECK (char_length("app"."order_event"."reason") between 1 and 500 AND (("app"."order_event"."revision"=1 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status"='pending') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='cancelled' AND "app"."order_event"."payment_status"='expired') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status" IN ('confirmed','cod_due')) OR ("app"."order_event"."revision">=3 AND "app"."order_event"."status" IN ('pending','processing') AND "app"."order_event"."payment_status" IN ('cod_due','partially_collected','confirmed'))));
--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_booking_active_unique" ON "app"."shipment_booking" USING btree ("fulfillment_id") WHERE "app"."shipment_booking"."status"<>'failed';
--> statement-breakpoint
ALTER TABLE app.shipment_booking ADD CONSTRAINT shipment_booking_operation_fk FOREIGN KEY (operation_id) REFERENCES app.access_operation(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION app.shipping_calendar_due(warehouse uuid,coverage jsonb,anchor timestamptz,days int) RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE entry jsonb; policy app.policy_version%ROWTYPE; root app.policy_head%ROWTYPE; zone text; anchor_date date; year int; ordinal int:=0; actual int; result timestamptz;
BEGIN
 IF days NOT IN (1,2) OR jsonb_typeof(coverage) IS DISTINCT FROM 'array' OR jsonb_array_length(coverage)=0 THEN RAISE EXCEPTION 'Calendar coverage is required' USING ERRCODE='23514';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coverage) LOOP
  SELECT * INTO policy FROM app.policy_version WHERE id=(entry->>'id')::uuid;SELECT * INTO root FROM app.policy_head WHERE id=policy.head_id;
  IF policy.id IS NULL OR root.kind IS DISTINCT FROM 'warehouse_calendar' OR root.warehouse_id IS DISTINCT FROM warehouse OR entry->'values' IS DISTINCT FROM policy.values
   OR policy.values->>'source' IS DISTINCT FROM 'TEST-ONLY' OR policy.values->>'approval' IS DISTINCT FROM 'test_only'
  THEN RAISE EXCEPTION 'Calendar snapshot must retain a real scoped policy version' USING ERRCODE='23514';END IF;
  IF ordinal=0 THEN zone:=policy.values->>'timezone';anchor_date:=(anchor AT TIME ZONE zone)::date;year:=extract(year from anchor_date)::int;END IF;
  IF policy.values->>'timezone' IS DISTINCT FROM zone OR (policy.values->>'year')::int<>year+ordinal
   OR (ordinal>0 AND policy.effective_at>(make_date(year+ordinal,1,1)::timestamp AT TIME ZONE zone))
  THEN RAISE EXCEPTION 'Calendar coverage must be consecutive and effective for its year' USING ERRCODE='23514';END IF;
  ordinal:=ordinal+1;
 END LOOP;
 WITH calendar AS (SELECT value->'values' value FROM jsonb_array_elements(coverage)), dates AS (
  SELECT c.value,make_date((c.value->>'year')::int,1,1)+n date FROM calendar c
  CROSS JOIN LATERAL generate_series(0,make_date((c.value->>'year')::int+1,1,1)-make_date((c.value->>'year')::int,1,1)-1) n
 ), eligible AS (
  SELECT date,value,row_number() OVER (ORDER BY date) n FROM dates WHERE date>anchor_date
   AND extract(dow from date)::int IN (SELECT value::int FROM jsonb_array_elements_text(dates.value->'working_weekdays'))
   AND NOT ((value->'closed_dates') ? date::text)
 ) SELECT ((date+(value->>'cutoff_local')::time) AT TIME ZONE zone),n::int INTO result,actual FROM eligible WHERE n=days;
 IF result IS NULL OR actual<>days THEN RAISE EXCEPTION 'Calendar does not cover the required operational date' USING ERRCODE='23514';END IF;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.guard_fulfillment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment%ROWTYPE; o app.commerce_order%ROWTYPE; s app.order_shipment%ROWTYPE;
BEGIN
 SELECT * INTO f FROM app.fulfillment WHERE id=NEW.fulfillment_id FOR UPDATE;SELECT * INTO s FROM app.order_shipment WHERE id=f.shipment_id;SELECT * INTO o FROM app.commerce_order WHERE id=s.order_id;
 IF f.id IS NULL OR NEW.revision<>f.revision+1 OR NEW.occurred_at<f.created_at OR NEW.occurred_at>app.reservation_clock(o.clock_namespace)
  OR (NEW.source_kind='operation' AND (NEW.actor_id IS NULL OR NEW.occurred_at<app.reservation_clock(o.clock_namespace)-interval '5 seconds'))
 THEN RAISE EXCEPTION 'Fulfillment event requires its current original parcel' USING ERRCODE='23514';END IF;
 IF NEW.kind='initialize' THEN
  IF f.revision<>0 OR f.status<>'preparing' OR NEW.source_kind<>'activation' OR NEW.occurred_at IS DISTINCT FROM o.actionable_at OR NEW.status NOT IN ('ready','exception')
   OR NOT ((o.payment_method='cod' AND EXISTS(SELECT 1 FROM app.cod_confirmation WHERE id=NEW.source_id AND order_id=o.id)) OR (o.payment_method='prepaid' AND EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND revision=2 AND source_id=NEW.source_id AND payment_status='confirmed')))
  THEN RAISE EXCEPTION 'Fulfillment starts from original accepted actionability' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='prepare' THEN
  IF f.status<>'ready' OR f.prepared_at IS NOT NULL OR f.deadline_id IS NULL OR NEW.status<>'picking' OR NEW.source_kind<>'operation' THEN RAISE EXCEPTION 'Preparation requires an operational original parcel' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='booking' THEN
  IF f.prepared_at IS NULL OR f.calendar_error IS NOT NULL OR f.deadline_id IS NULL OR NEW.status<>'picking' OR NEW.source_kind<>'operation' OR NOT ((f.status='picking' AND f.booking_id IS NULL) OR (f.status='exception' AND EXISTS(SELECT 1 FROM app.shipment_booking WHERE id=f.booking_id AND status='failed') AND NEW.reason<>'Scoped original parcel operation')) THEN RAISE EXCEPTION 'Booking requires physical preparation' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='issued' THEN
  IF f.status<>'picking' OR f.prepared_at IS NULL OR f.booking_id IS NULL OR NEW.status<>'packed' OR NEW.source_kind<>'provider' THEN RAISE EXCEPTION 'Packing milestone requires issued source evidence' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='packed' THEN
  IF f.status<>'packed' OR f.waybill_issued_at IS NULL OR NEW.status<>'handover_pending' OR NEW.source_kind<>'operation' THEN RAISE EXCEPTION 'Packing confirmation requires usable tracking' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='handover' THEN
  IF f.status NOT IN ('packed','handover_pending') OR f.prepared_at IS NULL OR f.waybill_issued_at IS NULL OR NEW.status<>'handed_over' OR NEW.source_kind<>'operation' THEN RAISE EXCEPTION 'Handover requires preparation and issued tracking' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='exception' THEN
  IF f.status<>'picking' OR f.booking_id IS NULL OR NEW.status<>'exception' OR NEW.source_kind<>'provider' THEN RAISE EXCEPTION 'Booking exception requires original provider source' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='reschedule' THEN
  IF f.handover_at IS NOT NULL OR NEW.source_kind<>'operation' OR NEW.deadline_id IS NULL OR NEW.status IS DISTINCT FROM (CASE WHEN f.status='exception' AND f.booking_id IS NOT NULL THEN 'exception' WHEN f.waybill_issued_at IS NOT NULL THEN f.status WHEN f.prepared_at IS NOT NULL THEN 'picking' ELSE 'ready' END) THEN RAISE EXCEPTION 'Reschedule retains original milestone state' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Unsupported fulfillment transition' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fulfillment_event_guard BEFORE INSERT ON app.fulfillment_event FOR EACH ROW EXECUTE FUNCTION app.guard_fulfillment_event();
--> statement-breakpoint
CREATE FUNCTION app.guard_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e app.fulfillment_event%ROWTYPE; o app.commerce_order%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fulfillment history is retained' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  SELECT o2.* INTO o FROM app.commerce_order o2 JOIN app.order_shipment s ON s.order_id=o2.id WHERE s.id=NEW.shipment_id;
  IF o.actionable_at IS NULL OR NEW.created_at IS DISTINCT FROM o.actionable_at OR NEW.status<>'preparing' OR NEW.revision<>0 OR NEW.deadline_id IS NOT NULL OR NEW.booking_id IS NOT NULL OR NEW.prepared_at IS NOT NULL OR NEW.waybill_issued_at IS NOT NULL OR NEW.handover_at IS NOT NULL THEN RAISE EXCEPTION 'Fulfillment requires accepted original actionability' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO e FROM app.fulfillment_event WHERE fulfillment_id=OLD.id AND revision=OLD.revision+1;
 IF e.id IS NULL OR NEW.revision<>OLD.revision+1 OR (NEW.status,NEW.deadline_id) IS DISTINCT FROM (e.status,e.deadline_id)
  OR (to_jsonb(NEW)-'revision'-'status'-'deadline_id'-'booking_id'-'calendar_error'-'prepared_at'-'waybill_issued_at'-'tracking_number'-'handover_at'-'handover_reference') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'status'-'deadline_id'-'booking_id'-'calendar_error'-'prepared_at'-'waybill_issued_at'-'tracking_number'-'handover_at'-'handover_reference')
  OR (NEW.prepared_at IS DISTINCT FROM OLD.prepared_at AND NOT (e.kind='prepare' AND OLD.prepared_at IS NULL AND NEW.prepared_at=e.occurred_at))
  OR (NEW.waybill_issued_at IS DISTINCT FROM OLD.waybill_issued_at AND NOT (e.kind='issued' AND OLD.waybill_issued_at IS NULL AND NEW.waybill_issued_at=e.occurred_at))
  OR (NEW.tracking_number IS DISTINCT FROM OLD.tracking_number AND e.kind<>'issued')
  OR (NEW.handover_at IS DISTINCT FROM OLD.handover_at AND NOT (e.kind='handover' AND OLD.handover_at IS NULL AND NEW.handover_at=e.occurred_at))
  OR (NEW.handover_reference IS DISTINCT FROM OLD.handover_reference AND e.kind<>'handover')
  OR (NEW.booking_id IS DISTINCT FROM OLD.booking_id AND e.kind<>'booking')
  OR (NEW.deadline_id IS DISTINCT FROM OLD.deadline_id AND e.kind NOT IN ('initialize','issued','reschedule'))
  OR (NEW.calendar_error IS DISTINCT FROM OLD.calendar_error AND e.kind NOT IN ('initialize','issued','reschedule'))
 THEN RAISE EXCEPTION 'Fulfillment head advances with one exact immutable event' USING ERRCODE='23514';END IF;
 IF (e.kind='prepare' AND NEW.prepared_at IS DISTINCT FROM e.occurred_at) OR (e.kind='issued' AND (NEW.waybill_issued_at IS DISTINCT FROM e.occurred_at OR NEW.tracking_number IS NULL)) OR (e.kind='booking' AND NEW.booking_id IS NULL) THEN RAISE EXCEPTION 'Milestone fields must match their exact causal event' USING ERRCODE='23514';END IF;
 IF e.kind='initialize' AND ((NEW.status='ready' AND (NEW.deadline_id IS NULL OR NEW.calendar_error IS NOT NULL)) OR (NEW.status='exception' AND (NEW.deadline_id IS NOT NULL OR NEW.calendar_error IS NULL))) THEN RAISE EXCEPTION 'Initial calendar state must be truthful' USING ERRCODE='23514';END IF;
 IF e.kind='handover' AND (NEW.handover_reference IS NULL OR NEW.handover_at<NEW.prepared_at OR NEW.handover_at<NEW.waybill_issued_at) THEN RAISE EXCEPTION 'Handover is a separate physical milestone' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fulfillment_guard BEFORE INSERT OR UPDATE OR DELETE ON app.fulfillment FOR EACH ROW EXECUTE FUNCTION app.guard_fulfillment();
--> statement-breakpoint
CREATE FUNCTION app.seal_fulfillment_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment%ROWTYPE; s app.order_shipment%ROWTYPE; o app.commerce_order%ROWTYPE; e app.fulfillment_event%ROWTYPE;
BEGIN
 SELECT * INTO f FROM app.fulfillment WHERE id=NEW.fulfillment_id;SELECT * INTO s FROM app.order_shipment WHERE id=f.shipment_id;SELECT * INTO o FROM app.commerce_order WHERE id=s.order_id;SELECT * INTO e FROM app.fulfillment_event WHERE id=NEW.source_id;
 IF e.fulfillment_id IS DISTINCT FROM f.id OR e.deadline_id IS DISTINCT FROM NEW.id OR e.kind NOT IN ('initialize','issued','reschedule') OR NEW.actionable_at IS DISTINCT FROM o.actionable_at
  OR NEW.calendar_version_id::text IS DISTINCT FROM NEW.calendar_coverage->0->>'id' OR NEW.calendar IS DISTINCT FROM NEW.calendar_coverage->0->'values'
  OR NEW.packing_due_at IS DISTINCT FROM app.shipping_calendar_due(s.warehouse_id,NEW.calendar_coverage,NEW.actionable_at,2)
  OR ((NEW.handover_due_at IS NULL)<>(NEW.handover_calendar_coverage IS NULL))
  OR (NEW.handover_due_at IS NOT NULL AND (f.waybill_issued_at IS NULL OR NEW.handover_due_at IS DISTINCT FROM app.shipping_calendar_due(s.warehouse_id,NEW.handover_calendar_coverage,f.waybill_issued_at,1)))
 THEN RAISE EXCEPTION 'Deadline snapshots require original anchors and real covered policy versions' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fulfillment_deadline_sealed AFTER INSERT ON app.fulfillment_deadline DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_fulfillment_deadline();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_waybill_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b app.shipment_booking%ROWTYPE; f app.fulfillment%ROWTYPE; o app.commerce_order%ROWTYPE; now_at timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Waybill source history is retained' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM app.shipment_booking WHERE id=NEW.booking_id;SELECT * INTO f FROM app.fulfillment WHERE id=b.fulfillment_id;SELECT order2.* INTO o FROM app.commerce_order order2 JOIN app.order_shipment s ON s.order_id=order2.id WHERE s.id=f.shipment_id;now_at:=app.reservation_clock(o.clock_namespace);
 IF current_database()<>'99ribu_'||NEW.environment OR f.prepared_at IS NULL OR f.booking_id IS DISTINCT FROM b.id THEN RAISE EXCEPTION 'Waybill source requires original prepared booking and profile' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'acknowledged' OR NEW.created_at<b.created_at OR NEW.created_at<f.prepared_at OR NEW.created_at>now_at OR NEW.created_at<now_at-interval '5 seconds' OR f.handover_at IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=b.creation_job_id AND kind='shipping.create' AND status='processing' AND dispatched_at IS NOT NULL AND lease_until>clock_timestamp() AND payload=jsonb_build_object('bookingId',b.id::text))
  THEN RAISE EXCEPTION 'Waybill creation requires the current dispatched original job' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-'status'-'tracking_number'-'terminal_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'tracking_number'-'terminal_at') OR OLD.status<>'acknowledged' OR NEW.status NOT IN ('issued','failed') OR NEW.terminal_at>now_at OR NEW.terminal_at<now_at-interval '5 seconds'
   OR (NEW.status='issued' AND NEW.tracking_number IS DISTINCT FROM 'LOCAL-'||upper(replace(NEW.id::text,'-','')))
  THEN RAISE EXCEPTION 'Waybill source resolves once with an original tracking identity' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER local_waybill_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.local_waybill_operation FOR EACH ROW EXECUTE FUNCTION app.guard_local_waybill_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_waybill_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation app.local_waybill_operation%ROWTYPE;
BEGIN
 SELECT * INTO operation FROM app.local_waybill_operation WHERE id=NEW.operation_id;
 IF operation.id IS NULL OR (NEW.status='acknowledged' AND (NEW.tracking_number IS NOT NULL OR NEW.occurred_at IS DISTINCT FROM operation.created_at))
  OR (NEW.status<>'acknowledged' AND (NEW.status IS DISTINCT FROM operation.status OR NEW.tracking_number IS DISTINCT FROM operation.tracking_number OR NEW.occurred_at IS DISTINCT FROM operation.terminal_at))
 THEN RAISE EXCEPTION 'Waybill deliveries retain the original source effect and time' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER local_waybill_event_guard BEFORE INSERT ON app.local_waybill_event FOR EACH ROW EXECUTE FUNCTION app.guard_local_waybill_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_local_waybill_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.local_waybill_event WHERE operation_id=NEW.id AND status=NEW.status AND tracking_number IS NOT DISTINCT FROM NEW.tracking_number AND occurred_at=coalesce(NEW.terminal_at,NEW.created_at)) THEN RAISE EXCEPTION 'Waybill source and original signed delivery seal together' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_waybill_operation_sealed AFTER INSERT OR UPDATE ON app.local_waybill_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_waybill_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_waybill_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.local_waybill_event e JOIN app.local_waybill_operation o ON o.id=e.operation_id JOIN app.outbox_job j ON j.id=NEW.callback_job_id WHERE e.id=NEW.id AND o.booking_id=NEW.booking_id AND j.kind='shipping.callback' AND j.dedup_key='shipping-callback:'||e.id::text AND j.payload=jsonb_build_object('eventId',e.id::text)) THEN RAISE EXCEPTION 'Waybill registration binds one exact source and callback' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER waybill_provider_event_guard BEFORE INSERT ON app.waybill_provider_event FOR EACH ROW EXECUTE FUNCTION app.guard_waybill_provider_event();
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['fulfillment_event','fulfillment_deadline','local_waybill_event','waybill_provider_event','waybill_event_result'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
END $$;

--> statement-breakpoint
CREATE UNIQUE INDEX fulfillment_causal_source_unique ON app.fulfillment_event (source_kind,source_id) WHERE source_kind IN ('operation','provider');
--> statement-breakpoint
CREATE FUNCTION app.assert_fulfillment(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment%ROWTYPE; e app.fulfillment_event%ROWTYPE; b app.shipment_booking%ROWTYPE; expected jsonb; actual jsonb;
BEGIN
 SELECT * INTO f FROM app.fulfillment WHERE id=selected;IF f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment is required' USING ERRCODE='23514';END IF;
 IF f.revision=0 OR f.revision<>(SELECT count(*) FROM app.fulfillment_event WHERE fulfillment_id=f.id)
  OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND revision=f.revision AND status=f.status AND deadline_id IS NOT DISTINCT FROM f.deadline_id)
  OR (f.deadline_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.fulfillment_deadline WHERE id=f.deadline_id AND fulfillment_id=f.id))
  OR (f.prepared_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='prepare' AND occurred_at=f.prepared_at))
 THEN RAISE EXCEPTION 'Fulfillment head and immutable lineage seal together' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM app.shipment_booking WHERE id=f.booking_id AND fulfillment_id=f.id;
 IF f.booking_id IS DISTINCT FROM b.id
  OR EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.fulfillment_id=f.id AND (NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='booking' AND source_id=historical.operation_id AND occurred_at=historical.created_at) OR (historical.id IS DISTINCT FROM b.id AND historical.status<>'failed')))
 THEN RAISE EXCEPTION 'Fulfillment retains every booking and only replaces verified terminal failures' USING ERRCODE='23514';END IF;
 IF (f.waybill_issued_at IS NOT NULL)<>(EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='issued')) THEN RAISE EXCEPTION 'Issued tracking requires its exact immutable milestone' USING ERRCODE='23514';END IF;
 IF f.waybill_issued_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result r JOIN app.local_waybill_event source ON source.id=r.event_id JOIN app.local_waybill_operation operation ON operation.id=source.operation_id JOIN app.fulfillment_event event ON event.id=r.fulfillment_event_id WHERE r.outcome='issued' AND operation.booking_id=b.id AND source.status='issued' AND source.tracking_number=f.tracking_number AND source.occurred_at=f.waybill_issued_at AND event.fulfillment_id=f.id AND event.kind='issued' AND event.source_id=source.id) THEN RAISE EXCEPTION 'Usable tracking requires its verified callback result' USING ERRCODE='23514';END IF;
 FOR e IN SELECT * FROM app.fulfillment_event WHERE fulfillment_id=f.id LOOP
  IF e.source_kind='operation' AND (NOT EXISTS(SELECT 1 FROM app.access_operation operation WHERE operation.id=e.source_id AND operation.actor_id=e.actor_id AND operation.action='fulfillment.mutate' AND (operation.response->>'id'=f.id::text OR (e.kind='booking' AND EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.fulfillment_id=f.id AND historical.operation_id=e.source_id AND operation.response->>'operation_id'=historical.id::text))))
   OR NOT EXISTS(SELECT 1 FROM app.audit_event audit WHERE audit.actor_id=e.actor_id AND audit.subject_id=f.id::text AND audit.outcome='allowed' AND audit.details->>'operation_id'=e.source_id::text AND audit.action=CASE e.kind WHEN 'prepare' THEN 'fulfillment.prepare' WHEN 'booking' THEN 'fulfillment.book' WHEN 'packed' THEN 'fulfillment.packing' WHEN 'handover' THEN 'fulfillment.handover' WHEN 'reschedule' THEN 'fulfillment.reschedule' ELSE '' END)) THEN RAISE EXCEPTION 'Staff fulfillment events require their committed scoped operation and audit' USING ERRCODE='23514';END IF;
  IF e.source_kind='provider' AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result JOIN app.waybill_provider_event provider ON provider.id=result.event_id WHERE result.fulfillment_event_id=e.id AND provider.id=e.source_id AND EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.id=provider.booking_id AND historical.fulfillment_id=f.id) AND result.outcome IN ('issued','failed')) THEN RAISE EXCEPTION 'Provider fulfillment events require accepted original callback evidence' USING ERRCODE='23514';END IF;
  IF e.kind='handover' THEN
   IF f.handover_at IS DISTINCT FROM e.occurred_at THEN RAISE EXCEPTION 'Handover time is immutable' USING ERRCODE='23514';END IF;
   SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO expected FROM (SELECT a.balance_id,sum(a.quantity)::bigint quantity FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item i ON i.id=a.fulfillment_item_id WHERE i.shipment_id=f.shipment_id GROUP BY a.balance_id) component;
   SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO actual FROM (SELECT balance_id,sum(quantity)::bigint quantity FROM app.stock_movement WHERE kind='consume' AND source_ref='handover:'||e.id::text GROUP BY balance_id) movement;
   IF expected IS NULL OR actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Handover conserves exactly its original parcel components' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
 IF (f.handover_at IS NOT NULL)<>(EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='handover')) THEN RAISE EXCEPTION 'Physical handover requires its exact immutable event' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.seal_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='fulfillment' THEN PERFORM app.assert_fulfillment(NEW.id);ELSE PERFORM app.assert_fulfillment(NEW.fulfillment_id);END IF;RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fulfillment_sealed AFTER INSERT OR UPDATE ON app.fulfillment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_fulfillment();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fulfillment_event_sealed AFTER INSERT ON app.fulfillment_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_fulfillment();
--> statement-breakpoint
CREATE FUNCTION app.guard_fulfillment_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected bigint; event app.fulfillment_event%ROWTYPE; f app.fulfillment%ROWTYPE; position app.inventory_balance%ROWTYPE; expiry date; zone text;
BEGIN
 IF NEW.kind<>'consume' THEN RETURN NEW;END IF;
 SELECT * INTO event FROM app.fulfillment_event WHERE kind='handover' AND 'handover:'||id::text=NEW.source_ref;SELECT * INTO f FROM app.fulfillment WHERE id=event.fulfillment_id;
 SELECT sum(a.quantity) INTO expected FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item i ON i.id=a.fulfillment_item_id WHERE i.shipment_id=f.shipment_id AND a.balance_id=NEW.balance_id;
 SELECT * INTO position FROM app.inventory_balance WHERE id=NEW.balance_id;SELECT expires_on INTO expiry FROM app.inventory_lot WHERE id=position.lot_id;SELECT timezone INTO zone FROM app.warehouse WHERE id=position.warehouse_id;
 IF event.id IS NULL OR f.handover_at IS DISTINCT FROM event.occurred_at OR NEW.quantity IS DISTINCT FROM expected OR NEW.actor_id IS DISTINCT FROM event.actor_id OR expiry<(event.occurred_at AT TIME ZONE zone)::date THEN RAISE EXCEPTION 'Checkout consumption requires exact original handover quantities and usable lots' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fulfillment_stock_consume_guard BEFORE INSERT ON app.stock_movement FOR EACH ROW EXECUTE FUNCTION app.guard_fulfillment_consumption();
--> statement-breakpoint
CREATE FUNCTION app.guard_shipment_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment%ROWTYPE; o app.commerce_order%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original shipment booking is retained' USING ERRCODE='23514';END IF;
 SELECT * INTO f FROM app.fulfillment WHERE id=NEW.fulfillment_id;SELECT order2.* INTO o FROM app.commerce_order order2 JOIN app.order_shipment s ON s.order_id=order2.id WHERE s.id=f.shipment_id;
 IF TG_OP='INSERT' THEN
  IF f.prepared_at IS NULL OR f.calendar_error IS NOT NULL OR f.deadline_id IS NULL OR NOT ((f.status='picking' AND f.booking_id IS NULL) OR (f.status='exception' AND EXISTS(SELECT 1 FROM app.shipment_booking previous JOIN app.waybill_event_result result ON result.outcome='failed' JOIN app.local_waybill_event source ON source.id=result.event_id JOIN app.local_waybill_operation operation ON operation.id=source.operation_id WHERE previous.id=f.booking_id AND previous.status='failed' AND operation.booking_id=previous.id AND operation.id=previous.provider_operation_id))) OR NEW.status<>'queued' OR NEW.provider_operation_id IS NOT NULL OR NEW.created_at>app.reservation_clock(o.clock_namespace) OR NEW.created_at<app.reservation_clock(o.clock_namespace)-interval '5 seconds' OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=NEW.creation_job_id AND kind='shipping.create' AND payload=jsonb_build_object('bookingId',NEW.id::text) AND dedup_key='shipping-create:'||NEW.id::text) THEN RAISE EXCEPTION 'Booking creates one original prepared dispatch intent' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-'status'-'provider_operation_id') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'provider_operation_id') OR OLD.status NOT IN ('queued','acknowledged') OR NEW.status NOT IN ('acknowledged','issued','failed') OR NEW.provider_operation_id IS NULL OR (OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id<>OLD.provider_operation_id) THEN RAISE EXCEPTION 'Original booking changes only from verified source evidence' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER shipment_booking_guard BEFORE INSERT OR UPDATE OR DELETE ON app.shipment_booking FOR EACH ROW EXECUTE FUNCTION app.guard_shipment_booking();
--> statement-breakpoint
CREATE FUNCTION app.seal_shipment_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM app.assert_fulfillment(NEW.fulfillment_id);
 IF NEW.status<>'queued' AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result JOIN app.local_waybill_event event ON event.id=result.event_id JOIN app.local_waybill_operation operation ON operation.id=event.operation_id WHERE operation.id=NEW.provider_operation_id AND operation.booking_id=NEW.id AND result.outcome=NEW.status) THEN RAISE EXCEPTION 'Booking head requires its original accepted source result' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shipment_booking_sealed AFTER INSERT OR UPDATE ON app.shipment_booking DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_shipment_booking();
--> statement-breakpoint
CREATE FUNCTION app.seal_waybill_event_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event app.local_waybill_event%ROWTYPE; operation app.local_waybill_operation%ROWTYPE; b app.shipment_booking%ROWTYPE; f app.fulfillment%ROWTYPE;
BEGIN
 SELECT * INTO event FROM app.local_waybill_event WHERE id=NEW.event_id;SELECT * INTO operation FROM app.local_waybill_operation WHERE id=event.operation_id;SELECT * INTO b FROM app.shipment_booking WHERE id=operation.booking_id;SELECT * INTO f FROM app.fulfillment WHERE id=b.fulfillment_id;
 IF NOT EXISTS(SELECT 1 FROM app.waybill_provider_event provider JOIN app.outbox_job job ON job.id=provider.callback_job_id WHERE provider.id=NEW.event_id AND provider.booking_id=b.id AND job.status='completed' AND job.result->>'event_id'=NEW.event_id::text AND job.result->>'outcome'=NEW.outcome) THEN RAISE EXCEPTION 'Waybill result commits with completion of its exact callback' USING ERRCODE='23514';END IF;
 IF NEW.outcome IN ('issued','failed') THEN
  IF event.status<>NEW.outcome OR b.status<>NEW.outcome OR b.provider_operation_id IS DISTINCT FROM operation.id OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE id=NEW.fulfillment_event_id AND fulfillment_id=f.id AND source_id=event.id AND source_kind='provider' AND kind=CASE WHEN NEW.outcome='issued' THEN 'issued' ELSE 'exception' END AND occurred_at=event.occurred_at) THEN RAISE EXCEPTION 'Terminal waybill result requires original source and fulfillment milestone' USING ERRCODE='23514';END IF;
 ELSIF NEW.outcome='acknowledged' THEN
  IF event.status<>'acknowledged' OR b.status='queued' OR b.provider_operation_id IS DISTINCT FROM operation.id OR NEW.fulfillment_event_id IS NOT NULL THEN RAISE EXCEPTION 'Acknowledgement is not usable tracking' USING ERRCODE='23514';END IF;
 ELSIF NEW.outcome='duplicate' THEN
  IF NEW.fulfillment_event_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM app.waybill_event_result previous JOIN app.local_waybill_event original ON original.id=previous.event_id WHERE original.operation_id=operation.id AND original.status=event.status AND previous.outcome=event.status) THEN RAISE EXCEPTION 'Waybill duplicates preserve the original accepted source' USING ERRCODE='23514';END IF;
 ELSIF NEW.outcome='ignored' THEN
  IF event.status<>'acknowledged' OR NEW.fulfillment_event_id IS NOT NULL OR b.status NOT IN ('issued','failed') THEN RAISE EXCEPTION 'Only late acknowledgements may be ignored' USING ERRCODE='23514';END IF;
 END IF;
 PERFORM app.assert_fulfillment(f.id);RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER waybill_event_result_sealed AFTER INSERT ON app.waybill_event_result DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_waybill_event_result();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_stock_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE movement_kind text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'preparing' THEN
      RAISE EXCEPTION 'A reservation starts unsealed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.key IS DISTINCT FROM OLD.key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.clock_namespace IS DISTINCT FROM OLD.clock_namespace
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Reservation intent is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='preparing' AND NEW.status='active' THEN
    IF NOT EXISTS (SELECT 1 FROM app.stock_reservation_component WHERE reservation_id=NEW.id) THEN
      RAISE EXCEPTION 'A reservation requires physical components' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='checkout' THEN
      IF NOT EXISTS (SELECT 1 FROM app.stock_reservation_item WHERE reservation_id=NEW.id)
        OR EXISTS (SELECT 1 FROM app.stock_reservation_item i JOIN app.offer_revision v ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=NEW.id AND v.retired) THEN
        RAISE EXCEPTION 'Checkout reservations require active immutable offers' USING ERRCODE='23514';
      END IF;
      IF EXISTS (
        WITH required AS (
          SELECT i.warehouse_id,c.stock_item_id,sum(i.offer_quantity::bigint*c.quantity::bigint) AS quantity
          FROM app.stock_reservation_item i JOIN app.offer_component c ON c.product_id=i.product_id AND c.revision=i.product_revision AND c.offer_id=i.offer_id
          WHERE i.reservation_id=NEW.id GROUP BY i.warehouse_id,c.stock_item_id
        ), allocated AS (
          SELECT b.warehouse_id,b.stock_item_id,sum(c.quantity::bigint) AS quantity
          FROM app.stock_reservation_component c JOIN app.inventory_balance b ON b.id=c.balance_id
          WHERE c.reservation_id=NEW.id GROUP BY b.warehouse_id,b.stock_item_id
        ) SELECT 1 FROM required r FULL JOIN allocated a USING (warehouse_id,stock_item_id)
        WHERE coalesce(r.quantity,0)<>coalesce(a.quantity,0)
      ) THEN
        RAISE EXCEPTION 'Checkout holds must match complete offer contents' USING ERRCODE='23514';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM app.warehouse_transfer WHERE reservation_id=NEW.id)
        OR EXISTS (SELECT 1 FROM app.stock_reservation_item WHERE reservation_id=NEW.id)
        OR EXISTS (
          SELECT 1 FROM app.warehouse_transfer t JOIN app.stock_reservation_component c ON c.reservation_id=t.reservation_id
          JOIN app.inventory_balance b ON b.id=c.balance_id WHERE t.reservation_id=NEW.id
          GROUP BY t.quantity,t.from_warehouse_id,t.stock_item_id
          HAVING sum(c.quantity::bigint)<>t.quantity OR bool_or(b.warehouse_id<>t.from_warehouse_id OR b.stock_item_id<>t.stock_item_id)
        ) THEN
        RAISE EXCEPTION 'Transfer holds must match their source stock' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.clock_namespace IS NOT NULL AND EXISTS (SELECT 1 FROM app.stock_reservation_component c JOIN app.inventory_balance b ON b.id=c.balance_id
      WHERE c.reservation_id=NEW.id AND (SELECT namespace FROM app.local_fixture_warehouse WHERE warehouse_id=b.warehouse_id) IS DISTINCT FROM NEW.clock_namespace) THEN
      RAISE EXCEPTION 'Reservation clock must match its warehouse context' USING ERRCODE='23514';
    END IF;
    movement_kind:='reserve';
  ELSIF OLD.status='active' AND NEW.status IN ('released','expired','consumed') THEN
    IF NEW.status='expired' AND (NEW.kind<>'checkout' OR NEW.expires_at>app.reservation_clock(NEW.clock_namespace)) THEN
      RAISE EXCEPTION 'Only due checkout reservations expire' USING ERRCODE='23514';
    END IF;
    movement_kind:=CASE WHEN NEW.status='consumed' THEN CASE WHEN NEW.kind='transfer' THEN 'transfer_out' ELSE 'consume' END ELSE 'release' END;
  ELSE
    RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='checkout' AND NEW.status='consumed' AND EXISTS(SELECT 1 FROM app.commerce_order WHERE stock_reservation_id=NEW.id) THEN
    IF NOT EXISTS(SELECT 1 FROM app.commerce_order WHERE stock_reservation_id=NEW.id AND actionable_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id LEFT JOIN app.fulfillment f ON f.shipment_id=s.id WHERE o.stock_reservation_id=NEW.id AND (f.id IS NULL OR f.handover_at IS NULL))
      OR EXISTS(SELECT 1 FROM app.stock_reservation_component component WHERE component.reservation_id=NEW.id AND component.quantity IS DISTINCT FROM (
       SELECT sum(m.quantity) FROM app.stock_movement m JOIN app.fulfillment_event event ON m.source_ref='handover:'||event.id::text AND event.kind='handover' JOIN app.fulfillment f ON f.id=event.fulfillment_id JOIN app.order_shipment shipment ON shipment.id=f.shipment_id JOIN app.commerce_order o ON o.id=shipment.order_id WHERE o.stock_reservation_id=NEW.id AND m.kind='consume' AND m.balance_id=component.balance_id))
    THEN RAISE EXCEPTION 'Actionable stock consumption requires all exact original parcel handovers' USING ERRCODE='23514';END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IN ('active','consumed') AND EXISTS (
    SELECT 1 FROM app.stock_reservation_component c JOIN app.inventory_balance b ON b.id=c.balance_id
    JOIN app.inventory_lot l ON l.id=b.lot_id JOIN app.warehouse w ON w.id=b.warehouse_id
    WHERE c.reservation_id=NEW.id AND l.expires_on<(app.inventory_clock(w.id,NEW.clock_namespace) AT TIME ZONE w.timezone)::date
  ) THEN
    RAISE EXCEPTION 'Expired batches cannot be reserved or dispatched' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('active','consumed') AND NEW.kind='checkout' AND NEW.expires_at<=app.reservation_clock(NEW.clock_namespace) THEN
    RAISE EXCEPTION 'Expired reservations cannot activate or consume' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM app.stock_reservation_component c WHERE c.reservation_id=NEW.id AND NOT EXISTS (
    SELECT 1 FROM app.stock_movement m WHERE m.balance_id=c.balance_id AND m.kind=movement_kind AND m.source_ref=NEW.id::text AND m.quantity=c.quantity
  )) THEN
    RAISE EXCEPTION 'Reservation transitions require their physical movements' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_promotion_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE business_now timestamptz; expected numeric; n int;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reservation identity is permanent' USING ERRCODE='23514'; END IF;
  business_now:=app.reservation_clock(NEW.clock_namespace);
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'preparing' OR NEW.created_at>business_now OR NEW.created_at<business_now-interval '5 seconds' OR NEW.expires_at<=business_now THEN
      RAISE EXCEPTION 'Invalid new promotion reservation' USING ERRCODE='23514'; END IF; RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','resolved_at','resolution_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolved_at','resolution_reason']) THEN
    RAISE EXCEPTION 'Immutable reservation intent' USING ERRCODE='23514'; END IF;
  IF OLD.status='preparing' AND NEW.status='active' THEN
    IF NEW.expires_at<=business_now THEN RAISE EXCEPTION 'Reservation expired before activation' USING ERRCODE='23514'; END IF;
    SELECT sum(i.quantity::numeric*v.price) INTO expected FROM app.promotion_reservation_item i JOIN app.offer_revision v
      ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=NEW.id AND NOT v.retired;
    IF expected IS NULL OR expected<>NEW.merchandise_amount OR EXISTS(SELECT 1 FROM app.promotion_reservation_item i JOIN app.offer_revision v
      ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=NEW.id AND v.retired) THEN
      RAISE EXCEPTION 'Invalid fixed-offer merchandise snapshot' USING ERRCODE='23514'; END IF;
    SELECT sum(shipping_fee::numeric),count(*) INTO expected,n FROM app.promotion_shipment WHERE reservation_id=NEW.id;
    IF n=0 OR expected<>NEW.shipping_amount OR EXISTS(SELECT 1 FROM app.promotion_shipment s JOIN app.warehouse w ON w.id=s.origin_warehouse_id
      WHERE s.reservation_id=NEW.id AND (NOT w.active OR (NEW.clock_namespace IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.local_fixture_warehouse f
      WHERE f.namespace=NEW.clock_namespace AND f.warehouse_id=w.id)))) THEN RAISE EXCEPTION 'Invalid shipment snapshot' USING ERRCODE='23514'; END IF;
    SELECT sum(a.amount::numeric),count(*) INTO expected,n FROM app.promotion_allocation a WHERE a.reservation_id=NEW.id;
    IF n=0 OR expected<>NEW.subsidy_amount OR EXISTS(SELECT 1 FROM app.promotion_allocation a JOIN app.promotion p ON p.id=a.promotion_id
      JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id AND (v.revision<>p.configuration_revision OR
      (n>1 AND v.stacking='exclusive') OR NOT EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=a.promotion_id AND m.kind='reserve' AND m.amount=a.amount))) THEN
      RAISE EXCEPTION 'Invalid promotion allocation/effects' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM ((SELECT * FROM app.expected_promotion_allocations(NEW.id) EXCEPT SELECT promotion_id,shipment_id,amount FROM app.promotion_shipment_allocation WHERE reservation_id=NEW.id)
      UNION ALL (SELECT promotion_id,shipment_id,amount FROM app.promotion_shipment_allocation WHERE reservation_id=NEW.id EXCEPT SELECT * FROM app.expected_promotion_allocations(NEW.id))) mismatch)
      OR EXISTS(SELECT 1 FROM app.promotion_allocation a WHERE a.reservation_id=NEW.id AND a.amount<>(SELECT coalesce(sum(s.amount::numeric),0) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id)) THEN
      RAISE EXCEPTION 'Incorrect deterministic shipment allocation' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='active' AND NEW.status IN ('released','expired','consumed') THEN
    IF NEW.resolved_at IS DISTINCT FROM business_now AND (NEW.resolved_at>business_now OR NEW.resolved_at<business_now-interval '5 seconds') THEN
      RAISE EXCEPTION 'Invalid resolution time' USING ERRCODE='23514'; END IF;
    IF (NEW.status='expired' AND NEW.expires_at>business_now) OR (NEW.status='consumed' AND NEW.expires_at<=business_now AND NOT EXISTS(SELECT 1 FROM app.commerce_order o JOIN app.order_shipment shipment ON shipment.order_id=o.id JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=shipment.id WHERE o.promotion_reservation_id=NEW.id AND o.actionable_at IS NOT NULL AND fulfillment.handover_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM app.promotion_allocation a WHERE a.reservation_id=NEW.id AND NOT EXISTS(SELECT 1 FROM app.promotion_movement m
      WHERE m.reservation_id=NEW.id AND m.promotion_id=a.promotion_id AND m.kind=CASE WHEN NEW.status='consumed' THEN 'consume' ELSE 'release' END AND m.amount=a.amount)) THEN
      RAISE EXCEPTION 'Invalid terminal reservation/effects' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.seal_commerce_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; q app.checkout_quote%ROWTYPE; selected uuid; parcel jsonb; item app.order_item%ROWTYPE; occurrence app.fulfillment_item%ROWTYPE; expected jsonb; actual jsonb;
BEGIN
 IF TG_TABLE_NAME='commerce_order' THEN selected:=NEW.id;
 ELSIF TG_TABLE_NAME='stock_reservation' THEN SELECT id INTO selected FROM app.commerce_order WHERE stock_reservation_id=NEW.id;
 ELSIF TG_TABLE_NAME='promotion_reservation' THEN SELECT id INTO selected FROM app.commerce_order WHERE promotion_reservation_id=NEW.id;
 ELSE selected:=NEW.order_id; END IF;
 IF selected IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO o FROM app.commerce_order WHERE id=selected;
 SELECT * INTO q FROM app.checkout_quote WHERE id=o.quote_id;
 IF o.status='preparing' OR o.revision<>(SELECT count(*) FROM app.order_event WHERE order_id=o.id)
   OR NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND revision=o.revision AND status=o.status AND payment_status=o.payment_status)
   OR NOT EXISTS(SELECT 1 FROM app.cart WHERE id=o.cart_id AND submitted_order_id=o.id AND state='submitted')
   OR NOT EXISTS(SELECT 1 FROM app.commerce_operation op JOIN app.cart c ON c.id=o.cart_id WHERE op.id=o.operation_id AND op.action='order.create' AND op.resource_id=o.id AND op.actor_scope=coalesce('user:'||c.owner_user_id,'guest:'||c.owner_guest_id::text))
 THEN RAISE EXCEPTION 'Order/event/operation/cart must seal together' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('line_id',line_id,'product_id',product_id,'offer_id',offer_id,'publication_id',publication_id,'product_revision',product_revision,'quantity',quantity) ORDER BY line_id)
   INTO actual FROM app.order_item WHERE order_id=o.id;
 SELECT jsonb_agg(l ORDER BY l->>'line_id') INTO expected FROM jsonb_array_elements(q.document->'selected_plan'->'lines') l;
 IF actual IS DISTINCT FROM expected OR (SELECT sum(quantity*unit_price) FROM app.order_item WHERE order_id=o.id) IS DISTINCT FROM o.merchandise_amount
   OR (SELECT count(*) FROM app.order_shipment WHERE order_id=o.id)<>jsonb_array_length(q.document->'selected_plan'->'packages')
 THEN RAISE EXCEPTION 'Order conserves purchased quote lines/parcels' USING ERRCODE='23514'; END IF;
 FOR parcel IN SELECT value FROM jsonb_array_elements(q.document->'selected_plan'->'packages') LOOP
   IF NOT EXISTS(SELECT 1 FROM app.order_shipment s WHERE s.order_id=o.id AND s.parcel_id=parcel->>'id'
     AND s.warehouse_id=(parcel->>'warehouse_id')::uuid AND s.snapshot=parcel AND s.shipping_amount=(parcel->>'shipping_amount')::bigint
     AND s.merchandise_amount=(parcel->>'merchandise_amount')::bigint
     AND s.subsidy_amount=(SELECT coalesce(sum((a->>'amount')::numeric),0) FROM jsonb_array_elements(q.document->'promotions') p CROSS JOIN LATERAL jsonb_array_elements(p->'shipments') a WHERE a->>'shipment_id'=parcel->>'id')
     AND s.cod_due=CASE WHEN o.payment_method='cod' THEN s.merchandise_amount+s.buyer_shipping ELSE 0 END
     AND s.merchandise_amount=(SELECT count(*)*99000 FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND s.subsidy_amount=(SELECT sum(subsidy_amount) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND s.buyer_shipping=(SELECT sum(buyer_shipping) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parcel->'lines') l WHERE (l->>'quantity')::int<>(SELECT count(*) FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE fi.shipment_id=s.id AND i.line_id=(l->>'line_id')::uuid)))
   THEN RAISE EXCEPTION 'Original shipment conserves quote, unit quantities and money' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR item IN SELECT * FROM app.order_item WHERE order_id=o.id LOOP
   IF item.quantity<>(SELECT count(*) FROM app.fulfillment_item WHERE order_item_id=item.id)
     OR EXISTS(SELECT 1 FROM app.fulfillment_item WHERE order_item_id=item.id AND unit_index>item.quantity)
     OR item.snapshot IS DISTINCT FROM jsonb_build_object('name',(SELECT name FROM app.product_revision WHERE product_id=item.product_id AND revision=item.product_revision),
       'offer',(SELECT jsonb_build_object('label',r.label,'offer_kind',r.kind,'attributes',r.attributes,'contents',(SELECT jsonb_agg(jsonb_build_object('stock_item_id',c.stock_item_id,'name',c.name,'quantity',c.quantity) ORDER BY c.stock_item_id) FROM app.offer_component c WHERE c.product_id=r.product_id AND c.revision=r.revision AND c.offer_id=r.offer_id)) FROM app.offer_revision r WHERE r.product_id=item.product_id AND r.revision=item.product_revision AND r.offer_id=item.offer_id))
   THEN RAISE EXCEPTION 'Original purchased units and contents must match frozen offer' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR occurrence IN SELECT fi.* FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE i.order_id=o.id LOOP
   SELECT jsonb_agg(jsonb_build_array(c.stock_item_id,c.quantity) ORDER BY c.stock_item_id) INTO expected FROM app.offer_component c JOIN app.order_item i ON i.id=occurrence.order_item_id WHERE c.product_id=i.product_id AND c.revision=i.product_revision AND c.offer_id=i.offer_id;
   SELECT jsonb_agg(jsonb_build_array(x.stock_item_id,x.quantity) ORDER BY x.stock_item_id) INTO actual FROM (SELECT stock_item_id,sum(quantity) AS quantity FROM app.fulfillment_component_allocation WHERE fulfillment_item_id=occurrence.id GROUP BY stock_item_id) x;
   IF actual IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM app.fulfillment_component_allocation a JOIN app.inventory_balance b ON b.id=a.balance_id JOIN app.order_shipment s ON s.id=occurrence.shipment_id WHERE a.fulfillment_item_id=occurrence.id AND (b.stock_item_id<>a.stock_item_id OR b.warehouse_id<>s.warehouse_id))
   THEN RAISE EXCEPTION 'Each unit has complete own-warehouse physical components' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO expected FROM app.stock_reservation_component WHERE reservation_id=o.stock_reservation_id;
 SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO actual FROM (SELECT a.balance_id,sum(a.quantity) quantity FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item f ON f.id=a.fulfillment_item_id JOIN app.order_item i ON i.id=f.order_item_id WHERE i.order_id=o.id GROUP BY a.balance_id) x;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM app.stock_reservation r WHERE r.id=o.stock_reservation_id AND r.kind='checkout' AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.expires_at=o.expires_at AND r.status=CASE WHEN o.status='cancelled' THEN 'expired' WHEN NOT EXISTS(SELECT 1 FROM app.order_shipment parcel LEFT JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=parcel.id WHERE parcel.order_id=o.id AND (fulfillment.id IS NULL OR fulfillment.handover_at IS NULL)) THEN 'consumed' ELSE 'active' END)
 THEN RAISE EXCEPTION 'Physical lot partition conserves the exact order hold' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.stock_reservation_item r FULL JOIN (SELECT f.id::text line_id,i.product_id,i.product_revision,i.offer_id,s.warehouse_id,1 offer_quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.order_shipment s ON s.id=f.shipment_id WHERE i.order_id=o.id) wanted ON wanted.line_id=r.line_id AND r.reservation_id=o.stock_reservation_id WHERE (r.reservation_id=o.stock_reservation_id OR r.reservation_id IS NULL) AND (r.product_id,r.product_revision,r.offer_id,r.warehouse_id,r.offer_quantity) IS DISTINCT FROM (wanted.product_id,wanted.product_revision,wanted.offer_id,wanted.warehouse_id,wanted.offer_quantity))
 THEN RAISE EXCEPTION 'Order stock hold preserves every purchased unit identity' USING ERRCODE='23514'; END IF;
 IF o.promotion_reservation_id IS NOT NULL AND (SELECT jsonb_agg(jsonb_build_object('promotion_id',a.promotion_id,'version_id',a.version_id,'amount',a.amount,'shipments',(SELECT jsonb_agg(jsonb_build_object('shipment_id',s.shipment_id,'amount',s.amount) ORDER BY s.shipment_id) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id)) ORDER BY a.promotion_id) FROM app.promotion_allocation a WHERE a.reservation_id=o.promotion_reservation_id) IS DISTINCT FROM (SELECT jsonb_agg(a ORDER BY a->>'promotion_id') FROM jsonb_array_elements(q.document->'promotions') a)
 THEN RAISE EXCEPTION 'Order preserves exact selected promotion versions and allocations' USING ERRCODE='23514'; END IF;
 IF (o.subsidy_amount=0 AND o.promotion_reservation_id IS NOT NULL) OR (o.subsidy_amount>0 AND NOT EXISTS(SELECT 1 FROM app.promotion_reservation r WHERE r.id=o.promotion_reservation_id AND r.subsidy_amount=o.subsidy_amount AND r.merchandise_amount=o.merchandise_amount AND r.shipping_amount=o.shipping_amount AND r.expires_at=o.expires_at AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.status=CASE WHEN o.status='cancelled' THEN 'expired' WHEN EXISTS(SELECT 1 FROM app.order_shipment parcel JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=parcel.id WHERE parcel.order_id=o.id AND fulfillment.handover_at IS NOT NULL) THEN 'consumed' ELSE 'active' END))
 THEN RAISE EXCEPTION 'Order requires its exact subsidy hold' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.order_shipment s CROSS JOIN LATERAL app.commerce_parcel_line_money(s.snapshot,s.subsidy_amount) subsidy CROSS JOIN LATERAL app.commerce_parcel_line_money(s.snapshot,s.buyer_shipping) buyer JOIN app.order_item i ON i.line_id=buyer.line_id AND i.order_id=s.order_id JOIN LATERAL (SELECT f.*,row_number() OVER (ORDER BY unit_index) ordinal FROM app.fulfillment_item f WHERE f.order_item_id=i.id AND f.shipment_id=s.id) unit ON true WHERE s.order_id=o.id AND subsidy.line_id=buyer.line_id AND (unit.subsidy_amount<>subsidy.amount/subsidy.quantity+CASE WHEN unit.ordinal<=subsidy.amount%subsidy.quantity THEN 1 ELSE 0 END OR unit.buyer_shipping<>buyer.amount/buyer.quantity+CASE WHEN unit.ordinal<=buyer.amount%buyer.quantity THEN 1 ELSE 0 END))
 THEN RAISE EXCEPTION 'Original unit money follows exact line and unit remainders' USING ERRCODE='23514'; END IF;
 IF (o.owner_guest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.order_access WHERE order_id=o.id AND guest_id=o.owner_guest_id))
   OR (o.owner_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM app.order_access WHERE order_id=o.id))
 THEN RAISE EXCEPTION 'Order access matches its owner' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; paid bigint; parcels bigint;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
 IF NEW.status='processing' AND NEW.payment_status=o.payment_status AND o.status='pending' THEN
  IF o.actionable_at IS NULL OR NEW.revision<>o.revision+1 OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event event JOIN app.fulfillment f ON f.id=event.fulfillment_id JOIN app.order_shipment shipment ON shipment.id=f.shipment_id WHERE event.id=NEW.source_id AND event.kind='prepare' AND shipment.order_id=o.id AND event.occurred_at=NEW.created_at) THEN RAISE EXCEPTION 'Processing requires actual original parcel preparation' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF o.payment_method='cod' AND NEW.revision>=2 AND NEW.payment_status IN ('cod_due','partially_collected','confirmed') THEN
  IF NEW.status<>o.status OR NEW.status NOT IN ('pending','processing') OR NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
   THEN RAISE EXCEPTION 'COD event advances the current original order' USING ERRCODE='23514';END IF;
  IF NEW.revision=2 THEN
   IF NEW.payment_status<>'cod_due' OR o.status<>'pending' OR o.payment_status<>'pending' OR NOT EXISTS(SELECT 1 FROM app.cod_confirmation c WHERE c.id=NEW.source_id AND c.order_id=o.id AND c.accepted_at=NEW.created_at)
   THEN RAISE EXCEPTION 'COD confirmation event requires its exact original source' USING ERRCODE='23514';END IF;
  ELSE
   SELECT count(*) INTO paid FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.outcome='collected' AND e.order_id=o.id;
   SELECT count(*) INTO parcels FROM app.order_shipment WHERE order_id=o.id;
   IF o.status NOT IN ('pending','processing') OR o.payment_status NOT IN ('cod_due','partially_collected') OR o.actionable_at IS NULL
    OR NEW.payment_status IS DISTINCT FROM (CASE WHEN paid=parcels THEN 'confirmed' ELSE 'partially_collected' END)
    OR NOT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.event_id=NEW.source_id AND r.outcome='collected' AND e.kind='cod' AND e.order_id=o.id AND e.occurred_at=NEW.created_at)
   THEN RAISE EXCEPTION 'COD collection event requires original qualified parcel money' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.revision>2 OR NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
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
CREATE OR REPLACE FUNCTION app.assert_cod_order(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; c app.cod_confirmation%ROWTYPE; paid bigint; parcels bigint; expected text; processing bigint;
BEGIN
 SELECT * INTO c FROM app.cod_confirmation WHERE order_id=selected;IF c.id IS NULL THEN RETURN; END IF;
 SELECT * INTO o FROM app.commerce_order WHERE id=selected;
 SELECT count(*) INTO paid FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.outcome='collected' AND e.order_id=selected;
 SELECT count(*) INTO parcels FROM app.order_shipment WHERE order_id=selected;
 SELECT count(*) INTO processing FROM app.order_event event JOIN app.fulfillment_event cause ON cause.id=event.source_id WHERE event.order_id=selected AND event.status='processing' AND cause.kind='prepare';
 expected:=CASE WHEN paid=0 THEN 'cod_due' WHEN paid=parcels THEN 'confirmed' ELSE 'partially_collected' END;
 IF o.payment_method IS DISTINCT FROM 'cod' OR o.status IS DISTINCT FROM (CASE WHEN processing=0 THEN 'pending' ELSE 'processing' END) OR o.payment_status IS DISTINCT FROM expected OR (processing>1 OR o.revision<>2+paid+processing) OR paid>parcels
  OR o.actionable_at IS DISTINCT FROM c.accepted_at OR c.accepted_at IS DISTINCT FROM o.created_at OR c.operation_id IS DISTINCT FROM o.operation_id
  OR NOT EXISTS(SELECT 1 FROM app.commerce_operation WHERE id=c.operation_id AND action='order.create' AND resource_id=o.id)
  OR NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND revision=2 AND status='pending' AND payment_status='cod_due' AND source_id=c.id AND created_at=c.accepted_at)
 THEN RAISE EXCEPTION 'Confirmed COD, original actionability and qualified parcel receipts seal together' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_fulfillment_order(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; processing int; prepared int;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=selected;IF o.actionable_at IS NULL THEN RETURN;END IF;
 SELECT count(*) INTO processing FROM app.order_event event JOIN app.fulfillment_event cause ON cause.id=event.source_id WHERE event.order_id=o.id AND event.status='processing' AND cause.kind='prepare';
 SELECT count(*) INTO prepared FROM app.fulfillment f JOIN app.order_shipment shipment ON shipment.id=f.shipment_id WHERE shipment.order_id=o.id AND f.prepared_at IS NOT NULL;
 IF (SELECT count(*) FROM app.fulfillment f JOIN app.order_shipment shipment ON shipment.id=f.shipment_id WHERE shipment.order_id=o.id)<>(SELECT count(*) FROM app.order_shipment WHERE order_id=o.id)
  OR processing>1 OR (prepared>0 AND processing<>1) OR (prepared=0 AND processing<>0)
  OR o.status IS DISTINCT FROM (CASE WHEN processing=0 THEN 'pending' ELSE 'processing' END)
  OR (o.payment_method='prepaid' AND (o.payment_status<>'confirmed' OR o.revision<>2+processing))
 THEN RAISE EXCEPTION 'Original actionable parcels and one parent processing cause must seal together' USING ERRCODE='23514';END IF;
 IF o.payment_method='cod' THEN PERFORM app.assert_cod_order(o.id);END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.seal_fulfillment_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid;
BEGIN
 IF TG_TABLE_NAME='commerce_order' THEN selected:=NEW.id;
 ELSE SELECT shipment.order_id INTO selected FROM app.order_shipment shipment WHERE shipment.id=NEW.shipment_id;END IF;
 PERFORM app.assert_fulfillment_order(selected);RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fulfillment_order_sealed AFTER INSERT OR UPDATE ON app.commerce_order DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_fulfillment_order();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fulfillment_parent_sealed AFTER INSERT OR UPDATE ON app.fulfillment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_fulfillment_order();

--> statement-breakpoint
-- Only a later reschedule supersedes a snapshot. The creating reschedule never
-- supersedes its own deadline, and rescheduling after a miss preserves that miss.
CREATE FUNCTION app.fulfillment_deadline_superseded(selected uuid,due timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM app.fulfillment_deadline deadline JOIN app.fulfillment_event created ON created.id=deadline.source_id JOIN app.fulfillment_event reschedule ON reschedule.fulfillment_id=deadline.fulfillment_id AND reschedule.kind='reschedule' AND reschedule.revision>created.revision WHERE deadline.id=selected AND reschedule.occurred_at<=due)
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_fulfillment_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment%ROWTYPE; event app.fulfillment_event%ROWTYPE; deadline app.fulfillment_deadline%ROWTYPE; o app.commerce_order%ROWTYPE; expected text; due timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Buyer notice history is retained' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'available_at') IS DISTINCT FROM (to_jsonb(OLD)-'available_at') OR NEW.available_at IS NULL OR (OLD.available_at IS NOT NULL AND NEW.available_at IS DISTINCT FROM OLD.available_at) OR NEW.available_at>clock_timestamp() THEN RAISE EXCEPTION 'Notice availability never rewrites its original history' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO f FROM app.fulfillment WHERE id=NEW.fulfillment_id;SELECT * INTO event FROM app.fulfillment_event WHERE id=NEW.source_id AND fulfillment_id=f.id;SELECT * INTO deadline FROM app.fulfillment_deadline WHERE id=NEW.source_id AND fulfillment_id=f.id;SELECT order2.* INTO o FROM app.commerce_order order2 JOIN app.order_shipment shipment ON shipment.order_id=order2.id WHERE shipment.id=f.shipment_id;
 IF NEW.available_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=NEW.job_id AND kind='fulfillment.notice' AND payload=jsonb_build_object('noticeId',NEW.id::text) AND dedup_key='fulfillment-notice:'||NEW.id::text) THEN RAISE EXCEPTION 'Buyer notice requires its original durable delivery intent' USING ERRCODE='23514';END IF;
 expected:=CASE NEW.kind WHEN 'calendar_missing' THEN 'Jadwal pemrosesan sedang diperiksa. Pesanan tetap tersimpan.' WHEN 'packing_overdue' THEN 'Penerbitan resi melewati jadwal. Tim kami sedang menindaklanjuti.' WHEN 'handover_overdue' THEN 'Serah terima paket ke kurir melewati jadwal. Tim kami sedang menindaklanjuti.' WHEN 'booking_failed' THEN 'Penerbitan resi belum berhasil. Tim kami sedang menindaklanjuti.' WHEN 'rescheduled' THEN 'Jadwal pemrosesan diperbarui. Tenggat sebelumnya tetap tercatat. '||event.public_explanation END;
 IF NEW.message IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Buyer notice uses the bounded original explanation' USING ERRCODE='23514';END IF;
 IF NEW.kind='calendar_missing' THEN
  IF event.id IS NULL OR NOT ((event.kind='initialize' AND event.status='exception') OR (event.kind='issued' AND EXISTS(SELECT 1 FROM app.fulfillment_deadline WHERE id=event.deadline_id AND handover_due_at IS NULL))) OR NEW.occurred_at IS DISTINCT FROM event.occurred_at THEN RAISE EXCEPTION 'Calendar notice requires an actual uncovered milestone' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='booking_failed' THEN
  IF event.kind IS DISTINCT FROM 'exception' OR event.source_kind IS DISTINCT FROM 'provider' OR NEW.occurred_at IS DISTINCT FROM event.occurred_at OR NOT EXISTS(SELECT 1 FROM app.local_waybill_event WHERE id=event.source_id AND status='failed') THEN RAISE EXCEPTION 'Failure notice requires original rejected issuance' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='rescheduled' THEN
  IF event.kind IS DISTINCT FROM 'reschedule' OR NEW.occurred_at IS DISTINCT FROM event.occurred_at THEN RAISE EXCEPTION 'Reschedule notice requires the audited original command' USING ERRCODE='23514';END IF;
 ELSE
  due:=CASE WHEN NEW.kind='packing_overdue' THEN deadline.packing_due_at ELSE deadline.handover_due_at END;
  IF deadline.id IS NULL OR due IS NULL OR NEW.occurred_at IS DISTINCT FROM due OR due>app.reservation_clock(o.clock_namespace)
   OR (NEW.kind='packing_overdue' AND f.waybill_issued_at<=due) OR (NEW.kind='handover_overdue' AND f.handover_at<=due)
   OR app.fulfillment_deadline_superseded(deadline.id,due)
   OR (NEW.kind='packing_overdue' AND EXISTS(SELECT 1 FROM app.local_waybill_event issued JOIN app.local_waybill_operation operation ON operation.id=issued.operation_id WHERE operation.booking_id=f.booking_id AND issued.status='issued' AND issued.occurred_at<=due))
  THEN RAISE EXCEPTION 'Overdue observation must preserve an actually missed deadline' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fulfillment_notice_guard BEFORE INSERT OR UPDATE OR DELETE ON app.fulfillment_notice FOR EACH ROW EXECUTE FUNCTION app.guard_fulfillment_notice();
--> statement-breakpoint
CREATE FUNCTION app.seal_fulfillment_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.available_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=NEW.job_id AND status='completed' AND result->>'notice_id'=NEW.id::text AND result->>'status'='available') THEN RAISE EXCEPTION 'Notice availability commits with its exact delivery job' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fulfillment_notice_sealed AFTER INSERT OR UPDATE ON app.fulfillment_notice DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_fulfillment_notice();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_local_cod_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s app.order_shipment%ROWTYPE; o app.commerce_order%ROWTYPE; accepted timestamptz;
BEGIN
 SELECT * INTO s FROM app.order_shipment WHERE id=NEW.shipment_id;SELECT * INTO o FROM app.commerce_order WHERE id=s.order_id FOR UPDATE;
 SELECT accepted_at INTO accepted FROM app.cod_confirmation WHERE order_id=o.id;
 IF accepted IS NULL OR o.payment_method<>'cod' OR o.status NOT IN ('pending','processing') OR o.actionable_at IS DISTINCT FROM accepted
  OR current_database()<>'99ribu_'||NEW.environment OR NEW.requested_amount IS DISTINCT FROM s.cod_due
  OR NEW.occurred_at<accepted OR NEW.occurred_at>app.reservation_clock(o.clock_namespace) OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',NEW.occurred_at)
 THEN RAISE EXCEPTION 'Local COD effect requires its original confirmed parcel and profile' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
