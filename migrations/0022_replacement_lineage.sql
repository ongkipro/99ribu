-- S32 additive candidate: replacement lineage and effective affiliate rates.
-- Reviewed rollback-only execution is separate from migration application.
-- Applied0000-0021 and the original22-entry journal prefix remain immutable.
CREATE TABLE "app"."affiliate_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rate_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "affiliate_account_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "affiliate_account_state_check" CHECK ("app"."affiliate_account"."status" IN ('active','suspended') AND "app"."affiliate_account"."rate_revision">=0)
);
--> statement-breakpoint
CREATE TABLE "app"."affiliate_rate_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"basis_points" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"proof_digest" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_xid" text DEFAULT pg_current_xact_id()::text NOT NULL,
	CONSTRAINT "affiliate_rate_version_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "affiliate_rate_version_proof_digest_unique" UNIQUE("proof_digest"),
	CONSTRAINT "affiliate_rate_revision_unique" UNIQUE("affiliate_id","revision"),
	CONSTRAINT "affiliate_rate_value_check" CHECK ("app"."affiliate_rate_version"."revision">0 AND "app"."affiliate_rate_version"."basis_points" between 0 and 10000 AND "app"."affiliate_rate_version"."proof_digest" ~ '^[a-f0-9]{64}$' AND char_length("app"."affiliate_rate_version"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."local_replacement_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"tracking_number" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_replacement_event_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "local_replacement_event_value_check" CHECK ("app"."local_replacement_event"."signature" ~ '^[a-f0-9]{64}$' AND (("app"."local_replacement_event"."status"='issued' AND "app"."local_replacement_event"."tracking_number" IS NOT NULL AND "app"."local_replacement_event"."tracking_number" ~ '^LOCAL-REPLACEMENT-[A-F0-9]{32}$') OR ("app"."local_replacement_event"."status"='failed' AND "app"."local_replacement_event"."tracking_number" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."local_replacement_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"clock_namespace" text,
	"profile" text NOT NULL,
	"request_hash" text NOT NULL,
	"cod_due" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"tracking_number" text,
	"created_at" timestamp with time zone NOT NULL,
	"terminal_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_replacement_operation_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "local_replacement_operation_value_check" CHECK ("app"."local_replacement_operation"."environment" IN ('local','test') AND "app"."local_replacement_operation"."profile" IN ('normal','creation_ack_lost','issuance_ack_lost','rejected') AND "app"."local_replacement_operation"."cod_due"=0 AND "app"."local_replacement_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND (("app"."local_replacement_operation"."status"='created' AND "app"."local_replacement_operation"."tracking_number" IS NULL AND "app"."local_replacement_operation"."terminal_at" IS NULL) OR ("app"."local_replacement_operation"."status"='issued' AND "app"."local_replacement_operation"."tracking_number" IS NOT NULL AND "app"."local_replacement_operation"."tracking_number" ~ '^LOCAL-REPLACEMENT-[A-F0-9]{32}$' AND "app"."local_replacement_operation"."terminal_at" IS NOT NULL) OR ("app"."local_replacement_operation"."status"='failed' AND "app"."local_replacement_operation"."tracking_number" IS NULL AND "app"."local_replacement_operation"."terminal_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."local_replacement_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"environment" text NOT NULL,
	"shipment_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"clock_namespace" text,
	"unit_ids" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"signature" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_replacement_receipt_reference_unique" UNIQUE("environment","reference"),
	CONSTRAINT "local_replacement_receipt_value_check" CHECK ("app"."local_replacement_receipt"."environment" IN ('local','test') AND "app"."local_replacement_receipt"."reference" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."local_replacement_receipt"."request_hash" ~ '^[a-f0-9]{64}$' AND "app"."local_replacement_receipt"."signature" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("app"."local_replacement_receipt"."unit_ids")='array' AND jsonb_array_length("app"."local_replacement_receipt"."unit_ids") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"creation_job_id" uuid NOT NULL,
	"provider_operation_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "replacement_booking_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "replacement_booking_creation_job_id_unique" UNIQUE("creation_job_id"),
	CONSTRAINT "replacement_booking_provider_operation_id_unique" UNIQUE("provider_operation_id"),
	CONSTRAINT "replacement_booking_attempt_unique" UNIQUE("shipment_id","attempt"),
	CONSTRAINT "replacement_booking_state_check" CHECK ("app"."replacement_booking"."attempt">0 AND "app"."replacement_booking"."status" IN ('queued','processing','unknown','issued','failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_buyer_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replacement_link_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "replacement_buyer_receipt_replacement_link_id_unique" UNIQUE("replacement_link_id")
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_component_allocation" (
	"replacement_link_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "replacement_component_allocation_replacement_link_id_balance_id_pk" PRIMARY KEY("replacement_link_id","balance_id"),
	CONSTRAINT "replacement_component_quantity_check" CHECK ("app"."replacement_component_allocation"."quantity" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_id" text,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "replacement_event_revision_unique" UNIQUE("shipment_id","revision"),
	CONSTRAINT "replacement_event_source_unique" UNIQUE("source_kind","source_id","kind"),
	CONSTRAINT "replacement_event_value_check" CHECK ("app"."replacement_event"."revision">0 AND "app"."replacement_event"."kind" IN ('create','reserve','stock_wait','prepare','book','unknown','waybill_issued','waybill_failed','handover','receipt','reconcile') AND "app"."replacement_event"."source_kind" IN ('operation','job','provider','receipt') AND ("app"."replacement_event"."source_kind"='operation' OR "app"."replacement_event"."actor_id" IS NULL) AND char_length("app"."replacement_event"."reason") between 1 and 500 AND jsonb_typeof("app"."replacement_event"."snapshot")='object' AND octet_length("app"."replacement_event"."snapshot"::text)<=65536)
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_event_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"replacement_event_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "replacement_event_result_replacement_event_id_unique" UNIQUE("replacement_event_id"),
	CONSTRAINT "replacement_event_result_value_check" CHECK ("app"."replacement_event_result"."revision">0 AND "app"."replacement_event_result"."outcome" IN ('issued','failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"return_item_id" uuid NOT NULL,
	"original_fulfillment_item_id" uuid NOT NULL,
	"predecessor_id" uuid,
	"generation" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "replacement_link_return_item_id_unique" UNIQUE("return_item_id"),
	CONSTRAINT "replacement_link_generation_unique" UNIQUE("original_fulfillment_item_id","generation"),
	CONSTRAINT "replacement_link_value_check" CHECK ("app"."replacement_link"."generation">0 AND ("app"."replacement_link"."predecessor_id" IS NULL OR "app"."replacement_link"."predecessor_id"<>"app"."replacement_link"."id") AND "app"."replacement_link"."id"<>"app"."replacement_link"."original_fulfillment_item_id")
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_xid" text DEFAULT pg_current_xact_id()::text NOT NULL,
	CONSTRAINT "replacement_operation_key_unique" UNIQUE("actor_id","key"),
	CONSTRAINT "replacement_operation_value_check" CHECK (char_length("app"."replacement_operation"."key") between 16 and 200 AND "app"."replacement_operation"."action" IN ('create','reserve','prepare','book','handover','reconcile') AND "app"."replacement_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("app"."replacement_operation"."response")='object' AND octet_length("app"."replacement_operation"."response"::text)<=1048576)
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "replacement_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "replacement_provider_event_hash_check" CHECK ("app"."replacement_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_receipt_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "replacement_receipt_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "replacement_receipt_provider_hash_check" CHECK ("app"."replacement_receipt_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_receipt_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"outcome" text NOT NULL,
	"receipt_count" integer NOT NULL,
	"replacement_event_id" uuid,
	"return_event_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "replacement_receipt_result_replacement_event_id_unique" UNIQUE("replacement_event_id"),
	CONSTRAINT "replacement_receipt_result_return_event_id_unique" UNIQUE("return_event_id"),
	CONSTRAINT "replacement_receipt_result_value_check" CHECK ("app"."replacement_receipt_result"."revision">0 AND (("app"."replacement_receipt_result"."outcome"='received' AND "app"."replacement_receipt_result"."receipt_count" between 1 and 100 AND "app"."replacement_receipt_result"."replacement_event_id" IS NOT NULL AND "app"."replacement_receipt_result"."return_event_id" IS NOT NULL) OR ("app"."replacement_receipt_result"."outcome"='duplicate' AND "app"."replacement_receipt_result"."receipt_count"=0 AND "app"."replacement_receipt_result"."replacement_event_id" IS NULL AND "app"."replacement_receipt_result"."return_event_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."replacement_shipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"stock_reservation_id" uuid,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"booking_id" uuid,
	"buyer_shipping" bigint DEFAULT 0 NOT NULL,
	"cod_due" bigint DEFAULT 0 NOT NULL,
	"prepared_at" timestamp with time zone,
	"waybill_issued_at" timestamp with time zone,
	"tracking_number" text,
	"handover_at" timestamp with time zone,
	"handover_reference" text,
	"packing_due_at" timestamp with time zone,
	"calendar_snapshot" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "replacement_shipment_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "replacement_shipment_stock_reservation_id_unique" UNIQUE("stock_reservation_id"),
	CONSTRAINT "replacement_shipment_state_check" CHECK ("app"."replacement_shipment"."revision">0 AND "app"."replacement_shipment"."status" IN ('awaiting_stock','ready','picking','booking_pending','booking_unknown','booking_failed','packed','handed_over','partially_delivered','delivered') AND "app"."replacement_shipment"."buyer_shipping"=0 AND "app"."replacement_shipment"."cod_due"=0 AND (("app"."replacement_shipment"."packing_due_at" IS NULL)=("app"."replacement_shipment"."calendar_snapshot" IS NULL)) AND ("app"."replacement_shipment"."calendar_snapshot" IS NULL OR (jsonb_typeof("app"."replacement_shipment"."calendar_snapshot")='object' AND octet_length("app"."replacement_shipment"."calendar_snapshot"::text)<=65536)) AND ("app"."replacement_shipment"."tracking_number" IS NULL OR "app"."replacement_shipment"."tracking_number" ~ '^LOCAL-REPLACEMENT-[A-F0-9]{32}$') AND ("app"."replacement_shipment"."handover_reference" IS NULL OR char_length("app"."replacement_shipment"."handover_reference") between 1 and 200))
);
--> statement-breakpoint
ALTER TABLE "app"."return_event" DROP CONSTRAINT "return_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."stock_reservation" DROP CONSTRAINT "stock_reservation_kind_check";--> statement-breakpoint
DROP INDEX "app"."return_item_active_unit_unique";--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD COLUMN "replacement_link_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."affiliate_account" ADD CONSTRAINT "affiliate_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_rate_version" ADD CONSTRAINT "affiliate_rate_version_affiliate_id_affiliate_account_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "app"."affiliate_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_rate_version" ADD CONSTRAINT "affiliate_rate_version_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_replacement_event" ADD CONSTRAINT "local_replacement_event_operation_id_local_replacement_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_replacement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_replacement_operation" ADD CONSTRAINT "local_replacement_operation_booking_id_replacement_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."replacement_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_replacement_receipt" ADD CONSTRAINT "local_replacement_receipt_shipment_id_replacement_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."replacement_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_replacement_receipt" ADD CONSTRAINT "local_replacement_receipt_booking_id_replacement_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."replacement_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_booking" ADD CONSTRAINT "replacement_booking_shipment_id_replacement_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."replacement_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_booking" ADD CONSTRAINT "replacement_booking_operation_id_replacement_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."replacement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_booking" ADD CONSTRAINT "replacement_booking_creation_job_id_outbox_job_id_fk" FOREIGN KEY ("creation_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_booking" ADD CONSTRAINT "replacement_booking_provider_operation_id_local_replacement_operation_id_fk" FOREIGN KEY ("provider_operation_id") REFERENCES "app"."local_replacement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_buyer_receipt" ADD CONSTRAINT "replacement_buyer_receipt_replacement_link_id_replacement_link_id_fk" FOREIGN KEY ("replacement_link_id") REFERENCES "app"."replacement_link"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_buyer_receipt" ADD CONSTRAINT "replacement_buyer_receipt_source_id_local_replacement_receipt_id_fk" FOREIGN KEY ("source_id") REFERENCES "app"."local_replacement_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_component_allocation" ADD CONSTRAINT "replacement_component_allocation_replacement_link_id_replacement_link_id_fk" FOREIGN KEY ("replacement_link_id") REFERENCES "app"."replacement_link"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_component_allocation" ADD CONSTRAINT "replacement_component_allocation_balance_id_inventory_balance_id_fk" FOREIGN KEY ("balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_component_allocation" ADD CONSTRAINT "replacement_component_allocation_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_event" ADD CONSTRAINT "replacement_event_shipment_id_replacement_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."replacement_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_event_result" ADD CONSTRAINT "replacement_event_result_event_id_replacement_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."replacement_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_event_result" ADD CONSTRAINT "replacement_event_result_shipment_id_replacement_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."replacement_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_event_result" ADD CONSTRAINT "replacement_event_result_replacement_event_id_replacement_event_id_fk" FOREIGN KEY ("replacement_event_id") REFERENCES "app"."replacement_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_link" ADD CONSTRAINT "replacement_link_shipment_id_replacement_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."replacement_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_link" ADD CONSTRAINT "replacement_link_return_item_id_return_item_id_fk" FOREIGN KEY ("return_item_id") REFERENCES "app"."return_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_link" ADD CONSTRAINT "replacement_link_original_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("original_fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_link" ADD CONSTRAINT "replacement_link_predecessor_id_replacement_link_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "app"."replacement_link"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_operation" ADD CONSTRAINT "replacement_operation_case_id_return_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_operation" ADD CONSTRAINT "replacement_operation_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_provider_event" ADD CONSTRAINT "replacement_provider_event_id_local_replacement_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_replacement_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_provider_event" ADD CONSTRAINT "replacement_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_receipt_provider_event" ADD CONSTRAINT "replacement_receipt_provider_event_id_local_replacement_receipt_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_replacement_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_receipt_provider_event" ADD CONSTRAINT "replacement_receipt_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_receipt_result" ADD CONSTRAINT "replacement_receipt_result_event_id_replacement_receipt_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."replacement_receipt_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_receipt_result" ADD CONSTRAINT "replacement_receipt_result_shipment_id_replacement_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."replacement_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_receipt_result" ADD CONSTRAINT "replacement_receipt_result_replacement_event_id_replacement_event_id_fk" FOREIGN KEY ("replacement_event_id") REFERENCES "app"."replacement_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_receipt_result" ADD CONSTRAINT "replacement_receipt_result_return_event_id_return_event_id_fk" FOREIGN KEY ("return_event_id") REFERENCES "app"."return_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_shipment" ADD CONSTRAINT "replacement_shipment_case_id_return_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_shipment" ADD CONSTRAINT "replacement_shipment_operation_id_replacement_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."replacement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_shipment" ADD CONSTRAINT "replacement_shipment_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_shipment" ADD CONSTRAINT "replacement_shipment_stock_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("stock_reservation_id") REFERENCES "app"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replacement_shipment" ADD CONSTRAINT "replacement_shipment_booking_id_replacement_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."replacement_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_rate_effective_idx" ON "app"."affiliate_rate_version" USING btree ("affiliate_id","effective_at","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "replacement_booking_active_unique" ON "app"."replacement_booking" USING btree ("shipment_id") WHERE "app"."replacement_booking"."status"<>'failed';--> statement-breakpoint
CREATE INDEX "replacement_buyer_receipt_source_idx" ON "app"."replacement_buyer_receipt" USING btree ("source_id","replacement_link_id");--> statement-breakpoint
CREATE INDEX "replacement_link_shipment_idx" ON "app"."replacement_link" USING btree ("shipment_id","id");--> statement-breakpoint
CREATE INDEX "replacement_shipment_case_idx" ON "app"."replacement_shipment" USING btree ("case_id","id");--> statement-breakpoint
CREATE INDEX "replacement_shipment_queue_idx" ON "app"."replacement_shipment" USING btree ("warehouse_id","status","id");--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD CONSTRAINT "return_item_replacement_link_id_replacement_link_id_fk" FOREIGN KEY ("replacement_link_id") REFERENCES "app"."replacement_link"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "return_item_active_unit_unique" ON "app"."return_item" USING btree (coalesce("replacement_link_id","fulfillment_item_id")) WHERE "app"."return_item"."claim_state"<>'released';--> statement-breakpoint
ALTER TABLE "app"."return_event" ADD CONSTRAINT "return_event_value_check" CHECK ("app"."return_event"."revision">0 AND "app"."return_event"."kind" IN ('create','decision','inspection','refund_queue','refund_confirmed','refund_failed','replacement_started','replacement_received') AND "app"."return_event"."status" IN ('requested','reviewing','approved','rejected','awaiting_goods','inspecting','refunding','replacing','resolved') AND "app"."return_event"."source_kind" IN ('operation','refund','replacement') AND ("app"."return_event"."source_kind" IN ('operation','replacement') OR "app"."return_event"."actor_id" IS NULL) AND char_length("app"."return_event"."reason") between 1 and 2000);--> statement-breakpoint
ALTER TABLE "app"."stock_reservation" ADD CONSTRAINT "stock_reservation_kind_check" CHECK (("app"."stock_reservation"."kind"='checkout' AND "app"."stock_reservation"."expires_at" IS NOT NULL AND "app"."stock_reservation"."expires_at">"app"."stock_reservation"."created_at") OR ("app"."stock_reservation"."kind" IN ('transfer','replacement') AND "app"."stock_reservation"."expires_at" IS NULL));
--> statement-breakpoint
-- Draft native rate seals. The deliberate pre-DDL stop remains in place.
CREATE FUNCTION app.guard_affiliate_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_version app.affiliate_rate_version; v_user app.auth_user; v_roles text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Affiliate rate identities retain their original history' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_user FROM app.auth_user WHERE id=NEW.user_id FOR UPDATE;
  SELECT roles INTO v_roles FROM app.role_grant WHERE user_id=NEW.user_id FOR SHARE;
  IF v_user.id IS NULL OR NOT v_user.email_verified OR NOT coalesce('affiliate'=ANY(v_roles),false) OR NEW.rate_revision<>0
  THEN RAISE EXCEPTION 'Rate subject requires a verified actual affiliate identity and empty rate stream' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-'rate_revision') IS DISTINCT FROM (to_jsonb(OLD)-'rate_revision')
     OR NEW.rate_revision::bigint<>OLD.rate_revision::bigint+1
  THEN RAISE EXCEPTION 'Rate identity remains immutable while its exact version advances' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_version FROM app.affiliate_rate_version WHERE affiliate_id=NEW.id AND revision=NEW.rate_revision;
  IF v_version.id IS NULL OR v_version.created_xid<>pg_current_xact_id()::text
  THEN RAISE EXCEPTION 'Rate head advances with its actual current transaction version' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER affiliate_account_guard BEFORE INSERT OR UPDATE OR DELETE ON app.affiliate_account
 FOR EACH ROW EXECUTE FUNCTION app.guard_affiliate_account();
--> statement-breakpoint
CREATE FUNCTION app.guard_affiliate_rate_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_account app.affiliate_account; v_subject text; v_last timestamptz; v_now timestamptz;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Affiliate rate versions are immutable' USING ERRCODE='23514'; END IF;
 SELECT user_id INTO v_subject FROM app.affiliate_account WHERE id=NEW.affiliate_id;
 PERFORM id FROM app.auth_user WHERE id=ANY(ARRAY[NEW.actor_id,v_subject]) ORDER BY id FOR UPDATE;
 PERFORM user_id FROM app.role_grant WHERE user_id=ANY(ARRAY[NEW.actor_id,v_subject]) ORDER BY user_id FOR SHARE;
 SELECT * INTO v_account FROM app.affiliate_account WHERE id=NEW.affiliate_id FOR UPDATE;
 IF v_account.id IS NULL OR v_account.status<>'active' OR NEW.revision::bigint<>v_account.rate_revision::bigint+1
    OR NOT EXISTS(SELECT 1 FROM app.auth_user u JOIN app.role_grant g ON g.user_id=u.id
       WHERE u.id=v_account.user_id AND u.email_verified AND 'affiliate'=ANY(g.roles))
 THEN RAISE EXCEPTION 'Prospective rate requires its active verified affiliate and next exact revision' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.auth_user u JOIN app.role_grant g ON g.user_id=u.id
    JOIN app.auth_session session ON session.user_id=u.id JOIN app.mfa_session m ON m.session_id=session.id
    WHERE u.id=NEW.actor_id AND session.id=NEW.session_id AND session.expires_at>clock_timestamp()
      AND u.email_verified AND u.two_factor_enabled AND 'owner'=ANY(g.roles)
      AND m.verified_at>clock_timestamp()-interval '5 minutes')
 THEN RAISE EXCEPTION 'Rate creation requires current verified owner, exact session and fresh MFA' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp(); NEW.created_xid:=pg_current_xact_id()::text;
 v_now:=date_trunc('milliseconds',NEW.created_at);
 NEW.effective_at:=coalesce(NEW.effective_at,v_now);
 SELECT effective_at INTO v_last FROM app.affiliate_rate_version WHERE affiliate_id=NEW.affiliate_id ORDER BY revision DESC LIMIT 1;
 IF NEW.effective_at<v_now OR NEW.effective_at>v_now+interval '366 days'
    OR NEW.effective_at<>date_trunc('milliseconds',NEW.effective_at)
    OR (v_last IS NOT NULL AND NEW.effective_at<v_last)
 THEN RAISE EXCEPTION 'Rate effective times are canonical, bounded, prospective and monotonic' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER affiliate_rate_version_guard BEFORE INSERT OR UPDATE OR DELETE ON app.affiliate_rate_version
 FOR EACH ROW EXECUTE FUNCTION app.guard_affiliate_rate_version();
--> statement-breakpoint
CREATE FUNCTION app.assert_affiliate_rate_version(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_rate app.affiliate_rate_version; v_account app.affiliate_account; v_proof app.access_proof;
 v_operation app.access_operation; v_session app.auth_session; v_mfa app.mfa_session; v_grant app.role_grant; v_user app.auth_user;
BEGIN
 SELECT * INTO v_rate FROM app.affiliate_rate_version WHERE id=p_id;
 IF v_rate.id IS NULL OR v_rate.created_xid<>pg_current_xact_id()::text
 THEN RAISE EXCEPTION 'New rate is sealed by its creating transaction' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_account FROM app.affiliate_account WHERE id=v_rate.affiliate_id FOR UPDATE;
 IF v_account.id IS NULL OR v_account.rate_revision<v_rate.revision
    OR (SELECT count(*) FROM app.affiliate_rate_version WHERE affiliate_id=v_account.id)<>v_account.rate_revision
 THEN RAISE EXCEPTION 'Rate stream, immutable version and head commit together' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_user FROM app.auth_user WHERE id=v_rate.actor_id FOR UPDATE;
 SELECT * INTO v_session FROM app.auth_session WHERE id=v_rate.session_id AND user_id=v_rate.actor_id FOR SHARE;
 SELECT * INTO v_mfa FROM app.mfa_session WHERE session_id=v_rate.session_id FOR SHARE;
 SELECT * INTO v_grant FROM app.role_grant WHERE user_id=v_rate.actor_id FOR SHARE;
 IF v_user.id IS NULL OR NOT v_user.email_verified OR NOT v_user.two_factor_enabled
    OR v_session.id IS NULL OR v_session.expires_at<=clock_timestamp() OR v_mfa.session_id IS NULL
    OR v_mfa.verified_at<=clock_timestamp()-interval '5 minutes' OR NOT coalesce('owner'=ANY(v_grant.roles),false)
 THEN RAISE EXCEPTION 'Rate commit rechecks current verified owner session and fresh MFA after waits' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_proof FROM app.access_proof WHERE digest=v_rate.proof_digest FOR SHARE;
 IF v_proof.digest IS NULL OR v_proof.session_id IS DISTINCT FROM v_rate.session_id
    OR v_proof.action<>'affiliate_rate.version' OR v_proof.subject_id IS DISTINCT FROM v_rate.affiliate_id::text
    OR v_proof.consumed_at IS NULL OR v_proof.consumed_at<v_rate.created_at
    OR v_proof.expires_at<=v_proof.consumed_at OR v_proof.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'Rate commits its exact current session/affiliate-bound fresh consumed proof' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_operation FROM app.access_operation WHERE id=v_rate.operation_id;
 IF v_operation.id IS NULL OR v_operation.actor_id IS DISTINCT FROM v_rate.actor_id OR v_operation.action<>'affiliate_rate.append'
    OR v_operation.key!~'^[A-Za-z0-9_-]{16,200}$' OR v_operation.request_hash!~'^[a-f0-9]{64}$'
    OR v_operation.response IS DISTINCT FROM jsonb_build_object('id',v_rate.id,'affiliate_id',v_rate.affiliate_id,
      'basis_points',v_rate.basis_points,'version',v_rate.revision,
      'effective_at',to_char(v_rate.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 THEN RAISE EXCEPTION 'Rate commits the immutable actual owner retry response' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.actor_id=v_rate.actor_id AND a.action='affiliate_rate.version'
    AND a.subject_id=v_rate.affiliate_id::text AND a.outcome='allowed' AND a.reason=v_rate.reason AND a.created_at>=v_rate.created_at
    AND a.details->>'operation_id'=v_rate.operation_id::text AND a.details->>'version_id'=v_rate.id::text
    AND a.details->>'version'=v_rate.revision::text AND a.details->>'basis_points'=v_rate.basis_points::text)
 THEN RAISE EXCEPTION 'Rate commits its actual version, author and audit' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_affiliate_rate_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_affiliate_rate_version(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER affiliate_rate_version_sealed AFTER INSERT ON app.affiliate_rate_version
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_affiliate_rate_version();
--> statement-breakpoint
CREATE FUNCTION app.seal_affiliate_rate_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_count bigint; v_max integer; v_revision integer;
BEGIN
 SELECT rate_revision INTO v_revision FROM app.affiliate_account WHERE id=NEW.id;
 SELECT count(*),coalesce(max(revision),0) INTO v_count,v_max FROM app.affiliate_rate_version WHERE affiliate_id=NEW.id;
 IF v_revision IS NULL OR v_count<>v_revision OR v_max<>v_revision
 THEN RAISE EXCEPTION 'Affiliate rate head retains its complete contiguous immutable stream' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER affiliate_rate_head_sealed AFTER INSERT OR UPDATE ON app.affiliate_account
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_affiliate_rate_head();
--> statement-breakpoint
CREATE FUNCTION app.guard_affiliate_rate_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rate app.affiliate_rate_version;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.action='affiliate_rate.append' THEN RAISE EXCEPTION 'Committed rate retry responses are retained' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 ELSIF TG_OP='UPDATE' THEN
  IF OLD.action='affiliate_rate.append' OR NEW.action='affiliate_rate.append'
  THEN RAISE EXCEPTION 'Rate operation identity and response are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 ELSIF NEW.action<>'affiliate_rate.append' THEN RETURN NEW;
 END IF;
 SELECT * INTO v_rate FROM app.affiliate_rate_version WHERE operation_id=NEW.id;
 IF v_rate.id IS NULL OR v_rate.created_xid<>pg_current_xact_id()::text OR v_rate.actor_id IS DISTINCT FROM NEW.actor_id
 THEN RAISE EXCEPTION 'Rate retry identity is inserted with its exact creating version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER affiliate_rate_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.access_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_affiliate_rate_operation();

--> statement-breakpoint
CREATE FUNCTION app.assert_replacement_actor(p_operation uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_op app.replacement_operation; v_head app.replacement_shipment; v_user app.auth_user;
 v_session app.auth_session; v_grant app.role_grant; v_mfa app.mfa_session; v_owner boolean; v_warehouse uuid;
BEGIN
 SELECT * INTO v_op FROM app.replacement_operation WHERE id=p_operation;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_op.subject_id AND case_id=v_op.case_id;
 SELECT * INTO v_user FROM app.auth_user WHERE id=v_op.actor_id FOR UPDATE;
 SELECT * INTO v_session FROM app.auth_session WHERE id=v_op.session_id AND user_id=v_user.id FOR SHARE;
 SELECT * INTO v_grant FROM app.role_grant WHERE user_id=v_user.id FOR SHARE;
 SELECT * INTO v_mfa FROM app.mfa_session WHERE session_id=v_session.id FOR SHARE;
 v_owner:=coalesce('owner'=ANY(v_grant.roles),false);
 IF v_op.id IS NULL OR v_head.id IS NULL OR v_user.id IS NULL OR NOT v_user.email_verified OR NOT v_user.two_factor_enabled
    OR v_session.id IS NULL OR v_session.expires_at<=clock_timestamp() OR v_mfa.session_id IS NULL
    OR v_op.action NOT IN ('create','reserve','prepare','book','handover')
    OR (NOT v_owner AND NOT coalesce((CASE WHEN v_op.action IN ('create','reserve') THEN 'customer_service' ELSE 'warehouse' END)=ANY(v_grant.roles),false))
 THEN RAISE EXCEPTION 'Replacement action requires its current verified operational role, session and MFA' USING ERRCODE='23514'; END IF;
 FOR v_warehouse IN
  SELECT v_head.warehouse_id
  UNION SELECT coalesce(parcel.warehouse_id,original.warehouse_id) FROM app.return_item r
   JOIN app.fulfillment_item f ON f.id=r.fulfillment_item_id JOIN app.order_shipment original ON original.id=f.shipment_id
   LEFT JOIN app.replacement_link link ON link.id=r.replacement_link_id LEFT JOIN app.replacement_shipment parcel ON parcel.id=link.shipment_id
   WHERE r.case_id=v_op.case_id AND v_op.action IN ('create','reserve')
  ORDER BY 1
 LOOP
  IF NOT v_owner THEN
   PERFORM w.id FROM app.warehouse_membership m JOIN app.warehouse w ON w.id=m.warehouse_id
    WHERE m.user_id=v_op.actor_id AND w.id=v_warehouse AND w.active FOR SHARE OF m,w;
   IF NOT FOUND THEN RAISE EXCEPTION 'Replacement operator requires every affected current physical warehouse' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 PERFORM id FROM app.warehouse WHERE id=v_head.warehouse_id AND active FOR SHARE;
 IF NOT FOUND OR v_session.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'Replacement origin and current session remain valid after scope waits' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_order_id uuid; v_order app.commerce_order;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Replacement operations and immutable retries are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.created_xid<>pg_current_xact_id()::text OR OLD.response<>'{}'::jsonb OR NEW.response='{}'::jsonb
     OR (to_jsonb(NEW)-'response') IS DISTINCT FROM (to_jsonb(OLD)-'response')
  THEN RAISE EXCEPTION 'Replacement response finalizes once in its creating transaction' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 PERFORM id FROM app.auth_user WHERE id=NEW.actor_id FOR UPDATE;
 SELECT order_id INTO v_order_id FROM app.return_case WHERE id=NEW.case_id;
 PERFORM n.name FROM app.local_fixture_namespace n JOIN app.commerce_order o ON o.clock_namespace=n.name WHERE o.id=v_order_id FOR SHARE OF n;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_order_id FOR UPDATE;
 PERFORM id FROM app.return_case WHERE id=NEW.case_id FOR UPDATE;
 IF v_order.id IS NULL OR NEW.response<>'{}'::jsonb OR NEW.action NOT IN ('create','reserve','prepare','book','handover')
    OR NEW.key!~'^[A-Za-z0-9_-]{16,200}$'
 THEN RAISE EXCEPTION 'New replacement command requires its exact original case and empty result' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp(); NEW.created_xid:=pg_current_xact_id()::text;
 NEW.occurred_at:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace)); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.replacement_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_operation();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_op app.replacement_operation; v_case app.return_case;
 v_claim app.return_item; v_predecessor app.replacement_link; v_original_order uuid;
BEGIN
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=NEW.shipment_id FOR UPDATE;
 SELECT * INTO v_op FROM app.replacement_operation WHERE id=v_head.operation_id;
 SELECT * INTO v_case FROM app.return_case WHERE id=v_head.case_id;
 SELECT * INTO v_claim FROM app.return_item WHERE id=NEW.return_item_id AND case_id=v_head.case_id;
 SELECT i.order_id INTO v_original_order FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.id=NEW.original_fulfillment_item_id FOR UPDATE OF f;
 SELECT * INTO v_predecessor FROM app.replacement_link WHERE id=NEW.predecessor_id;
 IF v_head.id IS NULL OR v_head.revision<>1 OR v_head.status<>'awaiting_stock' OR v_head.stock_reservation_id IS NOT NULL
    OR v_op.id IS NULL OR v_op.action<>'create' OR v_op.created_xid<>pg_current_xact_id()::text OR v_op.response<>'{}'::jsonb
    OR v_case.resolution IS DISTINCT FROM 'replacement' OR v_case.status<>'replacing'
    OR v_claim.id IS NULL OR v_claim.claim_state<>'held' OR v_claim.inspection_status NOT IN ('accepted','waived')
    OR v_claim.fulfillment_item_id IS DISTINCT FROM NEW.original_fulfillment_item_id OR v_original_order IS DISTINCT FROM v_case.order_id
    OR NEW.predecessor_id IS DISTINCT FROM v_claim.replacement_link_id
    OR (NEW.predecessor_id IS NULL AND NEW.generation<>1)
    OR (NEW.predecessor_id IS NOT NULL AND (v_predecessor.id IS NULL OR v_predecessor.original_fulfillment_item_id IS DISTINCT FROM NEW.original_fulfillment_item_id
      OR NEW.generation::bigint<>v_predecessor.generation::bigint+1
      OR NOT EXISTS(SELECT 1 FROM app.replacement_buyer_receipt WHERE replacement_link_id=v_predecessor.id)))
    OR EXISTS(SELECT 1 FROM app.replacement_link WHERE original_fulfillment_item_id=NEW.original_fulfillment_item_id AND generation>=NEW.generation)
    OR EXISTS(SELECT 1 FROM app.fulfillment_item WHERE id=NEW.id)
    OR EXISTS(SELECT 1 FROM app.refund_allocation a JOIN app.return_item r ON r.id=a.return_item_id WHERE r.fulfillment_item_id=NEW.original_fulfillment_item_id)
 THEN RAISE EXCEPTION 'Replacement lineage extends one approved received physical occurrence without branching or another financial entitlement' USING ERRCODE='23514'; END IF;
 NEW.created_at:=v_head.created_at; RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_link_guard BEFORE INSERT ON app.replacement_link
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_link();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_component() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_balance app.inventory_balance;
BEGIN
 SELECT s.* INTO v_head FROM app.replacement_link link JOIN app.replacement_shipment s ON s.id=link.shipment_id
  WHERE link.id=NEW.replacement_link_id FOR UPDATE OF s;
 SELECT * INTO v_balance FROM app.inventory_balance WHERE id=NEW.balance_id FOR UPDATE;
 IF v_head.id IS NULL OR v_head.status<>'awaiting_stock' OR v_head.stock_reservation_id IS NOT NULL
    OR v_balance.stock_item_id IS DISTINCT FROM NEW.stock_item_id OR v_balance.warehouse_id IS DISTINCT FROM v_head.warehouse_id
    OR NOT EXISTS(SELECT 1 FROM app.replacement_operation op WHERE op.subject_id=v_head.id AND op.case_id=v_head.case_id
      AND op.action IN ('create','reserve') AND op.created_xid=pg_current_xact_id()::text AND op.response='{}'::jsonb)
    OR NOT EXISTS(SELECT 1 FROM app.replacement_link link JOIN app.fulfillment_item f ON f.id=link.original_fulfillment_item_id
      JOIN app.order_item i ON i.id=f.order_item_id JOIN app.offer_component c ON c.product_id=i.product_id AND c.revision=i.product_revision AND c.offer_id=i.offer_id
      WHERE link.id=NEW.replacement_link_id AND c.stock_item_id=NEW.stock_item_id)
 THEN RAISE EXCEPTION 'Replacement stock uses original frozen offer contents and actual new-origin balances in its current reserve attempt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_component_guard BEFORE INSERT ON app.replacement_component_allocation
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_component();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_shipment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_op app.replacement_operation; v_case app.return_case; v_order app.commerce_order; v_event app.replacement_event;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original replacement physical history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_op FROM app.replacement_operation WHERE id=NEW.operation_id;
  SELECT * INTO v_case FROM app.return_case WHERE id=NEW.case_id;
  SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
  IF v_op.id IS NULL OR v_op.action<>'create' OR v_op.subject_id IS DISTINCT FROM NEW.id OR v_op.case_id IS DISTINCT FROM NEW.case_id
     OR v_op.created_xid<>pg_current_xact_id()::text OR v_op.response<>'{}'::jsonb
     OR v_case.resolution IS DISTINCT FROM 'replacement' OR v_case.status<>'replacing'
     OR NEW.revision<>1 OR NEW.status<>'awaiting_stock' OR NEW.stock_reservation_id IS NOT NULL OR NEW.booking_id IS NOT NULL
     OR NEW.prepared_at IS NOT NULL OR NEW.waybill_issued_at IS NOT NULL OR NEW.tracking_number IS NOT NULL
     OR NEW.handover_at IS NOT NULL OR NEW.handover_reference IS NOT NULL OR NEW.packing_due_at IS NOT NULL OR NEW.calendar_snapshot IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM app.warehouse WHERE id=NEW.warehouse_id AND active)
     OR (v_order.clock_namespace IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.local_fixture_warehouse WHERE namespace=v_order.clock_namespace AND warehouse_id=NEW.warehouse_id))
  THEN RAISE EXCEPTION 'A zero-charge replacement starts as the original approved recoverable physical intent' USING ERRCODE='23514'; END IF;
  NEW.created_at:=v_op.occurred_at; NEW.recorded_at:=clock_timestamp(); RETURN NEW;
 END IF;
 SELECT * INTO v_event FROM app.replacement_event WHERE shipment_id=OLD.id AND revision=OLD.revision+1;
 IF v_event.id IS NULL OR NEW.revision::bigint<>OLD.revision::bigint+1 OR to_jsonb(NEW) IS DISTINCT FROM v_event.snapshot
 THEN RAISE EXCEPTION 'Replacement head applies exactly one complete native event image' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_shipment_guard BEFORE INSERT OR UPDATE OR DELETE ON app.replacement_shipment
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_shipment();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_next app.replacement_shipment; v_case app.return_case; v_order app.commerce_order;
 v_op app.replacement_operation; v_booking app.replacement_booking; v_job app.outbox_job; v_provider app.local_replacement_event;
 v_provider_op app.local_replacement_operation; v_receipt app.local_replacement_receipt; v_hold app.stock_reservation;
 v_fields text[]:=ARRAY['revision','status']; v_calendar app.policy_version; v_due timestamptz; v_calendar_json jsonb;
BEGIN
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=NEW.shipment_id FOR UPDATE;
 SELECT * INTO v_case FROM app.return_case WHERE id=v_head.case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
 IF v_head.id IS NULL OR (NEW.kind='create' AND (NEW.revision<>1 OR v_head.revision<>1
     OR EXISTS(SELECT 1 FROM app.replacement_event WHERE shipment_id=v_head.id)))
    OR (NEW.kind<>'create' AND NEW.revision::bigint<>v_head.revision::bigint+1)
    OR jsonb_typeof(NEW.snapshot)<>'object'
    OR (NEW.snapshot-ARRAY(SELECT jsonb_object_keys(to_jsonb(v_head))))<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Replacement event appends one exact current physical revision' USING ERRCODE='23514'; END IF;
 v_next:=jsonb_populate_record(NULL::app.replacement_shipment,NEW.snapshot);
 IF v_next.revision IS DISTINCT FROM NEW.revision OR v_next.status IS DISTINCT FROM NEW.status
 THEN RAISE EXCEPTION 'Replacement event state and typed head image agree' USING ERRCODE='23514'; END IF;
 IF NEW.source_kind='operation' THEN
  SELECT * INTO v_op FROM app.replacement_operation WHERE id=NEW.source_id;
  IF v_op.id IS NULL OR v_op.created_xid<>pg_current_xact_id()::text OR v_op.response<>'{}'::jsonb
     OR v_op.subject_id IS DISTINCT FROM v_head.id OR v_op.case_id IS DISTINCT FROM v_head.case_id OR v_op.actor_id IS DISTINCT FROM NEW.actor_id
     OR NOT ((NEW.kind IN ('create','reserve','stock_wait') AND v_op.action='create')
          OR (NEW.kind IN ('reserve','stock_wait') AND v_op.action='reserve') OR NEW.kind=v_op.action AND NEW.kind IN ('prepare','book','handover'))
  THEN RAISE EXCEPTION 'Replacement event requires its unfinished exact current staff command' USING ERRCODE='23514'; END IF;
  PERFORM app.assert_replacement_actor(v_op.id);
  IF NEW.kind='reserve' THEN PERFORM id FROM app.policy_head WHERE kind='warehouse_calendar' AND warehouse_id=v_head.warehouse_id FOR SHARE; END IF;
  NEW.occurred_at:=CASE WHEN NEW.kind='create' THEN v_head.created_at ELSE date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace)) END;
 ELSIF NEW.source_kind='job' THEN
  SELECT * INTO v_booking FROM app.replacement_booking WHERE id=v_head.booking_id;
  SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.source_id FOR SHARE;
  IF NEW.kind<>'unknown' OR NEW.actor_id IS NOT NULL OR v_booking.status IS DISTINCT FROM 'unknown' OR v_booking.creation_job_id IS DISTINCT FROM v_job.id
     OR v_job.kind IS DISTINCT FROM 'replacement.shipping.create' OR v_job.status IS DISTINCT FROM 'processing'
     OR v_job.lease_token IS NULL OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('bookingId',v_booking.id)
     OR v_job.dedup_key IS DISTINCT FROM 'replacement-shipping-create:'||v_booking.id::text
  THEN RAISE EXCEPTION 'Unknown replacement acknowledgement retains its current fenced original source job' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
 ELSIF NEW.source_kind='provider' THEN
  SELECT * INTO v_provider FROM app.local_replacement_event WHERE id=NEW.source_id;
  SELECT * INTO v_provider_op FROM app.local_replacement_operation WHERE id=v_provider.operation_id;
  SELECT * INTO v_booking FROM app.replacement_booking WHERE id=v_provider_op.booking_id;
  SELECT job.* INTO v_job FROM app.replacement_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_provider.id;
  IF v_provider.id IS NULL OR NEW.actor_id IS NOT NULL OR v_booking.id IS DISTINCT FROM v_head.booking_id
     OR v_booking.provider_operation_id IS DISTINCT FROM v_provider_op.id OR v_provider_op.clock_namespace IS DISTINCT FROM v_order.clock_namespace
     OR v_provider_op.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
     OR v_provider.status IS DISTINCT FROM v_provider_op.status OR v_provider.occurred_at IS DISTINCT FROM v_provider_op.terminal_at
     OR NEW.kind IS DISTINCT FROM (CASE v_provider.status WHEN 'issued' THEN 'waybill_issued' WHEN 'failed' THEN 'waybill_failed' ELSE NULL END)
     OR v_job.id IS NULL OR v_job.kind<>'replacement.shipping.callback' OR v_job.status<>'pending'
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_provider.id)
     OR EXISTS(SELECT 1 FROM app.replacement_event_result WHERE event_id=v_provider.id)
  THEN RAISE EXCEPTION 'Replacement waybill transition retains its exact registered local terminal source and pending callback' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=v_provider.occurred_at;
 ELSIF NEW.source_kind='receipt' THEN
  SELECT * INTO v_receipt FROM app.local_replacement_receipt WHERE id=NEW.source_id;
  SELECT job.* INTO v_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_receipt.id;
  IF NEW.kind<>'receipt' OR NEW.actor_id IS NOT NULL OR v_receipt.id IS NULL OR v_receipt.shipment_id IS DISTINCT FROM v_head.id
     OR v_receipt.booking_id IS DISTINCT FROM v_head.booking_id OR v_receipt.clock_namespace IS DISTINCT FROM v_order.clock_namespace
     OR v_receipt.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
     OR v_job.id IS NULL OR v_job.kind<>'replacement.receipt.callback' OR v_job.status<>'pending'
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_receipt.id)
     OR EXISTS(SELECT 1 FROM app.replacement_receipt_result WHERE event_id=v_receipt.id)
  THEN RAISE EXCEPTION 'Replacement receipt transition retains its exact registered actual occurrence evidence' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=v_receipt.occurred_at;
 ELSE RAISE EXCEPTION 'Unsupported replacement source' USING ERRCODE='23514'; END IF;
 IF NEW.occurred_at<v_head.created_at OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace)
 THEN RAISE EXCEPTION 'Replacement event retains its actual bounded source time' USING ERRCODE='23514'; END IF;

 CASE NEW.kind
 WHEN 'create' THEN
  IF NEW.status<>'awaiting_stock' OR v_head.status<>'awaiting_stock' OR NEW.source_id IS DISTINCT FROM v_head.operation_id
  THEN RAISE EXCEPTION 'Replacement creation starts its recoverable intent' USING ERRCODE='23514'; END IF;
 WHEN 'reserve' THEN
  v_fields:=v_fields||ARRAY['stock_reservation_id','packing_due_at','calendar_snapshot'];
  SELECT * INTO v_hold FROM app.stock_reservation WHERE id=v_next.stock_reservation_id;
  IF v_head.status<>'awaiting_stock' OR NEW.status<>'ready' OR v_head.stock_reservation_id IS NOT NULL
     OR v_hold.id IS NULL OR v_hold.kind<>'replacement' OR v_hold.status<>'preparing' OR v_hold.expires_at IS NOT NULL
     OR v_hold.key IS DISTINCT FROM 'replacement:'||v_head.id::text OR v_hold.clock_namespace IS DISTINCT FROM v_order.clock_namespace
     OR jsonb_typeof(v_next.calendar_snapshot) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Replacement ready state requires its complete non-expiring physical reserve and operational calendar' USING ERRCODE='23514'; END IF;
  v_calendar_json:=v_next.calendar_snapshot;
  SELECT p.* INTO v_calendar FROM app.policy_version p JOIN app.policy_head h ON h.id=p.head_id
   WHERE h.kind='warehouse_calendar' AND h.warehouse_id=v_head.warehouse_id AND p.effective_at<=NEW.occurred_at
   ORDER BY p.effective_at DESC,p.revision DESC LIMIT 1;
  IF v_calendar.id IS NULL OR v_calendar_json->>'calendar_version_id' IS DISTINCT FROM v_calendar.id::text
     OR v_calendar_json->'calendar' IS DISTINCT FROM v_calendar.values
     OR v_calendar_json->'calendar_coverage'->0->>'id' IS DISTINCT FROM v_calendar.id::text
     OR v_calendar_json->>'warehouse_id' IS DISTINCT FROM v_head.warehouse_id::text
  THEN RAISE EXCEPTION 'Replacement calendar freezes the actual effective warehouse policy' USING ERRCODE='23514'; END IF;
  v_due:=app.shipping_calendar_due(v_head.warehouse_id,v_calendar_json->'calendar_coverage',NEW.occurred_at,2);
  v_next.packing_due_at:=v_due;
  v_next.calendar_snapshot:=v_calendar_json||jsonb_build_object('anchor',NEW.occurred_at,'actionable_at',NEW.occurred_at,
   'packing_due_at',v_due,'packing_local_date',(v_due AT TIME ZONE (v_calendar.values->>'timezone'))::date::text);
 WHEN 'stock_wait' THEN
  IF v_head.status<>'awaiting_stock' OR NEW.status<>'awaiting_stock' OR v_head.stock_reservation_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM app.replacement_component_allocation a JOIN app.replacement_link link ON link.id=a.replacement_link_id WHERE link.shipment_id=v_head.id)
  THEN RAISE EXCEPTION 'Stock recovery retains the same intent without a partial reserve' USING ERRCODE='23514'; END IF;
 WHEN 'prepare' THEN
  v_fields:=v_fields||ARRAY['prepared_at'];
  IF v_head.status<>'ready' OR NEW.status<>'picking' OR v_head.prepared_at IS NOT NULL OR v_head.stock_reservation_id IS NULL
  THEN RAISE EXCEPTION 'Replacement physical preparation requires a complete ready reserve' USING ERRCODE='23514'; END IF;
  v_next.prepared_at:=NEW.occurred_at;
 WHEN 'book' THEN
  v_fields:=v_fields||ARRAY['booking_id'];
  SELECT * INTO v_booking FROM app.replacement_booking WHERE id=v_next.booking_id;
  IF v_head.status NOT IN ('picking','booking_failed') OR NEW.status<>'booking_pending' OR v_head.prepared_at IS NULL
     OR v_booking.id IS NULL OR v_booking.shipment_id IS DISTINCT FROM v_head.id OR v_booking.operation_id IS DISTINCT FROM v_op.id OR v_booking.status<>'queued'
     OR (v_head.booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.replacement_booking b JOIN app.local_replacement_operation op ON op.id=b.provider_operation_id
       JOIN app.local_replacement_event e ON e.operation_id=op.id JOIN app.replacement_event_result result ON result.event_id=e.id
       WHERE b.id=v_head.booking_id AND b.status='failed' AND op.status='failed' AND e.status='failed' AND result.outcome='failed'))
  THEN RAISE EXCEPTION 'Replacement booking follows preparation or an authenticated terminal original failure' USING ERRCODE='23514'; END IF;
 WHEN 'unknown' THEN
  IF v_head.status<>'booking_pending' OR NEW.status<>'booking_unknown'
  THEN RAISE EXCEPTION 'Unknown acknowledgement preserves its existing booking' USING ERRCODE='23514'; END IF;
 WHEN 'waybill_issued' THEN
  v_fields:=v_fields||ARRAY['waybill_issued_at','tracking_number'];
  IF v_head.status NOT IN ('booking_pending','booking_unknown') OR NEW.status<>'packed' OR v_head.prepared_at IS NULL OR v_provider.tracking_number IS NULL
  THEN RAISE EXCEPTION 'A replacement is packed only with its original usable waybill evidence' USING ERRCODE='23514'; END IF;
  v_next.waybill_issued_at:=NEW.occurred_at; v_next.tracking_number:=v_provider.tracking_number;
 WHEN 'waybill_failed' THEN
  IF v_head.status NOT IN ('booking_pending','booking_unknown') OR NEW.status<>'booking_failed' OR v_head.waybill_issued_at IS NOT NULL
  THEN RAISE EXCEPTION 'Replacement booking failure retains its actual original terminal outcome' USING ERRCODE='23514'; END IF;
 WHEN 'handover' THEN
  v_fields:=v_fields||ARRAY['handover_at','handover_reference'];
  IF v_head.status<>'packed' OR NEW.status<>'handed_over' OR v_head.prepared_at IS NULL OR v_head.waybill_issued_at IS NULL
     OR v_head.tracking_number IS NULL OR v_next.handover_reference IS NULL OR char_length(btrim(v_next.handover_reference))=0
     OR NEW.occurred_at<v_head.prepared_at OR NEW.occurred_at<v_head.waybill_issued_at
  THEN RAISE EXCEPTION 'Replacement handover is separate from preparation and usable tracking' USING ERRCODE='23514'; END IF;
  v_next.handover_at:=NEW.occurred_at;
 WHEN 'receipt' THEN
  IF v_head.status NOT IN ('handed_over','partially_delivered') OR NEW.status NOT IN ('partially_delivered','delivered')
     OR v_head.handover_at IS NULL OR NEW.occurred_at<v_head.handover_at
     OR NOT EXISTS(SELECT 1 FROM app.replacement_buyer_receipt WHERE source_id=v_receipt.id)
  THEN RAISE EXCEPTION 'Replacement receipt advances only actually received units after handover' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported replacement transition' USING ERRCODE='23514'; END CASE;
 IF (to_jsonb(v_next)-v_fields) IS DISTINCT FROM (to_jsonb(v_head)-v_fields)
 THEN RAISE EXCEPTION 'Replacement event cannot rewrite another milestone or original physical identity' USING ERRCODE='23514'; END IF;
 NEW.snapshot:=to_jsonb(v_next); NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_event_guard BEFORE INSERT ON app.replacement_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_event();

--> statement-breakpoint
CREATE FUNCTION app.assert_replacement_shipment(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_case app.return_case; v_order app.commerce_order; v_event app.replacement_event;
 v_create app.replacement_event; v_hold app.stock_reservation; v_link app.replacement_link; v_claim app.return_item;
 v_links int; v_received int; v_booking app.replacement_booking;
BEGIN
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=p_id FOR UPDATE;
 SELECT * INTO v_case FROM app.return_case WHERE id=v_head.case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
 SELECT * INTO v_event FROM app.replacement_event WHERE shipment_id=p_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO v_create FROM app.replacement_event WHERE shipment_id=p_id AND kind='create';
 SELECT count(*) INTO v_links FROM app.replacement_link WHERE shipment_id=p_id;
 IF v_head.id IS NULL OR v_links NOT BETWEEN 1 AND 100 OR v_event.id IS NULL OR v_create.id IS NULL
    OR v_event.snapshot IS DISTINCT FROM to_jsonb(v_head) OR v_event.revision IS DISTINCT FROM v_head.revision
    OR (SELECT count(*) FROM app.replacement_event WHERE shipment_id=p_id)<>v_head.revision
    OR v_create.revision<>1 OR v_create.source_kind<>'operation' OR v_create.source_id IS DISTINCT FROM v_head.operation_id
    OR NOT EXISTS(SELECT 1 FROM app.return_event e WHERE e.case_id=v_head.case_id AND e.kind='replacement_started'
      AND e.source_kind='replacement' AND e.source_id=v_create.id)
 THEN RAISE EXCEPTION 'Replacement seals exact contiguous physical history and original case initiation' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.replacement_event e LEFT JOIN app.replacement_event_result result ON result.replacement_event_id=e.id
    WHERE e.shipment_id=p_id AND e.source_kind='provider' AND (result.event_id IS NULL OR result.event_id IS DISTINCT FROM e.source_id
      OR result.shipment_id IS DISTINCT FROM p_id OR result.revision IS DISTINCT FROM e.revision))
 THEN RAISE EXCEPTION 'Replacement provider transitions commit only with their exact terminal result' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  SELECT 1 FROM app.replacement_link link FULL JOIN (
   SELECT h.return_item_id FROM app.return_item_event h JOIN app.return_event e ON e.id=h.event_id
    WHERE e.source_kind='replacement' AND e.source_id=v_create.id AND e.kind='replacement_started'
  ) changed ON changed.return_item_id=link.return_item_id
  WHERE (link.shipment_id=p_id OR changed.return_item_id IS NOT NULL)
    AND (link.id IS NULL OR link.shipment_id IS DISTINCT FROM p_id OR changed.return_item_id IS NULL)
 ) THEN RAISE EXCEPTION 'Replacement initiation changes exactly the selected original claim set' USING ERRCODE='23514'; END IF;
 FOR v_link IN SELECT * FROM app.replacement_link WHERE shipment_id=p_id ORDER BY id LOOP
  SELECT * INTO v_claim FROM app.return_item WHERE id=v_link.return_item_id;
  IF v_claim.case_id IS DISTINCT FROM v_head.case_id OR v_claim.fulfillment_item_id IS DISTINCT FROM v_link.original_fulfillment_item_id
     OR v_claim.replacement_link_id IS DISTINCT FROM v_link.predecessor_id
     OR v_claim.claim_state IS DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM app.replacement_buyer_receipt WHERE replacement_link_id=v_link.id) THEN 'replaced' ELSE 'replacing' END)
  THEN RAISE EXCEPTION 'Replacement receipt and claim state preserve the exact affected physical chain' USING ERRCODE='23514'; END IF;
  IF v_head.status<>'awaiting_stock' AND EXISTS(
   WITH required AS (
    SELECT c.stock_item_id,c.quantity::bigint quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
     JOIN app.offer_component c ON c.product_id=i.product_id AND c.revision=i.product_revision AND c.offer_id=i.offer_id
     WHERE f.id=v_link.original_fulfillment_item_id
   ), allocated AS (
    SELECT stock_item_id,sum(quantity::bigint) quantity FROM app.replacement_component_allocation WHERE replacement_link_id=v_link.id GROUP BY stock_item_id
   ) SELECT 1 FROM required r FULL JOIN allocated a USING(stock_item_id) WHERE r.quantity IS DISTINCT FROM a.quantity
  ) THEN RAISE EXCEPTION 'Every replacement contains exactly one complete frozen original offer' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF v_head.status='awaiting_stock' THEN
  IF v_head.stock_reservation_id IS NOT NULL OR v_head.prepared_at IS NOT NULL OR v_head.booking_id IS NOT NULL
     OR v_head.waybill_issued_at IS NOT NULL OR v_head.handover_at IS NOT NULL OR v_head.calendar_snapshot IS NOT NULL OR v_head.packing_due_at IS NOT NULL
     OR EXISTS(SELECT 1 FROM app.replacement_component_allocation a JOIN app.replacement_link link ON link.id=a.replacement_link_id WHERE link.shipment_id=p_id)
  THEN RAISE EXCEPTION 'Unavailable replacement stock leaves an explicit intent without partial physical effects' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_hold FROM app.stock_reservation WHERE id=v_head.stock_reservation_id;
  IF v_hold.id IS NULL OR v_hold.kind<>'replacement' OR v_hold.expires_at IS NOT NULL
     OR v_hold.key IS DISTINCT FROM 'replacement:'||p_id::text OR v_hold.clock_namespace IS DISTINCT FROM v_order.clock_namespace
     OR v_hold.status IS DISTINCT FROM (CASE WHEN v_head.handover_at IS NULL THEN 'active' ELSE 'consumed' END)
     OR v_head.calendar_snapshot IS NULL OR v_head.packing_due_at IS NULL
  THEN RAISE EXCEPTION 'Replacement owns a non-expiring complete physical reservation and frozen calendar' USING ERRCODE='23514'; END IF;
  IF EXISTS(
   WITH allocated AS (
    SELECT a.balance_id,sum(a.quantity::bigint) quantity FROM app.replacement_component_allocation a
     JOIN app.replacement_link link ON link.id=a.replacement_link_id WHERE link.shipment_id=p_id GROUP BY a.balance_id
   ), held AS (SELECT balance_id,quantity::bigint quantity FROM app.stock_reservation_component WHERE reservation_id=v_hold.id)
   SELECT 1 FROM allocated a FULL JOIN held h USING(balance_id) LEFT JOIN app.inventory_balance b ON b.id=coalesce(a.balance_id,h.balance_id)
   WHERE a.quantity IS DISTINCT FROM h.quantity OR b.warehouse_id IS DISTINCT FROM v_head.warehouse_id
  ) THEN RAISE EXCEPTION 'Replacement allocations consume every exact original held physical balance once' USING ERRCODE='23514'; END IF;
 END IF;
 IF ((v_head.waybill_issued_at IS NULL) IS DISTINCT FROM (v_head.tracking_number IS NULL))
    OR ((v_head.handover_at IS NULL) IS DISTINCT FROM (v_head.handover_reference IS NULL))
    OR (v_head.status NOT IN ('awaiting_stock','ready') AND v_head.prepared_at IS NULL)
    OR ((v_head.status IN ('awaiting_stock','ready')) AND v_head.prepared_at IS NOT NULL)
    OR ((v_head.status IN ('booking_pending','booking_unknown','booking_failed','packed','handed_over','partially_delivered','delivered')) IS DISTINCT FROM (v_head.booking_id IS NOT NULL))
    OR ((v_head.status IN ('packed','handed_over','partially_delivered','delivered')) IS DISTINCT FROM (v_head.waybill_issued_at IS NOT NULL AND v_head.tracking_number IS NOT NULL))
    OR ((v_head.status IN ('handed_over','partially_delivered','delivered')) IS DISTINCT FROM (v_head.handover_at IS NOT NULL AND v_head.handover_reference IS NOT NULL))
 THEN RAISE EXCEPTION 'Replacement preparation, booking, usable waybill and physical handover remain distinct milestones' USING ERRCODE='23514'; END IF;
 IF v_head.booking_id IS NOT NULL THEN
  SELECT * INTO v_booking FROM app.replacement_booking WHERE id=v_head.booking_id;
  IF v_booking.id IS NULL OR v_booking.shipment_id IS DISTINCT FROM p_id
     OR v_booking.attempt IS DISTINCT FROM (SELECT max(attempt) FROM app.replacement_booking WHERE shipment_id=p_id)
     OR (v_head.status='booking_pending' AND v_booking.status NOT IN ('queued','processing'))
     OR (v_head.status='booking_unknown' AND v_booking.status<>'unknown')
     OR (v_head.status='booking_failed' AND v_booking.status<>'failed')
     OR (v_head.waybill_issued_at IS NOT NULL AND v_booking.status<>'issued')
  THEN RAISE EXCEPTION 'Replacement retains its latest exact booking and authenticated milestone outcome' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT count(*) INTO v_received FROM app.replacement_buyer_receipt receipt JOIN app.replacement_link link ON link.id=receipt.replacement_link_id WHERE link.shipment_id=p_id;
 IF (v_head.status='delivered' AND v_received<>v_links)
    OR (v_head.status='partially_delivered' AND v_received NOT BETWEEN 1 AND v_links-1)
    OR (v_head.status NOT IN ('delivered','partially_delivered') AND v_received<>0)
 THEN RAISE EXCEPTION 'Only actual affected-unit buyer receipts establish replacement delivery progress' USING ERRCODE='23514'; END IF;
 IF v_head.handover_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM app.stock_reservation_component c WHERE c.reservation_id=v_head.stock_reservation_id
   AND c.quantity IS DISTINCT FROM (SELECT sum(m.quantity) FROM app.stock_movement m JOIN app.replacement_event event
     ON m.source_ref='replacement-handover:'||event.id::text AND event.kind='handover'
     WHERE event.shipment_id=p_id AND m.balance_id=c.balance_id AND m.kind='consume')
 ) THEN RAISE EXCEPTION 'Replacement handover consumes every reserved component exactly once' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_replacement_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
 IF TG_TABLE_NAME='replacement_shipment' THEN v_id:=NEW.id;
 ELSIF TG_TABLE_NAME='replacement_component_allocation' THEN SELECT shipment_id INTO v_id FROM app.replacement_link WHERE id=NEW.replacement_link_id;
 ELSIF TG_TABLE_NAME='stock_reservation' THEN SELECT id INTO v_id FROM app.replacement_shipment WHERE stock_reservation_id=NEW.id;
 ELSE v_id:=NEW.shipment_id; END IF;
 PERFORM app.assert_replacement_shipment(v_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_shipment_sealed AFTER INSERT OR UPDATE ON app.replacement_shipment
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_head();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_event_sealed AFTER INSERT ON app.replacement_event
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_head();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_link_sealed AFTER INSERT ON app.replacement_link
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_head();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_component_sealed AFTER INSERT ON app.replacement_component_allocation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_head();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_stock_sealed AFTER INSERT OR UPDATE ON app.stock_reservation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='replacement') EXECUTE FUNCTION app.seal_replacement_head();

--> statement-breakpoint
CREATE FUNCTION app.replacement_projection(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('id',s.id,'case_id',s.case_id,'version',s.revision,'case_version',c.revision,
  'warehouse_id',s.warehouse_id,'status',s.status,'buyer_shipping',0,'cod_due',0,'booking_id',s.booking_id,
  'prepared_at',to_char(s.prepared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'waybill_issued_at',to_char(s.waybill_issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'tracking_number',s.tracking_number,'handover_at',to_char(s.handover_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'packing_due_at',to_char(s.packing_due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'created_at',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',link.id,'return_item_id',link.return_item_id,
    'order_item_id',f.order_item_id,'quantity',1,'original_fulfillment_item_id',link.original_fulfillment_item_id,
    'replacement_of',coalesce(link.predecessor_id,link.original_fulfillment_item_id),'generation',link.generation) ORDER BY link.id)
    FROM app.replacement_link link JOIN app.fulfillment_item f ON f.id=link.original_fulfillment_item_id WHERE link.shipment_id=s.id),'[]'::jsonb))
 FROM app.replacement_shipment s JOIN app.return_case c ON c.id=s.case_id WHERE s.id=p_id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_replacement_operation(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_op app.replacement_operation; v_head app.replacement_shipment; v_event app.replacement_event; v_count int;
BEGIN
 SELECT * INTO v_op FROM app.replacement_operation WHERE id=p_id;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_op.subject_id AND case_id=v_op.case_id;
 SELECT count(*) INTO v_count FROM app.replacement_event WHERE source_kind='operation' AND source_id=p_id;
 SELECT * INTO v_event FROM app.replacement_event WHERE source_kind='operation' AND source_id=p_id ORDER BY revision DESC LIMIT 1;
 IF v_op.id IS NULL OR v_op.created_xid<>pg_current_xact_id()::text OR v_op.response='{}'::jsonb
    OR v_head.id IS NULL OR v_event.id IS NULL OR v_event.shipment_id IS DISTINCT FROM v_head.id
    OR v_op.response IS DISTINCT FROM app.replacement_projection(v_head.id)
    OR (v_op.action='create' AND (v_count<>2 OR v_head.operation_id IS DISTINCT FROM p_id
       OR NOT EXISTS(SELECT 1 FROM app.replacement_event WHERE source_kind='operation' AND source_id=p_id AND kind='create')
       OR v_event.kind NOT IN ('reserve','stock_wait')))
    OR (v_op.action<>'create' AND (v_count<>1 OR (v_op.action='reserve' AND v_event.kind NOT IN ('reserve','stock_wait'))
       OR (v_op.action<>'reserve' AND v_event.kind IS DISTINCT FROM v_op.action)))
    OR NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.actor_id=v_op.actor_id AND a.action='replacement.'||v_op.action
      AND a.subject_id=v_head.id::text AND a.outcome='allowed' AND a.created_at>=v_op.created_at
      AND a.details->>'operation_id'=v_op.id::text AND a.details->>'case_id'=v_op.case_id::text
      AND a.details->>'version'=v_event.revision::text AND a.reason=v_event.reason)
 THEN RAISE EXCEPTION 'Replacement command atomically commits its exact scoped result, physical transition and audit' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_replacement_actor(p_id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_replacement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_replacement_operation(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_operation_sealed AFTER INSERT OR UPDATE ON app.replacement_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_operation();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_op app.replacement_operation; v_job app.outbox_job;
 v_provider app.local_replacement_operation; v_event app.local_replacement_event; v_callback app.outbox_job;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original replacement bookings are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=NEW.shipment_id FOR UPDATE;
 SELECT * INTO v_op FROM app.replacement_operation WHERE id=NEW.operation_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.creation_job_id;
 IF TG_OP='INSERT' THEN
  IF v_head.id IS NULL OR v_head.prepared_at IS NULL OR v_head.status NOT IN ('picking','booking_failed')
     OR v_head.handover_at IS NOT NULL OR v_op.id IS NULL OR v_op.action<>'book' OR v_op.subject_id IS DISTINCT FROM v_head.id
     OR v_op.created_xid<>pg_current_xact_id()::text OR v_op.response<>'{}'::jsonb
     OR NEW.status<>'queued' OR NEW.provider_operation_id IS NOT NULL
     OR NEW.attempt::bigint<>(SELECT coalesce(max(attempt),0)::bigint+1 FROM app.replacement_booking WHERE shipment_id=v_head.id)
     OR v_job.id IS NULL OR v_job.kind<>'replacement.shipping.create' OR v_job.status<>'pending' OR v_job.attempts<>0
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('bookingId',NEW.id)
     OR v_job.dedup_key IS DISTINCT FROM 'replacement-shipping-create:'||NEW.id::text
  THEN RAISE EXCEPTION 'Replacement booking atomically queues its exact prepared original command and first job' USING ERRCODE='23514'; END IF;
  NEW.created_at:=v_op.occurred_at; RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['provider_operation_id','status']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['provider_operation_id','status'])
    OR (OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id)
    OR v_head.booking_id IS DISTINCT FROM NEW.id OR v_head.handover_at IS NOT NULL
    OR NOT ((OLD.status='queued' AND NEW.status='processing') OR (OLD.status='processing' AND NEW.status IN ('unknown','issued','failed'))
         OR (OLD.status='unknown' AND NEW.status IN ('issued','failed')))
 THEN RAISE EXCEPTION 'Replacement booking retains its original job/provider root and monotonic outcome' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_provider FROM app.local_replacement_operation WHERE id=NEW.provider_operation_id;
 IF v_provider.id IS NULL OR v_provider.booking_id IS DISTINCT FROM NEW.id
 THEN RAISE EXCEPTION 'Replacement booking binds its exact original provider operation' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('processing','unknown') THEN
  IF v_job.status<>'processing' OR v_job.lease_token IS NULL OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL
  THEN RAISE EXCEPTION 'Replacement source preparation/unknown acknowledgement requires its current leased job' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_event FROM app.local_replacement_event WHERE operation_id=v_provider.id;
  SELECT job.* INTO v_callback FROM app.replacement_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_event.id;
  IF v_provider.status IS DISTINCT FROM NEW.status OR v_event.status IS DISTINCT FROM NEW.status
     OR v_callback.id IS NULL OR v_callback.kind<>'replacement.shipping.callback' OR v_callback.status<>'pending'
     OR EXISTS(SELECT 1 FROM app.replacement_event_result WHERE event_id=v_event.id)
  THEN RAISE EXCEPTION 'Replacement terminal booking status requires its registered pending original source callback' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_booking_guard BEFORE INSERT OR UPDATE OR DELETE ON app.replacement_booking
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_booking();

--> statement-breakpoint
CREATE FUNCTION app.guard_local_replacement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_booking app.replacement_booking; v_head app.replacement_shipment; v_order app.commerce_order; v_job app.outbox_job;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original local replacement effects are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_booking FROM app.replacement_booking WHERE id=NEW.booking_id FOR UPDATE;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_booking.shipment_id;
 SELECT o.* INTO v_order FROM app.return_case c JOIN app.commerce_order o ON o.id=c.order_id WHERE c.id=v_head.case_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=v_booking.creation_job_id FOR SHARE;
 IF v_booking.id IS NULL OR v_head.booking_id IS DISTINCT FROM v_booking.id OR v_head.prepared_at IS NULL OR v_head.handover_at IS NOT NULL
    OR NEW.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR NEW.clock_namespace IS DISTINCT FROM v_order.clock_namespace
 THEN RAISE EXCEPTION 'Local replacement effect retains its exact current prepared booking/environment/clock' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'created' OR NEW.tracking_number IS NOT NULL OR NEW.terminal_at IS NOT NULL
     OR v_booking.status<>'queued' OR v_booking.provider_operation_id IS NOT NULL OR v_head.status<>'booking_pending'
     OR v_job.kind<>'replacement.shipping.create' OR v_job.status<>'processing' OR v_job.lease_token IS NULL
     OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('bookingId',v_booking.id)
  THEN RAISE EXCEPTION 'Only the current fenced original leased job creates a replacement source root' USING ERRCODE='23514'; END IF;
  NEW.created_at:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
  NEW.recorded_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','tracking_number','terminal_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','tracking_number','terminal_at'])
    OR OLD.status<>'created' OR NEW.status NOT IN ('issued','failed') OR v_booking.provider_operation_id IS DISTINCT FROM NEW.id
    OR v_booking.status NOT IN ('processing','unknown') OR NEW.terminal_at IS NULL OR NEW.terminal_at<NEW.created_at
    OR NEW.terminal_at>app.reservation_clock(v_order.clock_namespace)
    OR NEW.terminal_at<>date_trunc('milliseconds',NEW.terminal_at)
    OR (NEW.status='issued' AND NEW.tracking_number IS DISTINCT FROM 'LOCAL-REPLACEMENT-'||upper(replace(NEW.id::text,'-','')))
 THEN RAISE EXCEPTION 'Original local replacement source has one immutable bounded terminal observation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_replacement_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.local_replacement_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_local_replacement_operation();

--> statement-breakpoint
CREATE FUNCTION app.guard_local_replacement_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_op app.local_replacement_operation;
BEGIN
 SELECT * INTO v_op FROM app.local_replacement_operation WHERE id=NEW.operation_id;
 IF v_op.id IS NULL OR v_op.status NOT IN ('issued','failed')
    OR (NEW.status,NEW.tracking_number,NEW.occurred_at) IS DISTINCT FROM (v_op.status,v_op.tracking_number,v_op.terminal_at)
    OR EXISTS(SELECT 1 FROM app.replacement_event_result result JOIN app.local_replacement_event source ON source.id=result.event_id WHERE source.operation_id=v_op.id)
 THEN RAISE EXCEPTION 'Replacement source event retains its exact original terminal observation' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_replacement_event_guard BEFORE INSERT ON app.local_replacement_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_local_replacement_event();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_replacement_event; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_source FROM app.local_replacement_event WHERE id=NEW.id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.callback_job_id;
 IF v_source.id IS NULL OR v_job.id IS NULL OR v_job.kind<>'replacement.shipping.callback' OR v_job.status<>'pending'
    OR v_job.attempts<>0 OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_source.id)
    OR v_job.dedup_key IS DISTINCT FROM 'replacement-shipping-callback:'||v_source.id::text
 THEN RAISE EXCEPTION 'Replacement callback registration atomically retains the original terminal source and job' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_provider_event_guard BEFORE INSERT ON app.replacement_provider_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_provider_event();

--> statement-breakpoint
CREATE FUNCTION app.seal_local_replacement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_op app.local_replacement_operation; v_booking app.replacement_booking; v_job app.outbox_job; v_count int;
BEGIN
 SELECT * INTO v_op FROM app.local_replacement_operation WHERE id=NEW.id;
 SELECT * INTO v_booking FROM app.replacement_booking WHERE id=v_op.booking_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=v_booking.creation_job_id;
 SELECT count(*) INTO v_count FROM app.local_replacement_event WHERE operation_id=v_op.id;
 IF v_booking.provider_operation_id IS DISTINCT FROM v_op.id
    OR (v_op.status='created' AND v_count<>0) OR (v_op.status IN ('issued','failed') AND v_count<>1)
    OR (TG_OP='INSERT' AND (v_job.status<>'processing' OR v_job.lease_token IS NULL OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL))
 THEN RAISE EXCEPTION 'Local replacement root commits its fenced preparation and exact terminal source atomically' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_replacement_operation_sealed AFTER INSERT OR UPDATE ON app.local_replacement_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_replacement_operation();

--> statement-breakpoint
CREATE FUNCTION app.guard_local_replacement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_booking app.replacement_booking; v_order app.commerce_order; v_units uuid[];
BEGIN
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=NEW.shipment_id FOR SHARE;
 SELECT * INTO v_booking FROM app.replacement_booking WHERE id=NEW.booking_id FOR SHARE;
 SELECT o.* INTO v_order FROM app.return_case c JOIN app.commerce_order o ON o.id=c.order_id WHERE c.id=v_head.case_id;
 IF jsonb_typeof(NEW.unit_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.unit_ids) NOT BETWEEN 1 AND 100
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.unit_ids) value WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'Replacement receipt selects bounded explicit physical occurrence identities' USING ERRCODE='23514'; END IF;
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO v_units FROM jsonb_array_elements_text(NEW.unit_ids);
 IF cardinality(v_units) IS DISTINCT FROM (SELECT count(DISTINCT id)::int FROM unnest(v_units) AS selected(id))
    OR NEW.unit_ids IS DISTINCT FROM to_jsonb(v_units)
    OR v_head.id IS NULL OR v_booking.id IS NULL OR v_head.booking_id IS DISTINCT FROM v_booking.id
    OR v_booking.shipment_id IS DISTINCT FROM v_head.id OR v_booking.status<>'issued' OR v_head.handover_at IS NULL
    OR NEW.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR NEW.clock_namespace IS DISTINCT FROM v_order.clock_namespace OR NEW.occurred_at<v_head.handover_at
    OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace) OR NEW.occurred_at<>date_trunc('milliseconds',NEW.occurred_at)
    OR cardinality(v_units) IS DISTINCT FROM (SELECT count(*)::int FROM app.replacement_link WHERE shipment_id=v_head.id AND id=ANY(v_units))
 THEN RAISE EXCEPTION 'Replacement source observes only its exact issued and handed-over physical parcel at a real bounded receipt time' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_replacement_receipt_guard BEFORE INSERT ON app.local_replacement_receipt
 FOR EACH ROW EXECUTE FUNCTION app.guard_local_replacement_receipt();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_receipt_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_replacement_receipt; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_source FROM app.local_replacement_receipt WHERE id=NEW.id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.callback_job_id;
 IF v_source.id IS NULL OR v_job.id IS NULL OR v_job.kind<>'replacement.receipt.callback' OR v_job.status<>'pending' OR v_job.attempts<>0
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_source.id)
    OR v_job.dedup_key IS DISTINCT FROM 'replacement-receipt-callback:'||v_source.id::text
 THEN RAISE EXCEPTION 'Replacement receipt registration retains its independently committed original observation and exact callback' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_receipt_provider_event_guard BEFORE INSERT ON app.replacement_receipt_provider_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_receipt_provider_event();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_buyer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_link app.replacement_link; v_head app.replacement_shipment; v_claim app.return_item;
 v_source app.local_replacement_receipt; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_link FROM app.replacement_link WHERE id=NEW.replacement_link_id;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_link.shipment_id FOR UPDATE;
 SELECT * INTO v_claim FROM app.return_item WHERE id=v_link.return_item_id;
 SELECT * INTO v_source FROM app.local_replacement_receipt WHERE id=NEW.source_id;
 SELECT job.* INTO v_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_source.id;
 IF v_link.id IS NULL OR v_head.id IS NULL OR v_claim.claim_state IS DISTINCT FROM 'replacing'
    OR v_head.status NOT IN ('handed_over','partially_delivered') OR v_head.handover_at IS NULL
    OR v_source.id IS NULL OR v_source.shipment_id IS DISTINCT FROM v_head.id OR v_source.booking_id IS DISTINCT FROM v_head.booking_id
    OR NOT (v_source.unit_ids ? v_link.id::text) OR NEW.received_at IS DISTINCT FROM v_source.occurred_at
    OR v_job.id IS NULL OR v_job.kind<>'replacement.receipt.callback' OR v_job.status<>'pending'
    OR EXISTS(SELECT 1 FROM app.replacement_receipt_result WHERE event_id=v_source.id)
 THEN RAISE EXCEPTION 'First replacement buyer receipt belongs to its exact pending original observation and affected held quantity' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_buyer_receipt_guard BEFORE INSERT ON app.replacement_buyer_receipt
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_buyer_receipt();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_receipt_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_replacement_receipt; v_head app.replacement_shipment; v_event app.replacement_event;
 v_return app.return_event; v_job app.outbox_job; v_count int;
