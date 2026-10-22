ALTER TABLE "app"."finance_posting" DROP CONSTRAINT "finance_posting_value_check";--> statement-breakpoint
ALTER TABLE "app"."finance_posting" ADD CONSTRAINT "finance_posting_value_check" CHECK ("app"."finance_posting"."ordinal" between 1 and 100 AND "app"."finance_posting"."account" IN ('provider_receivable','buyer_funds_liability','company_cash','settlement_clearing','carrier_expense','provider_fee_expense','refund_payable','commission_expense','affiliate_payable') AND "app"."finance_posting"."side" IN ('debit','credit') AND "app"."finance_posting"."amount" between 1 and 9007199254740991);--> statement-breakpoint
CREATE TABLE "app"."affiliate_payout_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payout_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"artifact_id" uuid,
	"sha256" text,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "affiliate_payout_evidence_artifact_unique" UNIQUE("artifact_id"),
	CONSTRAINT "affiliate_payout_evidence_value_check" CHECK ("app"."affiliate_payout_evidence"."media_type" IN ('image/jpeg','image/png','application/pdf') AND "app"."affiliate_payout_evidence"."size_bytes" between 1 and 10485760 AND (("app"."affiliate_payout_evidence"."artifact_id" IS NULL) = ("app"."affiliate_payout_evidence"."uploaded_at" IS NULL)) AND (("app"."affiliate_payout_evidence"."artifact_id" IS NULL) = ("app"."affiliate_payout_evidence"."sha256" IS NULL)) AND ("app"."affiliate_payout_evidence"."sha256" IS NULL OR "app"."affiliate_payout_evidence"."sha256" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "app"."affiliate_payout_evidence" ADD CONSTRAINT "affiliate_payout_evidence_payout_id_affiliate_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "app"."affiliate_payout"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_payout_evidence_payout_idx" ON "app"."affiliate_payout_evidence" USING btree ("payout_id");
