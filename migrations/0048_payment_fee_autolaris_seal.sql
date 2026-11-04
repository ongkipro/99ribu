-- DEC-029 / S172: an AutoLaris collection equals its settled observation (the bill) minus the attempt's buyer fee.
CREATE OR REPLACE FUNCTION app.seal_autolaris_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt; p app.local_payment_operation; l app.autolaris_payment; o app.autolaris_observation;
BEGIN
 SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.id;
 SELECT * INTO a FROM app.payment_attempt WHERE id=p.attempt_id;
 IF a.method_id='autolaris' THEN
  SELECT * INTO l FROM app.autolaris_payment WHERE attempt_id=a.id;
  IF l.operation_id IS DISTINCT FROM p.id THEN RAISE EXCEPTION 'An AutoLaris operation is bound to its payment identity' USING ERRCODE='23514'; END IF;
  IF p.status='confirmed' THEN
   SELECT * INTO o FROM app.autolaris_observation WHERE attempt_id=a.id AND classification='settled';
   -- DEC-029: the settled observation is the provider's bill; the collection is that bill minus the frozen buyer fee.
   IF l.refusal_code IS NOT NULL OR l.trx_id IS NULL OR o.id IS NULL OR o.amount IS DISTINCT FROM p.collected_amount+a.payment_fee_amount
   THEN RAISE EXCEPTION 'An AutoLaris collection requires its settled observation' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
