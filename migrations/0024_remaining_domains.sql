CREATE TABLE "app"."ad_destination_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"destination_version" text DEFAULT 'local-sink-v1' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"public_identifier" text NOT NULL,
	"secret_reference" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"actor_id" text,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ad_destination_config_platform_unique" UNIQUE("platform")
);
--> statement-breakpoint
CREATE TABLE "app"."ad_destination_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"platform" text NOT NULL,
	"destination_version" text NOT NULL,
	"paused" boolean NOT NULL,
	"public_identifier" text NOT NULL,
	"secret_reference" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ad_destination_version_rev_unique" UNIQUE("destination_id","revision")
);
--> statement-breakpoint
CREATE TABLE "app"."admin_export_selection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"scope" text NOT NULL,
	"filter_hash" text NOT NULL,
	"row_ids" jsonb NOT NULL,
	"token_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "admin_export_selection_token_digest_unique" UNIQUE("token_digest")
);
--> statement-breakpoint
CREATE TABLE "app"."affiliate_beneficiary_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"account_holder" text NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"operation_id" uuid NOT NULL,
	"proof_digest" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "affiliate_beneficiary_change_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "affiliate_beneficiary_change_rev_unique" UNIQUE("affiliate_id","revision")
);
--> statement-breakpoint
CREATE TABLE "app"."affiliate_payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"amount_idr" bigint NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"execution_mode" text DEFAULT 'manual' NOT NULL,
	"beneficiary_snapshot" jsonb NOT NULL,
	"claimed_by_user_id" text,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"transfer_reference" text,
	"transferred_at" timestamp with time zone,
	"evidence_artifact_id" uuid,
	"verified_by_user_id" text,
	"verified_at" timestamp with time zone,
	"finance_transaction_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."affiliate_payout_entry" (
	"payout_id" uuid NOT NULL,
	"commission_entry_id" uuid NOT NULL,
	"allocated_amount_idr" bigint NOT NULL,
	CONSTRAINT "affiliate_payout_entry_payout_id_commission_entry_id_pk" PRIMARY KEY("payout_id","commission_entry_id"),
	CONSTRAINT "affiliate_payout_entry_commission_entry_id_unique" UNIQUE("commission_entry_id")
);
--> statement-breakpoint
CREATE TABLE "app"."affiliate_payout_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"actor_id" text,
	"operation_id" uuid,
	"details" jsonb NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "affiliate_payout_event_rev_unique" UNIQUE("payout_id","revision")
);
--> statement-breakpoint
CREATE TABLE "app"."affiliate_profile" (
	"affiliate_id" uuid PRIMARY KEY NOT NULL,
	"referral_code" text NOT NULL,
	"display_name" text NOT NULL,
	"beneficiary_bank_code" text NOT NULL,
	"beneficiary_account_number" text NOT NULL,
	"beneficiary_account_holder" text NOT NULL,
	"beneficiary_status" text DEFAULT 'verified' NOT NULL,
	"beneficiary_revision" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "affiliate_profile_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "app"."buyer_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"street" text NOT NULL,
	"province" text NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"subdistrict" text NOT NULL,
	"postcode" text NOT NULL,
	"destination_code" text NOT NULL,
	"rt_rw" text,
	"landmark" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."buyer_identity_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"target_value" text NOT NULL,
	"order_id" uuid,
	"code_digest" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."buyer_notification_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"order_updates_in_app" boolean DEFAULT true NOT NULL,
	"order_updates_email" boolean DEFAULT true NOT NULL,
	"support_replies_in_app" boolean DEFAULT true NOT NULL,
	"promotions_in_app" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."buyer_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"email" text,
	"address_book_revision" integer DEFAULT 0 NOT NULL,
	"default_address_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."commission_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"delta_idr" bigint NOT NULL,
	"status_after" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_adjustment_rev_unique" UNIQUE("commission_entry_id","revision")
);
--> statement-breakpoint
CREATE TABLE "app"."commission_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"fulfillment_item_id" uuid NOT NULL,
	"replacement_link_id" uuid,
	"affiliate_id" uuid NOT NULL,
	"basis_points" integer NOT NULL,
	"merchandise_amount" bigint DEFAULT 99000 NOT NULL,
	"amount_idr" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hold_reason" text,
	"receipt_anchor" timestamp with time zone,
	"available_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_entry_fulfillment_item_id_unique" UNIQUE("fulfillment_item_id")
);
--> statement-breakpoint
CREATE TABLE "app"."finance_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"amount_idr" bigint NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"period_key" text NOT NULL,
	"evidence_reference" text,
	"transaction_id" uuid,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."guest_support_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_digest" text NOT NULL,
	"guest_id" uuid,
	"order_id" uuid,
	"contact_value" text,
	"contact_verified_at" timestamp with time zone,
	"linked_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "guest_support_identity_token_digest_unique" UNIQUE("token_digest")
);
--> statement-breakpoint
CREATE TABLE "app"."order_attribution" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"referral_touch_id" uuid NOT NULL,
	"rate_version_id" uuid,
	"policy_version_id" uuid,
	"basis_points" integer NOT NULL,
	"attributed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."referral_touch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"referral_code" text NOT NULL,
	"visitor_id" uuid,
	"buyer_user_id" text,
	"guest_id" uuid,
	"source_path" text,
	"touched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "referral_touch_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."return_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"uploader_scope" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."shipping_label_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_job_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"tracking_number" text NOT NULL,
	"format" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"page_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."shipping_label_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"tracking_number" text NOT NULL,
	"template_version_id" uuid NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"operation_id" uuid NOT NULL,
	"artifact_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "shipping_label_job_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."shipping_label_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"carrier_code" text NOT NULL,
	"service_code" text NOT NULL,
	"format" text NOT NULL,
	"brand_mode" text NOT NULL,
	"privacy_mode" text NOT NULL,
	"active_revision" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "shipping_label_template_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app"."shipping_label_template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"renderer_version" text NOT NULL,
	"permission_evidence" text NOT NULL,
	"disclosure_text" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "shipping_label_template_ver_unique" UNIQUE("template_id","revision")
);
--> statement-breakpoint
CREATE TABLE "app"."shipping_print_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"reported_outcome" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."shipping_print_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"format" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."shipping_print_batch_item" (
	"batch_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label_job_id" uuid,
	"artifact_id" uuid,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "shipping_print_batch_item_batch_id_shipment_id_pk" PRIMARY KEY("batch_id","shipment_id")
);
--> statement-breakpoint
CREATE TABLE "app"."support_assignment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"previous_user_id" text,
	"assigned_user_id" text,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."support_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"uploader_scope" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"scan_status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."support_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"actor_scope" text NOT NULL,
	"target_reference" text NOT NULL,
	"order_id" uuid,
	"conversation_id" uuid,
	"code_digest" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."support_context_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."support_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_user_id" text,
	"guest_support_id" uuid,
	"primary_product_id" uuid,
	"primary_order_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_user_id" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"public_sequence" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_public_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."support_conversation_tag" (
	"conversation_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_conversation_tag_conversation_id_tag_id_pk" PRIMARY KEY("conversation_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "app"."support_in_app_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_scope" text NOT NULL,
	"event_key" text NOT NULL,
	"conversation_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"state" text DEFAULT 'unread' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_in_app_notification_unique" UNIQUE("recipient_scope","event_key")
);
--> statement-breakpoint
CREATE TABLE "app"."support_internal_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"client_note_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_internal_note_client_unique" UNIQUE("conversation_id","author_user_id","client_note_id")
);
--> statement-breakpoint
CREATE TABLE "app"."support_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"public_sequence" integer NOT NULL,
	"sender_side" text NOT NULL,
	"sender_user_id" text,
	"sender_guest_id" uuid,
	"client_message_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"body" text NOT NULL,
	"reply_to_message_id" uuid,
	"redacted_at" timestamp with time zone,
	"redacted_reason" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_message_seq_unique" UNIQUE("conversation_id","public_sequence"),
	CONSTRAINT "support_message_client_unique" UNIQUE("conversation_id","sender_side","client_message_id")
);
--> statement-breakpoint
CREATE TABLE "app"."support_participant_preference" (
	"conversation_id" uuid NOT NULL,
	"participant_scope" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_participant_preference_conversation_id_participant_scope_pk" PRIMARY KEY("conversation_id","participant_scope")
);
--> statement-breakpoint
CREATE TABLE "app"."support_read_position" (
	"conversation_id" uuid NOT NULL,
	"participant_scope" text NOT NULL,
	"reader_side" text NOT NULL,
	"last_read_sequence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_read_position_conversation_id_participant_scope_pk" PRIMARY KEY("conversation_id","participant_scope")
);
--> statement-breakpoint
CREATE TABLE "app"."support_saved_reply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body_template" text NOT NULL,
	"placeholders" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_saved_reply_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."support_tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_tag_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "app"."ad_destination_version" ADD CONSTRAINT "ad_destination_version_destination_id_ad_destination_config_id_fk" FOREIGN KEY ("destination_id") REFERENCES "app"."ad_destination_config"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admin_export_selection" ADD CONSTRAINT "admin_export_selection_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_beneficiary_change" ADD CONSTRAINT "affiliate_beneficiary_change_affiliate_id_affiliate_account_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "app"."affiliate_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout" ADD CONSTRAINT "affiliate_payout_affiliate_id_affiliate_account_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "app"."affiliate_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout" ADD CONSTRAINT "affiliate_payout_finance_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("finance_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout_entry" ADD CONSTRAINT "affiliate_payout_entry_payout_id_affiliate_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "app"."affiliate_payout"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout_entry" ADD CONSTRAINT "affiliate_payout_entry_commission_entry_id_commission_entry_id_fk" FOREIGN KEY ("commission_entry_id") REFERENCES "app"."commission_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout_event" ADD CONSTRAINT "affiliate_payout_event_payout_id_affiliate_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "app"."affiliate_payout"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affiliate_profile" ADD CONSTRAINT "affiliate_profile_affiliate_id_affiliate_account_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "app"."affiliate_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."buyer_address" ADD CONSTRAINT "buyer_address_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."buyer_identity_challenge" ADD CONSTRAINT "buyer_identity_challenge_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."buyer_notification_preference" ADD CONSTRAINT "buyer_notification_preference_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."buyer_profile" ADD CONSTRAINT "buyer_profile_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_adjustment" ADD CONSTRAINT "commission_adjustment_commission_entry_id_commission_entry_id_fk" FOREIGN KEY ("commission_entry_id") REFERENCES "app"."commission_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_entry" ADD CONSTRAINT "commission_entry_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_entry" ADD CONSTRAINT "commission_entry_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "app"."order_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_entry" ADD CONSTRAINT "commission_entry_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_entry" ADD CONSTRAINT "commission_entry_affiliate_id_affiliate_account_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "app"."affiliate_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."finance_expense" ADD CONSTRAINT "finance_expense_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."finance_expense" ADD CONSTRAINT "finance_expense_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_attribution" ADD CONSTRAINT "order_attribution_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_attribution" ADD CONSTRAINT "order_attribution_affiliate_id_affiliate_account_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "app"."affiliate_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_attribution" ADD CONSTRAINT "order_attribution_referral_touch_id_referral_touch_id_fk" FOREIGN KEY ("referral_touch_id") REFERENCES "app"."referral_touch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."referral_touch" ADD CONSTRAINT "referral_touch_affiliate_id_affiliate_account_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "app"."affiliate_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_evidence" ADD CONSTRAINT "return_evidence_case_id_return_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."return_evidence" ADD CONSTRAINT "return_evidence_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_artifact" ADD CONSTRAINT "shipping_label_artifact_label_job_id_shipping_label_job_id_fk" FOREIGN KEY ("label_job_id") REFERENCES "app"."shipping_label_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_artifact" ADD CONSTRAINT "shipping_label_artifact_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_artifact" ADD CONSTRAINT "shipping_label_artifact_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_job" ADD CONSTRAINT "shipping_label_job_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_job" ADD CONSTRAINT "shipping_label_job_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "app"."fulfillment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_job" ADD CONSTRAINT "shipping_label_job_booking_id_shipment_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."shipment_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_job" ADD CONSTRAINT "shipping_label_job_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_job" ADD CONSTRAINT "shipping_label_job_template_version_id_shipping_label_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "app"."shipping_label_template_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_label_template_version" ADD CONSTRAINT "shipping_label_template_version_template_id_shipping_label_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."shipping_label_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_print_attempt" ADD CONSTRAINT "shipping_print_attempt_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_print_attempt" ADD CONSTRAINT "shipping_print_attempt_artifact_id_shipping_label_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "app"."shipping_label_artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_print_attempt" ADD CONSTRAINT "shipping_print_attempt_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_print_batch" ADD CONSTRAINT "shipping_print_batch_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_print_batch_item" ADD CONSTRAINT "shipping_print_batch_item_batch_id_shipping_print_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "app"."shipping_print_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shipping_print_batch_item" ADD CONSTRAINT "shipping_print_batch_item_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_assignment_event" ADD CONSTRAINT "support_assignment_event_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_attachment" ADD CONSTRAINT "support_attachment_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_context_card" ADD CONSTRAINT "support_context_card_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_context_card" ADD CONSTRAINT "support_context_card_message_id_support_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."support_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_conversation" ADD CONSTRAINT "support_conversation_buyer_user_id_auth_user_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_conversation" ADD CONSTRAINT "support_conversation_guest_support_id_guest_support_identity_id_fk" FOREIGN KEY ("guest_support_id") REFERENCES "app"."guest_support_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_conversation" ADD CONSTRAINT "support_conversation_assigned_user_id_auth_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_conversation_tag" ADD CONSTRAINT "support_conversation_tag_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_conversation_tag" ADD CONSTRAINT "support_conversation_tag_tag_id_support_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "app"."support_tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_internal_note" ADD CONSTRAINT "support_internal_note_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_internal_note" ADD CONSTRAINT "support_internal_note_author_user_id_auth_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_message" ADD CONSTRAINT "support_message_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_participant_preference" ADD CONSTRAINT "support_participant_preference_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_read_position" ADD CONSTRAINT "support_read_position_conversation_id_support_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."support_conversation"("id") ON DELETE restrict ON UPDATE no action;