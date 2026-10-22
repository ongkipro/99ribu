ALTER TABLE "app"."exception_operation" DROP CONSTRAINT "exception_operation_value_check";--> statement-breakpoint
ALTER TABLE "app"."exception_operation" ADD CONSTRAINT "exception_operation_value_check" CHECK ("app"."exception_operation"."action" IN ('report','decide','apply','intake','buyer_accept','buyer_decline','destination','refund_queue','refund_reconcile','refund_retry') AND char_length("app"."exception_operation"."key") between 16 and 200 AND "app"."exception_operation"."request_hash" ~ '^[a-f0-9]{64}$' AND ("app"."exception_operation"."proof_digest" IS NULL OR "app"."exception_operation"."proof_digest" ~ '^[a-f0-9]{64}$') AND jsonb_typeof("app"."exception_operation"."input")='object' AND NOT ("app"."exception_operation"."input" ?| ARRAY['password','reauthentication_proof','bank_account','signature']) AND octet_length("app"."exception_operation"."input"::text)<=131072 AND jsonb_typeof("app"."exception_operation"."response")='object' AND NOT ("app"."exception_operation"."response" ?| ARRAY['password','reauthentication_proof','bank_account','signature']) AND octet_length("app"."exception_operation"."response"::text)<=1048576);--> statement-breakpoint
-- S71 (custom, expand-only): owner-audited recovery for terminally failed
-- 'recovery.refund.callback' jobs and a finance 'refund_retry' action that
-- starts attempt+1 after a known zero-money outcome. All other 0023 refusals
-- are copied unchanged; immutable postings and single-cash seals are untouched.
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
       OR jsonb_typeof(NEW.input->'expected_version') IS DISTINCT FROM 'number' OR jsonb_typeof(NEW.input->'reason') IS DISTINCT FROM 'string'))
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
CREATE OR REPLACE FUNCTION app.assert_exception_operation_actor(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
    OR (v_operation.action IN ('refund_queue','refund_reconcile','refund_retry') AND v_mfa.verified_at<=clock_timestamp()-interval '5 minutes')
 THEN RAISE EXCEPTION 'Exception authority remains current after every scope and proof wait' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.audit_event a WHERE a.actor_id IS NOT DISTINCT FROM v_operation.actor_id
    AND a.action='commerce_exception.'||v_operation.action AND a.subject_id=v_operation.subject_id::text AND a.outcome='allowed'
    AND a.details=jsonb_build_object('operation_id',v_operation.id,'exception_id',v_case.id) AND a.created_at>=v_operation.recorded_at)
 THEN RAISE EXCEPTION 'Exception operation retains its exact original actor/subject audit' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_recovery_refund_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_operation app.exception_operation; v_case app.commerce_exception; v_order app.commerce_order;
 v_destination app.local_recovery_destination; v_job app.outbox_job; v_previous app.recovery_refund_event;
 v_request app.local_recovery_operation; v_bank app.local_recovery_event; v_registration app.recovery_provider_event; v_now timestamptz;
 v_prior_job app.outbox_job;
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
 ELSIF NEW.kind='retry' THEN
  -- S71: a finance-owned retry starts attempt+1 only after the current attempt
  -- is a known zero-money outcome: a signed failed bank result, or a creation
  -- job that failed before any bank request existed. Never after success.
  SELECT * INTO v_job FROM app.outbox_job WHERE id=NEW.job_id;
  SELECT * INTO v_prior_job FROM app.outbox_job WHERE id=v_refund.current_job_id;
  SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=v_refund.current_operation_id;
  SELECT * INTO v_bank FROM app.local_recovery_event WHERE operation_id=v_request.id;
  IF v_operation.action<>'refund_retry' OR v_operation.subject_id IS DISTINCT FROM v_refund.id OR v_case.status NOT IN ('refunding','unknown')
     OR v_refund.cash_transaction_id IS NOT NULL OR v_previous.id IS NULL OR v_operation.occurred_at<v_previous.occurred_at
     OR NEW.revision::bigint<>v_refund.revision::bigint+1 OR NEW.status<>'queued' OR NEW.provider_operation_id IS NOT NULL OR NEW.cash_transaction_id IS NOT NULL
     OR NEW.destination_source_id IS DISTINCT FROM v_refund.destination_source_id OR NEW.reason IS DISTINCT FROM v_operation.input->>'reason'
     OR v_prior_job.id IS NULL OR v_prior_job.kind<>'recovery.refund.create' OR v_prior_job.status NOT IN ('completed','failed')
     OR (v_refund.current_operation_id IS NOT NULL AND (v_refund.status<>'failed' OR v_request.creation_job_id IS DISTINCT FROM v_prior_job.id
        OR v_bank.id IS NULL OR v_bank.status<>'failed'
        OR NOT EXISTS(SELECT 1 FROM app.recovery_event_result r WHERE r.event_id=v_bank.id AND r.refund_id=v_refund.id AND r.outcome='failed')))
     OR (v_refund.current_operation_id IS NULL AND (v_refund.status<>'queued' OR v_prior_job.status<>'failed'
        OR EXISTS(SELECT 1 FROM app.local_recovery_operation WHERE creation_job_id=v_prior_job.id)))
     OR v_job.id IS NULL OR v_job.id IS NOT DISTINCT FROM v_prior_job.id OR v_job.kind<>'recovery.refund.create'
     OR v_job.status<>'pending' OR v_job.attempts<>0 OR v_job.max_attempts<>5
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',(v_prior_job.payload->>'attempt')::bigint+1)
     OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-create:'||v_refund.id::text||':'||((v_prior_job.payload->>'attempt')::bigint+1)::text
     OR v_job.lease_token IS NOT NULL OR v_job.lease_until IS NOT NULL OR v_job.dispatched_at IS NOT NULL
     OR v_job.completed_at IS NOT NULL OR v_job.result IS NOT NULL OR v_job.last_error IS NOT NULL
  THEN RAISE EXCEPTION 'Recovery retry starts one fresh next attempt only after a known zero-money outcome of the current attempt' USING ERRCODE='23514'; END IF;
 ELSE
  RAISE EXCEPTION 'Other recovery lifecycle transitions require their completed source and effect owners' USING ERRCODE='23514';
 END IF;
 NEW.occurred_at:=v_operation.occurred_at;NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
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
       AND a.subject_id=v_registration.refund_id::text AND a.created_at>=transaction_timestamp()
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
--> statement-breakpoint
CREATE FUNCTION app.assert_recovery_retry_operation(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.action<>'refund_retry' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
    OR (SELECT count(*) FROM app.recovery_refund_event WHERE source_kind='operation' AND source_id=p_operation_id)<>1
    OR NOT EXISTS(SELECT 1 FROM app.recovery_refund_event event JOIN app.recovery_refund refund ON refund.id=event.refund_id
      WHERE event.source_kind='operation' AND event.source_id=p_operation_id AND event.kind='retry'
       AND refund.id=v_operation.subject_id AND refund.exception_id=v_operation.exception_id)
    OR EXISTS(SELECT 1 FROM app.exception_event WHERE source_kind='operation' AND source_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE operation_id=p_operation_id)
 THEN RAISE EXCEPTION 'Recovery retry operation finalizes exactly one new attempt without case, queue or money effects' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund(v_operation.subject_id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_recovery_retry_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.assert_recovery_retry_operation(NEW.id);RETURN NULL;END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_retry_operation_sealed AFTER INSERT OR UPDATE ON app.exception_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.action='refund_retry') EXECUTE FUNCTION app.seal_recovery_retry_operation();
