ALTER TABLE "app"."promotion_reservation" DROP CONSTRAINT "promotion_reservation_amount_check";--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" ADD CONSTRAINT "promotion_reservation_amount_check" CHECK ("app"."promotion_reservation"."merchandise_amount" between 1 and 9007199254740991 AND "app"."promotion_reservation"."shipping_amount" between 0 and 9007199254740991 AND "app"."promotion_reservation"."subsidy_amount">=0 AND "app"."promotion_reservation"."subsidy_amount"<="app"."promotion_reservation"."shipping_amount" AND "app"."promotion_reservation"."discount_amount">=0 AND "app"."promotion_reservation"."discount_amount"<"app"."promotion_reservation"."merchandise_amount" AND "app"."promotion_reservation"."subsidy_amount"+"app"."promotion_reservation"."discount_amount">0);--> statement-breakpoint
-- S177 R4 review (2026-11-05): a courier re-selection recomputes the voucher like the promotions (a percentage shipping
-- voucher changes amount, a store voucher with a courier filter can become refused); the parent check ignores it.
CREATE OR REPLACE FUNCTION app.guard_checkout_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.cart%ROWTYPE; parent app.checkout_quote%ROWTYPE; plan jsonb; parcel jsonb; chosen jsonb; expected jsonb; amount numeric:=0; subsidy numeric:=0; discount numeric:=0; eligible numeric; package_id text;
BEGIN
 SELECT * INTO c FROM app.cart WHERE id=NEW.cart_id FOR UPDATE;
 plan:=NEW.document->'selected_plan';
 IF c.state IS DISTINCT FROM 'open' OR c.revision IS DISTINCT FROM NEW.cart_revision OR c.expires_at<=app.reservation_clock(c.clock_namespace)
   OR NEW.created_at>app.reservation_clock(c.clock_namespace) OR NEW.created_at<app.reservation_clock(c.clock_namespace)-interval '10 seconds'
   OR NEW.expires_at>c.expires_at OR NEW.expires_at>(plan->>'expires_at')::timestamptz OR NEW.expires_at<=app.reservation_clock(c.clock_namespace)
   OR jsonb_typeof(plan) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.document->'plans') IS DISTINCT FROM 'array'
   OR jsonb_array_length(NEW.document->'plans') NOT BETWEEN 1 AND 20
   OR (plan->>'payment_method') IS DISTINCT FROM NEW.payment_method
   OR (plan->>'merchandise_total')::numeric IS DISTINCT FROM NEW.merchandise_amount
   OR (plan->>'shipping_total')::numeric IS DISTINCT FROM NEW.shipping_amount
   OR (plan->>'source') IS NULL OR (plan->>'source') NOT IN ('TEST-ONLY','mengantar')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'plans') p WHERE app.commerce_plan_skeleton(p)=app.commerce_plan_skeleton(plan))
 THEN RAISE EXCEPTION 'Quote requires current cart and issued bounded plan' USING ERRCODE='23514'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
   SELECT * INTO parent FROM app.checkout_quote WHERE id=NEW.parent_id;
   IF parent.cart_id IS DISTINCT FROM NEW.cart_id OR parent.cart_revision IS DISTINCT FROM NEW.cart_revision
     OR c.active_quote_id IS DISTINCT FROM NEW.parent_id OR NEW.expires_at>parent.expires_at
     OR (NEW.document-'selected_plan'-'promotions'-'financial_sources'-'voucher') IS DISTINCT FROM (parent.document-'selected_plan'-'promotions'-'financial_sources'-'voucher')
   THEN RAISE EXCEPTION 'Selection preserves parent context and deadline' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('line_id',id,'product_id',product_id,'offer_id',offer_id,'publication_id',publication_id,'product_revision',product_revision,'quantity',quantity) ORDER BY id)
   INTO expected FROM app.cart_line WHERE cart_id=c.id;
 IF expected IS NULL OR expected IS DISTINCT FROM (SELECT jsonb_agg(l ORDER BY l->>'line_id') FROM jsonb_array_elements(plan->'lines') l)
   OR (SELECT sum(quantity) FROM app.cart_line WHERE cart_id=c.id)>50
   OR NEW.merchandise_amount IS DISTINCT FROM (SELECT sum(quantity*unit_price) FROM app.cart_line WHERE cart_id=c.id)
 THEN RAISE EXCEPTION 'Quote conserves current complete offer quantities' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(plan->'packages') IS DISTINCT FROM 'array' OR jsonb_array_length(plan->'packages') NOT BETWEEN 1 AND 50
   OR (SELECT count(*)<>count(DISTINCT p->>'id') FROM jsonb_array_elements(plan->'packages') p)
 THEN RAISE EXCEPTION 'Quote requires distinct bounded parcels' USING ERRCODE='23514'; END IF;
 FOR parcel IN SELECT value FROM jsonb_array_elements(plan->'packages') LOOP
   SELECT r INTO chosen FROM jsonb_array_elements(parcel->'options') r WHERE r->>'id'=parcel->>'selected_option_id';
   IF chosen IS NULL OR chosen->>'source' IS NULL OR chosen->>'source' IS DISTINCT FROM plan->>'source'
     OR (chosen->>'shipping_amount')::numeric IS DISTINCT FROM (parcel->>'shipping_amount')::numeric
     OR (chosen->>'expires_at')::timestamptz<NEW.expires_at OR (NEW.payment_method='cod' AND (chosen->>'supports_cod')::boolean IS DISTINCT FROM true)
     OR NOT EXISTS(SELECT 1 FROM app.warehouse WHERE id=(parcel->>'warehouse_id')::uuid AND active)
     OR (SELECT count(*)<>count(DISTINCT l->>'line_id') FROM jsonb_array_elements(parcel->'lines') l)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(parcel->'lines') l WHERE (l->>'quantity')::int<=0 OR NOT EXISTS(SELECT 1 FROM app.cart_line WHERE cart_id=c.id AND id=(l->>'line_id')::uuid))
     OR (parcel->>'merchandise_amount')::numeric IS DISTINCT FROM (SELECT sum((l->>'quantity')::numeric*(SELECT cl.unit_price FROM app.cart_line cl WHERE cl.cart_id=c.id AND cl.id=(l->>'line_id')::uuid)) FROM jsonb_array_elements(parcel->'lines') l)
   THEN RAISE EXCEPTION 'Quote parcel requires issued rate and complete lines' USING ERRCODE='23514'; END IF;
   amount:=amount+(parcel->>'shipping_amount')::numeric;
 END LOOP;
 IF amount<>NEW.shipping_amount OR EXISTS(
   SELECT 1 FROM app.cart_line l WHERE l.cart_id=c.id AND l.quantity<>(SELECT coalesce(sum((part->>'quantity')::int),0)
     FROM jsonb_array_elements(plan->'packages') p CROSS JOIN LATERAL jsonb_array_elements(p->'lines') part WHERE part->>'line_id'=l.id::text))
 THEN RAISE EXCEPTION 'Quote parcel totals must conserve cart' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.document->'promotions') IS DISTINCT FROM 'array'
   OR (SELECT count(*)<>count(DISTINCT a->>'promotion_id') FROM jsonb_array_elements(NEW.document->'promotions') a)
 THEN RAISE EXCEPTION 'Quote promotion snapshots must be distinct' USING ERRCODE='23514'; END IF;
 FOR chosen IN SELECT value FROM jsonb_array_elements(NEW.document->'promotions') LOOP
   -- S177 stage 2B: a store voucher lists cart lines (no parcels) and adds to merchandise_discount; each line keeps Rp1 per unit.
   IF jsonb_array_length(coalesce(chosen->'lines','[]'::jsonb))>0 THEN
     IF NOT EXISTS(SELECT 1 FROM app.promotion_version v JOIN app.promotion p ON p.id=v.promotion_id WHERE v.id=(chosen->>'version_id')::uuid AND v.promotion_id=(chosen->>'promotion_id')::uuid AND v.target='merchandise' AND p.code IS NOT NULL)
       OR jsonb_array_length(coalesce(chosen->'shipments','[]'::jsonb))>0
       OR (chosen->>'amount')::numeric<=0 OR (chosen->>'amount')::numeric IS DISTINCT FROM (SELECT sum((l->>'amount')::numeric) FROM jsonb_array_elements(chosen->'lines') l)
       OR (SELECT count(*)<>count(DISTINCT l->>'line_id') FROM jsonb_array_elements(chosen->'lines') l)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(chosen->'lines') l WHERE (l->>'amount')::numeric<=0 OR NOT EXISTS(SELECT 1 FROM app.cart_line cl WHERE cl.cart_id=c.id AND cl.id::text=l->>'line_id'
         AND (l->>'amount')::numeric<=cl.quantity::numeric*(cl.unit_price-1)))
     THEN RAISE EXCEPTION 'Quote store voucher allocation invalid' USING ERRCODE='23514'; END IF;
     discount:=discount+(chosen->>'amount')::numeric; CONTINUE;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM app.promotion_version WHERE id=(chosen->>'version_id')::uuid AND promotion_id=(chosen->>'promotion_id')::uuid AND target='shipping')
     OR (chosen->>'amount')::numeric<=0 OR (chosen->>'amount')::numeric IS DISTINCT FROM (SELECT sum((s->>'amount')::numeric) FROM jsonb_array_elements(chosen->'shipments') s)
     OR (SELECT count(*)<>count(DISTINCT s->>'shipment_id') FROM jsonb_array_elements(chosen->'shipments') s)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(chosen->'shipments') s WHERE (s->>'amount')::numeric<=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'packages') p WHERE p->>'id'=s->>'shipment_id'))
   THEN RAISE EXCEPTION 'Quote promotion source/allocation invalid' USING ERRCODE='23514'; END IF;
   subsidy:=subsidy+(chosen->>'amount')::numeric;
 END LOOP;
 FOR parcel IN SELECT value FROM jsonb_array_elements(plan->'packages') LOOP
   package_id:=parcel->>'id';
   SELECT coalesce(sum((s->>'amount')::numeric),0) INTO eligible FROM jsonb_array_elements(NEW.document->'promotions') a CROSS JOIN LATERAL jsonb_array_elements(a->'shipments') s WHERE s->>'shipment_id'=package_id;
   IF eligible>(parcel->>'shipping_amount')::numeric THEN RAISE EXCEPTION 'Subsidy exceeds parcel fee' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF subsidy<>NEW.subsidy_amount THEN RAISE EXCEPTION 'Quote subsidy total mismatch' USING ERRCODE='23514'; END IF;
 IF discount<>NEW.merchandise_discount OR (SELECT count(*) FROM jsonb_array_elements(NEW.document->'promotions') a WHERE jsonb_array_length(coalesce(a->'lines','[]'::jsonb))>0)>1
 THEN RAISE EXCEPTION 'Quote store voucher total mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
