CREATE TABLE "app"."cod_remittance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"environment" text NOT NULL,
	"settlement_operation_id" uuid NOT NULL,
	"gross_amount" bigint NOT NULL,
	"shipping_deduction" bigint NOT NULL,
	"cod_fee_deduction" bigint NOT NULL,
	"other_deduction" bigint NOT NULL,
	"net_amount" bigint NOT NULL,
	"statement_at" timestamp with time zone NOT NULL,
	"evidence" text NOT NULL,
	"match_job_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cod_remittance_settlement_operation_id_unique" UNIQUE("settlement_operation_id"),
	CONSTRAINT "cod_remittance_match_job_id_unique" UNIQUE("match_job_id"),
	CONSTRAINT "cod_remittance_reference_unique" UNIQUE("environment","reference"),
	CONSTRAINT "cod_remittance_value_check" CHECK ("app"."cod_remittance"."environment" IN ('local','test') AND "app"."cod_remittance"."reference" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$' AND "app"."cod_remittance"."gross_amount" between 1 and 9007199254740991 AND "app"."cod_remittance"."shipping_deduction">=0 AND "app"."cod_remittance"."cod_fee_deduction">=0 AND "app"."cod_remittance"."other_deduction">=0 AND "app"."cod_remittance"."net_amount" between 0 and 9007199254740991 AND char_length("app"."cod_remittance"."evidence") between 1 and 500 AND char_length("app"."cod_remittance"."reason") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "app"."cod_remittance_line" (
	"remittance_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"amount" bigint NOT NULL,
	"expected_amount" bigint NOT NULL,
	"cod_operation_id" uuid NOT NULL,
	CONSTRAINT "cod_remittance_line_remittance_id_shipment_id_pk" PRIMARY KEY("remittance_id","shipment_id"),
	CONSTRAINT "cod_remittance_line_cod_operation_id_unique" UNIQUE("cod_operation_id"),
	CONSTRAINT "cod_remittance_line_ordinal_unique" UNIQUE("remittance_id","ordinal"),
	CONSTRAINT "cod_remittance_line_value_check" CHECK ("app"."cod_remittance_line"."ordinal" between 1 and 100 AND "app"."cod_remittance_line"."amount" between 1 and 9007199254740991 AND "app"."cod_remittance_line"."expected_amount" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."fulfillment_purchase_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"reference" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "fulfillment_purchase_reference_version_unique" UNIQUE("fulfillment_id","version"),
	CONSTRAINT "fulfillment_purchase_reference_value_check" CHECK ("app"."fulfillment_purchase_reference"."version">0 AND "app"."fulfillment_purchase_reference"."reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{1,79}$' AND char_length("app"."fulfillment_purchase_reference"."reason") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "app"."local_tracking_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"courier" text NOT NULL,
	"tracking_number" text NOT NULL,
	"provider_status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_tracking_observation_value_check" CHECK ("app"."local_tracking_observation"."environment" IN ('local','test') AND "app"."local_tracking_observation"."tracking_number" ~ '^[A-Z0-9][A-Z0-9-]{7,39}$' AND "app"."local_tracking_observation"."provider_status" ~ '^[A-Z_]{2,40}$')
);
--> statement-breakpoint
CREATE TABLE "app"."manual_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"courier" text NOT NULL,
	"tracking_number" text NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"fulfillment_event_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "manual_tracking_fulfillment_event_id_unique" UNIQUE("fulfillment_event_id"),
	CONSTRAINT "manual_tracking_version_unique" UNIQUE("fulfillment_id","version"),
	CONSTRAINT "manual_tracking_value_check" CHECK ("app"."manual_tracking"."version">0 AND "app"."manual_tracking"."courier" IN ('jne','jnt','sicepat','sap','ninja','anteraja','idexpress','lion','pos') AND "app"."manual_tracking"."tracking_number" ~ '^[A-Z0-9][A-Z0-9-]{7,39}$' AND jsonb_typeof("app"."manual_tracking"."unit_ids")='array' AND jsonb_array_length("app"."manual_tracking"."unit_ids") between 1 and 100 AND char_length("app"."manual_tracking"."reason") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "app"."shipment_tracking_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"tracking_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source_kind" text NOT NULL,
	"adapter" text,
	"provider_status" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" text,
	"reason" text,
	"evidence" text,
	"receipt_source_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "shipment_tracking_event_status_unique" UNIQUE("fulfillment_id","status"),
	CONSTRAINT "shipment_tracking_event_value_check" CHECK ("app"."shipment_tracking_event"."status" IN ('picked_up','in_transit','delivered','failed') AND (("app"."shipment_tracking_event"."source_kind"='adapter' AND "app"."shipment_tracking_event"."adapter" IN ('simulated','mengantar') AND "app"."shipment_tracking_event"."actor_id" IS NULL) OR ("app"."shipment_tracking_event"."source_kind"='operator' AND "app"."shipment_tracking_event"."adapter" IS NULL AND "app"."shipment_tracking_event"."actor_id" IS NOT NULL AND char_length("app"."shipment_tracking_event"."reason") between 1 and 200 AND char_length("app"."shipment_tracking_event"."evidence") between 1 and 500)) AND ("app"."shipment_tracking_event"."provider_status" IS NULL OR "app"."shipment_tracking_event"."provider_status" ~ '^[A-Z_]{2,40}$') AND (("app"."shipment_tracking_event"."status"='delivered')=("app"."shipment_tracking_event"."receipt_source_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."warehouse_pickup_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"street_address" text,
	"pic_name" text,
	"pic_phone" text,
	"latitude_e6" integer,
	"longitude_e6" integer,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "warehouse_pickup_profile_revision_unique" UNIQUE("warehouse_id","revision"),
	CONSTRAINT "warehouse_pickup_profile_value_check" CHECK ("app"."warehouse_pickup_profile"."revision">0 AND ("app"."warehouse_pickup_profile"."street_address" IS NULL OR char_length("app"."warehouse_pickup_profile"."street_address") between 10 and 300) AND ("app"."warehouse_pickup_profile"."pic_name" IS NULL OR char_length("app"."warehouse_pickup_profile"."pic_name") between 2 and 120) AND ("app"."warehouse_pickup_profile"."pic_phone" IS NULL OR "app"."warehouse_pickup_profile"."pic_phone" ~ '^62[1-9][0-9]{7,12}$') AND (("app"."warehouse_pickup_profile"."latitude_e6" IS NULL)=("app"."warehouse_pickup_profile"."longitude_e6" IS NULL)) AND ("app"."warehouse_pickup_profile"."latitude_e6" IS NULL OR ("app"."warehouse_pickup_profile"."latitude_e6" between -11000000 and 6000000 AND "app"."warehouse_pickup_profile"."longitude_e6" between 95000000 and 141000000)) AND char_length("app"."warehouse_pickup_profile"."reason") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "app"."fulfillment" DROP CONSTRAINT "fulfillment_state_check";--> statement-breakpoint
ALTER TABLE "app"."fulfillment_event" DROP CONSTRAINT "fulfillment_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."local_parcel_receipt" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."cod_remittance" ADD CONSTRAINT "cod_remittance_settlement_operation_id_local_settlement_operation_id_fk" FOREIGN KEY ("settlement_operation_id") REFERENCES "app"."local_settlement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_remittance" ADD CONSTRAINT "cod_remittance_match_job_id_outbox_job_id_fk" FOREIGN KEY ("match_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_remittance_line" ADD CONSTRAINT "cod_remittance_line_remittance_id_cod_remittance_id_fk" FOREIGN KEY ("remittance_id") REFERENCES "app"."cod_remittance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_remittance_line" ADD CONSTRAINT "cod_remittance_line_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_remittance_line" ADD CONSTRAINT "cod_remittance_line_cod_operation_id_local_cod_operation_id_fk" FOREIGN KEY ("cod_operation_id") REFERENCES "app"."local_cod_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_purchase_reference" ADD CONSTRAINT "fulfillment_purchase_reference_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."manual_tracking" ADD CONSTRAINT "manual_tracking_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."manual_tracking" ADD CONSTRAINT "manual_tracking_fulfillment_event_id_fulfillment_event_id_fk" FOREIGN KEY ("fulfillment_event_id") REFERENCES "app"."fulfillment_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_tracking_event" ADD CONSTRAINT "shipment_tracking_event_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_tracking_event" ADD CONSTRAINT "shipment_tracking_event_tracking_id_manual_tracking_id_fk" FOREIGN KEY ("tracking_id") REFERENCES "app"."manual_tracking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_tracking_event" ADD CONSTRAINT "shipment_tracking_event_receipt_source_id_local_parcel_receipt_id_fk" FOREIGN KEY ("receipt_source_id") REFERENCES "app"."local_parcel_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."warehouse_pickup_profile" ADD CONSTRAINT "warehouse_pickup_profile_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_tracking_observation_number_idx" ON "app"."local_tracking_observation" USING btree ("environment","tracking_number","occurred_at");--> statement-breakpoint
CREATE INDEX "manual_tracking_number_idx" ON "app"."manual_tracking" USING btree ("tracking_number");--> statement-breakpoint
ALTER TABLE "app"."fulfillment" ADD CONSTRAINT "fulfillment_state_check" CHECK ("app"."fulfillment"."revision">=0 AND "app"."fulfillment"."status" IN ('preparing','ready','picking','packed','handover_pending','handed_over','exception') AND ("app"."fulfillment"."tracking_number" IS NULL OR "app"."fulfillment"."tracking_number" ~ '^[A-Z0-9][A-Z0-9-]{7,39}$') AND ("app"."fulfillment"."handover_reference" IS NULL OR char_length("app"."fulfillment"."handover_reference") between 1 and 200));--> statement-breakpoint
ALTER TABLE "app"."fulfillment_event" ADD CONSTRAINT "fulfillment_event_value_check" CHECK ("app"."fulfillment_event"."revision">0 AND "app"."fulfillment_event"."status" IN ('ready','picking','packed','handover_pending','handed_over','exception') AND "app"."fulfillment_event"."kind" IN ('initialize','prepare','booking','issued','reissued','booking_cancelled','packed','handover','exception','reschedule','manual_issued','tracking_corrected') AND "app"."fulfillment_event"."source_kind" IN ('activation','operation','provider','cancellation') AND char_length("app"."fulfillment_event"."reason") between 1 and 500 AND (("app"."fulfillment_event"."kind"='reschedule' AND "app"."fulfillment_event"."public_explanation" IS NOT NULL AND char_length("app"."fulfillment_event"."public_explanation") between 1 and 200) OR ("app"."fulfillment_event"."kind"<>'reschedule' AND "app"."fulfillment_event"."public_explanation" IS NULL)));--> statement-breakpoint
-- S91 (DEC-007): frozen dispatched unit set for either original path. A carrier
-- booking keeps its frozen request basis; a manual resi keeps the unit set
-- frozen on its first immutable manual_tracking version.
CREATE FUNCTION app.fulfillment_dispatch_unit_ids(p_fulfillment_id uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$
 SELECT w.id FROM app.fulfillment f CROSS JOIN LATERAL app.waybill_request_unit_ids(f.booking_id) w WHERE f.id=p_fulfillment_id AND f.booking_id IS NOT NULL
 UNION ALL
 SELECT u.value::uuid FROM app.fulfillment f JOIN app.manual_tracking mt ON mt.fulfillment_id=f.id AND mt.version=1
  CROSS JOIN LATERAL jsonb_array_elements_text(mt.unit_ids) u(value) WHERE f.id=p_fulfillment_id AND f.booking_id IS NULL
 ORDER BY 1;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_fulfillment_event() RETURNS trigger LANGUAGE plpgsql AS $$
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
  -- S91: a manual (dashboard-booked) parcel may be prepared while its warehouse
  -- calendar is still missing; it never gains a carrier booking from that state.
  IF f.prepared_at IS NOT NULL OR NEW.status<>'picking' OR NEW.source_kind<>'operation'
   OR NOT ((f.status='ready' AND f.deadline_id IS NOT NULL) OR (f.status='exception' AND f.calendar_error IS NOT NULL AND f.deadline_id IS NULL AND f.booking_id IS NULL))
  THEN RAISE EXCEPTION 'Preparation requires an operational original parcel' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='booking' THEN
  IF f.prepared_at IS NULL OR f.calendar_error IS NOT NULL OR f.deadline_id IS NULL OR NEW.status<>'picking' OR NEW.source_kind<>'operation' OR NOT ((f.status='picking' AND f.booking_id IS NULL) OR (f.status='exception' AND EXISTS(SELECT 1 FROM app.shipment_booking WHERE id=f.booking_id AND status IN ('failed','cancelled')) AND NEW.reason<>'Scoped original parcel operation')) THEN RAISE EXCEPTION 'Booking requires physical preparation' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind IN ('issued','reissued') THEN
  IF (NEW.kind='issued' AND f.waybill_issued_at IS NOT NULL) OR (NEW.kind='reissued' AND (f.waybill_issued_at IS NULL OR NEW.deadline_id IS DISTINCT FROM f.deadline_id)) OR f.status<>'picking' OR f.prepared_at IS NULL OR f.booking_id IS NULL OR NEW.status<>'packed' OR NEW.source_kind<>'provider' THEN RAISE EXCEPTION 'Packing milestone requires issued source evidence' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='booking_cancelled' THEN
  IF f.handover_at IS NOT NULL OR NEW.status<>'exception' OR NEW.source_kind<>'cancellation'
    OR NEW.deadline_id IS DISTINCT FROM f.deadline_id
    OR NOT EXISTS(SELECT 1 FROM app.local_waybill_cancellation_event source JOIN app.local_waybill_cancellation operation ON operation.id=source.operation_id
      JOIN app.shipment_cancellation cancellation ON cancellation.id=operation.cancellation_id JOIN app.shipment_booking booking ON booking.id=cancellation.booking_id
      WHERE source.id=NEW.source_id AND source.status='cancelled' AND source.occurred_at=NEW.occurred_at
       AND cancellation.status='cancelled' AND booking.status='cancelled' AND booking.id=f.booking_id AND booking.fulfillment_id=f.id)
  THEN RAISE EXCEPTION 'Carrier cancellation requires its exact original source and retains commercial and SLA history' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='packed' THEN
  IF f.status<>'packed' OR f.waybill_issued_at IS NULL OR NEW.status<>'handover_pending' OR NEW.source_kind<>'operation' OR NOT EXISTS(SELECT 1 FROM app.shipment_booking WHERE id=f.booking_id AND status='issued') THEN RAISE EXCEPTION 'Packing confirmation requires usable tracking' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='handover' THEN
  IF f.status NOT IN ('packed','handover_pending') OR f.prepared_at IS NULL OR f.waybill_issued_at IS NULL OR NEW.status<>'handed_over' OR NEW.source_kind<>'operation'
   OR NOT (EXISTS(SELECT 1 FROM app.shipment_booking WHERE id=f.booking_id AND status='issued')
    OR (f.booking_id IS NULL AND EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='manual_issued')
     AND EXISTS(SELECT 1 FROM app.manual_tracking mt WHERE mt.fulfillment_id=f.id AND mt.tracking_number=f.tracking_number
      AND mt.version=(SELECT max(version) FROM app.manual_tracking WHERE fulfillment_id=f.id))))
  THEN RAISE EXCEPTION 'Handover requires preparation and issued tracking' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='manual_issued' THEN
  -- S91: operator-entered resi from 99ribu's own Mengantar dashboard booking.
  IF f.status<>'picking' OR f.prepared_at IS NULL OR f.booking_id IS NOT NULL OR f.waybill_issued_at IS NOT NULL OR f.handover_at IS NOT NULL
   OR EXISTS(SELECT 1 FROM app.shipment_booking WHERE fulfillment_id=f.id)
   OR NEW.status<>'packed' OR NEW.source_kind<>'operation' OR NEW.deadline_id IS DISTINCT FROM f.deadline_id
  THEN RAISE EXCEPTION 'Manual resi requires a prepared parcel without any carrier booking' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='tracking_corrected' THEN
  IF f.booking_id IS NOT NULL OR f.waybill_issued_at IS NULL OR NEW.status IS DISTINCT FROM f.status OR NEW.source_kind<>'operation'
   OR NEW.deadline_id IS DISTINCT FROM f.deadline_id OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='manual_issued')
   OR EXISTS(SELECT 1 FROM app.shipment_tracking_event WHERE fulfillment_id=f.id AND status='delivered')
  THEN RAISE EXCEPTION 'Resi correction applies only to an undelivered manually issued parcel and keeps its milestone' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='exception' THEN
  IF f.status<>'picking' OR f.booking_id IS NULL OR NEW.status<>'exception' OR NEW.source_kind<>'provider' THEN RAISE EXCEPTION 'Booking exception requires original provider source' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='reschedule' THEN
  IF f.handover_at IS NOT NULL OR NEW.source_kind<>'operation' OR NEW.deadline_id IS NULL OR NEW.status IS DISTINCT FROM (CASE WHEN f.status='exception' AND f.booking_id IS NOT NULL THEN 'exception' WHEN f.waybill_issued_at IS NOT NULL THEN f.status WHEN f.prepared_at IS NOT NULL THEN 'picking' ELSE 'ready' END) THEN RAISE EXCEPTION 'Reschedule retains original milestone state' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Unsupported fulfillment transition' USING ERRCODE='23514';END IF;
 IF NEW.kind IN ('packed','handover') AND NOT (NEW.kind='handover' AND f.booking_id IS NULL) AND NOT EXISTS(SELECT 1 FROM app.shipment_booking booking
   JOIN app.local_waybill_operation source ON source.booking_id=booking.id WHERE booking.id=f.booking_id AND booking.status='issued'
    AND source.status='issued' AND source.tracking_number=f.tracking_number AND source.terminal_at<=NEW.occurred_at)
 THEN RAISE EXCEPTION 'Packing and handover use the current label only after its actual issuance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$
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
  OR (NEW.waybill_issued_at IS DISTINCT FROM OLD.waybill_issued_at AND NOT (e.kind IN ('issued','manual_issued') AND OLD.waybill_issued_at IS NULL AND NEW.waybill_issued_at=e.occurred_at))
  OR (NEW.tracking_number IS DISTINCT FROM OLD.tracking_number AND e.kind NOT IN ('issued','reissued','manual_issued','tracking_corrected'))
  OR (NEW.handover_at IS DISTINCT FROM OLD.handover_at AND NOT (e.kind='handover' AND OLD.handover_at IS NULL AND NEW.handover_at=e.occurred_at))
  OR (NEW.handover_reference IS DISTINCT FROM OLD.handover_reference AND e.kind<>'handover')
  OR (NEW.booking_id IS DISTINCT FROM OLD.booking_id AND e.kind<>'booking')
  OR (NEW.deadline_id IS DISTINCT FROM OLD.deadline_id AND e.kind NOT IN ('initialize','issued','reschedule'))
  OR (NEW.calendar_error IS DISTINCT FROM OLD.calendar_error AND e.kind NOT IN ('initialize','issued','reschedule'))
 THEN RAISE EXCEPTION 'Fulfillment head advances with one exact immutable event' USING ERRCODE='23514';END IF;
 IF (e.kind='prepare' AND NEW.prepared_at IS DISTINCT FROM e.occurred_at) OR (e.kind='issued' AND (NEW.waybill_issued_at IS DISTINCT FROM e.occurred_at OR NEW.tracking_number IS NULL)) OR (e.kind='booking' AND NEW.booking_id IS NULL)
  OR (e.kind='manual_issued' AND (NEW.waybill_issued_at IS DISTINCT FROM e.occurred_at OR NEW.tracking_number IS NULL OR NEW.booking_id IS NOT NULL))
  OR (e.kind='tracking_corrected' AND NEW.tracking_number IS NULL) THEN RAISE EXCEPTION 'Milestone fields must match their exact causal event' USING ERRCODE='23514';END IF;
 IF e.kind IN ('issued','reissued') AND NOT EXISTS(SELECT 1 FROM app.local_waybill_event source
   JOIN app.local_waybill_operation operation ON operation.id=source.operation_id
   WHERE source.id=e.source_id AND source.status='issued' AND source.tracking_number=NEW.tracking_number
    AND source.occurred_at=e.occurred_at AND operation.booking_id=NEW.booking_id)
 THEN RAISE EXCEPTION 'Current tracking is the exact newly accepted source while first issuance remains immutable' USING ERRCODE='23514'; END IF;
 IF e.kind='initialize' AND ((NEW.status='ready' AND (NEW.deadline_id IS NULL OR NEW.calendar_error IS NOT NULL)) OR (NEW.status='exception' AND (NEW.deadline_id IS NOT NULL OR NEW.calendar_error IS NULL))) THEN RAISE EXCEPTION 'Initial calendar state must be truthful' USING ERRCODE='23514';END IF;
 IF e.kind='handover' AND (NEW.handover_reference IS NULL OR NEW.handover_at<NEW.prepared_at OR NEW.handover_at<NEW.waybill_issued_at) THEN RAISE EXCEPTION 'Handover is a separate physical milestone' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_fulfillment(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment%ROWTYPE; e app.fulfillment_event%ROWTYPE; b app.shipment_booking%ROWTYPE; expected jsonb; actual jsonb; latest app.fulfillment_event;
BEGIN
 SELECT * INTO f FROM app.fulfillment WHERE id=selected;IF f.id IS NULL THEN RAISE EXCEPTION 'Fulfillment is required' USING ERRCODE='23514';END IF;
 IF f.revision=0 OR f.revision<>(SELECT count(*) FROM app.fulfillment_event WHERE fulfillment_id=f.id)
  OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND revision=f.revision AND status=f.status AND deadline_id IS NOT DISTINCT FROM f.deadline_id)
  OR (f.deadline_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.fulfillment_deadline WHERE id=f.deadline_id AND fulfillment_id=f.id))
  OR (f.prepared_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='prepare' AND occurred_at=f.prepared_at))
 THEN RAISE EXCEPTION 'Fulfillment head and immutable lineage seal together' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM app.shipment_booking WHERE id=f.booking_id AND fulfillment_id=f.id;
 IF f.booking_id IS DISTINCT FROM b.id
  OR EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.fulfillment_id=f.id AND (NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='booking' AND source_id=historical.operation_id AND occurred_at=historical.created_at) OR (historical.id IS DISTINCT FROM b.id AND historical.status NOT IN ('failed','cancelled'))))
 THEN RAISE EXCEPTION 'Fulfillment retains every booking and only replaces verified terminal failures or cancellations' USING ERRCODE='23514';END IF;
 IF (f.waybill_issued_at IS NOT NULL)<>(EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind IN ('issued','manual_issued')))
    OR (SELECT count(*) FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind IN ('issued','manual_issued'))>1
    OR (f.waybill_issued_at IS NULL AND f.tracking_number IS NOT NULL)
 THEN RAISE EXCEPTION 'The first original issuance is a single immutable SLA anchor' USING ERRCODE='23514'; END IF;
-- S91 manual branch: the issuance anchor and current resi are exact immutable
 -- manual_tracking versions bound to their causal events; no booking may exist.
 IF EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind IN ('manual_issued','tracking_corrected')) OR EXISTS(SELECT 1 FROM app.manual_tracking WHERE fulfillment_id=f.id) THEN
  IF f.booking_id IS NOT NULL OR EXISTS(SELECT 1 FROM app.shipment_booking WHERE fulfillment_id=f.id)
   OR (SELECT count(*) FROM app.manual_tracking WHERE fulfillment_id=f.id)<>(SELECT count(*) FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind IN ('manual_issued','tracking_corrected'))
   OR EXISTS(SELECT 1 FROM app.manual_tracking mt LEFT JOIN app.fulfillment_event e2 ON e2.id=mt.fulfillment_event_id
     WHERE mt.fulfillment_id=f.id AND (e2.id IS NULL OR e2.fulfillment_id<>f.id OR e2.kind<>(CASE WHEN mt.version=1 THEN 'manual_issued' ELSE 'tracking_corrected' END) OR e2.actor_id IS DISTINCT FROM mt.actor_id))
   OR NOT EXISTS(SELECT 1 FROM app.manual_tracking mt JOIN app.fulfillment_event e2 ON e2.id=mt.fulfillment_event_id WHERE mt.fulfillment_id=f.id AND mt.version=1 AND e2.occurred_at=f.waybill_issued_at)
   OR NOT EXISTS(SELECT 1 FROM app.manual_tracking mt WHERE mt.fulfillment_id=f.id AND mt.tracking_number=f.tracking_number AND mt.version=(SELECT max(version) FROM app.manual_tracking WHERE fulfillment_id=f.id)
     AND mt.fulfillment_event_id=(SELECT id FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind IN ('manual_issued','tracking_corrected') ORDER BY revision DESC LIMIT 1))
  THEN RAISE EXCEPTION 'Manual resi retains its exact versioned operator source without any carrier booking' USING ERRCODE='23514'; END IF;
 ELSIF f.waybill_issued_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result
   JOIN app.local_waybill_event source ON source.id=result.event_id JOIN app.local_waybill_operation operation ON operation.id=source.operation_id
   JOIN app.shipment_booking original ON original.id=operation.booking_id JOIN app.fulfillment_event event ON event.id=result.fulfillment_event_id
   WHERE result.outcome='issued' AND original.fulfillment_id=f.id AND source.status='issued'
    AND source.occurred_at=f.waybill_issued_at AND event.fulfillment_id=f.id AND event.kind='issued'
    AND event.source_kind='provider' AND event.source_id=source.id AND event.occurred_at=source.occurred_at)
 THEN RAISE EXCEPTION 'The first SLA anchor retains its actual original source even after cancellation or reissue' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind IN ('issued','reissued') ORDER BY revision DESC LIMIT 1;
 IF f.waybill_issued_at IS NOT NULL AND latest.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result
   JOIN app.local_waybill_event source ON source.id=result.event_id JOIN app.local_waybill_operation operation ON operation.id=source.operation_id
   JOIN app.shipment_booking original ON original.id=operation.booking_id
   WHERE result.fulfillment_event_id=latest.id AND result.outcome='issued' AND source.status='issued'
    AND original.fulfillment_id=f.id AND source.tracking_number=f.tracking_number AND latest.source_id=source.id
    AND latest.source_kind='provider' AND latest.occurred_at=source.occurred_at
    AND (b.status<>'issued' OR original.id=b.id))
 THEN RAISE EXCEPTION 'Current tracking retains the latest accepted issuance; only the current issued booking is usable' USING ERRCODE='23514'; END IF;
 FOR e IN SELECT * FROM app.fulfillment_event WHERE fulfillment_id=f.id LOOP
  IF e.source_kind='operation' AND (NOT EXISTS(SELECT 1 FROM app.access_operation operation WHERE operation.id=e.source_id AND operation.actor_id=e.actor_id AND operation.action='fulfillment.mutate' AND (operation.response->>'id'=f.id::text OR (e.kind='booking' AND EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.fulfillment_id=f.id AND historical.operation_id=e.source_id AND operation.response->>'operation_id'=historical.id::text))))
   OR NOT EXISTS(SELECT 1 FROM app.audit_event audit WHERE audit.actor_id=e.actor_id AND audit.subject_id=f.id::text AND audit.outcome='allowed' AND audit.details->>'operation_id'=e.source_id::text AND audit.action=CASE e.kind WHEN 'prepare' THEN 'fulfillment.prepare' WHEN 'booking' THEN 'fulfillment.book' WHEN 'packed' THEN 'fulfillment.packing' WHEN 'handover' THEN 'fulfillment.handover' WHEN 'reschedule' THEN 'fulfillment.reschedule' WHEN 'manual_issued' THEN 'fulfillment.manual_issue' WHEN 'tracking_corrected' THEN 'fulfillment.tracking_correct' ELSE '' END)) THEN RAISE EXCEPTION 'Staff fulfillment events require their committed scoped operation and audit' USING ERRCODE='23514';END IF;
  IF e.source_kind='provider' AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result JOIN app.waybill_provider_event provider ON provider.id=result.event_id WHERE result.fulfillment_event_id=e.id AND provider.id=e.source_id AND EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.id=provider.booking_id AND historical.fulfillment_id=f.id) AND result.outcome IN ('issued','failed')) THEN RAISE EXCEPTION 'Provider fulfillment events require accepted original callback evidence' USING ERRCODE='23514';END IF;
  IF e.source_kind='cancellation' AND NOT EXISTS(SELECT 1 FROM app.waybill_cancellation_result result
    JOIN app.waybill_cancellation_provider_event registration ON registration.id=result.event_id
    JOIN app.shipment_cancellation cancellation ON cancellation.id=registration.cancellation_id
    JOIN app.shipment_booking original ON original.id=cancellation.booking_id
    WHERE result.fulfillment_event_id=e.id AND result.outcome='cancelled' AND registration.id=e.source_id
     AND original.fulfillment_id=f.id AND e.kind='booking_cancelled')
  THEN RAISE EXCEPTION 'Carrier cancellation events retain their exact original processed result' USING ERRCODE='23514'; END IF;
  IF e.kind='handover' THEN
   IF f.handover_at IS DISTINCT FROM e.occurred_at OR (f.booking_id IS NOT NULL AND b.status IS DISTINCT FROM 'issued')
    OR (f.booking_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='manual_issued')) THEN RAISE EXCEPTION 'Handover time is immutable' USING ERRCODE='23514';END IF;
   SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO expected FROM (SELECT a.balance_id,sum(a.quantity)::bigint quantity FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item i ON i.id=a.fulfillment_item_id WHERE i.shipment_id=f.shipment_id AND i.id IN (SELECT dispatch.id FROM app.fulfillment_dispatch_unit_ids(f.id) dispatch) GROUP BY a.balance_id) component;
   SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO actual FROM (SELECT balance_id,sum(quantity)::bigint quantity FROM app.stock_movement WHERE kind='consume' AND source_ref='handover:'||e.id::text GROUP BY balance_id) movement;
   IF expected IS NULL OR actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Handover conserves exactly its original parcel components' USING ERRCODE='23514';END IF;
  END IF;
 END LOOP;
 IF (f.handover_at IS NOT NULL)<>(EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='handover')) THEN RAISE EXCEPTION 'Physical handover requires its exact immutable event' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_fulfillment_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_replacement app.replacement_shipment; v_replacement_event app.replacement_event; v_operation app.replacement_operation; expected bigint; event app.fulfillment_event%ROWTYPE; f app.fulfillment%ROWTYPE; position app.inventory_balance%ROWTYPE; expiry date; zone text;