BEGIN
 SELECT * INTO v_source FROM app.local_replacement_receipt WHERE id=NEW.event_id;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_source.shipment_id;
 SELECT * INTO v_event FROM app.replacement_event WHERE id=NEW.replacement_event_id;
 SELECT * INTO v_return FROM app.return_event WHERE id=NEW.return_event_id;
 SELECT job.* INTO v_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_source.id;
 SELECT count(*) INTO v_count FROM app.replacement_buyer_receipt WHERE source_id=v_source.id;
 IF v_source.id IS NULL OR v_head.id IS NULL OR NEW.shipment_id IS DISTINCT FROM v_head.id OR NEW.revision IS DISTINCT FROM v_head.revision
    OR NEW.receipt_count IS DISTINCT FROM v_count OR NEW.outcome IS DISTINCT FROM (CASE WHEN v_count=0 THEN 'duplicate' ELSE 'received' END)
    OR jsonb_array_length(v_source.unit_ids) IS DISTINCT FROM (SELECT count(*)::int FROM app.replacement_link link
      JOIN app.replacement_buyer_receipt receipt ON receipt.replacement_link_id=link.id
      WHERE link.shipment_id=v_source.shipment_id AND v_source.unit_ids ? link.id::text)
    OR v_job.id IS NULL OR v_job.kind<>'replacement.receipt.callback' OR v_job.status<>'pending'
    OR (v_count>0 AND (v_event.id IS NULL OR v_event.kind<>'receipt' OR v_event.source_kind<>'receipt' OR v_event.source_id IS DISTINCT FROM v_source.id
      OR v_event.shipment_id IS DISTINCT FROM v_head.id OR v_event.revision IS DISTINCT FROM NEW.revision
      OR v_return.id IS NULL OR v_return.case_id IS DISTINCT FROM v_head.case_id OR v_return.kind<>'replacement_received'
      OR v_return.source_kind<>'replacement' OR v_return.source_id IS DISTINCT FROM v_event.id))
    OR (v_count=0 AND (NEW.replacement_event_id IS NOT NULL OR NEW.return_event_id IS NOT NULL))
 THEN RAISE EXCEPTION 'Replacement receipt result commits exactly the new first receipts and their physical/case transitions' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_receipt_result_guard BEFORE INSERT ON app.replacement_receipt_result
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_receipt_result();

