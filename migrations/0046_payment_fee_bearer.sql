ALTER TABLE "app"."payment_attempt" ADD COLUMN "payment_fee_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_fee_check" CHECK ("app"."payment_attempt"."payment_fee_amount" between 0 and 1000000 AND ("app"."payment_attempt"."payment_fee_amount"=0 OR "app"."payment_attempt"."method_id"='autolaris'));--> statement-breakpoint
-- DEC-029: the buyer-borne AutoLaris fee for a channel and amount due, from the payment policy in force at the
-- attempt's creation; 0 when the store bears it. Fixed: the table amount. Basis points: the largest X - due with
-- X - ceil(X x bps / 10000) <= due, so the buyer never pays more than the provider deducts (the store absorbs at
-- most the rounding rupiah).
CREATE OR REPLACE FUNCTION app.autolaris_buyer_fee(p_channel text,p_due numeric,p_at timestamptz) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE v_values jsonb; v_rule jsonb; v_bps numeric; v_x numeric;
BEGIN
 SELECT v.values INTO v_values FROM app.policy_version v WHERE v.id=app.current_payment_policy_version(p_at);
 IF coalesce(v_values->>'payment_fee_bearer','store')<>'buyer' THEN RETURN 0; END IF;
 v_rule:=v_values->'autolaris_fees'->p_channel;
 IF v_rule IS NULL THEN RAISE EXCEPTION 'Buyer-borne fee requires a fee row for the channel' USING ERRCODE='23514'; END IF;
 IF v_rule->>'kind'='fixed' THEN RETURN (v_rule->>'amount')::bigint; END IF;
 v_bps:=(v_rule->>'bps')::numeric;
 v_x:=floor(p_due*10000/(10000-v_bps));
 WHILE v_x-ceil(v_x*v_bps/10000)>p_due LOOP v_x:=v_x-1; END LOOP;
 WHILE (v_x+1)-ceil((v_x+1)*v_bps/10000)<=p_due LOOP v_x:=v_x+1; END LOOP;
 RETURN (v_x-p_due)::bigint;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_checkout_quote_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.cart; v_parent app.checkout_quote; v_values jsonb; v_bps integer; v_expected numeric;