BEGIN
 IF NEW.kind<>'consume' THEN RETURN NEW;END IF;
 IF NEW.source_ref LIKE 'replacement-handover:%' THEN
  SELECT * INTO v_replacement_event FROM app.replacement_event WHERE kind='handover' AND 'replacement-handover:'||id::text=NEW.source_ref;
  SELECT * INTO v_replacement FROM app.replacement_shipment WHERE id=v_replacement_event.shipment_id;
  SELECT * INTO v_operation FROM app.replacement_operation WHERE id=v_replacement_event.source_id;
  SELECT sum(a.quantity) INTO expected FROM app.replacement_component_allocation a JOIN app.replacement_link link ON link.id=a.replacement_link_id
    WHERE link.shipment_id=v_replacement.id AND a.balance_id=NEW.balance_id
     AND link.id IN (SELECT id FROM app.replacement_request_unit_ids(v_replacement.booking_id));
  SELECT * INTO position FROM app.inventory_balance WHERE id=NEW.balance_id;
  SELECT expires_on INTO expiry FROM app.inventory_lot WHERE id=position.lot_id;
  SELECT timezone INTO zone FROM app.warehouse WHERE id=position.warehouse_id;
  IF v_replacement_event.id IS NULL OR v_replacement.status<>'handed_over'
    OR v_replacement.handover_at IS DISTINCT FROM v_replacement_event.occurred_at OR NEW.quantity IS DISTINCT FROM expected
    OR NEW.actor_id IS DISTINCT FROM v_replacement_event.actor_id OR v_replacement_event.source_kind<>'operation'
    OR v_operation.id IS NULL OR v_operation.action<>'handover' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR position.warehouse_id IS DISTINCT FROM v_replacement.warehouse_id OR expiry<(v_replacement_event.occurred_at AT TIME ZONE zone)::date
    OR NOT EXISTS(SELECT 1 FROM app.stock_reservation r JOIN app.stock_reservation_component c ON c.reservation_id=r.id
      WHERE r.id=v_replacement.stock_reservation_id AND r.kind='replacement' AND r.status='active' AND c.balance_id=NEW.balance_id
       AND c.quantity::numeric=NEW.quantity::numeric+coalesce((SELECT sum(allocation.quantity::numeric)
        FROM app.replacement_component_allocation allocation JOIN app.replacement_link link ON link.id=allocation.replacement_link_id
        JOIN app.exception_cancellation cancellation ON cancellation.replacement_link_id=link.id AND cancellation.stock_disposition='released'
        WHERE link.shipment_id=v_replacement.id AND allocation.balance_id=NEW.balance_id),0))
  THEN RAISE EXCEPTION 'Replacement consumption retains its exact current handover, complete held quantity, actor and usable lot' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO event FROM app.fulfillment_event WHERE kind='handover' AND 'handover:'||id::text=NEW.source_ref;SELECT * INTO f FROM app.fulfillment WHERE id=event.fulfillment_id;
 SELECT sum(a.quantity) INTO expected FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item i ON i.id=a.fulfillment_item_id WHERE i.shipment_id=f.shipment_id AND a.balance_id=NEW.balance_id AND i.id IN (SELECT dispatch.id FROM app.fulfillment_dispatch_unit_ids(f.id) dispatch);
 SELECT * INTO position FROM app.inventory_balance WHERE id=NEW.balance_id;SELECT expires_on INTO expiry FROM app.inventory_lot WHERE id=position.lot_id;SELECT timezone INTO zone FROM app.warehouse WHERE id=position.warehouse_id;
 IF event.id IS NULL OR f.handover_at IS DISTINCT FROM event.occurred_at OR NEW.quantity IS DISTINCT FROM expected OR NEW.actor_id IS DISTINCT FROM event.actor_id OR expiry<(event.occurred_at AT TIME ZONE zone)::date THEN RAISE EXCEPTION 'Checkout consumption requires exact original handover quantities and usable lots' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_parcel_receipt_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 v_order_id uuid; v_context record; v_units uuid[]; v_distinct integer; v_count integer;
