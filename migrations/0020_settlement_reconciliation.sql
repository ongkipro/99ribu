CREATE TABLE "app"."local_settlement_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_settlement_event_signature_check" CHECK ("app"."local_settlement_event"."signature" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_settlement_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"reference" text NOT NULL,
	"direction" text NOT NULL,
	"net_amount" bigint NOT NULL,
	"clock_namespace" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"request_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_settlement_identity_unique" UNIQUE("provider","environment","reference"),
	CONSTRAINT "local_settlement_operation_value_check" CHECK ("app"."local_settlement_operation"."provider" IN ('local.payment','local.cod') AND "app"."local_settlement_operation"."environment" IN ('local','test') AND "app"."local_settlement_operation"."reference" ~ '^[A-Za-z0-9_.:-]{1,200}$' AND "app"."local_settlement_operation"."direction" IN ('credit','debit') AND "app"."local_settlement_operation"."net_amount" between 0 and 9007199254740991 AND "app"."local_settlement_operation"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_settlement_statement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"gross_amount" bigint,
	"carrier_fee" bigint,
	"provider_fee" bigint,
	"allocation_claims" jsonb,
	"reverses_reference" text,
	"source_reported_at" timestamp with time zone NOT NULL,
	"request_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_settlement_statement_revision_unique" UNIQUE("operation_id","revision"),
	CONSTRAINT "local_settlement_statement_value_check" CHECK ("app"."local_settlement_statement"."revision">0 AND ("app"."local_settlement_statement"."gross_amount" IS NULL OR "app"."local_settlement_statement"."gross_amount" between 1 and 9007199254740991) AND ("app"."local_settlement_statement"."carrier_fee" IS NULL OR "app"."local_settlement_statement"."carrier_fee" between 0 and 9007199254740991) AND ("app"."local_settlement_statement"."provider_fee" IS NULL OR "app"."local_settlement_statement"."provider_fee" between 0 and 9007199254740991) AND ("app"."local_settlement_statement"."allocation_claims" IS NULL OR (jsonb_typeof("app"."local_settlement_statement"."allocation_claims")='array' AND jsonb_array_length("app"."local_settlement_statement"."allocation_claims")<=100)) AND ("app"."local_settlement_statement"."reverses_reference" IS NULL OR "app"."local_settlement_statement"."reverses_reference" ~ '^[A-Za-z0-9_.:-]{1,200}$') AND "app"."local_settlement_statement"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."provider_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"cash_transaction_id" uuid,
	"fee_transaction_id" uuid,
	"applied_fee_statement_id" uuid,
	"current_statement_id" uuid NOT NULL,
	"current_match_id" uuid,
	"last_match_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"problem_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "provider_settlement_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "provider_settlement_cash_transaction_id_unique" UNIQUE("cash_transaction_id"),
	CONSTRAINT "provider_settlement_fee_transaction_id_unique" UNIQUE("fee_transaction_id"),
	CONSTRAINT "provider_settlement_current_match_id_unique" UNIQUE("current_match_id"),
	CONSTRAINT "provider_settlement_state_check" CHECK ("app"."provider_settlement"."revision">=0 AND "app"."provider_settlement"."status" IN ('preparing','pending','partial','matched','mismatched','exception') AND (("app"."provider_settlement"."status"='preparing')=("app"."provider_settlement"."revision"=0)) AND ("app"."provider_settlement"."problem_code" IS NULL OR "app"."provider_settlement"."problem_code" ~ '^[A-Z][A-Z0-9_]{0,99}$') AND ("app"."provider_settlement"."current_match_id" IS NULL OR "app"."provider_settlement"."last_match_id"="app"."provider_settlement"."current_match_id") AND ("app"."provider_settlement"."fee_transaction_id" IS NULL OR "app"."provider_settlement"."applied_fee_statement_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."settlement_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"receivable_transaction_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"receipt_id" uuid,
	"source_basis" text NOT NULL,
	"gross_amount" bigint NOT NULL,
	"net_amount" bigint NOT NULL,
	"carrier_fee" bigint NOT NULL,
	"provider_fee" bigint NOT NULL,
	"reopens_allocation_id" uuid,
	CONSTRAINT "settlement_allocation_ordinal_unique" UNIQUE("match_id","ordinal"),
	CONSTRAINT "settlement_allocation_basis_unique" UNIQUE NULLS NOT DISTINCT("match_id","receivable_transaction_id","reopens_allocation_id"),
	CONSTRAINT "settlement_allocation_value_check" CHECK ("app"."settlement_allocation"."ordinal" between 1 and 100 AND "app"."settlement_allocation"."source_basis" IN ('qualified','recovery') AND (("app"."settlement_allocation"."source_basis"='qualified')=("app"."settlement_allocation"."receipt_id" IS NOT NULL)) AND "app"."settlement_allocation"."gross_amount" between 1 and 9007199254740991 AND "app"."settlement_allocation"."net_amount" between 0 and 9007199254740991 AND "app"."settlement_allocation"."carrier_fee" between 0 and 9007199254740991 AND "app"."settlement_allocation"."provider_fee" between 0 and 9007199254740991 AND "app"."settlement_allocation"."gross_amount"::numeric="app"."settlement_allocation"."net_amount"::numeric+"app"."settlement_allocation"."carrier_fee"::numeric+"app"."settlement_allocation"."provider_fee"::numeric AND "app"."settlement_allocation"."reopens_allocation_id" IS DISTINCT FROM "app"."settlement_allocation"."id")
);
--> statement-breakpoint
CREATE TABLE "app"."settlement_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_id" text,
	"statement_id" uuid NOT NULL,
	"match_id" uuid,
	"fee_transaction_id" uuid,
	"applied_fee_statement_id" uuid,
	"problem_code" text,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "settlement_event_revision_unique" UNIQUE("settlement_id","revision"),
	CONSTRAINT "settlement_event_source_unique" UNIQUE("source_kind","source_id","kind"),
	CONSTRAINT "settlement_event_value_check" CHECK ("app"."settlement_event"."revision">0 AND "app"."settlement_event"."status" IN ('pending','partial','matched','mismatched','exception') AND "app"."settlement_event"."kind" IN ('observe','statement','match','unmatch','escalate') AND "app"."settlement_event"."source_kind" IN ('provider','operation') AND (("app"."settlement_event"."source_kind"='operation')=("app"."settlement_event"."actor_id" IS NOT NULL)) AND char_length("app"."settlement_event"."reason") between 1 and 500 AND ("app"."settlement_event"."problem_code" IS NULL OR "app"."settlement_event"."problem_code" ~ '^[A-Z][A-Z0-9_]{0,99}$') AND ("app"."settlement_event"."fee_transaction_id" IS NULL OR "app"."settlement_event"."applied_fee_statement_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."settlement_event_result" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"settlement_id" uuid NOT NULL,
	"head_revision" integer NOT NULL,
	"outcome" text NOT NULL,
	"settlement_event_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "settlement_event_result_value_check" CHECK ("app"."settlement_event_result"."head_revision">0 AND "app"."settlement_event_result"."outcome" IN ('observed','matched','partial','unmatched','exception','older','duplicate') AND (("app"."settlement_event_result"."outcome" IN ('older','duplicate'))=("app"."settlement_event_result"."settlement_event_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."settlement_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_id" text,
	"correction_of" uuid,
	"reversal_transaction_id" uuid,
	"reversed_by_operation_id" uuid,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "settlement_match_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "settlement_match_correction_of_unique" UNIQUE("correction_of"),
	CONSTRAINT "settlement_match_reversal_transaction_id_unique" UNIQUE("reversal_transaction_id"),
	CONSTRAINT "settlement_match_value_check" CHECK ("app"."settlement_match"."source_kind" IN ('provider','operation') AND (("app"."settlement_match"."source_kind"='operation')=("app"."settlement_match"."actor_id" IS NOT NULL)) AND "app"."settlement_match"."correction_of" IS DISTINCT FROM "app"."settlement_match"."id" AND (("app"."settlement_match"."reversal_transaction_id" IS NULL)=("app"."settlement_match"."reversed_by_operation_id" IS NULL)) AND char_length("app"."settlement_match"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."settlement_provider_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"callback_job_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "settlement_provider_event_callback_job_id_unique" UNIQUE("callback_job_id"),
	CONSTRAINT "settlement_provider_event_hash_check" CHECK ("app"."settlement_provider_event"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."finance_posting" DROP CONSTRAINT "finance_posting_value_check";--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" DROP CONSTRAINT "finance_transaction_kind_check";--> statement-breakpoint
ALTER TABLE "app"."local_settlement_event" ADD CONSTRAINT "local_settlement_event_statement_id_local_settlement_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "app"."local_settlement_statement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_settlement_operation" ADD CONSTRAINT "local_settlement_operation_clock_namespace_local_fixture_namespace_name_fk" FOREIGN KEY ("clock_namespace") REFERENCES "app"."local_fixture_namespace"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_settlement_statement" ADD CONSTRAINT "local_settlement_statement_operation_id_local_settlement_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_settlement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_operation_id_local_settlement_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_settlement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_cash_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_fee_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("fee_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_applied_fee_statement_id_local_settlement_statement_id_fk" FOREIGN KEY ("applied_fee_statement_id") REFERENCES "app"."local_settlement_statement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_current_statement_id_local_settlement_statement_id_fk" FOREIGN KEY ("current_statement_id") REFERENCES "app"."local_settlement_statement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_current_match_id_settlement_match_id_fk" FOREIGN KEY ("current_match_id") REFERENCES "app"."settlement_match"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement" ADD CONSTRAINT "provider_settlement_last_match_id_settlement_match_id_fk" FOREIGN KEY ("last_match_id") REFERENCES "app"."settlement_match"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_allocation" ADD CONSTRAINT "settlement_allocation_match_id_settlement_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "app"."settlement_match"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_allocation" ADD CONSTRAINT "settlement_allocation_receivable_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("receivable_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_allocation" ADD CONSTRAINT "settlement_allocation_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_allocation" ADD CONSTRAINT "settlement_allocation_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_allocation" ADD CONSTRAINT "settlement_allocation_reopens_allocation_id_settlement_allocation_id_fk" FOREIGN KEY ("reopens_allocation_id") REFERENCES "app"."settlement_allocation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event" ADD CONSTRAINT "settlement_event_settlement_id_provider_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "app"."provider_settlement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event" ADD CONSTRAINT "settlement_event_statement_id_local_settlement_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "app"."local_settlement_statement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event" ADD CONSTRAINT "settlement_event_match_id_settlement_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "app"."settlement_match"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event" ADD CONSTRAINT "settlement_event_fee_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("fee_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event" ADD CONSTRAINT "settlement_event_applied_fee_statement_id_local_settlement_statement_id_fk" FOREIGN KEY ("applied_fee_statement_id") REFERENCES "app"."local_settlement_statement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event_result" ADD CONSTRAINT "settlement_event_result_event_id_settlement_provider_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."settlement_provider_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event_result" ADD CONSTRAINT "settlement_event_result_settlement_id_provider_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "app"."provider_settlement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_event_result" ADD CONSTRAINT "settlement_event_result_settlement_event_id_settlement_event_id_fk" FOREIGN KEY ("settlement_event_id") REFERENCES "app"."settlement_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_match" ADD CONSTRAINT "settlement_match_settlement_id_provider_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "app"."provider_settlement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_match" ADD CONSTRAINT "settlement_match_statement_id_local_settlement_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "app"."local_settlement_statement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_match" ADD CONSTRAINT "settlement_match_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_match" ADD CONSTRAINT "settlement_match_correction_of_settlement_match_id_fk" FOREIGN KEY ("correction_of") REFERENCES "app"."settlement_match"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_match" ADD CONSTRAINT "settlement_match_reversal_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "app"."finance_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_match" ADD CONSTRAINT "settlement_match_reversed_by_operation_id_access_operation_id_fk" FOREIGN KEY ("reversed_by_operation_id") REFERENCES "app"."access_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_provider_event" ADD CONSTRAINT "settlement_provider_event_id_local_settlement_event_id_fk" FOREIGN KEY ("id") REFERENCES "app"."local_settlement_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_provider_event" ADD CONSTRAINT "settlement_provider_event_operation_id_local_settlement_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_settlement_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlement_provider_event" ADD CONSTRAINT "settlement_provider_event_callback_job_id_outbox_job_id_fk" FOREIGN KEY ("callback_job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_settlement_event_statement_idx" ON "app"."local_settlement_event" USING btree ("statement_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "provider_settlement_queue_idx" ON "app"."provider_settlement" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "settlement_allocation_receivable_idx" ON "app"."settlement_allocation" USING btree ("receivable_transaction_id","match_id");--> statement-breakpoint
CREATE INDEX "settlement_allocation_reopening_idx" ON "app"."settlement_allocation" USING btree ("reopens_allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_match_active_unique" ON "app"."settlement_match" USING btree ("settlement_id") WHERE "app"."settlement_match"."reversal_transaction_id" IS NULL;--> statement-breakpoint
ALTER TABLE "app"."finance_posting" ADD CONSTRAINT "finance_posting_value_check" CHECK ("app"."finance_posting"."ordinal" between 1 and 100 AND "app"."finance_posting"."account" IN ('provider_receivable','buyer_funds_liability','company_cash','settlement_clearing','carrier_expense','provider_fee_expense') AND "app"."finance_posting"."side" IN ('debit','credit') AND "app"."finance_posting"."amount" between 1 and 9007199254740991);--> statement-breakpoint
ALTER TABLE "app"."finance_transaction" ADD CONSTRAINT "finance_transaction_kind_check" CHECK ("app"."finance_transaction"."kind" IN ('economic_receipt','adjustment','reversal','settlement_cash','settlement_fee','settlement_match') AND (("app"."finance_transaction"."kind"='reversal')=("app"."finance_transaction"."reverses_id" IS NOT NULL)) AND "app"."finance_transaction"."reverses_id" IS DISTINCT FROM "app"."finance_transaction"."id");
--> statement-breakpoint
ALTER TABLE app.role_grant DROP CONSTRAINT role_grant_finance_check;
--> statement-breakpoint
ALTER TABLE app.role_grant ADD CONSTRAINT role_grant_finance_check CHECK (NOT (permissions && ARRAY['finance.summary.read','finance.costs.read','finance.costs.write','finance.reconciliation.read','finance.reconciliation.write']::text[]) OR roles && ARRAY['owner','finance']::text[]);
--> statement-breakpoint
-- Unapplied S30 candidate. Source, monetary, head and callback seals require
-- independent review and rollback-only proof before permanent application.
CREATE FUNCTION app.guard_local_settlement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_database()<>'99ribu_'||NEW.environment OR NOT isfinite(NEW.occurred_at)
  OR NEW.occurred_at<timestamptz '0001-01-01 00:00:00+00'
  OR NEW.occurred_at>app.reservation_clock(NEW.clock_namespace)
 THEN RAISE EXCEPTION 'Settlement money time and source profile must be valid' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_settlement_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m app.settlement_match; h app.finance_transaction;
BEGIN
 SELECT * INTO m FROM app.settlement_match WHERE id=NEW.match_id;
 SELECT * INTO h FROM app.finance_transaction WHERE id=m.transaction_id;
 IF h.id IS NULL OR h.created_xid<>pg_current_xact_id()::text
 THEN RAISE EXCEPTION 'Historical matching allocations are sealed' USING ERRCODE='23514'; END IF;
 -- All writers serialize capacity against the original journal, including a
 -- competing full reversal. The application prelocks multi-row sets in order.
 PERFORM id FROM app.finance_transaction WHERE id=NEW.receivable_transaction_id FOR UPDATE;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_allocation_guard BEFORE INSERT ON app.settlement_allocation FOR EACH ROW EXECUTE FUNCTION app.guard_settlement_allocation();
--> statement-breakpoint
CREATE FUNCTION app.assert_settlement_receivable(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE original app.finance_transaction; available numeric; allocated numeric;
BEGIN
 SELECT * INTO original FROM app.finance_transaction WHERE id=selected FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO available FROM app.finance_posting WHERE transaction_id=selected AND account='provider_receivable' AND side='debit';
 SELECT coalesce(sum(CASE o.direction WHEN 'credit' THEN a.gross_amount::numeric ELSE -a.gross_amount::numeric END),0)
 INTO allocated FROM app.settlement_allocation a JOIN app.settlement_match m ON m.id=a.match_id
 JOIN app.provider_settlement p ON p.id=m.settlement_id JOIN app.local_settlement_operation o ON o.id=p.operation_id
 WHERE a.receivable_transaction_id=selected AND m.reversal_transaction_id IS NULL;
 IF allocated<0 OR allocated>available OR (allocated<>0 AND EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=selected))
 THEN RAISE EXCEPTION 'Active settlement conserves its original unreversed receivable' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_settlement_original_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.reverses_id IS NOT NULL THEN
  PERFORM id FROM app.finance_transaction WHERE id=NEW.reverses_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM app.settlement_allocation a JOIN app.settlement_match m ON m.id=a.match_id
   WHERE a.receivable_transaction_id=NEW.reverses_id AND m.reversal_transaction_id IS NULL)
  THEN RAISE EXCEPTION 'Unmatch active original receivable allocations before full reversal' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_original_reversal_guard BEFORE INSERT ON app.finance_transaction FOR EACH ROW EXECUTE FUNCTION app.guard_settlement_original_reversal();
--> statement-breakpoint
CREATE FUNCTION app.guard_settlement_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid; journal app.finance_transaction;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Matching history cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO journal FROM app.finance_transaction WHERE id=NEW.transaction_id;
 IF TG_OP='INSERT' THEN
  IF NEW.reversal_transaction_id IS NOT NULL OR NEW.reversed_by_operation_id IS NOT NULL
   OR journal.created_xid<>pg_current_xact_id()::text
  THEN RAISE EXCEPTION 'A new match commits with its original journal' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-ARRAY['reversal_transaction_id','reversed_by_operation_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['reversal_transaction_id','reversed_by_operation_id'])
   OR OLD.reversal_transaction_id IS NOT NULL OR NEW.reversal_transaction_id IS NULL OR NEW.reversed_by_operation_id IS NULL
  THEN RAISE EXCEPTION 'Match correction only appends its original full reversal' USING ERRCODE='23514'; END IF;
  FOR selected IN SELECT DISTINCT receivable_transaction_id FROM app.settlement_allocation WHERE match_id=OLD.id ORDER BY receivable_transaction_id LOOP
   PERFORM id FROM app.finance_transaction WHERE id=selected FOR UPDATE;
  END LOOP;
  IF EXISTS(SELECT 1 FROM app.settlement_allocation a JOIN app.settlement_allocation child ON child.reopens_allocation_id=a.id
   JOIN app.settlement_match m ON m.id=child.match_id WHERE a.match_id=OLD.id AND m.reversal_transaction_id IS NULL)
  THEN RAISE EXCEPTION 'Reverse dependent reopening matches before correcting their original match' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_match_guard BEFORE INSERT OR UPDATE OR DELETE ON app.settlement_match FOR EACH ROW EXECUTE FUNCTION app.guard_settlement_match();
--> statement-breakpoint
CREATE FUNCTION app.assert_settlement_match(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m app.settlement_match; p app.provider_settlement; o app.local_settlement_operation; s app.local_settlement_statement;
 journal app.finance_transaction; original app.finance_transaction; receipt app.economic_receipt; a app.settlement_allocation;
 parent app.settlement_allocation; parent_match app.settlement_match; parent_source app.local_settlement_operation;
 count_rows int; total numeric; used record; basis_valid boolean;
BEGIN
 SELECT * INTO m FROM app.settlement_match WHERE id=selected;
 SELECT * INTO p FROM app.provider_settlement WHERE id=m.settlement_id;
 SELECT * INTO o FROM app.local_settlement_operation WHERE id=p.operation_id;
 SELECT * INTO s FROM app.local_settlement_statement WHERE id=m.statement_id;
 SELECT * INTO journal FROM app.finance_transaction WHERE id=m.transaction_id;
 SELECT count(*),coalesce(sum(gross_amount),0) INTO count_rows,total FROM app.settlement_allocation WHERE match_id=m.id;
 IF m.id IS NULL OR s.operation_id IS DISTINCT FROM o.id OR s.gross_amount IS NULL OR s.carrier_fee IS NULL OR s.provider_fee IS NULL
  OR s.gross_amount::numeric<>o.net_amount::numeric+s.carrier_fee::numeric+s.provider_fee::numeric
  OR count_rows NOT BETWEEN 1 AND 100 OR total>s.gross_amount
  OR journal.kind<>'settlement_match' OR journal.source<>'local.settlement' OR journal.environment<>o.environment
  OR journal.order_id IS NOT NULL OR journal.effect_reference<>'match:'||m.id::text OR journal.occurred_at<>m.occurred_at
  OR m.occurred_at<o.occurred_at OR m.occurred_at>app.reservation_clock(o.clock_namespace)
 THEN RAISE EXCEPTION 'Match requires complete original statement, allocations and original matching journal' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.settlement_event event WHERE event.match_id=m.id AND event.settlement_id=m.settlement_id
  AND event.source_kind=m.source_kind AND event.source_id=m.source_id AND event.statement_id=m.statement_id)
 THEN RAISE EXCEPTION 'Original matching classification has its immutable source transition' USING ERRCODE='23514'; END IF;
 IF m.source_kind='provider' AND (
  s.allocation_claims IS NULL OR
  (SELECT jsonb_agg(jsonb_build_object('receivable_transaction_id',portion.receivable_transaction_id,'gross_amount',portion.gross_amount,'reopens_allocation_id',portion.reopens_allocation_id)
   ORDER BY (portion.receivable_transaction_id::text||':'||coalesce(portion.reopens_allocation_id::text,'')) COLLATE "C") FROM app.settlement_allocation portion WHERE portion.match_id=m.id)
  IS DISTINCT FROM (SELECT jsonb_agg(claim ORDER BY (claim->>'receivable_transaction_id'||':'||coalesce(claim->>'reopens_allocation_id','')) COLLATE "C") FROM jsonb_array_elements(s.allocation_claims) AS source_claim(claim))
 ) THEN RAISE EXCEPTION 'Automatic matching preserves every exact authenticated original allocation claim' USING ERRCODE='23514'; END IF;
 IF m.correction_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.settlement_match previous WHERE previous.id=m.correction_of
  AND previous.settlement_id=m.settlement_id AND previous.reversal_transaction_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Correction preserves the previous reversed match in the same settlement' USING ERRCODE='23514'; END IF;
 IF m.reversal_transaction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.finance_transaction r JOIN app.access_operation op ON op.id=m.reversed_by_operation_id
  WHERE r.id=m.reversal_transaction_id AND r.kind='reversal' AND r.reverses_id=m.transaction_id AND op.action='finance.reconcile')
 THEN RAISE EXCEPTION 'Match reversal binds the original journal and scoped operation' USING ERRCODE='23514'; END IF;
 FOR a IN SELECT * FROM app.settlement_allocation WHERE match_id=m.id ORDER BY receivable_transaction_id,reopens_allocation_id NULLS FIRST LOOP
  SELECT * INTO original FROM app.finance_transaction WHERE id=a.receivable_transaction_id FOR UPDATE;
  SELECT * INTO receipt FROM app.economic_receipt WHERE id=a.receipt_id;
  IF original.order_id IS DISTINCT FROM a.order_id OR original.environment<>o.environment OR original.occurred_at>o.occurred_at
   OR (o.clock_namespace IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.commerce_order r WHERE r.id=a.order_id AND r.clock_namespace=o.clock_namespace))
   OR original.source<>(CASE a.source_basis WHEN 'qualified' THEN o.provider ELSE o.provider||'.recovery' END)
   OR original.kind<>(CASE a.source_basis WHEN 'qualified' THEN 'economic_receipt' ELSE 'adjustment' END)
   OR (a.source_basis='qualified' AND (receipt.transaction_id IS DISTINCT FROM original.id OR receipt.order_id IS DISTINCT FROM a.order_id))
  THEN RAISE EXCEPTION 'Allocation uses the original provider, order, clock and receipt/recovery basis' USING ERRCODE='23514'; END IF;
  IF o.provider='local.payment' THEN
   SELECT EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.local_payment_event e ON e.id=r.event_id
    JOIN app.local_payment_operation source ON source.id=e.operation_id JOIN app.payment_attempt attempt ON attempt.id=source.attempt_id
    WHERE r.transaction_id=original.id AND r.outcome IN ('confirmed','recovery') AND r.receipt_id IS NOT DISTINCT FROM a.receipt_id
    AND e.status='confirmed' AND original.effect_reference=source.id::text AND original.environment=source.environment
    AND original.order_id=attempt.order_id AND original.occurred_at=e.occurred_at) INTO basis_valid;
  ELSE
   SELECT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.local_cod_event e ON e.id=r.event_id
    JOIN app.local_cod_operation source ON source.id=e.operation_id JOIN app.order_shipment parcel ON parcel.id=source.shipment_id
    WHERE r.transaction_id=original.id AND r.outcome IN ('collected','recovery') AND r.receipt_id IS NOT DISTINCT FROM a.receipt_id
    AND e.status='collected' AND original.effect_reference=source.id::text AND original.environment=source.environment
    AND original.order_id=parcel.order_id AND original.occurred_at=e.occurred_at) INTO basis_valid;
  END IF;
  IF NOT basis_valid THEN RAISE EXCEPTION 'Arbitrary balanced journals do not prove collection' USING ERRCODE='23514'; END IF;
  IF o.direction='credit' THEN
   IF a.reopens_allocation_id IS NOT NULL OR s.reverses_reference IS NOT NULL
   THEN RAISE EXCEPTION 'Forward remittance cannot reopen a previous allocation' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO parent FROM app.settlement_allocation WHERE id=a.reopens_allocation_id;
   SELECT * INTO parent_match FROM app.settlement_match WHERE id=parent.match_id;
   SELECT source.* INTO parent_source FROM app.provider_settlement h JOIN app.local_settlement_operation source ON source.id=h.operation_id WHERE h.id=parent_match.settlement_id;
   IF parent.id IS NULL OR parent.reopens_allocation_id IS NOT NULL OR (m.reversal_transaction_id IS NULL AND parent_match.reversal_transaction_id IS NOT NULL)
    OR parent.receivable_transaction_id<>a.receivable_transaction_id OR parent_source.direction<>'credit'
    OR (parent_source.provider,parent_source.environment,parent_source.reference) IS DISTINCT FROM (o.provider,o.environment,s.reverses_reference)
    OR parent_source.occurred_at>o.occurred_at
   THEN RAISE EXCEPTION 'Reopening identifies its original active credited allocation' USING ERRCODE='23514'; END IF;
   SELECT coalesce(sum(child.gross_amount),0) gross,coalesce(sum(child.net_amount),0) net,
    coalesce(sum(child.carrier_fee),0) carrier,coalesce(sum(child.provider_fee),0) provider INTO used
   FROM app.settlement_allocation child JOIN app.settlement_match current ON current.id=child.match_id
   WHERE child.reopens_allocation_id=parent.id AND current.reversal_transaction_id IS NULL;
   IF used.gross>parent.gross_amount OR used.net>parent.net_amount OR used.carrier>parent.carrier_fee OR used.provider>parent.provider_fee
   THEN RAISE EXCEPTION 'Reopening cannot exceed original gross, cash or either fee category' USING ERRCODE='23514'; END IF;
  END IF;
  PERFORM app.assert_settlement_receivable(a.receivable_transaction_id);
 END LOOP;
 -- The native calculation mirrors exact integer apportionment, including the
 -- explicit unmatched portion and deterministic tie ordering.
 IF EXISTS(
  WITH portions AS (
   SELECT portion.id,portion.receivable_transaction_id::text||':'||coalesce(portion.reopens_allocation_id::text,'') key,portion.gross_amount::numeric gross FROM app.settlement_allocation portion WHERE portion.match_id=m.id
   UNION ALL SELECT NULL::uuid,'~unallocated',s.gross_amount::numeric-total
  ), net_base AS (
   SELECT *,floor(o.net_amount::numeric*gross/s.gross_amount) base,mod(o.net_amount::numeric*gross,s.gross_amount) remainder FROM portions
  ), net_shares AS (
   SELECT *,base+CASE WHEN row_number() OVER(ORDER BY remainder DESC,key COLLATE "C")<=o.net_amount-sum(base) OVER() THEN 1 ELSE 0 END net FROM net_base
  ), fee_base AS (
   SELECT *,CASE WHEN s.gross_amount=o.net_amount THEN 0 ELSE floor(s.carrier_fee::numeric*(gross-net)/(s.gross_amount-o.net_amount)) END carrier_base,
    CASE WHEN s.gross_amount=o.net_amount THEN 0 ELSE mod(s.carrier_fee::numeric*(gross-net),(s.gross_amount-o.net_amount)) END carrier_remainder FROM net_shares
  ), final AS (
   SELECT *,carrier_base+CASE WHEN row_number() OVER(ORDER BY carrier_remainder DESC,key COLLATE "C")<=s.carrier_fee-sum(carrier_base) OVER() THEN 1 ELSE 0 END carrier FROM fee_base
  ) SELECT 1 FROM final f JOIN app.settlement_allocation actual ON actual.id=f.id
  WHERE (actual.net_amount::numeric,actual.carrier_fee::numeric,actual.provider_fee::numeric) IS DISTINCT FROM (f.net,f.carrier,f.gross-f.net-f.carrier)
 ) THEN RAISE EXCEPTION 'Matching attribution conserves stable exact net and fees' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_settlement_operation_guard BEFORE INSERT ON app.local_settlement_operation FOR EACH ROW EXECUTE FUNCTION app.guard_local_settlement_operation();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_settlement_statement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.local_settlement_operation; previous app.local_settlement_statement; claim jsonb;
BEGIN
 SELECT * INTO o FROM app.local_settlement_operation WHERE id=NEW.operation_id FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Original settlement money observation is required' USING ERRCODE='23503'; END IF;
 SELECT * INTO previous FROM app.local_settlement_statement WHERE operation_id=o.id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision::bigint<>coalesce(previous.revision::bigint,0)+1
  OR NOT isfinite(NEW.source_reported_at) OR NEW.source_reported_at<o.occurred_at
  OR NEW.source_reported_at>app.reservation_clock(o.clock_namespace)
  OR (previous.id IS NOT NULL AND NEW.source_reported_at<previous.source_reported_at)
 THEN RAISE EXCEPTION 'Statement versions advance under the original observation lock' USING ERRCODE='23514'; END IF;
 IF NEW.allocation_claims IS NOT NULL THEN
  FOR claim IN SELECT value FROM jsonb_array_elements(NEW.allocation_claims) LOOP
   IF jsonb_typeof(claim)<>'object' OR NOT claim ?& ARRAY['receivable_transaction_id','gross_amount','reopens_allocation_id']
    OR (claim-ARRAY['receivable_transaction_id','gross_amount','reopens_allocation_id'])<>'{}'::jsonb
    OR jsonb_typeof(claim->'receivable_transaction_id')<>'string'
    OR (claim->>'receivable_transaction_id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(claim->'gross_amount')<>'number' OR (claim->>'gross_amount')!~'^[1-9][0-9]{0,15}$'
    OR (claim->>'gross_amount')::numeric>9007199254740991
    OR (claim->'reopens_allocation_id'<>'null'::jsonb AND (jsonb_typeof(claim->'reopens_allocation_id')<>'string'
      OR (claim->>'reopens_allocation_id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
   THEN RAISE EXCEPTION 'Statement allocation claims have a closed safe shape' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_settlement_statement_guard BEFORE INSERT ON app.local_settlement_statement FOR EACH ROW EXECUTE FUNCTION app.guard_local_settlement_statement();
--> statement-breakpoint
CREATE FUNCTION app.seal_local_settlement_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='local_settlement_operation' THEN
  IF NOT EXISTS(SELECT 1 FROM app.local_settlement_statement WHERE operation_id=NEW.id AND revision=1)
  THEN RAISE EXCEPTION 'Money source commits with its initial statement' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM app.local_settlement_event WHERE statement_id=NEW.id)
  THEN RAISE EXCEPTION 'Every statement commits with its original signed delivery' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_settlement_operation_sealed AFTER INSERT ON app.local_settlement_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_settlement_source();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_settlement_statement_sealed AFTER INSERT ON app.local_settlement_statement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_settlement_source();
--> statement-breakpoint
CREATE FUNCTION app.guard_settlement_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid; job app.outbox_job;
BEGIN
 SELECT s.operation_id INTO selected FROM app.local_settlement_event e JOIN app.local_settlement_statement s ON s.id=e.statement_id WHERE e.id=NEW.id;
 SELECT * INTO job FROM app.outbox_job WHERE id=NEW.callback_job_id;
 IF selected IS DISTINCT FROM NEW.operation_id OR job.id IS NULL OR job.kind<>'settlement.callback'
  OR job.dedup_key<>'settlement-callback:'||NEW.id::text OR job.payload<>jsonb_build_object('eventId',NEW.id::text)
  OR job.status<>'pending' OR job.attempts<>0 OR job.max_attempts<>5
 THEN RAISE EXCEPTION 'Settlement registration binds the exact signed source and own callback job' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_provider_event_guard BEFORE INSERT ON app.settlement_provider_event FOR EACH ROW EXECUTE FUNCTION app.guard_settlement_provider_event();
--> statement-breakpoint
CREATE FUNCTION app.settlement_fee_basis_problem(selected uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s app.local_settlement_statement; o app.local_settlement_operation; parent app.local_settlement_operation;
 parent_head app.provider_settlement; parent_statement app.local_settlement_statement; used record;
BEGIN
 SELECT * INTO s FROM app.local_settlement_statement WHERE id=selected;
 SELECT * INTO o FROM app.local_settlement_operation WHERE id=s.operation_id;
 IF s.id IS NULL OR s.gross_amount IS NULL OR s.carrier_fee IS NULL OR s.provider_fee IS NULL THEN RETURN 'SETTLEMENT_STATEMENT_INCOMPLETE'; END IF;
 IF s.gross_amount::numeric<>o.net_amount::numeric+s.carrier_fee::numeric+s.provider_fee::numeric THEN RETURN 'SETTLEMENT_TOTAL_MISMATCH'; END IF;
 IF o.direction='credit' THEN RETURN NULL; END IF;
 SELECT * INTO parent FROM app.local_settlement_operation WHERE provider=o.provider AND environment=o.environment AND reference=s.reverses_reference AND direction='credit' FOR UPDATE;
 IF parent.id IS NULL OR parent.direction<>'credit' OR parent.occurred_at>o.occurred_at THEN RETURN 'SETTLEMENT_REVERSAL_BASIS_UNKNOWN'; END IF;
 SELECT * INTO parent_head FROM app.provider_settlement WHERE operation_id=parent.id;
 SELECT * INTO parent_statement FROM app.local_settlement_statement WHERE id=parent_head.applied_fee_statement_id;
 IF parent_statement.id IS NULL OR parent_statement.operation_id IS DISTINCT FROM parent.id OR parent_statement.gross_amount IS NULL
  OR parent_statement.carrier_fee IS NULL OR parent_statement.provider_fee IS NULL
  OR parent_statement.gross_amount::numeric<>parent.net_amount::numeric+parent_statement.carrier_fee::numeric+parent_statement.provider_fee::numeric
 THEN RETURN 'SETTLEMENT_REVERSAL_BASIS_UNKNOWN'; END IF;
 SELECT coalesce(sum(child.net_amount),0) net,coalesce(sum(statement.carrier_fee),0) carrier,coalesce(sum(statement.provider_fee),0) provider INTO used
 FROM app.provider_settlement head JOIN app.local_settlement_operation child ON child.id=head.operation_id
 JOIN app.local_settlement_statement statement ON statement.id=head.applied_fee_statement_id
 WHERE child.direction='debit' AND child.provider=o.provider AND child.environment=o.environment AND child.id<>o.id AND statement.reverses_reference=parent.reference;
 IF used.net+o.net_amount>parent.net_amount OR used.carrier+s.carrier_fee>parent_statement.carrier_fee OR used.provider+s.provider_fee>parent_statement.provider_fee
 THEN RETURN 'SETTLEMENT_REVERSAL_EXCEEDED'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.assert_settlement_journal(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h app.finance_transaction; original app.finance_transaction; p app.provider_settlement; o app.local_settlement_operation;
 s app.local_settlement_statement; e app.settlement_event; m app.settlement_match; actual jsonb; expected jsonb; total numeric;
BEGIN
 SELECT * INTO h FROM app.finance_transaction WHERE id=selected;
 IF h.kind NOT IN ('settlement_cash','settlement_fee','settlement_match','reversal') THEN RETURN; END IF;
 SELECT jsonb_agg(jsonb_build_array(account,side,amount) ORDER BY account,side,amount) INTO actual FROM app.finance_posting WHERE transaction_id=h.id;
 IF h.kind='settlement_cash' THEN
  SELECT * INTO p FROM app.provider_settlement WHERE cash_transaction_id=h.id;
  SELECT * INTO o FROM app.local_settlement_operation WHERE id=p.operation_id;
  IF p.id IS NULL OR o.net_amount=0 OR h.order_id IS NOT NULL OR h.environment<>o.environment OR h.source<>'local.settlement'
   OR h.effect_reference<>'cash:'||o.id::text OR h.occurred_at<>o.occurred_at
  THEN RAISE EXCEPTION 'Cash journal belongs to one original authenticated bank observation' USING ERRCODE='23514'; END IF;
  SELECT jsonb_agg(jsonb_build_array(account,side,o.net_amount) ORDER BY account,side,o.net_amount) INTO expected
  FROM (VALUES ('company_cash',CASE o.direction WHEN 'credit' THEN 'debit' ELSE 'credit' END),('settlement_clearing',CASE o.direction WHEN 'credit' THEN 'credit' ELSE 'debit' END)) v(account,side);
 ELSIF h.kind='settlement_fee' THEN
  SELECT * INTO e FROM app.settlement_event WHERE fee_transaction_id=h.id ORDER BY revision LIMIT 1;
  SELECT * INTO p FROM app.provider_settlement WHERE id=e.settlement_id;
  SELECT * INTO o FROM app.local_settlement_operation WHERE id=p.operation_id;
  SELECT * INTO s FROM app.local_settlement_statement WHERE id=e.applied_fee_statement_id;
  IF e.id IS NULL OR s.operation_id IS DISTINCT FROM o.id OR h.environment<>o.environment OR h.source<>'local.settlement' OR h.order_id IS NOT NULL
   OR h.effect_reference<>'fee:'||s.id::text||':'||e.source_id::text OR h.occurred_at<>o.occurred_at
   OR s.gross_amount IS NULL OR s.carrier_fee IS NULL OR s.provider_fee IS NULL OR s.gross_amount::numeric<>o.net_amount::numeric+s.carrier_fee::numeric+s.provider_fee::numeric
  THEN RAISE EXCEPTION 'Expense journal binds its original complete authenticated statement' USING ERRCODE='23514'; END IF;
  total:=s.carrier_fee::numeric+s.provider_fee::numeric;
  IF total<=0 THEN RAISE EXCEPTION 'Zero fees do not create an empty expense journal' USING ERRCODE='23514'; END IF;
  SELECT jsonb_agg(jsonb_build_array(account,side,amount) ORDER BY account,side,amount) INTO expected FROM (
   VALUES ('carrier_expense',CASE o.direction WHEN 'credit' THEN 'debit' ELSE 'credit' END,s.carrier_fee::numeric),
    ('provider_fee_expense',CASE o.direction WHEN 'credit' THEN 'debit' ELSE 'credit' END,s.provider_fee::numeric),
    ('settlement_clearing',CASE o.direction WHEN 'credit' THEN 'credit' ELSE 'debit' END,total)
  ) v(account,side,amount) WHERE amount>0;
 ELSIF h.kind='settlement_match' THEN
  SELECT * INTO m FROM app.settlement_match WHERE transaction_id=h.id;
  PERFORM app.assert_settlement_match(m.id);
  SELECT * INTO p FROM app.provider_settlement WHERE id=m.settlement_id;
  SELECT * INTO o FROM app.local_settlement_operation WHERE id=p.operation_id;
  SELECT sum(gross_amount) INTO total FROM app.settlement_allocation WHERE match_id=m.id;
  SELECT jsonb_agg(jsonb_build_array(account,side,total) ORDER BY account,side,total) INTO expected FROM (
   VALUES ('settlement_clearing',CASE o.direction WHEN 'credit' THEN 'debit' ELSE 'credit' END),
    ('provider_receivable',CASE o.direction WHEN 'credit' THEN 'credit' ELSE 'debit' END)
  ) v(account,side);
 ELSE
  SELECT * INTO original FROM app.finance_transaction WHERE id=h.reverses_id;
  IF original.kind='settlement_cash' THEN RAISE EXCEPTION 'Real bank cash is reversed only by a separate authenticated debit observation' USING ERRCODE='23514'; END IF;
  IF original.kind='settlement_match' AND NOT EXISTS(SELECT 1 FROM app.settlement_match match WHERE match.transaction_id=original.id AND match.reversal_transaction_id=h.id)
  THEN RAISE EXCEPTION 'Matching reversal commits with its original match correction' USING ERRCODE='23514'; END IF;
  IF original.kind='settlement_fee' AND NOT EXISTS(
   SELECT 1 FROM app.settlement_event previous JOIN app.settlement_event replacement ON replacement.settlement_id=previous.settlement_id AND replacement.revision=previous.revision+1
   WHERE previous.fee_transaction_id=original.id AND replacement.fee_transaction_id IS DISTINCT FROM original.id
  ) THEN RAISE EXCEPTION 'Expense reversal retains its recorded statement correction' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Settlement journal posts only its exact cash, expense or gross classification' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_settlement_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM app.assert_settlement_journal(NEW.id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlement_journal_sealed AFTER INSERT ON app.finance_transaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_settlement_journal();
--> statement-breakpoint
CREATE FUNCTION app.guard_settlement_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h app.finance_transaction; original app.finance_transaction;
BEGIN
 IF NEW.account IN ('settlement_clearing','carrier_expense','provider_fee_expense') THEN
  SELECT * INTO h FROM app.finance_transaction WHERE id=NEW.transaction_id;
  SELECT * INTO original FROM app.finance_transaction WHERE id=h.reverses_id;
  IF h.kind NOT IN ('settlement_cash','settlement_fee','settlement_match')
   AND (h.kind<>'reversal' OR original.kind NOT IN ('settlement_fee','settlement_match'))
  THEN RAISE EXCEPTION 'Settlement accounts require their own source-bound journal kind' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_posting_guard BEFORE INSERT ON app.finance_posting FOR EACH ROW EXECUTE FUNCTION app.guard_settlement_posting();
--> statement-breakpoint
CREATE FUNCTION app.guard_settlement_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p app.provider_settlement; o app.local_settlement_operation; delivered_statement uuid; operation app.access_operation; grant_roles app.role_grant;
BEGIN
 SELECT * INTO p FROM app.provider_settlement WHERE id=NEW.settlement_id;
 SELECT * INTO o FROM app.local_settlement_operation WHERE id=p.operation_id FOR UPDATE;
 IF p.id IS NULL OR NEW.revision<>p.revision+1 OR NEW.occurred_at<o.occurred_at OR NOT isfinite(NEW.occurred_at)
  OR NEW.occurred_at>app.reservation_clock(o.clock_namespace)
 THEN RAISE EXCEPTION 'Settlement transition advances its current original observation' USING ERRCODE='23514'; END IF;
 IF NEW.source_kind='provider' THEN
  SELECT delivery.statement_id INTO delivered_statement FROM app.settlement_provider_event registered JOIN app.local_settlement_event delivery ON delivery.id=registered.id
   WHERE registered.id=NEW.source_id AND registered.operation_id=o.id;
  IF delivered_statement IS DISTINCT FROM NEW.statement_id OR NEW.kind NOT IN ('observe','statement','match') OR NEW.actor_id IS NOT NULL
  THEN RAISE EXCEPTION 'Provider transition uses its registered original statement delivery' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO operation FROM app.access_operation WHERE id=NEW.source_id;
  SELECT * INTO grant_roles FROM app.role_grant WHERE user_id=NEW.actor_id FOR SHARE;
  IF operation.id IS NULL OR grant_roles.user_id IS NULL OR operation.action<>'finance.reconcile' OR operation.actor_id IS DISTINCT FROM NEW.actor_id
   OR NEW.kind NOT IN ('match','unmatch','escalate') OR NEW.statement_id IS DISTINCT FROM p.current_statement_id
   OR NEW.statement_id IS DISTINCT FROM (SELECT id FROM app.local_settlement_statement WHERE operation_id=o.id ORDER BY revision DESC LIMIT 1)
   OR NOT ('owner'=ANY(grant_roles.roles) OR ('finance'=ANY(grant_roles.roles) AND ARRAY['finance.reconciliation.read','finance.reconciliation.write']<@grant_roles.permissions))
  THEN RAISE EXCEPTION 'Finance transition has its scoped operation and current explicit authority' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_event_guard BEFORE INSERT ON app.settlement_event FOR EACH ROW EXECUTE FUNCTION app.guard_settlement_event();
--> statement-breakpoint
CREATE FUNCTION app.guard_provider_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.local_settlement_operation; e app.settlement_event; old_statement app.local_settlement_statement; new_statement app.local_settlement_statement;
 old_fee app.local_settlement_statement; new_fee app.local_settlement_statement; m app.settlement_match; r app.finance_transaction;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Settlement cash history cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO o FROM app.local_settlement_operation WHERE id=NEW.operation_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>0 OR NEW.status<>'preparing' OR NEW.cash_transaction_id IS NOT NULL OR NEW.fee_transaction_id IS NOT NULL
   OR NEW.applied_fee_statement_id IS NOT NULL OR NEW.current_match_id IS NOT NULL OR NEW.last_match_id IS NOT NULL
   OR NEW.created_at<>o.occurred_at OR NEW.problem_code IS NOT NULL
  THEN RAISE EXCEPTION 'New reconciliation starts with its original source and no fabricated money' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp(); RETURN NEW;
 END IF;
 SELECT * INTO e FROM app.settlement_event WHERE settlement_id=NEW.id AND revision=NEW.revision;
 SELECT * INTO old_statement FROM app.local_settlement_statement WHERE id=OLD.current_statement_id;
 SELECT * INTO new_statement FROM app.local_settlement_statement WHERE id=NEW.current_statement_id;
 IF NEW.operation_id<>OLD.operation_id OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.recorded_at<>OLD.recorded_at
  OR NEW.revision<>OLD.revision+1 OR e.id IS NULL OR new_statement.operation_id IS DISTINCT FROM o.id OR new_statement.revision<old_statement.revision
  OR (NEW.current_statement_id,NEW.current_match_id,NEW.fee_transaction_id,NEW.applied_fee_statement_id,NEW.status,NEW.problem_code)
   IS DISTINCT FROM (e.statement_id,e.match_id,e.fee_transaction_id,e.applied_fee_statement_id,e.status,e.problem_code)
  OR (OLD.revision>0 AND NEW.cash_transaction_id IS DISTINCT FROM OLD.cash_transaction_id)
 THEN RAISE EXCEPTION 'Settlement head and immutable transition share one revision and original cash identity' USING ERRCODE='23514'; END IF;
 IF e.kind='observe' AND OLD.revision<>0 OR e.kind<>'observe' AND OLD.revision=0
 THEN RAISE EXCEPTION 'Original observation is the first transition only' USING ERRCODE='23514'; END IF;
 IF e.kind='escalate' AND (NEW.current_statement_id,NEW.current_match_id,NEW.last_match_id,NEW.fee_transaction_id,NEW.applied_fee_statement_id)
  IS DISTINCT FROM (OLD.current_statement_id,OLD.current_match_id,OLD.last_match_id,OLD.fee_transaction_id,OLD.applied_fee_statement_id)
 THEN RAISE EXCEPTION 'Escalation cannot move money or matching' USING ERRCODE='23514'; END IF;
 IF e.kind='unmatch' AND (NEW.current_match_id IS NOT NULL OR OLD.current_match_id IS NULL OR
  (NEW.fee_transaction_id,NEW.applied_fee_statement_id) IS DISTINCT FROM (OLD.fee_transaction_id,OLD.applied_fee_statement_id))
 THEN RAISE EXCEPTION 'Unmatch preserves actual fees and removes one active classification' USING ERRCODE='23514'; END IF;
 IF NEW.current_match_id IS DISTINCT FROM OLD.current_match_id THEN
  IF OLD.current_match_id IS NOT NULL THEN
   SELECT journal.* INTO r FROM app.settlement_match previous JOIN app.finance_transaction journal ON journal.id=previous.reversal_transaction_id WHERE previous.id=OLD.current_match_id;
   IF r.id IS NULL OR r.created_xid<>pg_current_xact_id()::text OR e.source_kind<>'operation' OR e.kind NOT IN ('match','unmatch')
    OR NOT EXISTS(SELECT 1 FROM app.settlement_match old_match WHERE old_match.id=OLD.current_match_id AND old_match.reversed_by_operation_id=e.source_id)
   THEN RAISE EXCEPTION 'Correction reverses the previous active match in the same scoped operation' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.current_match_id IS NOT NULL THEN
   SELECT * INTO m FROM app.settlement_match WHERE id=NEW.current_match_id;
   IF m.settlement_id IS DISTINCT FROM NEW.id OR m.statement_id IS DISTINCT FROM NEW.current_statement_id OR m.correction_of IS DISTINCT FROM OLD.last_match_id
    OR (m.source_kind,m.source_id,m.actor_id) IS DISTINCT FROM (e.source_kind,e.source_id,e.actor_id)
   THEN RAISE EXCEPTION 'New matching head preserves its exact correction and source identity' USING ERRCODE='23514'; END IF;
  ELSIF e.kind<>'unmatch' THEN RAISE EXCEPTION 'Only guarded unmatch releases an active matching classification' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.current_match_id IS NOT NULL AND NEW.last_match_id IS DISTINCT FROM NEW.current_match_id
  OR NEW.current_match_id IS NULL AND NEW.last_match_id IS DISTINCT FROM coalesce(OLD.current_match_id,OLD.last_match_id)
 THEN RAISE EXCEPTION 'Latest matching lineage survives unmatch' USING ERRCODE='23514'; END IF;
 IF OLD.applied_fee_statement_id IS NOT NULL AND NEW.applied_fee_statement_id IS NULL THEN RAISE EXCEPTION 'Unknown latest facts cannot erase authenticated expenses' USING ERRCODE='23514'; END IF;
 SELECT * INTO old_fee FROM app.local_settlement_statement WHERE id=OLD.applied_fee_statement_id;
 SELECT * INTO new_fee FROM app.local_settlement_statement WHERE id=NEW.applied_fee_statement_id;
 IF OLD.fee_transaction_id IS DISTINCT FROM NEW.fee_transaction_id AND OLD.fee_transaction_id IS NOT NULL THEN
  SELECT * INTO r FROM app.finance_transaction WHERE reverses_id=OLD.fee_transaction_id;
  IF r.id IS NULL OR r.created_xid<>pg_current_xact_id()::text THEN RAISE EXCEPTION 'Changed expenses retain their full original reversal' USING ERRCODE='23514'; END IF;
 END IF;
 IF OLD.fee_transaction_id IS NOT NULL AND NEW.fee_transaction_id=OLD.fee_transaction_id
  AND (old_fee.carrier_fee,old_fee.provider_fee) IS DISTINCT FROM (new_fee.carrier_fee,new_fee.provider_fee)
 THEN RAISE EXCEPTION 'An existing expense journal cannot silently change category amounts' USING ERRCODE='23514'; END IF;
 IF old_fee.id IS NOT NULL AND (old_fee.carrier_fee,old_fee.provider_fee) IS DISTINCT FROM (new_fee.carrier_fee,new_fee.provider_fee) THEN
  IF OLD.current_match_id IS NOT NULL AND NEW.current_match_id IS NOT DISTINCT FROM OLD.current_match_id
  THEN RAISE EXCEPTION 'Changed applied fees require guarded correction of active matching' USING ERRCODE='23514'; END IF;
  IF o.direction='credit' AND EXISTS(SELECT 1 FROM app.provider_settlement child JOIN app.local_settlement_operation source ON source.id=child.operation_id
   JOIN app.local_settlement_statement statement ON statement.id=child.applied_fee_statement_id
   WHERE source.provider=o.provider AND source.environment=o.environment AND source.direction='debit' AND statement.reverses_reference=o.reference)
  THEN RAISE EXCEPTION 'Correct dependent bank reversal facts before changing their original fees' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_settlement_guard BEFORE INSERT OR UPDATE OR DELETE ON app.provider_settlement FOR EACH ROW EXECUTE FUNCTION app.guard_provider_settlement();
--> statement-breakpoint
CREATE FUNCTION app.assert_provider_settlement(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p app.provider_settlement; o app.local_settlement_operation; s app.local_settlement_statement; fee app.local_settlement_statement;
 e app.settlement_event; m app.settlement_match; operation app.access_operation; gross numeric; fee_problem text;
BEGIN
 SELECT * INTO p FROM app.provider_settlement WHERE id=selected;
 SELECT * INTO o FROM app.local_settlement_operation WHERE id=p.operation_id;
 SELECT * INTO s FROM app.local_settlement_statement WHERE id=p.current_statement_id;
 SELECT * INTO e FROM app.settlement_event WHERE settlement_id=p.id AND revision=p.revision;
 IF p.id IS NULL OR p.revision=0 OR p.status='preparing' OR e.id IS NULL OR s.operation_id IS DISTINCT FROM o.id
  OR EXISTS(SELECT 1 FROM app.settlement_event future WHERE future.settlement_id=p.id AND future.revision>p.revision)
  OR (p.current_statement_id,p.current_match_id,p.fee_transaction_id,p.applied_fee_statement_id,p.status,p.problem_code)
    IS DISTINCT FROM (e.statement_id,e.match_id,e.fee_transaction_id,e.applied_fee_statement_id,e.status,e.problem_code)
  OR (o.net_amount>0)<>(p.cash_transaction_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Observed bank money commits with a complete reconciliation head and transition' USING ERRCODE='23514'; END IF;
 IF p.cash_transaction_id IS NOT NULL THEN PERFORM app.assert_settlement_journal(p.cash_transaction_id); END IF;
 IF p.applied_fee_statement_id IS NOT NULL THEN
  SELECT * INTO fee FROM app.local_settlement_statement WHERE id=p.applied_fee_statement_id;
  fee_problem:=app.settlement_fee_basis_problem(fee.id);
  IF fee.operation_id IS DISTINCT FROM o.id OR fee_problem IS NOT NULL OR (fee.carrier_fee::numeric+fee.provider_fee::numeric>0)<>(p.fee_transaction_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Applied fees require complete consistent original source and reversal capacity' USING ERRCODE='23514'; END IF;
  IF p.fee_transaction_id IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM app.finance_transaction WHERE reverses_id=p.fee_transaction_id) THEN RAISE EXCEPTION 'Current expense journal is unreversed' USING ERRCODE='23514'; END IF;
   PERFORM app.assert_settlement_journal(p.fee_transaction_id);
  END IF;
 ELSIF p.fee_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Expense journal requires its applied statement identity' USING ERRCODE='23514'; END IF;
 IF p.current_match_id IS NOT NULL THEN
  SELECT * INTO m FROM app.settlement_match WHERE id=p.current_match_id;
  IF m.settlement_id IS DISTINCT FROM p.id OR m.reversal_transaction_id IS NOT NULL OR p.last_match_id IS DISTINCT FROM m.id
  THEN RAISE EXCEPTION 'Current matching pointer belongs to its active original classification' USING ERRCODE='23514'; END IF;
  PERFORM app.assert_settlement_journal(m.transaction_id);
  SELECT sum(gross_amount) INTO gross FROM app.settlement_allocation WHERE match_id=m.id;
 END IF;
 IF p.status IN ('matched','partial') THEN
  IF m.id IS NULL OR m.statement_id IS DISTINCT FROM s.id OR p.applied_fee_statement_id IS DISTINCT FROM s.id OR p.problem_code IS NOT NULL
   OR (p.status='matched') IS DISTINCT FROM (gross=s.gross_amount) OR (p.status='partial' AND gross>=s.gross_amount)
  THEN RAISE EXCEPTION 'Successful matching includes every current source and explicit residual gross' USING ERRCODE='23514'; END IF;
 ELSIF p.status='pending' AND p.current_match_id IS NOT NULL THEN RAISE EXCEPTION 'An active classification is partial, matched or an explained exception' USING ERRCODE='23514'; END IF;
 IF p.status IN ('mismatched','exception') AND p.problem_code IS NULL THEN RAISE EXCEPTION 'Reconciliation exceptions have an explicit problem' USING ERRCODE='23514'; END IF;
 IF e.source_kind='provider' THEN
  IF NOT EXISTS(SELECT 1 FROM app.settlement_event_result result JOIN app.settlement_provider_event registered ON registered.id=result.event_id
   JOIN app.outbox_job job ON job.id=registered.callback_job_id WHERE result.event_id=e.source_id AND result.settlement_event_id=e.id
   AND result.settlement_id=p.id AND result.head_revision=e.revision AND job.status='completed' AND job.result->>'event_id'=e.source_id::text
   AND job.result->>'settlement_id'=p.id::text AND job.result->>'version'=e.revision::text AND job.result->>'outcome'=result.outcome)
  THEN RAISE EXCEPTION 'Provider monetary transition commits with its exact result and own completed callback' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO operation FROM app.access_operation WHERE id=e.source_id;
  IF operation.action<>'finance.reconcile' OR operation.actor_id IS DISTINCT FROM e.actor_id OR operation.response->>'id' IS DISTINCT FROM p.id::text
   OR operation.response->>'version' IS DISTINCT FROM e.revision::text OR operation.response->>'status' IS DISTINCT FROM e.status
   OR NOT EXISTS(SELECT 1 FROM app.audit_event audit WHERE audit.actor_id=e.actor_id AND audit.action='finance.reconcile' AND audit.subject_id=p.id::text
    AND audit.outcome='allowed' AND audit.reason=e.reason AND audit.details->>'operation_id'=operation.id::text)
  THEN RAISE EXCEPTION 'Finance money action commits with its exact scoped response and audit' USING ERRCODE='23514'; END IF;
 END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_provider_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='provider_settlement' THEN PERFORM app.assert_provider_settlement(NEW.id);
 ELSIF TG_TABLE_NAME='settlement_allocation' THEN PERFORM app.assert_provider_settlement((SELECT settlement_id FROM app.settlement_match WHERE id=NEW.match_id));
 ELSE PERFORM app.assert_provider_settlement(NEW.settlement_id); END IF;
 IF TG_TABLE_NAME='settlement_event' THEN
  IF NEW.source_kind='provider' THEN PERFORM app.assert_settlement_result(NEW.source_id); END IF;
 END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER provider_settlement_sealed AFTER INSERT OR UPDATE ON app.provider_settlement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_provider_settlement();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlement_event_sealed AFTER INSERT ON app.settlement_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_provider_settlement();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlement_match_sealed AFTER INSERT OR UPDATE ON app.settlement_match DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_provider_settlement();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlement_allocation_sealed AFTER INSERT ON app.settlement_allocation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_provider_settlement();
--> statement-breakpoint
CREATE FUNCTION app.assert_settlement_result(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE result app.settlement_event_result; registered app.settlement_provider_event; delivery app.local_settlement_event;
 statement app.local_settlement_statement; current_statement app.local_settlement_statement; head app.provider_settlement; event app.settlement_event; observed app.settlement_event; job app.outbox_job;
BEGIN
 SELECT * INTO result FROM app.settlement_event_result WHERE event_id=selected;
 SELECT * INTO registered FROM app.settlement_provider_event WHERE id=selected;
 SELECT * INTO delivery FROM app.local_settlement_event WHERE id=selected;
 SELECT * INTO statement FROM app.local_settlement_statement WHERE id=delivery.statement_id;
 SELECT * INTO head FROM app.provider_settlement WHERE id=result.settlement_id;
 SELECT * INTO observed FROM app.settlement_event WHERE settlement_id=head.id AND revision=result.head_revision;
 SELECT * INTO current_statement FROM app.local_settlement_statement WHERE id=observed.statement_id;
 SELECT * INTO job FROM app.outbox_job WHERE id=registered.callback_job_id;
 IF result.event_id IS NULL OR observed.id IS NULL OR head.operation_id IS DISTINCT FROM registered.operation_id OR statement.operation_id IS DISTINCT FROM registered.operation_id
  OR job.status<>'completed' OR job.result->>'event_id' IS DISTINCT FROM selected::text OR job.result->>'settlement_id' IS DISTINCT FROM head.id::text
  OR job.result->>'outcome' IS DISTINCT FROM result.outcome OR job.result->>'version' IS DISTINCT FROM result.head_revision::text
 THEN RAISE EXCEPTION 'Settlement result, original source and own callback completion commit together' USING ERRCODE='23514'; END IF;
 IF result.outcome IN ('older','duplicate') THEN
  IF result.settlement_event_id IS NOT NULL OR (result.outcome='older' AND statement.revision>=current_statement.revision)
   OR (result.outcome='duplicate' AND statement.revision<>current_statement.revision)
  THEN RAISE EXCEPTION 'Older and duplicate source deliveries preserve current monetary truth' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO event FROM app.settlement_event WHERE id=result.settlement_event_id;
  IF event.id IS DISTINCT FROM observed.id OR event.settlement_id IS DISTINCT FROM head.id OR event.source_kind<>'provider' OR event.source_id IS DISTINCT FROM selected
   OR event.statement_id IS DISTINCT FROM statement.id
   OR (result.outcome IS DISTINCT FROM CASE event.status WHEN 'matched' THEN 'matched' WHEN 'partial' THEN 'partial' WHEN 'pending' THEN 'unmatched' ELSE 'exception' END
    AND NOT (result.outcome='observed' AND event.kind='observe' AND event.status='pending'))
  THEN RAISE EXCEPTION 'Callback outcome describes its exact immutable original transition' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM app.assert_provider_settlement(head.id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_settlement_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM app.assert_settlement_result(NEW.event_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlement_event_result_sealed AFTER INSERT ON app.settlement_event_result DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_settlement_result();
--> statement-breakpoint
CREATE TRIGGER settlement_event_result_recorded BEFORE INSERT ON app.settlement_event_result FOR EACH ROW EXECUTE FUNCTION app.record_payment_result();
--> statement-breakpoint
CREATE TRIGGER local_settlement_event_recorded BEFORE INSERT ON app.local_settlement_event FOR EACH ROW EXECUTE FUNCTION app.record_payment_result();
--> statement-breakpoint
CREATE FUNCTION app.seal_settlement_callback_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid;
BEGIN
 SELECT id INTO selected FROM app.settlement_provider_event WHERE callback_job_id=NEW.id;
 PERFORM app.assert_settlement_result(selected); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlement_callback_job_sealed AFTER INSERT OR UPDATE ON app.outbox_job DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (NEW.kind='settlement.callback' AND NEW.status='completed') EXECUTE FUNCTION app.seal_settlement_callback_job();
--> statement-breakpoint
CREATE FUNCTION app.guard_settlement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Final finance decisions and replay responses are immutable' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(NEW)-'response') IS DISTINCT FROM (to_jsonb(OLD)-'response')
  OR OLD.response<>'{}'::jsonb OR NEW.response='{}'::jsonb OR jsonb_typeof(NEW.response)<>'object'
 THEN RAISE EXCEPTION 'Final finance decisions and replay responses are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_operation_finalization BEFORE UPDATE ON app.access_operation FOR EACH ROW
 WHEN (OLD.action='finance.reconcile' OR NEW.action='finance.reconcile') EXECUTE FUNCTION app.guard_settlement_operation();
--> statement-breakpoint
CREATE TRIGGER settlement_operation_retention BEFORE DELETE ON app.access_operation FOR EACH ROW
 WHEN (OLD.action='finance.reconcile') EXECUTE FUNCTION app.guard_settlement_operation();
--> statement-breakpoint
CREATE FUNCTION app.seal_settlement_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation app.access_operation; transition app.settlement_event; transitions integer;
BEGIN
 SELECT * INTO operation FROM app.access_operation WHERE id=NEW.id;
 SELECT count(*)::int INTO transitions FROM app.settlement_event WHERE source_kind='operation' AND source_id=NEW.id;
 SELECT * INTO transition FROM app.settlement_event WHERE source_kind='operation' AND source_id=NEW.id;
 IF operation.id IS NULL OR transitions<>1 OR operation.actor_id IS DISTINCT FROM transition.actor_id
  OR operation.response->>'id' IS DISTINCT FROM transition.settlement_id::text
  OR operation.response->>'version' IS DISTINCT FROM transition.revision::text
  OR operation.response->>'status' IS DISTINCT FROM transition.status
 THEN RAISE EXCEPTION 'Finance decision commits with its exact immutable transition and final response' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_provider_settlement(transition.settlement_id);
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlement_operation_sealed AFTER INSERT OR UPDATE ON app.access_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (NEW.action='finance.reconcile') EXECUTE FUNCTION app.seal_settlement_operation();
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['local_settlement_operation','local_settlement_statement','local_settlement_event','settlement_provider_event','settlement_allocation','settlement_event','settlement_event_result'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
END;
$$;