--> statement-breakpoint
CREATE FUNCTION app.assert_replacement_receipt(p_event uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_result app.replacement_receipt_result; v_source app.local_replacement_receipt; v_job app.outbox_job; v_count int;
BEGIN
 SELECT * INTO v_result FROM app.replacement_receipt_result WHERE event_id=p_event;
 SELECT * INTO v_source FROM app.local_replacement_receipt WHERE id=p_event;
 SELECT job.* INTO v_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=p_event;
 SELECT count(*) INTO v_count FROM app.replacement_buyer_receipt WHERE source_id=p_event;
 IF v_result.event_id IS NULL OR v_source.id IS NULL OR v_job.id IS NULL OR v_job.status<>'completed'
    OR v_result.shipment_id IS DISTINCT FROM v_source.shipment_id OR v_result.receipt_count IS DISTINCT FROM v_count
    OR jsonb_array_length(v_source.unit_ids) IS DISTINCT FROM (SELECT count(*)::int FROM app.replacement_link link
      JOIN app.replacement_buyer_receipt receipt ON receipt.replacement_link_id=link.id
      WHERE link.shipment_id=v_source.shipment_id AND v_source.unit_ids ? link.id::text)
    OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_result.event_id,'outcome',v_result.outcome,'receipt_count',v_result.receipt_count,'version',v_result.revision)
    OR EXISTS(SELECT 1 FROM app.replacement_buyer_receipt receipt JOIN app.replacement_link link ON link.id=receipt.replacement_link_id
      WHERE receipt.source_id=p_event AND (link.shipment_id<>v_source.shipment_id OR NOT (v_source.unit_ids ? link.id::text) OR receipt.received_at IS DISTINCT FROM v_source.occurred_at))
 THEN RAISE EXCEPTION 'Replacement receipt effects and exact callback completion are atomic' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_replacement_shipment(v_source.shipment_id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_replacement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='replacement_buyer_receipt' THEN PERFORM app.assert_replacement_receipt(NEW.source_id);
 ELSE PERFORM app.assert_replacement_receipt(NEW.event_id); END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_buyer_receipt_sealed AFTER INSERT ON app.replacement_buyer_receipt
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_receipt();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_receipt_result_sealed AFTER INSERT ON app.replacement_receipt_result
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_receipt();

--> statement-breakpoint
DO $$
DECLARE v_relation text;
BEGIN
 FOREACH v_relation IN ARRAY ARRAY['replacement_link','replacement_component_allocation','replacement_event','local_replacement_event',
  'replacement_provider_event','replacement_event_result','local_replacement_receipt','replacement_receipt_provider_event','replacement_buyer_receipt','replacement_receipt_result'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',v_relation||'_immutable',v_relation);
 END LOOP;
END;
$$;


-- Original checkout/transfer and original-parcel consumption branches are
-- copied verbatim from0019; only explicit replacement branches are added.
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
    ELSIF NEW.kind='replacement' THEN
      IF NEW.expires_at IS NOT NULL OR EXISTS(SELECT 1 FROM app.stock_reservation_item WHERE reservation_id=NEW.id)
        OR NOT EXISTS(SELECT 1 FROM app.replacement_shipment s JOIN app.replacement_event e ON e.shipment_id=s.id AND e.revision=s.revision
          WHERE s.stock_reservation_id=NEW.id AND s.status='ready' AND e.kind='reserve'
            AND NEW.key='replacement:'||s.id::text)
      THEN RAISE EXCEPTION 'Replacement holds require their exact complete physical readiness event' USING ERRCODE='23514'; END IF;
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
  IF NEW.kind='replacement' AND NEW.status='consumed' THEN
    IF NOT EXISTS(SELECT 1 FROM app.replacement_shipment s JOIN app.replacement_event e ON e.shipment_id=s.id AND e.kind='handover'
        WHERE s.stock_reservation_id=NEW.id AND s.status='handed_over' AND s.handover_at=e.occurred_at)
      OR EXISTS(SELECT 1 FROM app.stock_reservation_component c JOIN app.inventory_balance b ON b.id=c.balance_id
        JOIN app.warehouse w ON w.id=b.warehouse_id LEFT JOIN app.inventory_lot l ON l.id=b.lot_id
        WHERE c.reservation_id=NEW.id AND (NOT w.active OR l.expires_on<(app.inventory_clock(w.id,NEW.clock_namespace) AT TIME ZONE w.timezone)::date))
      OR EXISTS(SELECT 1 FROM app.stock_reservation_component c WHERE c.reservation_id=NEW.id AND c.quantity IS DISTINCT FROM (
        SELECT sum(m.quantity) FROM app.stock_movement m JOIN app.replacement_event e ON m.source_ref='replacement-handover:'||e.id::text AND e.kind='handover'
        JOIN app.replacement_shipment s ON s.id=e.shipment_id WHERE s.stock_reservation_id=NEW.id AND m.kind='consume' AND m.balance_id=c.balance_id))
    THEN RAISE EXCEPTION 'Replacement consumption requires its exact separate physical handover and eligible complete lots' USING ERRCODE='23514'; END IF;
    SELECT e.occurred_at INTO NEW.resolved_at FROM app.replacement_event e JOIN app.replacement_shipment s ON s.id=e.shipment_id
      WHERE s.stock_reservation_id=NEW.id AND e.kind='handover';
    RETURN NEW;
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
CREATE OR REPLACE FUNCTION app.guard_fulfillment_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_replacement app.replacement_shipment; v_replacement_event app.replacement_event; v_operation app.replacement_operation; expected bigint; event app.fulfillment_event%ROWTYPE; f app.fulfillment%ROWTYPE; position app.inventory_balance%ROWTYPE; expiry date; zone text;
BEGIN
 IF NEW.kind<>'consume' THEN RETURN NEW;END IF;
 IF NEW.source_ref LIKE 'replacement-handover:%' THEN
  SELECT * INTO v_replacement_event FROM app.replacement_event WHERE kind='handover' AND 'replacement-handover:'||id::text=NEW.source_ref;
  SELECT * INTO v_replacement FROM app.replacement_shipment WHERE id=v_replacement_event.shipment_id;
  SELECT * INTO v_operation FROM app.replacement_operation WHERE id=v_replacement_event.source_id;
  SELECT sum(a.quantity) INTO expected FROM app.replacement_component_allocation a JOIN app.replacement_link link ON link.id=a.replacement_link_id
    WHERE link.shipment_id=v_replacement.id AND a.balance_id=NEW.balance_id;
  SELECT * INTO position FROM app.inventory_balance WHERE id=NEW.balance_id;
  SELECT expires_on INTO expiry FROM app.inventory_lot WHERE id=position.lot_id;
  SELECT timezone INTO zone FROM app.warehouse WHERE id=position.warehouse_id;
  IF v_replacement_event.id IS NULL OR v_replacement.status<>'handed_over'
    OR v_replacement.handover_at IS DISTINCT FROM v_replacement_event.occurred_at OR NEW.quantity IS DISTINCT FROM expected
    OR NEW.actor_id IS DISTINCT FROM v_replacement_event.actor_id OR v_replacement_event.source_kind<>'operation'
    OR v_operation.id IS NULL OR v_operation.action<>'handover' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR position.warehouse_id IS DISTINCT FROM v_replacement.warehouse_id OR expiry<(v_replacement_event.occurred_at AT TIME ZONE zone)::date
    OR NOT EXISTS(SELECT 1 FROM app.stock_reservation r JOIN app.stock_reservation_component c ON c.reservation_id=r.id
      WHERE r.id=v_replacement.stock_reservation_id AND r.kind='replacement' AND r.status='active' AND c.balance_id=NEW.balance_id AND c.quantity=NEW.quantity)
  THEN RAISE EXCEPTION 'Replacement consumption retains its exact current handover, complete held quantity, actor and usable lot' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO event FROM app.fulfillment_event WHERE kind='handover' AND 'handover:'||id::text=NEW.source_ref;SELECT * INTO f FROM app.fulfillment WHERE id=event.fulfillment_id;
 SELECT sum(a.quantity) INTO expected FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item i ON i.id=a.fulfillment_item_id WHERE i.shipment_id=f.shipment_id AND a.balance_id=NEW.balance_id;
 SELECT * INTO position FROM app.inventory_balance WHERE id=NEW.balance_id;SELECT expires_on INTO expiry FROM app.inventory_lot WHERE id=position.lot_id;SELECT timezone INTO zone FROM app.warehouse WHERE id=position.warehouse_id;
 IF event.id IS NULL OR f.handover_at IS DISTINCT FROM event.occurred_at OR NEW.quantity IS DISTINCT FROM expected OR NEW.actor_id IS DISTINCT FROM event.actor_id OR expiry<(event.occurred_at AT TIME ZONE zone)::date THEN RAISE EXCEPTION 'Checkout consumption requires exact original handover quantities and usable lots' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;


-- Extend physical occurrence identity; original financial qualification and
-- the existing all-occurrence original-unit refund-allocation cap are retained.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_operation app.return_operation; v_original record;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original return quantities and eligibility are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['claim_state','inspection_status']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['claim_state','inspection_status'])
  THEN RAISE EXCEPTION 'Return unit retains original receipt, price, charges, reason and deadline' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO v_case FROM app.return_case c WHERE c.id=NEW.case_id;
 SELECT * INTO v_operation FROM app.return_operation op WHERE op.id=v_case.operation_id;
 IF v_case.id IS NULL OR v_operation.id IS NULL OR v_operation.action<>'return.create'
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR v_case.revision<>1 OR v_case.status<>'requested' OR NEW.claim_state<>'held' OR NEW.inspection_status<>'pending'
 THEN RAISE EXCEPTION 'Original return unit is inserted only with its creating buyer operation' USING ERRCODE='23514'; END IF;
 SELECT f.buyer_shipping,i.unit_price,CASE WHEN NEW.replacement_link_id IS NULL THEN r.received_at ELSE replacement_receipt.received_at END received_at INTO v_original
 FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
 JOIN app.buyer_receipt r ON r.fulfillment_item_id=f.id
 LEFT JOIN app.replacement_link link ON link.id=NEW.replacement_link_id AND link.original_fulfillment_item_id=f.id
 LEFT JOIN app.replacement_buyer_receipt replacement_receipt ON replacement_receipt.replacement_link_id=link.id
 WHERE f.id=NEW.fulfillment_item_id AND i.order_id=v_case.order_id AND r.id=NEW.buyer_receipt_id
   AND (NEW.replacement_link_id IS NULL OR replacement_receipt.id IS NOT NULL);
 IF NOT FOUND OR NEW.merchandise_amount IS DISTINCT FROM v_original.unit_price
    OR NEW.buyer_shipping IS DISTINCT FROM v_original.buyer_shipping
    OR NEW.deadline_at IS DISTINCT FROM v_original.received_at+interval '168 hours'
    OR v_case.created_at<v_original.received_at OR v_case.created_at>NEW.deadline_at
 THEN RAISE EXCEPTION 'Return unit requires its actually received original offer entitlement and submission window' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;


-- Extend physical occurrence identity; original financial qualification and
-- the existing all-occurrence original-unit refund-allocation cap are retained.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_goods() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_item app.return_item; v_event app.return_event; v_operation app.return_operation; v_movement app.stock_movement;
 v_balance app.inventory_balance; v_original record; v_received numeric;
BEGIN
 SELECT * INTO v_item FROM app.return_item WHERE id=NEW.return_item_id;
 SELECT * INTO v_event FROM app.return_event WHERE id=NEW.event_id AND case_id=v_item.case_id;
 SELECT * INTO v_operation FROM app.return_operation WHERE id=v_event.source_id;
 IF v_item.replacement_link_id IS NULL THEN
  SELECT a.quantity,s.warehouse_id INTO v_original FROM app.fulfillment_component_allocation a
   JOIN app.fulfillment_item f ON f.id=a.fulfillment_item_id JOIN app.order_shipment s ON s.id=f.shipment_id
   WHERE a.fulfillment_item_id=v_item.fulfillment_item_id AND a.balance_id=NEW.expected_balance_id;
 ELSE
  SELECT a.quantity,s.warehouse_id INTO v_original FROM app.replacement_component_allocation a
   JOIN app.replacement_link link ON link.id=a.replacement_link_id JOIN app.replacement_shipment s ON s.id=link.shipment_id
   WHERE a.replacement_link_id=v_item.replacement_link_id AND a.balance_id=NEW.expected_balance_id;
 END IF;
 IF v_item.id IS NULL OR v_event.id IS NULL OR v_event.kind<>'inspection' OR v_event.source_kind<>'operation'
    OR v_operation.action IS DISTINCT FROM 'return.inspect' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR v_original.quantity IS NULL OR NOT EXISTS(SELECT 1 FROM app.return_item_event WHERE event_id=v_event.id AND return_item_id=v_item.id)
 THEN RAISE EXCEPTION 'Return goods retain actual original component, case and inspection operation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_balance FROM app.inventory_balance WHERE id=NEW.expected_balance_id FOR UPDATE;
 IF v_balance.warehouse_id IS DISTINCT FROM v_original.warehouse_id
    OR NOT EXISTS(SELECT 1 FROM app.warehouse WHERE id=v_original.warehouse_id AND active)
 THEN RAISE EXCEPTION 'Return intake credits only its active original warehouse' USING ERRCODE='23514'; END IF;
 IF NEW.identity_confirmed THEN
  SELECT coalesce(sum(g.quantity),0) INTO v_received FROM app.return_goods g JOIN app.return_item r ON r.id=g.return_item_id
   WHERE r.fulfillment_item_id=v_item.fulfillment_item_id AND r.replacement_link_id IS NOT DISTINCT FROM v_item.replacement_link_id
     AND g.expected_balance_id=NEW.expected_balance_id AND g.identity_confirmed;
  SELECT * INTO v_movement FROM app.stock_movement WHERE id=NEW.stock_movement_id;
  IF v_received+NEW.quantity>v_original.quantity OR v_movement.id IS NULL
     OR (v_movement.balance_id,v_movement.kind,v_movement.quantity,v_movement.on_hand_delta,v_movement.reserved_delta,v_movement.quarantined_delta)
       IS DISTINCT FROM (NEW.expected_balance_id,'receive'::text,NEW.quantity,NEW.quantity,0,NEW.quantity)
     OR v_movement.source_ref<>'return-goods:'||NEW.id::text OR v_movement.actor_id IS DISTINCT FROM v_operation.actor_id
  THEN RAISE EXCEPTION 'Known original returned goods conserve cumulative quarantine intake and exact stock movement' USING ERRCODE='23514'; END IF;
 ELSIF NEW.stock_movement_id IS NOT NULL THEN RAISE EXCEPTION 'Unidentified goods cannot credit expected SKU stock' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;


-- Extend physical occurrence identity; original financial qualification and
-- the existing all-occurrence original-unit refund-allocation cap are retained.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_return_operation(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.return_operation; v_order app.commerce_order; v_case app.return_case; v_refund app.refund;
 v_user app.auth_user; v_session app.auth_session; v_grant app.role_grant; v_mfa app.mfa_session;
 v_guest app.commerce_guest_context; v_access app.order_access; v_proof app.access_proof; v_event app.return_event;
 v_financial_event app.refund_event; v_owner boolean; v_finance boolean; v_warehouse uuid;
BEGIN
 SELECT * INTO v_operation FROM app.return_operation WHERE id=p_operation_id;
 IF NOT FOUND OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Return operation finalizes its response atomically' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_operation.order_id FOR UPDATE;
 IF v_operation.action IN ('refund.destination','refund.reconcile','refund.retry') THEN
  SELECT * INTO v_refund FROM app.refund WHERE id=v_operation.subject_id;
  SELECT * INTO v_case FROM app.return_case WHERE id=v_refund.case_id;
 ELSE SELECT * INTO v_case FROM app.return_case WHERE id=v_operation.subject_id; END IF;
 IF v_case.id IS NULL OR v_case.order_id IS DISTINCT FROM v_order.id
    OR (v_refund.id IS NOT NULL AND v_refund.order_id IS DISTINCT FROM v_order.id)
 THEN RAISE EXCEPTION 'Return operation retains its exact original order subject' USING ERRCODE='23514'; END IF;
 IF v_operation.action IN ('return.create','return.decide','return.inspect') THEN
  SELECT * INTO v_event FROM app.return_event WHERE source_kind='operation' AND source_id=v_operation.id;
  IF v_event.id IS NULL OR v_event.case_id IS DISTINCT FROM v_case.id
     OR (SELECT count(*) FROM app.return_event WHERE source_kind='operation' AND source_id=v_operation.id)<>1
     OR (v_operation.action='return.create' AND (v_case.operation_id IS DISTINCT FROM v_operation.id
         OR v_operation.response->>'id' IS DISTINCT FROM v_case.id::text
         OR v_operation.response->>'version' IS DISTINCT FROM '1'
         OR v_operation.response->>'status' IS DISTINCT FROM 'requested'))
  THEN RAISE EXCEPTION 'Return operation commits one exact creating/deciding/inspection event' USING ERRCODE='23514'; END IF;
 ELSE
  IF v_operation.action='refund.queue' THEN SELECT * INTO v_refund FROM app.refund WHERE operation_id=v_operation.id; END IF;
  SELECT * INTO v_financial_event FROM app.refund_event WHERE source_kind='operation' AND source_id=v_operation.id;
  IF v_refund.id IS NULL OR v_refund.case_id IS DISTINCT FROM v_case.id OR v_refund.order_id IS DISTINCT FROM v_order.id
     OR v_financial_event.id IS NULL OR v_financial_event.refund_id IS DISTINCT FROM v_refund.id
     OR v_financial_event.kind IS DISTINCT FROM split_part(v_operation.action,'.',2)
     OR v_financial_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
     OR (SELECT count(*) FROM app.refund_event WHERE source_kind='operation' AND source_id=v_operation.id)<>1
     OR v_operation.response->>'id' IS DISTINCT FROM v_refund.id::text
     OR v_operation.response->>'version' IS DISTINCT FROM v_financial_event.revision::text
     OR v_operation.response->>'amount' IS DISTINCT FROM v_refund.amount::text
  THEN RAISE EXCEPTION 'Refund operation commits one exact financial transition and safe response' USING ERRCODE='23514'; END IF;
 END IF;
 IF v_operation.actor_id IS NOT NULL THEN
  SELECT * INTO v_user FROM app.auth_user WHERE id=v_operation.actor_id FOR UPDATE;
  SELECT * INTO v_session FROM app.auth_session WHERE id=v_operation.session_id AND user_id=v_user.id FOR SHARE;
  SELECT * INTO v_grant FROM app.role_grant WHERE user_id=v_user.id FOR SHARE;
  SELECT * INTO v_mfa FROM app.mfa_session WHERE session_id=v_session.id FOR SHARE;
  IF v_user.id IS NULL OR NOT v_user.email_verified OR v_session.id IS NULL OR v_session.expires_at<=clock_timestamp()
     OR (coalesce(v_grant.roles,ARRAY['buyer']::text[]) && ARRAY['owner','ecommerce_admin','customer_service','warehouse','finance']::text[]
         AND (NOT v_user.two_factor_enabled OR v_mfa.session_id IS NULL))
  THEN RAISE EXCEPTION 'Return actor requires current verified session and staff MFA' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_guest FROM app.commerce_guest_context WHERE id=v_operation.guest_id FOR UPDATE;
  SELECT * INTO v_access FROM app.order_access WHERE order_id=v_order.id AND guest_id=v_operation.guest_id FOR SHARE;
  IF v_guest.id IS NULL OR v_guest.revoked_at IS NOT NULL OR v_guest.expires_at<=clock_timestamp()
     OR v_access.order_id IS NULL OR v_access.revoked_at IS NOT NULL OR v_access.expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'Guest return requires its unexpired original order access' USING ERRCODE='23514'; END IF;
 END IF;
 v_owner:=coalesce('owner'=ANY(v_grant.roles),false);
 v_finance:=v_owner OR (coalesce('finance'=ANY(v_grant.roles),false)
   AND coalesce(v_grant.permissions @> ARRAY['finance.refunds.read','finance.refunds.write']::text[],false));
 IF v_operation.action IN ('return.create','refund.destination') THEN
  IF ((v_operation.actor_id IS NOT NULL AND v_order.owner_user_id=v_operation.actor_id)
      OR (v_operation.guest_id IS NOT NULL AND v_order.owner_guest_id=v_operation.guest_id)) IS NOT TRUE
  THEN RAISE EXCEPTION 'Buyer return operations require original order ownership' USING ERRCODE='23514'; END IF;
 ELSIF v_operation.action IN ('return.decide','return.inspect') THEN
  IF v_operation.actor_id IS NULL OR NOT v_user.two_factor_enabled OR v_mfa.session_id IS NULL
     OR (NOT v_owner AND NOT coalesce((CASE v_operation.action WHEN 'return.decide' THEN 'customer_service' ELSE 'warehouse' END)=ANY(v_grant.roles),false))
  THEN RAISE EXCEPTION 'Return decisions and intake require their separate staff role' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_event FROM app.return_event WHERE source_kind='operation' AND source_id=v_operation.id;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'Scoped staff operation requires its exact case event' USING ERRCODE='23514'; END IF;
  FOR v_warehouse IN
   SELECT DISTINCT coalesce(parcel.warehouse_id,s.warehouse_id) warehouse_id FROM app.return_item r JOIN app.fulfillment_item f ON f.id=r.fulfillment_item_id
   JOIN app.order_shipment s ON s.id=f.shipment_id
   LEFT JOIN app.replacement_link link ON link.id=r.replacement_link_id LEFT JOIN app.replacement_shipment parcel ON parcel.id=link.shipment_id
   WHERE r.case_id=v_case.id
     AND (v_operation.action='return.decide' OR EXISTS(SELECT 1 FROM app.return_item_event h WHERE h.event_id=v_event.id AND h.return_item_id=r.id))
   ORDER BY 1
  LOOP
   IF NOT v_owner THEN
    PERFORM w.id FROM app.warehouse_membership m JOIN app.warehouse w ON w.id=m.warehouse_id
      WHERE m.user_id=v_operation.actor_id AND w.id=v_warehouse AND w.active FOR SHARE OF m,w;
    IF NOT FOUND THEN RAISE EXCEPTION 'Return staff scope requires every affected original warehouse' USING ERRCODE='23514'; END IF;
   END IF;
  END LOOP;
  IF v_operation.response IS DISTINCT FROM jsonb_build_object('case_id',v_case.id,'version',v_event.revision,'status',v_event.status)
  THEN RAISE EXCEPTION 'Staff return response is the immutable minimal scoped result' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT v_finance OR v_mfa.session_id IS NULL OR NOT v_user.two_factor_enabled
     OR v_mfa.verified_at<=clock_timestamp()-interval '5 minutes' OR v_session.expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'Refund money actions require current finance grants and fresh MFA' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_proof FROM app.access_proof WHERE digest=v_operation.proof_digest FOR SHARE;
  IF v_proof.digest IS NULL OR v_proof.session_id IS DISTINCT FROM v_session.id OR v_proof.action<>'finance.refund'
     OR v_proof.subject_id IS DISTINCT FROM v_operation.subject_id::text OR v_proof.consumed_at IS NULL
     OR v_proof.consumed_at<v_operation.created_at OR v_proof.expires_at<=v_proof.consumed_at
  THEN RAISE EXCEPTION 'Refund action atomically consumes its exact session/subject-bound proof' USING ERRCODE='23514'; END IF;
 END IF;
 IF (v_operation.actor_id IS NOT NULL AND v_session.expires_at<=clock_timestamp())
    OR (v_operation.guest_id IS NOT NULL AND (v_guest.expires_at<=clock_timestamp() OR v_access.expires_at<=clock_timestamp()))
 THEN RAISE EXCEPTION 'Return authority must remain current after scope/proof waits' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.actor_id IS NOT DISTINCT FROM v_operation.actor_id
    AND a.action=v_operation.action AND a.subject_id=v_operation.subject_id::text AND a.outcome='allowed'
    AND a.details->>'operation_id'=v_operation.id::text AND a.created_at>=v_operation.created_at)
 THEN RAISE EXCEPTION 'Return operation commits its original audit record' USING ERRCODE='23514'; END IF;
END;
$$;


-- Extend case and unit history with exact replacement causes; original refund
-- and operational transition branches retain their existing semantics.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_operation app.return_operation; v_refund_event app.refund_event; v_refund app.refund;
 v_replacement app.replacement_event; v_replacement_head app.replacement_shipment; v_replacement_op app.replacement_operation; v_replacement_job app.outbox_job;
BEGIN
 SELECT * INTO v_case FROM app.return_case WHERE id=NEW.case_id FOR UPDATE;
 IF v_case.id IS NULL OR (NEW.kind='create' AND (NEW.revision<>1 OR v_case.revision<>1))
    OR (NEW.kind<>'create' AND NEW.revision::bigint<>v_case.revision::bigint+1)
 THEN RAISE EXCEPTION 'Return event appends exactly one current case revision' USING ERRCODE='23514'; END IF;
 IF NEW.source_kind='operation' THEN
  SELECT * INTO v_operation FROM app.return_operation WHERE id=NEW.source_id;
  IF v_operation.id IS NULL OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR v_operation.subject_id IS DISTINCT FROM v_case.id OR v_operation.order_id IS DISTINCT FROM v_case.order_id
     OR v_operation.actor_id IS DISTINCT FROM NEW.actor_id
     OR v_operation.action IS DISTINCT FROM (CASE NEW.kind WHEN 'create' THEN 'return.create' WHEN 'decision' THEN 'return.decide'
       WHEN 'inspection' THEN 'return.inspect' WHEN 'refund_queue' THEN 'refund.queue' ELSE NULL END)
  THEN RAISE EXCEPTION 'Return transition requires its original unfinished authorized operation' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=CASE NEW.kind WHEN 'create' THEN v_case.created_at ELSE v_operation.occurred_at END;
 ELSIF NEW.source_kind='replacement' THEN
  SELECT * INTO v_replacement FROM app.replacement_event WHERE id=NEW.source_id;
  SELECT * INTO v_replacement_head FROM app.replacement_shipment WHERE id=v_replacement.shipment_id;
  IF v_replacement.id IS NULL OR v_replacement_head.case_id IS DISTINCT FROM v_case.id
     OR NEW.actor_id IS DISTINCT FROM v_replacement.actor_id OR NEW.kind NOT IN ('replacement_started','replacement_received')
  THEN RAISE EXCEPTION 'Replacement case transition retains its exact original affected physical event' USING ERRCODE='23514'; END IF;
  IF NEW.kind='replacement_started' THEN
   SELECT * INTO v_replacement_op FROM app.replacement_operation WHERE id=v_replacement.source_id;
   IF v_replacement.kind<>'create' OR v_replacement.source_kind<>'operation'
      OR v_replacement_op.id IS NULL OR v_replacement_op.action<>'create'
      OR v_replacement_op.created_xid<>pg_current_xact_id()::text OR v_replacement_op.response<>'{}'::jsonb
   THEN RAISE EXCEPTION 'Replacement initiation belongs to its unfinished creating operation' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT job.* INTO v_replacement_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id
    WHERE p.id=v_replacement.source_id;
   IF v_replacement.kind<>'receipt' OR v_replacement.source_kind<>'receipt' OR NEW.actor_id IS NOT NULL
      OR v_replacement_job.id IS NULL OR v_replacement_job.kind<>'replacement.receipt.callback' OR v_replacement_job.status<>'pending'
      OR EXISTS(SELECT 1 FROM app.replacement_receipt_result WHERE event_id=v_replacement.source_id)
   THEN RAISE EXCEPTION 'Replacement resolution belongs to the pending actual receipt callback' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.occurred_at:=v_replacement.occurred_at;
 ELSE
  SELECT * INTO v_refund_event FROM app.refund_event WHERE id=NEW.source_id;
  SELECT * INTO v_refund FROM app.refund WHERE id=v_refund_event.refund_id;
  IF v_refund.id IS NULL OR v_refund.case_id IS DISTINCT FROM v_case.id OR v_refund_event.source_kind<>'provider'
     OR (NEW.kind='refund_confirmed' AND (v_refund_event.kind<>'confirm' OR v_refund_event.status<>'succeeded'))
     OR (NEW.kind='refund_failed' AND (v_refund_event.kind<>'fail' OR v_refund_event.status<>'failed'))
     OR NEW.kind NOT IN ('refund_confirmed','refund_failed') OR NEW.actor_id IS NOT NULL
  THEN RAISE EXCEPTION 'Refund return transition retains its exact original financial event' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=v_refund_event.occurred_at;
 END IF;
 IF NEW.kind='create' THEN
  IF NEW.status<>'requested' OR NEW.resolution IS NOT NULL OR NEW.requires_goods IS NOT NULL OR NEW.source_id<>v_case.operation_id
  THEN RAISE EXCEPTION 'Return begins with its original buyer request' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='decision' THEN
  IF v_case.status NOT IN ('requested','reviewing','approved','awaiting_goods','inspecting')
     OR EXISTS(SELECT 1 FROM app.refund WHERE case_id=v_case.id)
     OR NEW.status NOT IN ('reviewing','rejected','approved','awaiting_goods','replacing')
     OR (NEW.status IN ('reviewing','rejected') AND (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods))
     OR (NEW.status IN ('approved','awaiting_goods','replacing') AND (NEW.resolution IS DISTINCT FROM v_case.requested_resolution OR NEW.requires_goods IS NULL))
  THEN RAISE EXCEPTION 'Return review preserves buyer resolution and precedes any refund obligation' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='inspection' THEN
  IF (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods)
     OR (v_case.status IN ('approved','awaiting_goods','inspecting') AND NEW.status NOT IN ('approved','inspecting','replacing'))
     OR (v_case.status NOT IN ('approved','awaiting_goods','inspecting') AND NEW.status<>v_case.status)
  THEN RAISE EXCEPTION 'Physical inspection cannot silently change a financial resolution' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='refund_queue' THEN
  IF v_case.status<>'approved' OR v_case.resolution<>'refund' OR NEW.status<>'refunding'
     OR (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods)
  THEN RAISE EXCEPTION 'Refund queue starts only from the approved original refund case' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind IN ('replacement_started','replacement_received') THEN
  IF v_case.status<>'replacing' OR v_case.resolution IS DISTINCT FROM 'replacement'
     OR NEW.status NOT IN ('replacing','resolved') OR (NEW.kind='replacement_started' AND NEW.status<>'replacing')
     OR (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods)
  THEN RAISE EXCEPTION 'Replacement advances only its original approved held case without another charge' USING ERRCODE='23514'; END IF;
 ELSE
  IF v_case.status<>'refunding' OR v_case.resolution<>'refund'
     OR NEW.status IS DISTINCT FROM (CASE NEW.kind WHEN 'refund_confirmed' THEN 'resolved' WHEN 'refund_failed' THEN 'refunding' ELSE NULL END)
     OR (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods)
  THEN RAISE EXCEPTION 'Refund outcome advances its original held case' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;


-- Extend case and unit history with exact replacement causes; original refund
-- and operational transition branches retain their existing semantics.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_item_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event app.return_event; v_item app.return_item; v_previous record; v_case app.return_case; v_operation app.return_operation; v_replacement app.replacement_event; v_replacement_op app.replacement_operation; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_event FROM app.return_event WHERE id=NEW.event_id AND case_id=NEW.case_id;
 SELECT * INTO v_item FROM app.return_item WHERE id=NEW.return_item_id AND case_id=NEW.case_id;
 SELECT * INTO v_case FROM app.return_case WHERE id=NEW.case_id;
 IF v_event.source_kind='operation' THEN
  SELECT * INTO v_operation FROM app.return_operation WHERE id=v_event.source_id;
  IF v_operation.created_xid IS DISTINCT FROM pg_current_xact_id()::text OR v_operation.response IS DISTINCT FROM '{}'::jsonb
  THEN RAISE EXCEPTION 'Unit history appends only with the unfinished current operation' USING ERRCODE='23514'; END IF;
 ELSIF v_event.source_kind='refund' AND EXISTS(SELECT 1 FROM app.refund_event_result WHERE refund_event_id=v_event.source_id) THEN
  RAISE EXCEPTION 'Committed historical refund unit transitions cannot be extended' USING ERRCODE='23514';
 ELSIF v_event.source_kind='replacement' THEN
  SELECT * INTO v_replacement FROM app.replacement_event WHERE id=v_event.source_id;
  IF v_replacement.kind='create' THEN
   SELECT * INTO v_replacement_op FROM app.replacement_operation WHERE id=v_replacement.source_id;
   IF v_replacement_op.id IS NULL OR v_replacement_op.created_xid<>pg_current_xact_id()::text OR v_replacement_op.response<>'{}'::jsonb
   THEN RAISE EXCEPTION 'Committed replacement initiation cannot gain later unit transitions' USING ERRCODE='23514'; END IF;
  ELSIF v_replacement.kind='receipt' THEN
   SELECT job.* INTO v_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_replacement.source_id;
   IF v_job.id IS NULL OR v_job.status<>'pending' OR EXISTS(SELECT 1 FROM app.replacement_receipt_result WHERE event_id=v_replacement.source_id)
   THEN RAISE EXCEPTION 'Committed replacement receipt cannot gain later unit transitions' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Replacement unit history requires its exact initiation or receipt cause' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT h.claim_state,h.inspection_status INTO v_previous FROM app.return_item_event h JOIN app.return_event e ON e.id=h.event_id
   WHERE h.return_item_id=NEW.return_item_id AND e.revision<v_event.revision ORDER BY e.revision DESC LIMIT 1;
 IF v_event.id IS NULL OR v_item.id IS NULL OR (NEW.claim_state,NEW.inspection_status) IS DISTINCT FROM (v_item.claim_state,v_item.inspection_status)
 THEN RAISE EXCEPTION 'Unit transition retains its exact case event and changed head' USING ERRCODE='23514'; END IF;
 IF v_event.kind='create' THEN
  IF v_previous IS NOT NULL OR NEW.claim_state<>'held' OR NEW.inspection_status<>'pending'
  THEN RAISE EXCEPTION 'Original unit history begins held and pending inspection' USING ERRCODE='23514'; END IF;
 ELSIF v_previous IS NULL THEN RAISE EXCEPTION 'Unit transition requires its original state history' USING ERRCODE='23514';
 ELSIF v_event.kind='decision' THEN
  IF NEW.claim_state IS DISTINCT FROM (CASE WHEN v_event.status='rejected' THEN 'released' ELSE v_previous.claim_state END)
     OR (v_event.status IN ('reviewing','rejected') AND NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status)
     OR (v_event.status IN ('approved','awaiting_goods','replacing') AND NEW.inspection_status IS DISTINCT FROM
       CASE WHEN v_event.requires_goods THEN CASE WHEN v_previous.inspection_status='waived' THEN 'pending' ELSE v_previous.inspection_status END
       WHEN v_previous.inspection_status='accepted' THEN 'accepted' ELSE 'waived' END)
  THEN RAISE EXCEPTION 'Review changes only its selected claim/inspection policy' USING ERRCODE='23514'; END IF;
 ELSIF v_event.kind='inspection' THEN
  IF NEW.claim_state IS DISTINCT FROM v_previous.claim_state
     OR (NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status AND NEW.inspection_status NOT IN ('accepted','rejected','needs_review'))
     OR (v_case.status IN ('refunding','resolved','replacing') AND NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status)
  THEN RAISE EXCEPTION 'Inspection cannot release quantities or rewrite started financial outcomes' USING ERRCODE='23514'; END IF;
 ELSIF v_event.kind='replacement_started' THEN
  IF v_previous.claim_state<>'held' OR NEW.claim_state<>'replacing' OR NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status
     OR NOT EXISTS(SELECT 1 FROM app.replacement_link WHERE shipment_id=v_replacement.shipment_id AND return_item_id=v_item.id)
  THEN RAISE EXCEPTION 'Replacement initiation holds only its selected complete physical quantities' USING ERRCODE='23514'; END IF;
 ELSIF v_event.kind='replacement_received' THEN
  IF v_previous.claim_state<>'replacing' OR NEW.claim_state<>'replaced' OR NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status
     OR NOT EXISTS(SELECT 1 FROM app.replacement_link link JOIN app.replacement_buyer_receipt receipt ON receipt.replacement_link_id=link.id
       WHERE link.shipment_id=v_replacement.shipment_id AND link.return_item_id=v_item.id AND receipt.source_id=v_replacement.source_id)
  THEN RAISE EXCEPTION 'Replacement receipt completes only the actually received affected quantities' USING ERRCODE='23514'; END IF;
 ELSIF v_event.kind='refund_confirmed' THEN
  IF v_previous.claim_state<>'held' OR NEW.claim_state<>'refunded' OR NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status
  THEN RAISE EXCEPTION 'Confirmed refund consumes only its held original complete units' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This case event does not change physical unit state' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;


-- Extend case and unit history with exact replacement causes; original refund
-- and operational transition branches retain their existing semantics.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_return_case(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_event app.return_event; v_item app.return_item; v_latest record; v_changed integer; v_total integer;
BEGIN
 SELECT * INTO v_case FROM app.return_case WHERE id=p_case_id FOR UPDATE;
 SELECT * INTO v_event FROM app.return_event WHERE case_id=p_case_id ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO v_total FROM app.return_item WHERE case_id=p_case_id;
 IF v_case.id IS NULL OR v_event.id IS NULL OR v_total NOT BETWEEN 1 AND 100
     OR (v_case.revision,v_case.status,v_case.resolution,v_case.requires_goods) IS DISTINCT FROM (v_event.revision,v_event.status,v_event.resolution,v_event.requires_goods)
     OR (SELECT count(*) FROM app.return_event WHERE case_id=p_case_id)<>v_case.revision
 THEN RAISE EXCEPTION 'Return case seals every exact contiguous event and original quantity' USING ERRCODE='23514'; END IF;
 FOR v_item IN SELECT * FROM app.return_item WHERE case_id=p_case_id ORDER BY id LOOP
  SELECT h.claim_state,h.inspection_status INTO v_latest FROM app.return_item_event h JOIN app.return_event e ON e.id=h.event_id
   WHERE h.return_item_id=v_item.id ORDER BY e.revision DESC LIMIT 1;
  IF NOT FOUND OR (v_item.claim_state,v_item.inspection_status) IS DISTINCT FROM (v_latest.claim_state,v_latest.inspection_status)
     OR (v_case.status='rejected' AND v_item.claim_state<>'released')
     OR (v_case.status IN ('approved','refunding','replacing','resolved') AND v_item.inspection_status NOT IN ('accepted','waived'))
     OR (v_case.status IN ('approved','awaiting_goods','inspecting','refunding') AND v_item.claim_state<>'held')
     OR (v_case.status='replacing' AND v_item.claim_state NOT IN ('held','replacing','replaced'))
     OR (v_case.status='resolved' AND v_item.claim_state IS DISTINCT FROM (CASE v_case.resolution WHEN 'replacement' THEN 'replaced' WHEN 'refund' THEN 'refunded' ELSE NULL END))
     OR (v_item.inspection_status='accepted' AND NOT EXISTS(SELECT 1 FROM app.return_goods g JOIN app.return_item original ON original.id=g.return_item_id
       WHERE original.fulfillment_item_id=v_item.fulfillment_item_id AND original.replacement_link_id IS NOT DISTINCT FROM v_item.replacement_link_id))
  THEN RAISE EXCEPTION 'Return unit head and eligibility retain their actual event/intake history' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR v_event IN SELECT * FROM app.return_event WHERE case_id=p_case_id ORDER BY revision LOOP
  SELECT count(*) INTO v_changed FROM app.return_item_event WHERE event_id=v_event.id;
  IF (v_event.kind IN ('create','decision','refund_confirmed') AND v_changed<>v_total)
     OR (v_event.kind IN ('inspection','replacement_started','replacement_received') AND v_changed NOT BETWEEN 1 AND v_total)
     OR (v_event.kind IN ('refund_queue','refund_failed') AND v_changed<>0)
  THEN RAISE EXCEPTION 'Return event changes exactly its required physical unit set' USING ERRCODE='23514'; END IF;
  IF (v_event.kind='replacement_started' AND v_changed IS DISTINCT FROM (
       SELECT count(*)::int FROM app.replacement_link link JOIN app.replacement_event cause ON cause.shipment_id=link.shipment_id
        WHERE cause.id=v_event.source_id AND cause.kind='create'))
     OR (v_event.kind='replacement_received' AND v_changed IS DISTINCT FROM (
       SELECT count(*)::int FROM app.replacement_buyer_receipt receipt JOIN app.replacement_link link ON link.id=receipt.replacement_link_id
        JOIN app.replacement_event cause ON cause.shipment_id=link.shipment_id AND cause.source_id=receipt.source_id AND cause.kind='receipt'
        WHERE cause.id=v_event.source_id))
  THEN RAISE EXCEPTION 'Replacement case history changes exactly its selected initiation or first actual receipt set' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;

-- Provider result and booking seals preserve historical attempts. New terminal
-- evidence may precede callback registration, but a physical transition and its
-- exact callback completion cannot commit separately.
--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_replacement_event; v_provider app.local_replacement_operation;
 v_booking app.replacement_booking; v_head app.replacement_shipment; v_event app.replacement_event; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_source FROM app.local_replacement_event WHERE id=NEW.event_id;
 SELECT * INTO v_provider FROM app.local_replacement_operation WHERE id=v_source.operation_id;
 SELECT * INTO v_booking FROM app.replacement_booking WHERE id=v_provider.booking_id;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_booking.shipment_id;
 SELECT * INTO v_event FROM app.replacement_event WHERE id=NEW.replacement_event_id;
 SELECT job.* INTO v_job FROM app.replacement_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=NEW.event_id;
 IF v_source.id IS NULL OR v_provider.id IS NULL OR v_booking.id IS NULL OR v_head.id IS NULL
    OR v_head.booking_id IS DISTINCT FROM v_booking.id OR v_booking.provider_operation_id IS DISTINCT FROM v_provider.id
    OR v_provider.status IS DISTINCT FROM v_source.status OR v_booking.status IS DISTINCT FROM v_source.status
    OR NEW.outcome IS DISTINCT FROM v_source.status OR NEW.shipment_id IS DISTINCT FROM v_head.id OR NEW.revision IS DISTINCT FROM v_head.revision
    OR v_event.id IS NULL OR v_event.shipment_id IS DISTINCT FROM v_head.id OR v_event.revision IS DISTINCT FROM NEW.revision
    OR v_event.source_kind<>'provider' OR v_event.source_id IS DISTINCT FROM v_source.id
    OR v_event.kind IS DISTINCT FROM (CASE v_source.status WHEN 'issued' THEN 'waybill_issued' WHEN 'failed' THEN 'waybill_failed' END)
    OR v_event.occurred_at IS DISTINCT FROM v_source.occurred_at
    OR v_job.id IS NULL OR v_job.kind<>'replacement.shipping.callback' OR v_job.status<>'pending'
 THEN RAISE EXCEPTION 'Replacement terminal result retains its exact original source, physical transition and pending callback' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_result_guard BEFORE INSERT ON app.replacement_event_result
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_result();

--> statement-breakpoint
CREATE FUNCTION app.seal_replacement_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_result app.replacement_event_result; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_result FROM app.replacement_event_result WHERE event_id=NEW.event_id;
 SELECT job.* INTO v_job FROM app.replacement_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_result.event_id;
 IF v_job.id IS NULL OR v_job.status<>'completed'
    OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_result.event_id,'outcome',v_result.outcome,'version',v_result.revision)
 THEN RAISE EXCEPTION 'Replacement waybill effects and exact callback completion are atomic' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_replacement_shipment(v_result.shipment_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_result_sealed AFTER INSERT ON app.replacement_event_result
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_result();

--> statement-breakpoint
CREATE FUNCTION app.seal_replacement_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_booking app.replacement_booking; v_head app.replacement_shipment; v_job app.outbox_job;
 v_provider app.local_replacement_operation; v_terminal app.local_replacement_event; v_result app.replacement_event_result; v_count int;
BEGIN
 SELECT * INTO v_booking FROM app.replacement_booking WHERE id=NEW.id;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_booking.shipment_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=v_booking.creation_job_id;
 SELECT * INTO v_provider FROM app.local_replacement_operation WHERE booking_id=v_booking.id;
 SELECT * INTO v_terminal FROM app.local_replacement_event WHERE operation_id=v_provider.id;
 SELECT * INTO v_result FROM app.replacement_event_result WHERE event_id=v_terminal.id;
 SELECT count(*) INTO v_count FROM app.replacement_booking WHERE shipment_id=v_booking.shipment_id AND attempt<=v_booking.attempt;
 IF v_head.id IS NULL OR v_job.id IS NULL OR v_count<>v_booking.attempt
    OR v_job.kind<>'replacement.shipping.create' OR v_job.payload IS DISTINCT FROM jsonb_build_object('bookingId',v_booking.id)
    OR v_job.dedup_key IS DISTINCT FROM 'replacement-shipping-create:'||v_booking.id::text
    OR NOT EXISTS(SELECT 1 FROM app.replacement_event e WHERE e.shipment_id=v_booking.shipment_id AND e.kind='book'
      AND e.source_kind='operation' AND e.source_id=v_booking.operation_id AND e.snapshot->>'booking_id'=v_booking.id::text)
    OR v_booking.provider_operation_id IS DISTINCT FROM v_provider.id
    OR (v_booking.status='queued' AND v_provider.id IS NOT NULL)
    OR (v_booking.status<>'queued' AND v_provider.id IS NULL)
    OR (v_booking.status IN ('issued','failed') AND (v_terminal.id IS NULL OR v_terminal.status IS DISTINCT FROM v_booking.status
      OR v_result.event_id IS NULL OR v_result.outcome IS DISTINCT FROM v_booking.status OR v_result.shipment_id IS DISTINCT FROM v_head.id))
    OR (v_booking.status IN ('queued','processing','unknown') AND v_result.event_id IS NOT NULL)
    OR (v_head.booking_id IS DISTINCT FROM v_booking.id AND v_booking.status<>'failed')
    OR (v_head.booking_id=v_booking.id AND (
       (v_booking.status IN ('queued','processing') AND v_head.status<>'booking_pending')
       OR (v_booking.status='unknown' AND v_head.status<>'booking_unknown')
       OR (v_booking.status='failed' AND v_head.status<>'booking_failed')
       OR (v_booking.status='issued' AND v_head.status NOT IN ('packed','handed_over','partially_delivered','delivered'))))
 THEN RAISE EXCEPTION 'Replacement booking seals its contiguous attempt, exact source root and actual physical milestone' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_replacement_shipment(v_head.id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_booking_sealed AFTER INSERT OR UPDATE ON app.replacement_booking
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_replacement_booking();

-- Job seals use plain domain reads. In particular, creation-job recovery owns
-- UPDATE on that job while a late source creator can hold the physical head
-- before requesting SHARE on the job: taking the head here would deadlock.
--> statement-breakpoint
CREATE FUNCTION app.seal_replacement_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_job app.outbox_job; v_booking app.replacement_booking; v_provider app.local_replacement_operation;
 v_registration app.replacement_provider_event; v_result app.replacement_event_result;
 v_receipt_registration app.replacement_receipt_provider_event; v_receipt app.replacement_receipt_result;
BEGIN
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.id;
 IF v_job.kind='replacement.shipping.create' THEN
  SELECT * INTO v_booking FROM app.replacement_booking WHERE creation_job_id=v_job.id;
  SELECT * INTO v_provider FROM app.local_replacement_operation WHERE booking_id=v_booking.id;
  IF v_booking.id IS NULL OR v_job.payload IS DISTINCT FROM jsonb_build_object('bookingId',v_booking.id)
     OR v_job.dedup_key IS DISTINCT FROM 'replacement-shipping-create:'||v_booking.id::text
     OR (v_job.status='completed' AND (v_provider.id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('operation_id',v_provider.id)))
     OR (v_job.status IN ('pending','failed') AND v_provider.id IS NOT NULL)
     OR (v_job.status<>'completed' AND v_job.result IS NOT NULL)
  THEN RAISE EXCEPTION 'Replacement creation job retains its exact fenced original source or proven no-effect state' USING ERRCODE='23514'; END IF;
 ELSIF v_job.kind='replacement.shipping.callback' THEN
  SELECT * INTO v_registration FROM app.replacement_provider_event WHERE callback_job_id=v_job.id;
  SELECT * INTO v_result FROM app.replacement_event_result WHERE event_id=v_registration.id;
  IF v_registration.id IS NULL OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_registration.id)
     OR v_job.dedup_key IS DISTINCT FROM 'replacement-shipping-callback:'||v_registration.id::text
     OR (v_job.status='completed' AND (v_result.event_id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_result.event_id,'outcome',v_result.outcome,'version',v_result.revision)))
     OR (v_job.status<>'completed' AND (v_result.event_id IS NOT NULL OR v_job.result IS NOT NULL))
  THEN RAISE EXCEPTION 'Replacement waybill callback completion retains its exact immutable historical result' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_receipt_registration FROM app.replacement_receipt_provider_event WHERE callback_job_id=v_job.id;
  SELECT * INTO v_receipt FROM app.replacement_receipt_result WHERE event_id=v_receipt_registration.id;
  IF v_receipt_registration.id IS NULL OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_receipt_registration.id)
     OR v_job.dedup_key IS DISTINCT FROM 'replacement-receipt-callback:'||v_receipt_registration.id::text
     OR (v_job.status='completed' AND (v_receipt.event_id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_receipt.event_id,'outcome',v_receipt.outcome,'receipt_count',v_receipt.receipt_count,'version',v_receipt.revision)))
     OR (v_job.status<>'completed' AND (v_receipt.event_id IS NOT NULL OR v_job.result IS NOT NULL))
  THEN RAISE EXCEPTION 'Replacement receipt callback completion retains its exact immutable affected-unit result' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_job_sealed AFTER INSERT OR UPDATE ON app.outbox_job
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind IN ('replacement.shipping.create','replacement.shipping.callback','replacement.receipt.callback'))
 EXECUTE FUNCTION app.seal_replacement_job();