BEGIN
 SELECT s.order_id INTO v_order_id FROM app.order_shipment s WHERE s.id=NEW.shipment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Parcel receipt requires its original shipment' USING ERRCODE='23514'; END IF;
 PERFORM o.id FROM app.commerce_order o WHERE o.id=v_order_id FOR UPDATE;
 IF NEW.booking_id IS NULL THEN
  -- S91: a manually booked parcel (operator-entered resi, no carrier booking).
  SELECT f.id AS fulfillment_id,f.handover_at,f.booking_id,'issued'::text AS booking_status,o.clock_namespace INTO v_context
  FROM app.fulfillment f JOIN app.order_shipment s ON s.id=f.shipment_id JOIN app.commerce_order o ON o.id=s.order_id
  WHERE s.id=NEW.shipment_id AND f.booking_id IS NULL AND EXISTS(SELECT 1 FROM app.fulfillment_event e WHERE e.fulfillment_id=f.id AND e.kind='manual_issued') FOR SHARE OF f;
 ELSE
  SELECT f.id AS fulfillment_id,f.handover_at,f.booking_id,b.status AS booking_status,o.clock_namespace INTO v_context
  FROM app.shipment_booking b JOIN app.fulfillment f ON f.id=b.fulfillment_id
  JOIN app.order_shipment s ON s.id=f.shipment_id JOIN app.commerce_order o ON o.id=s.order_id
  WHERE b.id=NEW.booking_id AND s.id=NEW.shipment_id FOR SHARE OF f,b;
 END IF;
 IF NOT FOUND OR current_database()<>'99ribu_'||NEW.environment
    OR NEW.clock_namespace IS DISTINCT FROM v_context.clock_namespace
    OR v_context.booking_id IS DISTINCT FROM NEW.booking_id OR v_context.booking_status<>'issued'
    OR v_context.handover_at IS NULL OR NEW.occurred_at<v_context.handover_at
    OR NEW.occurred_at>app.reservation_clock(v_context.clock_namespace)
 THEN RAISE EXCEPTION 'Parcel receipt requires original issued handover and actual source clock/time' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.unit_ids)<>'array' OR jsonb_array_length(NEW.unit_ids) NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'Parcel receipt requires bounded original offer units' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.unit_ids) AS u(value)
           WHERE u.value !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
 THEN RAISE EXCEPTION 'Parcel receipt unit identity is invalid' USING ERRCODE='23514'; END IF;
 SELECT array_agg(u.value::uuid ORDER BY u.value::uuid),count(DISTINCT u.value)::integer INTO v_units,v_distinct
 FROM jsonb_array_elements_text(NEW.unit_ids) AS u(value);
 IF cardinality(v_units)<>v_distinct OR to_jsonb(v_units) IS DISTINCT FROM NEW.unit_ids
 THEN RAISE EXCEPTION 'Parcel receipt units are distinct and canonically ordered' USING ERRCODE='23514'; END IF;
 SELECT count(*)::integer INTO v_count FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
 WHERE f.id=ANY(v_units) AND f.shipment_id=NEW.shipment_id AND i.order_id=v_order_id
  AND f.id IN (SELECT dispatch.id FROM app.fulfillment_dispatch_unit_ids(v_context.fulfillment_id) dispatch);
 IF v_count<>cardinality(v_units)
 THEN RAISE EXCEPTION 'Parcel receipt retains exact frozen original-label membership, including legacy whole parcels' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_manual_fulfillment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Manual fulfillment, pickup profile and COD statement history is append-only' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER warehouse_pickup_profile_history BEFORE UPDATE OR DELETE ON app.warehouse_pickup_profile FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_history();
