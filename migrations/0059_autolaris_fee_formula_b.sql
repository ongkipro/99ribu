-- DEC-032 (owner 2026-11-11, "rumus B"): the buyer pays the AutoLaris admin fee, which covers both AutoLaris deductions: the
-- transaction fee of the channel rule (`fixed` rupiah for a VA, `bps` of the bill for QRIS; reported as `biaya_admin`) and the
-- account-wide turnover cut `autolaris_turnover_bps` of the payment policy (1% of the paid amount, taken at settlement; absent = 0).
-- Formula B: fee = smallest whole rupiah with bill - channel - ceil(bill*turnover/10000) >= due, where bill = due + fee and
-- channel = fixed, or ceil(bill*bps/10000). With no turnover a `fixed` rule is exactly the 0046 value; a `bps` rule (QRIS) can be
-- Rp1 lower where two consecutive bills leave the same net (0046 took the largest, formula B the smallest). The guard triggers call
-- this only at INSERT, in the same transaction that froze the fee, so no stored attempt is re-derived; QRIS is not offered in
-- production (QRIS_IMAGE_READY) and no production attempt exists under a `bps` rule.
-- Same rule as src/modules/payments/methods.ts:autolarisBuyerFee (tests/integration/payment-fees.test.ts compares them).
-- Rollback: reverting needs a forward migration restoring the 0046 body (applied files are immutable), and is safe only while no
-- payment version carries a non-zero autolaris_turnover_bps (the old body would ignore it and attempts would no longer match).
CREATE OR REPLACE FUNCTION app.autolaris_buyer_fee(p_channel text,p_due numeric,p_at timestamptz) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE v_values jsonb; v_rule jsonb; v_fixed numeric:=0; v_bps numeric:=0; v_turnover numeric; v_x numeric;
BEGIN
 SELECT v.values INTO v_values FROM app.policy_version v WHERE v.id=app.current_payment_policy_version(p_at);
 IF coalesce(v_values->>'payment_fee_bearer','store')<>'buyer' THEN RETURN 0; END IF;
 v_rule:=v_values->'autolaris_fees'->p_channel;
 IF v_rule IS NULL THEN RAISE EXCEPTION 'Buyer-borne fee requires a fee row for the channel' USING ERRCODE='23514'; END IF;
 IF v_rule->>'kind'='fixed' THEN v_fixed:=(v_rule->>'amount')::numeric;
 ELSIF v_rule->>'kind'='bps' THEN v_bps:=(v_rule->>'bps')::numeric;
 ELSE RAISE EXCEPTION 'Unknown AutoLaris fee rule' USING ERRCODE='23514'; END IF;
 v_turnover:=coalesce((v_values->>'autolaris_turnover_bps')::numeric,0);
 IF v_fixed IS NULL OR v_bps IS NULL OR v_fixed<0 OR v_bps<0 OR v_turnover<0 OR v_bps+v_turnover>=10000
 THEN RAISE EXCEPTION 'Invalid AutoLaris fee rule' USING ERRCODE='23514'; END IF;
 v_x:=floor((p_due+v_fixed)*10000/(10000-v_bps-v_turnover));
 WHILE v_x-v_fixed-ceil(v_x*v_bps/10000)-ceil(v_x*v_turnover/10000)>=p_due LOOP v_x:=v_x-1; END LOOP;
 WHILE v_x-v_fixed-ceil(v_x*v_bps/10000)-ceil(v_x*v_turnover/10000)<p_due LOOP v_x:=v_x+1; END LOOP;
 RETURN (v_x-p_due)::bigint;
END;
$$;
