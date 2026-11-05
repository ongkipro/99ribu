-- S177 stage 2B decision 10 (docs/spec/vouchers/S177-stage-2b-design.md §6): the per-order margin-floor guard for
-- affiliate-attributed checkouts ignores voucher benefits; approving the voucher is the exception (TS twin: floorBenefits).
CREATE OR REPLACE FUNCTION app.assert_attributed_checkout_cost(p_document jsonb,p_buyer text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_account app.affiliate_account; v_grant app.role_grant; v_policy app.policy_version; v_rate app.affiliate_rate_version;
 v_publication app.publication_version; v_assumption app.offer_cost_assumption_version; v_product uuid;
 v_line jsonb; v_source jsonb; v_expected jsonb; v_plan jsonb:=p_document->'selected_plan'; v_segment record;
 v_at timestamptz; v_user text; v_bps int; v_commission numeric; v_price numeric; v_floor numeric;
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
  SELECT o.price INTO v_price FROM app.offer_revision o WHERE o.product_id=v_publication.product_id AND o.revision=v_publication.product_revision AND o.offer_id=(v_line->>'offer_id')::uuid;
  v_commission:=floor((v_price*v_bps+5000)/10000);
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
       -- S177 decision 10: an approved voucher (a coded promotion) is the owner's floor exception; only automatic subsidy counts.
       AND NOT EXISTS(SELECT 1 FROM app.promotion coded WHERE coded.id=(promotion->>'promotion_id')::uuid AND coded.code IS NOT NULL)
    )) share WHERE share.line_id=(v_line->>'line_id')::uuid
  LOOP
   v_subsidy:=v_subsidy+v_segment.amount;v_worst:=ceil(v_segment.amount::numeric/v_segment.quantity);
   v_contribution:=CASE WHEN v_known THEN v_price-v_hpp-v_assumption.packaging_idr-v_assumption.provider_fee_idr-v_assumption.returns_reserve_idr-v_commission-v_worst END;
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
