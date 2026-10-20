CREATE TABLE "app"."buyer_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_item_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "buyer_receipt_fulfillment_item_id_unique" UNIQUE("fulfillment_item_id")
);
--> statement-breakpoint
CREATE TABLE "app"."local_parcel_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"environment" text NOT NULL,
	"booking_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"clock_namespace" text,
	"unit_ids" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"request_hash" text NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_parcel_receipt_reference_unique" UNIQUE("environment","reference"),
	CONSTRAINT "local_parcel_receipt_value_check" CHECK ("app"."local_parcel_receipt"."environment" IN ('local','test') AND "app"."local_parcel_receipt"."reference" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."local_parcel_receipt"."request_hash" ~ '^[a-f0-9]{64}$' AND "app"."local_parcel_receipt"."signature" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("app"."local_parcel_receipt"."unit_ids")='array' AND jsonb_array_length("app"."local_parcel_receipt"."unit_ids") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "app"."local_refund_destination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"buyer_scope" text NOT NULL,
	"destination_reference" text NOT NULL,
	"signature" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_refund_destination_destination_reference_unique" UNIQUE("destination_reference"),
	CONSTRAINT "local_refund_destination_value_check" CHECK ("app"."local_refund_destination"."environment" IN ('local','test') AND "app"."local_refund_destination"."buyer_scope" ~ '^(user|guest):[A-Za-z0-9_-]{1,100}$' AND "app"."local_refund_destination"."destination_reference" ~ '^synthetic:[0-9a-f-]{36}$' AND "app"."local_refund_destination"."signature" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_refund_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"bank_reference" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_refund_event_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "local_refund_event_bank_reference_unique" UNIQUE("bank_reference"),
	CONSTRAINT "local_refund_event_value_check" CHECK ((("app"."local_refund_event"."status"='succeeded' AND "app"."local_refund_event"."amount" between 1 and 9007199254740991) OR ("app"."local_refund_event"."status"='failed' AND "app"."local_refund_event"."amount"=0)) AND "app"."local_refund_event"."bank_reference" ~ '^LOCAL-REFUND-[A-F0-9]{32}$' AND "app"."local_refund_event"."signature" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_refund_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"creation_job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"environment" text NOT NULL,
	"rail" text NOT NULL,
	"original_payment_operation_id" uuid,
	"destination_source_id" uuid,
	"amount" bigint NOT NULL,
	"clock_namespace" text,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_refund_operation_creation_job_id_unique" UNIQUE("creation_job_id"),
	CONSTRAINT "local_refund_attempt_unique" UNIQUE("refund_id","attempt"),
	CONSTRAINT "local_refund_operation_value_check" CHECK ("app"."local_refund_operation"."attempt">0 AND "app"."local_refund_operation"."environment" IN ('local','test') AND "app"."local_refund_operation"."amount" between 1 and 9007199254740991 AND "app"."local_refund_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND (("app"."local_refund_operation"."rail"='prepaid_original' AND "app"."local_refund_operation"."original_payment_operation_id" IS NOT NULL AND "app"."local_refund_operation"."destination_source_id" IS NULL) OR ("app"."local_refund_operation"."rail"='cod_verified_destination' AND "app"."local_refund_operation"."original_payment_operation_id" IS NULL AND "app"."local_refund_operation"."destination_source_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."parcel_receipt_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "parcel_receipt_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "parcel_receipt_provider_hash_check" CHECK ("app"."parcel_receipt_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."parcel_receipt_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"receipt_count" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "parcel_receipt_result_value_check" CHECK (("app"."parcel_receipt_result"."outcome"='received' AND "app"."parcel_receipt_result"."receipt_count" between 1 and 100) OR ("app"."parcel_receipt_result"."outcome" IN ('duplicate','exception') AND "app"."parcel_receipt_result"."receipt_count"=0)),
	CONSTRAINT "parcel_receipt_result_reason_check" CHECK (char_length("app"."parcel_receipt_result"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"obligation_transaction_id" uuid NOT NULL,
	"cash_transaction_id" uuid,
	"current_job_id" uuid,
	"current_operation_id" uuid,
	"destination_source_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "refund_case_id_unique" UNIQUE("case_id"),
	CONSTRAINT "refund_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "refund_obligation_transaction_id_unique" UNIQUE("obligation_transaction_id"),
	CONSTRAINT "refund_cash_transaction_id_unique" UNIQUE("cash_transaction_id"),
	CONSTRAINT "refund_current_job_id_unique" UNIQUE("current_job_id"),
	CONSTRAINT "refund_value_check" CHECK ("app"."refund"."revision">0 AND "app"."refund"."amount" between 1 and 9007199254740991 AND "app"."refund"."status" IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND (("app"."refund"."status"='succeeded')=("app"."refund"."cash_transaction_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."refund_adjustment_intent" (
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
	CONSTRAINT "refund_adjustment_receipt_unique" UNIQUE("refund_id","receipt_id"),
	CONSTRAINT "refund_adjustment_sequence_unique" UNIQUE("receipt_id","sequence"),
	CONSTRAINT "refund_adjustment_value_check" CHECK ((("app"."refund_adjustment_intent"."purchase_event_id" IS NULL AND "app"."refund_adjustment_intent"."dispatch_reason"='original_purchase_missing') OR ("app"."refund_adjustment_intent"."purchase_event_id" IS NOT NULL AND "app"."refund_adjustment_intent"."dispatch_reason"='pending_adapter')) AND "app"."refund_adjustment_intent"."sequence">0 AND "app"."refund_adjustment_intent"."merchandise_refunded" between 99000 and 9007199254740991 AND "app"."refund_adjustment_intent"."retained_merchandise" between 0 and 9007199254740991 AND "app"."refund_adjustment_intent"."merchandise_refunded"%99000=0 AND "app"."refund_adjustment_intent"."retained_merchandise"%99000=0 AND jsonb_typeof("app"."refund_adjustment_intent"."allocation")='array' AND jsonb_array_length("app"."refund_adjustment_intent"."allocation") between 1 and 100 AND "app"."refund_adjustment_intent"."confirmed_at">="app"."refund_adjustment_intent"."original_occurred_at")
);
--> statement-breakpoint
CREATE TABLE "app"."refund_allocation" (
	"refund_id" uuid NOT NULL,
	"return_item_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_event_id" uuid,
	"merchandise_amount" bigint NOT NULL,
	"buyer_shipping" bigint NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "refund_allocation_refund_id_return_item_id_pk" PRIMARY KEY("refund_id","return_item_id"),
	CONSTRAINT "refund_allocation_return_item_id_unique" UNIQUE("return_item_id"),
	CONSTRAINT "refund_allocation_value_check" CHECK ("app"."refund_allocation"."merchandise_amount"=99000 AND "app"."refund_allocation"."buyer_shipping">=0 AND "app"."refund_allocation"."amount" between 99000 and 9007199254740991 AND "app"."refund_allocation"."amount"::numeric="app"."refund_allocation"."merchandise_amount"::numeric+"app"."refund_allocation"."buyer_shipping"::numeric)
);
--> statement-breakpoint
CREATE TABLE "app"."refund_event" (
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
	CONSTRAINT "refund_event_revision_unique" UNIQUE("refund_id","revision"),
	CONSTRAINT "refund_event_source_unique" UNIQUE("source_kind","source_id","kind"),
	CONSTRAINT "refund_event_value_check" CHECK ("app"."refund_event"."revision">0 AND "app"."refund_event"."kind" IN ('queue','destination','prepare','confirm','fail','reconcile','retry') AND "app"."refund_event"."status" IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND "app"."refund_event"."source_kind" IN ('operation','job','provider') AND char_length("app"."refund_event"."reason") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "app"."refund_event_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"refund_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"outcome" text NOT NULL,
	"refund_event_id" uuid NOT NULL,
	"cash_transaction_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "refund_event_result_refund_event_id_unique" UNIQUE("refund_event_id"),
	CONSTRAINT "refund_event_result_cash_transaction_id_unique" UNIQUE("cash_transaction_id"),
	CONSTRAINT "refund_event_result_value_check" CHECK ("app"."refund_event_result"."revision">0 AND "app"."refund_event_result"."outcome" IN ('confirmed','failed') AND (("app"."refund_event_result"."outcome"='confirmed')=("app"."refund_event_result"."cash_transaction_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."refund_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"refund_id" uuid NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "refund_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "refund_provider_event_hash_check" CHECK ("app"."refund_provider_event"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."return_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"requested_resolution" text NOT NULL,
	"resolution" text,
	"requires_goods" boolean,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "return_case_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "return_case_value_check" CHECK ("app"."return_case"."revision">0 AND "app"."return_case"."status" IN ('requested','reviewing','approved','rejected','awaiting_goods','inspecting','refunding','replacing','resolved') AND "app"."return_case"."requested_resolution" IN ('refund','replacement') AND ("app"."return_case"."resolution" IS NULL OR "app"."return_case"."resolution" IN ('refund','replacement')))
);
--> statement-breakpoint
CREATE TABLE "app"."return_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"resolution" text,
	"requires_goods" boolean,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_id" text,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "return_event_revision_unique" UNIQUE("case_id","revision"),
	CONSTRAINT "return_event_case_identity_unique" UNIQUE("case_id","id"),
	CONSTRAINT "return_event_source_unique" UNIQUE("source_kind","source_id","kind"),
	CONSTRAINT "return_event_value_check" CHECK ("app"."return_event"."revision">0 AND "app"."return_event"."kind" IN ('create','decision','inspection','refund_queue','refund_confirmed','refund_failed') AND "app"."return_event"."status" IN ('requested','reviewing','approved','rejected','awaiting_goods','inspecting','refunding','replacing','resolved') AND "app"."return_event"."source_kind" IN ('operation','refund') AND ("app"."return_event"."source_kind"='operation' OR "app"."return_event"."actor_id" IS NULL) AND char_length("app"."return_event"."reason") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "app"."return_goods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"return_item_id" uuid NOT NULL,
	"expected_balance_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"identity_confirmed" boolean NOT NULL,
	"stock_movement_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "return_goods_stock_movement_id_unique" UNIQUE("stock_movement_id"),
	CONSTRAINT "return_goods_event_position_unique" UNIQUE("event_id","return_item_id","expected_balance_id"),
	CONSTRAINT "return_goods_value_check" CHECK ("app"."return_goods"."quantity" between 1 and 1000000 AND ("app"."return_goods"."identity_confirmed"=("app"."return_goods"."stock_movement_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."return_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"fulfillment_item_id" uuid NOT NULL,
	"buyer_receipt_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"merchandise_amount" bigint NOT NULL,
	"buyer_shipping" bigint NOT NULL,
	"claim_state" text DEFAULT 'held' NOT NULL,
	"inspection_status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "return_item_case_unit_unique" UNIQUE("case_id","fulfillment_item_id"),
	CONSTRAINT "return_item_case_identity_unique" UNIQUE("case_id","id"),
	CONSTRAINT "return_item_value_check" CHECK ("app"."return_item"."reason" IN ('wrong_item','damaged','defective','not_as_described','incomplete','expired','broken_mandatory_seal') AND char_length("app"."return_item"."details")<=2000 AND "app"."return_item"."merchandise_amount"=99000 AND "app"."return_item"."buyer_shipping" between 0 and 9007199254641991 AND "app"."return_item"."claim_state" IN ('held','released','refunded','replacing','replaced') AND "app"."return_item"."inspection_status" IN ('pending','accepted','rejected','needs_review','waived'))
);
--> statement-breakpoint
CREATE TABLE "app"."return_item_event" (
	"case_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"return_item_id" uuid NOT NULL,
	"claim_state" text NOT NULL,
	"inspection_status" text NOT NULL,
	CONSTRAINT "return_item_event_event_id_return_item_id_pk" PRIMARY KEY("event_id","return_item_id"),
	CONSTRAINT "return_item_event_state_check" CHECK ("app"."return_item_event"."claim_state" IN ('held','released','refunded','replacing','replaced') AND "app"."return_item_event"."inspection_status" IN ('pending','accepted','rejected','needs_review','waived'))
);
--> statement-breakpoint
CREATE TABLE "app"."return_operation" (
	"order_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_scope" text NOT NULL,
	"actor_id" text,
	"session_id" text,
	"guest_id" uuid,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"proof_digest" text,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_xid" text DEFAULT pg_current_xact_id()::text NOT NULL,
	CONSTRAINT "return_operation_key_unique" UNIQUE("actor_scope","key"),
	CONSTRAINT "return_operation_proof_unique" UNIQUE("proof_digest"),
	CONSTRAINT "return_operation_value_check" CHECK (char_length("app"."return_operation"."key") between 16 and 200 AND "app"."return_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("app"."return_operation"."response")='object' AND "app"."return_operation"."action" IN ('return.create','return.decide','return.inspect','refund.queue','refund.destination','refund.reconcile','refund.retry') AND (("app"."return_operation"."actor_id" IS NOT NULL AND "app"."return_operation"."session_id" IS NOT NULL AND "app"."return_operation"."guest_id" IS NULL AND "app"."return_operation"."actor_scope"='user:'||"app"."return_operation"."actor_id") OR ("app"."return_operation"."actor_id" IS NULL AND "app"."return_operation"."session_id" IS NULL AND "app"."return_operation"."guest_id" IS NOT NULL AND "app"."return_operation"."actor_scope"='guest:'||"app"."return_operation"."guest_id"::text)))
);
--> statement-breakpoint
ALTER TABLE "app"."finance_posting" DROP CONSTRAINT "finance_posting_value_check";--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" DROP CONSTRAINT "finance_transaction_kind_check";--> statement-breakpoint
ALTER TABLE "app"."role_grant" DROP CONSTRAINT "role_grant_finance_check";--> statement-breakpoint
ALTER TABLE "app"."buyer_receipt" ADD CONSTRAINT "buyer_receipt_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."buyer_receipt" ADD CONSTRAINT "buyer_receipt_source_id_parcel_receipt_provider_event_id_fk" FOREIGN KEY ("source_id") REFERENCES "app"."parcel_receipt_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_parcel_receipt" ADD CONSTRAINT "local_parcel_receipt_booking_id_shipment_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."shipment_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_parcel_receipt" ADD CONSTRAINT "local_parcel_receipt_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_refund_destination" ADD CONSTRAINT "local_refund_destination_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_refund_event" ADD CONSTRAINT "local_refund_event_operation_id_local_refund_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_refund_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_refund_operation" ADD CONSTRAINT "local_refund_operation_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_refund_operation" ADD CONSTRAINT "local_refund_operation_creation_job_id_outbox_job_id_fk" FOREIGN KEY ("creation_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_refund_operation" ADD CONSTRAINT "local_refund_operation_original_payment_operation_id_local_payment_operation_id_fk" FOREIGN KEY ("original_payment_operation_id") REFERENCES "app"."local_payment_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_refund_operation" ADD CONSTRAINT "local_refund_operation_destination_source_id_local_refund_destination_id_fk" FOREIGN KEY ("destination_source_id") REFERENCES "app"."local_refund_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_receipt_provider_event" ADD CONSTRAINT "parcel_receipt_provider_event_id_local_parcel_receipt_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_parcel_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_receipt_provider_event" ADD CONSTRAINT "parcel_receipt_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_receipt_result" ADD CONSTRAINT "parcel_receipt_result_event_id_parcel_receipt_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."parcel_receipt_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_case_id_return_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_operation_id_return_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."return_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_obligation_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("obligation_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_cash_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_current_job_id_outbox_job_id_fk" FOREIGN KEY ("current_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_current_operation_id_local_refund_operation_id_fk" FOREIGN KEY ("current_operation_id") REFERENCES "app"."local_refund_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund" ADD CONSTRAINT "refund_destination_source_id_local_refund_destination_id_fk" FOREIGN KEY ("destination_source_id") REFERENCES "app"."local_refund_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_adjustment_intent" ADD CONSTRAINT "refund_adjustment_intent_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_adjustment_intent" ADD CONSTRAINT "refund_adjustment_intent_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_adjustment_intent" ADD CONSTRAINT "refund_adjustment_intent_purchase_event_id_commerce_event_id_fk" FOREIGN KEY ("purchase_event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" ADD CONSTRAINT "refund_allocation_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" ADD CONSTRAINT "refund_allocation_return_item_id_return_item_id_fk" FOREIGN KEY ("return_item_id") REFERENCES "app"."return_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" ADD CONSTRAINT "refund_allocation_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" ADD CONSTRAINT "refund_allocation_purchase_event_id_commerce_event_id_fk" FOREIGN KEY ("purchase_event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event" ADD CONSTRAINT "refund_event_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event" ADD CONSTRAINT "refund_event_provider_operation_id_local_refund_operation_id_fk" FOREIGN KEY ("provider_operation_id") REFERENCES "app"."local_refund_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event" ADD CONSTRAINT "refund_event_job_id_outbox_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event" ADD CONSTRAINT "refund_event_destination_source_id_local_refund_destination_id_fk" FOREIGN KEY ("destination_source_id") REFERENCES "app"."local_refund_destination"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event" ADD CONSTRAINT "refund_event_cash_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event_result" ADD CONSTRAINT "refund_event_result_event_id_refund_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."refund_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event_result" ADD CONSTRAINT "refund_event_result_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event_result" ADD CONSTRAINT "refund_event_result_refund_event_id_refund_event_id_fk" FOREIGN KEY ("refund_event_id") REFERENCES "app"."refund_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_event_result" ADD CONSTRAINT "refund_event_result_cash_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_provider_event" ADD CONSTRAINT "refund_provider_event_id_local_refund_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_refund_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_provider_event" ADD CONSTRAINT "refund_provider_event_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "app"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refund_provider_event" ADD CONSTRAINT "refund_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_case" ADD CONSTRAINT "return_case_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_case" ADD CONSTRAINT "return_case_operation_id_return_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."return_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_event" ADD CONSTRAINT "return_event_case_id_return_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_goods" ADD CONSTRAINT "return_goods_event_id_return_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."return_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_goods" ADD CONSTRAINT "return_goods_return_item_id_return_item_id_fk" FOREIGN KEY ("return_item_id") REFERENCES "app"."return_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_goods" ADD CONSTRAINT "return_goods_expected_balance_id_inventory_balance_id_fk" FOREIGN KEY ("expected_balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_goods" ADD CONSTRAINT "return_goods_stock_movement_id_stock_movement_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "app"."stock_movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD CONSTRAINT "return_item_case_id_return_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD CONSTRAINT "return_item_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD CONSTRAINT "return_item_buyer_receipt_id_buyer_receipt_id_fk" FOREIGN KEY ("buyer_receipt_id") REFERENCES "app"."buyer_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_item_event" ADD CONSTRAINT "return_item_event_case_event_fk" FOREIGN KEY ("case_id","event_id") REFERENCES "app"."return_event"("case_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_item_event" ADD CONSTRAINT "return_item_event_case_item_fk" FOREIGN KEY ("case_id","return_item_id") REFERENCES "app"."return_item"("case_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_operation" ADD CONSTRAINT "return_operation_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_operation" ADD CONSTRAINT "return_operation_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_operation" ADD CONSTRAINT "return_operation_guest_id_commerce_guest_context_id_fk" FOREIGN KEY ("guest_id") REFERENCES "app"."commerce_guest_context"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyer_receipt_source_idx" ON "app"."buyer_receipt" USING btree ("source_id","fulfillment_item_id");--> statement-breakpoint
CREATE INDEX "refund_order_idx" ON "app"."refund" USING btree ("order_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "refund_allocation_receipt_idx" ON "app"."refund_allocation" USING btree ("receipt_id","refund_id");--> statement-breakpoint
CREATE INDEX "return_case_order_idx" ON "app"."return_case" USING btree ("order_id","recorded_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_item_active_unit_unique" ON "app"."return_item" USING btree ("fulfillment_item_id") WHERE "app"."return_item"."claim_state"<>'released';--> statement-breakpoint
CREATE INDEX "return_item_case_idx" ON "app"."return_item" USING btree ("case_id","id");--> statement-breakpoint
CREATE INDEX "return_item_event_item_idx" ON "app"."return_item_event" USING btree ("return_item_id","event_id");--> statement-breakpoint
ALTER TABLE "app"."finance_posting" ADD CONSTRAINT "finance_posting_value_check" CHECK ("app"."finance_posting"."ordinal" between 1 and 100 AND "app"."finance_posting"."account" IN ('provider_receivable','buyer_funds_liability','company_cash','settlement_clearing','carrier_expense','provider_fee_expense','refund_payable') AND "app"."finance_posting"."side" IN ('debit','credit') AND "app"."finance_posting"."amount" between 1 and 9007199254740991);--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" ADD CONSTRAINT "finance_transaction_kind_check" CHECK ("app"."finance_transaction"."kind" IN ('economic_receipt','adjustment','reversal','settlement_cash','settlement_fee','settlement_match','refund_obligation','refund_cash') AND (("app"."finance_transaction"."kind"='reversal')=("app"."finance_transaction"."reverses_id" IS NOT NULL)) AND "app"."finance_transaction"."reverses_id" IS DISTINCT FROM "app"."finance_transaction"."id");--> statement-breakpoint
ALTER TABLE "app"."role_grant" ADD CONSTRAINT "role_grant_finance_check" CHECK (NOT ("app"."role_grant"."permissions" && ARRAY['finance.summary.read','finance.costs.read','finance.costs.write','finance.reconciliation.read','finance.reconciliation.write','finance.refunds.read','finance.refunds.write']::text[]) OR "app"."role_grant"."roles" && ARRAY['owner','finance']::text[]);

--> statement-breakpoint
-- Draft S31 native receipt boundary. Return/refund operation and money seals
-- are still required before this migration can receive application approval.
CREATE FUNCTION app.guard_parcel_receipt_source() RETURNS trigger LANGUAGE plpgsql AS $$
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
 WHERE f.id=ANY(v_units) AND f.shipment_id=NEW.shipment_id AND i.order_id=v_order_id;
 IF v_count<>cardinality(v_units)
 THEN RAISE EXCEPTION 'Parcel receipt cannot claim another original unit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER parcel_receipt_source_guard BEFORE INSERT ON app.local_parcel_receipt
 FOR EACH ROW EXECUTE FUNCTION app.guard_parcel_receipt_source();
--> statement-breakpoint
CREATE FUNCTION app.guard_parcel_receipt_registration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_parcel_receipt; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_source FROM app.local_parcel_receipt e WHERE e.id=NEW.id;
 IF NOT FOUND OR current_database()<>'99ribu_'||v_source.environment
 THEN RAISE EXCEPTION 'Parcel callback requires its original local source' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_job FROM app.outbox_job j WHERE j.id=NEW.callback_job_id;
 IF NOT FOUND OR v_job.kind<>'parcel.receipt.callback'
    OR v_job.dedup_key<>'parcel-receipt-callback:'||NEW.id::text
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',NEW.id::text)
    OR v_job.status<>'pending' OR v_job.attempts<>0
 THEN RAISE EXCEPTION 'Parcel receipt callback owns its original pending job' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER parcel_receipt_registration_guard BEFORE INSERT ON app.parcel_receipt_provider_event
 FOR EACH ROW EXECUTE FUNCTION app.guard_parcel_receipt_registration();
--> statement-breakpoint
CREATE FUNCTION app.guard_buyer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source app.local_parcel_receipt; v_shipment_id uuid;
BEGIN
 SELECT e.* INTO v_source FROM app.local_parcel_receipt e JOIN app.parcel_receipt_provider_event p ON p.id=e.id WHERE p.id=NEW.source_id;
 IF NOT FOUND OR NEW.received_at IS DISTINCT FROM v_source.occurred_at
    OR NOT (v_source.unit_ids ? NEW.fulfillment_item_id::text)
 THEN RAISE EXCEPTION 'Buyer receipt retains its exact original signed unit/time' USING ERRCODE='23514'; END IF;
 SELECT f.shipment_id INTO v_shipment_id FROM app.fulfillment_item f WHERE f.id=NEW.fulfillment_item_id;
 IF v_shipment_id IS DISTINCT FROM v_source.shipment_id
 THEN RAISE EXCEPTION 'Buyer receipt cannot move between original parcels' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER buyer_receipt_guard BEFORE INSERT ON app.buyer_receipt
 FOR EACH ROW EXECUTE FUNCTION app.guard_buyer_receipt();
--> statement-breakpoint
CREATE FUNCTION app.assert_parcel_receipt(p_event_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
 v_source app.local_parcel_receipt; v_registered app.parcel_receipt_provider_event;
 v_result app.parcel_receipt_result; v_job app.outbox_job; v_count integer;
BEGIN
 SELECT * INTO v_source FROM app.local_parcel_receipt e WHERE e.id=p_event_id;
 SELECT * INTO v_registered FROM app.parcel_receipt_provider_event p WHERE p.id=p_event_id;
 SELECT * INTO v_result FROM app.parcel_receipt_result r WHERE r.event_id=p_event_id;
 IF v_source.id IS NULL OR v_registered.id IS NULL OR v_result.event_id IS NULL
 THEN RAISE EXCEPTION 'Buyer receipt commits with original source, callback and result' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_job FROM app.outbox_job j WHERE j.id=v_registered.callback_job_id;
 IF v_job.id IS NULL OR v_job.kind<>'parcel.receipt.callback' OR v_job.status<>'completed'
    OR v_job.completed_at IS NULL OR v_job.dedup_key<>'parcel-receipt-callback:'||p_event_id::text
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',p_event_id::text)
    OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',p_event_id::text,'outcome',v_result.outcome,'receipt_count',v_result.receipt_count)
 THEN RAISE EXCEPTION 'Buyer receipt commits with its exact completed callback result' USING ERRCODE='23514'; END IF;
 SELECT count(*)::integer INTO v_count FROM app.buyer_receipt r WHERE r.source_id=p_event_id;
 IF v_count<>v_result.receipt_count OR (v_result.outcome='received' AND v_count=0)
    OR (v_result.outcome IN ('duplicate','exception') AND v_count<>0)
 THEN RAISE EXCEPTION 'Parcel callback preserves exact original receipt count' USING ERRCODE='23514'; END IF;
 IF v_result.outcome<>'exception' AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(v_source.unit_ids) AS u(value)
   WHERE NOT EXISTS(SELECT 1 FROM app.buyer_receipt r WHERE r.fulfillment_item_id=u.value::uuid))
 THEN RAISE EXCEPTION 'Parcel result cannot pretend receipt of an unrecorded unit' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_buyer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM app.assert_parcel_receipt(NEW.source_id);
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER buyer_receipt_sealed AFTER INSERT ON app.buyer_receipt
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_buyer_receipt();
--> statement-breakpoint
CREATE FUNCTION app.seal_parcel_receipt_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM app.assert_parcel_receipt(NEW.event_id);
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER parcel_receipt_result_sealed AFTER INSERT ON app.parcel_receipt_result
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_parcel_receipt_result();
--> statement-breakpoint
CREATE FUNCTION app.seal_parcel_receipt_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event_id uuid; v_job app.outbox_job;
BEGIN
 SELECT p.id INTO v_event_id FROM app.parcel_receipt_provider_event p WHERE p.callback_job_id=NEW.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Parcel receipt job requires its exact registered source' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_job FROM app.outbox_job j WHERE j.id=NEW.id;
 IF v_job.status='completed' THEN PERFORM app.assert_parcel_receipt(v_event_id);
 ELSIF EXISTS(SELECT 1 FROM app.parcel_receipt_result r WHERE r.event_id=v_event_id)
    OR EXISTS(SELECT 1 FROM app.buyer_receipt r WHERE r.source_id=v_event_id)
 THEN RAISE EXCEPTION 'Uncompleted parcel callback cannot retain partial receipts' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER parcel_receipt_job_sealed AFTER INSERT OR UPDATE ON app.outbox_job
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='parcel.receipt.callback')
 EXECUTE FUNCTION app.seal_parcel_receipt_job();
--> statement-breakpoint
CREATE FUNCTION app.guard_parcel_receipt_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event_id uuid;
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.dedup_key IS DISTINCT FROM OLD.dedup_key OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
    OR (OLD.status='completed' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Original parcel callback identity and completed result are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.attempts<OLD.attempts OR (OLD.status IN ('failed','unknown') AND NEW.status='pending') THEN
  SELECT p.id INTO v_event_id FROM app.parcel_receipt_provider_event p WHERE p.callback_job_id=OLD.id;
  IF NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.action='local.parcel_receipt.reconcile'
      AND a.subject_id=v_event_id::text AND a.outcome='allowed' AND a.created_at>=transaction_timestamp()
      AND a.details->>'job_id'=OLD.id::text AND a.details->>'previous_status'=OLD.status
      AND a.details->>'previous_attempts'=OLD.attempts::text)
  THEN RAISE EXCEPTION 'Exhausted parcel callback recovery retains its original audited attempt' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER parcel_receipt_job_guard BEFORE UPDATE ON app.outbox_job
 FOR EACH ROW WHEN (OLD.kind='parcel.receipt.callback' OR NEW.kind='parcel.receipt.callback')
 EXECUTE FUNCTION app.guard_parcel_receipt_job();
--> statement-breakpoint
DO $$
DECLARE v_relation text;
BEGIN
 FOREACH v_relation IN ARRAY ARRAY['local_parcel_receipt','parcel_receipt_provider_event','buyer_receipt','parcel_receipt_result'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',v_relation||'_immutable',v_relation);
 END LOOP;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION app.guard_return_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_operation app.return_operation; v_event app.return_event;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original return cases are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_order FROM app.commerce_order o WHERE o.id=NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Return case requires its original order' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_operation FROM app.return_operation op WHERE op.id=NEW.operation_id;
  IF NOT FOUND OR v_operation.action<>'return.create' OR v_operation.subject_id<>NEW.id OR v_operation.order_id<>NEW.order_id
     OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR NEW.revision<>1 OR NEW.status<>'requested' OR NEW.resolution IS NOT NULL OR NEW.requires_goods IS NOT NULL
     OR ((v_operation.actor_id IS NOT NULL AND v_order.owner_user_id=v_operation.actor_id)
          OR (v_operation.guest_id IS NOT NULL AND v_order.owner_guest_id=v_operation.guest_id)) IS NOT TRUE
  THEN RAISE EXCEPTION 'Return creation retains exact current original buyer operation' USING ERRCODE='23514'; END IF;
  -- Database-owned actual submission time closes every backdating writer path.
  -- Hours remain elapsed duration independently of the session timezone/DST.
  NEW.created_at:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
  NEW.recorded_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revision','status','resolution','requires_goods']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['revision','status','resolution','requires_goods'])
     OR NEW.revision::bigint<>OLD.revision::bigint+1
  THEN RAISE EXCEPTION 'Return head changes one revision without changing original identity/time' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_event FROM app.return_event e WHERE e.case_id=NEW.id AND e.revision=NEW.revision;
  IF NOT FOUND OR v_event.status IS DISTINCT FROM NEW.status OR v_event.resolution IS DISTINCT FROM NEW.resolution
     OR v_event.requires_goods IS DISTINCT FROM NEW.requires_goods
  THEN RAISE EXCEPTION 'Return head retains its exact appended transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_case_guard BEFORE INSERT OR UPDATE OR DELETE ON app.return_case
 FOR EACH ROW EXECUTE FUNCTION app.guard_return_case();
--> statement-breakpoint
CREATE FUNCTION app.guard_return_item() RETURNS trigger LANGUAGE plpgsql AS $$
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
 SELECT f.buyer_shipping,i.unit_price,r.received_at INTO v_original
 FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
 JOIN app.buyer_receipt r ON r.fulfillment_item_id=f.id
 WHERE f.id=NEW.fulfillment_item_id AND i.order_id=v_case.order_id AND r.id=NEW.buyer_receipt_id;
 IF NOT FOUND OR NEW.merchandise_amount IS DISTINCT FROM v_original.unit_price
    OR NEW.buyer_shipping IS DISTINCT FROM v_original.buyer_shipping
    OR NEW.deadline_at IS DISTINCT FROM v_original.received_at+interval '168 hours'
    OR v_case.created_at<v_original.received_at OR v_case.created_at>NEW.deadline_at
 THEN RAISE EXCEPTION 'Return unit requires its actually received original offer entitlement and submission window' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_item_guard BEFORE INSERT OR UPDATE OR DELETE ON app.return_item
 FOR EACH ROW EXECUTE FUNCTION app.guard_return_item();

--> statement-breakpoint
CREATE FUNCTION app.guard_return_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Committed return operations are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_order FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
  IF NOT FOUND OR NEW.response<>'{}'::jsonb
     OR ((NEW.action IN ('refund.queue','refund.reconcile','refund.retry')) IS DISTINCT FROM (NEW.proof_digest IS NOT NULL))
     OR (NEW.proof_digest IS NOT NULL AND NEW.proof_digest!~'^[a-f0-9]{64}$')
  THEN RAISE EXCEPTION 'New return operation retains its original order and required finance proof' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp(); NEW.created_xid:=pg_current_xact_id()::text;
  NEW.occurred_at:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
 ELSE
  IF OLD.created_xid<>pg_current_xact_id()::text OR OLD.response<>'{}'::jsonb OR NEW.response='{}'::jsonb
     OR (to_jsonb(NEW)-'response') IS DISTINCT FROM (to_jsonb(OLD)-'response')
  THEN RAISE EXCEPTION 'Return response finalizes once with its original transaction' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.return_operation
 FOR EACH ROW EXECUTE FUNCTION app.guard_return_operation();
--> statement-breakpoint
CREATE FUNCTION app.assert_return_operation(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
   SELECT DISTINCT s.warehouse_id FROM app.return_item r JOIN app.fulfillment_item f ON f.id=r.fulfillment_item_id
   JOIN app.order_shipment s ON s.id=f.shipment_id WHERE r.case_id=v_case.id
     AND (v_operation.action='return.decide' OR EXISTS(SELECT 1 FROM app.return_item_event h WHERE h.event_id=v_event.id AND h.return_item_id=r.id))
   ORDER BY s.warehouse_id
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
--> statement-breakpoint
CREATE FUNCTION app.seal_return_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_return_operation(NEW.id); RETURN NULL; END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_operation_sealed AFTER INSERT OR UPDATE ON app.return_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_return_operation();

--> statement-breakpoint
CREATE FUNCTION app.guard_return_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_operation app.return_operation; v_refund_event app.refund_event; v_refund app.refund;
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
CREATE TRIGGER return_event_guard BEFORE INSERT ON app.return_event FOR EACH ROW EXECUTE FUNCTION app.guard_return_event();
--> statement-breakpoint
CREATE FUNCTION app.guard_return_item_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event app.return_event; v_item app.return_item; v_previous record; v_case app.return_case; v_operation app.return_operation;
BEGIN
 SELECT * INTO v_event FROM app.return_event WHERE id=NEW.event_id AND case_id=NEW.case_id;
 SELECT * INTO v_item FROM app.return_item WHERE id=NEW.return_item_id AND case_id=NEW.case_id;
 SELECT * INTO v_case FROM app.return_case WHERE id=NEW.case_id;
 IF v_event.source_kind='operation' THEN
  SELECT * INTO v_operation FROM app.return_operation WHERE id=v_event.source_id;
  IF v_operation.created_xid IS DISTINCT FROM pg_current_xact_id()::text OR v_operation.response IS DISTINCT FROM '{}'::jsonb
  THEN RAISE EXCEPTION 'Unit history appends only with the unfinished current operation' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM app.refund_event_result WHERE refund_event_id=v_event.source_id) THEN
  RAISE EXCEPTION 'Committed historical refund unit transitions cannot be extended' USING ERRCODE='23514';
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
 ELSIF v_event.kind='refund_confirmed' THEN
  IF v_previous.claim_state<>'held' OR NEW.claim_state<>'refunded' OR NEW.inspection_status IS DISTINCT FROM v_previous.inspection_status
  THEN RAISE EXCEPTION 'Confirmed refund consumes only its held original complete units' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This case event does not change physical unit state' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_item_event_guard BEFORE INSERT ON app.return_item_event FOR EACH ROW EXECUTE FUNCTION app.guard_return_item_event();
--> statement-breakpoint
CREATE FUNCTION app.assert_return_case(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
     OR (v_item.inspection_status='accepted' AND NOT EXISTS(SELECT 1 FROM app.return_goods g JOIN app.return_item original ON original.id=g.return_item_id WHERE original.fulfillment_item_id=v_item.fulfillment_item_id))
  THEN RAISE EXCEPTION 'Return unit head and eligibility retain their actual event/intake history' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR v_event IN SELECT * FROM app.return_event WHERE case_id=p_case_id ORDER BY revision LOOP
  SELECT count(*) INTO v_changed FROM app.return_item_event WHERE event_id=v_event.id;
  IF (v_event.kind IN ('create','decision','refund_confirmed') AND v_changed<>v_total)
     OR (v_event.kind='inspection' AND v_changed NOT BETWEEN 1 AND v_total)
     OR (v_event.kind IN ('refund_queue','refund_failed') AND v_changed<>0)
  THEN RAISE EXCEPTION 'Return event changes exactly its required physical unit set' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_return_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case_id uuid;
BEGIN
 IF TG_TABLE_NAME='return_case' THEN v_case_id:=NEW.id; ELSE v_case_id:=NEW.case_id; END IF;
 PERFORM app.assert_return_case(v_case_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_case_sealed AFTER INSERT OR UPDATE ON app.return_case DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION app.seal_return_case();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_event_sealed AFTER INSERT ON app.return_event DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION app.seal_return_case();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_item_sealed AFTER INSERT OR UPDATE ON app.return_item DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION app.seal_return_case();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_item_event_sealed AFTER INSERT ON app.return_item_event DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION app.seal_return_case();

--> statement-breakpoint
CREATE FUNCTION app.guard_return_goods() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_item app.return_item; v_event app.return_event; v_operation app.return_operation; v_movement app.stock_movement;
 v_balance app.inventory_balance; v_original record; v_received numeric;
BEGIN
 SELECT * INTO v_item FROM app.return_item WHERE id=NEW.return_item_id;
 SELECT * INTO v_event FROM app.return_event WHERE id=NEW.event_id AND case_id=v_item.case_id;
 SELECT * INTO v_operation FROM app.return_operation WHERE id=v_event.source_id;
 SELECT a.quantity,s.warehouse_id INTO v_original FROM app.fulfillment_component_allocation a
   JOIN app.fulfillment_item f ON f.id=a.fulfillment_item_id JOIN app.order_shipment s ON s.id=f.shipment_id
   WHERE a.fulfillment_item_id=v_item.fulfillment_item_id AND a.balance_id=NEW.expected_balance_id;
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
   WHERE r.fulfillment_item_id=v_item.fulfillment_item_id AND g.expected_balance_id=NEW.expected_balance_id AND g.identity_confirmed;
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
CREATE TRIGGER return_goods_guard BEFORE INSERT ON app.return_goods FOR EACH ROW EXECUTE FUNCTION app.guard_return_goods();
--> statement-breakpoint
CREATE FUNCTION app.seal_return_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.return_goods g WHERE g.stock_movement_id=NEW.id AND g.identity_confirmed AND NEW.source_ref='return-goods:'||g.id::text)
 THEN RAISE EXCEPTION 'Return quarantine movement commits its exact original physical intake' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_stock_movement_sealed AFTER INSERT ON app.stock_movement DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.source_ref LIKE 'return-goods:%') EXECUTE FUNCTION app.seal_return_stock_movement();

--> statement-breakpoint
CREATE FUNCTION app.assert_refund_collection(p_receipt_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_receipt app.economic_receipt; v_journal app.finance_transaction; v_qualified boolean; v_postings integer;
BEGIN
 SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=p_receipt_id;
 SELECT * INTO v_journal FROM app.finance_transaction WHERE id=v_receipt.transaction_id FOR UPDATE;
 IF v_receipt.id IS NULL OR v_journal.id IS NULL OR v_journal.kind<>'economic_receipt'
    OR (v_journal.order_id,v_journal.source,v_journal.environment,v_journal.effect_reference,v_journal.occurred_at)
       IS DISTINCT FROM (v_receipt.order_id,v_receipt.source,v_receipt.environment,v_receipt.effect_reference,v_receipt.occurred_at)
    OR EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=v_journal.id)
 THEN RAISE EXCEPTION 'Refund collection requires its original unreversed economic journal' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_postings FROM app.finance_posting WHERE transaction_id=v_journal.id;
 IF v_postings<>2 OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_journal.id AND account='provider_receivable' AND side='debit' AND amount=v_receipt.amount)
    OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=v_journal.id AND account='buyer_funds_liability' AND side='credit' AND amount=v_receipt.amount)
 THEN RAISE EXCEPTION 'Refund basis conserves the qualified collected gross amount' USING ERRCODE='23514'; END IF;
 IF v_receipt.kind='prepaid' THEN
  SELECT EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.local_payment_event e ON e.id=r.event_id
   JOIN app.local_payment_operation source ON source.id=e.operation_id JOIN app.payment_attempt attempt ON attempt.id=source.attempt_id
   WHERE r.transaction_id=v_journal.id AND r.receipt_id=v_receipt.id AND r.outcome='confirmed'
    AND e.id::text=v_receipt.event_id AND e.status='confirmed' AND e.amount=v_receipt.amount AND e.occurred_at=v_receipt.occurred_at
    AND source.id::text=v_receipt.effect_reference AND source.environment=v_receipt.environment AND attempt.order_id=v_receipt.order_id) INTO v_qualified;
 ELSE
  SELECT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.local_cod_event e ON e.id=r.event_id
   JOIN app.local_cod_operation source ON source.id=e.operation_id JOIN app.order_shipment parcel ON parcel.id=source.shipment_id
   WHERE r.transaction_id=v_journal.id AND r.receipt_id=v_receipt.id AND r.outcome='collected'
    AND e.id::text=v_receipt.event_id AND e.status='collected' AND e.amount=v_receipt.amount AND e.occurred_at=v_receipt.occurred_at
    AND source.id::text=v_receipt.effect_reference AND source.environment=v_receipt.environment
    AND parcel.id=v_receipt.shipment_id AND parcel.order_id=v_receipt.order_id) INTO v_qualified;
 END IF;
 IF NOT coalesce(v_qualified,false) THEN RAISE EXCEPTION 'An internal balanced primitive or recovery amount cannot qualify an ordinary return refund' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_operation app.return_operation; v_item app.return_item; v_unit app.fulfillment_item;
 v_order app.commerce_order; v_receipt app.economic_receipt; v_purchase app.commerce_event; v_original app.order_item;
BEGIN
 SELECT * INTO v_refund FROM app.refund WHERE id=NEW.refund_id;
 SELECT * INTO v_operation FROM app.return_operation WHERE id=v_refund.operation_id;
 SELECT * INTO v_item FROM app.return_item WHERE id=NEW.return_item_id AND case_id=v_refund.case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id FOR UPDATE;
 SELECT * INTO v_unit FROM app.fulfillment_item WHERE id=v_item.fulfillment_item_id FOR UPDATE;
 SELECT * INTO v_original FROM app.order_item WHERE id=v_unit.order_item_id;
 SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
 SELECT * INTO v_purchase FROM app.commerce_event WHERE receipt_id=NEW.receipt_id AND name='Purchase';
 IF v_refund.id IS NULL OR v_operation.id IS NULL OR v_operation.action<>'refund.queue'
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb OR v_refund.revision<>1
    OR v_item.id IS NULL OR v_item.claim_state<>'held' OR v_item.inspection_status NOT IN ('accepted','waived')
    OR v_original.order_id IS DISTINCT FROM v_order.id OR v_receipt.order_id IS DISTINCT FROM v_order.id
    OR v_receipt.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR (v_order.payment_method='cod' AND (v_receipt.kind<>'cod' OR v_receipt.shipment_id IS DISTINCT FROM v_unit.shipment_id))
    OR (v_order.payment_method='prepaid' AND (v_receipt.kind<>'prepaid' OR v_receipt.shipment_id IS NOT NULL))
    OR (NEW.merchandise_amount,NEW.buyer_shipping,NEW.amount) IS DISTINCT FROM (v_item.merchandise_amount,v_unit.buyer_shipping,v_item.merchandise_amount+v_unit.buyer_shipping)
    OR NEW.purchase_event_id IS DISTINCT FROM v_purchase.id
    OR (v_purchase.id IS NOT NULL AND (v_purchase.order_id,v_purchase.occurred_at,v_purchase.merchandise_amount) IS DISTINCT FROM (v_order.id,v_receipt.occurred_at,v_receipt.merchandise_amount))
    OR EXISTS(SELECT 1 FROM app.refund_allocation a JOIN app.return_item r ON r.id=a.return_item_id WHERE r.fulfillment_item_id=v_unit.id)
 THEN RAISE EXCEPTION 'Refund allocation binds each whole original unit, frozen shipping and original optional Purchase once' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_refund_collection(v_receipt.id); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_allocation_guard BEFORE INSERT ON app.refund_allocation FOR EACH ROW EXECUTE FUNCTION app.guard_refund_allocation();
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_order app.commerce_order; v_operation app.return_operation; v_event app.refund_event;
 v_obligation app.finance_transaction;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original refund obligations and history are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO v_case FROM app.return_case WHERE id=NEW.case_id FOR UPDATE;
  SELECT * INTO v_order FROM app.commerce_order WHERE id=NEW.order_id;
  SELECT * INTO v_operation FROM app.return_operation WHERE id=NEW.operation_id;
  SELECT * INTO v_obligation FROM app.finance_transaction WHERE id=NEW.obligation_transaction_id;
  IF v_case.id IS NULL OR v_case.order_id IS DISTINCT FROM v_order.id OR v_case.status<>'approved' OR v_case.resolution<>'refund'
     OR v_operation.action IS DISTINCT FROM 'refund.queue' OR v_operation.subject_id IS DISTINCT FROM v_case.id
     OR v_operation.order_id IS DISTINCT FROM v_order.id OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR v_obligation.id IS NULL OR v_obligation.created_xid<>pg_current_xact_id()::text OR v_obligation.kind<>'refund_obligation'
     OR v_obligation.order_id IS DISTINCT FROM v_order.id OR v_obligation.effect_reference IS DISTINCT FROM NEW.id::text
     OR v_obligation.occurred_at IS DISTINCT FROM v_operation.occurred_at OR NEW.created_at IS DISTINCT FROM v_operation.occurred_at
     OR NEW.revision<>1 OR NEW.cash_transaction_id IS NOT NULL OR NEW.current_operation_id IS NOT NULL OR NEW.destination_source_id IS NOT NULL
     OR (v_order.payment_method='cod' AND (NEW.status<>'awaiting_destination' OR NEW.current_job_id IS NOT NULL))
     OR (v_order.payment_method='prepaid' AND (NEW.status<>'queued' OR NEW.current_job_id IS NULL))
  THEN RAISE EXCEPTION 'Refund begins once with the approved original obligation and exact finance operation time' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revision','status','current_job_id','current_operation_id','destination_source_id','cash_transaction_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['revision','status','current_job_id','current_operation_id','destination_source_id','cash_transaction_id'])
     OR NEW.revision::bigint<>OLD.revision::bigint+1
  THEN RAISE EXCEPTION 'Refund head retains original obligation, amount and identity' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_event FROM app.refund_event WHERE refund_id=NEW.id AND revision=NEW.revision;
  IF v_event.id IS NULL OR (NEW.status,NEW.current_job_id,NEW.current_operation_id,NEW.destination_source_id,NEW.cash_transaction_id)
      IS DISTINCT FROM (v_event.status,v_event.job_id,v_event.provider_operation_id,v_event.destination_source_id,v_event.cash_transaction_id)
  THEN RAISE EXCEPTION 'Refund head requires its exact immutable event revision' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_head_guard BEFORE INSERT OR UPDATE OR DELETE ON app.refund FOR EACH ROW EXECUTE FUNCTION app.guard_refund_head();

--> statement-breakpoint
CREATE FUNCTION app.guard_refund_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_operation app.return_operation; v_provider app.local_refund_operation;
 v_bank app.local_refund_event; v_registration app.refund_provider_event; v_job app.outbox_job; v_old_job app.outbox_job;
BEGIN
 SELECT * INTO v_refund FROM app.refund WHERE id=NEW.refund_id FOR UPDATE;
 IF v_refund.id IS NULL OR (NEW.kind='queue' AND (NEW.revision<>1 OR v_refund.revision<>1))
    OR (NEW.kind<>'queue' AND NEW.revision::bigint<>v_refund.revision::bigint+1)
 THEN RAISE EXCEPTION 'Refund event appends exactly one original current revision' USING ERRCODE='23514'; END IF;
 IF NEW.source_kind='operation' THEN
  SELECT * INTO v_operation FROM app.return_operation WHERE id=NEW.source_id;
  IF v_operation.id IS NULL OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
     OR v_operation.order_id IS DISTINCT FROM v_refund.order_id
     OR v_operation.subject_id IS DISTINCT FROM (CASE NEW.kind WHEN 'queue' THEN v_refund.case_id ELSE v_refund.id END)
     OR v_operation.action IS DISTINCT FROM 'refund.'||NEW.kind OR NEW.kind NOT IN ('queue','destination','reconcile','retry')
  THEN RAISE EXCEPTION 'Refund transition requires its exact current unfinished operation' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=v_operation.occurred_at;
 ELSIF NEW.source_kind='job' THEN
  SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.source_id FOR SHARE;
  SELECT * INTO v_provider FROM app.local_refund_operation WHERE id=NEW.provider_operation_id;
  IF NEW.kind<>'prepare' OR v_job.id IS NULL OR v_job.kind<>'refund.create' OR v_job.status<>'processing'
     OR v_job.lease_token IS NULL OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL
     OR v_job.id IS DISTINCT FROM v_refund.current_job_id OR v_job.id IS DISTINCT FROM NEW.job_id
     OR v_provider.id IS NULL OR v_provider.creation_job_id IS DISTINCT FROM v_job.id OR v_provider.refund_id IS DISTINCT FROM v_refund.id
  THEN RAISE EXCEPTION 'Refund preparation retains its exact live fenced request job' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=v_provider.created_at;
 ELSE
  SELECT * INTO v_bank FROM app.local_refund_event WHERE id=NEW.source_id;
  SELECT * INTO v_provider FROM app.local_refund_operation WHERE id=v_bank.operation_id;
  SELECT * INTO v_registration FROM app.refund_provider_event WHERE id=v_bank.id;
  SELECT * INTO v_job FROM app.outbox_job WHERE id=v_registration.callback_job_id FOR SHARE;
  IF v_bank.id IS NULL OR v_provider.id IS NULL OR v_registration.id IS NULL OR v_job.id IS NULL
     OR v_registration.refund_id IS DISTINCT FROM v_refund.id OR v_provider.id IS DISTINCT FROM v_refund.current_operation_id
     OR v_provider.id IS DISTINCT FROM NEW.provider_operation_id OR v_provider.creation_job_id IS DISTINCT FROM NEW.job_id
     OR v_job.kind<>'refund.callback' OR v_job.status<>'pending'
     OR (NEW.kind='confirm' AND (v_bank.status<>'succeeded' OR NEW.status<>'succeeded' OR NEW.cash_transaction_id IS NULL))
     OR (NEW.kind='fail' AND (v_bank.status<>'failed' OR NEW.status<>'failed' OR NEW.cash_transaction_id IS NOT NULL))
     OR NEW.kind NOT IN ('confirm','fail')
  THEN RAISE EXCEPTION 'Refund outcome retains its exact original registered bank source and pending callback' USING ERRCODE='23514'; END IF;
  NEW.occurred_at:=v_bank.occurred_at;
 END IF;
 IF NEW.kind='queue' THEN
  IF NEW.source_id IS DISTINCT FROM v_refund.operation_id
     OR (NEW.status,NEW.provider_operation_id,NEW.job_id,NEW.destination_source_id,NEW.cash_transaction_id)
       IS DISTINCT FROM (v_refund.status,v_refund.current_operation_id,v_refund.current_job_id,v_refund.destination_source_id,v_refund.cash_transaction_id)
  THEN RAISE EXCEPTION 'Initial refund event equals the original obligation head' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='destination' THEN
  IF v_refund.status<>'awaiting_destination' OR NEW.status<>'queued' OR v_refund.destination_source_id IS NOT NULL
     OR NEW.destination_source_id IS NULL OR NEW.job_id IS NULL OR NEW.provider_operation_id IS NOT NULL OR NEW.cash_transaction_id IS NOT NULL
  THEN RAISE EXCEPTION 'Destination acceptance only queues the original previously unaddressed COD refund' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='prepare' THEN
  IF v_refund.status<>'queued' OR NEW.status<>'processing' OR v_refund.current_operation_id IS NOT NULL
     OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id OR NEW.cash_transaction_id IS NOT NULL
  THEN RAISE EXCEPTION 'Preparation acknowledges a request without claiming money sent' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='reconcile' THEN
  IF (NEW.status,NEW.provider_operation_id,NEW.job_id,NEW.destination_source_id,NEW.cash_transaction_id)
     IS DISTINCT FROM (v_refund.status,v_refund.current_operation_id,v_refund.current_job_id,v_refund.destination_source_id,v_refund.cash_transaction_id)
  THEN RAISE EXCEPTION 'Reconciliation retains original money and request identity' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='retry' THEN
  SELECT * INTO v_old_job FROM app.outbox_job WHERE id=v_refund.current_job_id FOR SHARE;
  SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.job_id;
  IF v_old_job.id IS NULL OR v_old_job.status NOT IN ('completed','failed') OR v_refund.status NOT IN ('failed','queued')
     OR NEW.status<>'queued' OR NEW.provider_operation_id IS NOT NULL OR NEW.cash_transaction_id IS NOT NULL
     OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id OR NEW.job_id IS NOT DISTINCT FROM v_old_job.id
     OR v_job.id IS NULL OR v_job.kind<>'refund.create' OR v_job.status<>'pending' OR v_job.attempts<>0
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',(v_old_job.payload->>'attempt')::integer+1)
     OR (v_refund.current_operation_id IS NULL AND (v_old_job.status<>'failed' OR EXISTS(SELECT 1 FROM app.local_refund_operation WHERE creation_job_id=v_old_job.id)))
     OR (v_refund.current_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.local_refund_event e JOIN app.refund_event_result r ON r.event_id=e.id
         WHERE e.operation_id=v_refund.current_operation_id AND e.status='failed' AND e.amount=0 AND r.outcome='failed' AND r.cash_transaction_id IS NULL))
  THEN RAISE EXCEPTION 'Retry requires a known unsent original request and exact next attempt; unknown money stays held' USING ERRCODE='23514'; END IF;
 ELSE
  IF v_refund.status NOT IN ('processing','unknown') OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id
  THEN RAISE EXCEPTION 'Original bank outcome changes only its pending refund request' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_event_guard BEFORE INSERT ON app.refund_event FOR EACH ROW EXECUTE FUNCTION app.guard_refund_event();

--> statement-breakpoint
CREATE FUNCTION app.guard_refund_destination_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_order app.commerce_order;
BEGIN
 SELECT * INTO v_refund FROM app.refund WHERE id=NEW.refund_id FOR UPDATE;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id;
 IF v_refund.id IS NULL OR v_order.id IS NULL OR v_order.payment_method<>'cod' OR v_refund.status<>'awaiting_destination'
    OR NEW.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR NEW.buyer_scope IS DISTINCT FROM (CASE WHEN v_order.owner_user_id IS NOT NULL THEN 'user:'||v_order.owner_user_id ELSE 'guest:'||v_order.owner_guest_id::text END)
    OR NEW.occurred_at<v_refund.created_at OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace)
    OR EXISTS(SELECT 1 FROM app.local_refund_destination WHERE refund_id=NEW.refund_id)
 THEN RAISE EXCEPTION 'Synthetic destination verification retains one original buyer/refund/environment certificate' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_destination_source_guard BEFORE INSERT ON app.local_refund_destination FOR EACH ROW EXECUTE FUNCTION app.guard_refund_destination_source();
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_provider_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_order app.commerce_order; v_job app.outbox_job; v_destination app.local_refund_destination;
BEGIN
 SELECT * INTO v_refund FROM app.refund WHERE id=NEW.refund_id FOR UPDATE;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.creation_job_id FOR SHARE;
 IF v_refund.id IS NULL OR v_order.id IS NULL OR v_job.id IS NULL OR v_refund.status<>'queued'
    OR v_refund.current_operation_id IS NOT NULL OR v_refund.current_job_id IS DISTINCT FROM v_job.id
    OR v_job.kind<>'refund.create' OR v_job.status<>'processing' OR v_job.lease_token IS NULL
    OR v_job.lease_until<=clock_timestamp() OR v_job.dispatched_at IS NULL
    OR v_job.dedup_key IS DISTINCT FROM 'refund-create:'||v_refund.id::text||':'||NEW.attempt::text
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',NEW.attempt)
    OR NEW.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR NEW.amount IS DISTINCT FROM v_refund.amount OR NEW.clock_namespace IS DISTINCT FROM v_order.clock_namespace
    OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id
 THEN RAISE EXCEPTION 'Refund provider request requires its exact original fenced job, amount and clock' USING ERRCODE='23514'; END IF;
 IF v_order.payment_method='prepaid' THEN
  IF NEW.rail<>'prepaid_original' OR NEW.original_payment_operation_id IS NULL OR NEW.destination_source_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM app.refund_allocation a JOIN app.economic_receipt r ON r.id=a.receipt_id
       WHERE a.refund_id=v_refund.id AND (r.kind<>'prepaid' OR r.effect_reference<>NEW.original_payment_operation_id::text))
  THEN RAISE EXCEPTION 'Prepaid refund preserves its original qualified payer operation' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_destination FROM app.local_refund_destination WHERE id=NEW.destination_source_id;
  IF NEW.rail<>'cod_verified_destination' OR NEW.original_payment_operation_id IS NOT NULL OR v_destination.id IS NULL
     OR v_destination.refund_id IS DISTINCT FROM v_refund.id OR v_destination.environment IS DISTINCT FROM NEW.environment
     OR v_destination.buyer_scope IS DISTINCT FROM (CASE WHEN v_order.owner_user_id IS NOT NULL THEN 'user:'||v_order.owner_user_id ELSE 'guest:'||v_order.owner_guest_id::text END)
  THEN RAISE EXCEPTION 'COD refund requires the exact verified original buyer recipient certificate' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.created_at:=date_trunc('milliseconds',app.reservation_clock(v_order.clock_namespace));
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_provider_operation_guard BEFORE INSERT ON app.local_refund_operation FOR EACH ROW EXECUTE FUNCTION app.guard_refund_provider_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_bank_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_provider app.local_refund_operation; v_refund app.refund; v_order app.commerce_order;
BEGIN
 SELECT * INTO v_provider FROM app.local_refund_operation WHERE id=NEW.operation_id;
 SELECT * INTO v_refund FROM app.refund WHERE id=v_provider.refund_id FOR UPDATE;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id;
 IF v_provider.id IS NULL OR v_refund.id IS NULL OR v_refund.current_operation_id IS DISTINCT FROM v_provider.id
    OR v_refund.current_job_id IS DISTINCT FROM v_provider.creation_job_id OR v_refund.status NOT IN ('processing','unknown')
    OR (NEW.status='succeeded' AND NEW.amount IS DISTINCT FROM v_provider.amount)
    OR (NEW.status='failed' AND NEW.amount<>0)
    OR v_provider.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR NEW.occurred_at<v_provider.created_at OR NEW.occurred_at>app.reservation_clock(v_order.clock_namespace)
 THEN RAISE EXCEPTION 'Bank result retains the original request and actual full debit or zero-money rejection' USING ERRCODE='23514'; END IF;
 -- Keep the authenticated source occurrence unchanged: overriding it would
 -- invalidate the application-verified original HMAC and lose bank history.
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_bank_source_guard BEFORE INSERT ON app.local_refund_event FOR EACH ROW EXECUTE FUNCTION app.guard_refund_bank_source();
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_bank app.local_refund_event; v_provider app.local_refund_operation; v_job app.outbox_job;
BEGIN
 SELECT * INTO v_bank FROM app.local_refund_event WHERE id=NEW.id;
 SELECT * INTO v_provider FROM app.local_refund_operation WHERE id=v_bank.operation_id;
 SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.callback_job_id;
 IF v_bank.id IS NULL OR v_provider.id IS NULL OR NEW.refund_id IS DISTINCT FROM v_provider.refund_id
    OR v_job.id IS NULL OR v_job.kind<>'refund.callback' OR v_job.status<>'pending' OR v_job.attempts<>0
    OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',NEW.id)
    OR v_job.dedup_key IS DISTINCT FROM 'refund-callback:'||NEW.id::text
 THEN RAISE EXCEPTION 'Refund callback registration retains its exact original bank source and own job' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_provider_event_guard BEFORE INSERT ON app.refund_provider_event FOR EACH ROW EXECUTE FUNCTION app.guard_refund_provider_event();
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_original_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_original app.finance_transaction;
BEGIN
 IF NEW.reverses_id IS NOT NULL THEN
  SELECT * INTO v_original FROM app.finance_transaction WHERE id=NEW.reverses_id FOR UPDATE;
  IF v_original.kind IN ('refund_obligation','refund_cash') OR EXISTS(SELECT 1 FROM app.refund_allocation a JOIN app.economic_receipt r ON r.id=a.receipt_id WHERE r.transaction_id=v_original.id)
  THEN RAISE EXCEPTION 'Refund obligations, actual outgoing cash and their allocated original collections retain money history' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_original_reversal_guard BEFORE INSERT ON app.finance_transaction FOR EACH ROW EXECUTE FUNCTION app.guard_refund_original_reversal();

--> statement-breakpoint
CREATE FUNCTION app.guard_refund_adjustment_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_receipt app.economic_receipt; v_purchase app.commerce_event; v_cash app.finance_transaction;
 v_bank app.local_refund_event; v_delta numeric; v_refunded numeric; v_sequence integer; v_allocation jsonb;
BEGIN
 SELECT * INTO v_refund FROM app.refund WHERE id=NEW.refund_id FOR UPDATE;
 SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
 PERFORM id FROM app.finance_transaction WHERE id=v_receipt.transaction_id FOR UPDATE;
 SELECT * INTO v_purchase FROM app.commerce_event WHERE receipt_id=v_receipt.id AND name='Purchase';
 SELECT * INTO v_cash FROM app.finance_transaction WHERE id=v_refund.cash_transaction_id;
 SELECT * INTO v_bank FROM app.local_refund_event WHERE operation_id=v_refund.current_operation_id;
 SELECT coalesce(sum(a.merchandise_amount),0),jsonb_agg(jsonb_build_object('fulfillment_item_id',r.fulfillment_item_id,'order_item_id',f.order_item_id,'quantity',1,'merchandise_amount',a.merchandise_amount) ORDER BY r.fulfillment_item_id)
  INTO v_delta,v_allocation FROM app.refund_allocation a JOIN app.return_item r ON r.id=a.return_item_id
  JOIN app.fulfillment_item f ON f.id=r.fulfillment_item_id WHERE a.refund_id=v_refund.id AND a.receipt_id=v_receipt.id;
 SELECT coalesce(sum(a.merchandise_amount),0) INTO v_refunded FROM app.refund_allocation a JOIN app.refund r ON r.id=a.refund_id WHERE a.receipt_id=v_receipt.id AND r.status='succeeded';
 SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM app.refund_adjustment_intent WHERE receipt_id=v_receipt.id;
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
CREATE TRIGGER refund_adjustment_intent_guard BEFORE INSERT ON app.refund_adjustment_intent FOR EACH ROW EXECUTE FUNCTION app.guard_refund_adjustment_intent();
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_registration app.refund_provider_event; v_bank app.local_refund_event; v_provider app.local_refund_operation; v_event app.refund_event;
BEGIN
 SELECT * INTO v_registration FROM app.refund_provider_event WHERE id=NEW.event_id;
 SELECT * INTO v_bank FROM app.local_refund_event WHERE id=NEW.event_id;
 SELECT * INTO v_provider FROM app.local_refund_operation WHERE id=v_bank.operation_id;
 SELECT * INTO v_event FROM app.refund_event WHERE id=NEW.refund_event_id;
 IF v_registration.id IS NULL OR v_bank.id IS NULL OR v_provider.id IS NULL OR v_event.id IS NULL
    OR NEW.refund_id IS DISTINCT FROM v_registration.refund_id OR NEW.refund_id IS DISTINCT FROM v_provider.refund_id
    OR NEW.refund_id IS DISTINCT FROM v_event.refund_id OR NEW.revision IS DISTINCT FROM v_event.revision
    OR v_event.source_kind<>'provider' OR v_event.source_id IS DISTINCT FROM NEW.event_id
    OR NEW.outcome IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirmed' WHEN 'failed' THEN 'failed' ELSE NULL END)
    OR NEW.cash_transaction_id IS DISTINCT FROM v_event.cash_transaction_id
 THEN RAISE EXCEPTION 'Refund callback result retains its exact historical outcome/event revision rather than a later head' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_result_guard BEFORE INSERT ON app.refund_event_result FOR EACH ROW EXECUTE FUNCTION app.guard_refund_result();

--> statement-breakpoint
CREATE FUNCTION app.assert_refund(p_refund_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
  SELECT coalesce(sum(merchandise_refunded),0),count(*) INTO v_cumulative,v_history FROM app.refund_adjustment_intent
    WHERE receipt_id=v_intent.receipt_id AND sequence<=v_intent.sequence;
  IF v_intent.sequence<>v_history OR v_intent.retained_merchandise::numeric IS DISTINCT FROM v_receipt.merchandise_amount::numeric-v_cumulative
     OR v_intent.merchandise_refunded::numeric IS DISTINCT FROM (SELECT sum(a.merchandise_amount) FROM app.refund_allocation a WHERE a.refund_id=p_refund_id AND a.receipt_id=v_intent.receipt_id)
     OR v_intent.original_occurred_at IS DISTINCT FROM v_receipt.occurred_at OR v_intent.confirmed_at IS DISTINCT FROM v_bank.occurred_at
  THEN RAISE EXCEPTION 'Historical refund adjustment retains its original increment and sequence-specific retained value' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION app.seal_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund_id uuid; v_job app.outbox_job; v_registration app.refund_provider_event; v_result app.refund_event_result;
 v_provider app.local_refund_operation;
BEGIN
 IF TG_TABLE_NAME='refund' THEN v_refund_id:=NEW.id;
 ELSIF TG_TABLE_NAME='local_refund_event' THEN SELECT refund_id INTO v_refund_id FROM app.local_refund_operation WHERE id=NEW.operation_id;
 ELSIF TG_TABLE_NAME='outbox_job' THEN
  SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.id;
  IF v_job.kind='refund.create' THEN
   SELECT id INTO v_refund_id FROM app.refund WHERE id::text=v_job.payload->>'refundId';
   SELECT * INTO v_provider FROM app.local_refund_operation WHERE creation_job_id=v_job.id;
   IF (v_job.status='completed' AND (v_provider.id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('operation_id',v_provider.id)))
      OR (v_job.status='failed' AND v_provider.id IS NOT NULL)
   THEN RAISE EXCEPTION 'Refund creation job preserves confirmed request identity or known no-effect failure' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO v_registration FROM app.refund_provider_event WHERE callback_job_id=v_job.id;
   v_refund_id:=v_registration.refund_id;
   SELECT * INTO v_result FROM app.refund_event_result WHERE event_id=v_registration.id;
   IF v_registration.id IS NULL
      OR (v_job.status='completed' AND (v_result.event_id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_registration.id,'refund_id',v_result.refund_id,'outcome',v_result.outcome,'version',v_result.revision)))
      OR (v_job.status<>'completed' AND v_result.event_id IS NOT NULL)
   THEN RAISE EXCEPTION 'Refund callback completion atomically retains its exact historical result' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE v_refund_id:=NEW.refund_id;
 END IF;
 IF v_refund_id IS NULL THEN RAISE EXCEPTION 'Refund source/job must retain its registered original obligation' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_refund(v_refund_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_sealed AFTER INSERT OR UPDATE ON app.refund DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_refund();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_job_sealed AFTER INSERT OR UPDATE ON app.outbox_job DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.kind IN ('refund.create','refund.callback')) EXECUTE FUNCTION app.seal_refund();
--> statement-breakpoint
DO $$
DECLARE v_relation text;
BEGIN
 FOREACH v_relation IN ARRAY ARRAY['refund_allocation','refund_event','local_refund_destination','local_refund_operation','local_refund_event','refund_provider_event','refund_event_result','refund_adjustment_intent'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON app.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_refund()',v_relation||'_sealed',v_relation);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',v_relation||'_immutable',v_relation);
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_refund_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund_id uuid;
BEGIN
 IF (NEW.id,NEW.kind,NEW.dedup_key,NEW.payload,NEW.max_attempts) IS DISTINCT FROM (OLD.id,OLD.kind,OLD.dedup_key,OLD.payload,OLD.max_attempts)
    OR (OLD.status='completed' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Original refund job identity and completed result are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.kind='refund.create' THEN
  IF NEW.attempts<OLD.attempts OR (OLD.status='failed' AND NEW.status<>OLD.status)
     OR (OLD.status='unknown' AND NEW.status='pending')
  THEN RAISE EXCEPTION 'Refund request recovery preserves fenced attempts; known failed requests need a new approved attempt' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.attempts<OLD.attempts OR (OLD.status IN ('failed','unknown') AND NEW.status='pending') THEN
   SELECT refund_id INTO v_refund_id FROM app.refund_provider_event WHERE callback_job_id=OLD.id;
   IF NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.action='local.refund.reconcile' AND a.subject_id=v_refund_id::text
      AND a.outcome='allowed' AND a.created_at>=transaction_timestamp() AND a.details->>'job_id'=OLD.id::text
      AND a.details->>'previous_status'=OLD.status AND a.details->>'previous_attempts'=OLD.attempts::text)
   THEN RAISE EXCEPTION 'Refund callback recovery retains its exact original audited failed attempt' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_job_guard BEFORE UPDATE ON app.outbox_job FOR EACH ROW
 WHEN (OLD.kind IN ('refund.create','refund.callback') OR NEW.kind IN ('refund.create','refund.callback')) EXECUTE FUNCTION app.guard_refund_job();
--> statement-breakpoint
CREATE FUNCTION app.seal_refund_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_journal_id uuid; v_journal app.finance_transaction; v_refund_id uuid;
BEGIN
 IF TG_TABLE_NAME='finance_transaction' THEN v_journal_id:=NEW.id; ELSE v_journal_id:=NEW.transaction_id; END IF;
 SELECT * INTO v_journal FROM app.finance_transaction WHERE id=v_journal_id;
 IF v_journal.kind NOT IN ('refund_obligation','refund_cash') THEN RETURN NULL; END IF;
 SELECT id INTO v_refund_id FROM app.refund WHERE obligation_transaction_id=v_journal_id OR cash_transaction_id=v_journal_id;
 IF v_refund_id IS NULL THEN RAISE EXCEPTION 'Refund journals cannot commit without their exact original obligation/cash transition' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_refund(v_refund_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_journal_sealed AFTER INSERT ON app.finance_transaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_refund_journal();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_posting_sealed AFTER INSERT ON app.finance_posting DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_refund_journal();
--> statement-breakpoint
DO $$
DECLARE v_relation text;
BEGIN
 FOREACH v_relation IN ARRAY ARRAY['return_event','return_item_event','return_goods'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',v_relation||'_immutable',v_relation);
 END LOOP;
END;
$$;