--> statement-breakpoint
CREATE TRIGGER manual_tracking_history BEFORE UPDATE OR DELETE ON app.manual_tracking FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_history();
--> statement-breakpoint
CREATE TRIGGER fulfillment_purchase_reference_history BEFORE UPDATE OR DELETE ON app.fulfillment_purchase_reference FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_history();
--> statement-breakpoint
CREATE TRIGGER shipment_tracking_event_history BEFORE UPDATE OR DELETE ON app.shipment_tracking_event FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_history();
--> statement-breakpoint
CREATE TRIGGER local_tracking_observation_history BEFORE UPDATE OR DELETE ON app.local_tracking_observation FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_history();
--> statement-breakpoint
CREATE TRIGGER cod_remittance_history BEFORE UPDATE OR DELETE ON app.cod_remittance FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_history();
--> statement-breakpoint
CREATE TRIGGER cod_remittance_line_history BEFORE UPDATE OR DELETE ON app.cod_remittance_line FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_history();
--> statement-breakpoint
CREATE FUNCTION app.guard_manual_fulfillment_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_previous integer; v_first app.manual_tracking; v_prior app.manual_tracking; v_event app.fulfillment_event; v_units jsonb;
BEGIN
 IF TG_TABLE_NAME='warehouse_pickup_profile' THEN
  PERFORM id FROM app.warehouse WHERE id=NEW.warehouse_id FOR UPDATE;
  SELECT max(revision) INTO v_previous FROM app.warehouse_pickup_profile WHERE warehouse_id=NEW.warehouse_id;
  IF NEW.revision IS DISTINCT FROM coalesce(v_previous,0)+1 THEN RAISE EXCEPTION 'Pickup profile revisions append in order' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='fulfillment_purchase_reference' THEN
  PERFORM id FROM app.fulfillment WHERE id=NEW.fulfillment_id FOR UPDATE;
  SELECT max(version) INTO v_previous FROM app.fulfillment_purchase_reference WHERE fulfillment_id=NEW.fulfillment_id;
  IF NEW.version IS DISTINCT FROM coalesce(v_previous,0)+1 THEN RAISE EXCEPTION 'Purchase reference versions append in order' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_event FROM app.fulfillment_event WHERE id=NEW.fulfillment_event_id;
  SELECT max(version) INTO v_previous FROM app.manual_tracking WHERE fulfillment_id=NEW.fulfillment_id;
  IF v_event.id IS NULL OR v_event.fulfillment_id<>NEW.fulfillment_id OR v_event.actor_id IS DISTINCT FROM NEW.actor_id
   OR NEW.version IS DISTINCT FROM coalesce(v_previous,0)+1
   OR v_event.kind IS DISTINCT FROM (CASE WHEN NEW.version=1 THEN 'manual_issued' ELSE 'tracking_corrected' END)
  THEN RAISE EXCEPTION 'Manual resi versions append in order with their exact causal event' USING ERRCODE='23514'; END IF;
  -- One live resi per courier across manual parcels (another parcel's latest version).
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-resi:'||NEW.courier||':'||NEW.tracking_number,0));
  IF EXISTS(SELECT 1 FROM app.manual_tracking other WHERE other.fulfillment_id<>NEW.fulfillment_id AND other.courier=NEW.courier AND other.tracking_number=NEW.tracking_number
    AND other.version=(SELECT max(version) FROM app.manual_tracking latest WHERE latest.fulfillment_id=other.fulfillment_id))
  THEN RAISE EXCEPTION 'A resi belongs to one live manual parcel per courier' USING ERRCODE='23505'; END IF;
  IF NEW.version=1 THEN
   SELECT coalesce(jsonb_agg(to_jsonb(unit.id) ORDER BY unit.id),'[]'::jsonb) INTO v_units FROM app.fulfillment f JOIN app.fulfillment_item unit ON unit.shipment_id=f.shipment_id
    WHERE f.id=NEW.fulfillment_id AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation c WHERE c.fulfillment_item_id=unit.id AND c.replacement_link_id IS NULL);
   IF NEW.unit_ids IS DISTINCT FROM v_units THEN RAISE EXCEPTION 'Manual dispatch freezes exactly the surviving original units' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO v_first FROM app.manual_tracking WHERE fulfillment_id=NEW.fulfillment_id AND version=1;
   SELECT * INTO v_prior FROM app.manual_tracking WHERE fulfillment_id=NEW.fulfillment_id AND version=v_previous;
   IF NEW.unit_ids IS DISTINCT FROM v_first.unit_ids OR (NEW.courier,NEW.tracking_number) IS NOT DISTINCT FROM (v_prior.courier,v_prior.tracking_number)
   THEN RAISE EXCEPTION 'A resi correction keeps the frozen units and changes the resi' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER warehouse_pickup_profile_version BEFORE INSERT ON app.warehouse_pickup_profile FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_version();