--> statement-breakpoint
CREATE FUNCTION app.guard_replacement_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_booking app.replacement_booking; v_source app.local_replacement_operation; v_subject uuid; v_action text; v_audit boolean:=false;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.kind IN ('replacement.shipping.create','replacement.shipping.callback','replacement.receipt.callback')
  THEN RAISE EXCEPTION 'Original replacement jobs and completed results are retained' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.kind NOT IN ('replacement.shipping.create','replacement.shipping.callback','replacement.receipt.callback') THEN RETURN NEW; END IF;
  IF NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.max_attempts<>5 OR NEW.last_error IS NOT NULL OR NEW.completed_at IS NOT NULL
     OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.dispatched_at IS NOT NULL OR NEW.result IS NOT NULL
  THEN RAISE EXCEPTION 'Replacement jobs begin as exact new pending intents without invented effects' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.kind NOT IN ('replacement.shipping.create','replacement.shipping.callback','replacement.receipt.callback')
    AND NEW.kind NOT IN ('replacement.shipping.create','replacement.shipping.callback','replacement.receipt.callback') THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','run_at','attempts','last_error','completed_at','lease_token','lease_until','dispatched_at','result'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','run_at','attempts','last_error','completed_at','lease_token','lease_until','dispatched_at','result'])
    OR (OLD.status='completed' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Original replacement job identity and completed result are immutable' USING ERRCODE='23514'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF NEW.attempts>NEW.max_attempts THEN RAISE EXCEPTION 'Replacement jobs retain their original bounded attempt budget' USING ERRCODE='23514'; END IF;
 IF OLD.kind IN ('replacement.shipping.create','replacement.shipping.callback') THEN
  v_action:='local.replacement_shipping.reconcile';
  IF OLD.kind='replacement.shipping.create' THEN SELECT * INTO v_booking FROM app.replacement_booking WHERE creation_job_id=OLD.id;
  ELSE SELECT b.* INTO v_booking FROM app.replacement_provider_event p JOIN app.local_replacement_event e ON e.id=p.id
    JOIN app.local_replacement_operation op ON op.id=e.operation_id JOIN app.replacement_booking b ON b.id=op.booking_id WHERE p.callback_job_id=OLD.id; END IF;
  v_subject:=v_booking.id;
  SELECT * INTO v_source FROM app.local_replacement_operation WHERE booking_id=v_booking.id;
 ELSE
  v_action:='local.replacement_receipt.reconcile';SELECT id INTO v_subject FROM app.replacement_receipt_provider_event WHERE callback_job_id=OLD.id;
 END IF;
 IF NEW.status IN ('pending','unknown') AND NEW.last_error IS NULL AND NEW.completed_at IS NULL AND NEW.result IS NULL
    AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL AND NEW.run_at>=transaction_timestamp() THEN
  SELECT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.actor_id IS NULL AND a.action=v_action AND a.subject_id=v_subject::text
    AND a.outcome='allowed' AND a.created_at>=transaction_timestamp() AND a.details->>'job_id'=OLD.id::text
    AND a.details->>'previous_status'=OLD.status AND a.details->>'previous_attempts'=OLD.attempts::text
    AND a.details->>'previous_error' IS NOT DISTINCT FROM OLD.last_error
    AND (v_action='local.replacement_receipt.reconcile' OR (a.details->>'previous_dispatched_at')::timestamptz IS NOT DISTINCT FROM OLD.dispatched_at)
    AND (OLD.kind<>'replacement.shipping.create' OR a.details->>'source_absence_verified'=(v_source.id IS NULL)::text)) INTO v_audit;
 END IF;
 IF v_audit THEN
  IF OLD.kind='replacement.shipping.create' THEN
   IF OLD.status NOT IN ('failed','unknown')
      OR (v_source.id IS NULL AND (NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.dispatched_at IS NOT NULL))
      OR (v_source.id IS NOT NULL AND (NEW.status<>'unknown' OR NEW.attempts<>OLD.attempts OR NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at))
   THEN RAISE EXCEPTION 'Original replacement source recovery uses absence fencing and retains known provider identity' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status NOT IN ('pending','failed','unknown') OR NEW.status<>'pending' OR NEW.dispatched_at IS NOT NULL
     OR NEW.attempts IS DISTINCT FROM (CASE WHEN OLD.kind='replacement.shipping.callback' OR OLD.status IN ('failed','unknown') THEN 0 ELSE OLD.attempts END)
  THEN RAISE EXCEPTION 'Replacement callback recovery resets only its original audited failed attempt' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.kind='replacement.shipping.create' THEN
  IF NOT (
    (OLD.status IN ('pending','unknown') AND NEW.status='processing' AND NEW.attempts=OLD.attempts+CASE WHEN OLD.status='pending' THEN 1 ELSE 0 END
      AND NEW.lease_token IS NOT NULL AND NEW.lease_until>clock_timestamp()
      AND NEW.dispatched_at IS NOT DISTINCT FROM (CASE WHEN OLD.status='pending' THEN NULL ELSE OLD.dispatched_at END) AND NEW.result IS NULL AND NEW.completed_at IS NULL)
    OR (OLD.status='processing' AND NEW.status='processing' AND NEW.lease_token=OLD.lease_token AND NEW.attempts=OLD.attempts
      AND NEW.lease_until>clock_timestamp() AND (OLD.dispatched_at IS NULL OR NEW.dispatched_at IS NOT DISTINCT FROM OLD.dispatched_at)
      AND NEW.result IS NULL AND NEW.completed_at IS NULL)
    OR (OLD.status='processing' AND NEW.status IN ('pending','unknown','failed','completed') AND NEW.attempts=OLD.attempts
      AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL
      AND (NEW.status<>'completed' OR (OLD.lease_until>clock_timestamp() AND OLD.dispatched_at IS NOT NULL))
      AND (NEW.status<>'unknown' OR NEW.dispatched_at IS NOT NULL)
      AND (NEW.status NOT IN ('pending','failed') OR v_source.id IS NULL))
   ) THEN RAISE EXCEPTION 'Replacement creation recovery preserves its leased identity and definitive no-effect retry boundary' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT (OLD.status='pending' AND NEW.status IN ('pending','failed','completed') AND NEW.attempts=OLD.attempts+1
    AND NEW.attempts<=NEW.max_attempts AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL AND NEW.dispatched_at IS NULL
    AND ((NEW.status='completed' AND NEW.last_error IS NULL AND NEW.completed_at IS NOT NULL AND NEW.result IS NOT NULL)
      OR (NEW.status='failed' AND NEW.last_error IS NOT NULL AND NEW.completed_at IS NOT NULL AND NEW.result IS NULL)
      OR (NEW.status='pending' AND NEW.last_error IS NOT NULL AND NEW.completed_at IS NULL AND NEW.result IS NULL)))
  THEN RAISE EXCEPTION 'Replacement database callbacks complete atomically or retain their bounded failed attempt' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER replacement_job_guard BEFORE INSERT OR UPDATE OR DELETE ON app.outbox_job
 FOR EACH ROW EXECUTE FUNCTION app.guard_replacement_job();