BEGIN
 SELECT * INTO c FROM app.cart WHERE id=NEW.cart_id;
 SELECT v.values INTO v_values FROM app.policy_version v WHERE v.id=app.current_payment_policy_version(NEW.created_at);
 -- DEC-029: a store-borne COD fee freezes no buyer COD fee (rate 0, charge 0).
 v_bps:=CASE WHEN v_values->>'cod_fee_bearer'='store' THEN 0 ELSE coalesce((v_values->>'cod_fee_bps')::integer,0) END;
 IF NEW.payment_channel IS NULL OR (NEW.payment_channel='manual-bank' AND jsonb_array_length(coalesce(v_values->'manual_bank_accounts','[]'::jsonb))=0)
 THEN RAISE EXCEPTION 'Quote requires an available payment channel' USING ERRCODE='23514'; END IF;
 IF NEW.payment_method='cod' THEN
  SELECT coalesce(sum(ceil(((parcel->>'merchandise_amount')::numeric+(parcel->>'shipping_amount')::numeric-coalesce((
    SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(NEW.document->'promotions') p CROSS JOIN LATERAL jsonb_array_elements(p->'shipments') a
    WHERE a->>'shipment_id'=parcel->>'id'),0))*v_bps/10000)),0)
   INTO v_expected FROM jsonb_array_elements(NEW.document->'selected_plan'->'packages') parcel;
  IF NEW.cod_fee_bps IS DISTINCT FROM v_bps OR NEW.payment_charge_amount::numeric IS DISTINCT FROM v_expected
  THEN RAISE EXCEPTION 'COD quote freezes the current buyer COD fee rate and exact per-parcel ceiling' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT * INTO v_parent FROM app.checkout_quote WHERE id=NEW.parent_id;
  IF v_parent.payment_channel IS DISTINCT FROM NEW.payment_channel THEN RAISE EXCEPTION 'Selection keeps its parent payment channel' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; event app.payment_attempt_event%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id;
  IF NEW.revision<>0 OR NEW.status<>'preparing' OR NEW.provider_operation_id IS NOT NULL OR NEW.receipt_id IS NOT NULL
    OR o.status IS DISTINCT FROM 'pending' OR o.payment_status IS DISTINCT FROM 'pending' OR o.payment_method IS DISTINCT FROM 'prepaid'
    OR NEW.expected_amount IS DISTINCT FROM o.buyer_total+o.payment_charge_amount+NEW.payment_fee_amount OR NEW.expires_at IS DISTINCT FROM o.expires_at
    OR NEW.method_id IS DISTINCT FROM coalesce(o.payment_channel,'local-prepaid')
    OR NEW.created_at<o.created_at OR NEW.created_at>app.reservation_clock(o.clock_namespace) OR NEW.created_at>=o.expires_at
    OR NOT EXISTS(SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.creation_job_id AND j.kind='payment.create' AND j.dedup_key='payment-create:'||NEW.id::text AND j.payload=jsonb_build_object('attemptId',NEW.id))
  THEN RAISE EXCEPTION 'Payment attempt requires original unpaid order and creation intent' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  SELECT * INTO event FROM app.payment_attempt_event WHERE attempt_id=OLD.id AND revision=OLD.revision+1;
  IF (to_jsonb(NEW)-'revision'-'status'-'provider_operation_id'-'receipt_id') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'status'-'provider_operation_id'-'receipt_id')
    OR NEW.revision<>OLD.revision+1 OR (NEW.status,NEW.provider_operation_id,NEW.receipt_id) IS DISTINCT FROM (event.status,event.provider_operation_id,event.receipt_id)
    OR (OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id)
    OR (OLD.receipt_id IS NOT NULL AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id)
  THEN RAISE EXCEPTION 'Payment head requires exact immutable event' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_autolaris_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt; p app.local_payment_operation;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AutoLaris payments are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM app.payment_attempt WHERE id=NEW.attempt_id;
 IF a.id IS NULL OR a.method_id<>'autolaris' OR NEW.requested_amount IS DISTINCT FROM a.expected_amount
 THEN RAISE EXCEPTION 'An AutoLaris payment binds one AutoLaris attempt and its expected amount' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.operation_id IS NOT NULL OR NEW.responded_at IS NOT NULL THEN RAISE EXCEPTION 'AutoLaris identity is persisted before any provider effect' USING ERRCODE='23514'; END IF;
  -- DEC-029: the attempt's frozen buyer fee is exactly the policy fee for this channel at the attempt's creation.
  IF a.payment_fee_amount IS DISTINCT FROM app.autolaris_buyer_fee(NEW.channel_code,a.expected_amount-a.payment_fee_amount,a.created_at)
  THEN RAISE EXCEPTION 'AutoLaris attempt freezes the policy payment fee for its channel' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF (NEW.attempt_id,NEW.environment,NEW.reff_id,NEW.channel_code,NEW.requested_amount,NEW.created_at) IS DISTINCT FROM (OLD.attempt_id,OLD.environment,OLD.reff_id,OLD.channel_code,OLD.requested_amount,OLD.created_at)
  OR (OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id)
  OR (OLD.responded_at IS NOT NULL AND (NEW.trx_id,NEW.instruction_kind,NEW.instruction_value,NEW.provider_amount,NEW.admin_fee,NEW.provider_total,NEW.refusal_code,NEW.responded_at)
      IS DISTINCT FROM (OLD.trx_id,OLD.instruction_kind,OLD.instruction_value,OLD.provider_amount,OLD.admin_fee,OLD.provider_total,OLD.refusal_code,OLD.responded_at))
 THEN RAISE EXCEPTION 'AutoLaris operation and response are recorded once' USING ERRCODE='23514'; END IF;
 IF NEW.operation_id IS NOT NULL THEN
  SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.operation_id;
  IF p.attempt_id IS DISTINCT FROM a.id OR p.environment IS DISTINCT FROM NEW.environment THEN RAISE EXCEPTION 'AutoLaris payment binds its own attempt operation' USING ERRCODE='23514'; END IF;
 END IF;
 IF OLD.responded_at IS NULL AND NEW.responded_at IS NOT NULL THEN NEW.responded_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