--> statement-breakpoint
CREATE TRIGGER fulfillment_purchase_reference_version BEFORE INSERT ON app.fulfillment_purchase_reference FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_version();
--> statement-breakpoint
CREATE TRIGGER manual_tracking_version BEFORE INSERT ON app.manual_tracking FOR EACH ROW EXECUTE FUNCTION app.guard_manual_fulfillment_version();
--> statement-breakpoint
CREATE FUNCTION app.guard_shipment_tracking_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment; v_source app.local_parcel_receipt; v_rank integer;
BEGIN
 SELECT * INTO f FROM app.fulfillment WHERE id=NEW.fulfillment_id FOR UPDATE;
 -- Ranks: picked_up < in_transit < failed (attempt failed, not terminal) < delivered (terminal).
 v_rank:=CASE NEW.status WHEN 'picked_up' THEN 1 WHEN 'in_transit' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END;
 IF f.id IS NULL OR f.booking_id IS NOT NULL OR f.handover_at IS NULL OR NEW.occurred_at<f.handover_at
  OR NOT EXISTS(SELECT 1 FROM app.manual_tracking mt WHERE mt.id=NEW.tracking_id AND mt.fulfillment_id=f.id)
  OR EXISTS(SELECT 1 FROM app.shipment_tracking_event e WHERE e.fulfillment_id=f.id
   AND (CASE e.status WHEN 'picked_up' THEN 1 WHEN 'in_transit' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END)>=v_rank)
 THEN RAISE EXCEPTION 'Tracking status advances monotonically for a shipped manual parcel' USING ERRCODE='23514'; END IF;
 IF NEW.status='delivered' THEN
  SELECT * INTO v_source FROM app.local_parcel_receipt WHERE id=NEW.receipt_source_id;
  IF v_source.id IS NULL OR v_source.booking_id IS NOT NULL OR v_source.shipment_id<>f.shipment_id OR v_source.occurred_at<>NEW.occurred_at
   OR v_source.unit_ids IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(d.id) ORDER BY d.id) FROM app.fulfillment_dispatch_unit_ids(f.id) d)
  THEN RAISE EXCEPTION 'Delivered status carries its exact whole-parcel receipt source' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER shipment_tracking_event_guard BEFORE INSERT ON app.shipment_tracking_event FOR EACH ROW EXECUTE FUNCTION app.guard_shipment_tracking_event();