-- Attribution is a private server context. The current rate is derived from
-- its locked stream at real database time, never from the fixture clock or a
-- client as-of field. Frozen original quotes/orders remain immutable history.
--> statement-breakpoint
CREATE FUNCTION app.assert_attributed_checkout_cost(p_document jsonb,p_buyer text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_account app.affiliate_account; v_grant app.role_grant; v_policy app.policy_version; v_rate app.affiliate_rate_version;
 v_publication app.publication_version; v_assumption app.offer_cost_assumption_version; v_product uuid;
 v_line jsonb; v_source jsonb; v_expected jsonb; v_plan jsonb:=p_document->'selected_plan'; v_segment record;
 v_at timestamptz; v_user text; v_bps int; v_commission numeric; v_floor numeric;
 v_costs jsonb; v_hpp numeric; v_known boolean; v_subsidy numeric; v_worst numeric; v_contribution numeric; v_needs boolean; v_bounded boolean; v_exception boolean;
BEGIN
 IF NOT (p_document ? 'affiliate_id') THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_document->'financial_sources') source
    WHERE source ?| ARRAY['affiliate_id','rate_version_id','commission_bps','commission_idr'])
  THEN RAISE EXCEPTION 'Private commission sources require their explicit original affiliate context' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 IF jsonb_typeof(p_document->'affiliate_id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_document->'financial_sources') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_plan->'lines') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_document->'financial_sources') IS DISTINCT FROM jsonb_array_length(v_plan->'lines')
    OR (SELECT count(*)<>count(DISTINCT source->>'line_id') FROM jsonb_array_elements(p_document->'financial_sources') source)
 THEN RAISE EXCEPTION 'Attributed checkout binds exactly one private financial source per purchased line' USING ERRCODE='23514'; END IF;
 SELECT user_id INTO v_user FROM app.affiliate_account WHERE id=(p_document->>'affiliate_id')::uuid;
 IF v_user IS NULL THEN RAISE EXCEPTION 'Attributed checkout requires an existing affiliate identity' USING ERRCODE='23514'; END IF;
 PERFORM id FROM app.auth_user WHERE id=v_user OR id=p_buyer ORDER BY id FOR SHARE;
 SELECT * INTO v_account FROM app.affiliate_account WHERE id=(p_document->>'affiliate_id')::uuid FOR SHARE;
 SELECT * INTO v_grant FROM app.role_grant WHERE user_id=v_account.user_id FOR SHARE;
 IF v_account.status<>'active' OR v_grant.user_id IS NULL OR NOT ('affiliate'=ANY(v_grant.roles))
    OR NOT EXISTS(SELECT 1 FROM app.auth_user WHERE id=v_account.user_id AND email_verified)
    OR v_account.user_id=p_buyer
 THEN RAISE EXCEPTION 'Attributed checkout requires current verified affiliate authority and excludes self purchase' USING ERRCODE='23514'; END IF;
 PERFORM id FROM app.product WHERE id IN (SELECT (line->>'product_id')::uuid FROM jsonb_array_elements(v_plan->'lines') line) ORDER BY id FOR SHARE;
 PERFORM product_id FROM app.publication_head WHERE product_id IN (SELECT (line->>'product_id')::uuid FROM jsonb_array_elements(v_plan->'lines') line) ORDER BY product_id FOR SHARE;
 FOR v_product IN SELECT DISTINCT (line->>'product_id')::uuid FROM jsonb_array_elements(v_plan->'lines') line ORDER BY 1 LOOP
  SELECT p.* INTO v_publication FROM app.publication_head h JOIN app.publication_version p ON p.product_id=h.product_id AND p.revision=h.revision WHERE h.product_id=v_product;
  PERFORM s.id FROM app.stock_item s WHERE s.id IN (
   SELECT c.stock_item_id FROM app.offer_revision o JOIN app.offer_component c ON c.product_id=o.product_id AND c.revision=o.revision AND c.offer_id=o.offer_id
    WHERE o.product_id=v_product AND o.revision=v_publication.product_revision AND NOT o.retired) ORDER BY s.id FOR SHARE;
  PERFORM o.id FROM app.offer o WHERE o.id IN (SELECT offer_id FROM app.offer_revision WHERE product_id=v_product AND revision=v_publication.product_revision AND NOT retired) ORDER BY o.id FOR SHARE;
 END LOOP;
 PERFORM id FROM app.policy_head WHERE kind='commercial' AND warehouse_id IS NULL FOR SHARE;
 v_at:=clock_timestamp();
 SELECT p.* INTO v_policy FROM app.policy_head h JOIN app.policy_version p ON p.head_id=h.id
  WHERE h.kind='commercial' AND h.warehouse_id IS NULL AND p.effective_at<=v_at ORDER BY p.effective_at DESC,p.revision DESC LIMIT 1;
 SELECT * INTO v_rate FROM app.affiliate_rate_version WHERE affiliate_id=v_account.id AND effective_at<=v_at ORDER BY effective_at DESC,revision DESC LIMIT 1;
 v_bps:=coalesce(v_rate.basis_points,(v_policy.values->>'default_commission_bps')::int);
 v_floor:=coalesce((v_policy.values->>'minimum_contribution_idr')::numeric,0);
 v_commission:=floor((99000::numeric*v_bps+5000)/10000);
 IF v_policy.id IS NULL OR v_bps IS NULL OR v_bps NOT BETWEEN 0 AND 10000
 THEN RAISE EXCEPTION 'Attributed checkout uses its actual current commercial policy and effective override' USING ERRCODE='23514'; END IF;
 FOR v_line IN SELECT value FROM jsonb_array_elements(v_plan->'lines') LOOP
  SELECT value INTO v_source FROM jsonb_array_elements(p_document->'financial_sources') WHERE value->>'line_id'=v_line->>'line_id';
  SELECT p.* INTO v_publication FROM app.publication_head h JOIN app.publication_version p ON p.product_id=h.product_id AND p.revision=h.revision
   WHERE h.product_id=(v_line->>'product_id')::uuid;
  IF v_source IS NULL OR v_publication.id IS NULL OR v_publication.id::text IS DISTINCT FROM v_line->>'publication_id'
     OR v_publication.product_revision IS DISTINCT FROM (v_line->>'product_revision')::int OR v_publication.policy_version_id IS DISTINCT FROM v_policy.id
     OR NOT EXISTS(SELECT 1 FROM app.publication_offer WHERE publication_id=v_publication.id AND offer_id=(v_line->>'offer_id')::uuid)
     OR EXISTS(SELECT 1 FROM app.publication_offer o WHERE o.publication_id=v_publication.id AND o.assumption_version_id IS DISTINCT FROM (
       SELECT id FROM app.offer_cost_assumption_version WHERE offer_id=o.offer_id AND effective_at<=v_at ORDER BY effective_at DESC,revision DESC LIMIT 1))
     OR EXISTS(SELECT 1 FROM app.publication_component_cost c WHERE c.publication_id=v_publication.id AND c.cost_version_id IS DISTINCT FROM (
       SELECT id FROM app.component_cost_version WHERE stock_item_id=c.stock_item_id AND effective_at<=v_at ORDER BY effective_at DESC,revision DESC LIMIT 1))
  THEN RAISE EXCEPTION 'Attributed checkout retains its current publication and exact effective cost sources' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_assumption FROM app.offer_cost_assumption_version WHERE offer_id=(v_line->>'offer_id')::uuid AND effective_at<=v_at ORDER BY effective_at DESC,revision DESC LIMIT 1;
  SELECT jsonb_agg(cost.id ORDER BY c.stock_item_id),CASE WHEN bool_or(cost.unit_cost IS NULL) THEN NULL ELSE sum(c.quantity::numeric*cost.unit_cost) END
   INTO v_costs,v_hpp FROM app.offer_component c LEFT JOIN LATERAL (
     SELECT id,unit_cost FROM app.component_cost_version WHERE stock_item_id=c.stock_item_id AND effective_at<=v_at ORDER BY effective_at DESC,revision DESC LIMIT 1
   ) cost ON true WHERE c.product_id=v_publication.product_id AND c.revision=v_publication.product_revision AND c.offer_id=(v_line->>'offer_id')::uuid;
  v_known:=v_hpp IS NOT NULL AND v_assumption.id IS NOT NULL AND v_assumption.packaging_idr IS NOT NULL
    AND v_assumption.provider_fee_idr IS NOT NULL AND v_assumption.subsidy_idr IS NOT NULL AND v_assumption.returns_reserve_idr IS NOT NULL;
  v_subsidy:=0;v_exception:=false;
  FOR v_segment IN
   SELECT share.quantity,share.amount FROM jsonb_array_elements(v_plan->'packages') parcel
    CROSS JOIN LATERAL app.commerce_parcel_line_money(parcel,(
      SELECT coalesce(sum((shipment->>'amount')::numeric),0)::bigint FROM jsonb_array_elements(p_document->'promotions') promotion
       CROSS JOIN LATERAL jsonb_array_elements(promotion->'shipments') shipment WHERE shipment->>'shipment_id'=parcel->>'id'
    )) share WHERE share.line_id=(v_line->>'line_id')::uuid
  LOOP
   v_subsidy:=v_subsidy+v_segment.amount;v_worst:=ceil(v_segment.amount::numeric/v_segment.quantity);
   v_contribution:=CASE WHEN v_known THEN 99000-v_hpp-v_assumption.packaging_idr-v_assumption.provider_fee_idr-v_assumption.returns_reserve_idr-v_commission-v_worst END;
   v_needs:=v_contribution IS NULL OR v_contribution<v_floor;
   v_bounded:=v_publication.exception_reason IS NOT NULL AND v_bps<=v_publication.commission_bps
     AND (v_worst=0 OR (v_assumption.subsidy_idr IS NOT NULL AND v_worst<=v_assumption.subsidy_idr));
   IF v_needs AND NOT v_bounded THEN RAISE EXCEPTION 'Actual affiliate cost cannot exceed the frozen owner exception or contribution floor' USING ERRCODE='23514'; END IF;
   IF v_needs THEN v_exception:=true; END IF;
  END LOOP;
  v_expected:=jsonb_build_object('line_id',v_line->>'line_id','publication_id',v_publication.id,'policy_version_id',v_policy.id,
   'assumption_version_id',v_assumption.id,'component_cost_version_ids',v_costs,'allocated_subsidy',v_subsidy,'exception_applied',v_exception,
   'affiliate_id',v_account.id,'rate_version_id',v_rate.id,'commission_bps',v_bps,'commission_idr',v_commission);
  IF v_source IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Attributed checkout freezes independently derived rate, costs and per-unit exception bounds' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION app.guard_attributed_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_buyer text;
BEGIN
 SELECT owner_user_id INTO v_buyer FROM app.cart WHERE id=NEW.cart_id;
 PERFORM app.assert_attributed_checkout_cost(NEW.document,v_buyer); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checkout_affiliate_cost_guard BEFORE INSERT ON app.checkout_quote
 FOR EACH ROW EXECUTE FUNCTION app.guard_attributed_quote();

--> statement-breakpoint
CREATE FUNCTION app.seal_attributed_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_document jsonb;
BEGIN
 SELECT * INTO v_order FROM app.commerce_order WHERE id=NEW.id;
 SELECT document INTO v_document FROM app.checkout_quote WHERE id=v_order.quote_id;
 PERFORM app.assert_attributed_checkout_cost(v_document,v_order.owner_user_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commerce_order_affiliate_cost_sealed AFTER INSERT ON app.commerce_order
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_attributed_order();
