CREATE TABLE "app"."commerce_exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"proposal_event_id" uuid,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_xid" text DEFAULT pg_current_xact_id()::text NOT NULL,
	CONSTRAINT "commerce_exception_source_unique" UNIQUE("source_kind","source_id"),
	CONSTRAINT "commerce_exception_kind_identity" UNIQUE("id","kind"),
	CONSTRAINT "commerce_exception_kind_check" CHECK ("app"."commerce_exception"."kind" IN ('late_collection','unallocated_collection','stock_discrepancy','cod_refusal','delivery_failure','replacement_stock','waybill_uncertain') AND "app"."commerce_exception"."source_kind" IN ('payment_event','cod_event','stock_report','parcel_outcome','replacement','booking')),
	CONSTRAINT "commerce_exception_state_check" CHECK ((("app"."commerce_exception"."status"='preparing' AND "app"."commerce_exception"."revision"=0) OR ("app"."commerce_exception"."status" IN ('open','awaiting_source','awaiting_buyer','awaiting_stock','awaiting_return','ready_for_refund','refunding','unknown','resolved','escalated') AND "app"."commerce_exception"."revision">0)) AND char_length("app"."commerce_exception"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."exception_cancellation" (
	"exception_unit_id" uuid PRIMARY KEY NOT NULL,
	"exception_id" uuid NOT NULL,
	"fulfillment_item_id" uuid NOT NULL,
	"replacement_link_id" uuid,
	"stock_disposition" text NOT NULL,
	"stock_report_operation_id" uuid,
	"physical_source_id" uuid,
	"event_id" uuid NOT NULL,
	"consent_event_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exception_cancel_replacement_unique" UNIQUE("replacement_link_id"),
	CONSTRAINT "exception_cancellation_stock_check" CHECK ("app"."exception_cancellation"."stock_disposition" IN ('released','consumed','not_reserved') AND ("app"."exception_cancellation"."stock_disposition"<>'consumed' OR "app"."exception_cancellation"."physical_source_id" IS NOT NULL) AND ("app"."exception_cancellation"."stock_disposition"<>'not_reserved' OR "app"."exception_cancellation"."replacement_link_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."exception_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_id" text,
	"cause_event_id" uuid,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "exception_event_revision_unique" UNIQUE("exception_id","revision"),
	CONSTRAINT "exception_event_case_identity" UNIQUE("exception_id","id"),
	CONSTRAINT "exception_event_source_unique" UNIQUE("exception_id","source_kind","source_id","kind"),
	CONSTRAINT "exception_event_value_check" CHECK ("app"."exception_event"."revision">0 AND "app"."exception_event"."kind" IN ('open','stock_report','propose','buyer_accept','buyer_decline','escalate','cancel','intake','refund_queue','refund_confirmed','refund_failed','source_reconciled','resolved') AND "app"."exception_event"."status" IN ('open','awaiting_source','awaiting_buyer','awaiting_stock','awaiting_return','ready_for_refund','refunding','unknown','resolved','escalated') AND "app"."exception_event"."source_kind" IN ('operation','payment','cod','parcel','job','refund','replacement') AND ("app"."exception_event"."source_kind"='operation' OR "app"."exception_event"."actor_id" IS NULL) AND (("app"."exception_event"."kind" IN ('buyer_accept','buyer_decline'))=("app"."exception_event"."cause_event_id" IS NOT NULL)) AND char_length("app"."exception_event"."reason") between 1 and 500 AND jsonb_typeof("app"."exception_event"."snapshot")='object' AND octet_length("app"."exception_event"."snapshot"::text)<=65536)
);
--> statement-breakpoint
CREATE TABLE "app"."exception_goods_intake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"physical_outcome_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exception_goods_intake_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "exception_intake_case_identity" UNIQUE("exception_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."exception_goods_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"intake_id" uuid NOT NULL,
	"exception_unit_id" uuid NOT NULL,
	"stock_item_id" uuid,
	"balance_id" uuid,
	"quantity" integer NOT NULL,
	"identity_confirmed" boolean NOT NULL,
	"stock_movement_id" uuid,
	CONSTRAINT "exception_goods_line_stock_movement_id_unique" UNIQUE("stock_movement_id"),
	CONSTRAINT "exception_goods_line_value_check" CHECK ("app"."exception_goods_line"."quantity" between 1 and 1000000 AND (("app"."exception_goods_line"."identity_confirmed" AND "app"."exception_goods_line"."stock_item_id" IS NOT NULL AND "app"."exception_goods_line"."balance_id" IS NOT NULL AND "app"."exception_goods_line"."stock_movement_id" IS NOT NULL) OR (NOT "app"."exception_goods_line"."identity_confirmed" AND "app"."exception_goods_line"."stock_item_id" IS NULL AND "app"."exception_goods_line"."balance_id" IS NULL AND "app"."exception_goods_line"."stock_movement_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."exception_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_scope" text NOT NULL,
	"actor_id" text,
	"guest_id" uuid,
	"session_id" text,
	"action" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"proof_digest" text,
	"input" jsonb NOT NULL,
	"response" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_xid" text DEFAULT pg_current_xact_id()::text NOT NULL,
	CONSTRAINT "exception_operation_proof_digest_unique" UNIQUE("proof_digest"),
	CONSTRAINT "exception_operation_key_unique" UNIQUE("actor_scope","action","key"),
	CONSTRAINT "exception_operation_actor_check" CHECK (("app"."exception_operation"."actor_id" IS NOT NULL AND "app"."exception_operation"."guest_id" IS NULL AND "app"."exception_operation"."session_id" IS NOT NULL AND "app"."exception_operation"."actor_scope"='user:'||"app"."exception_operation"."actor_id") OR ("app"."exception_operation"."actor_id" IS NULL AND "app"."exception_operation"."guest_id" IS NOT NULL AND "app"."exception_operation"."session_id" IS NULL AND "app"."exception_operation"."actor_scope"='guest:'||"app"."exception_operation"."guest_id"::text)),
	CONSTRAINT "exception_operation_value_check" CHECK ("app"."exception_operation"."action" IN ('report','decide','apply','intake','buyer_accept','buyer_decline','destination','refund_queue','refund_reconcile') AND char_length("app"."exception_operation"."key") between 16 and 200 AND "app"."exception_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND ("app"."exception_operation"."proof_digest" IS NULL OR "app"."exception_operation"."proof_digest" ~ '^[a-f0-9]{64}$') AND jsonb_typeof("app"."exception_operation"."input")='object' AND NOT ("app"."exception_operation"."input" ?| ARRAY['password','reauthentication_proof','bank_account','signature']) AND octet_length("app"."exception_operation"."input"::text)<=131072 AND jsonb_typeof("app"."exception_operation"."response")='object' AND NOT ("app"."exception_operation"."response" ?| ARRAY['password','reauthentication_proof','bank_account','signature']) AND octet_length("app"."exception_operation"."response"::text)<=1048576)
);
--> statement-breakpoint
CREATE TABLE "app"."exception_stock_observation" (
	"operation_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"balance_revision" integer NOT NULL,
	"missing_quantity" integer NOT NULL,
	"on_hand" integer NOT NULL,
	"reserved" integer NOT NULL,
	"quarantined" integer NOT NULL,
	CONSTRAINT "exception_stock_observation_operation_id_balance_id_pk" PRIMARY KEY("operation_id","balance_id"),
	CONSTRAINT "exception_stock_observation_check" CHECK ("app"."exception_stock_observation"."balance_revision">=0 AND "app"."exception_stock_observation"."missing_quantity" between 0 and 2147483647 AND "app"."exception_stock_observation"."on_hand">=0 AND "app"."exception_stock_observation"."reserved">=0 AND "app"."exception_stock_observation"."quarantined">=0 AND "app"."exception_stock_observation"."reserved"::bigint+"app"."exception_stock_observation"."quarantined"::bigint<="app"."exception_stock_observation"."on_hand"::bigint AND "app"."exception_stock_observation"."missing_quantity"<="app"."exception_stock_observation"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "app"."exception_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fulfillment_item_id" uuid NOT NULL,
	"replacement_link_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exception_unit_case_identity" UNIQUE("exception_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."local_parcel_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"environment" text NOT NULL,
	"shipment_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"clock_namespace" text,
	"status" text NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"signature" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_parcel_outcome_reference_unique" UNIQUE("environment","reference"),
	CONSTRAINT "local_parcel_outcome_value_check" CHECK ("app"."local_parcel_outcome"."environment" IN ('local','test') AND "app"."local_parcel_outcome"."reference" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."local_parcel_outcome"."status" IN ('failed','refused','returned_to_sender') AND jsonb_typeof("app"."local_parcel_outcome"."unit_ids")='array' AND jsonb_array_length("app"."local_parcel_outcome"."unit_ids") between 1 and 100 AND "app"."local_parcel_outcome"."request_hash" ~ '^[a-f0-9]{64}$' AND "app"."local_parcel_outcome"."signature" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_recovery_destination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"buyer_scope" text NOT NULL,
	"destination_reference" text NOT NULL,
	"signature" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_recovery_destination_destination_reference_unique" UNIQUE("destination_reference"),
	CONSTRAINT "local_recovery_destination_check" CHECK ("app"."local_recovery_destination"."environment" IN ('local','test') AND "app"."local_recovery_destination"."buyer_scope" ~ '^(user:[A-Za-z0-9_-]{1,100}|guest:[a-f0-9-]{36})$' AND "app"."local_recovery_destination"."destination_reference" ~ '^LOCAL-RECOVERY-DEST-[A-F0-9]{32}$' AND "app"."local_recovery_destination"."signature" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_recovery_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"bank_reference" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_recovery_event_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "local_recovery_event_bank_reference_unique" UNIQUE("bank_reference"),
	CONSTRAINT "local_recovery_event_value_check" CHECK ((("app"."local_recovery_event"."status"='succeeded' AND "app"."local_recovery_event"."amount" between 1 and 9007199254740991) OR ("app"."local_recovery_event"."status"='failed' AND "app"."local_recovery_event"."amount"=0)) AND "app"."local_recovery_event"."bank_reference" ~ '^LOCAL-RECOVERY-[A-F0-9]{32}$' AND "app"."local_recovery_event"."signature" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_recovery_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"creation_job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"environment" text NOT NULL,
	"rail" text NOT NULL,
	"original_payment_operation_id" uuid,
	"destination_source_id" uuid,
	"source_transaction_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"clock_namespace" text,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_recovery_operation_creation_job_id_unique" UNIQUE("creation_job_id"),
	CONSTRAINT "local_recovery_attempt_unique" UNIQUE("refund_id","attempt"),
	CONSTRAINT "local_recovery_operation_value_check" CHECK ("app"."local_recovery_operation"."attempt">0 AND "app"."local_recovery_operation"."environment" IN ('local','test') AND "app"."local_recovery_operation"."amount" between 1 and 9007199254740991 AND "app"."local_recovery_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND (("app"."local_recovery_operation"."rail"='prepaid_original' AND "app"."local_recovery_operation"."original_payment_operation_id" IS NOT NULL AND "app"."local_recovery_operation"."destination_source_id" IS NULL) OR ("app"."local_recovery_operation"."rail"='cod_verified_destination' AND "app"."local_recovery_operation"."original_payment_operation_id" IS NULL AND "app"."local_recovery_operation"."destination_source_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."local_waybill_cancellation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cancellation_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'acknowledged' NOT NULL,
	"source_operation_id" uuid,
	"source_status" text,
	"tracking_number" text,
	"failure_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "local_waybill_cancellation_cancellation_id_unique" UNIQUE("cancellation_id"),
	CONSTRAINT "local_waybill_cancellation_value_check" CHECK (("app"."local_waybill_cancellation"."environment" IN ('local','test') AND "app"."local_waybill_cancellation"."request_hash" ~ '^[a-f0-9]{64}$' AND (("app"."local_waybill_cancellation"."status"='acknowledged' AND "app"."local_waybill_cancellation"."source_operation_id" IS NULL AND "app"."local_waybill_cancellation"."source_status" IS NULL AND "app"."local_waybill_cancellation"."tracking_number" IS NULL AND "app"."local_waybill_cancellation"."failure_code" IS NULL AND "app"."local_waybill_cancellation"."terminal_at" IS NULL) OR ("app"."local_waybill_cancellation"."status" IN ('cancelled','failed') AND "app"."local_waybill_cancellation"."source_status" IN ('absent','acknowledged','issued','failed') AND (("app"."local_waybill_cancellation"."source_status"='absent')=("app"."local_waybill_cancellation"."source_operation_id" IS NULL)) AND (("app"."local_waybill_cancellation"."source_status"='issued' AND "app"."local_waybill_cancellation"."tracking_number" ~ '^LOCAL-[A-F0-9]{32}$') OR ("app"."local_waybill_cancellation"."source_status"<>'issued' AND "app"."local_waybill_cancellation"."tracking_number" IS NULL)) AND (("app"."local_waybill_cancellation"."status"='cancelled' AND "app"."local_waybill_cancellation"."failure_code" IS NULL) OR ("app"."local_waybill_cancellation"."status"='failed' AND "app"."local_waybill_cancellation"."failure_code" IN ('CANCELLATION_REJECTED','TEMPORARY_UNAVAILABLE'))) AND "app"."local_waybill_cancellation"."terminal_at">="app"."local_waybill_cancellation"."created_at"))) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "app"."local_waybill_cancellation_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source_operation_id" uuid,
	"source_status" text,
	"tracking_number" text,
	"failure_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "waybill_cancellation_event_check" CHECK (("app"."local_waybill_cancellation_event"."signature" ~ '^[a-f0-9]{64}$' AND (("app"."local_waybill_cancellation_event"."status"='acknowledged' AND "app"."local_waybill_cancellation_event"."source_operation_id" IS NULL AND "app"."local_waybill_cancellation_event"."source_status" IS NULL AND "app"."local_waybill_cancellation_event"."tracking_number" IS NULL AND "app"."local_waybill_cancellation_event"."failure_code" IS NULL) OR ("app"."local_waybill_cancellation_event"."status" IN ('cancelled','failed') AND "app"."local_waybill_cancellation_event"."source_status" IN ('absent','acknowledged','issued','failed') AND (("app"."local_waybill_cancellation_event"."source_status"='absent')=("app"."local_waybill_cancellation_event"."source_operation_id" IS NULL)) AND (("app"."local_waybill_cancellation_event"."source_status"='issued' AND "app"."local_waybill_cancellation_event"."tracking_number" ~ '^LOCAL-[A-F0-9]{32}$') OR ("app"."local_waybill_cancellation_event"."source_status"<>'issued' AND "app"."local_waybill_cancellation_event"."tracking_number" IS NULL)) AND (("app"."local_waybill_cancellation_event"."status"='cancelled' AND "app"."local_waybill_cancellation_event"."failure_code" IS NULL) OR ("app"."local_waybill_cancellation_event"."status"='failed' AND "app"."local_waybill_cancellation_event"."failure_code" IN ('CANCELLATION_REJECTED','TEMPORARY_UNAVAILABLE')))))) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "app"."parcel_outcome_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "parcel_outcome_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "parcel_outcome_provider_hash_check" CHECK ("app"."parcel_outcome_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."parcel_outcome_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"exception_ids" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "parcel_outcome_result_value_check" CHECK ("app"."parcel_outcome_result"."outcome" IN ('observed','duplicate','exception') AND jsonb_typeof("app"."parcel_outcome_result"."exception_ids")='array' AND jsonb_array_length("app"."parcel_outcome_result"."exception_ids") between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "app"."recovery_adjustment_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_event_id" uuid,
	"dispatch_reason" text NOT NULL,
	"sequence" integer NOT NULL,
	"merchandise_refunded" bigint NOT NULL,
	"retained_merchandise" bigint NOT NULL,
	"allocation" jsonb NOT NULL,
	"original_occurred_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "recovery_adjustment_receipt_unique" UNIQUE("refund_id","receipt_id"),
	CONSTRAINT "recovery_adjustment_sequence_unique" UNIQUE("receipt_id","sequence"),
	CONSTRAINT "recovery_adjustment_value_check" CHECK ((("app"."recovery_adjustment_intent"."purchase_event_id" IS NULL AND "app"."recovery_adjustment_intent"."dispatch_reason"='original_purchase_missing') OR ("app"."recovery_adjustment_intent"."purchase_event_id" IS NOT NULL AND "app"."recovery_adjustment_intent"."dispatch_reason"='pending_adapter')) AND "app"."recovery_adjustment_intent"."sequence">0 AND "app"."recovery_adjustment_intent"."merchandise_refunded" between 99000 and 9007199254740991 AND "app"."recovery_adjustment_intent"."retained_merchandise" between 0 and 9007199254740991 AND "app"."recovery_adjustment_intent"."merchandise_refunded"%99000=0 AND "app"."recovery_adjustment_intent"."retained_merchandise"%99000=0 AND jsonb_typeof("app"."recovery_adjustment_intent"."allocation")='array' AND jsonb_array_length("app"."recovery_adjustment_intent"."allocation") between 1 and 100 AND "app"."recovery_adjustment_intent"."confirmed_at">="app"."recovery_adjustment_intent"."original_occurred_at")
);
--> statement-breakpoint
CREATE TABLE "app"."recovery_event_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"refund_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"outcome" text NOT NULL,
	"refund_event_id" uuid NOT NULL,
	"exception_event_id" uuid NOT NULL,
	"cash_transaction_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "recovery_event_result_refund_event_id_unique" UNIQUE("refund_event_id"),
	CONSTRAINT "recovery_event_result_exception_event_id_unique" UNIQUE("exception_event_id"),
	CONSTRAINT "recovery_event_result_cash_transaction_id_unique" UNIQUE("cash_transaction_id"),
	CONSTRAINT "recovery_event_result_value_check" CHECK ("app"."recovery_event_result"."revision">0 AND "app"."recovery_event_result"."outcome" IN ('confirmed','failed') AND (("app"."recovery_event_result"."outcome"='confirmed')=("app"."recovery_event_result"."cash_transaction_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."recovery_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"refund_id" uuid NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "recovery_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "recovery_provider_event_hash_check" CHECK ("app"."recovery_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."recovery_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"basis_kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_transaction_id" uuid NOT NULL,
	"receipt_id" uuid,
	"source_amount" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"obligation_transaction_id" uuid NOT NULL,
	"cash_transaction_id" uuid,
	"current_job_id" uuid,
	"current_operation_id" uuid,
	"destination_source_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "recovery_refund_obligation_transaction_id_unique" UNIQUE("obligation_transaction_id"),
	CONSTRAINT "recovery_refund_cash_transaction_id_unique" UNIQUE("cash_transaction_id"),
	CONSTRAINT "recovery_refund_current_job_id_unique" UNIQUE("current_job_id"),
	CONSTRAINT "recovery_refund_case_source_unique" UNIQUE("exception_id","source_transaction_id"),
	CONSTRAINT "recovery_refund_value_check" CHECK ("app"."recovery_refund"."revision">0 AND "app"."recovery_refund"."status" IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND "app"."recovery_refund"."basis_kind" IN ('purchased_units','unallocated') AND "app"."recovery_refund"."source_kind" IN ('payment_event','cod_event') AND "app"."recovery_refund"."source_amount" between 1 and 9007199254740991 AND "app"."recovery_refund"."amount" between 1 and "app"."recovery_refund"."source_amount" AND (("app"."recovery_refund"."status"='succeeded')=("app"."recovery_refund"."cash_transaction_id" IS NOT NULL)) AND (("app"."recovery_refund"."basis_kind"='purchased_units')=("app"."recovery_refund"."receipt_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."recovery_refund_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"exception_unit_id" uuid,
	"fulfillment_item_id" uuid,
	"receipt_id" uuid,
	"purchase_event_id" uuid,
	"merchandise_amount" bigint NOT NULL,
	"buyer_shipping" bigint NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "recovery_refund_allocation_exception_unit_id_unique" UNIQUE("exception_unit_id"),
	CONSTRAINT "recovery_refund_allocation_fulfillment_item_id_unique" UNIQUE("fulfillment_item_id"),
	CONSTRAINT "recovery_allocation_value_check" CHECK ("app"."recovery_refund_allocation"."amount" between 1 and 9007199254740991 AND (("app"."recovery_refund_allocation"."exception_unit_id" IS NOT NULL AND "app"."recovery_refund_allocation"."fulfillment_item_id" IS NOT NULL AND "app"."recovery_refund_allocation"."receipt_id" IS NOT NULL AND "app"."recovery_refund_allocation"."merchandise_amount"=99000 AND "app"."recovery_refund_allocation"."buyer_shipping">=0 AND "app"."recovery_refund_allocation"."amount"::numeric="app"."recovery_refund_allocation"."merchandise_amount"::numeric+"app"."recovery_refund_allocation"."buyer_shipping"::numeric) OR ("app"."recovery_refund_allocation"."exception_unit_id" IS NULL AND "app"."recovery_refund_allocation"."fulfillment_item_id" IS NULL AND "app"."recovery_refund_allocation"."receipt_id" IS NULL AND "app"."recovery_refund_allocation"."purchase_event_id" IS NULL AND "app"."recovery_refund_allocation"."merchandise_amount"=0 AND "app"."recovery_refund_allocation"."buyer_shipping"=0)))
);
--> statement-breakpoint
CREATE TABLE "app"."recovery_refund_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_operation_id" uuid,
	"job_id" uuid,
	"destination_source_id" uuid,
	"cash_transaction_id" uuid,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "recovery_refund_event_revision_unique" UNIQUE("refund_id","revision"),
	CONSTRAINT "recovery_refund_event_source_unique" UNIQUE("refund_id","source_kind","source_id","kind"),
	CONSTRAINT "recovery_refund_event_value_check" CHECK ("app"."recovery_refund_event"."revision">0 AND "app"."recovery_refund_event"."kind" IN ('queue','destination','prepare','confirm','fail','reconcile','retry') AND "app"."recovery_refund_event"."status" IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND "app"."recovery_refund_event"."source_kind" IN ('operation','job','provider') AND char_length("app"."recovery_refund_event"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."shipment_cancellation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"creation_job_id" uuid NOT NULL,
	"provider_operation_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shipment_cancellation_creation_job_id_unique" UNIQUE("creation_job_id"),
	CONSTRAINT "shipment_cancellation_attempt_unique" UNIQUE("booking_id","attempt"),
	CONSTRAINT "shipment_cancellation_request_unique" UNIQUE("booking_id","operation_id"),
	CONSTRAINT "shipment_cancellation_state_check" CHECK ("app"."shipment_cancellation"."attempt">0 AND "app"."shipment_cancellation"."status" IN ('queued','acknowledged','cancelled','failed','not_created'))
);
--> statement-breakpoint
CREATE TABLE "app"."waybill_cancellation_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cancellation_id" uuid NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "waybill_cancellation_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "waybill_cancellation_provider_hash_check" CHECK ("app"."waybill_cancellation_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."waybill_cancellation_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"fulfillment_event_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "waybill_cancellation_result_fulfillment_event_id_unique" UNIQUE("fulfillment_event_id"),
	CONSTRAINT "waybill_cancellation_result_check" CHECK ("app"."waybill_cancellation_result"."outcome" IN ('acknowledged','cancelled','failed','duplicate') AND (("app"."waybill_cancellation_result"."outcome"='cancelled')=("app"."waybill_cancellation_result"."fulfillment_event_id" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" DROP CONSTRAINT "promotion_movement_effect_unique";--> statement-breakpoint
ALTER TABLE "app"."cod_event_result" DROP CONSTRAINT "cod_event_result_value_check";--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_state_check";--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" DROP CONSTRAINT "finance_transaction_kind_check";--> statement-breakpoint
ALTER TABLE "app"."fulfillment_event" DROP CONSTRAINT "fulfillment_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."local_cod_operation" DROP CONSTRAINT "local_cod_operation_value_check";--> statement-breakpoint
ALTER TABLE "app"."order_event" DROP CONSTRAINT "order_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" DROP CONSTRAINT "promotion_movement_delta_check";--> statement-breakpoint
ALTER TABLE "app"."replacement_event" DROP CONSTRAINT "replacement_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."replacement_shipment" DROP CONSTRAINT "replacement_shipment_state_check";--> statement-breakpoint
ALTER TABLE "app"."return_event" DROP CONSTRAINT "return_event_value_check";--> statement-breakpoint
ALTER TABLE "app"."shipment_booking" DROP CONSTRAINT "shipment_booking_state_check";--> statement-breakpoint
DROP INDEX "app"."shipment_booking_active_unique";--> statement-breakpoint
ALTER TABLE "app"."local_cod_operation" ADD COLUMN "unit_ids" jsonb;--> statement-breakpoint
ALTER TABLE "app"."local_waybill_operation" ADD COLUMN "request_basis" jsonb;--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD COLUMN "exception_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."commerce_exception" ADD CONSTRAINT "commerce_exception_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_exception" ADD CONSTRAINT "commerce_exception_proposal_event_id_exception_event_id_fk" FOREIGN KEY ("proposal_event_id") REFERENCES "app"."exception_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_replacement_link_id_replacement_link_id_fk" FOREIGN KEY ("replacement_link_id") REFERENCES "app"."replacement_link"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_stock_report_operation_id_exception_operation_id_fk" FOREIGN KEY ("stock_report_operation_id") REFERENCES "app"."exception_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_physical_source_id_local_parcel_outcome_id_fk" FOREIGN KEY ("physical_source_id") REFERENCES "app"."local_parcel_outcome"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_operation_id_exception_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."exception_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_unit_case_fk" FOREIGN KEY ("exception_id","exception_unit_id") REFERENCES "app"."exception_unit"("exception_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_event_case_fk" FOREIGN KEY ("exception_id","event_id") REFERENCES "app"."exception_event"("exception_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_cancellation" ADD CONSTRAINT "exception_cancellation_consent_case_fk" FOREIGN KEY ("exception_id","consent_event_id") REFERENCES "app"."exception_event"("exception_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_event" ADD CONSTRAINT "exception_event_exception_id_commerce_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "app"."commerce_exception"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_event" ADD CONSTRAINT "exception_event_same_case_cause_fk" FOREIGN KEY ("exception_id","cause_event_id") REFERENCES "app"."exception_event"("exception_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_intake" ADD CONSTRAINT "exception_goods_intake_exception_id_commerce_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "app"."commerce_exception"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_intake" ADD CONSTRAINT "exception_goods_intake_operation_id_exception_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."exception_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_intake" ADD CONSTRAINT "exception_goods_intake_physical_outcome_id_local_parcel_outcome_id_fk" FOREIGN KEY ("physical_outcome_id") REFERENCES "app"."local_parcel_outcome"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_intake" ADD CONSTRAINT "exception_intake_event_case_fk" FOREIGN KEY ("exception_id","event_id") REFERENCES "app"."exception_event"("exception_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_line" ADD CONSTRAINT "exception_goods_line_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_line" ADD CONSTRAINT "exception_goods_line_balance_id_inventory_balance_id_fk" FOREIGN KEY ("balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_line" ADD CONSTRAINT "exception_goods_line_stock_movement_id_stock_movement_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "app"."stock_movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_line" ADD CONSTRAINT "exception_goods_intake_case_fk" FOREIGN KEY ("exception_id","intake_id") REFERENCES "app"."exception_goods_intake"("exception_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_goods_line" ADD CONSTRAINT "exception_goods_unit_case_fk" FOREIGN KEY ("exception_id","exception_unit_id") REFERENCES "app"."exception_unit"("exception_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_operation" ADD CONSTRAINT "exception_operation_exception_id_commerce_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "app"."commerce_exception"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_operation" ADD CONSTRAINT "exception_operation_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_operation" ADD CONSTRAINT "exception_operation_guest_id_commerce_guest_context_id_fk" FOREIGN KEY ("guest_id") REFERENCES "app"."commerce_guest_context"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_stock_observation" ADD CONSTRAINT "exception_stock_observation_operation_id_exception_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."exception_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_stock_observation" ADD CONSTRAINT "exception_stock_observation_balance_id_inventory_balance_id_fk" FOREIGN KEY ("balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_stock_observation" ADD CONSTRAINT "exception_stock_observation_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_unit" ADD CONSTRAINT "exception_unit_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_unit" ADD CONSTRAINT "exception_unit_replacement_link_id_replacement_link_id_fk" FOREIGN KEY ("replacement_link_id") REFERENCES "app"."replacement_link"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_unit" ADD CONSTRAINT "exception_unit_case_kind_fk" FOREIGN KEY ("exception_id","kind") REFERENCES "app"."commerce_exception"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_parcel_outcome" ADD CONSTRAINT "local_parcel_outcome_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_parcel_outcome" ADD CONSTRAINT "local_parcel_outcome_booking_id_shipment_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."shipment_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_recovery_destination" ADD CONSTRAINT "local_recovery_destination_refund_id_recovery_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."recovery_refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_recovery_event" ADD CONSTRAINT "local_recovery_event_operation_id_local_recovery_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_recovery_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_recovery_operation" ADD CONSTRAINT "local_recovery_operation_refund_id_recovery_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."recovery_refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_recovery_operation" ADD CONSTRAINT "local_recovery_operation_creation_job_id_outbox_job_id_fk" FOREIGN KEY ("creation_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_recovery_operation" ADD CONSTRAINT "local_recovery_operation_original_payment_operation_id_local_payment_operation_id_fk" FOREIGN KEY ("original_payment_operation_id") REFERENCES "app"."local_payment_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_recovery_operation" ADD CONSTRAINT "local_recovery_operation_destination_source_id_local_recovery_destination_id_fk" FOREIGN KEY ("destination_source_id") REFERENCES "app"."local_recovery_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_recovery_operation" ADD CONSTRAINT "local_recovery_operation_source_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_waybill_cancellation" ADD CONSTRAINT "local_waybill_cancellation_cancellation_id_shipment_cancellation_id_fk" FOREIGN KEY ("cancellation_id") REFERENCES "app"."shipment_cancellation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_waybill_cancellation" ADD CONSTRAINT "local_waybill_cancellation_source_operation_id_local_waybill_operation_id_fk" FOREIGN KEY ("source_operation_id") REFERENCES "app"."local_waybill_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_waybill_cancellation_event" ADD CONSTRAINT "local_waybill_cancellation_event_operation_id_local_waybill_cancellation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_waybill_cancellation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_waybill_cancellation_event" ADD CONSTRAINT "local_waybill_cancellation_event_source_operation_id_local_waybill_operation_id_fk" FOREIGN KEY ("source_operation_id") REFERENCES "app"."local_waybill_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_outcome_provider_event" ADD CONSTRAINT "parcel_outcome_provider_event_id_local_parcel_outcome_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_parcel_outcome"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_outcome_provider_event" ADD CONSTRAINT "parcel_outcome_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_outcome_result" ADD CONSTRAINT "parcel_outcome_result_event_id_parcel_outcome_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."parcel_outcome_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_adjustment_intent" ADD CONSTRAINT "recovery_adjustment_intent_refund_id_recovery_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."recovery_refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_adjustment_intent" ADD CONSTRAINT "recovery_adjustment_intent_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_adjustment_intent" ADD CONSTRAINT "recovery_adjustment_intent_purchase_event_id_commerce_event_id_fk" FOREIGN KEY ("purchase_event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_event_result" ADD CONSTRAINT "recovery_event_result_event_id_recovery_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."recovery_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_event_result" ADD CONSTRAINT "recovery_event_result_refund_id_recovery_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."recovery_refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_event_result" ADD CONSTRAINT "recovery_event_result_refund_event_id_recovery_refund_event_id_fk" FOREIGN KEY ("refund_event_id") REFERENCES "app"."recovery_refund_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_event_result" ADD CONSTRAINT "recovery_event_result_exception_event_id_exception_event_id_fk" FOREIGN KEY ("exception_event_id") REFERENCES "app"."exception_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_event_result" ADD CONSTRAINT "recovery_event_result_cash_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_provider_event" ADD CONSTRAINT "recovery_provider_event_id_local_recovery_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_recovery_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_provider_event" ADD CONSTRAINT "recovery_provider_event_refund_id_recovery_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."recovery_refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_provider_event" ADD CONSTRAINT "recovery_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_exception_id_commerce_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "app"."commerce_exception"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_operation_id_exception_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."exception_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_source_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_obligation_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("obligation_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_cash_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_current_job_id_outbox_job_id_fk" FOREIGN KEY ("current_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_current_operation_id_local_recovery_operation_id_fk" FOREIGN KEY ("current_operation_id") REFERENCES "app"."local_recovery_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund" ADD CONSTRAINT "recovery_refund_destination_source_id_local_recovery_destination_id_fk" FOREIGN KEY ("destination_source_id") REFERENCES "app"."local_recovery_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD CONSTRAINT "recovery_refund_allocation_refund_id_recovery_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."recovery_refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD CONSTRAINT "recovery_refund_allocation_exception_unit_id_exception_unit_id_fk" FOREIGN KEY ("exception_unit_id") REFERENCES "app"."exception_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD CONSTRAINT "recovery_refund_allocation_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD CONSTRAINT "recovery_refund_allocation_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD CONSTRAINT "recovery_refund_allocation_purchase_event_id_commerce_event_id_fk" FOREIGN KEY ("purchase_event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_event" ADD CONSTRAINT "recovery_refund_event_refund_id_recovery_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."recovery_refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_event" ADD CONSTRAINT "recovery_refund_event_provider_operation_id_local_recovery_operation_id_fk" FOREIGN KEY ("provider_operation_id") REFERENCES "app"."local_recovery_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_event" ADD CONSTRAINT "recovery_refund_event_job_id_outbox_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_event" ADD CONSTRAINT "recovery_refund_event_destination_source_id_local_recovery_destination_id_fk" FOREIGN KEY ("destination_source_id") REFERENCES "app"."local_recovery_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_event" ADD CONSTRAINT "recovery_refund_event_cash_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_cancellation" ADD CONSTRAINT "shipment_cancellation_booking_id_shipment_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."shipment_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_cancellation" ADD CONSTRAINT "shipment_cancellation_operation_id_exception_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."exception_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_cancellation" ADD CONSTRAINT "shipment_cancellation_creation_job_id_outbox_job_id_fk" FOREIGN KEY ("creation_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipment_cancellation" ADD CONSTRAINT "shipment_cancellation_provider_operation_id_local_waybill_cancellation_id_fk" FOREIGN KEY ("provider_operation_id") REFERENCES "app"."local_waybill_cancellation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_cancellation_provider_event" ADD CONSTRAINT "waybill_cancellation_provider_event_id_local_waybill_cancellation_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_waybill_cancellation_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_cancellation_provider_event" ADD CONSTRAINT "waybill_cancellation_provider_event_cancellation_id_shipment_cancellation_id_fk" FOREIGN KEY ("cancellation_id") REFERENCES "app"."shipment_cancellation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_cancellation_provider_event" ADD CONSTRAINT "waybill_cancellation_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_cancellation_result" ADD CONSTRAINT "waybill_cancellation_result_event_id_waybill_cancellation_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."waybill_cancellation_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waybill_cancellation_result" ADD CONSTRAINT "waybill_cancellation_result_fulfillment_event_id_fulfillment_event_id_fk" FOREIGN KEY ("fulfillment_event_id") REFERENCES "app"."fulfillment_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_exception_queue_idx" ON "app"."commerce_exception" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "commerce_exception_order_idx" ON "app"."commerce_exception" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "exception_cancel_original_unit_unique" ON "app"."exception_cancellation" USING btree ("fulfillment_item_id") WHERE "app"."exception_cancellation"."replacement_link_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exception_proposal_choice_unique" ON "app"."exception_event" USING btree ("cause_event_id") WHERE "app"."exception_event"."kind" IN ('buyer_accept','buyer_decline');--> statement-breakpoint
CREATE INDEX "exception_goods_unit_idx" ON "app"."exception_goods_line" USING btree ("exception_unit_id","balance_id","id");--> statement-breakpoint
CREATE INDEX "exception_operation_case_idx" ON "app"."exception_operation" USING btree ("exception_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "exception_unit_case_occurrence_unique" ON "app"."exception_unit" USING btree ("exception_id","fulfillment_item_id",coalesce("replacement_link_id",'00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "exception_unit_active_kind_unique" ON "app"."exception_unit" USING btree ("kind","fulfillment_item_id",coalesce("replacement_link_id",'00000000-0000-0000-0000-000000000000'::uuid)) WHERE "app"."exception_unit"."active";--> statement-breakpoint
CREATE INDEX "local_parcel_outcome_shipment_idx" ON "app"."local_parcel_outcome" USING btree ("shipment_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "recovery_refund_source_idx" ON "app"."recovery_refund" USING btree ("source_transaction_id","id");--> statement-breakpoint
CREATE INDEX "recovery_refund_order_idx" ON "app"."recovery_refund" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_unallocated_refund_unique" ON "app"."recovery_refund_allocation" USING btree ("refund_id") WHERE "app"."recovery_refund_allocation"."exception_unit_id" IS NULL;--> statement-breakpoint
CREATE INDEX "recovery_allocation_receipt_idx" ON "app"."recovery_refund_allocation" USING btree ("receipt_id","refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_cancellation_active_unique" ON "app"."shipment_cancellation" USING btree ("booking_id") WHERE "app"."shipment_cancellation"."status" NOT IN ('failed','not_created');--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD CONSTRAINT "promotion_movement_exception_operation_id_exception_operation_id_fk" FOREIGN KEY ("exception_operation_id") REFERENCES "app"."exception_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_movement_effect_unique" ON "app"."promotion_movement" USING btree ("reservation_id","promotion_id","kind") WHERE "app"."promotion_movement"."exception_operation_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_booking_active_unique" ON "app"."shipment_booking" USING btree ("fulfillment_id") WHERE "app"."shipment_booking"."status" NOT IN ('failed','cancelled');--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD CONSTRAINT "promotion_movement_exception_unique" UNIQUE("reservation_id","promotion_id","exception_operation_id");--> statement-breakpoint
ALTER TABLE "app"."cod_event_result" ADD CONSTRAINT "cod_event_result_value_check" CHECK ("app"."cod_event_result"."outcome" IN ('collected','refused','duplicate','recovery') AND "app"."cod_event_result"."reason" IN ('verified_collection','recipient_refused','duplicate_callback','amount_mismatch','conflicting_allocation','late_collection') AND (("app"."cod_event_result"."outcome"='collected' AND "app"."cod_event_result"."receipt_id" IS NOT NULL AND "app"."cod_event_result"."transaction_id" IS NOT NULL) OR ("app"."cod_event_result"."outcome"='refused' AND "app"."cod_event_result"."receipt_id" IS NULL AND "app"."cod_event_result"."transaction_id" IS NULL) OR ("app"."cod_event_result"."outcome"='recovery' AND "app"."cod_event_result"."transaction_id" IS NOT NULL) OR ("app"."cod_event_result"."outcome"='duplicate' AND ("app"."cod_event_result"."receipt_id" IS NULL OR "app"."cod_event_result"."transaction_id" IS NOT NULL))));--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_state_check" CHECK (("app"."commerce_order"."status"='preparing' AND "app"."commerce_order"."revision"=0 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."revision"=1 AND "app"."commerce_order"."payment_status"='pending' AND "app"."commerce_order"."actionable_at" IS NULL) OR ("app"."commerce_order"."status" IN ('pending','processing','partially_completed','cancelled') AND "app"."commerce_order"."revision">=2 AND "app"."commerce_order"."payment_status"='confirmed' AND "app"."commerce_order"."payment_method"='prepaid' AND "app"."commerce_order"."actionable_at" IS NOT NULL) OR ("app"."commerce_order"."status" IN ('pending','processing','partially_completed','cancelled') AND "app"."commerce_order"."payment_method"='cod' AND "app"."commerce_order"."actionable_at" IS NOT NULL AND ("app"."commerce_order"."revision">=2 AND "app"."commerce_order"."payment_status" IN ('cod_due','partially_collected','confirmed'))) OR ("app"."commerce_order"."status"='cancelled' AND "app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='expired' AND "app"."commerce_order"."actionable_at" IS NULL));--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" ADD CONSTRAINT "finance_transaction_kind_check" CHECK ("app"."finance_transaction"."kind" IN ('economic_receipt','adjustment','reversal','settlement_cash','settlement_fee','settlement_match','refund_obligation','refund_cash','recovery_obligation','recovery_cash') AND (("app"."finance_transaction"."kind"='reversal')=("app"."finance_transaction"."reverses_id" IS NOT NULL)) AND "app"."finance_transaction"."reverses_id" IS DISTINCT FROM "app"."finance_transaction"."id");--> statement-breakpoint
ALTER TABLE "app"."fulfillment_event" ADD CONSTRAINT "fulfillment_event_value_check" CHECK ("app"."fulfillment_event"."revision">0 AND "app"."fulfillment_event"."status" IN ('ready','picking','packed','handover_pending','handed_over','exception') AND "app"."fulfillment_event"."kind" IN ('initialize','prepare','booking','issued','reissued','booking_cancelled','packed','handover','exception','reschedule') AND "app"."fulfillment_event"."source_kind" IN ('activation','operation','provider','cancellation') AND char_length("app"."fulfillment_event"."reason") between 1 and 500 AND (("app"."fulfillment_event"."kind"='reschedule' AND "app"."fulfillment_event"."public_explanation" IS NOT NULL AND char_length("app"."fulfillment_event"."public_explanation") between 1 and 200) OR ("app"."fulfillment_event"."kind"<>'reschedule' AND "app"."fulfillment_event"."public_explanation" IS NULL)));--> statement-breakpoint
ALTER TABLE "app"."local_cod_operation" ADD CONSTRAINT "local_cod_operation_units_check" CHECK ("app"."local_cod_operation"."unit_ids" IS NULL OR (jsonb_typeof("app"."local_cod_operation"."unit_ids")='array' AND jsonb_array_length("app"."local_cod_operation"."unit_ids")<=100));--> statement-breakpoint
ALTER TABLE "app"."local_cod_operation" ADD CONSTRAINT "local_cod_operation_value_check" CHECK ("app"."local_cod_operation"."environment" IN ('local','test') AND "app"."local_cod_operation"."reference" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."local_cod_operation"."requested_amount" between 0 and 9007199254740991 AND (("app"."local_cod_operation"."status"='collected' AND "app"."local_cod_operation"."amount" between 1 and 9007199254740991) OR ("app"."local_cod_operation"."status"='refused' AND "app"."local_cod_operation"."amount"=0)));--> statement-breakpoint
ALTER TABLE "app"."local_waybill_operation" ADD CONSTRAINT "local_waybill_operation_basis_check" CHECK ("app"."local_waybill_operation"."request_basis" IS NULL OR (jsonb_typeof("app"."local_waybill_operation"."request_basis")='object' AND "app"."local_waybill_operation"."request_basis" ?& ARRAY['unit_ids','cod_due'] AND ("app"."local_waybill_operation"."request_basis"-ARRAY['unit_ids','cod_due'])='{}'::jsonb AND jsonb_typeof("app"."local_waybill_operation"."request_basis"->'unit_ids')='array' AND jsonb_array_length("app"."local_waybill_operation"."request_basis"->'unit_ids') between 1 and 100 AND jsonb_typeof("app"."local_waybill_operation"."request_basis"->'cod_due')='number' AND ("app"."local_waybill_operation"."request_basis"->>'cod_due') ~ '^(0|[1-9][0-9]*)$' AND ("app"."local_waybill_operation"."request_basis"->>'cod_due')::numeric between 0 and 9007199254740991));--> statement-breakpoint
ALTER TABLE "app"."order_event" ADD CONSTRAINT "order_event_value_check" CHECK (char_length("app"."order_event"."reason") between 1 and 500 AND (("app"."order_event"."revision"=1 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status"='pending') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='cancelled' AND "app"."order_event"."payment_status"='expired') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status" IN ('confirmed','cod_due')) OR ("app"."order_event"."revision">=3 AND "app"."order_event"."status" IN ('pending','processing','partially_completed','cancelled') AND "app"."order_event"."payment_status" IN ('cod_due','partially_collected','confirmed'))));--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD CONSTRAINT "promotion_movement_cause_check" CHECK ((("app"."promotion_movement"."kind" IN ('cancel_reserved','cancel_committed'))=("app"."promotion_movement"."exception_operation_id" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD CONSTRAINT "promotion_movement_delta_check" CHECK (("app"."promotion_movement"."kind"='reserve' AND "app"."promotion_movement"."reserved_delta"="app"."promotion_movement"."amount" AND "app"."promotion_movement"."committed_delta"=0 AND "app"."promotion_movement"."reserved_uses_delta"=1 AND "app"."promotion_movement"."committed_uses_delta"=0) OR ("app"."promotion_movement"."kind"='release' AND "app"."promotion_movement"."reserved_delta"=-"app"."promotion_movement"."amount" AND "app"."promotion_movement"."committed_delta"=0 AND "app"."promotion_movement"."reserved_uses_delta"=-1 AND "app"."promotion_movement"."committed_uses_delta"=0) OR ("app"."promotion_movement"."kind"='consume' AND "app"."promotion_movement"."reserved_delta"=-"app"."promotion_movement"."amount" AND "app"."promotion_movement"."committed_delta"="app"."promotion_movement"."amount" AND "app"."promotion_movement"."reserved_uses_delta"=-1 AND "app"."promotion_movement"."committed_uses_delta"=1) OR ("app"."promotion_movement"."kind"='cancel_reserved' AND "app"."promotion_movement"."reserved_delta"=-"app"."promotion_movement"."amount" AND "app"."promotion_movement"."committed_delta"=0 AND "app"."promotion_movement"."reserved_uses_delta" IN (0,-1) AND "app"."promotion_movement"."committed_uses_delta"=0) OR ("app"."promotion_movement"."kind"='cancel_committed' AND "app"."promotion_movement"."reserved_delta"=0 AND "app"."promotion_movement"."committed_delta"=-"app"."promotion_movement"."amount" AND "app"."promotion_movement"."reserved_uses_delta"=0 AND "app"."promotion_movement"."committed_uses_delta"=0));--> statement-breakpoint
ALTER TABLE "app"."replacement_event" ADD CONSTRAINT "replacement_event_value_check" CHECK ("app"."replacement_event"."revision">0 AND "app"."replacement_event"."kind" IN ('create','reserve','stock_wait','prepare','book','unknown','waybill_issued','waybill_failed','handover','receipt','reconcile','cancel') AND "app"."replacement_event"."source_kind" IN ('operation','job','provider','receipt','exception') AND ("app"."replacement_event"."source_kind"='operation' OR "app"."replacement_event"."actor_id" IS NULL) AND char_length("app"."replacement_event"."reason") between 1 and 500 AND jsonb_typeof("app"."replacement_event"."snapshot")='object' AND octet_length("app"."replacement_event"."snapshot"::text)<=65536);--> statement-breakpoint
ALTER TABLE "app"."replacement_shipment" ADD CONSTRAINT "replacement_shipment_state_check" CHECK ("app"."replacement_shipment"."revision">0 AND "app"."replacement_shipment"."status" IN ('awaiting_stock','ready','picking','booking_pending','booking_unknown','booking_failed','packed','handed_over','partially_delivered','delivered','cancelled') AND "app"."replacement_shipment"."buyer_shipping"=0 AND "app"."replacement_shipment"."cod_due"=0 AND (("app"."replacement_shipment"."packing_due_at" IS NULL)=("app"."replacement_shipment"."calendar_snapshot" IS NULL)) AND ("app"."replacement_shipment"."calendar_snapshot" IS NULL OR (jsonb_typeof("app"."replacement_shipment"."calendar_snapshot")='object' AND octet_length("app"."replacement_shipment"."calendar_snapshot"::text)<=65536)) AND ("app"."replacement_shipment"."tracking_number" IS NULL OR "app"."replacement_shipment"."tracking_number" ~ '^LOCAL-REPLACEMENT-[A-F0-9]{32}$') AND ("app"."replacement_shipment"."handover_reference" IS NULL OR char_length("app"."replacement_shipment"."handover_reference") between 1 and 200));--> statement-breakpoint
ALTER TABLE "app"."return_event" ADD CONSTRAINT "return_event_value_check" CHECK ("app"."return_event"."revision">0 AND "app"."return_event"."kind" IN ('create','decision','inspection','refund_queue','refund_confirmed','refund_failed','replacement_started','replacement_received','replacement_cancelled') AND "app"."return_event"."status" IN ('requested','reviewing','approved','rejected','awaiting_goods','inspecting','refunding','replacing','resolved') AND "app"."return_event"."source_kind" IN ('operation','refund','replacement','recovery') AND ("app"."return_event"."source_kind" IN ('operation','replacement') OR "app"."return_event"."actor_id" IS NULL) AND char_length("app"."return_event"."reason") between 1 and 2000);--> statement-breakpoint
ALTER TABLE "app"."shipment_booking" ADD CONSTRAINT "shipment_booking_state_check" CHECK ("app"."shipment_booking"."status" IN ('queued','acknowledged','issued','failed','cancelled'));
--> statement-breakpoint
-- S33 NATIVE GUARDS: staged financial capacity and adjustment history.
-- The first-statement stop remains mandatory. Actor/head/source/job/custody
-- seals and exact independent compilation/execution gates are still pending.
CREATE FUNCTION app.assert_compensation_capacity(p_transaction_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_original app.finance_transaction; v_available numeric; v_returned numeric; v_recovery numeric; v_postings integer;
BEGIN
 -- A fixed Repeatable Read snapshot can miss a competing committed obligation
 -- even after waiting for this immutable journal row. Serializable uses SSI.
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Shared compensation requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_original FROM app.finance_transaction WHERE id=p_transaction_id FOR UPDATE;
 SELECT count(*),coalesce(sum(amount) FILTER (WHERE account='provider_receivable' AND side='debit'),0)
  INTO v_postings,v_available FROM app.finance_posting WHERE transaction_id=p_transaction_id;
 IF v_original.id IS NULL OR v_original.kind NOT IN ('economic_receipt','adjustment')
    OR v_original.source NOT IN ('local.payment','local.cod','local.payment.recovery','local.cod.recovery')
    OR v_original.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR v_postings<>2 OR v_available NOT BETWEEN 1 AND 9007199254740991
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=p_transaction_id AND account='buyer_funds_liability' AND side='credit' AND amount=v_available)
    OR EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=p_transaction_id)
 THEN RAISE EXCEPTION 'Compensation capacity requires an original unreversed collection liability' USING ERRCODE='23514'; END IF;
 -- Every obligation reserves capacity, including awaiting destination, unknown
 -- and known failed attempts. None of these states releases buyer liability.
 SELECT coalesce(sum(a.amount),0) INTO v_returned FROM app.refund_allocation a
  JOIN app.economic_receipt r ON r.id=a.receipt_id WHERE r.transaction_id=p_transaction_id;
 SELECT coalesce(sum(amount),0) INTO v_recovery FROM app.recovery_refund WHERE source_transaction_id=p_transaction_id;
 IF v_returned+v_recovery>v_available
 THEN RAISE EXCEPTION 'Ordinary and recovery obligations share original collection capacity' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_compensation_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_transaction_id uuid; v_unit_id uuid; v_claims integer;
BEGIN
 IF TG_TABLE_NAME='refund_allocation' THEN
  SELECT transaction_id INTO v_transaction_id FROM app.economic_receipt WHERE id=NEW.receipt_id;
  SELECT fulfillment_item_id INTO v_unit_id FROM app.return_item WHERE id=NEW.return_item_id;
 ELSIF TG_TABLE_NAME='recovery_refund_allocation' THEN
  SELECT source_transaction_id INTO v_transaction_id FROM app.recovery_refund WHERE id=NEW.refund_id;
  v_unit_id:=NEW.fulfillment_item_id;
 ELSE
  SELECT source_transaction_id INTO v_transaction_id FROM app.recovery_refund WHERE id=NEW.id;
 END IF;
 IF v_unit_id IS NOT NULL THEN
  PERFORM id FROM app.fulfillment_item WHERE id=v_unit_id FOR UPDATE;
  SELECT count(*) INTO v_claims FROM (
   SELECT a.return_item_id FROM app.refund_allocation a JOIN app.return_item r ON r.id=a.return_item_id WHERE r.fulfillment_item_id=v_unit_id
   UNION ALL SELECT id FROM app.recovery_refund_allocation WHERE fulfillment_item_id=v_unit_id
  ) claims;
  IF v_claims>1 THEN RAISE EXCEPTION 'One original purchased unit cannot fund both refund paths' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM app.assert_compensation_capacity(v_transaction_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_allocation_shared_capacity AFTER INSERT ON app.refund_allocation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_compensation_capacity();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_allocation_shared_capacity AFTER INSERT ON app.recovery_refund_allocation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_compensation_capacity();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_refund_shared_capacity AFTER INSERT OR UPDATE ON app.recovery_refund
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_compensation_capacity();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_original_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_original app.finance_transaction;
BEGIN
 IF NEW.reverses_id IS NOT NULL THEN
  IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
  THEN RAISE EXCEPTION 'Shared compensation requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_original FROM app.finance_transaction WHERE id=NEW.reverses_id FOR UPDATE;
  IF v_original.kind IN ('recovery_obligation','recovery_cash')
     OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE source_transaction_id=v_original.id)
  THEN RAISE EXCEPTION 'Recovery obligations, cash and allocated original collections retain their history' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_original_reversal_guard BEFORE INSERT ON app.finance_transaction
 FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_original_reversal();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_adjustment_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_receipt app.economic_receipt; v_purchase app.commerce_event; v_cash app.finance_transaction;
 v_bank app.local_recovery_event; v_delta numeric; v_refunded numeric; v_sequence bigint; v_allocation jsonb;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Shared compensation requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id FOR UPDATE;
 SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
 PERFORM id FROM app.finance_transaction WHERE id=v_receipt.transaction_id FOR UPDATE;
 SELECT * INTO v_purchase FROM app.commerce_event WHERE receipt_id=v_receipt.id AND name='Purchase';
 SELECT * INTO v_cash FROM app.finance_transaction WHERE id=v_refund.cash_transaction_id;
 SELECT * INTO v_bank FROM app.local_recovery_event WHERE operation_id=v_refund.current_operation_id;
 SELECT coalesce(sum(a.merchandise_amount),0),jsonb_agg(jsonb_build_object('fulfillment_item_id',a.fulfillment_item_id,'order_item_id',f.order_item_id,'quantity',1,'merchandise_amount',a.merchandise_amount) ORDER BY a.fulfillment_item_id)
  INTO v_delta,v_allocation FROM app.recovery_refund_allocation a JOIN app.fulfillment_item f ON f.id=a.fulfillment_item_id
  WHERE a.refund_id=v_refund.id AND a.receipt_id=v_receipt.id;
 SELECT coalesce(sum(amount),0) INTO v_refunded FROM (
  SELECT a.merchandise_amount amount FROM app.refund_allocation a JOIN app.refund r ON r.id=a.refund_id WHERE a.receipt_id=v_receipt.id AND r.status='succeeded'
  UNION ALL SELECT a.merchandise_amount FROM app.recovery_refund_allocation a JOIN app.recovery_refund r ON r.id=a.refund_id WHERE a.receipt_id=v_receipt.id AND r.status='succeeded'
 ) portions;
 SELECT coalesce(max(sequence),0)::bigint+1 INTO v_sequence FROM (
  SELECT sequence FROM app.refund_adjustment_intent WHERE receipt_id=v_receipt.id
  UNION ALL SELECT sequence FROM app.recovery_adjustment_intent WHERE receipt_id=v_receipt.id
 ) history;
 IF v_refund.id IS NULL OR v_refund.status<>'succeeded' OR v_refund.basis_kind<>'purchased_units'
    OR v_receipt.id IS NULL OR v_refund.receipt_id IS DISTINCT FROM v_receipt.id OR v_receipt.order_id IS DISTINCT FROM v_refund.order_id
    OR v_cash.id IS NULL OR v_cash.kind<>'recovery_cash' OR v_cash.created_xid<>pg_current_xact_id()::text
    OR v_bank.status IS DISTINCT FROM 'succeeded' OR v_bank.amount IS DISTINCT FROM v_refund.amount
    OR NEW.purchase_event_id IS DISTINCT FROM v_purchase.id
    OR NEW.dispatch_reason IS DISTINCT FROM (CASE WHEN v_purchase.id IS NULL THEN 'original_purchase_missing' ELSE 'pending_adapter' END)
    OR NEW.sequence IS DISTINCT FROM v_sequence OR NEW.merchandise_refunded::numeric IS DISTINCT FROM v_delta
    OR NEW.retained_merchandise::numeric IS DISTINCT FROM v_receipt.merchandise_amount::numeric-v_refunded
    OR NEW.allocation IS DISTINCT FROM v_allocation OR NEW.original_occurred_at IS DISTINCT FROM v_receipt.occurred_at
    OR NEW.confirmed_at IS DISTINCT FROM v_bank.occurred_at
 THEN RAISE EXCEPTION 'Recovery adjustment preserves original units, optional Purchase and shared receipt history' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_adjustment_intent_guard BEFORE INSERT ON app.recovery_adjustment_intent
 FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_adjustment_intent();

--> statement-breakpoint
-- Existing ordinary writers retain every earlier seal and share only these counters.
CREATE OR REPLACE FUNCTION app.guard_refund_adjustment_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_receipt app.economic_receipt; v_purchase app.commerce_event; v_cash app.finance_transaction;
 v_bank app.local_refund_event; v_delta numeric; v_refunded numeric; v_sequence bigint; v_allocation jsonb;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Shared compensation requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_refund FROM app.refund WHERE id=NEW.refund_id FOR UPDATE;
 SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
 PERFORM id FROM app.finance_transaction WHERE id=v_receipt.transaction_id FOR UPDATE;
 SELECT * INTO v_purchase FROM app.commerce_event WHERE receipt_id=v_receipt.id AND name='Purchase';
 SELECT * INTO v_cash FROM app.finance_transaction WHERE id=v_refund.cash_transaction_id;
 SELECT * INTO v_bank FROM app.local_refund_event WHERE operation_id=v_refund.current_operation_id;
 SELECT coalesce(sum(a.merchandise_amount),0),jsonb_agg(jsonb_build_object('fulfillment_item_id',r.fulfillment_item_id,'order_item_id',f.order_item_id,'quantity',1,'merchandise_amount',a.merchandise_amount) ORDER BY r.fulfillment_item_id)
  INTO v_delta,v_allocation FROM app.refund_allocation a JOIN app.return_item r ON r.id=a.return_item_id
  JOIN app.fulfillment_item f ON f.id=r.fulfillment_item_id WHERE a.refund_id=v_refund.id AND a.receipt_id=v_receipt.id;
 SELECT coalesce(sum(amount),0) INTO v_refunded FROM (
  SELECT a.merchandise_amount amount FROM app.refund_allocation a JOIN app.refund r ON r.id=a.refund_id WHERE a.receipt_id=v_receipt.id AND r.status='succeeded'
  UNION ALL SELECT a.merchandise_amount FROM app.recovery_refund_allocation a JOIN app.recovery_refund r ON r.id=a.refund_id WHERE a.receipt_id=v_receipt.id AND r.status='succeeded'
 ) portions;
 SELECT coalesce(max(sequence),0)::bigint+1 INTO v_sequence FROM (
  SELECT sequence FROM app.refund_adjustment_intent WHERE receipt_id=v_receipt.id
  UNION ALL SELECT sequence FROM app.recovery_adjustment_intent WHERE receipt_id=v_receipt.id
 ) history;
 IF v_refund.id IS NULL OR v_refund.status<>'succeeded' OR v_receipt.id IS NULL OR v_receipt.order_id IS DISTINCT FROM v_refund.order_id
    OR v_cash.id IS NULL OR v_cash.created_xid<>pg_current_xact_id()::text OR v_bank.status IS DISTINCT FROM 'succeeded'
    OR NEW.purchase_event_id IS DISTINCT FROM v_purchase.id
    OR NEW.dispatch_reason IS DISTINCT FROM (CASE WHEN v_purchase.id IS NULL THEN 'original_purchase_missing' ELSE 'pending_adapter' END)
    OR NEW.sequence IS DISTINCT FROM v_sequence OR NEW.merchandise_refunded::numeric IS DISTINCT FROM v_delta
    OR NEW.retained_merchandise::numeric IS DISTINCT FROM v_receipt.merchandise_amount::numeric-v_refunded
    OR NEW.allocation IS DISTINCT FROM v_allocation OR NEW.original_occurred_at IS DISTINCT FROM v_receipt.occurred_at
    OR NEW.confirmed_at IS DISTINCT FROM v_bank.occurred_at
 THEN RAISE EXCEPTION 'Refund adjustment retains exact original receipt/Purchase, current units and cumulative retained merchandise' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_refund(p_refund_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_case app.return_case; v_order app.commerce_order; v_operation app.return_operation;
 v_latest app.refund_event; v_event app.refund_event; v_obligation app.finance_transaction; v_cash app.finance_transaction;
 v_job app.outbox_job; v_provider app.local_refund_operation; v_bank app.local_refund_event; v_result app.refund_event_result;
 v_receipt app.economic_receipt; v_intent app.refund_adjustment_intent; v_total numeric; v_used numeric;
 v_rows integer; v_units integer; v_postings integer; v_confirmed integer; v_cumulative numeric; v_history integer;
BEGIN
 SELECT * INTO v_refund FROM app.refund WHERE id=p_refund_id FOR UPDATE;
 SELECT * INTO v_case FROM app.return_case WHERE id=v_refund.case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id;
 SELECT * INTO v_operation FROM app.return_operation WHERE id=v_refund.operation_id;
 SELECT * INTO v_latest FROM app.refund_event WHERE refund_id=p_refund_id ORDER BY revision DESC LIMIT 1;
 SELECT count(*),coalesce(sum(amount),0) INTO v_rows,v_total FROM app.refund_allocation WHERE refund_id=p_refund_id;
 SELECT count(*) INTO v_units FROM app.return_item WHERE case_id=v_refund.case_id;
 IF v_refund.id IS NULL OR v_case.id IS NULL OR v_order.id IS NULL OR v_operation.id IS NULL OR v_latest.id IS NULL
    OR v_operation.action<>'refund.queue' OR v_operation.subject_id IS DISTINCT FROM v_case.id
    OR v_operation.order_id IS DISTINCT FROM v_order.id OR v_case.order_id IS DISTINCT FROM v_order.id
    OR v_case.resolution IS DISTINCT FROM 'refund' OR v_rows NOT BETWEEN 1 AND 100 OR v_rows<>v_units OR v_total<>v_refund.amount
    OR (v_refund.revision,v_refund.status,v_refund.current_job_id,v_refund.current_operation_id,v_refund.destination_source_id,v_refund.cash_transaction_id)
      IS DISTINCT FROM (v_latest.revision,v_latest.status,v_latest.job_id,v_latest.provider_operation_id,v_latest.destination_source_id,v_latest.cash_transaction_id)
    OR (SELECT count(*) FROM app.refund_event WHERE refund_id=p_refund_id)<>v_refund.revision
    OR (v_refund.status='succeeded' AND v_case.status<>'resolved')
    OR (v_refund.status<>'succeeded' AND v_case.status<>'refunding')
    OR EXISTS(SELECT 1 FROM app.return_item i WHERE i.case_id=v_case.id AND
       (i.inspection_status NOT IN ('accepted','waived') OR i.claim_state IS DISTINCT FROM CASE WHEN v_refund.status='succeeded' THEN 'refunded' ELSE 'held' END))
 THEN RAISE EXCEPTION 'Refund aggregate seals original approved case, whole allocations and exact contiguous current history' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_return_case(v_case.id);
 FOR v_receipt IN SELECT DISTINCT r.* FROM app.refund_allocation a JOIN app.economic_receipt r ON r.id=a.receipt_id WHERE a.refund_id=p_refund_id ORDER BY r.id LOOP
  PERFORM app.assert_refund_collection(v_receipt.id);
  SELECT coalesce(sum(a.amount),0) INTO v_used FROM app.refund_allocation a WHERE a.receipt_id=v_receipt.id;
  IF v_used>v_receipt.amount THEN RAISE EXCEPTION 'All refund obligations conserve their original collected receipt capacity' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT * INTO v_obligation FROM app.finance_transaction WHERE id=v_refund.obligation_transaction_id;
 SELECT count(*) INTO v_postings FROM app.finance_posting WHERE transaction_id=v_obligation.id;
 IF v_obligation.id IS NULL OR v_obligation.kind<>'refund_obligation' OR v_obligation.source<>'local.refund.obligation'
    OR v_obligation.effect_reference IS DISTINCT FROM v_refund.id::text OR v_obligation.order_id IS DISTINCT FROM v_order.id
    OR v_obligation.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR v_obligation.occurred_at IS DISTINCT FROM v_operation.occurred_at OR v_refund.created_at IS DISTINCT FROM v_operation.occurred_at
    OR v_postings<>2 OR EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=v_obligation.id)
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_obligation.id AND account='buyer_funds_liability' AND side='debit' AND amount=v_refund.amount)
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_obligation.id AND account='refund_payable' AND side='credit' AND amount=v_refund.amount)
 THEN RAISE EXCEPTION 'Original refund obligation moves buyer liability into refund payable without cash' USING ERRCODE='23514'; END IF;
 IF v_refund.current_job_id IS NOT NULL THEN
  SELECT * INTO v_job FROM app.outbox_job WHERE id=v_refund.current_job_id;
  SELECT * INTO v_provider FROM app.local_refund_operation WHERE creation_job_id=v_job.id;
  IF v_job.id IS NULL OR v_job.kind<>'refund.create' OR v_job.payload->>'refundId' IS DISTINCT FROM v_refund.id::text
     OR v_job.dedup_key IS DISTINCT FROM 'refund-create:'||v_refund.id::text||':'||(v_job.payload->>'attempt')
     OR v_refund.current_operation_id IS DISTINCT FROM v_provider.id
     OR (v_job.status='completed' AND (v_provider.id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('operation_id',v_provider.id)))
     OR (v_refund.status='queued' AND v_provider.id IS NOT NULL)
     OR (v_refund.status IN ('processing','unknown','succeeded','failed') AND v_provider.id IS NULL)
  THEN RAISE EXCEPTION 'Refund retains its exact queued or independently committed provider request' USING ERRCODE='23514'; END IF;
 ELSIF v_refund.status<>'awaiting_destination' OR v_order.payment_method<>'cod' THEN
  RAISE EXCEPTION 'Only an unverified COD destination can lack a refund creation job' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO v_confirmed FROM app.refund_event_result WHERE refund_id=p_refund_id AND outcome='confirmed';
 IF v_confirmed IS DISTINCT FROM (CASE WHEN v_refund.status='succeeded' THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'Actual outgoing refund confirms once independently of failed attempts' USING ERRCODE='23514'; END IF;
 FOR v_event IN SELECT * FROM app.refund_event WHERE refund_id=p_refund_id AND source_kind='provider' ORDER BY revision LOOP
  SELECT * INTO v_bank FROM app.local_refund_event WHERE id=v_event.source_id;
  SELECT * INTO v_result FROM app.refund_event_result WHERE event_id=v_bank.id;
  SELECT j.* INTO v_job FROM app.refund_provider_event r JOIN app.outbox_job j ON j.id=r.callback_job_id WHERE r.id=v_bank.id;
  IF v_bank.id IS NULL OR v_result.event_id IS NULL OR v_job.id IS NULL OR v_job.kind<>'refund.callback' OR v_job.status<>'completed'
     OR (v_result.refund_id,v_result.revision,v_result.refund_event_id,v_result.cash_transaction_id) IS DISTINCT FROM (v_refund.id,v_event.revision,v_event.id,v_event.cash_transaction_id)
     OR v_result.outcome IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirmed' ELSE 'failed' END)
     OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_bank.id,'refund_id',v_refund.id,'outcome',v_result.outcome,'version',v_event.revision)
     OR v_event.occurred_at IS DISTINCT FROM v_bank.occurred_at
  THEN RAISE EXCEPTION 'Every refund callback commits its exact historical result/event and own completed job' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF v_refund.status='succeeded' THEN
  SELECT * INTO v_bank FROM app.local_refund_event WHERE operation_id=v_refund.current_operation_id;
  SELECT * INTO v_cash FROM app.finance_transaction WHERE id=v_refund.cash_transaction_id;
  SELECT count(*) INTO v_postings FROM app.finance_posting WHERE transaction_id=v_cash.id;
  IF v_bank.status IS DISTINCT FROM 'succeeded' OR v_bank.amount IS DISTINCT FROM v_refund.amount
     OR v_cash.id IS NULL OR v_cash.kind<>'refund_cash' OR v_cash.source<>'local.refund.bank'
     OR v_cash.order_id IS DISTINCT FROM v_order.id OR v_cash.effect_reference IS DISTINCT FROM v_bank.id::text
     OR v_cash.environment IS DISTINCT FROM v_obligation.environment OR v_cash.occurred_at IS DISTINCT FROM v_bank.occurred_at
     OR v_postings<>2 OR EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=v_cash.id)
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_cash.id AND account='refund_payable' AND side='debit' AND amount=v_refund.amount)
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_cash.id AND account='company_cash' AND side='credit' AND amount=v_refund.amount)
  THEN RAISE EXCEPTION 'Refund cash equals the exact authenticated original company-bank debit once' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM app.refund_adjustment_intent WHERE refund_id=p_refund_id)<>(SELECT count(DISTINCT receipt_id) FROM app.refund_allocation WHERE refund_id=p_refund_id)
  THEN RAISE EXCEPTION 'Successful refund atomically retains every original-receipt adjustment intent' USING ERRCODE='23514'; END IF;
 ELSE
  IF v_refund.cash_transaction_id IS NOT NULL OR EXISTS(SELECT 1 FROM app.refund_adjustment_intent WHERE refund_id=p_refund_id)
  THEN RAISE EXCEPTION 'Unconfirmed or failed refunds cannot retain cash or successful adjustments' USING ERRCODE='23514'; END IF;
 END IF;
 FOR v_intent IN SELECT * FROM app.refund_adjustment_intent WHERE refund_id=p_refund_id ORDER BY receipt_id LOOP
  SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=v_intent.receipt_id;
  SELECT coalesce(sum(merchandise_refunded),0),count(*) INTO v_cumulative,v_history FROM (
   SELECT merchandise_refunded,sequence FROM app.refund_adjustment_intent WHERE receipt_id=v_intent.receipt_id
   UNION ALL SELECT merchandise_refunded,sequence FROM app.recovery_adjustment_intent WHERE receipt_id=v_intent.receipt_id
  ) history WHERE sequence<=v_intent.sequence;
  IF v_intent.sequence<>v_history OR v_intent.retained_merchandise::numeric IS DISTINCT FROM v_receipt.merchandise_amount::numeric-v_cumulative
     OR v_intent.merchandise_refunded::numeric IS DISTINCT FROM (SELECT sum(a.merchandise_amount) FROM app.refund_allocation a WHERE a.refund_id=p_refund_id AND a.receipt_id=v_intent.receipt_id)
     OR v_intent.original_occurred_at IS DISTINCT FROM v_receipt.occurred_at OR v_intent.confirmed_at IS DISTINCT FROM v_bank.occurred_at
  THEN RAISE EXCEPTION 'Historical refund adjustment retains its original increment and sequence-specific retained value' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;

--> statement-breakpoint
-- S33 native physical intake remains staged behind the original stop.
CREATE FUNCTION app.physical_intake_basis(p_unit_id uuid,p_replacement_id uuid,p_balance_id uuid DEFAULT NULL)
 RETURNS TABLE(known_quantity numeric,records bigint) LANGUAGE sql VOLATILE AS $$
 SELECT coalesce(sum(quantity) FILTER (WHERE identity_confirmed),0),count(*) FROM (
  SELECT g.quantity,g.identity_confirmed,g.expected_balance_id balance_id FROM app.return_goods g
   JOIN app.return_item r ON r.id=g.return_item_id
   WHERE r.fulfillment_item_id=p_unit_id AND r.replacement_link_id IS NOT DISTINCT FROM p_replacement_id
  UNION ALL
  SELECT g.quantity,g.identity_confirmed,g.balance_id FROM app.exception_goods_line g
   JOIN app.exception_unit u ON u.id=g.exception_unit_id
   WHERE u.fulfillment_item_id=p_unit_id AND u.replacement_link_id IS NOT DISTINCT FROM p_replacement_id
 ) goods WHERE p_balance_id IS NULL OR balance_id=p_balance_id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_exception_goods_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_unit app.exception_unit; v_intake app.exception_goods_intake; v_event app.exception_event;
 v_operation app.exception_operation; v_outcome app.local_parcel_outcome; v_balance app.inventory_balance;
 v_movement app.stock_movement; v_original record; v_received numeric;
BEGIN
 SELECT * INTO v_unit FROM app.exception_unit WHERE id=NEW.exception_unit_id AND exception_id=NEW.exception_id;
 SELECT * INTO v_intake FROM app.exception_goods_intake WHERE id=NEW.intake_id AND exception_id=NEW.exception_id;
 SELECT * INTO v_event FROM app.exception_event WHERE id=v_intake.event_id AND exception_id=NEW.exception_id;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=v_intake.operation_id AND exception_id=NEW.exception_id;
 SELECT * INTO v_outcome FROM app.local_parcel_outcome WHERE id=v_intake.physical_outcome_id;
 PERFORM id FROM app.fulfillment_item WHERE id=v_unit.fulfillment_item_id FOR UPDATE;
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Shared physical intake requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
 IF v_unit.id IS NULL OR v_unit.replacement_link_id IS NOT NULL OR v_intake.id IS NULL OR v_event.id IS NULL
    OR v_event.kind<>'intake' OR v_event.source_kind<>'operation' OR v_event.source_id IS DISTINCT FROM v_operation.id
    OR v_operation.id IS NULL OR v_operation.action<>'intake' OR v_operation.subject_id IS DISTINCT FROM NEW.exception_id
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR v_event.occurred_at IS DISTINCT FROM v_operation.occurred_at OR v_intake.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR v_outcome.id IS NULL OR v_outcome.status<>'returned_to_sender'
    OR v_outcome.occurred_at>v_intake.occurred_at OR NOT (v_outcome.unit_ids ? v_unit.fulfillment_item_id::text)
    OR NOT EXISTS(SELECT 1 FROM app.fulfillment_item f WHERE f.id=v_unit.fulfillment_item_id AND f.shipment_id=v_outcome.shipment_id)
    OR NOT EXISTS(SELECT 1 FROM app.parcel_outcome_result r WHERE r.event_id=v_outcome.id AND r.outcome='observed' AND r.exception_ids ? NEW.exception_id::text)
 THEN RAISE EXCEPTION 'Exception intake retains its exact original physical return and current scoped operation' USING ERRCODE='23514'; END IF;
 IF NEW.identity_confirmed THEN
  SELECT a.quantity,s.warehouse_id,b.stock_item_id INTO v_original FROM app.fulfillment_component_allocation a
   JOIN app.fulfillment_item f ON f.id=a.fulfillment_item_id JOIN app.order_shipment s ON s.id=f.shipment_id
   JOIN app.inventory_balance b ON b.id=a.balance_id
   WHERE a.fulfillment_item_id=v_unit.fulfillment_item_id AND a.balance_id=NEW.balance_id;
  SELECT * INTO v_balance FROM app.inventory_balance WHERE id=NEW.balance_id FOR UPDATE;
  SELECT known_quantity INTO v_received FROM app.physical_intake_basis(v_unit.fulfillment_item_id,v_unit.replacement_link_id,NEW.balance_id);
  SELECT * INTO v_movement FROM app.stock_movement WHERE id=NEW.stock_movement_id;
  IF v_original.quantity IS NULL OR v_balance.id IS NULL OR v_balance.warehouse_id IS DISTINCT FROM v_original.warehouse_id
     OR NEW.stock_item_id IS DISTINCT FROM v_original.stock_item_id OR v_received+NEW.quantity>v_original.quantity
     OR NOT EXISTS(SELECT 1 FROM app.warehouse WHERE id=v_original.warehouse_id AND active)
     OR v_movement.id IS NULL OR v_movement.source_ref IS DISTINCT FROM 'exception-goods:'||NEW.id::text
     OR v_movement.actor_id IS DISTINCT FROM v_operation.actor_id
     OR (v_movement.balance_id,v_movement.kind,v_movement.quantity,v_movement.on_hand_delta,v_movement.reserved_delta,v_movement.quarantined_delta)
       IS DISTINCT FROM (NEW.balance_id,'receive'::text,NEW.quantity,NEW.quantity,0,NEW.quantity)
  THEN RAISE EXCEPTION 'Known exception goods conserve original component capacity and exact quarantine movement' USING ERRCODE='23514'; END IF;
 ELSIF NEW.stock_item_id IS NOT NULL OR NEW.balance_id IS NOT NULL OR NEW.stock_movement_id IS NOT NULL
 THEN RAISE EXCEPTION 'Unidentified exception goods cannot credit known stock' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_goods_line_guard BEFORE INSERT ON app.exception_goods_line
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_goods_line();
--> statement-breakpoint
CREATE TRIGGER exception_goods_line_immutable BEFORE UPDATE OR DELETE ON app.exception_goods_line
 FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_goods_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.exception_goods_line g WHERE g.stock_movement_id=NEW.id AND g.identity_confirmed AND NEW.source_ref='exception-goods:'||g.id::text)
 THEN RAISE EXCEPTION 'Exception quarantine movement retains its exact physical intake' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_goods_movement_sealed AFTER INSERT ON app.stock_movement
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.source_ref LIKE 'exception-goods:%')
 EXECUTE FUNCTION app.seal_exception_goods_movement();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_goods() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_item app.return_item; v_event app.return_event; v_operation app.return_operation; v_movement app.stock_movement;
 v_balance app.inventory_balance; v_original record; v_received numeric;
BEGIN
 SELECT * INTO v_item FROM app.return_item WHERE id=NEW.return_item_id;
 PERFORM id FROM app.fulfillment_item WHERE id=v_item.fulfillment_item_id FOR UPDATE;
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Shared physical intake requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
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
  SELECT known_quantity INTO v_received FROM app.physical_intake_basis(v_item.fulfillment_item_id,v_item.replacement_link_id,NEW.expected_balance_id);
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_return_case(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_event app.return_event; v_item app.return_item; v_latest record; v_changed integer; v_total integer;
 v_complete boolean; v_recovery_id uuid;
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
     OR (v_case.status='replacing' AND v_item.claim_state NOT IN ('held','replacing','replaced','refunded'))
     OR (v_case.status='resolved' AND (CASE v_case.resolution WHEN 'replacement' THEN v_item.claim_state NOT IN ('replaced','refunded')
       WHEN 'refund' THEN v_item.claim_state<>'refunded' ELSE true END))
     OR (v_item.inspection_status='accepted' AND (SELECT records FROM app.physical_intake_basis(v_item.fulfillment_item_id,v_item.replacement_link_id))=0)
  THEN RAISE EXCEPTION 'Return unit head and eligibility retain their actual event/intake history' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF v_case.status='replacing' AND NOT EXISTS(SELECT 1 FROM app.return_item WHERE case_id=p_case_id AND claim_state NOT IN ('replaced','refunded'))
 THEN RAISE EXCEPTION 'A mixed original case resolves when its final actual replacement or refund outcome completes' USING ERRCODE='23514'; END IF;
 FOR v_event IN SELECT * FROM app.return_event WHERE case_id=p_case_id ORDER BY revision LOOP
  SELECT count(*) INTO v_changed FROM app.return_item_event WHERE event_id=v_event.id;
  IF ((v_event.kind IN ('create','decision') OR (v_event.kind='refund_confirmed' AND v_event.source_kind<>'recovery')) AND v_changed<>v_total)
     OR ((v_event.kind IN ('inspection','replacement_started','replacement_received','replacement_cancelled')
       OR (v_event.kind='refund_confirmed' AND v_event.source_kind='recovery')) AND v_changed NOT BETWEEN 1 AND v_total)
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
  IF v_event.kind='replacement_cancelled' AND v_changed IS DISTINCT FROM (
   SELECT count(*)::int FROM app.replacement_event source JOIN app.exception_cancellation representative ON representative.exception_unit_id=source.source_id
    JOIN app.exception_cancellation cancellation ON cancellation.operation_id=representative.operation_id
    JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id AND link.shipment_id=source.shipment_id
    WHERE source.id=v_event.source_id AND source.kind='cancel' AND source.source_kind='exception')
  THEN RAISE EXCEPTION 'Replacement cancellation changes every and only its exact retired original claim set' USING ERRCODE='23514'; END IF;
  IF v_event.source_kind='recovery' THEN
   SELECT refund_id INTO v_recovery_id FROM app.recovery_refund_event WHERE id=v_event.source_id;
   IF v_recovery_id IS NULL OR v_event.kind<>'refund_confirmed' OR v_changed IS DISTINCT FROM (
     SELECT count(*)::integer FROM app.recovery_return_items(v_recovery_id) WHERE case_id=p_case_id)
   THEN RAISE EXCEPTION 'Recovery history changes only its exact original cash-backed cancelled claim subset' USING ERRCODE='23514'; END IF;
   PERFORM app.assert_recovery_return_effects(v_recovery_id);
  END IF;
  IF v_event.kind='replacement_received' OR (v_event.kind='refund_confirmed' AND v_event.source_kind='recovery') THEN
   SELECT count(*)=v_total AND bool_and(history.claim_state IN ('replaced','refunded')) INTO v_complete
    FROM app.return_item item CROSS JOIN LATERAL (
     SELECT unit_history.claim_state FROM app.return_item_event unit_history JOIN app.return_event case_history ON case_history.id=unit_history.event_id
      WHERE unit_history.return_item_id=item.id AND case_history.revision<=v_event.revision
      ORDER BY case_history.revision DESC LIMIT 1
    ) history WHERE item.case_id=p_case_id;
   IF v_event.status IS DISTINCT FROM (CASE WHEN v_complete THEN 'resolved' ELSE 'replacing' END)
   THEN RAISE EXCEPTION 'Historical mixed completion derives from each original quantity at that event revision, independent of later callbacks' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
END;
$$;

--> statement-breakpoint
-- S33 original physical custody fence; source/callback seals remain pending.
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
   AND e.booking_id=v_source.booking_id AND e.environment=v_source.environment
   AND e.clock_namespace IS NOT DISTINCT FROM v_source.clock_namespace
   AND e.status='returned_to_sender' AND e.occurred_at<=NEW.received_at
   AND e.unit_ids ? NEW.fulfillment_item_id::text)
 THEN RAISE EXCEPTION 'Known returned-to-sender custody cannot create a new later buyer receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
-- Core row/event guards. Deferred source/actor/aggregate/job seals are still
-- required before the first-statement execution stop may be reconsidered.
CREATE FUNCTION app.guard_commerce_exception() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_event app.exception_event;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original exception cases are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_order FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
  IF v_order.id IS NULL OR NEW.revision<>0 OR NEW.status<>'preparing' OR NEW.proposal_event_id IS NOT NULL
     OR NOT (CASE NEW.source_kind
       WHEN 'payment_event' THEN NEW.kind IN ('late_collection','unallocated_collection')
       WHEN 'cod_event' THEN NEW.kind IN ('late_collection','unallocated_collection','cod_refusal')
       WHEN 'stock_report' THEN NEW.kind='stock_discrepancy'
       WHEN 'parcel_outcome' THEN NEW.kind IN ('delivery_failure','cod_refusal')
       WHEN 'replacement' THEN NEW.kind='replacement_stock'
       WHEN 'booking' THEN NEW.kind='waybill_uncertain' ELSE false END)
  THEN RAISE EXCEPTION 'Exception creation retains its original order and finite source kind' USING ERRCODE='23514'; END IF;
  NEW.created_at:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
  IF NEW.source_kind='stock_report' THEN NEW.occurred_at:=NEW.created_at; END IF;
  IF NEW.occurred_at>NEW.created_at
  THEN RAISE EXCEPTION 'Exception observation cannot precede its original source occurrence' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp(); NEW.created_xid:=pg_current_xact_id()::text;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revision','status','proposal_event_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','status','proposal_event_id'])
     OR NEW.revision::bigint<>OLD.revision::bigint+1
  THEN RAISE EXCEPTION 'Exception head changes one revision without retargeting source or history' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_event FROM app.exception_event WHERE exception_id=NEW.id AND revision=NEW.revision;
  IF v_event.id IS NULL OR v_event.status IS DISTINCT FROM NEW.status
     OR v_event.snapshot->>'proposal_event_id' IS DISTINCT FROM NEW.proposal_event_id::text
  THEN RAISE EXCEPTION 'Exception head retains its exact appended event' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER commerce_exception_guard BEFORE INSERT OR UPDATE OR DELETE ON app.commerce_exception
 FOR EACH ROW EXECUTE FUNCTION app.guard_commerce_exception();
--> statement-breakpoint
CREATE FUNCTION app.guard_exception_unit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_original record; v_event app.exception_event;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original exception quantities are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id FOR UPDATE;
 IF v_case.id IS NULL THEN RAISE EXCEPTION 'Exception quantity requires its original case' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') OR NOT OLD.active OR NEW.active
  THEN RAISE EXCEPTION 'Exception quantity retains original financial and physical identity' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_event FROM app.exception_event WHERE exception_id=NEW.exception_id AND revision=v_case.revision+1;
  IF v_event.id IS NULL OR v_event.status<>'resolved' OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(v_event.snapshot->'units') u WHERE u->>'id'=NEW.id::text AND u->'active'='false'::jsonb)
  THEN RAISE EXCEPTION 'Active exception scope ends only in its exact resolved event' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT i.order_id,link.original_fulfillment_item_id,link.shipment_id replacement_id INTO v_original
  FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  LEFT JOIN app.replacement_link link ON link.id=NEW.replacement_link_id WHERE f.id=NEW.fulfillment_item_id FOR UPDATE OF f;
 IF v_case.created_xid<>pg_current_xact_id()::text OR v_case.revision<>0 OR v_case.status<>'preparing'
    OR NEW.kind IS DISTINCT FROM v_case.kind OR NOT NEW.active OR v_original.order_id IS DISTINCT FROM v_case.order_id
    OR (NEW.replacement_link_id IS NOT NULL AND (v_case.kind<>'replacement_stock' OR v_original.original_fulfillment_item_id IS DISTINCT FROM NEW.fulfillment_item_id
       OR v_original.replacement_id IS DISTINCT FROM v_case.source_id))
    OR (v_case.kind='replacement_stock' AND NEW.replacement_link_id IS NULL)
 THEN RAISE EXCEPTION 'Exception scope contains only its original order units and permitted physical occurrence' USING ERRCODE='23514'; END IF;
 NEW.created_at:=v_case.created_at; RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_unit_guard BEFORE INSERT OR UPDATE OR DELETE ON app.exception_unit
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_unit();
--> statement-breakpoint
CREATE FUNCTION app.guard_exception_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_order app.commerce_order;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Committed exception operations are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.created_xid<>pg_current_xact_id()::text OR OLD.response<>'{}'::jsonb OR NEW.response='{}'::jsonb
     OR (to_jsonb(NEW)-'response') IS DISTINCT FROM (to_jsonb(OLD)-'response')
  THEN RAISE EXCEPTION 'Exception response finalizes once in its original transaction' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 IF v_case.id IS NULL OR v_order.id IS NULL OR NEW.response<>'{}'::jsonb OR NEW.key!~'^[A-Za-z0-9_-]{16,200}$'
    OR ((NEW.action IN ('refund_queue','refund_reconcile')) IS DISTINCT FROM (NEW.proof_digest IS NOT NULL))
    OR (NEW.action IN ('destination','refund_reconcile') AND NOT EXISTS(
       SELECT 1 FROM app.recovery_refund r WHERE r.id=NEW.subject_id AND r.exception_id=v_case.id AND r.order_id=v_order.id))
    OR (NEW.action NOT IN ('destination','refund_reconcile') AND NEW.subject_id IS DISTINCT FROM v_case.id)
 THEN RAISE EXCEPTION 'Exception operation retains its exact subject and required financial proof' USING ERRCODE='23514'; END IF;
 IF NEW.action IN ('decide','buyer_accept','buyer_decline','apply') THEN
  IF jsonb_typeof(NEW.input) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.input->'expected_version') IS DISTINCT FROM 'number'
     OR NEW.input->>'expected_version'!~'^[1-9][0-9]{0,9}$'
  THEN RAISE EXCEPTION 'Exception decision retains its normalized exact expected revision' USING ERRCODE='23514'; END IF;
  IF (NEW.input->>'expected_version')::bigint<>v_case.revision OR v_case.status IN ('preparing','refunding','resolved')
     OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE exception_id=v_case.id)
     OR EXISTS(SELECT 1 FROM app.exception_cancellation WHERE exception_id=v_case.id)
  THEN RAISE EXCEPTION 'Exception choice is current and cannot overwrite a financial workflow' USING ERRCODE='23514'; END IF;
  IF NEW.action='apply' THEN
   IF NOT (NEW.input ?& ARRAY['expected_version','proposal_id','reason'])
      OR (NEW.input-ARRAY['expected_version','proposal_id','reason'])<>'{}'::jsonb
      OR jsonb_typeof(NEW.input->'proposal_id') IS DISTINCT FROM 'string'
      OR NEW.input->>'proposal_id' IS DISTINCT FROM v_case.proposal_event_id::text
      OR v_case.proposal_event_id IS NULL OR v_case.status NOT IN ('awaiting_source','escalated')
      OR jsonb_typeof(NEW.input->'reason') IS DISTINCT FROM 'string'
      OR char_length(NEW.input->>'reason') NOT BETWEEN 1 AND 500
      OR NEW.input->>'reason' IS DISTINCT FROM btrim(NEW.input->>'reason')
      OR NOT EXISTS(SELECT 1 FROM app.exception_event proposal JOIN app.exception_event consent
        ON consent.exception_id=proposal.exception_id AND consent.cause_event_id=proposal.id AND consent.kind='buyer_accept'
        WHERE proposal.id=v_case.proposal_event_id AND proposal.exception_id=v_case.id AND proposal.kind='propose'
         AND proposal.snapshot->'proposal'->>'action' IN ('cancel_affected_units','refund_original_entitlement')
         AND proposal.snapshot->'proposal'->'unit_ids'=(SELECT coalesce(jsonb_agg(to_jsonb(id) ORDER BY id),'[]'::jsonb)
           FROM app.exception_unit WHERE exception_id=v_case.id AND active))
   THEN RAISE EXCEPTION 'CS application retains exact current normalized input and complete accepted original proposal' USING ERRCODE='23514'; END IF;
  ELSIF NEW.action='decide' THEN
   IF EXISTS(SELECT 1 FROM app.exception_event event
     CROSS JOIN LATERAL jsonb_array_elements_text(event.snapshot->'application'->'cancellation_ids') ref(id)
     JOIN app.shipment_cancellation cancellation ON cancellation.id::text=ref.id
     WHERE event.exception_id=v_case.id AND event.snapshot->'application'->>'proposal_id'=v_case.proposal_event_id::text
      AND cancellation.status IN ('queued','acknowledged'))
   THEN RAISE EXCEPTION 'A new proposal cannot supersede its pending original carrier effect' USING ERRCODE='23514'; END IF;
   IF NOT (NEW.input ?& ARRAY['expected_version','decision','reason']) OR (NEW.input-ARRAY['expected_version','decision','reason'])<>'{}'::jsonb
      OR jsonb_typeof(NEW.input->'decision') IS DISTINCT FROM 'string'
      OR NEW.input->>'decision' NOT IN ('propose_cancellation','propose_refund','keep_waiting','escalate')
      OR jsonb_typeof(NEW.input->'reason') IS DISTINCT FROM 'string' OR char_length(NEW.input->>'reason') NOT BETWEEN 1 AND 500
      OR NEW.input->>'reason' IS DISTINCT FROM btrim(NEW.input->>'reason')
      OR (NEW.input->>'decision'='propose_cancellation' AND v_case.kind NOT IN ('stock_discrepancy','cod_refusal','delivery_failure','replacement_stock'))
      OR (NEW.input->>'decision'='propose_refund' AND v_case.kind='waybill_uncertain')
   THEN RAISE EXCEPTION 'CS exception decision is a closed finite eligible proposal or escalation' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT (NEW.input ?& ARRAY['exception_id','expected_version','action','proposal_id'])
      OR (NEW.input-ARRAY['exception_id','expected_version','action','proposal_id'])<>'{}'::jsonb
      OR jsonb_typeof(NEW.input->'exception_id') IS DISTINCT FROM 'string' OR NEW.input->>'exception_id' IS DISTINCT FROM v_case.id::text
      OR jsonb_typeof(NEW.input->'proposal_id') IS DISTINCT FROM 'string' OR NEW.input->>'proposal_id' IS DISTINCT FROM v_case.proposal_event_id::text
      OR NEW.input->>'action' IS DISTINCT FROM (CASE NEW.action WHEN 'buyer_accept' THEN 'accept_proposal' ELSE 'decline_proposal' END)
      OR v_case.status<>'awaiting_buyer' OR v_case.proposal_event_id IS NULL
   THEN RAISE EXCEPTION 'Buyer exception choice retains its exact current case/proposal and closed action' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 NEW.occurred_at:=CASE WHEN NEW.action='report' AND v_case.revision=0 AND v_case.created_xid=pg_current_xact_id()::text
  THEN v_case.created_at ELSE date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace)) END;
 NEW.recorded_at:=clock_timestamp(); NEW.created_xid:=pg_current_xact_id()::text; RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.exception_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_exception_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_order app.commerce_order; v_operation app.exception_operation;
 v_proposal app.exception_event; v_previous app.exception_event; v_units jsonb; v_unit_ids jsonb; v_action text; v_expected_status text; v_expected_pointer text; v_application jsonb;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id FOR UPDATE;
 IF v_case.id IS NULL OR NEW.revision::bigint<>v_case.revision::bigint+1
    OR NEW.occurred_at<v_case.created_at OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace)
    OR NOT (NEW.snapshot ?& ARRAY['proposal_event_id','units','proposal','application'])
    OR (NEW.snapshot-ARRAY['proposal_event_id','units','proposal','application'])<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Exception event appends exact current case/time and closed snapshot' USING ERRCODE='23514'; END IF;
 IF v_case.revision>0 THEN
  SELECT * INTO v_previous FROM app.exception_event WHERE exception_id=v_case.id AND revision=v_case.revision;
  IF v_previous.id IS NULL OR NEW.occurred_at<v_previous.occurred_at OR NEW.kind='open'
     OR (v_case.status='resolved' AND (NEW.kind<>'intake' OR NEW.status<>'resolved'))
  THEN RAISE EXCEPTION 'Exception events retain ordered history and resolved cases permit only later physical intake' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind NOT IN ('open','stock_report') OR NEW.status='resolved' THEN
  RAISE EXCEPTION 'Exception history starts with its actual open observation' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'fulfillment_item_id',u.fulfillment_item_id,'replacement_link_id',u.replacement_link_id,
   'active',CASE WHEN NEW.status='resolved' THEN false ELSE u.active END) ORDER BY u.id),'[]'::jsonb),
   coalesce(jsonb_agg(to_jsonb(u.id) ORDER BY u.id) FILTER (WHERE u.active),'[]'::jsonb)
  INTO v_units,v_unit_ids FROM app.exception_unit u WHERE u.exception_id=v_case.id;
 IF NEW.snapshot->'units' IS DISTINCT FROM v_units OR jsonb_array_length(v_units)>100
 THEN RAISE EXCEPTION 'Exception event freezes its complete original unit and occurrence set' USING ERRCODE='23514'; END IF;
 IF NEW.source_kind='operation' THEN
  SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.source_id AND exception_id=v_case.id;
  IF v_operation.id IS NULL OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR v_operation.actor_id IS DISTINCT FROM NEW.actor_id OR v_operation.occurred_at IS DISTINCT FROM NEW.occurred_at
  THEN RAISE EXCEPTION 'Exception event retains its actual unfinished current operation' USING ERRCODE='23514'; END IF;
  IF v_operation.action='decide' AND (NEW.kind IS DISTINCT FROM (CASE v_operation.input->>'decision' WHEN 'escalate' THEN 'escalate' ELSE 'propose' END)
      OR NEW.reason IS DISTINCT FROM v_operation.input->>'reason')
  THEN RAISE EXCEPTION 'CS operation records only its exact proposed decision and original reason' USING ERRCODE='23514'; END IF;
  IF v_operation.action IN ('buyer_accept','buyer_decline') AND NEW.kind IS DISTINCT FROM v_operation.action
  THEN RAISE EXCEPTION 'Buyer proposal consent cannot execute another business action' USING ERRCODE='23514'; END IF;
 END IF;
 v_application:=NEW.snapshot->'application';
 IF v_application IS DISTINCT FROM 'null'::jsonb THEN
  SELECT * INTO v_proposal FROM app.exception_event WHERE id=v_case.proposal_event_id AND exception_id=v_case.id AND kind='propose';
  IF NEW.source_kind<>'operation' OR v_operation.action IS DISTINCT FROM 'apply' OR NEW.kind NOT IN ('source_reconciled','cancel')
     OR v_case.status NOT IN ('awaiting_source','escalated') OR jsonb_typeof(v_application) IS DISTINCT FROM 'object'
     OR NOT (v_application ?& ARRAY['proposal_id','consent_event_id','cancellation_ids'])
     OR (v_application-ARRAY['proposal_id','consent_event_id','cancellation_ids'])<>'{}'::jsonb
     OR v_application->>'proposal_id' IS DISTINCT FROM v_proposal.id::text
     OR v_operation.input->>'proposal_id' IS DISTINCT FROM v_proposal.id::text
     OR NEW.reason IS DISTINCT FROM v_operation.input->>'reason'
     OR (NEW.kind='source_reconciled' AND NEW.status NOT IN ('awaiting_source','awaiting_return','ready_for_refund','escalated'))
     OR (NEW.kind='cancel' AND NEW.status NOT IN ('awaiting_return','ready_for_refund','resolved'))
     OR v_proposal.snapshot->'proposal'->>'action' NOT IN ('cancel_affected_units','refund_original_entitlement')
     OR v_proposal.snapshot->'proposal'->'unit_ids' IS DISTINCT FROM v_unit_ids
     OR NOT EXISTS(SELECT 1 FROM app.exception_event consent WHERE consent.exception_id=v_case.id AND consent.id::text=v_application->>'consent_event_id'
       AND consent.kind='buyer_accept' AND consent.cause_event_id=v_proposal.id AND consent.revision<=v_case.revision)
     OR jsonb_typeof(v_application->'cancellation_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(v_application->'cancellation_ids')>100
  THEN RAISE EXCEPTION 'Application retains the current exact accepted proposal and finite carrier intents' USING ERRCODE='23514'; END IF;
  IF v_application->'cancellation_ids' IS DISTINCT FROM (SELECT coalesce(jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb) FROM jsonb_array_elements(v_application->'cancellation_ids'))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_application->'cancellation_ids') ref
      LEFT JOIN app.shipment_cancellation cancellation ON cancellation.id::text=ref#>>'{}'
      LEFT JOIN app.shipment_booking booking ON booking.id=cancellation.booking_id
      LEFT JOIN app.fulfillment fulfillment ON fulfillment.id=booking.fulfillment_id
      WHERE jsonb_typeof(ref)<>'string' OR cancellation.id IS NULL OR NOT EXISTS(
       SELECT 1 FROM app.exception_unit unit JOIN app.fulfillment_item item ON item.id=unit.fulfillment_item_id
        WHERE unit.exception_id=v_case.id AND unit.active AND unit.replacement_link_id IS NULL AND item.shipment_id=fulfillment.shipment_id))
  THEN RAISE EXCEPTION 'Application references only unique sorted original carrier intents of its exact physical scope' USING ERRCODE='23514'; END IF;
 ELSIF NEW.source_kind='operation' AND v_operation.action='apply' THEN
  RAISE EXCEPTION 'An explicit application cannot omit its retained original consent and carrier identities' USING ERRCODE='23514';
 END IF;
 IF NEW.kind='propose' THEN
  v_action:=CASE v_operation.input->>'decision' WHEN 'propose_cancellation' THEN 'cancel_affected_units'
   WHEN 'propose_refund' THEN 'refund_original_entitlement' WHEN 'keep_waiting' THEN 'continue_waiting' ELSE NULL END;
  IF NEW.source_kind<>'operation' OR v_operation.action IS DISTINCT FROM 'decide' OR v_action IS NULL OR NEW.status<>'awaiting_buyer'
     OR NEW.snapshot->>'proposal_event_id' IS DISTINCT FROM NEW.id::text
     OR NEW.snapshot->'proposal' IS DISTINCT FROM jsonb_build_object('action',v_action,'unit_ids',v_unit_ids)
  THEN RAISE EXCEPTION 'Proposal binds the exact scoped decision and complete affected units' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.snapshot->'proposal' IS DISTINCT FROM 'null'::jsonb
     OR (NEW.snapshot->>'proposal_event_id' IS NOT NULL AND NEW.snapshot->>'proposal_event_id' IS DISTINCT FROM v_case.proposal_event_id::text)
     OR (NEW.status='resolved' AND NEW.snapshot->'proposal_event_id' IS DISTINCT FROM 'null'::jsonb)
  THEN RAISE EXCEPTION 'Only a new proposal creates a new buyer choice identity' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind='escalate' AND (NEW.source_kind<>'operation' OR v_operation.action IS DISTINCT FROM 'decide'
    OR v_operation.input->>'decision' IS DISTINCT FROM 'escalate' OR NEW.status<>'escalated' OR NEW.snapshot->'proposal_event_id' IS DISTINCT FROM 'null'::jsonb)
 THEN RAISE EXCEPTION 'Exception escalation retains its actual scoped CS decision without executing a remedy' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('buyer_accept','buyer_decline') THEN
  SELECT * INTO v_proposal FROM app.exception_event WHERE id=v_case.proposal_event_id AND exception_id=v_case.id AND kind='propose';
  IF NEW.source_kind<>'operation' OR v_operation.action IS DISTINCT FROM NEW.kind OR v_proposal.id IS NULL OR v_case.status<>'awaiting_buyer'
     OR NEW.cause_event_id IS DISTINCT FROM v_proposal.id OR v_operation.input->>'proposal_id' IS DISTINCT FROM v_proposal.id::text
  THEN RAISE EXCEPTION 'Buyer choice retains its exact current original proposal' USING ERRCODE='23514'; END IF;
  v_action:=v_proposal.snapshot->'proposal'->>'action';
  v_expected_status:=CASE WHEN NEW.kind='buyer_decline' THEN 'escalated'
   WHEN v_action='continue_waiting' AND v_case.kind IN ('stock_discrepancy','replacement_stock') THEN 'awaiting_stock'
   WHEN v_action='continue_waiting' AND v_case.kind IN ('cod_refusal','delivery_failure') THEN 'awaiting_return'
   ELSE 'awaiting_source' END;
  v_expected_pointer:=CASE WHEN NEW.kind='buyer_accept' AND v_action<>'continue_waiting' THEN v_proposal.id::text ELSE NULL END;
  IF v_action NOT IN ('cancel_affected_units','refund_original_entitlement','continue_waiting')
     OR v_proposal.snapshot->'proposal'->'unit_ids' IS DISTINCT FROM v_unit_ids
     OR NEW.status IS DISTINCT FROM v_expected_status OR NEW.snapshot->>'proposal_event_id' IS DISTINCT FROM v_expected_pointer
     OR NEW.reason IS DISTINCT FROM (CASE NEW.kind WHEN 'buyer_accept' THEN 'Buyer accepted the exact scoped proposal; execution remains separately guarded'
       ELSE 'Buyer declined the exact scoped proposal; staff follow-up is required' END)
  THEN RAISE EXCEPTION 'Buyer consent retains its complete original proposal without cancelling goods or sending money' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_event_guard BEFORE INSERT ON app.exception_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_event();
--> statement-breakpoint
CREATE TRIGGER exception_event_immutable BEFORE UPDATE OR DELETE ON app.exception_event
 FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();

--> statement-breakpoint
-- Positive collection case qualification. Other case kinds and universal
-- source/actor/aggregate/job closure remain incomplete behind S33_STOP.
CREATE FUNCTION app.assert_exception_collection_case(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_order app.commerce_order; v_source record; v_job app.outbox_job;
 v_journal app.finance_transaction; v_receipt app.economic_receipt; v_provider text; v_callback_kind text;
 v_prefix text; v_environment text; v_postings integer; v_units jsonb; v_expected jsonb;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Original recovery collection requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
 v_environment:=CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END;
 IF v_case.id IS NULL OR v_order.id IS NULL OR v_case.kind NOT IN ('late_collection','unallocated_collection')
    OR v_case.source_kind NOT IN ('payment_event','cod_event') OR v_environment IS NULL
 THEN RAISE EXCEPTION 'Collection case requires its original supported financial source' USING ERRCODE='23514'; END IF;
 IF v_case.source_kind='payment_event' THEN
  SELECT r.receipt_id,r.transaction_id,r.outcome,e.id event_id,e.status,e.amount,e.occurred_at,p.id operation_id,p.environment,a.order_id,null::uuid shipment_id,registered.callback_job_id
   INTO v_source FROM app.payment_event_result r JOIN app.local_payment_event e ON e.id=r.event_id
   JOIN app.local_payment_operation p ON p.id=e.operation_id JOIN app.payment_attempt a ON a.id=p.attempt_id
   JOIN app.payment_provider_event registered ON registered.id=e.id WHERE r.event_id=v_case.source_id;
  v_provider:='local.payment';v_callback_kind:='payment.callback';v_prefix:='payment-callback:';
 ELSE
  SELECT r.receipt_id,r.transaction_id,r.outcome,e.id event_id,e.status,e.amount,e.occurred_at,p.id operation_id,p.environment,s.order_id,s.id shipment_id,registered.callback_job_id
   INTO v_source FROM app.cod_event_result r JOIN app.local_cod_event e ON e.id=r.event_id
   JOIN app.local_cod_operation p ON p.id=e.operation_id JOIN app.order_shipment s ON s.id=p.shipment_id
   JOIN app.cod_provider_event registered ON registered.id=e.id WHERE r.event_id=v_case.source_id;
  v_provider:='local.cod';v_callback_kind:='cod.callback';v_prefix:='cod-callback:';
 END IF;
 IF v_source.event_id IS NULL OR v_source.outcome<>'recovery' OR v_source.transaction_id IS NULL
    OR v_source.order_id IS DISTINCT FROM v_case.order_id OR v_source.environment IS DISTINCT FROM v_environment
    OR v_source.status IS DISTINCT FROM (CASE v_provider WHEN 'local.payment' THEN 'confirmed' ELSE 'collected' END)
    OR v_order.payment_method IS DISTINCT FROM (CASE v_provider WHEN 'local.payment' THEN 'prepaid' ELSE 'cod' END)
    OR v_source.occurred_at IS DISTINCT FROM v_case.occurred_at
    OR (v_case.kind='late_collection') IS DISTINCT FROM (v_source.receipt_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Collection case retains the actual positive original recovery result' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=v_source.callback_job_id;
 IF v_job.id IS NULL OR v_job.kind<>v_callback_kind OR v_job.status<>'completed' OR v_job.completed_at IS NULL
    OR v_job.dedup_key IS DISTINCT FROM v_prefix||v_case.source_id::text
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_case.source_id)
    OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_case.source_id,'outcome','recovery')
 THEN RAISE EXCEPTION 'Collection case retains its exact completed original callback' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_journal FROM app.finance_transaction WHERE id=v_source.transaction_id FOR UPDATE;
 SELECT count(*) INTO v_postings FROM app.finance_posting WHERE transaction_id=v_journal.id;
 IF v_journal.id IS NULL OR v_journal.order_id IS DISTINCT FROM v_case.order_id OR v_journal.environment IS DISTINCT FROM v_environment
    OR v_journal.kind IS DISTINCT FROM (CASE WHEN v_source.receipt_id IS NULL THEN 'adjustment' ELSE 'economic_receipt' END)
    OR v_journal.source IS DISTINCT FROM (CASE WHEN v_source.receipt_id IS NULL THEN v_provider||'.recovery' ELSE v_provider END)
    OR v_journal.effect_reference IS DISTINCT FROM v_source.operation_id::text OR v_journal.occurred_at IS DISTINCT FROM v_source.occurred_at
    OR v_postings<>2 OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_journal.id AND account='provider_receivable' AND side='debit' AND amount=v_source.amount)
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_journal.id AND account='buyer_funds_liability' AND side='credit' AND amount=v_source.amount)
    OR (v_case.created_xid=pg_current_xact_id()::text AND EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=v_journal.id))
 THEN RAISE EXCEPTION 'Collection case retains actual original balanced money without a new sale' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(fulfillment_item_id) ORDER BY fulfillment_item_id),'[]'::jsonb)
  INTO v_units FROM app.exception_unit WHERE exception_id=p_case_id;
 IF v_source.receipt_id IS NULL THEN
  IF v_units<>'[]'::jsonb OR EXISTS(SELECT 1 FROM app.economic_receipt WHERE transaction_id=v_journal.id)
  THEN RAISE EXCEPTION 'Unallocated original money invents no economic receipt or purchased units' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=v_source.receipt_id;
  IF v_receipt.id IS NULL OR v_receipt.transaction_id IS DISTINCT FROM v_journal.id OR v_receipt.order_id IS DISTINCT FROM v_order.id
     OR v_receipt.source IS DISTINCT FROM v_provider OR v_receipt.environment IS DISTINCT FROM v_environment
     OR v_receipt.event_id IS DISTINCT FROM v_source.event_id::text OR v_receipt.effect_reference IS DISTINCT FROM v_source.operation_id::text
     OR v_receipt.amount IS DISTINCT FROM v_source.amount OR v_receipt.occurred_at IS DISTINCT FROM v_source.occurred_at
     OR v_receipt.kind IS DISTINCT FROM v_order.payment_method OR v_receipt.shipment_id IS DISTINCT FROM v_source.shipment_id
  THEN RAISE EXCEPTION 'Late collection case preserves its exact original economic receipt' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(funded.id) ORDER BY funded.id),'[]'::jsonb) INTO v_expected FROM app.receipt_entitled_unit_ids(v_receipt.id) funded;
  IF jsonb_array_length(v_expected) NOT BETWEEN 1 AND 100 OR v_units IS DISTINCT FROM v_expected
     OR EXISTS(SELECT 1 FROM app.exception_unit WHERE exception_id=p_case_id AND replacement_link_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Late collection case preserves the complete original financial unit scope' USING ERRCODE='23514'; END IF;
 END IF;
END;
$$;

--> statement-breakpoint
-- Aggregate history and positive collection closure. Actor/action, other
-- source kinds, cancellation and compensation seals remain behind S33_STOP.
CREATE FUNCTION app.assert_exception_case(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_latest app.exception_event; v_first app.exception_event;
 v_proposal app.exception_event; v_count bigint; v_min integer; v_max integer; v_units jsonb;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_case_id FOR UPDATE;
 SELECT * INTO v_latest FROM app.exception_event WHERE exception_id=p_case_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO v_first FROM app.exception_event WHERE exception_id=p_case_id AND revision=1;
 SELECT count(*),min(revision),max(revision) INTO v_count,v_min,v_max FROM app.exception_event WHERE exception_id=p_case_id;
 IF v_case.id IS NULL OR v_case.revision<1 OR v_latest.id IS NULL OR v_first.id IS NULL
    OR v_count<>v_case.revision OR v_min<>1 OR v_max<>v_case.revision
    OR v_latest.status IS DISTINCT FROM v_case.status
    OR v_latest.snapshot->>'proposal_event_id' IS DISTINCT FROM v_case.proposal_event_id::text
    OR v_first.occurred_at IS DISTINCT FROM v_case.created_at
 THEN RAISE EXCEPTION 'Exception case seals its contiguous original observation and current head' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'fulfillment_item_id',u.fulfillment_item_id,
    'replacement_link_id',u.replacement_link_id,'active',u.active) ORDER BY u.id),'[]'::jsonb)
  INTO v_units FROM app.exception_unit u WHERE u.exception_id=p_case_id;
 IF v_latest.snapshot->'units' IS DISTINCT FROM v_units
    OR (v_case.kind='unallocated_collection' AND v_units<>'[]'::jsonb)
    OR (v_case.kind<>'unallocated_collection' AND jsonb_array_length(v_units) NOT BETWEEN 1 AND 100)
    OR EXISTS(SELECT 1 FROM app.exception_unit WHERE exception_id=p_case_id AND active IS DISTINCT FROM (v_case.status<>'resolved'))
 THEN RAISE EXCEPTION 'Exception current scope is exactly its complete retained original quantity snapshot' USING ERRCODE='23514'; END IF;
 IF v_case.proposal_event_id IS NOT NULL THEN
  SELECT * INTO v_proposal FROM app.exception_event WHERE id=v_case.proposal_event_id AND exception_id=p_case_id AND kind='propose';
  IF v_proposal.id IS NULL OR v_proposal.revision>v_case.revision OR v_proposal.status<>'awaiting_buyer'
     OR v_proposal.snapshot->>'proposal_event_id' IS DISTINCT FROM v_proposal.id::text
  THEN RAISE EXCEPTION 'Exception buyer choice retains its own original scoped proposal' USING ERRCODE='23514'; END IF;
 ELSIF v_case.status='awaiting_buyer' THEN
  RAISE EXCEPTION 'Awaiting buyer choice requires an exact current proposal' USING ERRCODE='23514';
 END IF;
 IF v_case.kind IN ('late_collection','unallocated_collection') THEN
  PERFORM app.assert_exception_collection_case(p_case_id);
  IF (v_first.kind,v_first.status,v_first.source_kind,v_first.source_id)
      IS DISTINCT FROM ('open'::text,'open'::text,CASE v_case.source_kind WHEN 'payment_event' THEN 'payment' ELSE 'cod' END,v_case.source_id)
     OR v_first.actor_id IS NOT NULL OR v_first.snapshot->'proposal_event_id' IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'Collection history opens from its actual original callback without an invented actor or consent' USING ERRCODE='23514'; END IF;
 END IF;
 IF v_case.kind='stock_discrepancy' THEN
  IF v_case.source_kind<>'stock_report' OR (v_first.kind,v_first.status,v_first.source_kind,v_first.source_id)
      IS DISTINCT FROM ('stock_report'::text,'awaiting_stock'::text,'operation'::text,v_case.source_id)
     OR NOT EXISTS(SELECT 1 FROM app.exception_operation o WHERE o.id=v_case.source_id AND o.exception_id=v_case.id
       AND o.action='report' AND o.input->'reinspection'='null'::jsonb AND o.actor_id=v_first.actor_id
       AND o.occurred_at=v_case.created_at AND o.input->>'reason'=v_case.reason)
     OR (SELECT coalesce(jsonb_agg(to_jsonb(u.fulfillment_item_id) ORDER BY u.fulfillment_item_id),'[]'::jsonb)
          FROM app.exception_unit u WHERE u.exception_id=v_case.id AND u.replacement_link_id IS NULL)
        IS DISTINCT FROM (SELECT o.input->'fulfillment_item_ids' FROM app.exception_operation o WHERE o.id=v_case.source_id)
     OR EXISTS(SELECT 1 FROM app.exception_unit WHERE exception_id=v_case.id AND replacement_link_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Stock case retains its first actual scoped warehouse report and complete original units' USING ERRCODE='23514'; END IF;
 END IF;
 IF v_case.kind='replacement_stock' THEN PERFORM app.assert_exception_replacement_case(p_case_id); END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='commerce_exception' THEN PERFORM app.assert_exception_case(NEW.id);
 ELSE PERFORM app.assert_exception_case(NEW.exception_id); END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commerce_exception_sealed AFTER INSERT OR UPDATE ON app.commerce_exception
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_exception_case();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_event_sealed AFTER INSERT ON app.exception_event
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_exception_case();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_unit_sealed AFTER INSERT OR UPDATE ON app.exception_unit
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_exception_case();
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_collection_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_source_kind text;
BEGIN
 v_source_kind:=CASE TG_TABLE_NAME WHEN 'payment_event_result' THEN 'payment_event' ELSE 'cod_event' END;
 SELECT * INTO v_case FROM app.commerce_exception WHERE source_kind=v_source_kind AND source_id=NEW.event_id;
 IF v_case.id IS NULL OR v_case.kind IS DISTINCT FROM (CASE WHEN NEW.receipt_id IS NULL THEN 'unallocated_collection' ELSE 'late_collection' END)
    OR v_case.created_xid<>pg_current_xact_id()::text
 THEN RAISE EXCEPTION 'New recovery money atomically retains its exact original exception case' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_exception_case(v_case.id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_recovery_exception_sealed AFTER INSERT ON app.payment_event_result
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.outcome='recovery')
 EXECUTE FUNCTION app.seal_exception_collection_source();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cod_recovery_exception_sealed AFTER INSERT ON app.cod_event_result
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.outcome='recovery')
 EXECUTE FUNCTION app.seal_exception_collection_source();

--> statement-breakpoint
-- Authority is rechecked for the new operation, never retroactively for an old
-- actor when a worker appends later source facts. Full action/effect seals are
-- still required before execution of this stopped draft.
CREATE FUNCTION app.assert_exception_operation_actor(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_order app.commerce_order;
 v_user app.auth_user; v_session app.auth_session; v_grant app.role_grant; v_mfa app.mfa_session;
 v_guest app.commerce_guest_context; v_access app.order_access; v_proof app.access_proof;
 v_owner boolean; v_finance boolean; v_warehouse uuid; v_scope_count integer:=0;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Exception authority belongs to its atomically finalized new operation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 IF v_case.id IS NULL OR v_order.id IS NULL
 THEN RAISE EXCEPTION 'Exception authority retains its actual original order' USING ERRCODE='23514'; END IF;
 IF v_operation.actor_id IS NOT NULL THEN
  SELECT * INTO v_user FROM app.auth_user WHERE id=v_operation.actor_id FOR UPDATE;
  SELECT * INTO v_session FROM app.auth_session WHERE id=v_operation.session_id AND user_id=v_user.id FOR SHARE;
  SELECT * INTO v_grant FROM app.role_grant WHERE user_id=v_user.id FOR SHARE;
  SELECT * INTO v_mfa FROM app.mfa_session WHERE session_id=v_session.id FOR SHARE;
  IF v_user.id IS NULL OR NOT v_user.email_verified OR v_session.id IS NULL OR v_session.expires_at<=clock_timestamp()
     OR (coalesce(v_grant.roles,ARRAY['buyer']::text[]) && ARRAY['owner','ecommerce_admin','customer_service','warehouse','finance']::text[]
         AND (NOT v_user.two_factor_enabled OR v_mfa.session_id IS NULL))
  THEN RAISE EXCEPTION 'Exception actor requires its current verified session and staff MFA' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_guest FROM app.commerce_guest_context WHERE id=v_operation.guest_id FOR UPDATE;
  SELECT * INTO v_access FROM app.order_access WHERE order_id=v_order.id AND guest_id=v_operation.guest_id FOR SHARE;
  IF v_guest.id IS NULL OR v_guest.revoked_at IS NOT NULL OR v_guest.expires_at<=clock_timestamp()
     OR v_access.order_id IS NULL OR v_access.revoked_at IS NOT NULL OR v_access.expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'Guest exception choice retains its current original order access' USING ERRCODE='23514'; END IF;
 END IF;
 v_owner:=coalesce('owner'=ANY(v_grant.roles),false);
 v_finance:=v_owner OR (coalesce('finance'=ANY(v_grant.roles),false)
   AND coalesce(v_grant.permissions @> ARRAY['finance.refunds.read','finance.refunds.write']::text[],false));
 IF v_operation.action IN ('buyer_accept','buyer_decline','destination') THEN
  IF ((v_operation.actor_id IS NOT NULL AND v_order.owner_user_id=v_operation.actor_id)
      OR (v_operation.guest_id IS NOT NULL AND v_order.owner_guest_id=v_operation.guest_id)) IS NOT TRUE
  THEN RAISE EXCEPTION 'Buyer exception choices require original order ownership' USING ERRCODE='23514'; END IF;
 ELSIF v_operation.action IN ('report','decide','apply','intake') THEN
  IF v_operation.actor_id IS NULL OR NOT v_user.two_factor_enabled OR v_mfa.session_id IS NULL
     OR (NOT v_owner AND NOT coalesce((CASE WHEN v_operation.action IN ('decide','apply') THEN 'customer_service' ELSE 'warehouse' END)=ANY(v_grant.roles),false))
     OR (v_case.kind='unallocated_collection' AND v_operation.action IN ('report','intake'))
  THEN RAISE EXCEPTION 'Exception decisions and physical intake require their separate current staff roles' USING ERRCODE='23514'; END IF;
  FOR v_warehouse IN
   SELECT DISTINCT scope.warehouse_id FROM (
    SELECT coalesce(replacement.warehouse_id,original.warehouse_id) warehouse_id FROM app.exception_unit u
     JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id JOIN app.order_shipment original ON original.id=f.shipment_id
     LEFT JOIN app.replacement_link link ON link.id=u.replacement_link_id
     LEFT JOIN app.replacement_shipment replacement ON replacement.id=link.shipment_id
     WHERE u.exception_id=v_case.id AND (v_operation.action<>'intake' OR EXISTS(
       SELECT 1 FROM app.exception_goods_line line JOIN app.exception_goods_intake intake ON intake.id=line.intake_id
        WHERE line.exception_unit_id=u.id AND intake.exception_id=v_case.id AND intake.operation_id=v_operation.id))
    UNION ALL
    SELECT s.warehouse_id FROM app.order_shipment s WHERE s.order_id=v_order.id AND v_case.kind='unallocated_collection'
     AND (v_case.source_kind='payment_event' OR (v_case.source_kind='cod_event' AND EXISTS(
       SELECT 1 FROM app.local_cod_event e JOIN app.local_cod_operation operation ON operation.id=e.operation_id
        WHERE e.id=v_case.source_id AND operation.shipment_id=s.id)))
   ) scope ORDER BY scope.warehouse_id
  LOOP
   v_scope_count:=v_scope_count+1;
   IF NOT v_owner THEN
    PERFORM w.id FROM app.warehouse_membership m JOIN app.warehouse w ON w.id=m.warehouse_id
     WHERE m.user_id=v_operation.actor_id AND w.id=v_warehouse AND w.active FOR SHARE OF m,w;
    IF NOT FOUND THEN RAISE EXCEPTION 'Exception staff authority covers each affected physical origin' USING ERRCODE='23514'; END IF;
   END IF;
  END LOOP;
  IF v_scope_count=0 THEN RAISE EXCEPTION 'Operational exception authority requires actual affected origins' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT v_finance OR v_mfa.session_id IS NULL OR NOT v_user.two_factor_enabled
     OR v_mfa.verified_at<=clock_timestamp()-interval '5 minutes'
  THEN RAISE EXCEPTION 'Exception money requires current explicit finance grants and fresh MFA' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_proof FROM app.access_proof WHERE digest=v_operation.proof_digest FOR SHARE;
  IF v_proof.digest IS NULL OR v_proof.session_id IS DISTINCT FROM v_session.id OR v_proof.action<>'finance.recovery_refund'
     OR v_proof.subject_id IS DISTINCT FROM v_operation.subject_id::text OR v_proof.consumed_at IS NULL
     OR v_proof.consumed_at<v_operation.recorded_at OR v_proof.expires_at<=v_proof.consumed_at OR v_proof.consumed_at>clock_timestamp()
  THEN RAISE EXCEPTION 'Recovery finance consumes its own session/subject/purpose-bound proof after source waits' USING ERRCODE='23514'; END IF;
 END IF;
 IF (v_operation.actor_id IS NOT NULL AND v_session.expires_at<=clock_timestamp())
    OR (v_operation.guest_id IS NOT NULL AND (v_guest.expires_at<=clock_timestamp() OR v_access.expires_at<=clock_timestamp()))
    OR (v_operation.action IN ('refund_queue','refund_reconcile') AND v_mfa.verified_at<=clock_timestamp()-interval '5 minutes')
 THEN RAISE EXCEPTION 'Exception authority remains current after every scope and proof wait' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.actor_id IS NOT DISTINCT FROM v_operation.actor_id
    AND a.action='commerce_exception.'||v_operation.action AND a.subject_id=v_operation.subject_id::text AND a.outcome='allowed'
    AND a.details=jsonb_build_object('operation_id',v_operation.id,'exception_id',v_case.id) AND a.created_at>=v_operation.recorded_at)
 THEN RAISE EXCEPTION 'Exception operation retains its exact original actor/subject audit' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_operation_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_exception_operation_actor(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_operation_actor_sealed AFTER INSERT OR UPDATE ON app.exception_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_exception_operation_actor();

--> statement-breakpoint
CREATE FUNCTION app.guard_exception_collection_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='completed' AND NEW IS DISTINCT FROM OLD AND (
   EXISTS(SELECT 1 FROM app.commerce_exception c JOIN app.payment_provider_event source ON source.id=c.source_id
    WHERE c.source_kind='payment_event' AND c.kind IN ('late_collection','unallocated_collection') AND source.callback_job_id=OLD.id)
   OR EXISTS(SELECT 1 FROM app.commerce_exception c JOIN app.cod_provider_event source ON source.id=c.source_id
    WHERE c.source_kind='cod_event' AND c.kind IN ('late_collection','unallocated_collection') AND source.callback_job_id=OLD.id))
 THEN RAISE EXCEPTION 'Original exception collection callback completion and attempts are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_collection_job_guard BEFORE UPDATE ON app.outbox_job
 FOR EACH ROW WHEN (OLD.kind IN ('payment.callback','cod.callback'))
 EXECUTE FUNCTION app.guard_exception_collection_job();
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_collection_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case_id uuid;
BEGIN
 FOR v_case_id IN
  SELECT c.id FROM app.commerce_exception c JOIN app.payment_provider_event source ON source.id=c.source_id
   WHERE c.source_kind='payment_event' AND c.kind IN ('late_collection','unallocated_collection') AND source.callback_job_id=NEW.id
  UNION ALL
  SELECT c.id FROM app.commerce_exception c JOIN app.cod_provider_event source ON source.id=c.source_id
   WHERE c.source_kind='cod_event' AND c.kind IN ('late_collection','unallocated_collection') AND source.callback_job_id=NEW.id
 LOOP PERFORM app.assert_exception_case(v_case_id); END LOOP;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_collection_job_sealed AFTER UPDATE ON app.outbox_job
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.kind IN ('payment.callback','cod.callback') OR NEW.kind IN ('payment.callback','cod.callback'))
 EXECUTE FUNCTION app.seal_exception_collection_job();

--> statement-breakpoint
-- Domain projections are internal, not authorization. Writers and deferred
-- operation seals use the same facts without exposing finance to staff DTOs.
CREATE FUNCTION app.exception_physical_state(p_unit_id uuid) RETURNS text LANGUAGE sql VOLATILE AS $$
 WITH selected AS (
  SELECT u.*,f.shipment_id original_shipment_id,o.status order_status,o.clock_namespace,
   original.booking_id original_booking_id,
   CASE WHEN u.replacement_link_id IS NULL THEN original.handover_at ELSE replacement.handover_at END handover_at,
   CASE WHEN u.replacement_link_id IS NULL THEN receipt.received_at ELSE replacement_receipt.received_at END received_at
  FROM app.exception_unit u JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id
  JOIN app.order_item i ON i.id=f.order_item_id JOIN app.commerce_order o ON o.id=i.order_id
  LEFT JOIN app.fulfillment original ON original.shipment_id=f.shipment_id
  LEFT JOIN app.replacement_link link ON link.id=u.replacement_link_id
  LEFT JOIN app.replacement_shipment replacement ON replacement.id=link.shipment_id
  LEFT JOIN app.buyer_receipt receipt ON receipt.fulfillment_item_id=f.id
  LEFT JOIN app.replacement_buyer_receipt replacement_receipt ON replacement_receipt.replacement_link_id=link.id
  WHERE u.id=p_unit_id
 ), components AS (
  SELECT a.balance_id,a.quantity FROM selected u JOIN app.fulfillment_component_allocation a ON a.fulfillment_item_id=u.fulfillment_item_id
   WHERE u.replacement_link_id IS NULL
  UNION ALL
  SELECT a.balance_id,a.quantity FROM selected u JOIN app.replacement_component_allocation a ON a.replacement_link_id=u.replacement_link_id
 ), physical AS (
  SELECT count(*)>0 AND coalesce(bool_and(basis.known_quantity=a.quantity),false) complete_quarantine
   FROM selected u CROSS JOIN components a CROSS JOIN LATERAL app.physical_intake_basis(u.fulfillment_item_id,u.replacement_link_id,a.balance_id) basis
 )
 SELECT CASE
  WHEN physical.complete_quarantine THEN 'quarantined'
  WHEN u.replacement_link_id IS NULL AND EXISTS(
   SELECT 1 FROM app.local_parcel_outcome e JOIN app.parcel_outcome_result result ON result.event_id=e.id
    WHERE e.shipment_id=u.original_shipment_id AND e.booking_id=u.original_booking_id AND e.status='returned_to_sender'
     AND e.clock_namespace IS NOT DISTINCT FROM u.clock_namespace AND current_database()='99ribu_'||e.environment
     AND e.unit_ids ? u.fulfillment_item_id::text AND (u.received_at IS NULL OR e.occurred_at>=u.received_at)) THEN 'return_expected'
  WHEN u.received_at IS NOT NULL THEN 'received'
  WHEN EXISTS(SELECT 1 FROM app.exception_cancellation c WHERE c.fulfillment_item_id=u.fulfillment_item_id AND c.replacement_link_id IS NOT DISTINCT FROM u.replacement_link_id)
    OR (u.replacement_link_id IS NULL AND u.order_status='cancelled' AND u.handover_at IS NULL) THEN 'cancelled'
  WHEN u.handover_at IS NOT NULL THEN 'handed_over'
  ELSE 'unhanded' END
 FROM selected u CROSS JOIN physical;
$$;
--> statement-breakpoint
CREATE FUNCTION app.exception_projection(p_case_id uuid,p_buyer boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_event app.exception_event; v_proposal app.exception_event;
 v_units jsonb; v_choice jsonb:='null'::jsonb; v_refunds jsonb; v_result jsonb; v_explanation text;
BEGIN
 IF p_buyer IS NULL THEN RAISE EXCEPTION 'Exception projection requires an explicit staff or buyer boundary' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_case_id;
 IF v_case.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO v_event FROM app.exception_event WHERE exception_id=p_case_id AND revision=v_case.revision;
 IF v_event.id IS NULL THEN RAISE EXCEPTION 'Exception projection requires its exact current retained history' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'order_item_id',f.order_item_id,'unit_ordinal',f.unit_index,
   'shipment_id',CASE WHEN p_buyer THEN original.id ELSE coalesce(replacement.id,original.id) END)
   ||CASE WHEN p_buyer THEN jsonb_build_object('replacement_shipment_id',replacement.id)
     ELSE jsonb_build_object('fulfillment_item_id',f.id,'replacement_link_id',u.replacement_link_id,
      'warehouse_id',coalesce(replacement.warehouse_id,original.warehouse_id),'physical_state',app.exception_physical_state(u.id)) END ORDER BY u.id),'[]'::jsonb)
  INTO v_units FROM app.exception_unit u JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id
  JOIN app.order_shipment original ON original.id=f.shipment_id
  LEFT JOIN app.replacement_link link ON link.id=u.replacement_link_id LEFT JOIN app.replacement_shipment replacement ON replacement.id=link.shipment_id
  WHERE u.exception_id=p_case_id;
 IF v_case.proposal_event_id IS NOT NULL THEN
  SELECT * INTO v_proposal FROM app.exception_event WHERE id=v_case.proposal_event_id AND exception_id=p_case_id AND kind='propose';
  IF v_proposal.id IS NULL THEN RAISE EXCEPTION 'Exception projection retains its exact scoped proposal' USING ERRCODE='23514'; END IF;
  v_choice:=jsonb_build_object('id',v_proposal.id,'action',v_proposal.snapshot->'proposal'->'action','unit_ids',v_proposal.snapshot->'proposal'->'unit_ids',
   'explanation',v_proposal.reason,'created_at',to_char(v_proposal.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 END IF;
 v_explanation:=CASE WHEN NOT p_buyer THEN v_event.reason ELSE CASE v_case.status
   WHEN 'open' THEN 'Pesanan sedang ditinjau. Tim kami akan menindaklanjuti bagian yang terdampak.'
   WHEN 'awaiting_source' THEN CASE WHEN v_case.proposal_event_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM app.exception_event choice WHERE choice.exception_id=p_case_id AND choice.kind='buyer_accept' AND choice.cause_event_id=v_case.proposal_event_id)
     THEN 'Persetujuan tersimpan. Pelaksanaan penanganan masih menunggu pemeriksaan tim kami.'
     ELSE 'Informasi dan langkah berikutnya sedang diperiksa.' END
   WHEN 'awaiting_buyer' THEN 'Pilihan penanganan tersedia. Periksa unit dan tindakan yang diajukan.'
   WHEN 'awaiting_stock' THEN 'Ketersediaan barang untuk penanganan ini sedang ditunggu.'
   WHEN 'awaiting_return' THEN 'Barang yang kembali masih menunggu penerimaan dan pemeriksaan.'
   WHEN 'ready_for_refund' THEN 'Pengembalian dana menunggu proses keuangan.'
   WHEN 'refunding' THEN 'Pengembalian dana sedang diproses. Konfirmasi pengiriman dana ditampilkan terpisah.'
   WHEN 'unknown' THEN 'Hasil proses sedang diperiksa. Riwayat sebelumnya tetap tersimpan.'
   WHEN 'resolved' THEN 'Penanganan kasus ini selesai. Periksa riwayat dana dan paket untuk rinciannya.'
   WHEN 'escalated' THEN 'Kasus ini memerlukan tindak lanjut tim kami.'
   ELSE NULL END END;
 IF v_explanation IS NULL OR jsonb_array_length(v_units)>100 THEN RAISE EXCEPTION 'Exception projection has a bounded complete current scope' USING ERRCODE='23514'; END IF;
 v_result:=jsonb_build_object('id',v_case.id,'order_id',v_case.order_id,'kind',v_case.kind,'status',v_case.status,'version',v_case.revision,
  'units',v_units,'proposal',v_choice,'created_at',to_char(v_case.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'explanation',v_explanation);
 IF NOT p_buyer THEN
  RETURN v_result||jsonb_build_object('source_kind',v_case.source_kind,'source_id',v_case.source_id,
   'occurred_at',to_char(v_case.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'exception_id',r.exception_id,'order_id',r.order_id,'version',r.revision,'amount',r.amount,
   'status',CASE WHEN r.status IN ('queued','processing') AND job.status='unknown' THEN 'unknown'
     WHEN r.status='queued' AND job.status='failed' THEN 'failed' ELSE r.status END,
   'created_at',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'explanation',CASE WHEN r.status IN ('queued','processing') AND job.status='unknown' THEN 'Hasil pengiriman dana sedang diperiksa.'
     WHEN r.status='queued' AND job.status='failed' THEN 'Pengiriman dana belum berhasil. Tim keuangan sedang memeriksanya.'
     ELSE CASE r.status WHEN 'awaiting_destination' THEN 'Dana belum dikirim. Tujuan pengembalian dana masih perlu diverifikasi.'
       WHEN 'queued' THEN 'Pengembalian dana masuk antrean.' WHEN 'processing' THEN 'Pengiriman dana sedang diproses.'
       WHEN 'unknown' THEN 'Hasil pengiriman dana sedang diperiksa.' WHEN 'succeeded' THEN 'Pengembalian dana sudah dikonfirmasi.'
       WHEN 'failed' THEN 'Pengiriman dana belum berhasil. Tim keuangan sedang memeriksanya.' END END) ORDER BY r.created_at,r.id),'[]'::jsonb)
  INTO v_refunds FROM app.recovery_refund r LEFT JOIN app.outbox_job job ON job.id=r.current_job_id WHERE r.exception_id=p_case_id;
 IF jsonb_array_length(v_refunds)>100 THEN RAISE EXCEPTION 'Buyer recovery projection retains a bounded complete original-source refund set' USING ERRCODE='23514'; END IF;
 RETURN v_result||jsonb_build_object('refunds',v_refunds);
END;
$$;

--> statement-breakpoint
-- Recovery accepts the actual original qualified receipt even when collection
-- was late and deliberately created no Purchase. Application writers also
-- reverify its original source signature through lockVerifiedReceivables.
CREATE FUNCTION app.assert_recovery_receipt(p_receipt_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_receipt app.economic_receipt; v_journal app.finance_transaction; v_order app.commerce_order;
 v_qualified boolean; v_postings integer; v_environment text;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Qualified recovery receipt requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=p_receipt_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_receipt.order_id FOR UPDATE;
 SELECT * INTO v_journal FROM app.finance_transaction WHERE id=v_receipt.transaction_id FOR UPDATE;
 v_environment:=CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END;
 IF v_receipt.id IS NULL OR v_order.id IS NULL OR v_journal.id IS NULL OR v_environment IS NULL
    OR v_receipt.kind IS DISTINCT FROM v_order.payment_method OR v_receipt.environment IS DISTINCT FROM v_environment
    OR v_receipt.source IS DISTINCT FROM (CASE v_order.payment_method WHEN 'prepaid' THEN 'local.payment' ELSE 'local.cod' END)
    OR v_journal.kind<>'economic_receipt' OR v_receipt.occurred_at>app.reservation_clock(v_order.clock_namespace)
    OR (v_journal.order_id,v_journal.source,v_journal.environment,v_journal.effect_reference,v_journal.occurred_at)
      IS DISTINCT FROM (v_receipt.order_id,v_receipt.source,v_receipt.environment,v_receipt.effect_reference,v_receipt.occurred_at)
    OR EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=v_journal.id)
 THEN RAISE EXCEPTION 'Recovery receipt retains its actual original unreversed qualified economic source' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_postings FROM app.finance_posting WHERE transaction_id=v_journal.id;
 IF v_postings<>2 OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_journal.id AND account='provider_receivable' AND side='debit' AND amount=v_receipt.amount)
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_journal.id AND account='buyer_funds_liability' AND side='credit' AND amount=v_receipt.amount)
 THEN RAISE EXCEPTION 'Recovery receipt conserves its original balanced collected gross amount' USING ERRCODE='23514'; END IF;
 IF v_receipt.kind='prepaid' THEN
  SELECT EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.local_payment_event e ON e.id=r.event_id
   JOIN app.local_payment_operation source ON source.id=e.operation_id JOIN app.payment_attempt attempt ON attempt.id=source.attempt_id
   WHERE r.transaction_id=v_journal.id AND r.receipt_id=v_receipt.id AND r.outcome IN ('confirmed','recovery')
    AND e.id::text=v_receipt.event_id AND e.status='confirmed' AND e.amount=v_receipt.amount AND e.occurred_at=v_receipt.occurred_at
    AND source.id::text=v_receipt.effect_reference AND source.environment=v_receipt.environment AND attempt.order_id=v_receipt.order_id
    AND v_receipt.shipment_id IS NULL) INTO v_qualified;
 ELSE
  SELECT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.local_cod_event e ON e.id=r.event_id
   JOIN app.local_cod_operation source ON source.id=e.operation_id JOIN app.order_shipment parcel ON parcel.id=source.shipment_id
   WHERE r.transaction_id=v_journal.id AND r.receipt_id=v_receipt.id AND r.outcome IN ('collected','recovery')
    AND e.id::text=v_receipt.event_id AND e.status='collected' AND e.amount=v_receipt.amount AND e.occurred_at=v_receipt.occurred_at
    AND source.id::text=v_receipt.effect_reference AND source.environment=v_receipt.environment
    AND parcel.id=v_receipt.shipment_id AND parcel.order_id=v_receipt.order_id) INTO v_qualified;
 END IF;
 IF NOT coalesce(v_qualified,false) THEN RAISE EXCEPTION 'A balanced internal primitive cannot invent qualified recovery merchandise' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_exception_refund_proposal(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_order app.commerce_order; v_source record;
 v_transaction_id uuid; v_used numeric; v_count integer; v_qualified integer; v_distinct integer;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 IF v_case.id IS NULL OR v_order.id IS NULL THEN RAISE EXCEPTION 'Refund proposal requires its actual original case' USING ERRCODE='23514'; END IF;
 PERFORM f.id FROM app.fulfillment_item f JOIN app.exception_unit u ON u.fulfillment_item_id=f.id
  WHERE u.exception_id=p_case_id AND u.active ORDER BY f.id FOR UPDATE OF f;
 IF v_case.kind='unallocated_collection' THEN
  PERFORM app.assert_exception_collection_case(p_case_id);
  SELECT transaction_id INTO v_transaction_id FROM app.payment_event_result WHERE v_case.source_kind='payment_event' AND event_id=v_case.source_id
  UNION ALL SELECT transaction_id FROM app.cod_event_result WHERE v_case.source_kind='cod_event' AND event_id=v_case.source_id;
  PERFORM app.assert_compensation_capacity(v_transaction_id);
  SELECT coalesce(sum(amount),0) INTO v_used FROM (
   SELECT a.amount FROM app.refund_allocation a JOIN app.economic_receipt r ON r.id=a.receipt_id WHERE r.transaction_id=v_transaction_id
   UNION ALL SELECT amount FROM app.recovery_refund WHERE source_transaction_id=v_transaction_id
  ) allocations;
  IF v_used<>0 THEN RAISE EXCEPTION 'Unallocated refund proposal retains its complete still-available original source' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 SELECT count(*),count(DISTINCT u.fulfillment_item_id),count(r.id) INTO v_count,v_distinct,v_qualified
  FROM app.exception_unit u JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id JOIN app.order_item i ON i.id=f.order_item_id
  LEFT JOIN app.economic_receipt r ON r.order_id=i.order_id AND r.kind=v_order.payment_method
   AND ((r.kind='prepaid' AND r.shipment_id IS NULL) OR (r.kind='cod' AND r.shipment_id=f.shipment_id)) AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(r.id))
  WHERE u.exception_id=p_case_id AND u.active;
 IF v_count NOT BETWEEN 1 AND 100 OR v_distinct<>v_count OR v_qualified<>v_count
    OR EXISTS(SELECT 1 FROM app.exception_unit u JOIN app.return_item item ON item.fulfillment_item_id=u.fulfillment_item_id
      JOIN app.refund_allocation a ON a.return_item_id=item.id WHERE u.exception_id=p_case_id AND u.active)
    OR EXISTS(SELECT 1 FROM app.exception_unit u JOIN app.recovery_refund_allocation a ON a.fulfillment_item_id=u.fulfillment_item_id
      WHERE u.exception_id=p_case_id AND u.active)
 THEN RAISE EXCEPTION 'Refund proposal retains its complete unique original units without allocated compensation' USING ERRCODE='23514'; END IF;
 FOR v_source IN
  SELECT r.id,r.transaction_id,r.amount,sum(i.unit_price::numeric+f.buyer_shipping::numeric) proposed
   FROM app.exception_unit u JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id JOIN app.order_item i ON i.id=f.order_item_id
   JOIN app.economic_receipt r ON r.order_id=i.order_id AND r.kind=v_order.payment_method
    AND ((r.kind='prepaid' AND r.shipment_id IS NULL) OR (r.kind='cod' AND r.shipment_id=f.shipment_id)) AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(r.id))
   WHERE u.exception_id=p_case_id AND u.active GROUP BY r.id,r.transaction_id,r.amount ORDER BY r.transaction_id
 LOOP
  PERFORM app.assert_recovery_receipt(v_source.id);
  PERFORM app.assert_compensation_capacity(v_source.transaction_id);
  SELECT coalesce(sum(amount),0) INTO v_used FROM (
   SELECT a.amount FROM app.refund_allocation a JOIN app.economic_receipt receipt ON receipt.id=a.receipt_id WHERE receipt.transaction_id=v_source.transaction_id
   UNION ALL SELECT amount FROM app.recovery_refund WHERE source_transaction_id=v_source.transaction_id
  ) allocations;
  IF v_used+v_source.proposed>v_source.amount
  THEN RAISE EXCEPTION 'Refund proposal fits actual original money after every pending and successful obligation' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_exception_proposal_operation(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_event app.exception_event;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.action NOT IN ('decide','buyer_accept','buyer_decline')
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Proposal operation finalizes once in its actual original transaction' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id FOR UPDATE;
 SELECT * INTO v_event FROM app.exception_event WHERE source_kind='operation' AND source_id=v_operation.id;
 IF v_case.id IS NULL OR v_event.id IS NULL OR v_event.exception_id IS DISTINCT FROM v_case.id
    OR (SELECT count(*) FROM app.exception_event WHERE source_kind='operation' AND source_id=v_operation.id)<>1
    OR v_event.revision::bigint<>(v_operation.input->>'expected_version')::bigint+1
    OR v_case.revision IS DISTINCT FROM v_event.revision OR v_case.status IS DISTINCT FROM v_event.status
    OR v_event.actor_id IS DISTINCT FROM v_operation.actor_id OR v_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR v_event.kind IS DISTINCT FROM (CASE WHEN v_operation.action='decide' THEN
       CASE v_operation.input->>'decision' WHEN 'escalate' THEN 'escalate' ELSE 'propose' END ELSE v_operation.action END)
 THEN RAISE EXCEPTION 'Proposal operation commits exactly one current case event and original revision' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.exception_goods_intake WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.exception_stock_observation WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.fulfillment_event WHERE source_kind='operation' AND source_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.replacement_event WHERE source_kind='operation' AND source_id=v_operation.id)
 THEN RAISE EXCEPTION 'Proposal and buyer consent record no cancellation, physical or monetary execution' USING ERRCODE='23514'; END IF;
 IF (v_operation.action='decide' AND v_operation.input->>'decision'='propose_refund')
    OR (v_operation.action='buyer_accept' AND EXISTS(SELECT 1 FROM app.exception_event proposal WHERE proposal.id=v_event.cause_event_id
      AND proposal.snapshot->'proposal'->>'action'='refund_original_entitlement'))
 THEN PERFORM app.assert_exception_refund_proposal(v_case.id); END IF;
 IF v_operation.response IS DISTINCT FROM app.exception_projection(v_case.id,v_operation.action IN ('buyer_accept','buyer_decline'))
 THEN RAISE EXCEPTION 'Proposal operation seals its exact closed current staff or owned buyer response' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_proposal_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_exception_proposal_operation(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_proposal_operation_sealed AFTER INSERT OR UPDATE ON app.exception_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.action IN ('decide','buyer_accept','buyer_decline'))
 EXECUTE FUNCTION app.seal_exception_proposal_operation();

--> statement-breakpoint
-- Source-only stock investigation. This records a physical observation without
-- changing holds/on-hand, cancelling the buyer promise or sending money.
CREATE FUNCTION app.guard_exception_stock_report_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_order app.commerce_order; v_fulfillment app.fulfillment;
 v_unit jsonb; v_line jsonb; v_prior jsonb; v_ids jsonb; v_reservation app.stock_reservation;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Stock investigation requires a fresh locking isolation level' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id FOR UPDATE;
 IF v_case.kind IS DISTINCT FROM 'stock_discrepancy' OR v_case.source_kind IS DISTINCT FROM 'stock_report'
    OR NOT (NEW.input ?& ARRAY['fulfillment_id','fulfillment_item_ids','expected_version','reason','observed_components','reinspection'])
    OR (NEW.input-ARRAY['fulfillment_id','fulfillment_item_ids','expected_version','reason','observed_components','reinspection'])<>'{}'::jsonb
    OR jsonb_typeof(NEW.input->'fulfillment_id') IS DISTINCT FROM 'string'
    OR NEW.input->>'fulfillment_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(NEW.input->'expected_version') IS DISTINCT FROM 'number'
    OR NEW.input->>'expected_version'!~'^[1-9][0-9]{0,9}$'
    OR jsonb_typeof(NEW.input->'reason') IS DISTINCT FROM 'string' OR char_length(NEW.input->>'reason') NOT BETWEEN 1 AND 500
    OR NEW.input->>'reason' IS DISTINCT FROM btrim(NEW.input->>'reason')
    OR jsonb_typeof(NEW.input->'fulfillment_item_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.input->'observed_components') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Stock report retains its closed normalized warehouse input' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(NEW.input->'fulfillment_item_ids') NOT BETWEEN 1 AND 100
    OR jsonb_array_length(NEW.input->'observed_components') NOT BETWEEN 1 AND 500
 THEN RAISE EXCEPTION 'Stock report preserves complete bounded unit/component selections' USING ERRCODE='23514'; END IF;
 FOR v_unit IN SELECT value FROM jsonb_array_elements(NEW.input->'fulfillment_item_ids') LOOP
  IF jsonb_typeof(v_unit) IS DISTINCT FROM 'string'
     OR v_unit#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'Stock report unit IDs are normalized original identities' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT value FROM jsonb_array_elements(NEW.input->'fulfillment_item_ids')) units)
       IS DISTINCT FROM NEW.input->'fulfillment_item_ids'
 THEN RAISE EXCEPTION 'Stock report complete units are unique and sorted' USING ERRCODE='23514'; END IF;
 FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.input->'observed_components') LOOP
  IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' OR NOT (v_line ?& ARRAY['balance_id','stock_item_id','expected_balance_version','missing_quantity'])
     OR (v_line-ARRAY['balance_id','stock_item_id','expected_balance_version','missing_quantity'])<>'{}'::jsonb
     OR jsonb_typeof(v_line->'balance_id') IS DISTINCT FROM 'string' OR v_line->>'balance_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(v_line->'stock_item_id') IS DISTINCT FROM 'string' OR v_line->>'stock_item_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(v_line->'expected_balance_version') IS DISTINCT FROM 'number' OR v_line->>'expected_balance_version'!~'^(0|[1-9][0-9]{0,9})$'
     OR jsonb_typeof(v_line->'missing_quantity') IS DISTINCT FROM 'number' OR v_line->>'missing_quantity'!~'^(0|[1-9][0-9]{0,9})$'
  THEN RAISE EXCEPTION 'Stock observation has only a balance identity/revision and missing quantity' USING ERRCODE='23514'; END IF;
  IF (v_line->>'expected_balance_version')::bigint>2147483647 OR (v_line->>'missing_quantity')::bigint>2147483647
     OR (v_prior IS NOT NULL AND v_prior->>'balance_id'>=v_line->>'balance_id')
  THEN RAISE EXCEPTION 'Stock observations retain bounded quantities and unique sorted balances' USING ERRCODE='23514'; END IF;
  v_prior:=v_line;
 END LOOP;
 SELECT * INTO v_fulfillment FROM app.fulfillment WHERE id=(NEW.input->>'fulfillment_id')::uuid FOR UPDATE;
 SELECT * INTO v_reservation FROM app.stock_reservation WHERE id=v_order.stock_reservation_id FOR UPDATE;
 IF v_fulfillment.id IS NULL OR NOT EXISTS(SELECT 1 FROM app.order_shipment WHERE id=v_fulfillment.shipment_id AND order_id=v_order.id)
    OR v_fulfillment.revision::bigint<>(NEW.input->>'expected_version')::bigint OR v_fulfillment.handover_at IS NOT NULL
    OR v_order.status NOT IN ('pending','processing') OR v_case.status IN ('refunding','resolved')
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE exception_id=v_case.id)
    OR v_reservation.id IS NULL OR v_reservation.kind<>'checkout' OR v_reservation.status<>'active'
 THEN RAISE EXCEPTION 'Stock report retains its current unhanded original parcel and active holds' USING ERRCODE='23514'; END IF;
 v_prior:=NEW.input->'reinspection';
 IF v_prior='null'::jsonb THEN
  IF v_case.status<>'preparing' OR v_case.revision<>0 OR v_case.created_xid<>pg_current_xact_id()::text OR v_case.source_id<>NEW.id
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.input->'observed_components') line WHERE (line->>'missing_quantity')::bigint>0)
  THEN RAISE EXCEPTION 'A new stock case requires its own positive original observation' USING ERRCODE='23514'; END IF;
 ELSE
  IF jsonb_typeof(v_prior) IS DISTINCT FROM 'object' OR NOT (v_prior ?& ARRAY['exception_id','expected_version'])
     OR (v_prior-ARRAY['exception_id','expected_version'])<>'{}'::jsonb
     OR jsonb_typeof(v_prior->'exception_id') IS DISTINCT FROM 'string' OR v_prior->>'exception_id' IS DISTINCT FROM v_case.id::text
     OR jsonb_typeof(v_prior->'expected_version') IS DISTINCT FROM 'number' OR v_prior->>'expected_version'!~'^[1-9][0-9]{0,9}$'
  THEN RAISE EXCEPTION 'Reinspection names its exact existing case/revision' USING ERRCODE='23514'; END IF;
  IF v_case.revision<1 OR v_case.revision::bigint<>(v_prior->>'expected_version')::bigint
  THEN RAISE EXCEPTION 'Reinspection cannot overwrite a newer decision or buyer consent' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(u.fulfillment_item_id) ORDER BY u.fulfillment_item_id),'[]'::jsonb) INTO v_ids
  FROM app.exception_unit u JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id
  WHERE u.exception_id=v_case.id AND u.kind='stock_discrepancy' AND u.active AND u.replacement_link_id IS NULL AND f.shipment_id=v_fulfillment.shipment_id;
 IF v_ids IS DISTINCT FROM NEW.input->'fulfillment_item_ids'
    OR EXISTS(SELECT 1 FROM app.exception_unit WHERE exception_id=v_case.id AND (NOT active OR replacement_link_id IS NOT NULL))
    OR EXISTS(SELECT 1 FROM app.exception_cancellation WHERE fulfillment_item_id IN (SELECT value::uuid FROM jsonb_array_elements_text(v_ids)) AND replacement_link_id IS NULL)
 THEN RAISE EXCEPTION 'Stock report keeps every exact active original complete unit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_stock_report_operation_guard BEFORE INSERT ON app.exception_operation
 FOR EACH ROW WHEN (NEW.action='report') EXECUTE FUNCTION app.guard_exception_stock_report_operation();

--> statement-breakpoint
CREATE FUNCTION app.guard_exception_stock_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_balance app.inventory_balance;
 v_input jsonb; v_quantity bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original stock observations are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.operation_id;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id;
 PERFORM id FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_case.id FOR UPDATE;
 IF v_operation.id IS NULL OR v_operation.action<>'report' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Stock observation belongs to its unfinished actual warehouse report' USING ERRCODE='23514'; END IF;
 SELECT value INTO v_input FROM jsonb_array_elements(v_operation.input->'observed_components') WHERE value->>'balance_id'=NEW.balance_id::text;
 SELECT sum(a.quantity::bigint) INTO v_quantity FROM app.fulfillment_component_allocation a JOIN app.exception_unit u ON u.fulfillment_item_id=a.fulfillment_item_id
  WHERE u.exception_id=v_case.id AND u.active AND u.replacement_link_id IS NULL AND a.balance_id=NEW.balance_id AND a.stock_item_id=NEW.stock_item_id;
 SELECT * INTO v_balance FROM app.inventory_balance WHERE id=NEW.balance_id FOR UPDATE;
 IF v_input IS NULL OR v_balance.id IS NULL OR v_quantity IS NULL OR v_balance.stock_item_id IS DISTINCT FROM NEW.stock_item_id
    OR v_input->>'stock_item_id' IS DISTINCT FROM NEW.stock_item_id::text OR (v_input->>'expected_balance_version')::int<>v_balance.revision
    OR NEW.missing_quantity::bigint<>(v_input->>'missing_quantity')::bigint OR NEW.missing_quantity>v_balance.on_hand OR NEW.missing_quantity>v_quantity
    OR v_balance.reserved<v_quantity
 THEN RAISE EXCEPTION 'Stock observation captures current complete original component capacity' USING ERRCODE='23514'; END IF;
 NEW.balance_revision:=v_balance.revision; NEW.on_hand:=v_balance.on_hand; NEW.reserved:=v_balance.reserved; NEW.quarantined:=v_balance.quarantined;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_stock_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.exception_stock_observation
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_stock_observation();

--> statement-breakpoint
CREATE FUNCTION app.assert_exception_stock_report(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_event app.exception_event;
 v_previous app.exception_event; v_accepted app.exception_event;
 v_observations jsonb; v_expected jsonb; v_count bigint; v_missing bigint;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id;
 PERFORM id FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_case.id FOR UPDATE;
 IF v_operation.id IS NULL OR v_operation.action<>'report' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Stock report is finalized in its original authorized transaction' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_count FROM app.exception_event WHERE exception_id=v_case.id AND source_kind='operation' AND source_id=v_operation.id;
 SELECT * INTO v_event FROM app.exception_event WHERE exception_id=v_case.id AND source_kind='operation' AND source_id=v_operation.id ORDER BY revision LIMIT 1;
 SELECT * INTO v_previous FROM app.exception_event WHERE exception_id=v_case.id AND revision=v_event.revision-1;
 -- The previous immutable snapshot retains the proposal being acted on. A
 -- warehouse count never supplies or clears authenticated buyer remedy consent.
 SELECT p.* INTO v_accepted FROM app.exception_event p JOIN app.exception_event choice ON choice.exception_id=p.exception_id AND choice.cause_event_id=p.id
  WHERE p.exception_id=v_case.id AND p.id::text=v_previous.snapshot->>'proposal_event_id' AND p.kind='propose'
   AND p.snapshot->'proposal'->>'action' IN ('cancel_affected_units','refund_original_entitlement')
   AND choice.kind='buyer_accept' AND choice.revision>p.revision AND choice.revision<=v_previous.revision;
 SELECT coalesce(jsonb_agg(jsonb_build_object('balance_id',balance_id,'stock_item_id',stock_item_id,'expected_balance_version',balance_revision,'missing_quantity',missing_quantity) ORDER BY balance_id),'[]'::jsonb),coalesce(sum(missing_quantity::bigint),0)
  INTO v_observations,v_missing FROM app.exception_stock_observation WHERE operation_id=v_operation.id;
 SELECT coalesce(jsonb_agg(to_jsonb(q.balance_id) ORDER BY q.balance_id),'[]'::jsonb) INTO v_expected FROM (
   SELECT DISTINCT a.balance_id FROM app.fulfillment_component_allocation a JOIN app.exception_unit u ON u.fulfillment_item_id=a.fulfillment_item_id WHERE u.exception_id=v_case.id AND u.replacement_link_id IS NULL) q;
 IF v_count<>1 OR v_event.id IS NULL OR v_case.revision<>v_event.revision OR v_event.kind<>'stock_report'
    OR v_event.actor_id IS DISTINCT FROM v_operation.actor_id OR v_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR v_event.reason IS DISTINCT FROM v_operation.input->>'reason' OR v_event.snapshot->>'proposal_event_id' IS DISTINCT FROM v_accepted.id::text
    OR v_event.status IS DISTINCT FROM (CASE WHEN v_accepted.id IS NOT NULL THEN 'awaiting_source' WHEN v_missing>0 THEN 'awaiting_stock' ELSE 'resolved' END)
    OR v_event.revision IS DISTINCT FROM (CASE WHEN v_operation.input->'reinspection'='null'::jsonb THEN 1 ELSE (v_operation.input->'reinspection'->>'expected_version')::int+1 END)
    OR v_observations IS DISTINCT FROM v_operation.input->'observed_components'
    OR (SELECT coalesce(jsonb_agg(to_jsonb(balance_id) ORDER BY balance_id),'[]'::jsonb) FROM app.exception_stock_observation WHERE operation_id=v_operation.id) IS DISTINCT FROM v_expected
 THEN RAISE EXCEPTION 'Stock report seals every component/current event, preserves accepted remedies and invalidates unanswered proposals' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.exception_goods_intake WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.fulfillment_event WHERE source_kind='operation' AND source_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.replacement_event WHERE source_kind='operation' AND source_id=v_operation.id)
    OR v_operation.response IS DISTINCT FROM app.exception_projection(v_case.id,false)
 THEN RAISE EXCEPTION 'Warehouse investigation seals its closed response without cancellation, stock or cash execution' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_stock_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_exception_stock_report(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_stock_report_sealed AFTER INSERT OR UPDATE ON app.exception_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.action='report') EXECUTE FUNCTION app.seal_exception_stock_report();

--> statement-breakpoint
CREATE FUNCTION app.assert_original_stock_investigation_clear(p_shipment_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_order_id uuid;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Physical dispatch requires a fresh locking isolation level' USING ERRCODE='23514'; END IF;
 SELECT order_id INTO v_order_id FROM app.order_shipment WHERE id=p_shipment_id;
 PERFORM id FROM app.commerce_order WHERE id=v_order_id FOR UPDATE;
 IF v_order_id IS NULL OR EXISTS(SELECT 1 FROM app.exception_unit u JOIN app.commerce_exception c ON c.id=u.exception_id
     JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id WHERE f.shipment_id=p_shipment_id
       AND u.kind='stock_discrepancy' AND u.active AND u.replacement_link_id IS NULL AND c.status<>'resolved'
       AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.fulfillment_item_id=u.fulfillment_item_id AND cancellation.replacement_link_id IS NULL))
    OR NOT EXISTS(SELECT 1 FROM app.fulfillment_item unit WHERE unit.shipment_id=p_shipment_id
       AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.fulfillment_item_id=unit.id AND cancellation.replacement_link_id IS NULL))
 THEN RAISE EXCEPTION 'Original parcel dispatch waits for its complete-unit stock investigation' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_exception_original_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_shipment_id uuid;
BEGIN
 IF TG_TABLE_NAME='fulfillment_event' THEN
  SELECT shipment_id INTO v_shipment_id FROM app.fulfillment WHERE id=NEW.fulfillment_id;
 ELSIF TG_TABLE_NAME='shipment_booking' THEN
  SELECT shipment_id INTO v_shipment_id FROM app.fulfillment WHERE id=NEW.fulfillment_id;
 ELSIF TG_TABLE_NAME='local_waybill_operation' THEN
  SELECT f.shipment_id INTO v_shipment_id FROM app.shipment_booking b JOIN app.fulfillment f ON f.id=b.fulfillment_id WHERE b.id=NEW.booking_id;
 ELSE
  SELECT f.shipment_id INTO v_shipment_id FROM app.fulfillment_event e JOIN app.fulfillment f ON f.id=e.fulfillment_id
   WHERE NEW.source_ref='handover:'||e.id::text AND e.kind='handover';
  IF v_shipment_id IS NULL THEN RETURN NEW; END IF;
 END IF;
 PERFORM app.assert_original_stock_investigation_clear(v_shipment_id); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_original_fulfillment_dispatch_guard BEFORE INSERT ON app.fulfillment_event
 FOR EACH ROW WHEN (NEW.kind IN ('prepare','booking','packed','handover')) EXECUTE FUNCTION app.guard_exception_original_dispatch();
--> statement-breakpoint
CREATE TRIGGER exception_original_booking_dispatch_guard BEFORE INSERT ON app.shipment_booking
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_original_dispatch();
--> statement-breakpoint
CREATE TRIGGER exception_original_waybill_dispatch_guard BEFORE INSERT ON app.local_waybill_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_original_dispatch();
--> statement-breakpoint
CREATE TRIGGER exception_original_stock_dispatch_guard BEFORE INSERT ON app.stock_movement
 FOR EACH ROW WHEN (NEW.kind='consume') EXECUTE FUNCTION app.guard_exception_original_dispatch();

--> statement-breakpoint
-- A legacy NULL source scope always means its original complete parcel. New
-- sources freeze the current original collectible units; no old row is changed.
CREATE FUNCTION app.cod_current_collection_basis(p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_parcel app.order_shipment; v_order app.commerce_order; v_units jsonb; v_merchandise numeric; v_shipping numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Current COD entitlement requires fresh original-order locking' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_parcel FROM app.order_shipment WHERE id=p_shipment_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_parcel.order_id FOR UPDATE;
 IF v_parcel.id IS NULL OR v_order.payment_method IS DISTINCT FROM 'cod'
 THEN RAISE EXCEPTION 'COD basis belongs to its original COD parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric),0),coalesce(sum(f.buyer_shipping::numeric),0)
  INTO v_units,v_merchandise,v_shipping FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=v_parcel.id AND i.order_id=v_order.id AND NOT EXISTS(
   SELECT 1 FROM app.exception_cancellation cancelled WHERE cancelled.fulfillment_item_id=f.id AND cancelled.replacement_link_id IS NULL);
 IF jsonb_array_length(v_units)>100 OR v_merchandise+v_shipping>9007199254740991
 THEN RAISE EXCEPTION 'COD basis retains bounded original unit money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'merchandise_amount',v_merchandise,'buyer_shipping',v_shipping,'amount',v_merchandise+v_shipping);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.cod_operation_collection_basis(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_operation app.local_cod_operation; v_order app.commerce_order; v_units jsonb; v_merchandise numeric; v_shipping numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Original COD source scope requires fresh locking isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_operation FROM app.local_cod_operation WHERE id=p_operation_id;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=v_operation.shipment_id FOR UPDATE OF o;
 IF v_operation.id IS NULL OR v_order.payment_method IS DISTINCT FROM 'cod'
 THEN RAISE EXCEPTION 'COD source scope retains its original parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric),0),coalesce(sum(f.buyer_shipping::numeric),0)
  INTO v_units,v_merchandise,v_shipping FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=v_operation.shipment_id AND i.order_id=v_order.id AND (v_operation.unit_ids IS NULL OR v_operation.unit_ids ? f.id::text);
 IF jsonb_array_length(v_units)>100 OR v_merchandise+v_shipping>9007199254740991
    OR v_merchandise+v_shipping IS DISTINCT FROM v_operation.requested_amount::numeric
    OR (v_operation.unit_ids IS NOT NULL AND v_units IS DISTINCT FROM v_operation.unit_ids)
 THEN RAISE EXCEPTION 'Original COD snapshot retains exactly its unique complete funded units and frozen money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'merchandise_amount',v_merchandise,'buyer_shipping',v_shipping,'amount',v_merchandise+v_shipping);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.receipt_entitled_unit_ids(p_receipt_id uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$
 SELECT f.id FROM app.economic_receipt r JOIN app.order_item i ON i.order_id=r.order_id
 JOIN app.fulfillment_item f ON f.order_item_id=i.id
 LEFT JOIN app.local_cod_operation source ON source.id::text=r.effect_reference AND source.shipment_id=r.shipment_id AND source.environment=r.environment
 WHERE r.id=p_receipt_id AND ((r.kind='prepaid' AND r.shipment_id IS NULL)
  OR (r.kind='cod' AND f.shipment_id=r.shipment_id AND source.id IS NOT NULL AND (source.unit_ids IS NULL OR source.unit_ids ? f.id::text)))
 ORDER BY f.id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.cod_operation_purchase_eligible(p_operation_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_operation app.local_cod_operation; v_order app.commerce_order; v_basis jsonb;
BEGIN
 v_basis:=app.cod_operation_collection_basis(p_operation_id);
 SELECT * INTO v_operation FROM app.local_cod_operation WHERE id=p_operation_id;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=v_operation.shipment_id FOR UPDATE OF o;
 RETURN v_order.status IN ('pending','processing','partially_completed') AND jsonb_array_length(v_basis->'unit_ids')>0
  AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation c WHERE c.replacement_link_id IS NULL AND (v_basis->'unit_ids') ? c.fulfillment_item_id::text);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.cod_collection_payment_status(p_order_id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_paid bigint; v_payable bigint;
BEGIN
 SELECT * INTO v_order FROM app.commerce_order WHERE id=p_order_id FOR UPDATE;
 IF v_order.payment_method IS DISTINCT FROM 'cod' THEN RAISE EXCEPTION 'COD collection state requires its original order' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_paid FROM app.cod_event_result result JOIN app.economic_receipt receipt ON receipt.id=result.receipt_id
  WHERE result.outcome='collected' AND receipt.order_id=p_order_id;
 SELECT count(*) INTO v_payable FROM app.order_shipment s WHERE s.order_id=p_order_id AND (
  EXISTS(SELECT 1 FROM app.fulfillment_item f WHERE f.shipment_id=s.id AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation c WHERE c.fulfillment_item_id=f.id AND c.replacement_link_id IS NULL))
  OR EXISTS(SELECT 1 FROM app.economic_receipt r JOIN app.cod_event_result result ON result.receipt_id=r.id AND result.outcome='collected' WHERE r.shipment_id=s.id));
 RETURN CASE WHEN v_paid=0 THEN 'cod_due' WHEN v_paid=v_payable THEN 'confirmed' ELSE 'partially_collected' END;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_local_cod_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parcel app.order_shipment; v_order app.commerce_order; v_accepted timestamptz; v_basis jsonb;
BEGIN
 SELECT * INTO v_parcel FROM app.order_shipment WHERE id=NEW.shipment_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_parcel.order_id FOR UPDATE;
 SELECT accepted_at INTO v_accepted FROM app.cod_confirmation WHERE order_id=v_order.id;
 v_basis:=app.cod_current_collection_basis(v_parcel.id);
 IF v_accepted IS NULL OR v_order.payment_method<>'cod' OR v_order.status NOT IN ('pending','processing','partially_completed','cancelled')
    OR v_order.actionable_at IS DISTINCT FROM v_accepted OR current_database()<>'99ribu_'||NEW.environment
    OR NEW.requested_amount IS DISTINCT FROM (v_basis->>'amount')::bigint
    OR NEW.occurred_at<v_accepted OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace)
    OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',NEW.occurred_at)
 THEN RAISE EXCEPTION 'Local COD observation freezes its actual original collectible scope without charging retired units' USING ERRCODE='23514'; END IF;
 NEW.unit_ids:=v_basis->'unit_ids'; NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION app.guard_compensation_funded_unit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_unit_id uuid;
BEGIN
 IF TG_TABLE_NAME='refund_allocation' THEN SELECT fulfillment_item_id INTO v_unit_id FROM app.return_item WHERE id=NEW.return_item_id;
 ELSE v_unit_id:=NEW.fulfillment_item_id; END IF;
 IF v_unit_id IS NOT NULL AND (NEW.receipt_id IS NULL OR NOT EXISTS(SELECT 1 FROM app.receipt_entitled_unit_ids(NEW.receipt_id) funded WHERE funded.id=v_unit_id))
 THEN RAISE EXCEPTION 'Compensation unit is funded by this exact original receipt, never another surviving unit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_allocation_funded_unit_guard BEFORE INSERT ON app.refund_allocation
 FOR EACH ROW EXECUTE FUNCTION app.guard_compensation_funded_unit();
--> statement-breakpoint
CREATE TRIGGER recovery_allocation_funded_unit_guard BEFORE INSERT ON app.recovery_refund_allocation
 FOR EACH ROW EXECUTE FUNCTION app.guard_compensation_funded_unit();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.seal_cod_event_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e app.local_cod_event; operation app.local_cod_operation; s app.order_shipment; journal app.finance_transaction;
 receipt app.economic_receipt; v_basis jsonb; v_exact boolean; v_eligible boolean; selected uuid;
BEGIN
 SELECT * INTO e FROM app.local_cod_event WHERE id=NEW.event_id;
 SELECT * INTO operation FROM app.local_cod_operation WHERE id=e.operation_id;
 SELECT * INTO s FROM app.order_shipment WHERE id=operation.shipment_id;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM app.cod_provider_event p JOIN app.outbox_job j ON j.id=p.callback_job_id
    WHERE p.id=e.id AND p.shipment_id=s.id AND j.kind='cod.callback' AND j.dedup_key='cod-callback:'||e.id::text
     AND j.payload=jsonb_build_object('eventId',e.id::text) AND j.status='completed' AND j.completed_at IS NOT NULL
     AND j.result=jsonb_build_object('event_id',e.id::text,'outcome',NEW.outcome))
 THEN RAISE EXCEPTION 'COD result retains exact original callback identity and atomic completion' USING ERRCODE='23514'; END IF;
 v_basis:=app.cod_operation_collection_basis(operation.id);
 v_exact:=e.amount=(v_basis->>'amount')::bigint AND jsonb_array_length(v_basis->'unit_ids')>0;
 IF NEW.outcome IN ('collected','recovery') THEN
  SELECT * INTO journal FROM app.finance_transaction WHERE id=NEW.transaction_id;
  IF e.status<>'collected' OR journal.id IS NULL OR journal.order_id IS DISTINCT FROM s.order_id
     OR journal.environment IS DISTINCT FROM operation.environment OR journal.effect_reference IS DISTINCT FROM operation.id::text
     OR journal.occurred_at IS DISTINCT FROM e.occurred_at OR (SELECT count(*) FROM app.finance_posting WHERE transaction_id=journal.id)<>2
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='provider_receivable' AND side='debit' AND amount=e.amount)
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='buyer_funds_liability' AND side='credit' AND amount=e.amount)
  THEN RAISE EXCEPTION 'COD money retains its actual original balanced collected amount' USING ERRCODE='23514'; END IF;
  IF NEW.receipt_id IS NOT NULL THEN
   SELECT * INTO receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
   v_eligible:=app.cod_operation_purchase_eligible(operation.id);
   IF NOT v_exact OR journal.kind<>'economic_receipt' OR journal.source<>'local.cod' OR receipt.id IS NULL OR receipt.kind<>'cod'
      OR (receipt.order_id,receipt.shipment_id,receipt.transaction_id,receipt.source,receipt.environment,receipt.effect_reference,receipt.amount,receipt.occurred_at,receipt.event_id)
        IS DISTINCT FROM (s.order_id,s.id,journal.id,'local.cod'::text,operation.environment,operation.id::text,e.amount,e.occurred_at,e.id::text)
      OR (receipt.merchandise_amount,receipt.buyer_shipping) IS DISTINCT FROM ((v_basis->>'merchandise_amount')::bigint,(v_basis->>'buyer_shipping')::bigint)
      OR (NEW.outcome='collected' AND (NEW.reason<>'verified_collection' OR NOT v_eligible))
      OR (NEW.outcome='recovery' AND (NEW.reason<>'late_collection' OR v_eligible))
   THEN RAISE EXCEPTION 'Qualified COD money preserves exact original source units and separates late recovery from a new sale' USING ERRCODE='23514'; END IF;
   IF NEW.outcome='collected' THEN
    IF NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=s.order_id AND source_id=e.id
       AND payment_status IN ('partially_collected','confirmed') AND created_at=e.occurred_at)
    THEN RAISE EXCEPTION 'Accepted COD collection retains its original parent payment event' USING ERRCODE='23514'; END IF;
    SELECT id INTO selected FROM app.commerce_event WHERE receipt_id=receipt.id AND name='Purchase'; PERFORM app.assert_commerce_event(selected);
   ELSIF EXISTS(SELECT 1 FROM app.commerce_event WHERE receipt_id=receipt.id AND name='Purchase')
      OR EXISTS(SELECT 1 FROM app.order_event WHERE order_id=s.order_id AND source_id=e.id)
   THEN RAISE EXCEPTION 'Late qualified COD money creates no Purchase or revived order state' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.outcome<>'recovery' OR journal.kind<>'adjustment' OR journal.source<>'local.cod.recovery'
      OR (NEW.reason='amount_mismatch' AND v_exact)
      OR (NEW.reason='conflicting_allocation' AND (NOT v_exact OR NOT EXISTS(
        SELECT 1 FROM app.economic_receipt WHERE shipment_id=s.id AND kind='cod' AND effect_reference<>operation.id::text)))
      OR NEW.reason NOT IN ('amount_mismatch','conflicting_allocation')
   THEN RAISE EXCEPTION 'Unallocated COD money cannot invent funded goods or hide an original source' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF NEW.outcome='refused' THEN
  IF e.status<>'refused' OR e.amount<>0 OR NEW.reason<>'recipient_refused' OR NEW.receipt_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
  THEN RAISE EXCEPTION 'COD refusal is zero money, not returned stock or a refund' USING ERRCODE='23514'; END IF;
 ELSIF NEW.outcome='duplicate' THEN
  IF NEW.reason<>'duplicate_callback' OR NOT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.local_cod_event original ON original.id=r.event_id
     WHERE original.operation_id=operation.id AND r.outcome IN ('collected','recovery','refused')
      AND r.receipt_id IS NOT DISTINCT FROM NEW.receipt_id AND r.transaction_id IS NOT DISTINCT FROM NEW.transaction_id)
  THEN RAISE EXCEPTION 'Duplicate COD retains its original accepted financial result' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM app.assert_cod_order(s.order_id); RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_finance_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h app.finance_transaction; o app.commerce_order; s app.order_shipment; v_operation app.local_cod_operation; v_basis jsonb;
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
   SELECT * INTO v_operation FROM app.local_cod_operation WHERE id::text=NEW.effect_reference AND shipment_id=s.id AND environment=NEW.environment;
   IF s.id IS NULL OR v_operation.id IS NULL OR v_operation.status<>'collected'
   THEN RAISE EXCEPTION 'COD receipt retains its actual original collection operation' USING ERRCODE='23514'; END IF;
   v_basis:=app.cod_operation_collection_basis(v_operation.id);
   IF (NEW.amount,NEW.merchandise_amount,NEW.buyer_shipping) IS DISTINCT FROM
      ((v_basis->>'amount')::bigint,(v_basis->>'merchandise_amount')::bigint,(v_basis->>'buyer_shipping')::bigint)
   THEN RAISE EXCEPTION 'COD receipt equals its exact frozen original source unit entitlement' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.recorded_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.purchase_receipt_payload(selected uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN receipt.kind='prepaid' THEN app.purchase_signal_payload(receipt.order_id) ELSE (
  SELECT jsonb_build_object('currency','IDR','contents',coalesce(jsonb_agg(jsonb_build_object('id',part.catalog_id,'quantity',part.quantity,'merchandise_amount',99000::bigint*part.quantity) ORDER BY part.id),'[]'::jsonb),'content_ids',coalesce(jsonb_agg(part.catalog_id ORDER BY part.id),'[]'::jsonb)) FROM (
   SELECT i.id,o.catalog_id,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.offer o ON o.id=i.offer_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=receipt.order_id AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id)) GROUP BY i.id,o.catalog_id
  ) part
 ) END FROM app.economic_receipt receipt WHERE receipt.id=selected;
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
   SELECT jsonb_agg(jsonb_build_array(part.id,part.quantity,99000::bigint*part.quantity) ORDER BY part.id) INTO expected FROM (SELECT i.id,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=event.order_id AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id)) GROUP BY i.id) part;
  END IF;
  IF receipt.id IS NULL OR expected IS NULL OR actual IS DISTINCT FROM expected OR event.merchandise_amount IS DISTINCT FROM (SELECT sum(merchandise_amount) FROM app.purchase_allocation WHERE event_id=event.id)
   OR EXISTS(SELECT 1 FROM app.purchase_allocation a JOIN app.order_item i ON i.id=a.order_item_id WHERE i.order_id=event.order_id GROUP BY i.id,i.quantity HAVING sum(a.quantity)>i.quantity)
  THEN RAISE EXCEPTION 'Purchase allocations conserve original receipt parcel merchandise exactly once' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM app.purchase_allocation WHERE event_id=event.id) THEN RAISE EXCEPTION 'Nonfinancial observation cannot allocate purchase merchandise' USING ERRCODE='23514'; END IF;
 IF event.source_kind='browser' AND NOT EXISTS(SELECT 1 FROM app.funnel_intake WHERE event_id=event.id AND id::text=event.source_reference AND visitor_id=event.visitor_id AND consent_receipt_id=event.consent_receipt_id)
 THEN RAISE EXCEPTION 'Observed event and original intake seal together' USING ERRCODE='23514'; END IF;
END;
$$;

--> statement-breakpoint
-- Original campaign/parcel/unit snapshots are partitioned once by stable
-- intervals. Cancellation never recalculates current promotional eligibility.
CREATE FUNCTION app.exception_promotion_unit_shares(selected uuid)
RETURNS TABLE(promotion_id uuid,fulfillment_item_id uuid,amount bigint) LANGUAGE sql STABLE AS $$
 WITH campaigns AS (
  SELECT allocation.promotion_id,shipment.id shipment_id,allocation.amount,
   sum(allocation.amount::numeric) OVER (PARTITION BY shipment.id ORDER BY allocation.promotion_id ROWS UNBOUNDED PRECEDING) upper_bound
  FROM app.promotion_shipment_allocation allocation JOIN app.commerce_order purchase ON purchase.promotion_reservation_id=allocation.reservation_id
  JOIN app.order_shipment shipment ON shipment.order_id=purchase.id AND shipment.parcel_id=allocation.shipment_id
  WHERE allocation.reservation_id=selected
 ), units AS (
  SELECT unit.id,unit.shipment_id,unit.subsidy_amount,
   sum(unit.subsidy_amount::numeric) OVER (PARTITION BY unit.shipment_id ORDER BY item.line_id::text COLLATE "C",unit.unit_index,unit.id ROWS UNBOUNDED PRECEDING) upper_bound
  FROM app.fulfillment_item unit JOIN app.order_item item ON item.id=unit.order_item_id
  JOIN app.commerce_order purchase ON purchase.id=item.order_id WHERE purchase.promotion_reservation_id=selected
 )
 SELECT campaign.promotion_id,unit.id,
  greatest(0::numeric,least(campaign.upper_bound,unit.upper_bound)-greatest(campaign.upper_bound-campaign.amount,unit.upper_bound-unit.subsidy_amount))::bigint
 FROM campaigns campaign JOIN units unit ON unit.shipment_id=campaign.shipment_id
 WHERE least(campaign.upper_bound,unit.upper_bound)>greatest(campaign.upper_bound-campaign.amount,unit.upper_bound-unit.subsidy_amount)
$$;
--> statement-breakpoint
CREATE FUNCTION app.exception_promotion_release_basis(selected uuid)
RETURNS TABLE(promotion_id uuid,amount bigint) LANGUAGE sql STABLE AS $$
 SELECT shares.promotion_id,sum(shares.amount::numeric)::bigint
 FROM app.exception_operation operation JOIN app.commerce_exception c ON c.id=operation.exception_id
 JOIN app.commerce_order purchase ON purchase.id=c.order_id
 CROSS JOIN LATERAL app.exception_promotion_unit_shares(purchase.promotion_reservation_id) shares
 JOIN app.exception_cancellation cancelled ON cancelled.fulfillment_item_id=shares.fulfillment_item_id
  AND cancelled.replacement_link_id IS NULL AND cancelled.stock_disposition='released' AND cancelled.operation_id=operation.id AND cancelled.exception_id=c.id
 WHERE operation.id=selected GROUP BY shares.promotion_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_promotion_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h app.promotion; b app.promotion_buyer_usage; r app.promotion_reservation; a app.promotion_allocation; v app.promotion_version;
 v_operation app.exception_operation; v_order app.commerce_order; v_expected numeric; v_reserved numeric; v_committed numeric; v_held bigint;
BEGIN
 IF NEW.exception_operation_id IS NOT NULL THEN
  SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.exception_operation_id;
  SELECT purchase.* INTO v_order FROM app.commerce_order purchase JOIN app.commerce_exception c ON c.order_id=purchase.id
   WHERE c.id=v_operation.exception_id FOR UPDATE OF purchase;
  IF v_operation.id IS NULL OR v_order.id IS NULL OR v_order.promotion_reservation_id IS DISTINCT FROM NEW.reservation_id
     OR v_operation.action<>'apply' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR v_operation.actor_id IS DISTINCT FROM NEW.actor_id OR v_operation.input->>'reason' IS DISTINCT FROM NEW.reason
  THEN RAISE EXCEPTION 'Subsidy cancellation requires the current original staff execution' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO h FROM app.promotion WHERE id=NEW.promotion_id FOR UPDATE;
 SELECT * INTO b FROM app.promotion_buyer_usage WHERE promotion_id=NEW.promotion_id AND customer_key=NEW.customer_key FOR UPDATE;
 SELECT * INTO r FROM app.promotion_reservation WHERE id=NEW.reservation_id;
 SELECT * INTO a FROM app.promotion_allocation WHERE reservation_id=r.id AND promotion_id=NEW.promotion_id;
 SELECT * INTO v FROM app.promotion_version WHERE promotion_id=h.id AND revision=h.configuration_revision;
 SELECT coalesce(sum(reserved_delta::numeric),0),coalesce(sum(committed_delta::numeric),0),coalesce(sum(reserved_uses_delta::bigint),0)
  INTO v_reserved,v_committed,v_held FROM app.promotion_movement WHERE reservation_id=r.id AND promotion_id=h.id;
 IF h.id IS NULL OR b.promotion_id IS NULL OR a.promotion_id IS NULL OR NEW.customer_key<>r.customer_key
    OR NEW.budget_revision<>h.budget_revision+1 OR NEW.buyer_revision<>b.revision+1
 THEN RAISE EXCEPTION 'Invalid budget/quota identity and revision' USING ERRCODE='23514'; END IF;
 IF NEW.kind='reserve' THEN
  IF NEW.exception_operation_id IS NOT NULL OR NEW.amount<>a.amount OR r.status<>'preparing'
     OR b.reserved_uses::bigint+b.committed_uses::bigint>=v.per_buyer_limit
  THEN RAISE EXCEPTION 'Invalid original promotional reservation' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind IN ('release','consume') THEN
  IF NEW.exception_operation_id IS NOT NULL OR r.status<>'active' OR NEW.amount<>v_reserved OR v_held<>1 OR v_committed<>0
     OR NOT EXISTS(SELECT 1 FROM app.promotion_movement WHERE reservation_id=r.id AND promotion_id=h.id AND kind='reserve')
  THEN RAISE EXCEPTION 'Full promotion resolution uses only the remaining original hold' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind IN ('cancel_reserved','cancel_committed') THEN
  SELECT basis.amount INTO v_expected FROM app.exception_promotion_release_basis(NEW.exception_operation_id) basis WHERE basis.promotion_id=NEW.promotion_id;
  IF v_operation.id IS NULL OR v_expected IS NULL OR NEW.amount<>v_expected
     OR (NEW.kind='cancel_reserved' AND (r.status<>'active' OR v_held<>1 OR v_committed<>0 OR NEW.amount>v_reserved
       OR NEW.reserved_uses_delta IS DISTINCT FROM (CASE WHEN NEW.amount=v_reserved THEN -1 ELSE 0 END)))
     OR (NEW.kind='cancel_committed' AND (r.status<>'consumed' OR v_held<>0 OR v_reserved<>0 OR NEW.amount>v_committed
       OR EXISTS(SELECT 1 FROM app.exception_cancellation cancelled JOIN app.fulfillment_item unit ON unit.id=cancelled.fulfillment_item_id
        JOIN app.fulfillment shipment ON shipment.shipment_id=unit.shipment_id
        WHERE cancelled.operation_id=v_operation.id AND cancelled.replacement_link_id IS NULL AND cancelled.stock_disposition='released' AND shipment.handover_at IS NOT NULL)))
  THEN RAISE EXCEPTION 'Cancellation releases exact original unused subsidy and retains committed buyer usage' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Unknown promotion effect' USING ERRCODE='23514'; END IF;
 IF NEW.kind<>'reserve' AND (v_reserved+NEW.reserved_delta<0 OR v_committed+NEW.committed_delta<0
    OR v_reserved+NEW.reserved_delta+v_committed+NEW.committed_delta>a.amount)
 THEN RAISE EXCEPTION 'Promotional cancellation cannot exceed its original capacity' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.seal_promotion_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_reservation app.promotion_reservation; v_reserved numeric; v_committed numeric; v_held bigint; v_used bigint; v_consumed boolean;
BEGIN
 SELECT * INTO v_reservation FROM app.promotion_reservation WHERE id=NEW.reservation_id;
 SELECT coalesce(sum(reserved_delta::numeric),0),coalesce(sum(committed_delta::numeric),0),coalesce(sum(reserved_uses_delta::bigint),0),coalesce(sum(committed_uses_delta::bigint),0),bool_or(kind='consume')
  INTO v_reserved,v_committed,v_held,v_used,v_consumed FROM app.promotion_movement WHERE reservation_id=NEW.reservation_id AND promotion_id=NEW.promotion_id;
 IF NOT EXISTS(SELECT 1 FROM app.promotion p JOIN app.promotion_buyer_usage b ON b.promotion_id=p.id AND b.customer_key=NEW.customer_key
    WHERE p.id=NEW.promotion_id AND p.budget_revision>=NEW.budget_revision AND b.revision>=NEW.buyer_revision)
    OR v_reservation.status='preparing' OR v_reserved<0 OR v_committed<0
    OR v_held IS DISTINCT FROM (CASE WHEN v_reserved>0 THEN 1 ELSE 0 END)
    OR v_used IS DISTINCT FROM (CASE WHEN v_consumed THEN 1 ELSE 0 END)
    OR (v_reservation.status='active' AND (v_committed<>0 OR v_consumed
      OR (SELECT coalesce(sum(reserved_delta::numeric),0) FROM app.promotion_movement WHERE reservation_id=NEW.reservation_id)<=0))
    OR (v_reservation.status='consumed' AND (v_reserved<>0 OR NOT EXISTS(
      SELECT 1 FROM app.promotion_movement WHERE reservation_id=NEW.reservation_id AND kind='consume')))
    OR (v_reservation.status IN ('released','expired') AND (v_reserved<>0 OR v_committed<>0 OR v_consumed))
 THEN RAISE EXCEPTION 'Unapplied or inconsistent original promotion budget/quota movement' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_promotion_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.operation_id;
 IF v_operation.id IS NULL OR v_operation.action<>'apply' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
    OR EXISTS(SELECT 1 FROM app.exception_promotion_release_basis(v_operation.id) basis WHERE NOT EXISTS(
      SELECT 1 FROM app.promotion_movement movement WHERE movement.exception_operation_id=v_operation.id
       AND movement.promotion_id=basis.promotion_id AND movement.amount=basis.amount))
    OR EXISTS(SELECT 1 FROM app.promotion_movement movement WHERE movement.exception_operation_id=v_operation.id AND NOT EXISTS(
      SELECT 1 FROM app.exception_promotion_release_basis(v_operation.id) basis WHERE basis.promotion_id=movement.promotion_id AND basis.amount=movement.amount))
 THEN RAISE EXCEPTION 'Final cancellation applies every exact original campaign release once' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_promotion_release_sealed AFTER INSERT ON app.exception_cancellation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_exception_promotion_release();

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
    IF (NEW.status='expired' AND NEW.expires_at>business_now)
      OR (NEW.status='consumed' AND NEW.expires_at<=business_now AND NOT EXISTS(SELECT 1 FROM app.commerce_order o JOIN app.order_shipment shipment ON shipment.order_id=o.id JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=shipment.id WHERE o.promotion_reservation_id=NEW.id AND o.actionable_at IS NOT NULL AND fulfillment.handover_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM app.promotion_allocation allocation WHERE allocation.reservation_id=NEW.id AND (
       (SELECT coalesce(sum(m.reserved_delta::numeric),0) FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id)<>0
       OR (NEW.status<>'consumed' AND (SELECT coalesce(sum(m.committed_delta::numeric),0) FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id)<>0)
       OR NOT EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id AND m.kind='reserve' AND m.amount=allocation.amount)
       OR (NEW.status='consumed' AND EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id AND m.kind='release'))
       OR (NEW.status<>'consumed' AND EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id AND m.kind IN ('consume','cancel_committed')))))
    THEN RAISE EXCEPTION 'Invalid terminal reservation or exact remaining budget effects' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- C4 carrier facts are separate from commercial unit cancellation and money.
-- A legacy NULL request basis retains its original full physical parcel forever.
CREATE FUNCTION app.waybill_current_request_basis(p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_units jsonb; v_amount numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Waybill scope requires fresh original-order locking' USING ERRCODE='23514'; END IF;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=p_shipment_id FOR UPDATE OF o;
 IF v_order.id IS NULL THEN RAISE EXCEPTION 'Waybill scope retains its actual original parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric+f.buyer_shipping::numeric),0)
  INTO v_units,v_amount FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=p_shipment_id AND i.order_id=v_order.id AND NOT EXISTS(
   SELECT 1 FROM app.exception_cancellation cancelled WHERE cancelled.fulfillment_item_id=f.id AND cancelled.replacement_link_id IS NULL);
 IF jsonb_array_length(v_units) NOT BETWEEN 1 AND 100 OR v_amount>9007199254740991
 THEN RAISE EXCEPTION 'Waybill request requires surviving complete original units and bounded original money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'cod_due',CASE WHEN v_order.payment_method='cod' THEN v_amount ELSE 0 END);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.waybill_request_unit_ids(p_booking_id uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$
 SELECT f.id FROM app.local_waybill_operation source JOIN app.shipment_booking booking ON booking.id=source.booking_id
 JOIN app.fulfillment fulfillment ON fulfillment.id=booking.fulfillment_id JOIN app.fulfillment_item f ON f.shipment_id=fulfillment.shipment_id
 WHERE booking.id=p_booking_id AND (source.request_basis IS NULL OR source.request_basis->'unit_ids' ? f.id::text)
 ORDER BY f.id;
$$;

--> statement-breakpoint
CREATE FUNCTION app.guard_shipment_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_booking app.shipment_booking; v_fulfillment app.fulfillment; v_order app.commerce_order;
 v_operation app.exception_operation; v_case app.commerce_exception; v_source app.local_waybill_cancellation; v_attempt bigint; v_job app.outbox_job; v_previous uuid; v_retire_count integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original carrier cancellation history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status='not_created' THEN
  IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
  THEN RAISE EXCEPTION 'Retiring a missing carrier effect requires a fresh exact creation fence' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_job FROM app.outbox_job WHERE id=OLD.creation_job_id FOR UPDATE;
 END IF;
 SELECT * INTO v_booking FROM app.shipment_booking WHERE id=NEW.booking_id;
 SELECT f.* INTO v_fulfillment FROM app.fulfillment f WHERE f.id=v_booking.fulfillment_id;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=v_fulfillment.shipment_id;
 IF v_order.clock_namespace IS NOT NULL THEN PERFORM name FROM app.local_fixture_namespace WHERE name=v_order.clock_namespace FOR SHARE; END IF;
 PERFORM id FROM app.commerce_order WHERE id=v_order.id FOR UPDATE;
 SELECT * INTO v_fulfillment FROM app.fulfillment WHERE id=v_booking.fulfillment_id FOR UPDATE;
 IF v_booking.id IS NULL OR v_order.id IS NULL OR v_fulfillment.booking_id IS DISTINCT FROM v_booking.id OR v_fulfillment.handover_at IS NOT NULL
 THEN RAISE EXCEPTION 'Carrier cancellation retains the current unhanded original booking' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.operation_id;
  SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id;
  SELECT coalesce(max(attempt),0)::bigint+1 INTO v_attempt FROM app.shipment_cancellation WHERE booking_id=NEW.booking_id;
  IF v_operation.id IS NULL OR v_operation.action<>'apply' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR v_case.order_id IS DISTINCT FROM v_order.id OR v_case.status NOT IN ('awaiting_source','escalated')
     OR v_case.proposal_event_id::text IS DISTINCT FROM v_operation.input->>'proposal_id'
     OR NEW.status<>'queued' OR NEW.provider_operation_id IS NOT NULL OR NEW.attempt::bigint<>v_attempt
     OR NEW.created_at<v_operation.occurred_at OR NEW.created_at>app.reservation_clock(v_order.clock_namespace)
     OR NEW.created_at<app.reservation_clock(v_order.clock_namespace)-interval '5 seconds'
     OR NOT EXISTS(SELECT 1 FROM app.exception_event p JOIN app.exception_event consent ON consent.exception_id=p.exception_id AND consent.cause_event_id=p.id
       WHERE p.id=v_case.proposal_event_id AND p.exception_id=v_case.id AND p.kind='propose' AND consent.kind='buyer_accept'
        AND p.snapshot->'proposal'->>'action' IN ('cancel_affected_units','refund_original_entitlement'))
     OR NOT EXISTS(SELECT 1 FROM app.exception_unit unit JOIN app.fulfillment_item item ON item.id=unit.fulfillment_item_id
       WHERE unit.exception_id=v_case.id AND unit.active AND unit.replacement_link_id IS NULL AND item.shipment_id=v_fulfillment.shipment_id)
     OR NOT EXISTS(SELECT 1 FROM app.outbox_job job WHERE job.id=NEW.creation_job_id AND job.kind='shipping.cancel.create'
       AND job.dedup_key='shipping-cancel:'||NEW.id::text AND job.payload=jsonb_build_object('cancellationId',NEW.id::text)
       AND job.status='pending' AND job.attempts=0 AND job.dispatched_at IS NULL AND job.result IS NULL)
     OR EXISTS(SELECT 1 FROM app.shipment_cancellation previous WHERE previous.booking_id=NEW.booking_id AND (
       previous.status NOT IN ('failed','not_created') OR (previous.status='failed' AND NOT EXISTS(SELECT 1 FROM app.local_waybill_cancellation source
        JOIN app.local_waybill_cancellation_event event ON event.operation_id=source.id
        JOIN app.waybill_cancellation_result result ON result.event_id=event.id AND result.outcome='failed'
        JOIN app.waybill_cancellation_provider_event registration ON registration.id=event.id
        JOIN app.outbox_job job ON job.id=registration.callback_job_id AND job.status='completed'
        WHERE source.cancellation_id=previous.id AND source.status='failed'))))
  THEN RAISE EXCEPTION 'New carrier intent requires accepted current scope, exact job and a proved zero-effect predecessor' USING ERRCODE='23514'; END IF;
  FOR v_previous IN SELECT id FROM app.shipment_cancellation WHERE booking_id=NEW.booking_id AND status='not_created'
  LOOP PERFORM app.assert_shipment_cancellation(v_previous); END LOOP;
 ELSIF NEW.status='not_created' THEN
  SELECT count(*) INTO v_retire_count FROM app.exception_operation operation JOIN app.commerce_exception c ON c.id=operation.exception_id
   WHERE operation.action='apply' AND operation.created_xid=pg_current_xact_id()::text AND operation.response='{}'::jsonb
    AND c.order_id=v_order.id AND c.status IN ('awaiting_source','escalated')
    AND c.proposal_event_id::text=operation.input->>'proposal_id'
    AND EXISTS(SELECT 1 FROM app.exception_unit unit JOIN app.fulfillment_item item ON item.id=unit.fulfillment_item_id
      WHERE unit.exception_id=c.id AND unit.active AND unit.replacement_link_id IS NULL AND item.shipment_id=v_fulfillment.shipment_id);
  IF OLD.status<>'queued' OR OLD.provider_operation_id IS NOT NULL OR NEW.provider_operation_id IS NOT NULL
     OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR v_retire_count<>1
     OR v_job.id IS NULL OR v_job.kind<>'shipping.cancel.create' OR v_job.status<>'failed'
     OR v_job.attempts<>10 OR v_job.max_attempts<>10 OR v_job.completed_at IS NULL OR v_job.last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED'
     OR v_job.dedup_key IS DISTINCT FROM 'shipping-cancel:'||OLD.id::text
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('cancellationId',OLD.id::text)
     OR EXISTS(SELECT 1 FROM app.local_waybill_cancellation WHERE cancellation_id=OLD.id)
  THEN RAISE EXCEPTION 'Missing carrier intent retires only after exhausted fenced absence and explicit current CS application' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_source FROM app.local_waybill_cancellation WHERE cancellation_id=OLD.id;
  IF (to_jsonb(NEW)-ARRAY['status','provider_operation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','provider_operation_id'])
     OR OLD.status NOT IN ('queued','acknowledged') OR NEW.status NOT IN ('acknowledged','cancelled','failed') OR NEW.status=OLD.status
     OR v_source.id IS NULL OR NEW.provider_operation_id IS DISTINCT FROM v_source.id
     OR (OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id)
     OR (NEW.status<>'acknowledged' AND NEW.status IS DISTINCT FROM v_source.status)
  THEN RAISE EXCEPTION 'Carrier intent advances only from its exact original source observation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipment_cancellation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.shipment_cancellation
 FOR EACH ROW EXECUTE FUNCTION app.guard_shipment_cancellation();

--> statement-breakpoint
CREATE FUNCTION app.guard_local_waybill_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cancellation app.shipment_cancellation; v_booking app.shipment_booking; v_fulfillment app.fulfillment;
 v_order app.commerce_order; v_original app.local_waybill_operation; v_hash text; v_now timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original carrier cancellation source is retained' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Carrier absence requires a fresh source fence' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_cancellation FROM app.shipment_cancellation WHERE id=NEW.cancellation_id;
 SELECT * INTO v_booking FROM app.shipment_booking WHERE id=v_cancellation.booking_id;
 -- All cancellation creators hold SHARE on their own exact creation job; fence
 -- the original creator before the clock/order, then inspect its actual source.
 IF TG_OP='INSERT' THEN
  PERFORM id FROM app.outbox_job WHERE id=v_cancellation.creation_job_id AND kind='shipping.cancel.create'
   AND status='processing' AND lease_until>clock_timestamp() AND dispatched_at IS NOT NULL
   AND payload=jsonb_build_object('cancellationId',v_cancellation.id::text) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancellation source requires its exact dispatched original lease' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM id FROM app.outbox_job WHERE id=v_booking.creation_job_id FOR UPDATE;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id JOIN app.fulfillment f ON f.shipment_id=s.id WHERE f.id=v_booking.fulfillment_id;
 IF v_order.clock_namespace IS NOT NULL THEN PERFORM name FROM app.local_fixture_namespace WHERE name=v_order.clock_namespace FOR SHARE; END IF;
 PERFORM id FROM app.commerce_order WHERE id=v_order.id FOR UPDATE;
 SELECT * INTO v_fulfillment FROM app.fulfillment WHERE id=v_booking.fulfillment_id FOR UPDATE;
 SELECT * INTO v_cancellation FROM app.shipment_cancellation WHERE id=NEW.cancellation_id FOR UPDATE;
 v_now:=app.reservation_clock(v_order.clock_namespace);
 IF v_cancellation.id IS NULL OR v_booking.id IS NULL OR v_order.id IS NULL OR current_database()<>'99ribu_'||NEW.environment
    OR v_fulfillment.booking_id IS DISTINCT FROM v_booking.id OR v_fulfillment.handover_at IS NOT NULL
    OR v_cancellation.status NOT IN ('queued','acknowledged')
 THEN RAISE EXCEPTION 'Cancellation source retains its unhanded original booking and local environment' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  v_hash:=encode(sha256(convert_to('{"cancellation_id":'||to_jsonb(NEW.cancellation_id)::text||',"booking_id":'||to_jsonb(v_booking.id)::text||'}','UTF8')),'hex');
  IF NEW.status<>'acknowledged' OR NEW.created_at<v_cancellation.created_at OR NEW.created_at>v_now OR NEW.created_at<v_now-interval '5 seconds'
     OR NEW.created_at IS DISTINCT FROM date_trunc('milliseconds',NEW.created_at) OR NEW.request_hash IS DISTINCT FROM v_hash
  THEN RAISE EXCEPTION 'Cancellation acknowledgement binds its original request and current dispatched time without claiming absence' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_original FROM app.local_waybill_operation WHERE booking_id=v_booking.id FOR UPDATE;
  IF (to_jsonb(NEW)-ARRAY['status','source_operation_id','source_status','tracking_number','failure_code','terminal_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','source_operation_id','source_status','tracking_number','failure_code','terminal_at'])
     OR OLD.status<>'acknowledged' OR NEW.status NOT IN ('cancelled','failed')
     OR NEW.source_operation_id IS DISTINCT FROM v_original.id OR NEW.source_status IS DISTINCT FROM coalesce(v_original.status,'absent')
     OR NEW.tracking_number IS DISTINCT FROM v_original.tracking_number
     OR NEW.terminal_at>v_now OR NEW.terminal_at<v_now-interval '5 seconds'
     OR NEW.terminal_at IS DISTINCT FROM date_trunc('milliseconds',NEW.terminal_at)
  THEN RAISE EXCEPTION 'Terminal cancellation freezes the actual fenced original source once, without rewriting its history' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_waybill_cancellation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.local_waybill_cancellation
 FOR EACH ROW EXECUTE FUNCTION app.guard_local_waybill_cancellation();

--> statement-breakpoint
CREATE FUNCTION app.guard_local_waybill_cancellation_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_waybill_cancellation;
BEGIN
 SELECT * INTO v_source FROM app.local_waybill_cancellation WHERE id=NEW.operation_id;
 IF v_source.id IS NULL OR (NEW.status='acknowledged' AND NEW.occurred_at IS DISTINCT FROM v_source.created_at)
    OR (NEW.status<>'acknowledged' AND ((NEW.status,NEW.source_operation_id,NEW.source_status,NEW.tracking_number,NEW.failure_code,NEW.occurred_at)
     IS DISTINCT FROM (v_source.status,v_source.source_operation_id,v_source.source_status,v_source.tracking_number,v_source.failure_code,v_source.terminal_at)))
 THEN RAISE EXCEPTION 'Cancellation delivery retains the exact original source effect and occurrence time' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_waybill_cancellation_event_guard BEFORE INSERT ON app.local_waybill_cancellation_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_local_waybill_cancellation_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_local_waybill_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.local_waybill_cancellation_event event WHERE event.operation_id=NEW.id AND
   (event.status,event.source_operation_id,event.source_status,event.tracking_number,event.failure_code,event.occurred_at)
    IS NOT DISTINCT FROM (NEW.status,NEW.source_operation_id,NEW.source_status,NEW.tracking_number,NEW.failure_code,coalesce(NEW.terminal_at,NEW.created_at)))
 THEN RAISE EXCEPTION 'Cancellation source and its exact retained signed observation seal together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_waybill_cancellation_sealed AFTER INSERT OR UPDATE ON app.local_waybill_cancellation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_waybill_cancellation();

--> statement-breakpoint
CREATE FUNCTION app.guard_waybill_cancellation_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.local_waybill_cancellation_event event JOIN app.local_waybill_cancellation source ON source.id=event.operation_id
   JOIN app.outbox_job job ON job.id=NEW.callback_job_id WHERE event.id=NEW.id AND source.cancellation_id=NEW.cancellation_id
    AND job.kind='shipping.cancel.callback' AND job.dedup_key='shipping-cancel-callback:'||event.id::text
    AND job.payload=jsonb_build_object('eventId',event.id::text))
 THEN RAISE EXCEPTION 'Cancellation registration binds one actual original source and exact callback intent' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER waybill_cancellation_provider_event_guard BEFORE INSERT ON app.waybill_cancellation_provider_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_waybill_cancellation_provider_event();

--> statement-breakpoint
CREATE FUNCTION app.assert_shipment_cancellation(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cancellation app.shipment_cancellation; v_operation app.exception_operation; v_source app.local_waybill_cancellation;
BEGIN
 SELECT * INTO v_cancellation FROM app.shipment_cancellation WHERE id=p_id;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=v_cancellation.operation_id;
 SELECT * INTO v_source FROM app.local_waybill_cancellation WHERE cancellation_id=p_id;
 IF v_cancellation.id IS NULL OR v_operation.id IS NULL OR v_operation.action<>'apply' OR v_operation.response='{}'::jsonb
    OR NOT EXISTS(SELECT 1 FROM app.exception_event event WHERE event.exception_id=v_operation.exception_id
      AND event.source_kind='operation' AND event.source_id=v_operation.id AND event.kind='source_reconciled'
      AND event.status='awaiting_source' AND event.snapshot->'application'->'cancellation_ids' ? v_cancellation.id::text)
    OR NOT EXISTS(SELECT 1 FROM app.outbox_job job WHERE job.id=v_cancellation.creation_job_id AND job.kind='shipping.cancel.create'
      AND job.dedup_key='shipping-cancel:'||v_cancellation.id::text AND job.payload=jsonb_build_object('cancellationId',v_cancellation.id::text))
    OR (v_cancellation.status='queued' AND v_cancellation.provider_operation_id IS NOT NULL)
    OR (v_cancellation.status NOT IN ('queued','not_created') AND (v_source.id IS NULL OR v_cancellation.provider_operation_id IS DISTINCT FROM v_source.id
      OR NOT EXISTS(SELECT 1 FROM app.local_waybill_cancellation_event event JOIN app.waybill_cancellation_result result ON result.event_id=event.id
       WHERE event.operation_id=v_source.id AND result.outcome=v_cancellation.status)))
    OR (v_cancellation.status='cancelled' AND NOT EXISTS(SELECT 1 FROM app.shipment_booking WHERE id=v_cancellation.booking_id AND status='cancelled'))
 THEN RAISE EXCEPTION 'Carrier intent seals with its original accepted application, job, source and processed outcome' USING ERRCODE='23514'; END IF;
 IF v_cancellation.status='not_created' THEN
  IF v_source.id IS NOT NULL OR v_cancellation.provider_operation_id IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM app.outbox_job job WHERE job.id=v_cancellation.creation_job_id AND job.status='failed'
       AND job.attempts=10 AND job.max_attempts=10 AND job.last_error='ATTEMPTS_EXHAUSTED' AND job.completed_at IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM app.exception_event event JOIN app.exception_operation operation ON operation.id=event.source_id
       JOIN app.commerce_exception c ON c.id=event.exception_id JOIN app.shipment_booking booking ON booking.id=v_cancellation.booking_id
       JOIN app.fulfillment fulfillment ON fulfillment.id=booking.fulfillment_id JOIN app.order_shipment shipment ON shipment.id=fulfillment.shipment_id
       WHERE event.source_kind='operation' AND event.kind='source_reconciled' AND event.status='escalated'
        AND operation.action='apply' AND operation.exception_id=c.id AND operation.response<>'{}'::jsonb
        AND event.actor_id=operation.actor_id AND event.occurred_at=operation.occurred_at
        AND event.revision::bigint=(operation.input->>'expected_version')::bigint+1
        AND event.snapshot->'application'->>'proposal_id'=operation.input->>'proposal_id'
        AND event.snapshot->'application'->'cancellation_ids' ? v_cancellation.id::text AND c.order_id=shipment.order_id
        AND EXISTS(SELECT 1 FROM app.exception_unit unit JOIN app.fulfillment_item item ON item.id=unit.fulfillment_item_id
          WHERE unit.exception_id=c.id AND unit.replacement_link_id IS NULL AND item.shipment_id=shipment.id)
        AND EXISTS(SELECT 1 FROM app.exception_event consent WHERE consent.id::text=event.snapshot->'application'->>'consent_event_id'
          AND consent.exception_id=c.id AND consent.kind='buyer_accept' AND consent.cause_event_id::text=operation.input->>'proposal_id'))
  THEN RAISE EXCEPTION 'Retired carrier absence retains its frozen exhausted job and exact accepted historical CS escalation' USING ERRCODE='23514'; END IF;
 END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_shipment_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_shipment_cancellation(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shipment_cancellation_sealed AFTER INSERT OR UPDATE ON app.shipment_cancellation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_shipment_cancellation();

--> statement-breakpoint
CREATE FUNCTION app.seal_waybill_cancellation_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event app.local_waybill_cancellation_event; v_source app.local_waybill_cancellation;
 v_cancellation app.shipment_cancellation; v_booking app.shipment_booking; v_fulfillment app.fulfillment;
BEGIN
 SELECT * INTO v_event FROM app.local_waybill_cancellation_event WHERE id=NEW.event_id;
 SELECT * INTO v_source FROM app.local_waybill_cancellation WHERE id=v_event.operation_id;
 SELECT * INTO v_cancellation FROM app.shipment_cancellation WHERE id=v_source.cancellation_id;
 SELECT * INTO v_booking FROM app.shipment_booking WHERE id=v_cancellation.booking_id;
 SELECT * INTO v_fulfillment FROM app.fulfillment WHERE id=v_booking.fulfillment_id;
 IF v_event.id IS NULL OR NOT EXISTS(SELECT 1 FROM app.waybill_cancellation_provider_event registration
   JOIN app.outbox_job job ON job.id=registration.callback_job_id WHERE registration.id=NEW.event_id AND registration.cancellation_id=v_cancellation.id
    AND job.kind='shipping.cancel.callback' AND job.status='completed'
    AND job.result=jsonb_build_object('event_id',NEW.event_id::text,'outcome',NEW.outcome))
 THEN RAISE EXCEPTION 'Cancellation result commits with completion of its exact original callback' USING ERRCODE='23514'; END IF;
 IF NEW.outcome IN ('cancelled','failed') THEN
  IF v_event.status IS DISTINCT FROM NEW.outcome OR v_source.status IS DISTINCT FROM NEW.outcome OR v_cancellation.status IS DISTINCT FROM NEW.outcome
     OR v_cancellation.provider_operation_id IS DISTINCT FROM v_source.id
     OR (SELECT count(*) FROM app.waybill_cancellation_result result JOIN app.local_waybill_cancellation_event event ON event.id=result.event_id
       WHERE event.operation_id=v_source.id AND result.outcome IN ('cancelled','failed'))<>1
  THEN RAISE EXCEPTION 'Carrier terminal result applies one original source effect' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='cancelled' AND (v_booking.status<>'cancelled' OR v_fulfillment.handover_at IS NOT NULL
     OR (v_event.source_status='issued' AND v_fulfillment.waybill_issued_at IS NULL)
     OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event event WHERE event.id=NEW.fulfillment_event_id
       AND event.fulfillment_id=v_fulfillment.id AND event.kind='booking_cancelled' AND event.status='exception'
       AND event.source_kind='cancellation' AND event.source_id=v_event.id AND event.occurred_at=v_event.occurred_at))
  THEN RAISE EXCEPTION 'Confirmed carrier cancellation retains its first issuance and exact separate fulfillment event' USING ERRCODE='23514'; END IF;
 ELSIF NEW.outcome='acknowledged' THEN
  IF v_event.status<>'acknowledged' OR v_cancellation.status='queued' OR v_cancellation.provider_operation_id IS DISTINCT FROM v_source.id
     OR (SELECT count(*) FROM app.waybill_cancellation_result result JOIN app.local_waybill_cancellation_event event ON event.id=result.event_id
       WHERE event.operation_id=v_source.id AND result.outcome='acknowledged')<>1
  THEN RAISE EXCEPTION 'Acknowledgement applies once without asserting completed cancellation' USING ERRCODE='23514'; END IF;
 ELSIF NEW.outcome='duplicate' THEN
  IF NOT EXISTS(SELECT 1 FROM app.waybill_cancellation_result previous JOIN app.local_waybill_cancellation_event original ON original.id=previous.event_id
    WHERE original.operation_id=v_source.id AND previous.event_id<>NEW.event_id
     AND (previous.outcome=v_event.status OR (v_event.status='acknowledged' AND previous.outcome IN ('cancelled','failed'))))
  THEN RAISE EXCEPTION 'Duplicate cancellation observation retains the original processed result without another effect' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM app.assert_shipment_cancellation(v_cancellation.id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER waybill_cancellation_result_sealed AFTER INSERT ON app.waybill_cancellation_result
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_waybill_cancellation_result();

--> statement-breakpoint
CREATE FUNCTION app.guard_carrier_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_subject uuid; v_action text; v_source_exists boolean; v_related boolean:=false; v_pristine boolean; v_rearm boolean:=false; v_recovery boolean:=false;
BEGIN
 IF OLD.kind='shipping.create' THEN
  SELECT id INTO v_subject FROM app.shipment_booking WHERE creation_job_id=OLD.id; v_action:='local.shipping.reconcile';
  SELECT EXISTS(SELECT 1 FROM app.local_waybill_operation WHERE booking_id=v_subject) INTO v_source_exists;
 ELSIF OLD.kind='shipping.cancel.create' THEN
  SELECT id INTO v_subject FROM app.shipment_cancellation WHERE creation_job_id=OLD.id; v_action:='local.shipping.cancel.reconcile';
  SELECT EXISTS(SELECT 1 FROM app.local_waybill_cancellation WHERE cancellation_id=v_subject) INTO v_source_exists;
 ELSIF OLD.kind='shipping.callback' THEN
  SELECT EXISTS(SELECT 1 FROM app.waybill_provider_event WHERE callback_job_id=OLD.id) INTO v_related;
 ELSIF OLD.kind='shipping.cancel.callback' THEN
  SELECT EXISTS(SELECT 1 FROM app.waybill_cancellation_provider_event WHERE callback_job_id=OLD.id) INTO v_related;
 END IF;
 v_related:=v_related OR v_subject IS NOT NULL;
 IF NOT v_related THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original carrier jobs and recovery history are retained' USING ERRCODE='23514'; END IF;
 IF OLD.kind='shipping.cancel.create' AND NEW IS DISTINCT FROM OLD AND EXISTS(
   SELECT 1 FROM app.shipment_cancellation WHERE id=v_subject AND status='not_created')
 THEN RAISE EXCEPTION 'An explicitly retired absent carrier request retains its exact exhausted job forever' USING ERRCODE='23514'; END IF;
 IF v_subject IS NOT NULL AND NEW.status='pending' THEN
  IF v_source_exists OR (OLD.kind='shipping.create' AND EXISTS(SELECT 1 FROM app.local_waybill_cancellation source
    JOIN app.shipment_cancellation cancellation ON cancellation.id=source.cancellation_id WHERE cancellation.booking_id=v_subject AND source.status='cancelled'))
  THEN RAISE EXCEPTION 'A committed or cancelled original carrier effect cannot be dispatched again' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('failed','unknown') THEN
   SELECT EXISTS(SELECT 1 FROM app.audit_event audit WHERE audit.action=v_action AND audit.subject_id=v_subject::text
     AND audit.outcome='allowed' AND audit.xmin=pg_current_xact_id()::xid
     AND audit.details @> jsonb_build_object('job_id',OLD.id::text,'previous_status',OLD.status,'previous_attempts',OLD.attempts,
       'previous_max_attempts',OLD.max_attempts,'next_max_attempts',NEW.max_attempts,'source_absence_verified',true,
       'budget_rearmed',NEW.max_attempts<>OLD.max_attempts)) INTO v_recovery;
   IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') OR NOT v_recovery
   THEN RAISE EXCEPTION 'Explicit original retry requires fresh fenced absence and a current audit receipt' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 v_pristine:=OLD.status='pending' AND NEW.status='pending' AND OLD.attempts=0 AND NEW.attempts=0 AND OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NULL;
 -- xmin is intentionally compared with the current top-level host transaction;
 -- a previous reconciliation receipt cannot authorize another budget extension.
 IF v_subject IS NOT NULL AND NOT v_source_exists AND OLD.status='failed' AND NEW.status='pending'
    AND NEW.attempts=OLD.attempts AND OLD.attempts>=OLD.max_attempts AND OLD.attempts<10 AND NEW.max_attempts=OLD.attempts+1 THEN
  v_rearm:=v_recovery;
 END IF;
 IF (NEW.kind,NEW.dedup_key,NEW.payload,NEW.created_at) IS DISTINCT FROM (OLD.kind,OLD.dedup_key,OLD.payload,OLD.created_at)
    OR NEW.attempts<OLD.attempts OR NEW.attempts::bigint>OLD.attempts::bigint+1 OR (OLD.status='completed' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
    OR (NEW.max_attempts<>OLD.max_attempts AND NOT v_pristine AND NOT v_rearm)
 THEN RAISE EXCEPTION 'Carrier recovery retains identity, monotonic attempts and an exact fenced/audited bounded rearm' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER carrier_job_guard BEFORE UPDATE OR DELETE ON app.outbox_job
 FOR EACH ROW EXECUTE FUNCTION app.guard_carrier_job();
--> statement-breakpoint
CREATE FUNCTION app.seal_carrier_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'completed' THEN RETURN NULL; END IF;
 IF NEW.kind='shipping.create' AND NOT EXISTS(SELECT 1 FROM app.shipment_booking booking
   JOIN app.local_waybill_operation source ON source.booking_id=booking.id WHERE booking.creation_job_id=NEW.id
    AND NEW.result=jsonb_build_object('operation_id',source.id::text))
 THEN RAISE EXCEPTION 'Completed original dispatch retains its exact source identity' USING ERRCODE='23514'; END IF;
 IF NEW.kind='shipping.callback' AND NOT EXISTS(SELECT 1 FROM app.waybill_provider_event registration
   JOIN app.waybill_event_result result ON result.event_id=registration.id WHERE registration.callback_job_id=NEW.id
    AND NEW.result=jsonb_build_object('event_id',result.event_id::text,'outcome',result.outcome))
 THEN RAISE EXCEPTION 'Completed original callback retains its exact sealed result' USING ERRCODE='23514'; END IF;
 IF NEW.kind='shipping.cancel.create' AND NOT EXISTS(SELECT 1 FROM app.shipment_cancellation cancellation
   JOIN app.local_waybill_cancellation source ON source.cancellation_id=cancellation.id WHERE cancellation.creation_job_id=NEW.id
    AND NEW.result=jsonb_build_object('operation_id',source.id::text))
 THEN RAISE EXCEPTION 'Completed cancellation dispatch retains its exact source identity' USING ERRCODE='23514'; END IF;
 IF NEW.kind='shipping.cancel.callback' AND NOT EXISTS(SELECT 1 FROM app.waybill_cancellation_provider_event registration
   JOIN app.waybill_cancellation_result result ON result.event_id=registration.id WHERE registration.callback_job_id=NEW.id
    AND NEW.result=jsonb_build_object('event_id',result.event_id::text,'outcome',result.outcome))
 THEN RAISE EXCEPTION 'Completed cancellation callback requires its exact sealed original result' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER carrier_job_sealed AFTER INSERT OR UPDATE ON app.outbox_job
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind IN ('shipping.create','shipping.callback','shipping.cancel.create','shipping.cancel.callback'))
 EXECUTE FUNCTION app.seal_carrier_job();

--> statement-breakpoint
DO $$
DECLARE relation text; app_role text:=current_database()||'_app';
BEGIN
 FOREACH relation IN ARRAY ARRAY['local_waybill_cancellation_event','waybill_cancellation_provider_event','waybill_cancellation_result'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['shipment_cancellation','local_waybill_cancellation','local_waybill_cancellation_event','waybill_cancellation_provider_event','waybill_cancellation_result'] LOOP
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO %I',relation,app_role);
  EXECUTE format('REVOKE TRUNCATE ON app.%I FROM %I',relation,app_role);
 END LOOP;
END;
$$;

--> statement-breakpoint
-- Original source creation takes its own job fence before the order, including
-- direct SQL callers. Issuance uses the order fence without reversing that order.
CREATE OR REPLACE FUNCTION app.guard_exception_original_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_shipment_id uuid;
BEGIN
 IF TG_TABLE_NAME IN ('fulfillment_event','shipment_booking') THEN
  SELECT shipment_id INTO v_shipment_id FROM app.fulfillment WHERE id=NEW.fulfillment_id;
 ELSIF TG_TABLE_NAME='local_waybill_operation' THEN
  PERFORM job.id FROM app.outbox_job job JOIN app.shipment_booking booking ON booking.creation_job_id=job.id
   WHERE booking.id=NEW.booking_id FOR SHARE OF job;
  SELECT f.shipment_id INTO v_shipment_id FROM app.shipment_booking b JOIN app.fulfillment f ON f.id=b.fulfillment_id WHERE b.id=NEW.booking_id;
 ELSE
  SELECT f.shipment_id INTO v_shipment_id FROM app.fulfillment_event e JOIN app.fulfillment f ON f.id=e.fulfillment_id
   WHERE NEW.source_ref='handover:'||e.id::text AND e.kind='handover';
  IF v_shipment_id IS NULL THEN RETURN NEW; END IF;
 END IF;
 PERFORM app.assert_original_stock_investigation_clear(v_shipment_id);
 IF EXISTS(SELECT 1 FROM app.shipment_cancellation c JOIN app.shipment_booking b ON b.id=c.booking_id
    JOIN app.fulfillment f ON f.id=b.fulfillment_id WHERE f.shipment_id=v_shipment_id AND c.status IN ('queued','acknowledged'))
 THEN RAISE EXCEPTION 'Physical dispatch waits for the original carrier cancellation outcome' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_local_waybill_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b app.shipment_booking; f app.fulfillment; o app.commerce_order; now_at timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Waybill source history is retained' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Original waybill scope requires a fresh locking isolation level' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM app.shipment_booking WHERE id=NEW.booking_id;
 IF TG_OP='INSERT' THEN
  PERFORM id FROM app.outbox_job WHERE id=b.creation_job_id AND kind='shipping.create'
   AND dedup_key='shipping-create:'||b.id::text AND payload=jsonb_build_object('bookingId',b.id::text)
   AND status='processing' AND dispatched_at IS NOT NULL AND lease_token IS NOT NULL AND lease_until>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Waybill creation requires its exact current dispatched job' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT order2.* INTO o FROM app.commerce_order order2 JOIN app.order_shipment s ON s.order_id=order2.id
  JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=s.id WHERE fulfillment.id=b.fulfillment_id;
 IF o.clock_namespace IS NOT NULL THEN PERFORM name FROM app.local_fixture_namespace WHERE name=o.clock_namespace FOR SHARE; END IF;
 PERFORM id FROM app.commerce_order WHERE id=o.id FOR UPDATE;
 SELECT * INTO f FROM app.fulfillment WHERE id=b.fulfillment_id FOR UPDATE;
 now_at:=app.reservation_clock(o.clock_namespace);
 IF b.id IS NULL OR o.id IS NULL OR current_database()<>'99ribu_'||NEW.environment OR f.prepared_at IS NULL
    OR f.booking_id IS DISTINCT FROM b.id OR f.handover_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM app.local_waybill_cancellation source JOIN app.shipment_cancellation cancellation ON cancellation.id=source.cancellation_id
      WHERE cancellation.booking_id=b.id AND source.status='cancelled')
 THEN RAISE EXCEPTION 'Waybill source retains the unhanded original booking and cannot revive a confirmed cancellation' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF b.status<>'queued' OR NEW.status<>'acknowledged' OR NEW.created_at<b.created_at OR NEW.created_at<f.prepared_at
     OR NEW.created_at>now_at OR NEW.created_at<now_at-interval '5 seconds'
     OR NEW.request_basis IS DISTINCT FROM app.waybill_current_request_basis(f.shipment_id)
  THEN RAISE EXCEPTION 'New waybill freezes the exact surviving original offer units and COD due' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','tracking_number','terminal_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','tracking_number','terminal_at'])
     OR OLD.status<>'acknowledged' OR NEW.status NOT IN ('issued','failed')
     OR NEW.terminal_at IS NULL OR NEW.terminal_at<NEW.created_at OR NEW.terminal_at>now_at OR NEW.terminal_at<now_at-interval '5 seconds'
     OR (NEW.status='issued' AND NEW.tracking_number IS DISTINCT FROM 'LOCAL-'||upper(replace(NEW.id::text,'-','')))
  THEN RAISE EXCEPTION 'Original waybill resolves once without changing its request or legacy unit snapshot' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION app.guard_carrier_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_registered boolean;
BEGIN
 IF TG_TABLE_NAME='waybill_event_result' THEN
  SELECT EXISTS(SELECT 1 FROM app.waybill_provider_event registration JOIN app.outbox_job job ON job.id=registration.callback_job_id
   WHERE registration.id=NEW.event_id AND job.kind='shipping.callback' AND job.status='pending'
    AND job.dedup_key='shipping-callback:'||NEW.event_id::text AND job.payload=jsonb_build_object('eventId',NEW.event_id::text)) INTO v_registered;
 ELSE
  SELECT EXISTS(SELECT 1 FROM app.waybill_cancellation_provider_event registration JOIN app.outbox_job job ON job.id=registration.callback_job_id
   WHERE registration.id=NEW.event_id AND job.kind='shipping.cancel.callback' AND job.status='pending'
    AND job.dedup_key='shipping-cancel-callback:'||NEW.event_id::text AND job.payload=jsonb_build_object('eventId',NEW.event_id::text)) INTO v_registered;
 END IF;
 IF NOT v_registered THEN RAISE EXCEPTION 'Carrier result requires its pending original registered callback' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER waybill_event_result_guard BEFORE INSERT ON app.waybill_event_result FOR EACH ROW EXECUTE FUNCTION app.guard_carrier_result();
--> statement-breakpoint
CREATE TRIGGER waybill_cancellation_result_guard BEFORE INSERT ON app.waybill_cancellation_result FOR EACH ROW EXECUTE FUNCTION app.guard_carrier_result();

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
  IF f.status<>'ready' OR f.prepared_at IS NOT NULL OR f.deadline_id IS NULL OR NEW.status<>'picking' OR NEW.source_kind<>'operation' THEN RAISE EXCEPTION 'Preparation requires an operational original parcel' USING ERRCODE='23514';END IF;
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
  IF f.status NOT IN ('packed','handover_pending') OR f.prepared_at IS NULL OR f.waybill_issued_at IS NULL OR NEW.status<>'handed_over' OR NEW.source_kind<>'operation' OR NOT EXISTS(SELECT 1 FROM app.shipment_booking WHERE id=f.booking_id AND status='issued') THEN RAISE EXCEPTION 'Handover requires preparation and issued tracking' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='exception' THEN
  IF f.status<>'picking' OR f.booking_id IS NULL OR NEW.status<>'exception' OR NEW.source_kind<>'provider' THEN RAISE EXCEPTION 'Booking exception requires original provider source' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='reschedule' THEN
  IF f.handover_at IS NOT NULL OR NEW.source_kind<>'operation' OR NEW.deadline_id IS NULL OR NEW.status IS DISTINCT FROM (CASE WHEN f.status='exception' AND f.booking_id IS NOT NULL THEN 'exception' WHEN f.waybill_issued_at IS NOT NULL THEN f.status WHEN f.prepared_at IS NOT NULL THEN 'picking' ELSE 'ready' END) THEN RAISE EXCEPTION 'Reschedule retains original milestone state' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Unsupported fulfillment transition' USING ERRCODE='23514';END IF;
 IF NEW.kind IN ('packed','handover') AND NOT EXISTS(SELECT 1 FROM app.shipment_booking booking
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
  OR (NEW.waybill_issued_at IS DISTINCT FROM OLD.waybill_issued_at AND NOT (e.kind='issued' AND OLD.waybill_issued_at IS NULL AND NEW.waybill_issued_at=e.occurred_at))
  OR (NEW.tracking_number IS DISTINCT FROM OLD.tracking_number AND e.kind NOT IN ('issued','reissued'))
  OR (NEW.handover_at IS DISTINCT FROM OLD.handover_at AND NOT (e.kind='handover' AND OLD.handover_at IS NULL AND NEW.handover_at=e.occurred_at))
  OR (NEW.handover_reference IS DISTINCT FROM OLD.handover_reference AND e.kind<>'handover')
  OR (NEW.booking_id IS DISTINCT FROM OLD.booking_id AND e.kind<>'booking')
  OR (NEW.deadline_id IS DISTINCT FROM OLD.deadline_id AND e.kind NOT IN ('initialize','issued','reschedule'))
  OR (NEW.calendar_error IS DISTINCT FROM OLD.calendar_error AND e.kind NOT IN ('initialize','issued','reschedule'))
 THEN RAISE EXCEPTION 'Fulfillment head advances with one exact immutable event' USING ERRCODE='23514';END IF;
 IF (e.kind='prepare' AND NEW.prepared_at IS DISTINCT FROM e.occurred_at) OR (e.kind='issued' AND (NEW.waybill_issued_at IS DISTINCT FROM e.occurred_at OR NEW.tracking_number IS NULL)) OR (e.kind='booking' AND NEW.booking_id IS NULL) THEN RAISE EXCEPTION 'Milestone fields must match their exact causal event' USING ERRCODE='23514';END IF;
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
CREATE OR REPLACE FUNCTION app.guard_shipment_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f app.fulfillment%ROWTYPE; o app.commerce_order%ROWTYPE; previous app.shipment_booking;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original shipment booking is retained' USING ERRCODE='23514';END IF;
 SELECT * INTO f FROM app.fulfillment WHERE id=NEW.fulfillment_id;SELECT order2.* INTO o FROM app.commerce_order order2 JOIN app.order_shipment s ON s.order_id=order2.id WHERE s.id=f.shipment_id;
 IF TG_OP='INSERT' THEN
  SELECT * INTO previous FROM app.shipment_booking WHERE id=f.booking_id;
  IF f.handover_at IS NOT NULL OR f.prepared_at IS NULL OR f.calendar_error IS NOT NULL OR f.deadline_id IS NULL OR NOT ((f.status='picking' AND f.booking_id IS NULL) OR (f.status='exception' AND ((previous.status='failed' AND EXISTS(SELECT 1 FROM app.waybill_event_result result JOIN app.local_waybill_event source ON source.id=result.event_id
      JOIN app.local_waybill_operation operation ON operation.id=source.operation_id WHERE result.outcome='failed' AND source.status='failed'
       AND operation.booking_id=previous.id AND operation.id=previous.provider_operation_id))
     OR (previous.status='cancelled' AND EXISTS(SELECT 1 FROM app.shipment_cancellation cancellation
      JOIN app.local_waybill_cancellation operation ON operation.cancellation_id=cancellation.id
      JOIN app.local_waybill_cancellation_event source ON source.operation_id=operation.id
      JOIN app.waybill_cancellation_result result ON result.event_id=source.id WHERE cancellation.booking_id=previous.id
       AND cancellation.status='cancelled' AND operation.status='cancelled' AND source.status='cancelled' AND result.outcome='cancelled'))))) OR NEW.status<>'queued' OR NEW.provider_operation_id IS NOT NULL OR NEW.created_at>app.reservation_clock(o.clock_namespace) OR NEW.created_at<app.reservation_clock(o.clock_namespace)-interval '5 seconds' OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=NEW.creation_job_id AND kind='shipping.create' AND payload=jsonb_build_object('bookingId',NEW.id::text) AND dedup_key='shipping-create:'||NEW.id::text) THEN RAISE EXCEPTION 'Booking creates one original prepared dispatch intent' USING ERRCODE='23514';END IF;
 ELSIF NEW.status='cancelled' THEN
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR OLD.status NOT IN ('queued','acknowledged','issued')
     OR f.handover_at IS NOT NULL OR f.booking_id IS DISTINCT FROM NEW.id
     OR NOT EXISTS(SELECT 1 FROM app.shipment_cancellation cancellation JOIN app.local_waybill_cancellation operation ON operation.cancellation_id=cancellation.id
       WHERE cancellation.booking_id=NEW.id AND cancellation.status='cancelled' AND operation.status='cancelled'
        AND cancellation.provider_operation_id=operation.id)
  THEN RAISE EXCEPTION 'Booking cancellation retains its original provider identity and exact confirmed cancellation source' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'status'-'provider_operation_id') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'provider_operation_id') OR OLD.status NOT IN ('queued','acknowledged') OR NEW.status NOT IN ('acknowledged','issued','failed') OR NEW.provider_operation_id IS NULL OR (OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id<>OLD.provider_operation_id) THEN RAISE EXCEPTION 'Original booking changes only from verified source evidence' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.seal_shipment_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM app.assert_fulfillment(NEW.fulfillment_id);
 IF NEW.status='cancelled' THEN
  IF NOT EXISTS(SELECT 1 FROM app.shipment_cancellation cancellation JOIN app.local_waybill_cancellation operation ON operation.cancellation_id=cancellation.id
    JOIN app.local_waybill_cancellation_event source ON source.operation_id=operation.id JOIN app.waybill_cancellation_result result ON result.event_id=source.id
    WHERE cancellation.booking_id=NEW.id AND cancellation.status='cancelled' AND operation.status='cancelled' AND result.outcome='cancelled')
  THEN RAISE EXCEPTION 'Cancelled booking seals with its exact processed original carrier cancellation' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status<>'queued' AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result JOIN app.local_waybill_event event ON event.id=result.event_id JOIN app.local_waybill_operation operation ON operation.id=event.operation_id WHERE operation.id=NEW.provider_operation_id AND operation.booking_id=NEW.id AND result.outcome=NEW.status) THEN RAISE EXCEPTION 'Booking head requires its original accepted source result' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.seal_waybill_event_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event app.local_waybill_event%ROWTYPE; operation app.local_waybill_operation%ROWTYPE; b app.shipment_booking%ROWTYPE; f app.fulfillment%ROWTYPE;
BEGIN
 SELECT * INTO event FROM app.local_waybill_event WHERE id=NEW.event_id;SELECT * INTO operation FROM app.local_waybill_operation WHERE id=event.operation_id;SELECT * INTO b FROM app.shipment_booking WHERE id=operation.booking_id;SELECT * INTO f FROM app.fulfillment WHERE id=b.fulfillment_id;
 IF NOT EXISTS(SELECT 1 FROM app.waybill_provider_event provider JOIN app.outbox_job job ON job.id=provider.callback_job_id WHERE provider.id=NEW.event_id AND provider.booking_id=b.id AND job.status='completed' AND job.result=jsonb_build_object('event_id',NEW.event_id::text,'outcome',NEW.outcome)) THEN RAISE EXCEPTION 'Waybill result commits with completion of its exact callback' USING ERRCODE='23514';END IF;
 IF NEW.outcome IN ('issued','failed') THEN
  IF event.status<>NEW.outcome OR b.status<>NEW.outcome OR b.provider_operation_id IS DISTINCT FROM operation.id OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event WHERE id=NEW.fulfillment_event_id AND fulfillment_id=f.id AND source_id=event.id AND source_kind='provider' AND ((NEW.outcome='issued' AND kind IN ('issued','reissued')) OR (NEW.outcome='failed' AND kind='exception')) AND occurred_at=event.occurred_at) THEN RAISE EXCEPTION 'Terminal waybill result requires original source and fulfillment milestone' USING ERRCODE='23514';END IF;
 ELSIF NEW.outcome='acknowledged' THEN
  IF event.status<>'acknowledged' OR b.status='queued' OR b.provider_operation_id IS DISTINCT FROM operation.id OR NEW.fulfillment_event_id IS NOT NULL THEN RAISE EXCEPTION 'Acknowledgement is not usable tracking' USING ERRCODE='23514';END IF;
 ELSIF NEW.outcome='duplicate' THEN
  IF NEW.fulfillment_event_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM app.waybill_event_result previous JOIN app.local_waybill_event original ON original.id=previous.event_id WHERE original.operation_id=operation.id AND original.status=event.status AND previous.outcome=event.status) THEN RAISE EXCEPTION 'Waybill duplicates preserve the original accepted source' USING ERRCODE='23514';END IF;
 ELSIF NEW.outcome='ignored' THEN
  IF NEW.fulfillment_event_id IS NOT NULL OR NOT (b.status='cancelled' OR (event.status='acknowledged' AND b.status IN ('issued','failed'))) THEN RAISE EXCEPTION 'Ignored authentic observations cannot revive a cancelled booking or replace terminal tracking' USING ERRCODE='23514';END IF;
 END IF;
 PERFORM app.assert_fulfillment(f.id);RETURN NULL;
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
 IF (f.waybill_issued_at IS NOT NULL)<>(EXISTS(SELECT 1 FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='issued'))
    OR (SELECT count(*) FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind='issued')>1
    OR (f.waybill_issued_at IS NULL AND f.tracking_number IS NOT NULL)
 THEN RAISE EXCEPTION 'The first original issuance is a single immutable SLA anchor' USING ERRCODE='23514'; END IF;
 IF f.waybill_issued_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result
   JOIN app.local_waybill_event source ON source.id=result.event_id JOIN app.local_waybill_operation operation ON operation.id=source.operation_id
   JOIN app.shipment_booking original ON original.id=operation.booking_id JOIN app.fulfillment_event event ON event.id=result.fulfillment_event_id
   WHERE result.outcome='issued' AND original.fulfillment_id=f.id AND source.status='issued'
    AND source.occurred_at=f.waybill_issued_at AND event.fulfillment_id=f.id AND event.kind='issued'
    AND event.source_kind='provider' AND event.source_id=source.id AND event.occurred_at=source.occurred_at)
 THEN RAISE EXCEPTION 'The first SLA anchor retains its actual original source even after cancellation or reissue' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM app.fulfillment_event WHERE fulfillment_id=f.id AND kind IN ('issued','reissued') ORDER BY revision DESC LIMIT 1;
 IF f.waybill_issued_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result
   JOIN app.local_waybill_event source ON source.id=result.event_id JOIN app.local_waybill_operation operation ON operation.id=source.operation_id
   JOIN app.shipment_booking original ON original.id=operation.booking_id
   WHERE result.fulfillment_event_id=latest.id AND result.outcome='issued' AND source.status='issued'
    AND original.fulfillment_id=f.id AND source.tracking_number=f.tracking_number AND latest.source_id=source.id
    AND latest.source_kind='provider' AND latest.occurred_at=source.occurred_at
    AND (b.status<>'issued' OR original.id=b.id))
 THEN RAISE EXCEPTION 'Current tracking retains the latest accepted issuance; only the current issued booking is usable' USING ERRCODE='23514'; END IF;
 FOR e IN SELECT * FROM app.fulfillment_event WHERE fulfillment_id=f.id LOOP
  IF e.source_kind='operation' AND (NOT EXISTS(SELECT 1 FROM app.access_operation operation WHERE operation.id=e.source_id AND operation.actor_id=e.actor_id AND operation.action='fulfillment.mutate' AND (operation.response->>'id'=f.id::text OR (e.kind='booking' AND EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.fulfillment_id=f.id AND historical.operation_id=e.source_id AND operation.response->>'operation_id'=historical.id::text))))
   OR NOT EXISTS(SELECT 1 FROM app.audit_event audit WHERE audit.actor_id=e.actor_id AND audit.subject_id=f.id::text AND audit.outcome='allowed' AND audit.details->>'operation_id'=e.source_id::text AND audit.action=CASE e.kind WHEN 'prepare' THEN 'fulfillment.prepare' WHEN 'booking' THEN 'fulfillment.book' WHEN 'packed' THEN 'fulfillment.packing' WHEN 'handover' THEN 'fulfillment.handover' WHEN 'reschedule' THEN 'fulfillment.reschedule' ELSE '' END)) THEN RAISE EXCEPTION 'Staff fulfillment events require their committed scoped operation and audit' USING ERRCODE='23514';END IF;
  IF e.source_kind='provider' AND NOT EXISTS(SELECT 1 FROM app.waybill_event_result result JOIN app.waybill_provider_event provider ON provider.id=result.event_id WHERE result.fulfillment_event_id=e.id AND provider.id=e.source_id AND EXISTS(SELECT 1 FROM app.shipment_booking historical WHERE historical.id=provider.booking_id AND historical.fulfillment_id=f.id) AND result.outcome IN ('issued','failed')) THEN RAISE EXCEPTION 'Provider fulfillment events require accepted original callback evidence' USING ERRCODE='23514';END IF;
  IF e.source_kind='cancellation' AND NOT EXISTS(SELECT 1 FROM app.waybill_cancellation_result result
    JOIN app.waybill_cancellation_provider_event registration ON registration.id=result.event_id
    JOIN app.shipment_cancellation cancellation ON cancellation.id=registration.cancellation_id
    JOIN app.shipment_booking original ON original.id=cancellation.booking_id
    WHERE result.fulfillment_event_id=e.id AND result.outcome='cancelled' AND registration.id=e.source_id
     AND original.fulfillment_id=f.id AND e.kind='booking_cancelled')
  THEN RAISE EXCEPTION 'Carrier cancellation events retain their exact original processed result' USING ERRCODE='23514'; END IF;
  IF e.kind='handover' THEN
   IF f.handover_at IS DISTINCT FROM e.occurred_at OR b.status<>'issued' THEN RAISE EXCEPTION 'Handover time is immutable' USING ERRCODE='23514';END IF;
   SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO expected FROM (SELECT a.balance_id,sum(a.quantity)::bigint quantity FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item i ON i.id=a.fulfillment_item_id WHERE i.shipment_id=f.shipment_id AND i.id IN (SELECT membership.id FROM app.waybill_request_unit_ids(f.booking_id) membership) GROUP BY a.balance_id) component;
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
 SELECT sum(a.quantity) INTO expected FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item i ON i.id=a.fulfillment_item_id WHERE i.shipment_id=f.shipment_id AND a.balance_id=NEW.balance_id AND i.id IN (SELECT membership.id FROM app.waybill_request_unit_ids(f.booking_id) membership);
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
 SELECT f.handover_at,f.booking_id,b.status AS booking_status,o.clock_namespace INTO v_context
 FROM app.shipment_booking b JOIN app.fulfillment f ON f.id=b.fulfillment_id
 JOIN app.order_shipment s ON s.id=f.shipment_id JOIN app.commerce_order o ON o.id=s.order_id
 WHERE b.id=NEW.booking_id AND s.id=NEW.shipment_id FOR SHARE OF f,b;
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
  AND f.id IN (SELECT membership.id FROM app.waybill_request_unit_ids(NEW.booking_id) membership);
 IF v_count<>cardinality(v_units)
 THEN RAISE EXCEPTION 'Parcel receipt retains exact frozen original-label membership, including legacy whole parcels' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
-- Explicit accepted-unit retirement. These definitions remain behind S33_STOP;
-- parent/reservation/dispatch and all other source/finance closures are separate.
CREATE FUNCTION app.guard_exception_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_unit app.exception_unit; v_case app.commerce_exception; v_operation app.exception_operation;
 v_event app.exception_event; v_proposal app.exception_event; v_fulfillment app.fulfillment;
 v_replacement app.replacement_shipment; v_original app.fulfillment_item; v_reservation app.stock_reservation;
 v_report uuid; v_observed integer; v_expected integer;
BEGIN
 SELECT * INTO v_unit FROM app.exception_unit WHERE id=NEW.exception_unit_id AND exception_id=NEW.exception_id;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.operation_id AND exception_id=NEW.exception_id;
 SELECT * INTO v_event FROM app.exception_event WHERE id=NEW.event_id AND exception_id=NEW.exception_id;
 SELECT * INTO v_proposal FROM app.exception_event WHERE id::text=v_event.snapshot->'application'->>'proposal_id' AND exception_id=NEW.exception_id AND kind='propose';
 PERFORM id FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
    OR v_unit.id IS NULL OR v_operation.id IS NULL OR v_event.id IS NULL OR v_proposal.id IS NULL
    OR v_unit.fulfillment_item_id IS DISTINCT FROM NEW.fulfillment_item_id OR v_unit.replacement_link_id IS DISTINCT FROM NEW.replacement_link_id
    OR v_operation.action<>'apply' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR v_event.kind<>'cancel' OR v_event.source_kind<>'operation' OR v_event.source_id IS DISTINCT FROM v_operation.id
    OR v_event.actor_id IS DISTINCT FROM v_operation.actor_id OR v_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR NEW.occurred_at IS DISTINCT FROM v_operation.occurred_at OR v_event.revision IS DISTINCT FROM v_case.revision
    OR v_event.status IS DISTINCT FROM v_case.status OR v_case.kind IN ('late_collection','unallocated_collection','waybill_uncertain')
    OR v_operation.input->>'proposal_id' IS DISTINCT FROM v_proposal.id::text
    OR NOT (v_proposal.snapshot->'proposal'->'unit_ids' ? v_unit.id::text)
    OR v_event.snapshot->'application'->>'consent_event_id' IS DISTINCT FROM NEW.consent_event_id::text
    OR NOT EXISTS(SELECT 1 FROM app.exception_event consent WHERE consent.id=NEW.consent_event_id AND consent.exception_id=v_case.id
      AND consent.kind='buyer_accept' AND consent.cause_event_id=v_proposal.id AND consent.revision<v_event.revision)
 THEN RAISE EXCEPTION 'Unit retirement retains its exact accepted original occurrence, current CS apply and immutable cancellation event' USING ERRCODE='23514'; END IF;
 IF NEW.replacement_link_id IS NOT NULL THEN
  SELECT shipment.* INTO v_replacement FROM app.replacement_link link JOIN app.replacement_shipment shipment ON shipment.id=link.shipment_id
   WHERE link.id=NEW.replacement_link_id AND link.original_fulfillment_item_id=NEW.fulfillment_item_id FOR UPDATE OF shipment;
  IF v_replacement.id IS NULL OR v_replacement.booking_id IS NOT NULL OR v_replacement.handover_at IS NOT NULL
     OR v_replacement.status NOT IN ('awaiting_stock','ready','picking') OR NEW.physical_source_id IS NOT NULL OR NEW.stock_report_operation_id IS NOT NULL
     OR NEW.stock_disposition IS DISTINCT FROM (CASE WHEN v_replacement.stock_reservation_id IS NULL THEN 'not_reserved' ELSE 'released' END)
     OR EXISTS(SELECT 1 FROM app.replacement_buyer_receipt WHERE replacement_link_id=NEW.replacement_link_id)
     OR (v_replacement.stock_reservation_id IS NULL AND EXISTS(SELECT 1 FROM app.replacement_component_allocation WHERE replacement_link_id=NEW.replacement_link_id))
  THEN RAISE EXCEPTION 'Zero-charge replacement retirement touches only an eligible unbooked unhanded original physical intent' USING ERRCODE='23514'; END IF;
  IF v_replacement.stock_reservation_id IS NOT NULL THEN
   SELECT * INTO v_reservation FROM app.stock_reservation WHERE id=v_replacement.stock_reservation_id FOR UPDATE;
   IF v_reservation.id IS NULL OR v_reservation.status<>'active' OR v_reservation.kind<>'replacement'
      OR NOT EXISTS(SELECT 1 FROM app.replacement_component_allocation WHERE replacement_link_id=NEW.replacement_link_id)
   THEN RAISE EXCEPTION 'Replacement release retains its actual active complete original stock hold' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  SELECT * INTO v_original FROM app.fulfillment_item WHERE id=NEW.fulfillment_item_id;
  SELECT * INTO v_fulfillment FROM app.fulfillment WHERE shipment_id=v_original.shipment_id FOR UPDATE;
  IF v_fulfillment.id IS NULL OR EXISTS(SELECT 1 FROM app.buyer_receipt WHERE fulfillment_item_id=v_original.id)
  THEN RAISE EXCEPTION 'Original retirement cannot erase an actual buyer receipt' USING ERRCODE='23514'; END IF;
  IF v_fulfillment.handover_at IS NOT NULL THEN
   IF NEW.stock_disposition<>'consumed' OR NEW.stock_report_operation_id IS NOT NULL OR NOT EXISTS(
     SELECT 1 FROM app.local_parcel_outcome source JOIN app.parcel_outcome_result result ON result.event_id=source.id
      WHERE source.id=NEW.physical_source_id AND source.shipment_id=v_original.shipment_id AND source.booking_id=v_fulfillment.booking_id
       AND source.status IN ('failed','refused','returned_to_sender') AND source.unit_ids ? v_original.id::text
       AND source.occurred_at<=NEW.occurred_at AND current_database()='99ribu_'||source.environment
       AND result.outcome='observed' AND result.exception_ids ? v_case.id::text)
   THEN RAISE EXCEPTION 'Handed goods remain consumed until real physical intake; zero-money COD refusal is insufficient' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.stock_disposition<>'released' OR NEW.physical_source_id IS NOT NULL OR v_case.kind<>'stock_discrepancy'
      OR (v_fulfillment.booking_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM app.shipment_cancellation cancellation JOIN app.local_waybill_cancellation source ON source.cancellation_id=cancellation.id
       JOIN app.local_waybill_cancellation_event event ON event.operation_id=source.id AND event.status='cancelled'
       JOIN app.waybill_cancellation_result result ON result.event_id=event.id AND result.outcome='cancelled'
       JOIN app.waybill_cancellation_provider_event registered ON registered.id=event.id
       JOIN app.outbox_job job ON job.id=registered.callback_job_id AND job.status='completed'
       WHERE cancellation.booking_id=v_fulfillment.booking_id AND cancellation.status='cancelled' AND source.status='cancelled'
        AND v_event.snapshot->'application'->'cancellation_ids' ? cancellation.id::text))
   THEN RAISE EXCEPTION 'Unhanded stock releases only after original carrier cancellation is authentically confirmed and processed' USING ERRCODE='23514'; END IF;
   SELECT operation.id INTO v_report FROM app.exception_event event JOIN app.exception_operation operation ON operation.id=event.source_id
    WHERE event.exception_id=v_case.id AND event.kind='stock_report' AND operation.action='report' AND operation.response<>'{}'::jsonb
    ORDER BY event.revision DESC LIMIT 1;
   SELECT count(*) INTO v_expected FROM (SELECT component.balance_id,component.stock_item_id FROM app.exception_unit unit
    JOIN app.fulfillment_component_allocation component ON component.fulfillment_item_id=unit.fulfillment_item_id
    WHERE unit.exception_id=v_case.id AND unit.replacement_link_id IS NULL GROUP BY component.balance_id,component.stock_item_id) components;
   SELECT count(*) INTO v_observed FROM app.exception_stock_observation WHERE operation_id=v_report;
   IF v_report IS NULL OR NEW.stock_report_operation_id IS DISTINCT FROM v_report OR v_expected=0 OR v_observed<>v_expected
      OR EXISTS(SELECT 1 FROM app.exception_stock_observation observed JOIN app.inventory_balance balance ON balance.id=observed.balance_id
       WHERE observed.operation_id=v_report AND (
        (observed.balance_revision,observed.on_hand,observed.reserved,observed.quarantined) IS DISTINCT FROM
         (balance.revision,balance.on_hand,balance.reserved,balance.quarantined)
        OR observed.stock_item_id IS DISTINCT FROM balance.stock_item_id
        OR observed.missing_quantity>(SELECT coalesce(sum(component.quantity::numeric),0) FROM app.exception_unit unit
          JOIN app.fulfillment_component_allocation component ON component.fulfillment_item_id=unit.fulfillment_item_id
          WHERE unit.exception_id=v_case.id AND unit.replacement_link_id IS NULL AND component.balance_id=observed.balance_id)))
   THEN RAISE EXCEPTION 'Loss release requires the latest complete warehouse count at the locked current stock revisions' USING ERRCODE='23514'; END IF;
   SELECT reservation.* INTO v_reservation FROM app.stock_reservation reservation JOIN app.commerce_order purchase ON purchase.stock_reservation_id=reservation.id WHERE purchase.id=v_case.order_id FOR UPDATE OF reservation;
   IF v_reservation.id IS NULL OR v_reservation.status<>'active' OR v_reservation.kind<>'checkout'
   THEN RAISE EXCEPTION 'Original unit release retains its actual still-active purchase hold' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_cancellation_guard BEFORE INSERT ON app.exception_cancellation FOR EACH ROW EXECUTE FUNCTION app.guard_exception_cancellation();
--> statement-breakpoint
CREATE TRIGGER exception_cancellation_immutable BEFORE UPDATE OR DELETE ON app.exception_cancellation FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();

--> statement-breakpoint
CREATE FUNCTION app.exception_retirement_components(p_operation_id uuid)
RETURNS TABLE(reservation_id uuid,balance_id uuid,stock_item_id uuid,quantity bigint) LANGUAGE sql STABLE AS $$
 SELECT original.reservation_id,original.balance_id,original.stock_item_id,sum(original.quantity::bigint) FROM (
  SELECT purchase.stock_reservation_id reservation_id,component.balance_id,component.stock_item_id,component.quantity
   FROM app.exception_cancellation cancellation JOIN app.commerce_exception c ON c.id=cancellation.exception_id
   JOIN app.commerce_order purchase ON purchase.id=c.order_id JOIN app.fulfillment_component_allocation component ON component.fulfillment_item_id=cancellation.fulfillment_item_id
   WHERE cancellation.operation_id=p_operation_id AND cancellation.replacement_link_id IS NULL AND cancellation.stock_disposition='released'
  UNION ALL
  SELECT shipment.stock_reservation_id,component.balance_id,component.stock_item_id,component.quantity
   FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id
   JOIN app.replacement_shipment shipment ON shipment.id=link.shipment_id JOIN app.replacement_component_allocation component ON component.replacement_link_id=link.id
   WHERE cancellation.operation_id=p_operation_id AND cancellation.stock_disposition='released'
 ) original GROUP BY original.reservation_id,original.balance_id,original.stock_item_id
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_exception_retirement_stock(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_component record; v_loss record;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.action<>'apply' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Retirement stock belongs to one finalized current CS application' USING ERRCODE='23514'; END IF;
 FOR v_component IN SELECT * FROM app.exception_retirement_components(p_operation_id) ORDER BY reservation_id,balance_id LOOP
  IF (SELECT count(*) FROM app.stock_movement movement
     WHERE movement.source_ref='exception-release:'||p_operation_id::text||':'||v_component.reservation_id::text AND movement.balance_id=v_component.balance_id)<>1
     OR NOT EXISTS(SELECT 1 FROM app.stock_movement movement WHERE movement.source_ref='exception-release:'||p_operation_id::text||':'||v_component.reservation_id::text
       AND movement.balance_id=v_component.balance_id AND movement.kind='release' AND movement.quantity::bigint=v_component.quantity
       AND movement.on_hand_delta=0 AND movement.reserved_delta::bigint=-v_component.quantity AND movement.quarantined_delta=0
       AND movement.actor_id=v_operation.actor_id AND movement.reason=v_operation.input->>'reason')
  THEN RAISE EXCEPTION 'Each retired held component releases its exact original quantity once' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR v_loss IN SELECT observed.balance_id,sum(observed.missing_quantity::numeric) quantity
  FROM app.exception_stock_observation observed JOIN (SELECT DISTINCT stock_report_operation_id FROM app.exception_cancellation WHERE operation_id=p_operation_id AND stock_disposition='released') report
   ON report.stock_report_operation_id=observed.operation_id GROUP BY observed.balance_id HAVING sum(observed.missing_quantity::numeric)>0 ORDER BY observed.balance_id
 LOOP
  IF (SELECT count(*) FROM app.stock_movement WHERE source_ref='exception-loss:'||p_operation_id::text AND balance_id=v_loss.balance_id)<>1
     OR NOT EXISTS(SELECT 1 FROM app.stock_movement movement WHERE movement.source_ref='exception-loss:'||p_operation_id::text AND movement.balance_id=v_loss.balance_id
       AND movement.kind='adjust_down' AND movement.quantity::numeric=v_loss.quantity AND movement.on_hand_delta::numeric=-v_loss.quantity
       AND movement.reserved_delta=0 AND movement.quarantined_delta=0 AND movement.actor_id=v_operation.actor_id AND movement.reason=v_operation.input->>'reason')
  THEN RAISE EXCEPTION 'Only the exact actually observed physical shortage posts one loss after release' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM app.stock_movement movement WHERE movement.source_ref LIKE 'exception-release:'||p_operation_id::text||':%' AND NOT EXISTS(
     SELECT 1 FROM app.exception_retirement_components(p_operation_id) component WHERE movement.source_ref='exception-release:'||p_operation_id::text||':'||component.reservation_id::text AND component.balance_id=movement.balance_id))
    OR EXISTS(SELECT 1 FROM app.stock_movement movement WHERE movement.source_ref='exception-loss:'||p_operation_id::text AND NOT EXISTS(
     SELECT 1 FROM app.exception_cancellation cancellation JOIN app.exception_stock_observation observed ON observed.operation_id=cancellation.stock_report_operation_id
      WHERE cancellation.operation_id=p_operation_id AND cancellation.stock_disposition='released' AND observed.balance_id=movement.balance_id AND observed.missing_quantity>0))
 THEN RAISE EXCEPTION 'Retirement invents no additional held stock, returned goods or shortage' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_retirement_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
 IF NEW.source_ref LIKE 'exception-release:%' THEN
  IF NEW.source_ref !~ '^exception-release:[0-9a-f-]{36}:[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Invalid exception release source' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.source_ref !~ '^exception-loss:[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Invalid exception loss source' USING ERRCODE='23514'; END IF;
 END IF;
 v_id:=split_part(NEW.source_ref,':',2)::uuid;
 PERFORM app.assert_exception_retirement_stock(v_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_retirement_movement_sealed AFTER INSERT ON app.stock_movement
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.source_ref LIKE 'exception-release:%' OR NEW.source_ref LIKE 'exception-loss:%')
 EXECUTE FUNCTION app.seal_exception_retirement_movement();

--> statement-breakpoint
CREATE FUNCTION app.assert_exception_application(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_event app.exception_event; v_proposal app.exception_event;
 v_ids jsonb; v_retired jsonb; v_pending integer; v_retired_sources integer; v_funded integer; v_incomplete boolean; v_source record; v_used numeric;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.action<>'apply' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Application finalizes once in its actual original CS transaction' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id FOR UPDATE;
 SELECT * INTO v_event FROM app.exception_event WHERE source_kind='operation' AND source_id=v_operation.id;
 SELECT * INTO v_proposal FROM app.exception_event WHERE id::text=v_operation.input->>'proposal_id' AND exception_id=v_case.id AND kind='propose';
 SELECT coalesce(jsonb_agg(to_jsonb(id) ORDER BY id),'[]'::jsonb) INTO v_ids FROM app.exception_unit WHERE exception_id=v_case.id;
 IF v_event.id IS NULL OR v_proposal.id IS NULL OR (SELECT count(*) FROM app.exception_event WHERE source_kind='operation' AND source_id=v_operation.id)<>1
    OR v_event.exception_id IS DISTINCT FROM v_case.id OR v_event.revision::bigint<>(v_operation.input->>'expected_version')::bigint+1
    OR v_event.revision IS DISTINCT FROM v_case.revision OR v_event.status IS DISTINCT FROM v_case.status
    OR v_event.actor_id IS DISTINCT FROM v_operation.actor_id OR v_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR v_event.kind NOT IN ('source_reconciled','cancel') OR v_event.reason IS DISTINCT FROM v_operation.input->>'reason'
    OR v_event.snapshot->'application'->>'proposal_id' IS DISTINCT FROM v_proposal.id::text
    OR v_proposal.snapshot->'proposal'->'unit_ids' IS DISTINCT FROM v_ids
    OR NOT EXISTS(SELECT 1 FROM app.exception_event consent WHERE consent.id::text=v_event.snapshot->'application'->>'consent_event_id'
      AND consent.exception_id=v_case.id AND consent.kind='buyer_accept' AND consent.cause_event_id=v_proposal.id AND consent.revision<v_event.revision)
    OR v_operation.response IS DISTINCT FROM app.exception_projection(v_case.id,false)
 THEN RAISE EXCEPTION 'Application retains one exact current event, complete accepted scope and closed staff response' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.exception_goods_intake WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.exception_stock_observation WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.fulfillment_event WHERE source_kind='operation' AND source_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.replacement_event WHERE source_kind='operation' AND source_id=p_operation_id)
 THEN RAISE EXCEPTION 'CS application creates no intake, refund obligation, financial authority or invented physical event' USING ERRCODE='23514'; END IF;
 SELECT count(*) FILTER (WHERE cancellation.status IN ('queued','acknowledged')),count(*) FILTER (WHERE cancellation.status='not_created')
  INTO v_pending,v_retired_sources FROM jsonb_array_elements_text(v_event.snapshot->'application'->'cancellation_ids') ref(id)
   JOIN app.shipment_cancellation cancellation ON cancellation.id::text=ref.id;
 SELECT coalesce(jsonb_agg(to_jsonb(exception_unit_id) ORDER BY exception_unit_id),'[]'::jsonb) INTO v_retired FROM app.exception_cancellation WHERE operation_id=p_operation_id;
 IF v_event.kind='source_reconciled' THEN
  IF v_retired<>'[]'::jsonb OR EXISTS(SELECT 1 FROM app.promotion_movement WHERE exception_operation_id=p_operation_id)
     OR EXISTS(SELECT 1 FROM app.stock_movement WHERE source_ref LIKE 'exception-release:'||p_operation_id::text||':%' OR source_ref='exception-loss:'||p_operation_id::text)
     OR (v_event.status='awaiting_source' AND (v_pending=0 OR v_retired_sources<>0))
     OR (v_event.status='escalated' AND v_retired_sources=0)
     OR (v_event.status IN ('awaiting_return','ready_for_refund') AND (v_pending<>0 OR v_retired_sources<>0))
     OR (v_event.status='ready_for_refund' AND v_case.kind NOT IN ('late_collection','unallocated_collection'))
     OR (v_event.status='awaiting_return' AND v_case.kind NOT IN ('cod_refusal','delivery_failure'))
  THEN RAISE EXCEPTION 'Source reconciliation performs no business retirement and exposes only the actual unresolved phase' USING ERRCODE='23514'; END IF;
  IF v_event.status='ready_for_refund' THEN PERFORM app.assert_exception_refund_proposal(v_case.id); END IF;
  PERFORM app.assert_exception_retirement_stock(p_operation_id); RETURN;
 END IF;
 IF v_case.kind IN ('late_collection','unallocated_collection','waybill_uncertain') OR v_retired IS DISTINCT FROM v_ids OR v_pending<>0 OR v_retired_sources<>0
    OR EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=p_operation_id AND (exception_id<>v_case.id OR event_id<>v_event.id
      OR consent_event_id::text<>v_event.snapshot->'application'->>'consent_event_id' OR occurred_at<>v_operation.occurred_at))
 THEN RAISE EXCEPTION 'Final retirement applies every and only accepted physical occurrence after carrier outcome proof' USING ERRCODE='23514'; END IF;
 v_funded:=0;
 FOR v_source IN SELECT receipt.id,receipt.transaction_id,receipt.amount,sum(item.unit_price::numeric+unit.buyer_shipping::numeric) proposed,count(*) units
  FROM app.exception_cancellation cancellation JOIN app.fulfillment_item unit ON unit.id=cancellation.fulfillment_item_id
  JOIN app.order_item item ON item.id=unit.order_item_id JOIN app.economic_receipt receipt ON receipt.order_id=v_case.order_id
   AND unit.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id))
  WHERE cancellation.operation_id=p_operation_id AND (cancellation.replacement_link_id IS NULL OR v_proposal.snapshot->'proposal'->>'action'='refund_original_entitlement')
  GROUP BY receipt.id,receipt.transaction_id,receipt.amount ORDER BY receipt.transaction_id
 LOOP
  PERFORM app.assert_recovery_receipt(v_source.id); PERFORM app.assert_compensation_capacity(v_source.transaction_id);
  SELECT coalesce(sum(amount),0) INTO v_used FROM (
   SELECT allocation.amount FROM app.refund_allocation allocation JOIN app.economic_receipt receipt ON receipt.id=allocation.receipt_id WHERE receipt.transaction_id=v_source.transaction_id
   UNION ALL SELECT amount FROM app.recovery_refund WHERE source_transaction_id=v_source.transaction_id) obligations;
  IF v_used+v_source.proposed>v_source.amount OR EXISTS(
    SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.operation_id=p_operation_id
     AND (cancellation.replacement_link_id IS NULL OR v_proposal.snapshot->'proposal'->>'action'='refund_original_entitlement')
     AND (EXISTS(SELECT 1 FROM app.refund_allocation allocation JOIN app.return_item item ON item.id=allocation.return_item_id WHERE item.fulfillment_item_id=cancellation.fulfillment_item_id)
       OR EXISTS(SELECT 1 FROM app.recovery_refund_allocation WHERE fulfillment_item_id=cancellation.fulfillment_item_id)))
  THEN RAISE EXCEPTION 'Retirement requalifies actual original available money without allocating a second entitlement' USING ERRCODE='23514'; END IF;
  v_funded:=v_funded+v_source.units;
 END LOOP;
 SELECT EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.fulfillment_component_allocation component ON component.fulfillment_item_id=cancellation.fulfillment_item_id
  CROSS JOIN LATERAL app.physical_intake_basis(cancellation.fulfillment_item_id,NULL,component.balance_id) intake
  WHERE cancellation.operation_id=p_operation_id AND cancellation.stock_disposition='consumed' AND intake.known_quantity<component.quantity) INTO v_incomplete;
 IF v_event.status IS DISTINCT FROM (CASE WHEN v_funded>0 THEN 'ready_for_refund' WHEN v_incomplete THEN 'awaiting_return' ELSE 'resolved' END)
 THEN RAISE EXCEPTION 'Applied case completion derives actual original money and separately outstanding physical intake' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_exception_retirement_stock(p_operation_id);
 IF EXISTS(SELECT 1 FROM app.exception_retirement_components(p_operation_id) component JOIN app.stock_reservation reservation ON reservation.id=component.reservation_id
   WHERE reservation.status IS DISTINCT FROM app.retired_reservation_state(reservation.id))
 THEN RAISE EXCEPTION 'Application seals actual remaining original and replacement stock hold state' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM app.order_event WHERE order_id=v_case.order_id AND source_id=v_event.id)
      IS DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=p_operation_id AND replacement_link_id IS NULL) THEN 1::bigint ELSE 0::bigint END)
 THEN RAISE EXCEPTION 'Only original-unit retirement appends its exact parent order event once' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  SELECT 1 FROM (SELECT link.shipment_id,min(cancellation.exception_unit_id::text)::uuid source_id
   FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id
   WHERE cancellation.operation_id=p_operation_id GROUP BY link.shipment_id) scope
  WHERE (SELECT count(*) FROM app.replacement_event event WHERE event.shipment_id=scope.shipment_id AND event.source_kind='exception'
    AND event.source_id=scope.source_id AND event.kind='cancel' AND event.occurred_at=v_operation.occurred_at)<>1
 ) THEN RAISE EXCEPTION 'Every affected replacement parcel commits one exact accepted retirement image without creating another sale' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  SELECT 1 FROM app.replacement_event source JOIN app.exception_cancellation representative ON representative.exception_unit_id=source.source_id
   WHERE representative.operation_id=p_operation_id AND source.source_kind='exception' AND source.kind='cancel'
    AND (SELECT count(*) FROM app.return_event claim WHERE claim.source_kind='replacement' AND claim.source_id=source.id AND claim.kind='replacement_cancelled')<>1
 ) THEN RAISE EXCEPTION 'Replacement retirement retains one exact original claim-history transition per affected parcel' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_exception_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_exception_application(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER exception_application_sealed AFTER INSERT OR UPDATE ON app.exception_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.action='apply') EXECUTE FUNCTION app.seal_exception_application();

--> statement-breakpoint
-- Original commercial progress derives immutable unit retirement and actual
-- buyer receipt. A physical replacement never creates another purchased unit.
CREATE FUNCTION app.original_order_status(p_order_id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_total bigint; v_retired bigint; v_survivors bigint; v_received bigint;
BEGIN
 SELECT * INTO v_order FROM app.commerce_order WHERE id=p_order_id;
 IF v_order.id IS NULL THEN RAISE EXCEPTION 'Original progress requires an actual order' USING ERRCODE='23514'; END IF;
 SELECT count(*),count(cancellation.exception_unit_id),count(*) FILTER (WHERE cancellation.exception_unit_id IS NULL),
  count(receipt.id) FILTER (WHERE cancellation.exception_unit_id IS NULL)
  INTO v_total,v_retired,v_survivors,v_received FROM app.fulfillment_item unit JOIN app.order_item item ON item.id=unit.order_item_id
  LEFT JOIN app.exception_cancellation cancellation ON cancellation.fulfillment_item_id=unit.id AND cancellation.replacement_link_id IS NULL
  LEFT JOIN app.buyer_receipt receipt ON receipt.fulfillment_item_id=unit.id WHERE item.order_id=p_order_id;
 IF v_total=0 THEN RAISE EXCEPTION 'Original progress preserves complete purchased quantities' USING ERRCODE='23514'; END IF;
 IF v_retired=v_total THEN RETURN 'cancelled'; END IF;
 IF v_retired>0 AND v_survivors=v_received THEN RETURN 'partially_completed'; END IF;
 IF EXISTS(SELECT 1 FROM app.fulfillment physical JOIN app.order_shipment shipment ON shipment.id=physical.shipment_id
   WHERE shipment.order_id=p_order_id AND physical.prepared_at IS NOT NULL) THEN RETURN 'processing'; END IF;
 RETURN 'pending';
END;
$$;

--> statement-breakpoint
CREATE FUNCTION app.retired_reservation_state(p_reservation_id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_reservation app.stock_reservation; v_component record; v_count integer:=0; v_held numeric:=0; v_consumed numeric:=0;
BEGIN
 SELECT * INTO v_reservation FROM app.stock_reservation WHERE id=p_reservation_id;
 IF v_reservation.id IS NULL OR v_reservation.kind NOT IN ('checkout','replacement')
 THEN RAISE EXCEPTION 'Retired physical coverage requires its actual original or replacement hold' USING ERRCODE='23514'; END IF;
 FOR v_component IN
  WITH partitioned AS (
   SELECT allocation.balance_id,allocation.quantity,
    CASE WHEN cancellation.stock_disposition='released' THEN 'released' WHEN physical.handover_at IS NOT NULL THEN 'consumed' ELSE 'held' END disposition
    FROM app.commerce_order purchase JOIN app.order_item item ON item.order_id=purchase.id JOIN app.fulfillment_item unit ON unit.order_item_id=item.id
    JOIN app.fulfillment_component_allocation allocation ON allocation.fulfillment_item_id=unit.id
    LEFT JOIN app.fulfillment physical ON physical.shipment_id=unit.shipment_id
    LEFT JOIN app.exception_cancellation cancellation ON cancellation.fulfillment_item_id=unit.id AND cancellation.replacement_link_id IS NULL
    WHERE purchase.stock_reservation_id=p_reservation_id
   UNION ALL
   SELECT allocation.balance_id,allocation.quantity,
    CASE WHEN cancellation.stock_disposition='released' THEN 'released' WHEN shipment.handover_at IS NOT NULL THEN 'consumed' ELSE 'held' END
    FROM app.replacement_shipment shipment JOIN app.replacement_link link ON link.shipment_id=shipment.id
    JOIN app.replacement_component_allocation allocation ON allocation.replacement_link_id=link.id
    LEFT JOIN app.exception_cancellation cancellation ON cancellation.replacement_link_id=link.id
    WHERE shipment.stock_reservation_id=p_reservation_id
  ), wanted AS (
   SELECT balance_id,sum(quantity::numeric) total,
    coalesce(sum(quantity::numeric) FILTER (WHERE disposition='held'),0) held,
    coalesce(sum(quantity::numeric) FILTER (WHERE disposition='consumed'),0) consumed,
    coalesce(sum(quantity::numeric) FILTER (WHERE disposition='released'),0) released
   FROM partitioned GROUP BY balance_id
  ), consumed AS (
   SELECT movement.balance_id,sum(movement.quantity::numeric) quantity FROM app.stock_movement movement
   WHERE movement.kind='consume' AND (movement.source_ref=p_reservation_id::text
    OR EXISTS(SELECT 1 FROM app.fulfillment_event event JOIN app.fulfillment physical ON physical.id=event.fulfillment_id
      JOIN app.order_shipment shipment ON shipment.id=physical.shipment_id JOIN app.commerce_order purchase ON purchase.id=shipment.order_id
      WHERE movement.source_ref='handover:'||event.id::text AND event.kind='handover' AND purchase.stock_reservation_id=p_reservation_id)
    OR EXISTS(SELECT 1 FROM app.replacement_event event JOIN app.replacement_shipment shipment ON shipment.id=event.shipment_id
      WHERE movement.source_ref='replacement-handover:'||event.id::text AND event.kind='handover' AND shipment.stock_reservation_id=p_reservation_id))
   GROUP BY movement.balance_id
  ), released AS (
   SELECT movement.balance_id,sum(movement.quantity::numeric) quantity FROM app.stock_movement movement
    WHERE movement.kind='release' AND (movement.source_ref=p_reservation_id::text OR movement.source_ref LIKE 'exception-release:%:'||p_reservation_id::text) GROUP BY movement.balance_id
  ), balances AS (
   SELECT balance_id FROM app.stock_reservation_component WHERE reservation_id=p_reservation_id
   UNION SELECT balance_id FROM wanted UNION SELECT balance_id FROM consumed UNION SELECT balance_id FROM released
  )
  SELECT balance.balance_id,component.quantity original_quantity,wanted.total,wanted.held,wanted.consumed,wanted.released,
   coalesce(consumed.quantity,0) actual_consumed,coalesce(released.quantity,0) actual_released
   FROM balances balance LEFT JOIN app.stock_reservation_component component ON component.reservation_id=p_reservation_id AND component.balance_id=balance.balance_id
   LEFT JOIN wanted ON wanted.balance_id=balance.balance_id LEFT JOIN consumed ON consumed.balance_id=balance.balance_id LEFT JOIN released ON released.balance_id=balance.balance_id
   ORDER BY balance.balance_id
 LOOP
  v_count:=v_count+1;
  IF v_component.original_quantity IS NULL OR v_component.total IS DISTINCT FROM v_component.original_quantity::numeric
     OR v_component.actual_consumed IS DISTINCT FROM v_component.consumed OR v_component.actual_released IS DISTINCT FROM v_component.released
     OR v_component.held+v_component.consumed+v_component.released<>v_component.original_quantity
  THEN RAISE EXCEPTION 'Original held, consumed and explicitly released components conserve every immutable reservation quantity' USING ERRCODE='23514'; END IF;
  v_held:=v_held+v_component.held;v_consumed:=v_consumed+v_component.consumed;
 END LOOP;
 IF v_count=0 THEN RAISE EXCEPTION 'Physical reservation cannot lose its original component coverage' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN v_held>0 THEN 'active' WHEN v_consumed>0 THEN 'consumed' ELSE 'released' END;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_stock_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE movement_kind text; v_resolved timestamptz;
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
  IF OLD.status='active' AND NEW.status IN ('released','consumed') AND (
    EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.order_item item ON item.id=(SELECT order_item_id FROM app.fulfillment_item WHERE id=cancellation.fulfillment_item_id)
      JOIN app.commerce_order purchase ON purchase.id=item.order_id WHERE purchase.stock_reservation_id=NEW.id AND cancellation.replacement_link_id IS NULL)
    OR EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id
      JOIN app.replacement_shipment shipment ON shipment.id=link.shipment_id WHERE shipment.stock_reservation_id=NEW.id)) THEN
    IF NEW.status IS DISTINCT FROM app.retired_reservation_state(NEW.id)
    THEN RAISE EXCEPTION 'Retired hold resolves only after all surviving components are actually consumed or explicitly released' USING ERRCODE='23514'; END IF;
    SELECT max(cause.occurred_at) INTO v_resolved FROM (
      SELECT cancellation.occurred_at FROM app.exception_cancellation cancellation JOIN app.order_item item ON item.id=(SELECT order_item_id FROM app.fulfillment_item WHERE id=cancellation.fulfillment_item_id)
       JOIN app.commerce_order purchase ON purchase.id=item.order_id WHERE purchase.stock_reservation_id=NEW.id AND cancellation.replacement_link_id IS NULL AND cancellation.stock_disposition='released'
      UNION ALL SELECT physical.handover_at FROM app.fulfillment physical JOIN app.order_shipment shipment ON shipment.id=physical.shipment_id JOIN app.commerce_order purchase ON purchase.id=shipment.order_id WHERE purchase.stock_reservation_id=NEW.id
      UNION ALL SELECT cancellation.occurred_at FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id JOIN app.replacement_shipment shipment ON shipment.id=link.shipment_id WHERE shipment.stock_reservation_id=NEW.id AND cancellation.stock_disposition='released'
      UNION ALL SELECT handover_at FROM app.replacement_shipment WHERE stock_reservation_id=NEW.id
    ) cause;
    IF NEW.resolved_at IS DISTINCT FROM v_resolved OR NEW.resolved_at>app.reservation_clock(NEW.clock_namespace)
       OR char_length(NEW.resolution_reason) NOT BETWEEN 1 AND 500 OR NEW.resolution_reason IS NULL
    THEN RAISE EXCEPTION 'Resolved retired stock retains the actual final physical or explicit retirement time and reason' USING ERRCODE='23514'; END IF;
    RETURN NEW;
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
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM app.stock_reservation r WHERE r.id=o.stock_reservation_id AND r.kind='checkout' AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.expires_at=o.expires_at AND r.status=CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.fulfillment_item unit ON unit.id=cancellation.fulfillment_item_id JOIN app.order_item oi ON oi.id=unit.order_item_id WHERE oi.order_id=o.id AND cancellation.replacement_link_id IS NULL)
  THEN app.retired_reservation_state(r.id) ELSE CASE WHEN o.status='cancelled' THEN 'expired' WHEN NOT EXISTS(SELECT 1 FROM app.order_shipment os LEFT JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=os.id WHERE os.order_id=o.id AND (fulfillment.id IS NULL OR fulfillment.handover_at IS NULL)) THEN 'consumed' ELSE 'active' END END)
 THEN RAISE EXCEPTION 'Physical lot partition conserves the exact order hold' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.stock_reservation_item r FULL JOIN (SELECT f.id::text line_id,i.product_id,i.product_revision,i.offer_id,s.warehouse_id,1 offer_quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.order_shipment s ON s.id=f.shipment_id WHERE i.order_id=o.id) wanted ON wanted.line_id=r.line_id AND r.reservation_id=o.stock_reservation_id WHERE (r.reservation_id=o.stock_reservation_id OR r.reservation_id IS NULL) AND (r.product_id,r.product_revision,r.offer_id,r.warehouse_id,r.offer_quantity) IS DISTINCT FROM (wanted.product_id,wanted.product_revision,wanted.offer_id,wanted.warehouse_id,wanted.offer_quantity))
 THEN RAISE EXCEPTION 'Order stock hold preserves every purchased unit identity' USING ERRCODE='23514'; END IF;
 IF o.promotion_reservation_id IS NOT NULL AND (SELECT jsonb_agg(jsonb_build_object('promotion_id',a.promotion_id,'version_id',a.version_id,'amount',a.amount,'shipments',(SELECT jsonb_agg(jsonb_build_object('shipment_id',s.shipment_id,'amount',s.amount) ORDER BY s.shipment_id) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id)) ORDER BY a.promotion_id) FROM app.promotion_allocation a WHERE a.reservation_id=o.promotion_reservation_id) IS DISTINCT FROM (SELECT jsonb_agg(a ORDER BY a->>'promotion_id') FROM jsonb_array_elements(q.document->'promotions') a)
 THEN RAISE EXCEPTION 'Order preserves exact selected promotion versions and allocations' USING ERRCODE='23514'; END IF;
 IF (o.subsidy_amount=0 AND o.promotion_reservation_id IS NOT NULL) OR (o.subsidy_amount>0 AND NOT EXISTS(SELECT 1 FROM app.promotion_reservation r WHERE r.id=o.promotion_reservation_id AND r.subsidy_amount=o.subsidy_amount AND r.merchandise_amount=o.merchandise_amount AND r.shipping_amount=o.shipping_amount AND r.expires_at=o.expires_at AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.status=CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.fulfillment_item unit ON unit.id=cancellation.fulfillment_item_id JOIN app.order_item oi ON oi.id=unit.order_item_id WHERE oi.order_id=o.id AND cancellation.replacement_link_id IS NULL)
  THEN CASE WHEN EXISTS(SELECT 1 FROM app.promotion_movement movement WHERE movement.reservation_id=r.id AND movement.kind='consume') THEN 'consumed'
   WHEN (SELECT coalesce(sum(reserved_delta::numeric),0) FROM app.promotion_movement WHERE reservation_id=r.id)=0 THEN 'released' ELSE 'active' END
  ELSE CASE WHEN o.status='cancelled' THEN 'expired' WHEN EXISTS(SELECT 1 FROM app.order_shipment os JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=os.id WHERE os.order_id=o.id AND fulfillment.handover_at IS NOT NULL) THEN 'consumed' ELSE 'active' END END))
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
DECLARE o app.commerce_order%ROWTYPE; paid bigint; parcels bigint; v_exception_event app.exception_event; v_receipt app.local_parcel_receipt;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
 SELECT event.* INTO v_exception_event FROM app.exception_event event JOIN app.commerce_exception c ON c.id=event.exception_id
  JOIN app.exception_operation operation ON operation.id=event.source_id
  WHERE event.id=NEW.source_id AND c.order_id=o.id AND event.kind='cancel' AND event.source_kind='operation'
   AND operation.action='apply' AND operation.created_xid=pg_current_xact_id()::text AND operation.response='{}'::jsonb;
 IF v_exception_event.id IS NOT NULL THEN
  IF o.actionable_at IS NULL OR NEW.revision<>o.revision+1 OR NEW.created_at IS DISTINCT FROM v_exception_event.occurred_at
     OR NEW.status IS DISTINCT FROM app.original_order_status(o.id)
     OR NEW.payment_status IS DISTINCT FROM (CASE WHEN o.payment_method='cod' THEN app.cod_collection_payment_status(o.id) ELSE o.payment_status END)
     OR NOT EXISTS(SELECT 1 FROM app.exception_cancellation WHERE event_id=v_exception_event.id AND replacement_link_id IS NULL)
     OR EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND source_id=NEW.source_id)
  THEN RAISE EXCEPTION 'Applied original retirement advances one exact current parent without rewriting money or physical history' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT source.* INTO v_receipt FROM app.local_parcel_receipt source JOIN app.parcel_receipt_result result ON result.event_id=source.id
  JOIN app.order_shipment shipment ON shipment.id=source.shipment_id WHERE source.id=NEW.source_id AND shipment.order_id=o.id AND result.outcome='received' AND result.receipt_count>0;
 IF NEW.status='partially_completed' AND v_receipt.id IS NOT NULL THEN
  IF o.actionable_at IS NULL OR o.status NOT IN ('pending','processing') OR NEW.revision<>o.revision+1
     OR NEW.payment_status IS DISTINCT FROM o.payment_status OR NEW.created_at IS DISTINCT FROM v_receipt.occurred_at
     OR app.original_order_status(o.id)<>'partially_completed' OR EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND source_id=NEW.source_id)
  THEN RAISE EXCEPTION 'Partial completion requires the exact final surviving original buyer receipt and completed callback proof' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;

 IF NEW.status='processing' AND NEW.payment_status=o.payment_status AND o.status='pending' THEN
  IF o.actionable_at IS NULL OR NEW.revision<>o.revision+1 OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event event JOIN app.fulfillment f ON f.id=event.fulfillment_id JOIN app.order_shipment shipment ON shipment.id=f.shipment_id WHERE event.id=NEW.source_id AND event.kind='prepare' AND shipment.order_id=o.id AND event.occurred_at=NEW.created_at) THEN RAISE EXCEPTION 'Processing requires actual original parcel preparation' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF o.payment_method='cod' AND NEW.revision>=2 AND NEW.payment_status IN ('cod_due','partially_collected','confirmed') THEN
  IF NEW.status<>o.status OR NEW.status NOT IN ('pending','processing','partially_completed') OR NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
   THEN RAISE EXCEPTION 'COD event advances the current original order' USING ERRCODE='23514';END IF;
  IF NEW.revision=2 THEN
   IF NEW.payment_status<>'cod_due' OR o.status<>'pending' OR o.payment_status<>'pending' OR NOT EXISTS(SELECT 1 FROM app.cod_confirmation c WHERE c.id=NEW.source_id AND c.order_id=o.id AND c.accepted_at=NEW.created_at)
   THEN RAISE EXCEPTION 'COD confirmation event requires its exact original source' USING ERRCODE='23514';END IF;
  ELSE
   SELECT count(*) INTO paid FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.outcome='collected' AND e.order_id=o.id;
   SELECT count(*) INTO parcels FROM app.order_shipment WHERE order_id=o.id;
   IF o.status NOT IN ('pending','processing','partially_completed') OR o.payment_status NOT IN ('cod_due','partially_collected') OR o.actionable_at IS NULL
    OR NEW.payment_status IS DISTINCT FROM app.cod_collection_payment_status(o.id)
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
DECLARE o app.commerce_order%ROWTYPE; c app.cod_confirmation%ROWTYPE; paid bigint; parcels bigint; expected text; processing bigint; retired bigint; completed bigint;
BEGIN
 SELECT * INTO c FROM app.cod_confirmation WHERE order_id=selected;IF c.id IS NULL THEN RETURN; END IF;
 SELECT * INTO o FROM app.commerce_order WHERE id=selected;
 SELECT count(*) INTO paid FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.outcome='collected' AND e.order_id=selected;
 SELECT count(*) INTO parcels FROM app.order_shipment WHERE order_id=selected;
 SELECT count(*) INTO processing FROM app.order_event event JOIN app.fulfillment_event cause ON cause.id=event.source_id WHERE event.order_id=selected AND event.status='processing' AND cause.kind='prepare';
 SELECT count(DISTINCT event.id) INTO retired FROM app.order_event event JOIN app.exception_cancellation cancellation ON cancellation.event_id=event.source_id AND cancellation.replacement_link_id IS NULL WHERE event.order_id=o.id;
 SELECT count(*) INTO completed FROM app.order_event event JOIN app.parcel_receipt_result result ON result.event_id=event.source_id AND result.outcome='received' WHERE event.order_id=o.id AND event.status='partially_completed';
 expected:=app.cod_collection_payment_status(o.id);
 IF o.payment_method IS DISTINCT FROM 'cod' OR o.status IS DISTINCT FROM app.original_order_status(o.id) OR o.payment_status IS DISTINCT FROM expected OR (processing>1 OR o.revision<>2+paid+processing+retired+completed) OR paid>parcels
  OR o.actionable_at IS DISTINCT FROM c.accepted_at OR c.accepted_at IS DISTINCT FROM o.created_at OR c.operation_id IS DISTINCT FROM o.operation_id
  OR NOT EXISTS(SELECT 1 FROM app.commerce_operation WHERE id=c.operation_id AND action='order.create' AND resource_id=o.id)
  OR NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND revision=2 AND status='pending' AND payment_status='cod_due' AND source_id=c.id AND created_at=c.accepted_at)
 THEN RAISE EXCEPTION 'Confirmed COD, original actionability and qualified parcel receipts seal together' USING ERRCODE='23514'; END IF;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_fulfillment_order(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; processing int; prepared int; retired int; completed int;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=selected;IF o.actionable_at IS NULL THEN RETURN;END IF;
 SELECT count(*) INTO processing FROM app.order_event event JOIN app.fulfillment_event cause ON cause.id=event.source_id WHERE event.order_id=o.id AND event.status='processing' AND cause.kind='prepare';
 SELECT count(*) INTO prepared FROM app.fulfillment f JOIN app.order_shipment shipment ON shipment.id=f.shipment_id WHERE shipment.order_id=o.id AND f.prepared_at IS NOT NULL;
 SELECT count(DISTINCT event.id) INTO retired FROM app.order_event event JOIN app.exception_cancellation cancellation ON cancellation.event_id=event.source_id AND cancellation.replacement_link_id IS NULL WHERE event.order_id=o.id;
 SELECT count(*) INTO completed FROM app.order_event event JOIN app.parcel_receipt_result result ON result.event_id=event.source_id AND result.outcome='received' WHERE event.order_id=o.id AND event.status='partially_completed';
 IF (SELECT count(*) FROM app.fulfillment f JOIN app.order_shipment shipment ON shipment.id=f.shipment_id WHERE shipment.order_id=o.id)<>(SELECT count(*) FROM app.order_shipment WHERE order_id=o.id)
  OR processing>1 OR (prepared>0 AND processing<>1) OR (prepared=0 AND processing<>0)
  OR o.status IS DISTINCT FROM app.original_order_status(o.id)
  OR (o.payment_method='prepaid' AND (o.payment_status<>'confirmed' OR o.revision<>2+processing+retired+completed))
 THEN RAISE EXCEPTION 'Original actionable parcels and one parent processing cause must seal together' USING ERRCODE='23514';END IF;
 IF o.payment_method='cod' THEN PERFORM app.assert_cod_order(o.id);END IF;
END $$;

--> statement-breakpoint
-- Replacement retirement is allowed only before the first booking. Link
-- creation is already immutable after initiation, and retirement's order/head
-- locks forbid any later membership change. The accepted book event therefore
-- freezes these surviving identities without rewriting an old source row.
CREATE FUNCTION app.replacement_active_unit_ids(p_shipment_id uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$
 SELECT link.id FROM app.replacement_link link WHERE link.shipment_id=p_shipment_id
  AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.replacement_link_id=link.id)
 ORDER BY link.id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.replacement_request_unit_ids(p_booking_id uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$
 SELECT active.id FROM app.replacement_booking booking
 CROSS JOIN LATERAL app.replacement_active_unit_ids(booking.shipment_id) active
 WHERE booking.id=p_booking_id AND EXISTS(SELECT 1 FROM app.replacement_event event
  WHERE event.shipment_id=booking.shipment_id AND event.kind='book' AND event.source_kind='operation'
   AND event.source_id=booking.operation_id AND event.snapshot->>'booking_id'=booking.id::text)
 ORDER BY active.id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_replacement_stock_investigation_clear(p_shipment_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_order_id uuid;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Replacement dispatch requires a fresh locking isolation level' USING ERRCODE='23514'; END IF;
 SELECT claim.order_id INTO v_order_id FROM app.replacement_shipment shipment JOIN app.return_case claim ON claim.id=shipment.case_id WHERE shipment.id=p_shipment_id;
 PERFORM id FROM app.commerce_order WHERE id=v_order_id FOR UPDATE;
 IF v_order_id IS NULL OR NOT EXISTS(SELECT 1 FROM app.replacement_active_unit_ids(p_shipment_id)) OR EXISTS(
  SELECT 1 FROM app.exception_unit unit JOIN app.commerce_exception case_head ON case_head.id=unit.exception_id
   JOIN app.replacement_link link ON link.id=unit.replacement_link_id
  WHERE link.shipment_id=p_shipment_id AND unit.active AND unit.kind='replacement_stock' AND case_head.status<>'resolved'
   AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.replacement_link_id=link.id))
 THEN RAISE EXCEPTION 'Replacement dispatch waits for an actual surviving complete-unit scope and its stock investigation' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_exception_replacement_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_shipment_id uuid;
BEGIN
 IF TG_TABLE_NAME='replacement_event' OR TG_TABLE_NAME='replacement_booking' THEN v_shipment_id:=NEW.shipment_id;
 ELSIF TG_TABLE_NAME='local_replacement_operation' THEN SELECT shipment_id INTO v_shipment_id FROM app.replacement_booking WHERE id=NEW.booking_id;
 ELSE
  SELECT shipment_id INTO v_shipment_id FROM app.replacement_event WHERE NEW.source_ref='replacement-handover:'||id::text AND kind='handover';
  IF v_shipment_id IS NULL THEN RETURN NEW; END IF;
 END IF;
 PERFORM app.assert_replacement_stock_investigation_clear(v_shipment_id); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_replacement_event_dispatch_guard BEFORE INSERT ON app.replacement_event
 FOR EACH ROW WHEN (NEW.kind IN ('prepare','book','handover')) EXECUTE FUNCTION app.guard_exception_replacement_dispatch();
--> statement-breakpoint
CREATE TRIGGER exception_replacement_booking_dispatch_guard BEFORE INSERT ON app.replacement_booking
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_replacement_dispatch();
--> statement-breakpoint
CREATE TRIGGER exception_replacement_source_dispatch_guard BEFORE INSERT ON app.local_replacement_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_exception_replacement_dispatch();
--> statement-breakpoint
CREATE TRIGGER exception_replacement_movement_dispatch_guard BEFORE INSERT ON app.stock_movement
 FOR EACH ROW WHEN (NEW.kind='consume') EXECUTE FUNCTION app.guard_exception_replacement_dispatch();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_replacement_component() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_balance app.inventory_balance;
BEGIN
 SELECT s.* INTO v_head FROM app.replacement_link link JOIN app.replacement_shipment s ON s.id=link.shipment_id
  WHERE link.id=NEW.replacement_link_id FOR UPDATE OF s;
 SELECT * INTO v_balance FROM app.inventory_balance WHERE id=NEW.balance_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app.exception_cancellation WHERE replacement_link_id=NEW.replacement_link_id)
    OR v_head.id IS NULL OR v_head.status<>'awaiting_stock' OR v_head.stock_reservation_id IS NOT NULL
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
CREATE OR REPLACE FUNCTION app.guard_replacement_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_next app.replacement_shipment; v_case app.return_case; v_order app.commerce_order;
 v_op app.replacement_operation; v_booking app.replacement_booking; v_job app.outbox_job; v_provider app.local_replacement_event;
 v_cancellation app.exception_cancellation; v_exception_operation app.exception_operation;
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
 IF NEW.source_kind='exception' THEN
  SELECT * INTO v_cancellation FROM app.exception_cancellation WHERE exception_unit_id=NEW.source_id;
  SELECT * INTO v_exception_operation FROM app.exception_operation WHERE id=v_cancellation.operation_id;
  IF NEW.kind<>'cancel' OR NEW.actor_id IS NOT NULL OR v_cancellation.exception_unit_id IS NULL
     OR v_exception_operation.id IS NULL OR v_exception_operation.action<>'apply'
     OR v_exception_operation.created_xid<>pg_current_xact_id()::text OR v_exception_operation.response<>'{}'::jsonb
     OR NEW.reason IS DISTINCT FROM v_exception_operation.input->>'reason'
     OR NEW.source_id::text IS DISTINCT FROM (SELECT min(cancellation.exception_unit_id::text)
       FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id
       WHERE cancellation.operation_id=v_exception_operation.id AND link.shipment_id=v_head.id)
     OR NOT EXISTS(SELECT 1 FROM app.exception_event event WHERE event.id=v_cancellation.event_id AND event.kind='cancel'
       AND event.source_kind='operation' AND event.source_id=v_exception_operation.id AND event.occurred_at=v_cancellation.occurred_at)
  THEN RAISE EXCEPTION 'Replacement retirement appends one exact affected-parcel image from its unfinished accepted CS application' USING ERRCODE='23514'; END IF;
  -- The existing deferred operation seal rechecks current actor authority only
  -- after the same transaction finalizes its exact closed response.
  NEW.occurred_at:=v_cancellation.occurred_at;
 ELSIF NEW.source_kind='operation' THEN
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
 WHEN 'cancel' THEN
  IF NEW.source_kind<>'exception' OR v_head.booking_id IS NOT NULL OR v_head.handover_at IS NOT NULL
     OR v_head.status NOT IN ('awaiting_stock','ready','picking')
     OR NEW.status IS DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM app.replacement_active_unit_ids(v_head.id)) THEN v_head.status ELSE 'cancelled' END)
  THEN RAISE EXCEPTION 'Retirement preserves surviving replacement milestones and cancels only a completely retired unbooked parcel' USING ERRCODE='23514'; END IF;
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
CREATE OR REPLACE FUNCTION app.assert_replacement_shipment(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_head app.replacement_shipment; v_case app.return_case; v_order app.commerce_order; v_event app.replacement_event;
 v_create app.replacement_event; v_hold app.stock_reservation; v_link app.replacement_link; v_claim app.return_item;
 v_links int; v_active int; v_stage text; v_received int; v_booking app.replacement_booking;
BEGIN
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=p_id FOR UPDATE;
 SELECT * INTO v_case FROM app.return_case WHERE id=v_head.case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
 SELECT * INTO v_event FROM app.replacement_event WHERE shipment_id=p_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO v_create FROM app.replacement_event WHERE shipment_id=p_id AND kind='create';
 SELECT count(*) INTO v_links FROM app.replacement_link WHERE shipment_id=p_id;
 SELECT count(*) INTO v_active FROM app.replacement_active_unit_ids(p_id);
 SELECT status INTO v_stage FROM app.replacement_event WHERE shipment_id=p_id AND kind<>'cancel' ORDER BY revision DESC LIMIT 1;
 IF v_stage IS NULL OR (v_head.status='cancelled') IS DISTINCT FROM (v_active=0)
    OR (v_active>0 AND v_head.status IS DISTINCT FROM v_stage)
 THEN RAISE EXCEPTION 'Replacement operational state retains real milestones and only actual complete retirement cancels the parcel' USING ERRCODE='23514'; END IF;
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
     OR v_claim.claim_state IS DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation WHERE replacement_link_id=v_link.id) THEN
       CASE WHEN EXISTS(SELECT 1 FROM app.recovery_refund_allocation allocation
        JOIN app.exception_unit unit ON unit.id=allocation.exception_unit_id AND unit.replacement_link_id=v_link.id
        JOIN app.recovery_refund refund ON refund.id=allocation.refund_id AND refund.exception_id=unit.exception_id AND refund.status='succeeded'
        WHERE allocation.fulfillment_item_id=v_link.original_fulfillment_item_id) THEN 'refunded' ELSE 'held' END
      WHEN EXISTS(SELECT 1 FROM app.replacement_buyer_receipt WHERE replacement_link_id=v_link.id) THEN 'replaced' ELSE 'replacing' END)
  THEN RAISE EXCEPTION 'Replacement receipt and claim state preserve the exact affected physical chain' USING ERRCODE='23514'; END IF;
  IF v_head.stock_reservation_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM app.exception_cancellation WHERE replacement_link_id=v_link.id AND stock_disposition='not_reserved')) AND EXISTS(
   WITH required AS (
    SELECT c.stock_item_id,c.quantity::bigint quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
     JOIN app.offer_component c ON c.product_id=i.product_id AND c.revision=i.product_revision AND c.offer_id=i.offer_id
     WHERE f.id=v_link.original_fulfillment_item_id
   ), allocated AS (
    SELECT stock_item_id,sum(quantity::bigint) quantity FROM app.replacement_component_allocation WHERE replacement_link_id=v_link.id GROUP BY stock_item_id
   ) SELECT 1 FROM required r FULL JOIN allocated a USING(stock_item_id) WHERE r.quantity IS DISTINCT FROM a.quantity
  ) THEN RAISE EXCEPTION 'Every replacement contains exactly one complete frozen original offer' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF v_stage='awaiting_stock' THEN
  IF v_head.stock_reservation_id IS NOT NULL OR v_head.prepared_at IS NOT NULL OR v_head.booking_id IS NOT NULL
     OR v_head.waybill_issued_at IS NOT NULL OR v_head.handover_at IS NOT NULL OR v_head.calendar_snapshot IS NOT NULL OR v_head.packing_due_at IS NOT NULL
     OR EXISTS(SELECT 1 FROM app.replacement_component_allocation a JOIN app.replacement_link link ON link.id=a.replacement_link_id WHERE link.shipment_id=p_id)
  THEN RAISE EXCEPTION 'Unavailable replacement stock leaves an explicit intent without partial physical effects' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_hold FROM app.stock_reservation WHERE id=v_head.stock_reservation_id;
  IF v_hold.id IS NULL OR v_hold.kind<>'replacement' OR v_hold.expires_at IS NOT NULL
     OR v_hold.key IS DISTINCT FROM 'replacement:'||p_id::text OR v_hold.clock_namespace IS DISTINCT FROM v_order.clock_namespace
     OR v_hold.status IS DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id WHERE link.shipment_id=p_id) THEN app.retired_reservation_state(v_hold.id) WHEN v_head.handover_at IS NULL THEN 'active' ELSE 'consumed' END)
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
    OR (v_stage NOT IN ('awaiting_stock','ready') AND v_head.prepared_at IS NULL)
    OR ((v_stage IN ('awaiting_stock','ready')) AND v_head.prepared_at IS NOT NULL)
    OR ((v_stage IN ('booking_pending','booking_unknown','booking_failed','packed','handed_over','partially_delivered','delivered')) IS DISTINCT FROM (v_head.booking_id IS NOT NULL))
    OR ((v_stage IN ('packed','handed_over','partially_delivered','delivered')) IS DISTINCT FROM (v_head.waybill_issued_at IS NOT NULL AND v_head.tracking_number IS NOT NULL))
    OR ((v_stage IN ('handed_over','partially_delivered','delivered')) IS DISTINCT FROM (v_head.handover_at IS NOT NULL AND v_head.handover_reference IS NOT NULL))
 THEN RAISE EXCEPTION 'Replacement preparation, booking, usable waybill and physical handover remain distinct milestones' USING ERRCODE='23514'; END IF;
 IF v_head.booking_id IS NOT NULL THEN
  SELECT * INTO v_booking FROM app.replacement_booking WHERE id=v_head.booking_id;
  IF v_booking.id IS NULL OR v_booking.shipment_id IS DISTINCT FROM p_id
     OR v_booking.attempt IS DISTINCT FROM (SELECT max(attempt) FROM app.replacement_booking WHERE shipment_id=p_id)
     OR (v_stage='booking_pending' AND v_booking.status NOT IN ('queued','processing'))
     OR (v_stage='booking_unknown' AND v_booking.status<>'unknown')
     OR (v_stage='booking_failed' AND v_booking.status<>'failed')
     OR (v_head.waybill_issued_at IS NOT NULL AND v_booking.status<>'issued')
  THEN RAISE EXCEPTION 'Replacement retains its latest exact booking and authenticated milestone outcome' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT count(*) INTO v_received FROM app.replacement_buyer_receipt receipt JOIN app.replacement_link link ON link.id=receipt.replacement_link_id WHERE link.shipment_id=p_id;
 IF (v_stage='delivered' AND v_received<>v_active)
    OR (v_stage='partially_delivered' AND v_received NOT BETWEEN 1 AND v_active-1)
    OR (v_stage NOT IN ('delivered','partially_delivered') AND v_received<>0)
 THEN RAISE EXCEPTION 'Only actual affected-unit buyer receipts establish replacement delivery progress' USING ERRCODE='23514'; END IF;
 IF v_head.handover_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id WHERE link.shipment_id=p_id) AND EXISTS(
  SELECT 1 FROM app.stock_reservation_component c WHERE c.reservation_id=v_head.stock_reservation_id
   AND c.quantity IS DISTINCT FROM (SELECT sum(m.quantity) FROM app.stock_movement m JOIN app.replacement_event event
     ON m.source_ref='replacement-handover:'||event.id::text AND event.kind='handover'
     WHERE event.shipment_id=p_id AND m.balance_id=c.balance_id AND m.kind='consume')
 ) THEN RAISE EXCEPTION 'Replacement handover consumes every reserved component exactly once' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.replacement_projection(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('id',s.id,'case_id',s.case_id,'version',s.revision,'case_version',c.revision,
  'warehouse_id',s.warehouse_id,'status',s.status,'buyer_shipping',0,'cod_due',0,'booking_id',s.booking_id,
  'prepared_at',to_char(s.prepared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'waybill_issued_at',to_char(s.waybill_issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'tracking_number',s.tracking_number,'handover_at',to_char(s.handover_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'packing_due_at',to_char(s.packing_due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'created_at',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',link.id,'return_item_id',link.return_item_id,
    'order_item_id',f.order_item_id,'quantity',1,'original_fulfillment_item_id',link.original_fulfillment_item_id,
    'replacement_of',coalesce(link.predecessor_id,link.original_fulfillment_item_id),'generation',link.generation,
    'cancelled',EXISTS(SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.replacement_link_id=link.id)) ORDER BY link.id)
    FROM app.replacement_link link JOIN app.fulfillment_item f ON f.id=link.original_fulfillment_item_id WHERE link.shipment_id=s.id),'[]'::jsonb))
 FROM app.replacement_shipment s JOIN app.return_case c ON c.id=s.case_id WHERE s.id=p_id;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_local_replacement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT EXISTS(SELECT 1 FROM app.replacement_request_unit_ids(NEW.booking_id))
  THEN RAISE EXCEPTION 'Replacement shipping source freezes only its accepted surviving booking scope' USING ERRCODE='23514'; END IF;
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
CREATE OR REPLACE FUNCTION app.guard_local_replacement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR cardinality(v_units) IS DISTINCT FROM (SELECT count(*)::int FROM app.replacement_request_unit_ids(v_booking.id) WHERE id=ANY(v_units))
 THEN RAISE EXCEPTION 'Replacement source observes only its exact issued and handed-over physical parcel at a real bounded receipt time' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_replacement_buyer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_link app.replacement_link; v_head app.replacement_shipment; v_claim app.return_item;
 v_source app.local_replacement_receipt; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_link FROM app.replacement_link WHERE id=NEW.replacement_link_id;
 SELECT * INTO v_head FROM app.replacement_shipment WHERE id=v_link.shipment_id FOR UPDATE;
 SELECT * INTO v_claim FROM app.return_item WHERE id=v_link.return_item_id;
 SELECT * INTO v_source FROM app.local_replacement_receipt WHERE id=NEW.source_id;
 SELECT job.* INTO v_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id WHERE p.id=v_source.id;
 IF NOT EXISTS(SELECT 1 FROM app.replacement_request_unit_ids(v_source.booking_id) WHERE id=NEW.replacement_link_id)
    OR v_link.id IS NULL OR v_head.id IS NULL OR v_claim.claim_state IS DISTINCT FROM 'replacing'
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
-- A failed complete reserve keeps one exception keyed by the immutable
-- replacement intent. Later stock waits preserve the original case/consent.
CREATE FUNCTION app.assert_exception_replacement_case(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_first app.exception_event; v_source app.replacement_event;
 v_shipment app.replacement_shipment; v_operation app.replacement_operation; v_order_id uuid; v_expected jsonb; v_actual jsonb;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_case_id;
 SELECT * INTO v_first FROM app.exception_event WHERE exception_id=p_case_id AND revision=1;
 SELECT * INTO v_source FROM app.replacement_event WHERE id=v_first.source_id;
 SELECT * INTO v_shipment FROM app.replacement_shipment WHERE id=v_case.source_id;
 SELECT * INTO v_operation FROM app.replacement_operation WHERE id=v_source.source_id;
 SELECT order_id INTO v_order_id FROM app.return_case WHERE id=v_shipment.case_id;
 IF v_case.id IS NULL OR v_case.kind<>'replacement_stock' OR v_case.source_kind<>'replacement'
    OR v_shipment.id IS NULL OR v_order_id IS DISTINCT FROM v_case.order_id OR v_source.id IS NULL
    OR (v_first.kind,v_first.status,v_first.source_kind) IS DISTINCT FROM ('open'::text,'awaiting_stock'::text,'replacement'::text)
    OR v_first.actor_id IS NOT NULL OR v_first.reason IS DISTINCT FROM v_case.reason
    OR v_first.snapshot->'proposal_event_id' IS DISTINCT FROM 'null'::jsonb
    OR v_source.shipment_id IS DISTINCT FROM v_shipment.id OR v_source.kind<>'stock_wait' OR v_source.source_kind<>'operation'
    OR v_source.status<>'awaiting_stock' OR v_source.snapshot->'stock_reservation_id' IS DISTINCT FROM 'null'::jsonb
    OR v_source.occurred_at IS DISTINCT FROM v_case.occurred_at OR v_source.occurred_at>v_case.created_at
    OR v_operation.id IS NULL OR v_operation.subject_id IS DISTINCT FROM v_shipment.id
    OR v_operation.action NOT IN ('create','reserve') OR v_operation.created_xid IS DISTINCT FROM v_case.created_xid OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Replacement stock case retains its original completed stock-wait command and immutable original physical intent' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_array(id,original_fulfillment_item_id) ORDER BY id),'[]'::jsonb) INTO v_expected
  FROM app.replacement_link WHERE shipment_id=v_shipment.id;
 SELECT coalesce(jsonb_agg(jsonb_build_array(replacement_link_id,fulfillment_item_id) ORDER BY replacement_link_id),'[]'::jsonb) INTO v_actual
  FROM app.exception_unit WHERE exception_id=p_case_id;
 IF v_actual IS DISTINCT FROM v_expected OR jsonb_array_length(v_expected) NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'Stock-wait exception retains every exact complete replacement occurrence without inventing purchased quantity' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_exception_replacement_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_shipment app.replacement_shipment; v_source app.replacement_event; v_operation app.replacement_operation;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id;
 SELECT * INTO v_shipment FROM app.replacement_shipment WHERE id=v_case.source_id FOR UPDATE;
 SELECT * INTO v_source FROM app.replacement_event WHERE id=NEW.source_id;
 SELECT * INTO v_operation FROM app.replacement_operation WHERE id=v_source.source_id;
 IF v_case.kind IS DISTINCT FROM 'replacement_stock' OR v_case.source_kind<>'replacement' OR NEW.actor_id IS NOT NULL
    OR v_shipment.id IS NULL OR v_source.id IS NULL OR v_source.shipment_id IS DISTINCT FROM v_shipment.id
    OR v_source.source_kind<>'operation' OR v_operation.id IS NULL OR v_operation.subject_id IS DISTINCT FROM v_shipment.id
 THEN RAISE EXCEPTION 'Replacement exception observation belongs to its exact original physical source command' USING ERRCODE='23514'; END IF;
 IF NEW.kind='open' THEN
  IF v_case.revision<>0 OR NEW.status<>'awaiting_stock' OR v_shipment.status<>'awaiting_stock'
     OR v_shipment.stock_reservation_id IS NOT NULL OR v_shipment.booking_id IS NOT NULL
     OR v_source.kind<>'stock_wait' OR v_source.revision IS DISTINCT FROM v_shipment.revision
     OR v_source.occurred_at IS DISTINCT FROM v_case.occurred_at OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
  THEN RAISE EXCEPTION 'A new replacement stock case opens atomically from its current unfinished stock-wait command' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='resolved' THEN
  IF NEW.status<>'resolved' OR v_case.status NOT IN ('open','awaiting_stock') OR v_case.proposal_event_id IS NOT NULL
     OR v_shipment.status<>'ready' OR v_shipment.stock_reservation_id IS NULL OR v_shipment.booking_id IS NOT NULL OR v_shipment.handover_at IS NOT NULL
     OR v_source.kind<>'reserve' OR v_source.revision IS DISTINCT FROM v_shipment.revision
     OR v_source.snapshot->>'stock_reservation_id' IS DISTINCT FROM v_shipment.stock_reservation_id::text OR NEW.occurred_at<v_source.occurred_at
     OR EXISTS(SELECT 1 FROM app.exception_cancellation WHERE exception_id=v_case.id)
     OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE exception_id=v_case.id)
     OR NOT EXISTS(SELECT 1 FROM app.stock_reservation WHERE id=v_shipment.stock_reservation_id AND kind='replacement' AND status='active' AND expires_at IS NULL)
  THEN RAISE EXCEPTION 'Actual complete stock recovery cannot replace pending buyer consent, retirement or original-source finance work' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported replacement observation transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exception_replacement_source_guard BEFORE INSERT ON app.exception_event
 FOR EACH ROW WHEN (NEW.source_kind='replacement') EXECUTE FUNCTION app.guard_exception_replacement_source();
--> statement-breakpoint
CREATE FUNCTION app.seal_replacement_stock_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case_id uuid;
BEGIN
 SELECT id INTO v_case_id FROM app.commerce_exception WHERE source_kind='replacement' AND source_id=NEW.shipment_id AND kind='replacement_stock';
 IF v_case_id IS NULL THEN RAISE EXCEPTION 'An actual complete replacement stock wait commits its one retained exception case' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_exception_case(v_case_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER replacement_stock_case_sealed AFTER INSERT ON app.replacement_event
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='stock_wait') EXECUTE FUNCTION app.seal_replacement_stock_case();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_operation app.return_operation; v_refund_event app.refund_event; v_refund app.refund;
 v_replacement app.replacement_event; v_replacement_head app.replacement_shipment; v_replacement_op app.replacement_operation; v_replacement_job app.outbox_job; v_exception_operation app.exception_operation;
 v_recovery app.recovery_refund_event; v_recovery_head app.recovery_refund; v_recovery_job app.outbox_job;
 v_cash app.finance_transaction; v_order app.commerce_order; v_now timestamptz; v_selected integer; v_complete boolean;
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
     OR NEW.actor_id IS DISTINCT FROM v_replacement.actor_id OR NEW.kind NOT IN ('replacement_started','replacement_received','replacement_cancelled')
  THEN RAISE EXCEPTION 'Replacement case transition retains its exact original affected physical event' USING ERRCODE='23514'; END IF;
  IF NEW.kind='replacement_started' THEN
   SELECT * INTO v_replacement_op FROM app.replacement_operation WHERE id=v_replacement.source_id;
   IF v_replacement.kind<>'create' OR v_replacement.source_kind<>'operation'
      OR v_replacement_op.id IS NULL OR v_replacement_op.action<>'create'
      OR v_replacement_op.created_xid<>pg_current_xact_id()::text OR v_replacement_op.response<>'{}'::jsonb
   THEN RAISE EXCEPTION 'Replacement initiation belongs to its unfinished creating operation' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind='replacement_cancelled' THEN
   SELECT operation.* INTO v_exception_operation FROM app.exception_cancellation cancellation JOIN app.exception_operation operation ON operation.id=cancellation.operation_id
    WHERE cancellation.exception_unit_id=v_replacement.source_id;
   IF v_replacement.kind<>'cancel' OR v_replacement.source_kind<>'exception' OR NEW.actor_id IS NOT NULL
      OR v_exception_operation.id IS NULL OR v_exception_operation.action<>'apply'
      OR v_exception_operation.created_xid<>pg_current_xact_id()::text OR v_exception_operation.response<>'{}'::jsonb
   THEN RAISE EXCEPTION 'Replacement cancellation retains its exact unfinished accepted CS application without claiming a receipt or refund' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT job.* INTO v_replacement_job FROM app.replacement_receipt_provider_event p JOIN app.outbox_job job ON job.id=p.callback_job_id
    WHERE p.id=v_replacement.source_id;
   IF v_replacement.kind<>'receipt' OR v_replacement.source_kind<>'receipt' OR NEW.actor_id IS NOT NULL
      OR v_replacement_job.id IS NULL OR v_replacement_job.kind<>'replacement.receipt.callback' OR v_replacement_job.status<>'pending'
      OR EXISTS(SELECT 1 FROM app.replacement_receipt_result WHERE event_id=v_replacement.source_id)
   THEN RAISE EXCEPTION 'Replacement resolution belongs to the pending actual receipt callback' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.kind='replacement_received' AND EXISTS(SELECT 1 FROM app.return_item WHERE case_id=v_case.id AND claim_state='refunded') THEN
   SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
   v_now:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
   IF NEW.occurred_at<v_replacement.occurred_at OR NEW.occurred_at>v_now
      OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',NEW.occurred_at)
      OR NEW.occurred_at<(SELECT occurred_at FROM app.return_event WHERE case_id=v_case.id ORDER BY revision DESC LIMIT 1)
      OR (v_order.clock_namespace IS NULL AND NEW.occurred_at<date_trunc('milliseconds',transaction_timestamp()))
      OR (v_order.clock_namespace IS NOT NULL AND NEW.occurred_at IS DISTINCT FROM v_now)
   THEN RAISE EXCEPTION 'Mixed replacement receipt applies at its current transaction clock while retaining original physical source time' USING ERRCODE='23514'; END IF;
  ELSE NEW.occurred_at:=v_replacement.occurred_at;
  END IF;
 ELSIF NEW.source_kind='recovery' THEN
  SELECT * INTO v_recovery FROM app.recovery_refund_event WHERE id=NEW.source_id;
  SELECT * INTO v_recovery_head FROM app.recovery_refund WHERE id=v_recovery.refund_id;
  SELECT * INTO v_cash FROM app.finance_transaction WHERE id=v_recovery.cash_transaction_id;
  SELECT job.* INTO v_recovery_job FROM app.recovery_provider_event registered JOIN app.outbox_job job ON job.id=registered.callback_job_id
   WHERE registered.id=v_recovery.source_id;
  SELECT count(*) INTO v_selected FROM app.recovery_return_items(v_recovery_head.id) WHERE case_id=v_case.id;
  IF v_recovery.id IS NULL OR v_recovery.kind<>'confirm' OR v_recovery.source_kind<>'provider' OR v_recovery.status<>'succeeded'
     OR v_recovery_head.id IS NULL OR v_recovery_head.status<>'succeeded' OR v_recovery_head.order_id IS DISTINCT FROM v_case.order_id
     OR v_recovery.revision IS DISTINCT FROM v_recovery_head.revision OR v_recovery.cash_transaction_id IS DISTINCT FROM v_recovery_head.cash_transaction_id
     OR v_cash.id IS NULL OR v_cash.created_xid<>pg_current_xact_id()::text OR v_cash.kind<>'recovery_cash'
     OR v_selected NOT BETWEEN 1 AND 100 OR NEW.kind<>'refund_confirmed' OR NEW.actor_id IS NOT NULL
     OR v_recovery_job.id IS NULL OR v_recovery_job.kind<>'recovery.refund.callback' OR v_recovery_job.status<>'pending'
     OR EXISTS(SELECT 1 FROM app.recovery_event_result WHERE refund_event_id=v_recovery.id)
     OR NEW.reason<>'Original signed recovery cash refunds only the cancelled replacement claims'
  THEN RAISE EXCEPTION 'Recovery return consequence retains its exact new cash-backed original held claim set and pending bank callback' USING ERRCODE='23514'; END IF;
  SELECT count(*)>0 AND bool_and(item.claim_state IN ('replaced','refunded') OR item.id IN (
    SELECT return_item_id FROM app.recovery_return_items(v_recovery_head.id) WHERE case_id=v_case.id))
   INTO v_complete FROM app.return_item item WHERE item.case_id=v_case.id;
  NEW.occurred_at:=v_recovery.occurred_at;
 ELSIF NEW.source_kind='refund' THEN
  SELECT * INTO v_refund_event FROM app.refund_event WHERE id=NEW.source_id;
  SELECT * INTO v_refund FROM app.refund WHERE id=v_refund_event.refund_id;
  IF v_refund.id IS NULL OR v_refund.case_id IS DISTINCT FROM v_case.id OR v_refund_event.source_kind<>'provider'
     OR (NEW.kind='refund_confirmed' AND (v_refund_event.kind<>'confirm' OR v_refund_event.status<>'succeeded'))
     OR (NEW.kind='refund_failed' AND (v_refund_event.kind<>'fail' OR v_refund_event.status<>'failed'))
     OR NEW.kind NOT IN ('refund_confirmed','refund_failed') OR NEW.actor_id IS NOT NULL
  THEN RAISE EXCEPTION 'Refund return transition retains its exact original financial event' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=v_refund_event.occurred_at;
 ELSE RAISE EXCEPTION 'Return history requires its exact operation, physical replacement, ordinary refund or recovery owner' USING ERRCODE='23514';
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
 ELSIF NEW.kind IN ('replacement_started','replacement_received','replacement_cancelled') THEN
  IF v_case.status<>'replacing' OR v_case.resolution IS DISTINCT FROM 'replacement'
     OR NEW.status NOT IN ('replacing','resolved') OR (NEW.kind IN ('replacement_started','replacement_cancelled') AND NEW.status<>'replacing')
     OR (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods)
  THEN RAISE EXCEPTION 'Replacement advances only its original approved held case without another charge' USING ERRCODE='23514'; END IF;
 ELSIF NEW.source_kind='recovery' THEN
  IF v_case.status<>'replacing' OR v_case.resolution IS DISTINCT FROM 'replacement'
     OR NEW.status IS DISTINCT FROM (CASE WHEN v_complete THEN 'resolved' ELSE 'replacing' END)
     OR (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods)
  THEN RAISE EXCEPTION 'Recovery refunds only selected original claims and completes the mixed case only after every actual outcome' USING ERRCODE='23514'; END IF;
 ELSE
  IF v_case.status<>'refunding' OR v_case.resolution<>'refund'
     OR NEW.status IS DISTINCT FROM (CASE NEW.kind WHEN 'refund_confirmed' THEN 'resolved' WHEN 'refund_failed' THEN 'refunding' ELSE NULL END)
     OR (NEW.resolution,NEW.requires_goods) IS DISTINCT FROM (v_case.resolution,v_case.requires_goods)
  THEN RAISE EXCEPTION 'Refund outcome advances its original held case' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_item_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event app.return_event; v_item app.return_item; v_previous record; v_case app.return_case; v_operation app.return_operation; v_replacement app.replacement_event; v_replacement_op app.replacement_operation; v_job app.outbox_job; v_exception_operation app.exception_operation;
 v_recovery app.recovery_refund_event; v_recovery_head app.recovery_refund; v_cash app.finance_transaction;
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
 ELSIF v_event.source_kind='recovery' THEN
  SELECT * INTO v_recovery FROM app.recovery_refund_event WHERE id=v_event.source_id;
  SELECT * INTO v_recovery_head FROM app.recovery_refund WHERE id=v_recovery.refund_id;
  SELECT * INTO v_cash FROM app.finance_transaction WHERE id=v_recovery.cash_transaction_id;
  SELECT job.* INTO v_job FROM app.recovery_provider_event registered JOIN app.outbox_job job ON job.id=registered.callback_job_id WHERE registered.id=v_recovery.source_id;
  IF v_recovery.id IS NULL OR v_recovery.kind<>'confirm' OR v_recovery.source_kind<>'provider' OR v_recovery.status<>'succeeded'
     OR v_recovery_head.id IS NULL OR v_recovery_head.status<>'succeeded' OR v_recovery_head.order_id IS DISTINCT FROM v_case.order_id
     OR v_cash.id IS NULL OR v_cash.created_xid<>pg_current_xact_id()::text
     OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.callback' OR v_job.status<>'pending'
     OR EXISTS(SELECT 1 FROM app.recovery_event_result WHERE refund_event_id=v_recovery.id)
     OR NOT EXISTS(SELECT 1 FROM app.recovery_return_items(v_recovery.refund_id) expected WHERE expected.return_item_id=v_item.id AND expected.case_id=v_event.case_id)
  THEN RAISE EXCEPTION 'Recovery unit history belongs only to its exact new successful bank callback and original cancelled claim' USING ERRCODE='23514'; END IF;
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
  ELSIF v_replacement.kind='cancel' THEN
   SELECT operation.* INTO v_exception_operation FROM app.exception_cancellation cancellation JOIN app.exception_operation operation ON operation.id=cancellation.operation_id
    WHERE cancellation.exception_unit_id=v_replacement.source_id;
   IF v_replacement.source_kind<>'exception' OR v_exception_operation.id IS NULL OR v_exception_operation.action<>'apply'
      OR v_exception_operation.created_xid<>pg_current_xact_id()::text OR v_exception_operation.response<>'{}'::jsonb
   THEN RAISE EXCEPTION 'Committed replacement cancellation cannot gain later claim transitions' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Replacement unit history requires its exact initiation, receipt or accepted cancellation cause' USING ERRCODE='23514'; END IF;
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
 ELSIF v_event.kind='replacement_cancelled' THEN
  IF v_previous.claim_state<>'replacing' OR NEW.claim_state<>'held' OR NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status
     OR v_event.source_kind<>'replacement' OR v_replacement.kind<>'cancel' OR NOT EXISTS(
      SELECT 1 FROM app.replacement_link link JOIN app.exception_cancellation cancellation ON cancellation.replacement_link_id=link.id
       WHERE link.shipment_id=v_replacement.shipment_id AND link.return_item_id=v_item.id AND cancellation.operation_id=v_exception_operation.id)
  THEN RAISE EXCEPTION 'Accepted replacement retirement retains exactly its original active claim without refund, release or delivery' USING ERRCODE='23514'; END IF;
 ELSIF v_event.kind='replacement_received' THEN
  IF v_previous.claim_state<>'replacing' OR NEW.claim_state<>'replaced' OR NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status
     OR NOT EXISTS(SELECT 1 FROM app.replacement_link link JOIN app.replacement_buyer_receipt receipt ON receipt.replacement_link_id=link.id
       WHERE link.shipment_id=v_replacement.shipment_id AND link.return_item_id=v_item.id AND receipt.source_id=v_replacement.source_id)
  THEN RAISE EXCEPTION 'Replacement receipt completes only the actually received affected quantities' USING ERRCODE='23514'; END IF;
 ELSIF v_event.kind='refund_confirmed' THEN
  IF v_previous.claim_state<>'held' OR NEW.claim_state<>'refunded' OR NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status
     OR (v_event.source_kind='recovery' AND v_previous.inspection_status NOT IN ('accepted','waived'))
  THEN RAISE EXCEPTION 'Confirmed refund consumes only its held original complete units' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This case event does not change physical unit state' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
-- Recovery queue owns original-source obligations only. Destination, bank,
-- dispatch and retry transitions require their separately completed guards.
CREATE FUNCTION app.recovery_refund_eligible_units(p_case_id uuid)
RETURNS TABLE(exception_unit_id uuid,fulfillment_item_id uuid,receipt_id uuid,purchase_event_id uuid,
 merchandise_amount bigint,buyer_shipping bigint,amount numeric,transaction_id uuid,source_event_id uuid,source_amount bigint)
LANGUAGE sql STABLE AS $$
 WITH applied AS (
  SELECT event.id,event.snapshot->'application' application FROM app.exception_event event WHERE event.exception_id=p_case_id
   AND event.kind IN ('cancel','source_reconciled') AND jsonb_typeof(event.snapshot->'application')='object'
   ORDER BY event.revision DESC LIMIT 1
 )
 SELECT unit.id,original.id,receipt.id,purchase.id,item.unit_price::bigint,original.buyer_shipping::bigint,
  item.unit_price::numeric+original.buyer_shipping::numeric,receipt.transaction_id,receipt.event_id::uuid,receipt.amount
 FROM app.commerce_exception case_head JOIN app.commerce_order purchase_order ON purchase_order.id=case_head.order_id
 JOIN app.exception_unit unit ON unit.exception_id=case_head.id JOIN app.fulfillment_item original ON original.id=unit.fulfillment_item_id
 JOIN app.order_item item ON item.id=original.order_item_id AND item.order_id=purchase_order.id
 JOIN app.economic_receipt receipt ON receipt.order_id=purchase_order.id AND receipt.kind=purchase_order.payment_method
  AND ((receipt.kind='prepaid' AND receipt.shipment_id IS NULL) OR (receipt.kind='cod' AND receipt.shipment_id=original.shipment_id))
  AND original.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id))
 LEFT JOIN app.commerce_event purchase ON purchase.receipt_id=receipt.id AND purchase.name='Purchase'
 LEFT JOIN applied ON true
 LEFT JOIN app.exception_event proposal ON proposal.id::text=applied.application->>'proposal_id' AND proposal.exception_id=case_head.id AND proposal.kind='propose'
 WHERE case_head.id=p_case_id AND (
  (case_head.kind='late_collection' AND receipt.event_id=case_head.source_id::text)
  OR (case_head.kind NOT IN ('late_collection','unallocated_collection') AND EXISTS(
   SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.exception_unit_id=unit.id AND cancellation.event_id=applied.id)
   AND (unit.replacement_link_id IS NULL OR proposal.snapshot->'proposal'->>'action'='refund_original_entitlement')))
 ORDER BY unit.id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.recovery_refund_projection(p_refund_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('id',refund.id,'exception_id',refund.exception_id,'order_id',refund.order_id,'version',refund.revision,
  'status',CASE WHEN refund.status IN ('queued','processing') AND job.status='unknown' THEN 'unknown'
    WHEN refund.status='queued' AND job.status='failed' THEN 'failed' ELSE refund.status END,
  'amount',refund.amount,'source_kind',refund.source_kind,'source_id',refund.source_id,'source_transaction_id',refund.source_transaction_id,
  'receipt_id',refund.receipt_id,'obligation_transaction_id',refund.obligation_transaction_id,'cash_transaction_id',refund.cash_transaction_id,
  'remaining_capacity',refund.source_amount
   -coalesce((SELECT sum(allocation.amount) FROM app.refund_allocation allocation JOIN app.economic_receipt receipt ON receipt.id=allocation.receipt_id
      WHERE receipt.transaction_id=refund.source_transaction_id),0)
   -coalesce((SELECT sum(other.amount) FROM app.recovery_refund other WHERE other.source_transaction_id=refund.source_transaction_id),0),
  'created_at',to_char(refund.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'explanation',CASE WHEN refund.status IN ('queued','processing') AND job.status='unknown' THEN 'Hasil pengiriman dana sedang diperiksa.'
    WHEN refund.status='queued' AND job.status='failed' THEN 'Pengiriman dana belum berhasil. Tim keuangan sedang memeriksanya.'
    ELSE CASE refund.status WHEN 'awaiting_destination' THEN 'Dana belum dikirim. Tujuan pengembalian dana masih perlu diverifikasi.'
     WHEN 'queued' THEN 'Pengembalian dana masuk antrean.' WHEN 'processing' THEN 'Pengiriman dana sedang diproses.'
     WHEN 'unknown' THEN 'Hasil pengiriman dana sedang diperiksa.' WHEN 'succeeded' THEN 'Pengembalian dana sudah dikonfirmasi.'
     WHEN 'failed' THEN 'Pengiriman dana belum berhasil. Tim keuangan sedang memeriksanya.' END END)
 FROM app.recovery_refund refund LEFT JOIN app.outbox_job job ON job.id=refund.current_job_id WHERE refund.id=p_refund_id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.recovery_refund_batch_projection(p_case_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('exception_id',case_head.id,'version',case_head.revision,
  'refunds',jsonb_agg(app.recovery_refund_projection(refund.id) ORDER BY refund.created_at,refund.id))
 FROM app.commerce_exception case_head JOIN app.recovery_refund refund ON refund.exception_id=case_head.id
 WHERE case_head.id=p_case_id GROUP BY case_head.id,case_head.revision;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_refund_source(p_refund app.recovery_refund) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_case app.commerce_exception; v_receipt app.economic_receipt; v_transaction_id uuid; v_amount numeric;
BEGIN
 SELECT * INTO v_order FROM app.commerce_order WHERE id=p_refund.order_id FOR UPDATE;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_refund.exception_id;
 IF v_order.id IS NULL OR v_case.order_id IS DISTINCT FROM v_order.id
    OR p_refund.source_kind IS DISTINCT FROM (CASE v_order.payment_method WHEN 'prepaid' THEN 'payment_event' WHEN 'cod' THEN 'cod_event' ELSE NULL END)
 THEN RAISE EXCEPTION 'Recovery refund retains its original order and authenticated collection rail' USING ERRCODE='23514'; END IF;
 IF p_refund.basis_kind='purchased_units' THEN
  SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=p_refund.receipt_id;
  PERFORM app.assert_recovery_receipt(p_refund.receipt_id);
  IF v_receipt.id IS NULL OR v_case.kind='unallocated_collection' OR v_receipt.order_id IS DISTINCT FROM v_order.id
     OR v_receipt.transaction_id IS DISTINCT FROM p_refund.source_transaction_id OR v_receipt.event_id IS DISTINCT FROM p_refund.source_id::text
     OR v_receipt.amount IS DISTINCT FROM p_refund.source_amount
  THEN RAISE EXCEPTION 'Purchased compensation retains one exact original qualified receipt and journal' USING ERRCODE='23514'; END IF;
 ELSE
  IF p_refund.basis_kind<>'unallocated' OR v_case.kind<>'unallocated_collection' OR p_refund.receipt_id IS NOT NULL
     OR p_refund.source_kind IS DISTINCT FROM v_case.source_kind OR p_refund.source_id IS DISTINCT FROM v_case.source_id
  THEN RAISE EXCEPTION 'Unallocated compensation retains actual money without invented merchandise' USING ERRCODE='23514'; END IF;
  PERFORM app.assert_exception_collection_case(v_case.id);
  SELECT transaction_id INTO v_transaction_id FROM app.payment_event_result WHERE v_case.source_kind='payment_event' AND event_id=v_case.source_id AND outcome='recovery' AND receipt_id IS NULL
  UNION ALL SELECT transaction_id FROM app.cod_event_result WHERE v_case.source_kind='cod_event' AND event_id=v_case.source_id AND outcome='recovery' AND receipt_id IS NULL;
  IF v_transaction_id IS NULL OR v_transaction_id IS DISTINCT FROM p_refund.source_transaction_id
  THEN RAISE EXCEPTION 'Unallocated refund keeps its exact original positive callback liability' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM app.assert_compensation_capacity(p_refund.source_transaction_id);
 SELECT sum(amount::numeric) INTO v_amount FROM app.finance_posting WHERE transaction_id=p_refund.source_transaction_id AND account='provider_receivable' AND side='debit';
 IF v_amount IS DISTINCT FROM p_refund.source_amount::numeric
 THEN RAISE EXCEPTION 'Recovery source capacity is actual original gross collection, never a client balance' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_order app.commerce_order; v_event app.recovery_refund_event;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recovery obligations and original source history are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.operation_id;
  SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id FOR UPDATE;
  SELECT * INTO v_order FROM app.commerce_order WHERE id=NEW.order_id;
  IF v_operation.id IS NULL OR v_operation.action<>'refund_queue' OR v_operation.exception_id IS DISTINCT FROM v_case.id
     OR v_operation.subject_id IS DISTINCT FROM v_case.id OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR v_case.status<>'ready_for_refund' OR v_case.order_id IS DISTINCT FROM v_order.id
     OR NEW.revision<>1 OR NEW.cash_transaction_id IS NOT NULL OR NEW.current_operation_id IS NOT NULL OR NEW.destination_source_id IS NOT NULL
     OR NEW.status IS DISTINCT FROM (CASE v_order.payment_method WHEN 'prepaid' THEN 'queued' ELSE 'awaiting_destination' END)
     OR ((NEW.current_job_id IS NOT NULL) IS DISTINCT FROM (v_order.payment_method='prepaid'))
     OR NEW.basis_kind IS DISTINCT FROM (CASE v_case.kind WHEN 'unallocated_collection' THEN 'unallocated' ELSE 'purchased_units' END)
  THEN RAISE EXCEPTION 'Recovery queue starts only its exact unfinished current finance command, original source and unpaid obligation' USING ERRCODE='23514'; END IF;
  PERFORM app.assert_recovery_refund_source(NEW);
  NEW.created_at:=v_operation.occurred_at;NEW.recorded_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['revision','status','current_job_id','current_operation_id','destination_source_id','cash_transaction_id'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','status','current_job_id','current_operation_id','destination_source_id','cash_transaction_id'])
    OR NEW.revision::bigint<>OLD.revision::bigint+1
 THEN RAISE EXCEPTION 'Recovery lifecycle preserves every original obligation, money, rail and source identity' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_event FROM app.recovery_refund_event WHERE refund_id=OLD.id AND revision=NEW.revision;
 IF v_event.id IS NULL OR (NEW.status,NEW.current_job_id,NEW.current_operation_id,NEW.destination_source_id,NEW.cash_transaction_id)
   IS DISTINCT FROM (v_event.status,v_event.job_id,v_event.provider_operation_id,v_event.destination_source_id,v_event.cash_transaction_id)
 THEN RAISE EXCEPTION 'Recovery head applies exactly one complete authenticated lifecycle event' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON app.recovery_refund FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_refund();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_refund_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_operation app.exception_operation; v_case app.commerce_exception; v_order app.commerce_order;
 v_destination app.local_recovery_destination; v_job app.outbox_job; v_previous app.recovery_refund_event;
 v_request app.local_recovery_operation; v_bank app.local_recovery_event; v_registration app.recovery_provider_event; v_now timestamptz;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id FOR UPDATE;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_refund.exception_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id;
 SELECT * INTO v_previous FROM app.recovery_refund_event WHERE refund_id=v_refund.id AND revision=v_refund.revision;
 v_now:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
 IF v_refund.id IS NULL OR v_case.id IS NULL OR v_order.id IS NULL OR v_case.order_id IS DISTINCT FROM v_order.id
 THEN RAISE EXCEPTION 'Recovery history retains its original case and order' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('prepare','confirm','fail') THEN
  IF v_previous.id IS NULL OR NEW.revision::bigint<>v_refund.revision::bigint+1 OR v_refund.cash_transaction_id IS NOT NULL
     OR v_refund.status='succeeded' OR v_case.status NOT IN ('refunding','unknown')
     OR NEW.occurred_at<v_previous.occurred_at OR NEW.occurred_at>v_now
     OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',NEW.occurred_at)
     OR (v_order.clock_namespace IS NULL AND NEW.occurred_at<date_trunc('milliseconds',transaction_timestamp()))
     OR (v_order.clock_namespace IS NOT NULL AND NEW.occurred_at IS DISTINCT FROM v_now)
  THEN RAISE EXCEPTION 'Recovery source history appends its current domain application time without rewriting bank occurrence' USING ERRCODE='23514'; END IF;
  IF NEW.kind='prepare' THEN
   SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.source_id FOR SHARE;
   SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=NEW.provider_operation_id;
   IF NEW.source_kind<>'job' OR v_refund.status<>'queued' OR v_refund.current_operation_id IS NOT NULL
      OR v_job.id IS NULL OR v_job.id IS DISTINCT FROM v_refund.current_job_id OR v_job.kind<>'recovery.refund.create'
      OR v_job.status<>'processing' OR v_job.lease_token IS NULL OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL
      OR v_request.id IS NULL OR v_request.refund_id IS DISTINCT FROM v_refund.id OR v_request.creation_job_id IS DISTINCT FROM v_job.id
      OR v_request.created_at IS DISTINCT FROM NEW.occurred_at OR NEW.status<>'processing' OR NEW.job_id IS DISTINCT FROM v_job.id
      OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id OR NEW.cash_transaction_id IS NOT NULL
      OR NEW.reason<>'Original fenced recovery bank request prepared; no outgoing money is confirmed'
   THEN RAISE EXCEPTION 'Recovery preparation binds its exact freshly fenced original request without confirming outgoing money' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO v_bank FROM app.local_recovery_event WHERE id=NEW.source_id;
   SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=v_bank.operation_id;
   SELECT * INTO v_registration FROM app.recovery_provider_event WHERE id=v_bank.id;
   SELECT * INTO v_job FROM app.outbox_job WHERE id=v_registration.callback_job_id;
   IF NEW.source_kind<>'provider' OR v_refund.status NOT IN ('processing','unknown')
      OR v_bank.id IS NULL OR v_request.id IS NULL OR v_registration.id IS NULL
      OR v_request.refund_id IS DISTINCT FROM v_refund.id OR v_request.id IS DISTINCT FROM v_refund.current_operation_id
      OR v_request.creation_job_id IS DISTINCT FROM v_refund.current_job_id OR NEW.provider_operation_id IS DISTINCT FROM v_request.id
      OR v_registration.refund_id IS DISTINCT FROM v_refund.id OR v_registration.payload_hash IS DISTINCT FROM app.recovery_bank_payload_hash(v_bank.id)
      OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.callback' OR v_job.status<>'pending'
      OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_bank.id) OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-callback:'||v_bank.id::text
      OR v_bank.occurred_at<v_request.created_at OR v_bank.occurred_at>NEW.occurred_at
      OR NEW.job_id IS DISTINCT FROM v_refund.current_job_id OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id
      OR NEW.status IS DISTINCT FROM v_bank.status OR NEW.kind IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirm' ELSE 'fail' END)
      OR ((NEW.cash_transaction_id IS NOT NULL) IS DISTINCT FROM (v_bank.status='succeeded'))
      OR NEW.reason IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'Original signed bank debit confirms recovery refund'
       ELSE 'Original signed recovery instruction was rejected without sending money' END)
   THEN RAISE EXCEPTION 'Recovery outcome retains its exact registered original bank result and current callback, never a client success flag' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.recorded_at:=clock_timestamp();RETURN NEW;
 END IF;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=NEW.source_id;
 IF v_refund.id IS NULL OR NEW.source_kind<>'operation' OR v_operation.id IS NULL
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR v_operation.exception_id IS DISTINCT FROM v_refund.exception_id
 THEN RAISE EXCEPTION 'Recovery queue and destination retain their unfinished exact authorized operation' USING ERRCODE='23514'; END IF;
 IF NEW.kind='queue' THEN
 IF NEW.revision<>1 OR v_refund.revision<>1
    OR EXISTS(SELECT 1 FROM app.recovery_refund_event WHERE refund_id=v_refund.id)
    OR v_operation.id IS NULL OR v_operation.id IS DISTINCT FROM v_refund.operation_id OR v_operation.action<>'refund_queue'
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR (NEW.status,NEW.job_id,NEW.provider_operation_id,NEW.destination_source_id,NEW.cash_transaction_id)
      IS DISTINCT FROM (v_refund.status,v_refund.current_job_id,NULL::uuid,NULL::uuid,NULL::uuid)
    OR NEW.reason IS DISTINCT FROM v_operation.input->>'reason'
 THEN RAISE EXCEPTION 'Recovery queue event retains its exact new original-source finance command without bank or destination effects' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='destination' THEN
  SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_refund.exception_id;
  SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id;
  SELECT * INTO v_destination FROM app.local_recovery_destination WHERE id=NEW.destination_source_id;
  SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.job_id;
  SELECT * INTO v_previous FROM app.recovery_refund_event WHERE refund_id=v_refund.id AND revision=v_refund.revision;
  IF v_operation.action<>'destination' OR v_operation.subject_id IS DISTINCT FROM v_refund.id OR v_case.status<>'refunding'
     OR v_order.payment_method<>'cod' OR v_refund.status<>'awaiting_destination'
     OR v_refund.destination_source_id IS NOT NULL OR v_refund.current_job_id IS NOT NULL OR v_refund.current_operation_id IS NOT NULL OR v_refund.cash_transaction_id IS NOT NULL
     OR NEW.revision::bigint<>v_refund.revision::bigint+1 OR NEW.status<>'queued' OR NEW.provider_operation_id IS NOT NULL OR NEW.cash_transaction_id IS NOT NULL
     OR NEW.reason<>'Original buyer accepted the independently verified recovery recipient'
     OR v_previous.id IS NULL OR v_operation.occurred_at<v_previous.occurred_at
     OR v_destination.id IS NULL OR v_destination.id::text IS DISTINCT FROM v_operation.input->>'destination_source_id'
     OR v_destination.refund_id IS DISTINCT FROM v_refund.id OR v_destination.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
     OR v_destination.buyer_scope IS DISTINCT FROM (CASE WHEN v_order.owner_user_id IS NOT NULL THEN 'user:'||v_order.owner_user_id ELSE 'guest:'||v_order.owner_guest_id::text END)
     OR v_destination.occurred_at<v_refund.created_at OR v_destination.occurred_at>v_operation.occurred_at
     OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.create' OR v_job.status<>'pending' OR v_job.attempts<>0 OR v_job.max_attempts<>5
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',1)
     OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-create:'||v_refund.id::text||':1'
  THEN RAISE EXCEPTION 'Recovery recipient acceptance starts only its exact original buyer, independently stored source and first unsent instruction' USING ERRCODE='23514'; END IF;
 ELSE
  RAISE EXCEPTION 'Other recovery lifecycle transitions require their completed source and effect owners' USING ERRCODE='23514';
 END IF;
 NEW.occurred_at:=v_operation.occurred_at;NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_refund_event_guard BEFORE INSERT ON app.recovery_refund_event FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_refund_event();
--> statement-breakpoint
CREATE TRIGGER recovery_refund_event_immutable BEFORE UPDATE OR DELETE ON app.recovery_refund_event FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_operation app.exception_operation; v_eligible record;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=v_refund.operation_id;
 IF v_refund.id IS NULL OR v_refund.revision<>1 OR v_operation.id IS NULL OR v_operation.action<>'refund_queue'
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Compensation allocation belongs only to its original unfinished finance queue' USING ERRCODE='23514'; END IF;
 IF v_refund.basis_kind='unallocated' THEN
  IF NEW.exception_unit_id IS NOT NULL OR NEW.fulfillment_item_id IS NOT NULL OR NEW.receipt_id IS NOT NULL OR NEW.purchase_event_id IS NOT NULL
     OR NEW.merchandise_amount<>0 OR NEW.buyer_shipping<>0 OR NEW.amount IS DISTINCT FROM v_refund.amount OR v_refund.amount<>v_refund.source_amount
  THEN RAISE EXCEPTION 'Unallocated compensation retains the original complete money source without any merchandise claim' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_eligible FROM app.recovery_refund_eligible_units(v_refund.exception_id) unit WHERE unit.exception_unit_id=NEW.exception_unit_id AND unit.receipt_id=v_refund.receipt_id;
  IF v_eligible.exception_unit_id IS NULL OR (NEW.fulfillment_item_id,NEW.receipt_id,NEW.purchase_event_id,NEW.merchandise_amount,NEW.buyer_shipping,NEW.amount::numeric)
     IS DISTINCT FROM (v_eligible.fulfillment_item_id,v_eligible.receipt_id,v_eligible.purchase_event_id,v_eligible.merchandise_amount,v_eligible.buyer_shipping,v_eligible.amount)
     OR v_eligible.transaction_id IS DISTINCT FROM v_refund.source_transaction_id OR v_eligible.source_event_id IS DISTINCT FROM v_refund.source_id
  THEN RAISE EXCEPTION 'Compensation allocates only the accepted actually funded original complete unit and its frozen Purchase context' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_refund_allocation_guard BEFORE INSERT ON app.recovery_refund_allocation FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_refund_allocation();
--> statement-breakpoint
CREATE TRIGGER recovery_refund_allocation_immutable BEFORE UPDATE OR DELETE ON app.recovery_refund_allocation FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_refund_money(p_transaction_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_journal app.finance_transaction; v_bank app.local_recovery_event; v_operation app.local_recovery_operation;
 v_result app.recovery_event_result; v_job app.outbox_job; v_count integer;
BEGIN
 SELECT * INTO v_journal FROM app.finance_transaction WHERE id=p_transaction_id;
 IF v_journal.kind NOT IN ('recovery_obligation','recovery_cash') THEN RETURN; END IF;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE obligation_transaction_id=p_transaction_id OR cash_transaction_id=p_transaction_id;
 IF v_refund.id IS NULL OR v_journal.order_id IS DISTINCT FROM v_refund.order_id OR v_journal.reverses_id IS NOT NULL
    OR current_database() IS DISTINCT FROM '99ribu_'||v_journal.environment
 THEN RAISE EXCEPTION 'Recovery money cannot exist without its exact original-source obligation' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_count FROM app.finance_posting WHERE transaction_id=p_transaction_id;
 IF v_count<>2 OR EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=p_transaction_id AND amount<>v_refund.amount)
 THEN RAISE EXCEPTION 'Recovery journal conserves exactly the full immutable original-source refund amount' USING ERRCODE='23514'; END IF;
 IF v_journal.kind='recovery_obligation' THEN
  IF v_refund.obligation_transaction_id IS DISTINCT FROM v_journal.id OR v_journal.source<>'local.recovery.obligation'
     OR v_journal.effect_reference IS DISTINCT FROM v_refund.id::text OR v_journal.occurred_at IS DISTINCT FROM v_refund.created_at
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=p_transaction_id AND account='buyer_funds_liability' AND side='debit')
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=p_transaction_id AND account='refund_payable' AND side='credit')
  THEN RAISE EXCEPTION 'Recovery queue moves only original liability to refund payable, never outgoing cash' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_bank FROM app.local_recovery_event WHERE id::text=v_journal.effect_reference;
  SELECT * INTO v_operation FROM app.local_recovery_operation WHERE id=v_bank.operation_id;
  SELECT * INTO v_result FROM app.recovery_event_result WHERE event_id=v_bank.id;
  SELECT job.* INTO v_job FROM app.recovery_provider_event registered JOIN app.outbox_job job ON job.id=registered.callback_job_id WHERE registered.id=v_bank.id;
  IF v_refund.cash_transaction_id IS DISTINCT FROM v_journal.id OR v_refund.status<>'succeeded' OR v_journal.source<>'local.recovery.bank'
     OR v_bank.id IS NULL OR v_bank.status<>'succeeded' OR v_bank.amount<>v_refund.amount OR v_bank.occurred_at IS DISTINCT FROM v_journal.occurred_at
     OR v_operation.id IS NULL OR v_operation.id IS DISTINCT FROM v_refund.current_operation_id OR v_operation.refund_id IS DISTINCT FROM v_refund.id
     OR v_operation.source_transaction_id IS DISTINCT FROM v_refund.source_transaction_id OR v_operation.amount<>v_refund.amount
     OR v_result.event_id IS NULL OR v_result.refund_id IS DISTINCT FROM v_refund.id OR v_result.cash_transaction_id IS DISTINCT FROM v_journal.id OR v_result.outcome<>'confirmed'
     OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.callback' OR v_job.status<>'completed'
     OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_bank.id,'refund_id',v_refund.id,'outcome',v_result.outcome,'version',v_result.revision)
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=p_transaction_id AND account='refund_payable' AND side='debit')
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=p_transaction_id AND account='company_cash' AND side='credit')
  THEN RAISE EXCEPTION 'Outgoing recovery money requires its actual original bank result and exact atomically completed callback' USING ERRCODE='23514'; END IF;
 END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_refund_money() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
 IF TG_TABLE_NAME='finance_posting' THEN v_id:=NEW.transaction_id; ELSE v_id:=NEW.id; END IF;
 PERFORM app.assert_recovery_refund_money(v_id);RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_transaction_sealed AFTER INSERT ON app.finance_transaction
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind IN ('recovery_obligation','recovery_cash')) EXECUTE FUNCTION app.seal_recovery_refund_money();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_posting_sealed AFTER INSERT ON app.finance_posting
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_recovery_refund_money();
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_refund(p_refund_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_event app.recovery_refund_event; v_first app.recovery_refund_event; v_operation app.exception_operation;
 v_count integer; v_amount numeric; v_expected jsonb; v_actual jsonb; v_job app.outbox_job;
 v_request app.local_recovery_operation; v_bank app.local_recovery_event; v_result app.recovery_event_result;
 v_case_event app.exception_event; v_intent app.recovery_adjustment_intent; v_receipt app.economic_receipt;
 v_cumulative numeric; v_history integer; v_confirmed integer; v_case app.commerce_exception; v_complete boolean;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=p_refund_id FOR UPDATE;
 SELECT * INTO v_event FROM app.recovery_refund_event WHERE refund_id=p_refund_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO v_first FROM app.recovery_refund_event WHERE refund_id=p_refund_id AND revision=1;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=v_refund.operation_id;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_refund.exception_id;
 SELECT count(*)>0 AND bool_and(status='succeeded') INTO v_complete FROM app.recovery_refund WHERE exception_id=v_refund.exception_id;
 IF v_refund.id IS NULL OR v_event.id IS NULL OR v_first.id IS NULL OR v_first.kind<>'queue' OR v_first.source_kind<>'operation'
    OR v_first.source_id IS DISTINCT FROM v_operation.id OR v_operation.action<>'refund_queue' OR v_operation.response='{}'::jsonb
    OR v_operation.exception_id IS DISTINCT FROM v_refund.exception_id OR v_first.occurred_at IS DISTINCT FROM v_refund.created_at
    OR v_case.id IS NULL OR (v_complete AND v_case.status<>'resolved') OR (NOT v_complete AND v_case.status NOT IN ('refunding','unknown'))
    OR v_event.revision IS DISTINCT FROM v_refund.revision OR (SELECT count(*) FROM app.recovery_refund_event WHERE refund_id=p_refund_id)<>v_refund.revision
    OR (v_event.status,v_event.job_id,v_event.provider_operation_id,v_event.destination_source_id,v_event.cash_transaction_id)
       IS DISTINCT FROM (v_refund.status,v_refund.current_job_id,v_refund.current_operation_id,v_refund.destination_source_id,v_refund.cash_transaction_id)
 THEN RAISE EXCEPTION 'Recovery refund seals contiguous exact original-source history and its finalized finance command' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund_source(v_refund);
 SELECT count(*),sum(amount::numeric) INTO v_count,v_amount FROM app.recovery_refund_allocation WHERE refund_id=p_refund_id;
 IF v_count NOT BETWEEN 1 AND 100 OR v_amount IS DISTINCT FROM v_refund.amount::numeric
 THEN RAISE EXCEPTION 'Recovery allocation retains every and only full obligated rupiah' USING ERRCODE='23514'; END IF;
 IF v_refund.basis_kind='purchased_units' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_array(exception_unit_id,fulfillment_item_id,receipt_id,purchase_event_id,merchandise_amount,buyer_shipping,amount) ORDER BY exception_unit_id),'[]'::jsonb)
   INTO v_expected FROM app.recovery_refund_eligible_units(v_refund.exception_id) eligible WHERE eligible.receipt_id=v_refund.receipt_id;
  SELECT coalesce(jsonb_agg(jsonb_build_array(exception_unit_id,fulfillment_item_id,receipt_id,purchase_event_id,merchandise_amount,buyer_shipping,amount) ORDER BY exception_unit_id),'[]'::jsonb)
   INTO v_actual FROM app.recovery_refund_allocation WHERE refund_id=p_refund_id;
  IF v_actual IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Recovery queue groups every exact accepted funded unit under its one original receipt' USING ERRCODE='23514'; END IF;
 ELSIF v_count<>1 OR v_refund.amount<>v_refund.source_amount THEN
  RAISE EXCEPTION 'Unallocated recovery keeps one complete original money allocation' USING ERRCODE='23514';
 END IF;
 IF v_refund.current_job_id IS NOT NULL THEN
  SELECT * INTO v_job FROM app.outbox_job WHERE id=v_refund.current_job_id;
  IF v_job.id IS NULL OR v_job.kind<>'recovery.refund.create'
     OR jsonb_typeof(v_job.payload->'attempt') IS DISTINCT FROM 'number' OR v_job.payload->>'attempt'!~'^[1-9][0-9]{0,9}$'
     OR (v_job.payload->>'attempt')::bigint>2147483647
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',(v_job.payload->>'attempt')::integer)
     OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-create:'||v_refund.id::text||':'||(v_job.payload->>'attempt')
  THEN RAISE EXCEPTION 'Recovery creation retains its exact original refund and bounded attempt intent' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_request FROM app.local_recovery_operation WHERE creation_job_id=v_job.id;
  IF v_refund.current_operation_id IS DISTINCT FROM v_request.id
     OR (v_job.status='completed' AND (v_request.id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('operation_id',v_request.id)))
     OR (v_job.status='failed' AND v_request.id IS NOT NULL)
     OR (v_refund.status='queued' AND v_request.id IS NOT NULL)
     OR (v_refund.status IN ('processing','unknown','succeeded','failed') AND v_request.id IS NULL)
  THEN RAISE EXCEPTION 'Recovery retains the actual committed original bank request or an unprepared source-absent intent' USING ERRCODE='23514'; END IF;
  IF v_request.id IS NOT NULL THEN PERFORM app.assert_recovery_request(v_request.id); END IF;
 ELSIF v_refund.status<>'awaiting_destination' OR v_refund.source_kind<>'cod_event' OR v_refund.destination_source_id IS NOT NULL
    OR v_refund.current_operation_id IS NOT NULL OR v_refund.cash_transaction_id IS NOT NULL
 THEN RAISE EXCEPTION 'Only an unverified original COD recipient can lack its creation job and bank request' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO v_confirmed FROM app.recovery_event_result WHERE refund_id=p_refund_id AND outcome='confirmed';
 IF v_confirmed<>(CASE WHEN v_refund.status='succeeded' THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'Original recovery money confirms once, separately from all failed request history' USING ERRCODE='23514'; END IF;
 FOR v_event IN SELECT * FROM app.recovery_refund_event WHERE refund_id=p_refund_id AND source_kind='provider' ORDER BY revision LOOP
  SELECT * INTO v_bank FROM app.local_recovery_event WHERE id=v_event.source_id;
  SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=v_bank.operation_id;
  SELECT * INTO v_result FROM app.recovery_event_result WHERE event_id=v_bank.id;
  SELECT * INTO v_case_event FROM app.exception_event WHERE id=v_result.exception_event_id;
  SELECT job.* INTO v_job FROM app.recovery_provider_event registered JOIN app.outbox_job job ON job.id=registered.callback_job_id WHERE registered.id=v_bank.id;
  IF v_bank.id IS NULL OR v_request.id IS NULL OR v_request.refund_id IS DISTINCT FROM v_refund.id
     OR v_result.event_id IS NULL OR v_case_event.id IS NULL OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.callback'
     OR v_job.status<>'completed' OR v_job.completed_at IS NULL OR v_job.last_error IS NOT NULL
     OR (v_result.refund_id,v_result.revision,v_result.refund_event_id,v_result.cash_transaction_id)
       IS DISTINCT FROM (v_refund.id,v_event.revision,v_event.id,v_event.cash_transaction_id)
     OR v_result.outcome IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirmed' ELSE 'failed' END)
     OR v_event.status IS DISTINCT FROM v_bank.status OR v_event.provider_operation_id IS DISTINCT FROM v_request.id
     OR v_event.job_id IS DISTINCT FROM v_request.creation_job_id OR v_event.destination_source_id IS DISTINCT FROM v_request.destination_source_id
     OR v_event.kind IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirm' ELSE 'fail' END)
     OR v_event.occurred_at<v_bank.occurred_at OR v_bank.occurred_at<v_request.created_at
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_bank.id) OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-callback:'||v_bank.id::text
     OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_bank.id,'refund_id',v_refund.id,'outcome',v_result.outcome,'version',v_event.revision)
     OR v_case_event.exception_id IS DISTINCT FROM v_refund.exception_id OR v_case_event.source_kind<>'refund' OR v_case_event.source_id IS DISTINCT FROM v_event.id
     OR v_case_event.kind IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'refund_confirmed' ELSE 'refund_failed' END)
     OR v_case_event.occurred_at IS DISTINCT FROM v_event.occurred_at OR v_case_event.actor_id IS NOT NULL
  THEN RAISE EXCEPTION 'Every recovery callback retains its exact immutable historical result, original bank time and atomically completed job' USING ERRCODE='23514'; END IF;
  PERFORM app.assert_recovery_request(v_request.id);
 END LOOP;
 IF v_refund.status='succeeded' THEN
  IF (SELECT count(*) FROM app.recovery_adjustment_intent WHERE refund_id=p_refund_id)
      IS DISTINCT FROM (CASE WHEN v_refund.basis_kind='purchased_units' THEN 1 ELSE 0 END)
  THEN RAISE EXCEPTION 'Successful purchased compensation retains one original receipt adjustment; unallocated money invents none' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM app.recovery_adjustment_intent WHERE refund_id=p_refund_id) OR v_refund.cash_transaction_id IS NOT NULL
  THEN RAISE EXCEPTION 'Unconfirmed recovery retains no outgoing cash or successful receipt adjustment' USING ERRCODE='23514'; END IF;
 END IF;
 FOR v_intent IN SELECT * FROM app.recovery_adjustment_intent WHERE refund_id=p_refund_id LOOP
  SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=v_intent.receipt_id;
  SELECT * INTO v_bank FROM app.local_recovery_event WHERE operation_id=v_refund.current_operation_id;
  SELECT coalesce(sum(merchandise_refunded),0),count(*) INTO v_cumulative,v_history FROM (
   SELECT merchandise_refunded,sequence FROM app.refund_adjustment_intent WHERE receipt_id=v_intent.receipt_id
   UNION ALL SELECT merchandise_refunded,sequence FROM app.recovery_adjustment_intent WHERE receipt_id=v_intent.receipt_id
  ) history WHERE sequence<=v_intent.sequence;
  IF v_intent.receipt_id IS DISTINCT FROM v_refund.receipt_id OR v_intent.sequence<>v_history
     OR v_intent.retained_merchandise::numeric IS DISTINCT FROM v_receipt.merchandise_amount::numeric-v_cumulative
     OR v_intent.merchandise_refunded::numeric IS DISTINCT FROM (SELECT sum(merchandise_amount::numeric) FROM app.recovery_refund_allocation WHERE refund_id=p_refund_id)
     OR v_intent.original_occurred_at IS DISTINCT FROM v_receipt.occurred_at OR v_intent.confirmed_at IS DISTINCT FROM v_bank.occurred_at
  THEN RAISE EXCEPTION 'Recovery adjustment history retains its original increment and shared sequence-specific merchandise value' USING ERRCODE='23514'; END IF;
 END LOOP;
 PERFORM app.assert_recovery_refund_money(v_refund.obligation_transaction_id);
 IF v_refund.cash_transaction_id IS NOT NULL THEN PERFORM app.assert_recovery_refund_money(v_refund.cash_transaction_id); END IF;
 PERFORM app.assert_recovery_return_effects(v_refund.id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
 IF TG_TABLE_NAME='recovery_refund' THEN v_id:=NEW.id;ELSE v_id:=NEW.refund_id;END IF;
 PERFORM app.assert_recovery_refund(v_id);RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_refund_sealed AFTER INSERT OR UPDATE ON app.recovery_refund
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_recovery_refund();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_refund_event_sealed AFTER INSERT ON app.recovery_refund_event
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_recovery_refund();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_refund_allocation_sealed AFTER INSERT ON app.recovery_refund_allocation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_recovery_refund();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_queue_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id FOR UPDATE;
 IF v_case.status IS DISTINCT FROM 'ready_for_refund' OR NEW.subject_id IS DISTINCT FROM v_case.id
    OR NOT (NEW.input ?& ARRAY['expected_version','reason']) OR (NEW.input-ARRAY['expected_version','reason'])<>'{}'::jsonb
    OR jsonb_typeof(NEW.input->'expected_version') IS DISTINCT FROM 'number' OR NEW.input->>'expected_version'!~'^[1-9][0-9]{0,9}$'
    OR (NEW.input->>'expected_version')::bigint<>v_case.revision OR v_case.proposal_event_id IS NULL
    OR jsonb_typeof(NEW.input->'reason') IS DISTINCT FROM 'string' OR char_length(NEW.input->>'reason') NOT BETWEEN 1 AND 500
    OR NEW.input->>'reason' IS DISTINCT FROM btrim(NEW.input->>'reason')
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE exception_id=v_case.id)
    OR NOT EXISTS(SELECT 1 FROM app.exception_event applied JOIN app.exception_event proposal ON proposal.id=v_case.proposal_event_id
      WHERE applied.exception_id=v_case.id AND applied.revision=v_case.revision AND applied.kind IN ('cancel','source_reconciled') AND applied.status='ready_for_refund'
       AND applied.snapshot->'application'->>'proposal_id'=proposal.id::text AND proposal.exception_id=v_case.id AND proposal.kind='propose'
       AND proposal.snapshot->'proposal'->>'action' IN ('cancel_affected_units','refund_original_entitlement'))
 THEN RAISE EXCEPTION 'Finance queue retains exact normalized current consent and completed operational application' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_queue_operation_guard BEFORE INSERT ON app.exception_operation
 FOR EACH ROW WHEN (NEW.action='refund_queue') EXECUTE FUNCTION app.guard_recovery_queue_operation();
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_queue(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_event app.exception_event; v_count integer; v_expected integer; v_refund app.recovery_refund; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id;
 SELECT * INTO v_event FROM app.exception_event WHERE exception_id=v_case.id AND source_kind='operation' AND source_id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.action<>'refund_queue' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
    OR v_event.id IS NULL OR (SELECT count(*) FROM app.exception_event WHERE source_kind='operation' AND source_id=p_operation_id)<>1
    OR v_event.kind<>'refund_queue' OR v_event.status<>'refunding' OR v_event.actor_id IS DISTINCT FROM v_operation.actor_id
    OR v_event.revision::bigint<>(v_operation.input->>'expected_version')::bigint+1 OR v_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR v_event.reason IS DISTINCT FROM v_operation.input->>'reason' OR v_case.revision IS DISTINCT FROM v_event.revision OR v_case.status<>'refunding'
    OR v_operation.response IS DISTINCT FROM app.recovery_refund_batch_projection(v_case.id)
 THEN RAISE EXCEPTION 'Finance queues one atomically finalized original-source batch and exact current response' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_count FROM app.recovery_refund WHERE operation_id=p_operation_id;
 IF v_case.kind='unallocated_collection' THEN v_expected:=1;
 ELSE SELECT count(DISTINCT transaction_id) INTO v_expected FROM app.recovery_refund_eligible_units(v_case.id); END IF;
 IF v_count NOT BETWEEN 1 AND 100 OR v_count<>v_expected
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE exception_id=v_case.id AND operation_id<>p_operation_id)
    OR EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.exception_goods_intake WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.stock_movement WHERE source_ref LIKE 'exception-release:'||p_operation_id::text||':%' OR source_ref='exception-loss:'||p_operation_id::text)
 THEN RAISE EXCEPTION 'Finance batch owns every exact source group without operational stock, intake or cancellation effects' USING ERRCODE='23514'; END IF;
 FOR v_refund IN SELECT * FROM app.recovery_refund WHERE operation_id=p_operation_id ORDER BY source_transaction_id LOOP
  PERFORM app.assert_recovery_refund(v_refund.id);
  IF v_refund.revision<>1 OR v_refund.current_operation_id IS NOT NULL OR v_refund.cash_transaction_id IS NOT NULL OR v_refund.destination_source_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM app.local_recovery_operation WHERE refund_id=v_refund.id)
  THEN RAISE EXCEPTION 'Queue records no bank request, recipient acceptance or outgoing transfer' USING ERRCODE='23514'; END IF;
  IF v_refund.current_job_id IS NOT NULL THEN
   SELECT * INTO v_job FROM app.outbox_job WHERE id=v_refund.current_job_id;
   IF v_job.status<>'pending' OR v_job.attempts<>0 OR v_job.max_attempts<>5 OR v_job.lease_token IS NOT NULL OR v_job.dispatched_at IS NOT NULL
      OR v_job.completed_at IS NOT NULL OR v_job.result IS NOT NULL OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',1)
   THEN RAISE EXCEPTION 'Initial prepaid recovery owns exactly one fresh persisted creation intent' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_recovery_queue(NEW.id);RETURN NULL;END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_queue_sealed AFTER INSERT OR UPDATE ON app.exception_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.action='refund_queue') EXECUTE FUNCTION app.seal_recovery_queue();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_creation_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original recovery creation jobs are retained' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
    OR NEW.attempts<OLD.attempts OR (OLD.status IN ('completed','failed') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
    OR (OLD.status='unknown' AND NEW.status='pending')
    OR (NEW.status IN ('pending','failed') AND EXISTS(SELECT 1 FROM app.local_recovery_operation WHERE creation_job_id=OLD.id))
 THEN RAISE EXCEPTION 'Recovery creation keeps original intent, attempts and terminal history' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_creation_job_guard BEFORE UPDATE ON app.outbox_job
 FOR EACH ROW WHEN (OLD.kind='recovery.refund.create' OR NEW.kind='recovery.refund.create') EXECUTE FUNCTION app.guard_recovery_creation_job();
--> statement-breakpoint
CREATE TRIGGER recovery_creation_job_retained BEFORE DELETE ON app.outbox_job
 FOR EACH ROW WHEN (OLD.kind='recovery.refund.create') EXECUTE FUNCTION app.guard_recovery_creation_job();
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_creation_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id::text=NEW.payload->>'refundId';
 IF v_refund.id IS NULL OR v_refund.current_job_id IS DISTINCT FROM NEW.id
 THEN RAISE EXCEPTION 'A recovery creation job belongs to its exact persisted original obligation' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund(v_refund.id);RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_creation_job_sealed AFTER INSERT OR UPDATE ON app.outbox_job
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='recovery.refund.create') EXECUTE FUNCTION app.seal_recovery_creation_job();

--> statement-breakpoint
-- A recipient source is a separately committed local effect. Accepting that
-- exact source does not acknowledge a bank request or debit company cash.
CREATE FUNCTION app.guard_local_recovery_destination() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_order app.commerce_order;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id FOR UPDATE;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id FOR UPDATE;
 IF v_refund.id IS NULL OR v_order.id IS NULL OR v_order.payment_method<>'cod' OR v_refund.status<>'awaiting_destination'
    OR v_refund.destination_source_id IS NOT NULL OR v_refund.current_job_id IS NOT NULL OR v_refund.current_operation_id IS NOT NULL OR v_refund.cash_transaction_id IS NOT NULL
    OR NEW.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR NEW.buyer_scope IS DISTINCT FROM (CASE WHEN v_order.owner_user_id IS NOT NULL THEN 'user:'||v_order.owner_user_id ELSE 'guest:'||v_order.owner_guest_id::text END)
    OR NEW.occurred_at<v_refund.created_at OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace)
    OR EXISTS(SELECT 1 FROM app.local_recovery_destination WHERE refund_id=v_refund.id)
 THEN RAISE EXCEPTION 'Independent recovery recipient source retains one original unpaid COD obligation and its actual owning buyer' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_recovery_destination_guard BEFORE INSERT ON app.local_recovery_destination
 FOR EACH ROW EXECUTE FUNCTION app.guard_local_recovery_destination();
--> statement-breakpoint
CREATE TRIGGER local_recovery_destination_immutable BEFORE UPDATE OR DELETE ON app.local_recovery_destination
 FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_destination_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_refund app.recovery_refund; v_order app.commerce_order;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id FOR UPDATE;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.subject_id AND exception_id=v_case.id FOR UPDATE;
 IF v_case.id IS NULL OR v_case.status<>'refunding' OR v_refund.id IS NULL OR v_refund.order_id IS DISTINCT FROM v_order.id
    OR v_order.payment_method<>'cod' OR v_refund.status<>'awaiting_destination' OR v_refund.destination_source_id IS NOT NULL
    OR v_refund.current_job_id IS NOT NULL OR v_refund.current_operation_id IS NOT NULL OR v_refund.cash_transaction_id IS NOT NULL
    OR NOT (NEW.input ?& ARRAY['exception_id','expected_version','action','refund_id','destination_source_id'])
    OR (NEW.input-ARRAY['exception_id','expected_version','action','refund_id','destination_source_id'])<>'{}'::jsonb
    OR jsonb_typeof(NEW.input->'expected_version') IS DISTINCT FROM 'number' OR NEW.input->>'expected_version'!~'^[1-9][0-9]{0,9}$'
    OR (NEW.input->>'expected_version')::bigint<>v_case.revision
    OR jsonb_typeof(NEW.input->'exception_id') IS DISTINCT FROM 'string' OR NEW.input->>'exception_id' IS DISTINCT FROM v_case.id::text
    OR jsonb_typeof(NEW.input->'refund_id') IS DISTINCT FROM 'string' OR NEW.input->>'refund_id' IS DISTINCT FROM v_refund.id::text
    OR jsonb_typeof(NEW.input->'action') IS DISTINCT FROM 'string' OR NEW.input->>'action' IS DISTINCT FROM 'accept_destination'
    OR jsonb_typeof(NEW.input->'destination_source_id') IS DISTINCT FROM 'string'
    OR NOT EXISTS(SELECT 1 FROM app.local_recovery_destination destination WHERE destination.id::text=NEW.input->>'destination_source_id'
      AND destination.refund_id=v_refund.id AND destination.environment=(CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
      AND destination.buyer_scope=(CASE WHEN v_order.owner_user_id IS NOT NULL THEN 'user:'||v_order.owner_user_id ELSE 'guest:'||v_order.owner_guest_id::text END)
      AND destination.occurred_at>=v_refund.created_at AND destination.occurred_at<=app.reservation_clock(v_order.clock_namespace))
 THEN RAISE EXCEPTION 'Buyer recipient acceptance retains the exact current case revision, original obligation and independently verified source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_destination_operation_guard BEFORE INSERT ON app.exception_operation
 FOR EACH ROW WHEN (NEW.action='destination') EXECUTE FUNCTION app.guard_recovery_destination_operation();
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_destination_operation(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_refund app.recovery_refund;
 v_event app.recovery_refund_event; v_case_event app.exception_event; v_previous app.exception_event; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.action<>'destination' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Recovery destination acceptance atomically finalizes its exact new buyer operation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id;
 SELECT * INTO v_previous FROM app.exception_event WHERE exception_id=v_case.id AND revision=(v_operation.input->>'expected_version')::integer;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=v_operation.subject_id AND exception_id=v_case.id;
 SELECT * INTO v_event FROM app.recovery_refund_event WHERE refund_id=v_refund.id AND kind='destination' AND source_kind='operation' AND source_id=v_operation.id;
 SELECT * INTO v_case_event FROM app.exception_event WHERE exception_id=v_case.id AND source_kind='operation' AND source_id=v_operation.id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=v_refund.current_job_id;
 IF v_case.id IS NULL OR v_previous.id IS NULL OR v_previous.status<>'refunding' OR v_refund.id IS NULL OR v_event.id IS NULL OR v_case_event.id IS NULL
    OR v_refund.status<>'queued' OR v_refund.revision<>2 OR v_case.status<>'refunding'
    OR v_case.revision::bigint<>(v_operation.input->>'expected_version')::bigint+1
    OR v_case_event.revision IS DISTINCT FROM v_case.revision OR v_case_event.kind<>'source_reconciled' OR v_case_event.status<>'refunding'
    OR v_case_event.actor_id IS DISTINCT FROM v_operation.actor_id OR v_case_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR v_case_event.reason IS DISTINCT FROM v_event.reason OR v_event.reason<>'Original buyer accepted the independently verified recovery recipient'
    OR v_case_event.snapshot->'application' IS DISTINCT FROM 'null'::jsonb OR v_case_event.cause_event_id IS NOT NULL
    OR v_case_event.snapshot->'units' IS DISTINCT FROM v_previous.snapshot->'units'
    OR v_case.proposal_event_id::text IS DISTINCT FROM v_previous.snapshot->>'proposal_event_id'
    OR (SELECT count(*) FROM app.exception_event WHERE source_kind='operation' AND source_id=v_operation.id)<>1
    OR (SELECT count(*) FROM app.recovery_refund_event WHERE source_kind='operation' AND source_id=v_operation.id)<>1
    OR v_event.revision IS DISTINCT FROM v_refund.revision OR v_event.job_id IS DISTINCT FROM v_refund.current_job_id
    OR v_event.destination_source_id IS DISTINCT FROM v_refund.destination_source_id
    OR v_refund.destination_source_id::text IS DISTINCT FROM v_operation.input->>'destination_source_id'
    OR v_refund.current_operation_id IS NOT NULL OR v_refund.cash_transaction_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM app.local_recovery_operation WHERE refund_id=v_refund.id)
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.exception_goods_intake WHERE operation_id=v_operation.id)
    OR EXISTS(SELECT 1 FROM app.stock_movement WHERE source_ref LIKE 'exception-release:'||v_operation.id::text||':%' OR source_ref='exception-loss:'||v_operation.id::text)
    OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.create' OR v_job.status<>'pending' OR v_job.attempts<>0 OR v_job.max_attempts<>5
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',1)
    OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-create:'||v_refund.id::text||':1'
    OR v_job.lease_token IS NOT NULL OR v_job.lease_until IS NOT NULL OR v_job.dispatched_at IS NOT NULL
    OR v_job.completed_at IS NOT NULL OR v_job.result IS NOT NULL OR v_job.last_error IS NOT NULL
    OR v_operation.response IS DISTINCT FROM app.exception_projection(v_case.id,true)
 THEN RAISE EXCEPTION 'Buyer destination acceptance changes only its exact verified recipient, first unsent job and closed safe case response' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund(v_refund.id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_destination_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_recovery_destination_operation(NEW.id);RETURN NULL;END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_destination_operation_sealed AFTER INSERT OR UPDATE ON app.exception_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.action='destination') EXECUTE FUNCTION app.seal_recovery_destination_operation();

--> statement-breakpoint
-- Canonical owned protocol tuples contain only typed IDs, bounded integers,
-- closed rails/references and the constrained namespace: no string has a
-- comma or space. Remove only jsonb's comma separators to match JSON.stringify.
CREATE FUNCTION app.recovery_request_payload_hash(p_request app.local_recovery_operation) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(replace(jsonb_build_array('99ribu-recovery-refund-request-v1',
  (p_request).environment,(p_request).refund_id,(p_request).creation_job_id,(p_request).attempt,(p_request).rail,
  (p_request).original_payment_operation_id,(p_request).destination_source_id,(p_request).source_transaction_id,
  (p_request).amount,(p_request).clock_namespace)::text,', ',','),'UTF8')),'hex');
$$;
--> statement-breakpoint
CREATE FUNCTION app.recovery_bank_payload_hash(p_event_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(replace(jsonb_build_array('99ribu-recovery-refund-simulator-v1','company_bank_debit',
  operation.environment,event.id,operation.id,operation.refund_id,operation.rail,operation.original_payment_operation_id,
  operation.destination_source_id,operation.source_transaction_id,operation.amount,event.status,event.amount,'IDR',
  operation.clock_namespace,event.bank_reference,to_char(event.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text,', ',','),'UTF8')),'hex')
 FROM app.local_recovery_event event JOIN app.local_recovery_operation operation ON operation.id=event.operation_id WHERE event.id=p_event_id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_provider_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_order app.commerce_order; v_case app.commerce_exception;
 v_job app.outbox_job; v_destination app.local_recovery_destination; v_original_operation uuid; v_attempt bigint; v_previous_at timestamptz; v_now timestamptz;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id FOR UPDATE;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_refund.exception_id FOR UPDATE;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id FOR UPDATE;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.creation_job_id FOR SHARE;
 SELECT coalesce(max(attempt),0)::bigint INTO v_attempt FROM app.local_recovery_operation WHERE refund_id=NEW.refund_id;
 SELECT occurred_at INTO v_previous_at FROM app.recovery_refund_event WHERE refund_id=NEW.refund_id ORDER BY revision DESC LIMIT 1;
 v_now:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
 IF v_refund.id IS NULL OR v_order.id IS NULL OR v_case.id IS NULL OR v_case.order_id IS DISTINCT FROM v_order.id
    OR v_case.status NOT IN ('refunding','unknown') OR v_refund.status<>'queued' OR v_refund.current_operation_id IS NOT NULL
    OR v_refund.cash_transaction_id IS NOT NULL OR v_refund.current_job_id IS DISTINCT FROM v_job.id
    OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.create' OR v_job.status<>'processing' OR v_job.lease_token IS NULL
    OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL
    OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-create:'||v_refund.id::text||':'||NEW.attempt::text
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',NEW.attempt)
    OR NEW.attempt::bigint<=v_attempt OR NEW.amount IS DISTINCT FROM v_refund.amount OR NEW.source_transaction_id IS DISTINCT FROM v_refund.source_transaction_id
    OR NEW.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR NEW.clock_namespace IS DISTINCT FROM v_order.clock_namespace OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id
    OR NEW.request_hash IS DISTINCT FROM app.recovery_request_payload_hash(NEW)
    OR v_previous_at IS NULL OR NEW.created_at<v_previous_at OR NEW.created_at>v_now
    OR NEW.created_at IS DISTINCT FROM date_trunc('milliseconds',NEW.created_at)
    OR (v_order.clock_namespace IS NULL AND NEW.created_at<date_trunc('milliseconds',transaction_timestamp()))
    OR (v_order.clock_namespace IS NOT NULL AND NEW.created_at IS DISTINCT FROM v_now)
 THEN RAISE EXCEPTION 'Recovery request retains one exact original-source amount, current case and freshly fenced creation intent' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund_source(v_refund);
 IF v_order.payment_method='prepaid' THEN
  SELECT operation_id INTO v_original_operation FROM app.local_payment_event WHERE id=v_refund.source_id AND status='confirmed';
  IF NEW.rail<>'prepaid_original' OR v_original_operation IS NULL OR NEW.original_payment_operation_id IS DISTINCT FROM v_original_operation OR NEW.destination_source_id IS NOT NULL
  THEN RAISE EXCEPTION 'Prepaid compensation follows only the authenticated original collected payer operation' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_destination FROM app.local_recovery_destination WHERE id=NEW.destination_source_id;
  IF NEW.rail<>'cod_verified_destination' OR NEW.original_payment_operation_id IS NOT NULL OR v_destination.id IS NULL
     OR v_destination.refund_id IS DISTINCT FROM v_refund.id OR v_destination.environment IS DISTINCT FROM NEW.environment
     OR v_destination.buyer_scope IS DISTINCT FROM (CASE WHEN v_order.owner_user_id IS NOT NULL THEN 'user:'||v_order.owner_user_id ELSE 'guest:'||v_order.owner_guest_id::text END)
     OR v_destination.occurred_at<v_refund.created_at OR v_destination.occurred_at>app.reservation_clock(v_order.clock_namespace)
  THEN RAISE EXCEPTION 'COD compensation retains the original buyer accepted independently verified recipient' USING ERRCODE='23514'; END IF;
 END IF;
 -- The application selected this domain time inside this same transaction.
 -- Preserve it across the subsequent event/case writes; recorded_at is native.
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_provider_operation_guard BEFORE INSERT ON app.local_recovery_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_provider_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_bank_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_request app.local_recovery_operation; v_refund app.recovery_refund; v_order app.commerce_order;
BEGIN
 SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=NEW.operation_id;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=v_request.refund_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id FOR UPDATE;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=v_request.refund_id FOR UPDATE;
 IF v_request.id IS NULL OR v_refund.id IS NULL OR v_order.id IS NULL
    OR v_refund.current_operation_id IS DISTINCT FROM v_request.id OR v_refund.current_job_id IS DISTINCT FROM v_request.creation_job_id
    OR v_refund.status NOT IN ('processing','unknown') OR v_refund.cash_transaction_id IS NOT NULL
    OR v_request.source_transaction_id IS DISTINCT FROM v_refund.source_transaction_id OR v_request.amount<>v_refund.amount
    OR v_request.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR v_request.clock_namespace IS DISTINCT FROM v_order.clock_namespace OR v_request.destination_source_id IS DISTINCT FROM v_refund.destination_source_id
    OR (NEW.status='succeeded' AND NEW.amount IS DISTINCT FROM v_request.amount) OR (NEW.status='failed' AND NEW.amount<>0)
    OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',NEW.occurred_at)
    OR NEW.occurred_at<v_request.created_at OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace)
 THEN RAISE EXCEPTION 'Recovery bank source preserves the exact committed request and full debit or zero-money rejection at its original signed time' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund_source(v_refund);
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_bank_source_guard BEFORE INSERT ON app.local_recovery_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_bank_source();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_bank app.local_recovery_event; v_request app.local_recovery_operation; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_bank FROM app.local_recovery_event WHERE id=NEW.id;
 SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=v_bank.operation_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.callback_job_id;
 IF v_bank.id IS NULL OR v_request.id IS NULL OR NEW.refund_id IS DISTINCT FROM v_request.refund_id
    OR NEW.payload_hash IS DISTINCT FROM app.recovery_bank_payload_hash(NEW.id)
    OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.callback' OR v_job.status<>'pending' OR v_job.attempts<>0 OR v_job.max_attempts<>5
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',NEW.id) OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-callback:'||NEW.id::text
    OR v_job.lease_token IS NOT NULL OR v_job.lease_until IS NOT NULL OR v_job.dispatched_at IS NOT NULL
    OR v_job.completed_at IS NOT NULL OR v_job.result IS NOT NULL OR v_job.last_error IS NOT NULL
 THEN RAISE EXCEPTION 'Recovery registration preserves its exact signed original bank tuple and one initially unsent callback job' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_provider_event_guard BEFORE INSERT ON app.recovery_provider_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_provider_event();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_exception_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_refund app.recovery_refund; v_refund_event app.recovery_refund_event; v_complete boolean;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=NEW.exception_id;
 SELECT * INTO v_refund_event FROM app.recovery_refund_event WHERE id=NEW.source_id;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=v_refund_event.refund_id;
 SELECT count(*)>0 AND bool_and(status='succeeded') INTO v_complete FROM app.recovery_refund WHERE exception_id=NEW.exception_id;
 IF v_case.id IS NULL OR v_case.status NOT IN ('refunding','unknown') OR NEW.source_kind<>'refund' OR v_refund_event.id IS NULL
    OR v_refund_event.source_kind<>'provider' OR v_refund_event.kind NOT IN ('confirm','fail')
    OR v_refund.exception_id IS DISTINCT FROM v_case.id OR v_refund_event.revision IS DISTINCT FROM v_refund.revision
    OR v_refund_event.status IS DISTINCT FROM v_refund.status OR NEW.actor_id IS NOT NULL OR NEW.cause_event_id IS NOT NULL
    OR NEW.kind IS DISTINCT FROM (CASE v_refund_event.kind WHEN 'confirm' THEN 'refund_confirmed' ELSE 'refund_failed' END)
    OR NEW.status IS DISTINCT FROM (CASE WHEN v_complete THEN 'resolved' ELSE 'refunding' END)
    OR NEW.snapshot->'application' IS DISTINCT FROM 'null'::jsonb OR NEW.occurred_at IS DISTINCT FROM v_refund_event.occurred_at
    OR NEW.reason IS DISTINCT FROM (CASE v_refund_event.kind WHEN 'confirm' THEN 'Original outgoing bank effect confirmed for its exact recovery source'
     ELSE 'No outgoing money; original recovery obligation retained for explicit finance follow-up' END)
 THEN RAISE EXCEPTION 'Recovery case outcome applies only its exact new source result and complete actual original-source batch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_exception_event_guard BEFORE INSERT ON app.exception_event
 FOR EACH ROW WHEN (NEW.source_kind='refund' OR NEW.kind IN ('refund_confirmed','refund_failed')) EXECUTE FUNCTION app.guard_recovery_exception_event();
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_registration app.recovery_provider_event; v_bank app.local_recovery_event; v_request app.local_recovery_operation;
 v_event app.recovery_refund_event; v_case_event app.exception_event; v_refund app.recovery_refund; v_job app.outbox_job; v_cash app.finance_transaction;
BEGIN
 SELECT * INTO v_registration FROM app.recovery_provider_event WHERE id=NEW.event_id;
 SELECT * INTO v_bank FROM app.local_recovery_event WHERE id=NEW.event_id;
 SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=v_bank.operation_id;
 SELECT * INTO v_event FROM app.recovery_refund_event WHERE id=NEW.refund_event_id;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id;
 SELECT * INTO v_case_event FROM app.exception_event WHERE id=NEW.exception_event_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=v_registration.callback_job_id;
 SELECT * INTO v_cash FROM app.finance_transaction WHERE id=NEW.cash_transaction_id;
 IF v_registration.id IS NULL OR v_bank.id IS NULL OR v_request.id IS NULL OR v_event.id IS NULL OR v_refund.id IS NULL OR v_case_event.id IS NULL
    OR NEW.refund_id IS DISTINCT FROM v_registration.refund_id OR NEW.refund_id IS DISTINCT FROM v_request.refund_id OR NEW.refund_id IS DISTINCT FROM v_event.refund_id
    OR NEW.revision IS DISTINCT FROM v_event.revision OR v_event.revision IS DISTINCT FROM v_refund.revision
    OR v_event.source_kind<>'provider' OR v_event.source_id IS DISTINCT FROM NEW.event_id
    OR v_case_event.exception_id IS DISTINCT FROM v_refund.exception_id OR v_case_event.source_kind<>'refund' OR v_case_event.source_id IS DISTINCT FROM v_event.id
    OR v_case_event.occurred_at IS DISTINCT FROM v_event.occurred_at OR v_case_event.actor_id IS NOT NULL
    OR NEW.outcome IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirmed' ELSE 'failed' END)
    OR NEW.cash_transaction_id IS DISTINCT FROM v_event.cash_transaction_id OR NEW.cash_transaction_id IS DISTINCT FROM v_refund.cash_transaction_id
    OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.callback' OR v_job.status<>'pending'
    OR (v_bank.status='succeeded' AND (v_cash.id IS NULL OR v_cash.created_xid<>pg_current_xact_id()::text))
    OR (v_bank.status='failed' AND (NEW.cash_transaction_id IS NOT NULL OR v_cash.id IS NOT NULL))
 THEN RAISE EXCEPTION 'Recovery callback atomically binds its exact historical result, source, case application and actual cash effect' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_result_guard BEFORE INSERT ON app.recovery_event_result
 FOR EACH ROW EXECUTE FUNCTION app.guard_recovery_result();
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_request(p_request_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_request app.local_recovery_operation; v_refund app.recovery_refund; v_job app.outbox_job;
 v_event app.recovery_refund_event; v_order app.commerce_order; v_original uuid;
BEGIN
 SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=p_request_id;
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=v_request.refund_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=v_request.creation_job_id;
 SELECT * INTO v_event FROM app.recovery_refund_event WHERE refund_id=v_refund.id AND source_kind='job' AND source_id=v_job.id AND kind='prepare';
 IF v_request.id IS NULL OR v_refund.id IS NULL OR v_order.id IS NULL OR v_job.id IS NULL OR v_event.id IS NULL
    OR v_request.amount IS DISTINCT FROM v_refund.amount OR v_request.source_transaction_id IS DISTINCT FROM v_refund.source_transaction_id
    OR v_request.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR v_request.clock_namespace IS DISTINCT FROM v_order.clock_namespace OR v_request.destination_source_id IS DISTINCT FROM v_refund.destination_source_id
    OR v_request.request_hash IS DISTINCT FROM app.recovery_request_payload_hash(v_request)
    OR v_job.kind<>'recovery.refund.create' OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',v_request.attempt)
    OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-create:'||v_refund.id::text||':'||v_request.attempt::text
    OR v_event.provider_operation_id IS DISTINCT FROM v_request.id OR v_event.job_id IS DISTINCT FROM v_job.id OR v_event.status<>'processing'
    OR v_event.occurred_at IS DISTINCT FROM v_request.created_at OR v_event.destination_source_id IS DISTINCT FROM v_request.destination_source_id OR v_event.cash_transaction_id IS NOT NULL
    OR (v_job.status='completed' AND v_job.result IS DISTINCT FROM jsonb_build_object('operation_id',v_request.id))
    OR v_job.status IN ('pending','failed')
 THEN RAISE EXCEPTION 'Committed recovery request retains its original creation history, source amount, clock, hash and acknowledged or uncertain job' USING ERRCODE='23514'; END IF;
 IF v_order.payment_method='prepaid' THEN
  SELECT operation_id INTO v_original FROM app.local_payment_event WHERE id=v_refund.source_id AND status='confirmed';
  IF v_request.rail<>'prepaid_original' OR v_original IS NULL OR v_request.original_payment_operation_id IS DISTINCT FROM v_original
     OR v_request.destination_source_id IS NOT NULL
  THEN RAISE EXCEPTION 'Historical prepaid recovery retains its original actual payer operation' USING ERRCODE='23514'; END IF;
 ELSIF v_request.rail<>'cod_verified_destination' OR v_request.original_payment_operation_id IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM app.local_recovery_destination destination WHERE destination.id=v_request.destination_source_id
      AND destination.refund_id=v_refund.id AND destination.environment=v_request.environment
      AND destination.buyer_scope=(CASE WHEN v_order.owner_user_id IS NOT NULL THEN 'user:'||v_order.owner_user_id ELSE 'guest:'||v_order.owner_guest_id::text END)
      AND destination.occurred_at>=v_refund.created_at AND destination.occurred_at<=v_request.created_at)
 THEN RAISE EXCEPTION 'Historical COD recovery retains its exact independently verified original buyer recipient' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund_id uuid; v_request_id uuid;
BEGIN
 IF TG_TABLE_NAME='local_recovery_operation' THEN v_request_id:=NEW.id;v_refund_id:=NEW.refund_id;
 ELSIF TG_TABLE_NAME='local_recovery_event' THEN
  v_request_id:=NEW.operation_id;SELECT refund_id INTO v_refund_id FROM app.local_recovery_operation WHERE id=v_request_id;
 ELSE v_refund_id:=NEW.refund_id;
 END IF;
 IF v_request_id IS NOT NULL THEN PERFORM app.assert_recovery_request(v_request_id); END IF;
 IF v_refund_id IS NULL THEN RAISE EXCEPTION 'Recovery source has its actual original obligation' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund(v_refund_id);RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE v_relation text;
BEGIN
 FOREACH v_relation IN ARRAY ARRAY['local_recovery_operation','local_recovery_event','recovery_provider_event','recovery_event_result','recovery_adjustment_intent'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',v_relation||'_immutable',v_relation);
  EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON app.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_recovery_source()',v_relation||'_sealed',v_relation);
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_recovery_callback_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recovery callback jobs and original source history are retained' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
    OR NEW.attempts<OLD.attempts OR (OLD.status IN ('completed','failed') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.status='unknown' AND NEW.status='pending')
 THEN RAISE EXCEPTION 'Recovery callback keeps its original source, attempt history and terminal result; explicit recovery requires its complete owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_callback_job_guard BEFORE UPDATE ON app.outbox_job
 FOR EACH ROW WHEN (OLD.kind='recovery.refund.callback' OR NEW.kind='recovery.refund.callback') EXECUTE FUNCTION app.guard_recovery_callback_job();
--> statement-breakpoint
CREATE TRIGGER recovery_callback_job_retained BEFORE DELETE ON app.outbox_job
 FOR EACH ROW WHEN (OLD.kind='recovery.refund.callback') EXECUTE FUNCTION app.guard_recovery_callback_job();
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_callback_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_registration app.recovery_provider_event; v_result app.recovery_event_result; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.id;
 SELECT * INTO v_registration FROM app.recovery_provider_event WHERE callback_job_id=v_job.id;
 SELECT * INTO v_result FROM app.recovery_event_result WHERE event_id=v_registration.id;
 IF v_registration.id IS NULL OR v_job.kind<>'recovery.refund.callback'
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_registration.id)
    OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-callback:'||v_registration.id::text
    OR (v_job.status='completed' AND (v_result.event_id IS NULL OR v_job.completed_at IS NULL OR v_job.last_error IS NOT NULL
      OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_registration.id,'refund_id',v_result.refund_id,'outcome',v_result.outcome,'version',v_result.revision)))
    OR (v_job.status<>'completed' AND (v_result.event_id IS NOT NULL OR v_job.result IS NOT NULL))
 THEN RAISE EXCEPTION 'Recovery callback completion atomically retains its exact historical source result; failures retain no applied effect' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund(v_registration.refund_id);RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_callback_job_sealed AFTER INSERT OR UPDATE ON app.outbox_job
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='recovery.refund.callback') EXECUTE FUNCTION app.seal_recovery_callback_job();
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_case_money() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund_id uuid;
BEGIN
 SELECT refund_id INTO v_refund_id FROM app.recovery_refund_event WHERE id=NEW.source_id;
 IF NOT EXISTS(SELECT 1 FROM app.recovery_event_result result WHERE result.refund_id=v_refund_id AND result.refund_event_id=NEW.source_id AND result.exception_event_id=NEW.id)
 THEN RAISE EXCEPTION 'Recovery case history cannot commit without its exact original bank callback result' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund(v_refund_id);RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_case_money_sealed AFTER INSERT ON app.exception_event
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.source_kind='refund') EXECUTE FUNCTION app.seal_recovery_case_money();

--> statement-breakpoint
-- Immutable membership remains available after the money case is resolved.
-- One replacement_stock source is one shipment and original return case;
-- null-link original and unallocated compensation have no replacement claims.
CREATE FUNCTION app.recovery_return_items(p_refund_id uuid) RETURNS TABLE(return_item_id uuid,case_id uuid) LANGUAGE sql STABLE AS $$
 SELECT original_claim.id,original_claim.case_id FROM app.recovery_refund_allocation allocation
 JOIN app.recovery_refund refund ON refund.id=allocation.refund_id
 JOIN app.exception_unit unit ON unit.id=allocation.exception_unit_id AND unit.exception_id=refund.exception_id
 JOIN app.replacement_link link ON link.id=unit.replacement_link_id AND link.original_fulfillment_item_id=allocation.fulfillment_item_id
 JOIN app.return_item original_claim ON original_claim.id=link.return_item_id AND original_claim.fulfillment_item_id=allocation.fulfillment_item_id
 JOIN app.exception_cancellation cancellation ON cancellation.exception_unit_id=unit.id AND cancellation.replacement_link_id=link.id
 WHERE allocation.refund_id=p_refund_id ORDER BY original_claim.case_id,original_claim.id;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_return_effects(p_refund_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_confirm app.recovery_refund_event; v_return app.return_event;
 v_expected jsonb; v_actual jsonb; v_cases integer;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=p_refund_id;
 IF v_refund.id IS NULL THEN RAISE EXCEPTION 'Recovery claim consequence retains its original compensation' USING ERRCODE='23514'; END IF;
 IF v_refund.status<>'succeeded' THEN
  IF EXISTS(SELECT 1 FROM app.return_event event JOIN app.recovery_refund_event source ON source.id=event.source_id
     WHERE event.source_kind='recovery' AND source.refund_id=p_refund_id)
  THEN RAISE EXCEPTION 'Unconfirmed recovery cannot consume any original replacement claim' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 SELECT * INTO v_confirm FROM app.recovery_refund_event WHERE refund_id=p_refund_id AND revision=v_refund.revision;
 IF v_confirm.id IS NULL OR v_confirm.kind<>'confirm' OR v_confirm.source_kind<>'provider' OR v_confirm.status<>'succeeded'
    OR v_confirm.cash_transaction_id IS DISTINCT FROM v_refund.cash_transaction_id OR v_refund.cash_transaction_id IS NULL
 THEN RAISE EXCEPTION 'Original claim consumption is backed by its exact successful outgoing recovery money event' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund_money(v_refund.cash_transaction_id);
 SELECT coalesce(jsonb_agg(jsonb_build_array(case_id,return_item_id) ORDER BY case_id,return_item_id),'[]'::jsonb),count(DISTINCT case_id)
  INTO v_expected,v_cases FROM app.recovery_return_items(p_refund_id);
 SELECT coalesce(jsonb_agg(jsonb_build_array(event.case_id,history.return_item_id) ORDER BY event.case_id,history.return_item_id),'[]'::jsonb)
  INTO v_actual FROM app.return_event event JOIN app.return_item_event history ON history.event_id=event.id AND history.case_id=event.case_id
  WHERE event.source_kind='recovery' AND event.source_id=v_confirm.id AND event.kind='refund_confirmed';
 IF v_cases>1 OR v_actual IS DISTINCT FROM v_expected
    OR (SELECT count(*) FROM app.return_event WHERE source_kind='recovery' AND source_id=v_confirm.id)<>v_cases
    OR EXISTS(SELECT 1 FROM app.return_event event JOIN app.recovery_refund_event source ON source.id=event.source_id
      WHERE event.source_kind='recovery' AND source.refund_id=p_refund_id AND source.id<>v_confirm.id)
 THEN RAISE EXCEPTION 'Successful recovery consumes every and only its immutable cancelled replacement claim set' USING ERRCODE='23514'; END IF;
 FOR v_return IN SELECT * FROM app.return_event WHERE source_kind='recovery' AND source_id=v_confirm.id LOOP
  IF v_return.kind<>'refund_confirmed' OR v_return.resolution IS DISTINCT FROM 'replacement' OR v_return.status NOT IN ('replacing','resolved')
     OR v_return.actor_id IS NOT NULL OR v_return.occurred_at IS DISTINCT FROM v_confirm.occurred_at
     OR v_return.reason<>'Original signed recovery cash refunds only the cancelled replacement claims'
     OR NOT EXISTS(SELECT 1 FROM app.return_case original_case WHERE original_case.id=v_return.case_id
       AND original_case.order_id=v_refund.order_id AND original_case.resolution='replacement'
       AND original_case.requires_goods IS NOT DISTINCT FROM v_return.requires_goods)
     OR EXISTS(SELECT 1 FROM app.return_item_event history JOIN app.return_item original ON original.id=history.return_item_id
       WHERE history.event_id=v_return.id AND (original.case_id IS DISTINCT FROM v_return.case_id OR original.claim_state<>'refunded'
        OR history.claim_state<>'refunded' OR history.inspection_status NOT IN ('accepted','waived')
        OR history.inspection_status IS DISTINCT FROM original.inspection_status))
  THEN RAISE EXCEPTION 'Recovery return history preserves its original inspected quantity and actual cash provenance without delivery or release' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_case_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund_id uuid;
BEGIN
 -- Every case writer, including physical intake, preserves outstanding money.
 FOR v_refund_id IN SELECT id FROM app.recovery_refund WHERE exception_id=NEW.id ORDER BY id LOOP
  PERFORM app.assert_recovery_refund(v_refund_id);
 END LOOP;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_case_state_sealed AFTER INSERT OR UPDATE ON app.commerce_exception
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_recovery_case_state();