--> statement-breakpoint
CREATE FUNCTION app.guard_cod_remittance_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_operation app.local_cod_operation; v_remittance app.cod_remittance;
BEGIN
 PERFORM id FROM app.order_shipment WHERE id=NEW.shipment_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app.cod_remittance_line WHERE shipment_id=NEW.shipment_id)
 THEN RAISE EXCEPTION 'A COD parcel is remitted on one Mengantar statement only' USING ERRCODE='23505'; END IF;
 SELECT * INTO v_operation FROM app.local_cod_operation WHERE id=NEW.cod_operation_id;
 SELECT * INTO v_remittance FROM app.cod_remittance WHERE id=NEW.remittance_id;
 IF v_operation.id IS NULL OR v_remittance.id IS NULL OR v_operation.shipment_id<>NEW.shipment_id OR v_operation.status<>'collected'
  OR v_operation.amount<>NEW.amount OR v_operation.requested_amount<>NEW.expected_amount OR v_operation.environment<>v_remittance.environment
  OR v_operation.reference<>'remit:'||NEW.remittance_id::text
  OR NOT EXISTS(SELECT 1 FROM app.fulfillment f WHERE f.shipment_id=NEW.shipment_id AND f.handover_at IS NOT NULL AND f.booking_id IS NULL
    AND EXISTS(SELECT 1 FROM app.manual_tracking mt WHERE mt.fulfillment_id=f.id))
 THEN RAISE EXCEPTION 'COD statement line retains its exact collection source for a shipped parcel' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cod_remittance_line_guard BEFORE INSERT ON app.cod_remittance_line FOR EACH ROW EXECUTE FUNCTION app.guard_cod_remittance_line();
