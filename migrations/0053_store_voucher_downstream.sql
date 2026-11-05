-- S177 stage 2B (docs/spec/vouchers/S177-stage-2b-design.md §3.5): money the buyer paid or gets back uses the unit net of its
-- frozen store-voucher share (fulfillment_item.merchandise_discount, at least Rp1 remains). Gross stays on order_item.unit_price.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_exception_application(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
 FOR v_source IN SELECT receipt.id,receipt.transaction_id,receipt.amount,sum(item.unit_price::numeric-unit.merchandise_discount::numeric+unit.buyer_shipping::numeric+unit.payment_charge::numeric) proposed,count(*) units
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
CREATE OR REPLACE FUNCTION app.assert_exception_refund_proposal(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
  SELECT r.id,r.transaction_id,r.amount,sum(i.unit_price::numeric-f.merchandise_discount::numeric+f.buyer_shipping::numeric+f.payment_charge::numeric) proposed
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
CREATE OR REPLACE FUNCTION app.assert_unit_merchandise() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_unit uuid; v_price bigint;
BEGIN
 IF TG_TABLE_NAME='refund_allocation' THEN SELECT r.fulfillment_item_id INTO v_unit FROM app.return_item r WHERE r.id=NEW.return_item_id;
 ELSIF TG_TABLE_NAME='recovery_refund_allocation' THEN IF NEW.fulfillment_item_id IS NULL THEN RETURN NEW; END IF; v_unit:=NEW.fulfillment_item_id;
 ELSE v_unit:=NEW.fulfillment_item_id; END IF;
 SELECT i.unit_price-f.merchandise_discount INTO v_price FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE f.id=v_unit;
 IF v_price IS NULL OR NEW.merchandise_amount IS DISTINCT FROM v_price THEN
  RAISE EXCEPTION 'Unit merchandise equals its order item unit price' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.cod_current_collection_basis(p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_charge numeric; v_parcel app.order_shipment; v_order app.commerce_order; v_units jsonb; v_merchandise numeric; v_shipping numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Current COD entitlement requires fresh original-order locking' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_parcel FROM app.order_shipment WHERE id=p_shipment_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_parcel.order_id FOR UPDATE;
 IF v_parcel.id IS NULL OR v_order.payment_method IS DISTINCT FROM 'cod'
 THEN RAISE EXCEPTION 'COD basis belongs to its original COD parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric-f.merchandise_discount::numeric),0),coalesce(sum(f.buyer_shipping::numeric),0),coalesce(sum(f.payment_charge::numeric),0)
  INTO v_units,v_merchandise,v_shipping,v_charge FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=v_parcel.id AND i.order_id=v_order.id AND NOT EXISTS(
   SELECT 1 FROM app.exception_cancellation cancelled WHERE cancelled.fulfillment_item_id=f.id AND cancelled.replacement_link_id IS NULL);
 IF jsonb_array_length(v_units)>100 OR v_merchandise+v_shipping+v_charge>9007199254740991
 THEN RAISE EXCEPTION 'COD basis retains bounded original unit money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'merchandise_amount',v_merchandise,'buyer_shipping',v_shipping,'payment_charge',v_charge,'amount',v_merchandise+v_shipping+v_charge);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.cod_operation_collection_basis(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_charge numeric; v_operation app.local_cod_operation; v_order app.commerce_order; v_units jsonb; v_merchandise numeric; v_shipping numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Original COD source scope requires fresh locking isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_operation FROM app.local_cod_operation WHERE id=p_operation_id;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=v_operation.shipment_id FOR UPDATE OF o;
 IF v_operation.id IS NULL OR v_order.payment_method IS DISTINCT FROM 'cod'
 THEN RAISE EXCEPTION 'COD source scope retains its original parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric-f.merchandise_discount::numeric),0),coalesce(sum(f.buyer_shipping::numeric),0),coalesce(sum(f.payment_charge::numeric),0)
  INTO v_units,v_merchandise,v_shipping,v_charge FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=v_operation.shipment_id AND i.order_id=v_order.id AND (v_operation.unit_ids IS NULL OR v_operation.unit_ids ? f.id::text);
 IF jsonb_array_length(v_units)>100 OR v_merchandise+v_shipping+v_charge>9007199254740991
    OR v_merchandise+v_shipping+v_charge IS DISTINCT FROM v_operation.requested_amount::numeric
    OR (v_operation.unit_ids IS NOT NULL AND v_units IS DISTINCT FROM v_operation.unit_ids)
 THEN RAISE EXCEPTION 'Original COD snapshot retains exactly its unique complete funded units and frozen money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'merchandise_amount',v_merchandise,'buyer_shipping',v_shipping,'payment_charge',v_charge,'amount',v_merchandise+v_shipping+v_charge);
END;
$$;
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
 SELECT f.buyer_shipping,f.payment_charge,i.unit_price-f.merchandise_discount unit_price,CASE WHEN NEW.replacement_link_id IS NULL THEN r.received_at ELSE replacement_receipt.received_at END received_at INTO v_original
 FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
 JOIN app.buyer_receipt r ON r.fulfillment_item_id=f.id
 LEFT JOIN app.replacement_link link ON link.id=NEW.replacement_link_id AND link.original_fulfillment_item_id=f.id
 LEFT JOIN app.replacement_buyer_receipt replacement_receipt ON replacement_receipt.replacement_link_id=link.id
 WHERE f.id=NEW.fulfillment_item_id AND i.order_id=v_case.order_id AND r.id=NEW.buyer_receipt_id
   AND (NEW.replacement_link_id IS NULL OR replacement_receipt.id IS NOT NULL);
 IF NOT FOUND OR NEW.merchandise_amount IS DISTINCT FROM v_original.unit_price
    OR NEW.buyer_shipping IS DISTINCT FROM v_original.buyer_shipping OR NEW.payment_charge IS DISTINCT FROM v_original.payment_charge
    OR NEW.deadline_at IS DISTINCT FROM v_original.received_at+interval '168 hours'
    OR v_case.created_at<v_original.received_at OR v_case.created_at>NEW.deadline_at
 THEN RAISE EXCEPTION 'Return unit requires its actually received original offer entitlement and submission window' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.waybill_current_request_basis(p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_units jsonb; v_amount numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Waybill scope requires fresh original-order locking' USING ERRCODE='23514'; END IF;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=p_shipment_id FOR UPDATE OF o;
 IF v_order.id IS NULL THEN RAISE EXCEPTION 'Waybill scope retains its actual original parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric-f.merchandise_discount::numeric+f.buyer_shipping::numeric+f.payment_charge::numeric),0)
  INTO v_units,v_amount FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=p_shipment_id AND i.order_id=v_order.id AND NOT EXISTS(
   SELECT 1 FROM app.exception_cancellation cancelled WHERE cancelled.fulfillment_item_id=f.id AND cancelled.replacement_link_id IS NULL);
 IF jsonb_array_length(v_units) NOT BETWEEN 1 AND 100 OR v_amount>9007199254740991
 THEN RAISE EXCEPTION 'Waybill request requires surviving complete original units and bounded original money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'cod_due',CASE WHEN v_order.payment_method='cod' THEN v_amount ELSE 0 END);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.recovery_refund_eligible_units(p_case_id uuid)
RETURNS TABLE(exception_unit_id uuid,fulfillment_item_id uuid,receipt_id uuid,purchase_event_id uuid,
 merchandise_amount bigint,buyer_shipping bigint,payment_charge bigint,amount numeric,transaction_id uuid,source_event_id uuid,source_amount bigint)
LANGUAGE sql STABLE AS $$
 WITH applied AS (
  SELECT event.id,event.snapshot->'application' application FROM app.exception_event event WHERE event.exception_id=p_case_id
   AND event.kind IN ('cancel','source_reconciled') AND jsonb_typeof(event.snapshot->'application')='object'
   ORDER BY event.revision DESC LIMIT 1
 )
 SELECT unit.id,original.id,receipt.id,purchase.id,(item.unit_price-original.merchandise_discount)::bigint,original.buyer_shipping::bigint,original.payment_charge::bigint,
  item.unit_price::numeric-original.merchandise_discount::numeric+original.buyer_shipping::numeric+original.payment_charge::numeric,receipt.transaction_id,receipt.event_id::uuid,receipt.amount
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
   IF (NEW.amount,NEW.merchandise_amount,NEW.buyer_shipping,NEW.payment_charge) IS DISTINCT FROM (o.buyer_total+o.payment_charge_amount,o.merchandise_amount-o.merchandise_discount,o.shipping_amount-o.subsidy_amount,o.payment_charge_amount)
   THEN RAISE EXCEPTION 'Prepaid receipt equals frozen buyer total' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO s FROM app.order_shipment WHERE id=NEW.shipment_id AND order_id=NEW.order_id;
   SELECT * INTO v_operation FROM app.local_cod_operation WHERE id::text=NEW.effect_reference AND shipment_id=s.id AND environment=NEW.environment;
   IF s.id IS NULL OR v_operation.id IS NULL OR v_operation.status<>'collected'
   THEN RAISE EXCEPTION 'COD receipt retains its actual original collection operation' USING ERRCODE='23514'; END IF;
   v_basis:=app.cod_operation_collection_basis(v_operation.id);
   IF (NEW.amount,NEW.merchandise_amount,NEW.buyer_shipping,NEW.payment_charge) IS DISTINCT FROM
      ((v_basis->>'amount')::bigint,(v_basis->>'merchandise_amount')::bigint,(v_basis->>'buyer_shipping')::bigint,(v_basis->>'payment_charge')::bigint)
   THEN RAISE EXCEPTION 'COD receipt equals its exact frozen original source unit entitlement' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.recorded_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.purchase_signal_payload(selected uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('currency','IDR','contents',coalesce(jsonb_agg(jsonb_build_object('id',part.catalog_id,'quantity',part.quantity,'merchandise_amount',part.net::bigint*part.quantity) ORDER BY part.id,part.net DESC),'[]'::jsonb),'content_ids',coalesce(jsonb_agg(part.catalog_id ORDER BY part.id,part.net DESC),'[]'::jsonb))
 FROM (SELECT i.id,o.catalog_id,i.unit_price-f.merchandise_discount net,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.offer o ON o.id=i.offer_id
  WHERE i.order_id=selected GROUP BY i.id,o.catalog_id,i.unit_price-f.merchandise_discount) part;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.purchase_receipt_payload(selected uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN receipt.kind='prepaid' THEN app.purchase_signal_payload(receipt.order_id) ELSE (
  SELECT jsonb_build_object('currency','IDR','contents',coalesce(jsonb_agg(jsonb_build_object('id',part.catalog_id,'quantity',part.quantity,'merchandise_amount',part.net::bigint*part.quantity) ORDER BY part.id,part.net DESC),'[]'::jsonb),'content_ids',coalesce(jsonb_agg(part.catalog_id ORDER BY part.id,part.net DESC),'[]'::jsonb)) FROM (
   SELECT i.id,o.catalog_id,i.unit_price-f.merchandise_discount net,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.offer o ON o.id=i.offer_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=receipt.order_id AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id)) GROUP BY i.id,o.catalog_id,i.unit_price-f.merchandise_discount
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
   SELECT jsonb_agg(jsonb_build_array(part.id,part.quantity,part.net) ORDER BY part.id) INTO expected FROM (SELECT i.id,count(*)::int quantity,sum(i.unit_price::bigint-f.merchandise_discount) net FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE i.order_id=event.order_id GROUP BY i.id) part;
  ELSE
   SELECT jsonb_agg(jsonb_build_array(part.id,part.quantity,part.net) ORDER BY part.id) INTO expected FROM (SELECT i.id,count(*)::int quantity,sum(i.unit_price::bigint-f.merchandise_discount) net FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=event.order_id AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id)) GROUP BY i.id) part;
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
CREATE OR REPLACE FUNCTION app.exception_promotion_unit_shares(selected uuid)
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
 -- S177 stage 2B: the one store voucher of a reservation releases exactly each cancelled unit's frozen discount.
 UNION ALL
 SELECT store.promotion_id,unit.id,unit.merchandise_discount
 FROM (SELECT DISTINCT line.promotion_id FROM app.promotion_line_allocation line WHERE line.reservation_id=selected) store
 CROSS JOIN app.fulfillment_item unit JOIN app.order_item item ON item.id=unit.order_item_id
 JOIN app.commerce_order purchase ON purchase.id=item.order_id
 WHERE purchase.promotion_reservation_id=selected AND unit.merchandise_discount>0
$$;
