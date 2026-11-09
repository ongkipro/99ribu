-- S181 step 2a-ii (ADR-0008, owner-accepted 2026-11-09). A production payment that cannot be confirmed automatically
-- (late, amount mismatch, conflicting allocation) must keep its money visible as a collection exception instead of
-- rolling the whole payment callback back. Only the INTAKE assertion learns the production database name.
--
-- What stays closed on purpose: every refund and recovery-refund function (assert_refund, assert_compensation_capacity,
-- assert_recovery_receipt, assert_recovery_request, guard_*_refund_*, guard_recovery_*, guard_replacement_*), and the
-- execution tables local_recovery_operation, local_recovery_destination, local_refund_operation and
-- local_refund_destination, whose environment CHECKs still allow only local and test. This function is also reached by
-- assert_exception_refund_proposal and assert_recovery_refund_source, but both call assert_compensation_capacity and
-- assert_recovery_receipt next, which still raise 23514 on the production database; so a refund or recovery-refund
-- PROPOSAL cannot be created or accepted in production either (and TypeScript stops it earlier: only the collection-case
-- intake passes intakeOnly). Non-refund exception actions (keep waiting, escalate) remain available to finance.
--
-- Rollback: this migration only replaces a function body and changes no data. Re-applying 0023's definition restores
-- the old behaviour, but scripts/migrate.ts keeps the release prefix of drizzle.__drizzle_migrations immutable, so a code
-- rollback AFTER this migration has been applied to a database needs a forward revert migration (0058), never removing 0057.
CREATE OR REPLACE FUNCTION app.assert_exception_collection_case(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_order app.commerce_order; v_source record; v_job app.outbox_job;
 v_journal app.finance_transaction; v_receipt app.economic_receipt; v_provider text; v_callback_kind text;
 v_prefix text; v_environment text; v_postings integer; v_units jsonb; v_expected jsonb;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Original recovery collection requires Read Committed or Serializable isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id;
 v_environment:=CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' WHEN '99ribu_production' THEN 'production' ELSE NULL END;
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