--> statement-breakpoint
CREATE FUNCTION app.seal_cod_remittance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_remittance app.cod_remittance; v_operation app.local_settlement_operation; v_statement app.local_settlement_statement;
BEGIN
 SELECT * INTO v_remittance FROM app.cod_remittance WHERE id=NEW.id;
 SELECT * INTO v_operation FROM app.local_settlement_operation WHERE id=v_remittance.settlement_operation_id;
 SELECT * INTO v_statement FROM app.local_settlement_statement WHERE operation_id=v_operation.id AND revision=1;
 IF v_operation.id IS NULL OR v_operation.provider<>'local.cod' OR v_operation.direction<>'credit' OR v_operation.environment<>v_remittance.environment
  OR v_operation.reference<>'mengantar-cod:'||v_remittance.reference OR v_operation.net_amount<>v_remittance.net_amount
  OR v_statement.id IS NULL OR v_statement.gross_amount IS DISTINCT FROM v_remittance.gross_amount
  OR v_statement.carrier_fee IS DISTINCT FROM v_remittance.shipping_deduction+v_remittance.cod_fee_deduction
  OR v_statement.provider_fee IS DISTINCT FROM v_remittance.other_deduction
  OR v_remittance.gross_amount IS DISTINCT FROM (SELECT sum(amount) FROM app.cod_remittance_line WHERE remittance_id=NEW.id)
  OR NOT EXISTS(SELECT 1 FROM app.outbox_job j WHERE j.id=v_remittance.match_job_id AND j.kind='cod.remittance.match' AND j.dedup_key='cod-remittance-match:'||NEW.id::text)
 THEN RAISE EXCEPTION 'COD statement seals with its exact settlement source, lines and matching job' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cod_remittance_sealed AFTER INSERT ON app.cod_remittance DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_cod_remittance();
