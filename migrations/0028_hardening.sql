-- R4 hardening of 0026/0027 (custom, expand-only). Plain CREATE INDEX: the
-- migrator runs inside one transaction on the local/test profiles.
-- Indexes back commerce_guest_context_referenced(), the cleanup anti-join and
-- the ON DELETE RESTRICT checks. Other probes already have a leading index:
-- cart_guest_idx, *_key_unique (actor_scope, ...) on return/exception/commerce_operation.
CREATE INDEX "commerce_order_guest_idx" ON "app"."commerce_order" USING btree ("owner_guest_id");--> statement-breakpoint
CREATE INDEX "exception_operation_guest_idx" ON "app"."exception_operation" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "guest_support_identity_guest_idx" ON "app"."guest_support_identity" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "order_access_guest_idx" ON "app"."order_access" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "referral_touch_guest_idx" ON "app"."referral_touch" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "return_operation_guest_idx" ON "app"."return_operation" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "support_challenge_scope_idx" ON "app"."support_challenge" USING btree ("actor_scope");--> statement-breakpoint
-- Soft guest references become real FKs (uuid -> uuid). Added NOT VALID, then
-- validated; local/test data had no dangling ids when this was written.
ALTER TABLE "app"."guest_support_identity" ADD CONSTRAINT "guest_support_identity_guest_id_commerce_guest_context_id_fk" FOREIGN KEY ("guest_id") REFERENCES "app"."commerce_guest_context"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "app"."guest_support_identity" VALIDATE CONSTRAINT "guest_support_identity_guest_id_commerce_guest_context_id_fk";--> statement-breakpoint
ALTER TABLE "app"."referral_touch" ADD CONSTRAINT "referral_touch_guest_id_commerce_guest_context_id_fk" FOREIGN KEY ("guest_id") REFERENCES "app"."commerce_guest_context"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "app"."referral_touch" VALIDATE CONSTRAINT "referral_touch_guest_id_commerce_guest_context_id_fk";--> statement-breakpoint
-- 0026 guard_exception_operation copied verbatim; only the refund_retry input
-- branch gains the 0023 guard_recovery_queue_operation checks: normalized
-- positive expected_version bound to the current refund revision, trimmed
-- 1..500 reason.
CREATE OR REPLACE FUNCTION app.guard_exception_operation() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR ((NEW.action IN ('refund_queue','refund_reconcile','refund_retry')) IS DISTINCT FROM (NEW.proof_digest IS NOT NULL))
    OR (NEW.action IN ('destination','refund_reconcile','refund_retry') AND NOT EXISTS(
       SELECT 1 FROM app.recovery_refund r WHERE r.id=NEW.subject_id AND r.exception_id=v_case.id AND r.order_id=v_order.id))
    OR (NEW.action NOT IN ('destination','refund_reconcile','refund_retry') AND NEW.subject_id IS DISTINCT FROM v_case.id)
    OR (NEW.action='refund_retry' AND (NOT (NEW.input ?& ARRAY['expected_version','reason']) OR (NEW.input-ARRAY['expected_version','reason'])<>'{}'::jsonb
       OR jsonb_typeof(NEW.input->'expected_version') IS DISTINCT FROM 'number' OR NEW.input->>'expected_version'!~'^[1-9][0-9]{0,9}$'
       OR (NEW.input->>'expected_version')::bigint IS DISTINCT FROM (SELECT r.revision::bigint FROM app.recovery_refund r WHERE r.id=NEW.subject_id)
       OR jsonb_typeof(NEW.input->'reason') IS DISTINCT FROM 'string' OR char_length(NEW.input->>'reason') NOT BETWEEN 1 AND 500
       OR NEW.input->>'reason' IS DISTINCT FROM btrim(NEW.input->>'reason')))
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
-- 0026 guard_recovery_callback_job copied verbatim; only the audit binding
-- changes from created_at>=transaction_timestamp() (which a concurrent
-- transaction's audit row also satisfies) to this transaction's own xmin.
CREATE OR REPLACE FUNCTION app.guard_recovery_callback_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_registration app.recovery_provider_event;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recovery callback jobs and original source history are retained' USING ERRCODE='23514'; END IF;
 -- S71: the only exit from a terminal state. A failed callback without any
 -- applied result re-arms once per exact audit row written in this transaction
 -- by the host reconcile or finance reconcile owner (bound to this failure's
 -- attempts and completed_at). The result/cash seals still allow one posting.
 IF OLD.status='failed' AND NEW.status='pending' THEN
  SELECT * INTO v_registration FROM app.recovery_provider_event WHERE callback_job_id=OLD.id;
  IF (to_jsonb(NEW)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
     OR NEW.attempts<>0 OR NEW.last_error IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.result IS NOT NULL
     OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.dispatched_at IS NOT NULL
     OR v_registration.id IS NULL OR EXISTS(SELECT 1 FROM app.recovery_event_result WHERE event_id=v_registration.id)
     OR NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.action='local.recovery_refund.reconcile' AND a.outcome='allowed'
       AND a.subject_id=v_registration.refund_id::text AND a.xmin=pg_current_xact_id()::xid
       AND a.details->>'job_id'=OLD.id::text AND a.details->>'previous_status'='failed' AND a.details->>'previous_attempts'=OLD.attempts::text
       AND a.details ? 'previous_completed_at' AND (a.details->>'previous_completed_at')::timestamptz IS NOT DISTINCT FROM OLD.completed_at)
  THEN RAISE EXCEPTION 'Failed recovery callback re-arms only once per exact audited owner action and never after an applied result' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','lease_token','lease_until','dispatched_at','last_error','run_at','completed_at','result'])
    OR NEW.attempts<OLD.attempts OR (OLD.status IN ('completed','failed') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.status='unknown' AND NEW.status='pending')
 THEN RAISE EXCEPTION 'Recovery callback keeps its original source, attempt history and terminal result; explicit recovery requires its complete owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