--> statement-breakpoint
-- S91: manual parcels have no booking; compare custody sources null-safely.
CREATE OR REPLACE FUNCTION app.guard_buyer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_parcel_receipt; v_shipment_id uuid;
BEGIN
 SELECT e.* INTO v_source FROM app.local_parcel_receipt e JOIN app.parcel_receipt_provider_event p ON p.id=e.id WHERE p.id=NEW.source_id;
 IF NOT FOUND OR NEW.received_at IS DISTINCT FROM v_source.occurred_at
    OR NOT (v_source.unit_ids ? NEW.fulfillment_item_id::text)
 THEN RAISE EXCEPTION 'Buyer receipt retains its exact original signed unit/time' USING ERRCODE='23514'; END IF;
 SELECT f.shipment_id INTO v_shipment_id FROM app.fulfillment_item f WHERE f.id=NEW.fulfillment_item_id;
 IF v_shipment_id IS DISTINCT FROM v_source.shipment_id
 THEN RAISE EXCEPTION 'Buyer receipt cannot move between original parcels' USING ERRCODE='23514'; END IF;
 -- An earlier first-delivery anchor remains valid even when its callback
 -- arrives after RTS. A new receipt at/after known RTS needs source recovery.
 IF EXISTS(SELECT 1 FROM app.local_parcel_outcome e WHERE e.shipment_id=v_source.shipment_id
   AND e.booking_id IS NOT DISTINCT FROM v_source.booking_id AND e.environment=v_source.environment
   AND e.clock_namespace IS NOT DISTINCT FROM v_source.clock_namespace
   AND e.status='returned_to_sender' AND e.occurred_at<=NEW.received_at
   AND e.unit_ids ? NEW.fulfillment_item_id::text)
 THEN RAISE EXCEPTION 'Known returned-to-sender custody cannot create a new later buyer receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
