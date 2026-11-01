ALTER TABLE "app"."cart_line" DROP CONSTRAINT "cart_line_value_check";--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" DROP CONSTRAINT "checkout_quote_value_check";--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_value_check";--> statement-breakpoint
ALTER TABLE "app"."offer_revision" DROP CONSTRAINT "offer_fixed_price_check";--> statement-breakpoint
ALTER TABLE "app"."order_item" DROP CONSTRAINT "order_item_value_check";--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" DROP CONSTRAINT "promotion_reservation_amount_check";--> statement-breakpoint
ALTER TABLE "app"."purchase_allocation" DROP CONSTRAINT "purchase_allocation_value_check";--> statement-breakpoint
ALTER TABLE "app"."recovery_adjustment_intent" DROP CONSTRAINT "recovery_adjustment_value_check";--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" DROP CONSTRAINT "recovery_allocation_value_check";--> statement-breakpoint
ALTER TABLE "app"."refund_adjustment_intent" DROP CONSTRAINT "refund_adjustment_value_check";--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" DROP CONSTRAINT "refund_allocation_value_check";--> statement-breakpoint
ALTER TABLE "app"."return_item" DROP CONSTRAINT "return_item_value_check";--> statement-breakpoint
ALTER TABLE "app"."cart_line" ADD CONSTRAINT "cart_line_value_check" CHECK ("app"."cart_line"."quantity" between 1 and 50 AND "app"."cart_line"."unit_price" between 1 and 99000);--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD CONSTRAINT "checkout_quote_value_check" CHECK ("app"."checkout_quote"."cart_revision">0 AND "app"."checkout_quote"."payment_method" IN ('prepaid','cod') AND "app"."checkout_quote"."merchandise_amount" between 1 and 4950000 AND "app"."checkout_quote"."shipping_amount" between 0 and 9007199254740991 AND "app"."checkout_quote"."subsidy_amount" between 0 and "app"."checkout_quote"."shipping_amount" AND "app"."checkout_quote"."buyer_total"="app"."checkout_quote"."merchandise_amount"+"app"."checkout_quote"."shipping_amount"-"app"."checkout_quote"."subsidy_amount" AND "app"."checkout_quote"."buyer_total"<=9007199254740991);--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_value_check" CHECK ("app"."commerce_order"."number" ~ '^99-[A-Z0-9]{16}$' AND "app"."commerce_order"."payment_method" IN ('prepaid','cod') AND "app"."commerce_order"."merchandise_amount" between 1 and 4950000 AND "app"."commerce_order"."shipping_amount" between 0 and 9007199254740991 AND "app"."commerce_order"."subsidy_amount" between 0 and "app"."commerce_order"."shipping_amount" AND "app"."commerce_order"."buyer_total"="app"."commerce_order"."merchandise_amount"+"app"."commerce_order"."shipping_amount"-"app"."commerce_order"."subsidy_amount" AND "app"."commerce_order"."buyer_total"<=9007199254740991 AND ("app"."commerce_order"."buyer_note" IS NULL OR char_length("app"."commerce_order"."buyer_note")<=500));--> statement-breakpoint
ALTER TABLE "app"."offer_revision" ADD CONSTRAINT "offer_price_ceiling_check" CHECK ("app"."offer_revision"."price" between 1 and 99000 AND "app"."offer_revision"."currency"='IDR');--> statement-breakpoint
ALTER TABLE "app"."order_item" ADD CONSTRAINT "order_item_value_check" CHECK ("app"."order_item"."quantity" between 1 and 50 AND "app"."order_item"."unit_price" between 1 and 99000 AND jsonb_typeof("app"."order_item"."snapshot")='object');--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" ADD CONSTRAINT "promotion_reservation_amount_check" CHECK ("app"."promotion_reservation"."merchandise_amount" between 1 and 9007199254740991 AND "app"."promotion_reservation"."shipping_amount" between 1 and 9007199254740991 AND "app"."promotion_reservation"."subsidy_amount">0 AND "app"."promotion_reservation"."subsidy_amount"<="app"."promotion_reservation"."shipping_amount");--> statement-breakpoint
ALTER TABLE "app"."purchase_allocation" ADD CONSTRAINT "purchase_allocation_value_check" CHECK ("app"."purchase_allocation"."quantity">0 AND "app"."purchase_allocation"."merchandise_amount" between "app"."purchase_allocation"."quantity" and 99000::bigint*"app"."purchase_allocation"."quantity");--> statement-breakpoint
ALTER TABLE "app"."recovery_adjustment_intent" ADD CONSTRAINT "recovery_adjustment_value_check" CHECK ((("app"."recovery_adjustment_intent"."purchase_event_id" IS NULL AND "app"."recovery_adjustment_intent"."dispatch_reason"='original_purchase_missing') OR ("app"."recovery_adjustment_intent"."purchase_event_id" IS NOT NULL AND "app"."recovery_adjustment_intent"."dispatch_reason"='pending_adapter')) AND "app"."recovery_adjustment_intent"."sequence">0 AND "app"."recovery_adjustment_intent"."merchandise_refunded" between 1 and 9007199254740991 AND "app"."recovery_adjustment_intent"."retained_merchandise" between 0 and 9007199254740991 AND jsonb_typeof("app"."recovery_adjustment_intent"."allocation")='array' AND jsonb_array_length("app"."recovery_adjustment_intent"."allocation") between 1 and 100 AND "app"."recovery_adjustment_intent"."confirmed_at">="app"."recovery_adjustment_intent"."original_occurred_at");--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD CONSTRAINT "recovery_allocation_value_check" CHECK ("app"."recovery_refund_allocation"."amount" between 1 and 9007199254740991 AND (("app"."recovery_refund_allocation"."exception_unit_id" IS NOT NULL AND "app"."recovery_refund_allocation"."fulfillment_item_id" IS NOT NULL AND "app"."recovery_refund_allocation"."receipt_id" IS NOT NULL AND "app"."recovery_refund_allocation"."merchandise_amount" between 1 and 99000 AND "app"."recovery_refund_allocation"."buyer_shipping">=0 AND "app"."recovery_refund_allocation"."payment_charge">=0 AND "app"."recovery_refund_allocation"."amount"::numeric="app"."recovery_refund_allocation"."merchandise_amount"::numeric+"app"."recovery_refund_allocation"."buyer_shipping"::numeric+"app"."recovery_refund_allocation"."payment_charge"::numeric) OR ("app"."recovery_refund_allocation"."exception_unit_id" IS NULL AND "app"."recovery_refund_allocation"."fulfillment_item_id" IS NULL AND "app"."recovery_refund_allocation"."receipt_id" IS NULL AND "app"."recovery_refund_allocation"."purchase_event_id" IS NULL AND "app"."recovery_refund_allocation"."merchandise_amount"=0 AND "app"."recovery_refund_allocation"."buyer_shipping"=0 AND "app"."recovery_refund_allocation"."payment_charge"=0)));--> statement-breakpoint
ALTER TABLE "app"."refund_adjustment_intent" ADD CONSTRAINT "refund_adjustment_value_check" CHECK ((("app"."refund_adjustment_intent"."purchase_event_id" IS NULL AND "app"."refund_adjustment_intent"."dispatch_reason"='original_purchase_missing') OR ("app"."refund_adjustment_intent"."purchase_event_id" IS NOT NULL AND "app"."refund_adjustment_intent"."dispatch_reason"='pending_adapter')) AND "app"."refund_adjustment_intent"."sequence">0 AND "app"."refund_adjustment_intent"."merchandise_refunded" between 1 and 9007199254740991 AND "app"."refund_adjustment_intent"."retained_merchandise" between 0 and 9007199254740991 AND jsonb_typeof("app"."refund_adjustment_intent"."allocation")='array' AND jsonb_array_length("app"."refund_adjustment_intent"."allocation") between 1 and 100 AND "app"."refund_adjustment_intent"."confirmed_at">="app"."refund_adjustment_intent"."original_occurred_at");--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" ADD CONSTRAINT "refund_allocation_value_check" CHECK ("app"."refund_allocation"."merchandise_amount" between 1 and 99000 AND "app"."refund_allocation"."buyer_shipping">=0 AND "app"."refund_allocation"."payment_charge">=0 AND "app"."refund_allocation"."amount" between 1 and 9007199254740991 AND "app"."refund_allocation"."amount"::numeric="app"."refund_allocation"."merchandise_amount"::numeric+"app"."refund_allocation"."buyer_shipping"::numeric+"app"."refund_allocation"."payment_charge"::numeric);--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD CONSTRAINT "return_item_value_check" CHECK ("app"."return_item"."reason" IN ('wrong_item','damaged','defective','not_as_described','incomplete','expired','broken_mandatory_seal') AND char_length("app"."return_item"."details")<=2000 AND "app"."return_item"."merchandise_amount" between 1 and 99000 AND "app"."return_item"."buyer_shipping" between 0 and 9007199254641991 AND "app"."return_item"."payment_charge" between 0 and 9007199254740991 AND "app"."return_item"."claim_state" IN ('held','released','refunded','replacing','replaced') AND "app"."return_item"."inspection_status" IN ('pending','accepted','rejected','needs_review','waived'));--> statement-breakpoint
-- DEC-025 / S148 (hand-written, outside the Drizzle snapshot): the price ceiling replaces the fixed IDR 99,000 price.
-- A cart line and an order item take their unit price from the offer revision they reference (never from the caller),
-- and every money guard below uses that frozen unit price instead of the former constant. Existing rows are all
-- IDR 99,000, which the ceiling still allows, so no data changes.
CREATE FUNCTION app.freeze_offer_unit_price() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_price integer;
BEGIN
 SELECT o.price INTO v_price FROM app.offer_revision o WHERE o.product_id=NEW.product_id AND o.revision=NEW.product_revision AND o.offer_id=NEW.offer_id;
 IF v_price IS NULL THEN RAISE EXCEPTION 'Line references an existing offer revision' USING ERRCODE='23503'; END IF;
 NEW.unit_price:=v_price; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cart_line_unit_price BEFORE INSERT OR UPDATE OF product_id,product_revision,offer_id,unit_price ON app.cart_line FOR EACH ROW EXECUTE FUNCTION app.freeze_offer_unit_price();
--> statement-breakpoint
CREATE TRIGGER order_item_unit_price BEFORE INSERT ON app.order_item FOR EACH ROW EXECUTE FUNCTION app.freeze_offer_unit_price();
--> statement-breakpoint
-- A returned, refunded or recovered unit carries exactly its order item's unit price.
CREATE FUNCTION app.assert_unit_merchandise() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_unit uuid; v_price bigint;
BEGIN
 IF TG_TABLE_NAME='refund_allocation' THEN SELECT r.fulfillment_item_id INTO v_unit FROM app.return_item r WHERE r.id=NEW.return_item_id;
 ELSIF TG_TABLE_NAME='recovery_refund_allocation' THEN IF NEW.fulfillment_item_id IS NULL THEN RETURN NEW; END IF; v_unit:=NEW.fulfillment_item_id;
 ELSE v_unit:=NEW.fulfillment_item_id; END IF;
 SELECT i.unit_price INTO v_price FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE f.id=v_unit;
 IF v_price IS NULL OR NEW.merchandise_amount IS DISTINCT FROM v_price THEN
  RAISE EXCEPTION 'Unit merchandise equals its order item unit price' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_item_unit_merchandise BEFORE INSERT OR UPDATE OF merchandise_amount ON app.return_item FOR EACH ROW EXECUTE FUNCTION app.assert_unit_merchandise();
--> statement-breakpoint
CREATE TRIGGER refund_allocation_unit_merchandise BEFORE INSERT OR UPDATE OF merchandise_amount ON app.refund_allocation FOR EACH ROW EXECUTE FUNCTION app.assert_unit_merchandise();
--> statement-breakpoint
CREATE TRIGGER recovery_allocation_unit_merchandise BEFORE INSERT OR UPDATE OF merchandise_amount ON app.recovery_refund_allocation FOR EACH ROW EXECUTE FUNCTION app.assert_unit_merchandise();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.check_publication_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_row app.policy_version%ROWTYPE; offer_row app.publication_offer%ROWTYPE;
  assumption app.offer_cost_assumption_version%ROWTYPE; missing_hpp boolean; hpp numeric; v_price numeric; contribution numeric; all_known boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.publication_head WHERE product_id=NEW.product_id AND revision>=NEW.revision) THEN
    RAISE EXCEPTION 'Publication version and head commit together' USING ERRCODE='23514';
  END IF;
  SELECT v.* INTO policy_row FROM app.policy_version v JOIN app.policy_head h ON h.id=v.head_id
    WHERE h.kind='commercial' AND h.warehouse_id IS NULL AND v.effective_at<=NEW.evaluated_at
    ORDER BY v.effective_at DESC,v.revision DESC LIMIT 1;
  IF policy_row.id IS DISTINCT FROM NEW.policy_version_id
    OR coalesce((policy_row.values->>'minimum_contribution_idr')::integer,0)<>NEW.minimum_contribution_idr
    OR (policy_row.values->>'default_commission_bps')::integer IS DISTINCT FROM NEW.commission_bps THEN
    RAISE EXCEPTION 'Publication freezes its actual effective commercial policy' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.offer_revision WHERE product_id=NEW.product_id AND revision=NEW.product_revision AND NOT retired)
    OR EXISTS (
      SELECT 1 FROM (SELECT offer_id FROM app.offer_revision WHERE product_id=NEW.product_id AND revision=NEW.product_revision AND NOT retired) required
      FULL JOIN (SELECT offer_id FROM app.publication_offer WHERE publication_id=NEW.id) captured USING (offer_id)
      WHERE required.offer_id IS NULL OR captured.offer_id IS NULL
    ) THEN RAISE EXCEPTION 'Publication captures every active offer exactly' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.product_revision WHERE product_id=NEW.product_id AND revision=NEW.product_revision AND jsonb_array_length(images)>0) THEN
    RAISE EXCEPTION 'Publication requires product media' USING ERRCODE='23514';
  END IF;
  FOR offer_row IN SELECT * FROM app.publication_offer WHERE publication_id=NEW.id LOOP
    IF EXISTS (
      SELECT 1 FROM (SELECT stock_item_id,quantity FROM app.offer_component WHERE product_id=NEW.product_id AND revision=NEW.product_revision AND offer_id=offer_row.offer_id) required
      FULL JOIN (SELECT stock_item_id,quantity FROM app.publication_component_cost WHERE publication_id=NEW.id AND offer_id=offer_row.offer_id) captured USING (stock_item_id)
      WHERE required.quantity IS DISTINCT FROM captured.quantity
    ) THEN RAISE EXCEPTION 'Publication freezes exact complete physical contents' USING ERRCODE='23514'; END IF;
    IF EXISTS (
      SELECT 1 FROM app.publication_component_cost c WHERE c.publication_id=NEW.id AND c.offer_id=offer_row.offer_id
        AND c.cost_version_id IS DISTINCT FROM (
          SELECT id FROM app.component_cost_version WHERE stock_item_id=c.stock_item_id AND effective_at<=NEW.evaluated_at ORDER BY effective_at DESC,revision DESC LIMIT 1
        )
    ) THEN RAISE EXCEPTION 'Publication uses actual effective component costs' USING ERRCODE='23514'; END IF;
    SELECT * INTO assumption FROM app.offer_cost_assumption_version WHERE offer_id=offer_row.offer_id AND effective_at<=NEW.evaluated_at
      ORDER BY effective_at DESC,revision DESC LIMIT 1;
    IF assumption.id IS DISTINCT FROM offer_row.assumption_version_id THEN
      RAISE EXCEPTION 'Publication uses its actual effective offer assumptions' USING ERRCODE='23514';
    END IF;
    SELECT bool_or(v.unit_cost IS NULL),sum(c.quantity::numeric*v.unit_cost) INTO missing_hpp,hpp
      FROM app.publication_component_cost c LEFT JOIN app.component_cost_version v ON v.id=c.cost_version_id
      WHERE c.publication_id=NEW.id AND c.offer_id=offer_row.offer_id;
    IF missing_hpp THEN hpp:=NULL; END IF;
    SELECT o.price INTO v_price FROM app.offer_revision o WHERE o.product_id=NEW.product_id AND o.revision=NEW.product_revision AND o.offer_id=offer_row.offer_id;
    all_known:=hpp IS NOT NULL AND assumption.id IS NOT NULL AND assumption.packaging_idr IS NOT NULL
      AND assumption.provider_fee_idr IS NOT NULL AND assumption.subsidy_idr IS NOT NULL AND assumption.returns_reserve_idr IS NOT NULL;
    contribution:=CASE WHEN all_known THEN v_price-hpp-assumption.packaging_idr-assumption.provider_fee_idr-assumption.subsidy_idr-assumption.returns_reserve_idr
      -floor((v_price*NEW.commission_bps+5000)/10000) ELSE NULL END;
    IF offer_row.estimated_hpp::numeric IS DISTINCT FROM hpp OR offer_row.estimated_contribution::numeric IS DISTINCT FROM contribution OR offer_row.complete IS DISTINCT FROM all_known THEN
      RAISE EXCEPTION 'Publication cost completeness and arithmetic are independently derived' USING ERRCODE='23514';
    END IF;
    IF (NOT all_known OR contribution<NEW.minimum_contribution_idr) AND NEW.exception_reason IS NULL THEN
      RAISE EXCEPTION 'Unknown or below-floor contribution requires an explicit owner exception' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM app.offer_revision o JOIN app.offer_component c ON c.product_id=o.product_id AND c.revision=o.revision AND c.offer_id=o.offer_id
      JOIN app.warehouse w ON w.id=o.default_warehouse_id WHERE o.product_id=NEW.product_id AND o.revision=NEW.product_revision AND o.offer_id=offer_row.offer_id
        AND (NOT w.active OR coalesce((SELECT sum((b.on_hand-b.reserved-b.quarantined)::bigint) FROM app.inventory_balance b
          LEFT JOIN app.inventory_lot l ON l.id=b.lot_id WHERE b.warehouse_id=w.id AND b.stock_item_id=c.stock_item_id
          AND (l.expires_on IS NULL OR l.expires_on>=(app.inventory_clock(w.id,NULL) AT TIME ZONE w.timezone)::date)),0)<c.quantity)
    ) THEN RAISE EXCEPTION 'Publication requires actual complete sellable warehouse stock' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_checkout_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.cart%ROWTYPE; parent app.checkout_quote%ROWTYPE; plan jsonb; parcel jsonb; chosen jsonb; expected jsonb; amount numeric:=0; subsidy numeric:=0; eligible numeric; package_id text;
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
     OR (NEW.document-'selected_plan'-'promotions'-'financial_sources') IS DISTINCT FROM (parent.document-'selected_plan'-'promotions'-'financial_sources')
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
   IF NOT EXISTS(SELECT 1 FROM app.promotion_version WHERE id=(chosen->>'version_id')::uuid AND promotion_id=(chosen->>'promotion_id')::uuid)
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
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.seal_commerce_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; q app.checkout_quote%ROWTYPE; selected uuid; parcel jsonb; item app.order_item%ROWTYPE; occurrence app.fulfillment_item%ROWTYPE; expected jsonb; actual jsonb;
BEGIN
 IF TG_TABLE_NAME='commerce_order' THEN selected:=NEW.id;
 ELSIF TG_TABLE_NAME='stock_reservation' THEN SELECT id INTO selected FROM app.commerce_order WHERE stock_reservation_id=NEW.id;
 ELSIF TG_TABLE_NAME='promotion_reservation' THEN SELECT id INTO selected FROM app.commerce_order WHERE promotion_reservation_id=NEW.id;
 ELSE selected:=NEW.order_id; END IF;
 IF selected IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO o FROM app.commerce_order WHERE id=selected;
 SELECT * INTO q FROM app.checkout_quote WHERE id=o.quote_id;
 IF o.status='preparing' OR o.revision<>(SELECT count(*) FROM app.order_event WHERE order_id=o.id)
   OR NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND revision=o.revision AND status=o.status AND payment_status=o.payment_status)
   OR NOT EXISTS(SELECT 1 FROM app.cart WHERE id=o.cart_id AND submitted_order_id=o.id AND state='submitted')
   OR NOT EXISTS(SELECT 1 FROM app.commerce_operation op JOIN app.cart c ON c.id=o.cart_id WHERE op.id=o.operation_id AND op.action='order.create' AND op.resource_id=o.id AND op.actor_scope=coalesce('user:'||c.owner_user_id,'guest:'||c.owner_guest_id::text))
 THEN RAISE EXCEPTION 'Order/event/operation/cart must seal together' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('line_id',line_id,'product_id',product_id,'offer_id',offer_id,'publication_id',publication_id,'product_revision',product_revision,'quantity',quantity) ORDER BY line_id)
   INTO actual FROM app.order_item WHERE order_id=o.id;
 SELECT jsonb_agg(l ORDER BY l->>'line_id') INTO expected FROM jsonb_array_elements(q.document->'selected_plan'->'lines') l;
 IF actual IS DISTINCT FROM expected OR (SELECT sum(quantity*unit_price) FROM app.order_item WHERE order_id=o.id) IS DISTINCT FROM o.merchandise_amount
   OR (SELECT count(*) FROM app.order_shipment WHERE order_id=o.id)<>jsonb_array_length(q.document->'selected_plan'->'packages')
 THEN RAISE EXCEPTION 'Order conserves purchased quote lines/parcels' USING ERRCODE='23514'; END IF;
 FOR parcel IN SELECT value FROM jsonb_array_elements(q.document->'selected_plan'->'packages') LOOP
   IF NOT EXISTS(SELECT 1 FROM app.order_shipment s WHERE s.order_id=o.id AND s.parcel_id=parcel->>'id'
     AND s.warehouse_id=(parcel->>'warehouse_id')::uuid AND s.snapshot=parcel AND s.shipping_amount=(parcel->>'shipping_amount')::bigint
     AND s.merchandise_amount=(parcel->>'merchandise_amount')::bigint
     AND s.subsidy_amount=(SELECT coalesce(sum((a->>'amount')::numeric),0) FROM jsonb_array_elements(q.document->'promotions') p CROSS JOIN LATERAL jsonb_array_elements(p->'shipments') a WHERE a->>'shipment_id'=parcel->>'id')
     AND s.cod_due=CASE WHEN o.payment_method='cod' THEN s.merchandise_amount+s.buyer_shipping+s.payment_charge ELSE 0 END
     AND s.payment_charge=(SELECT sum(payment_charge) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND (o.payment_method<>'cod' OR s.payment_charge=ceil((s.merchandise_amount+s.buyer_shipping)::numeric*coalesce(o.cod_fee_bps,0)/10000))
     AND s.merchandise_amount=(SELECT coalesce(sum(i.unit_price),0) FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE fi.shipment_id=s.id)
     AND s.subsidy_amount=(SELECT sum(subsidy_amount) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND s.buyer_shipping=(SELECT sum(buyer_shipping) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parcel->'lines') l WHERE (l->>'quantity')::int<>(SELECT count(*) FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE fi.shipment_id=s.id AND i.line_id=(l->>'line_id')::uuid)))
   THEN RAISE EXCEPTION 'Original shipment conserves quote, unit quantities and money' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF o.payment_charge_amount IS DISTINCT FROM (SELECT coalesce(sum(payment_charge),0) FROM app.order_shipment WHERE order_id=o.id)
 THEN RAISE EXCEPTION 'Buyer-paid payment charge conserves every parcel and unit share' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM app.order_item WHERE order_id=o.id LOOP
   IF item.quantity<>(SELECT count(*) FROM app.fulfillment_item WHERE order_item_id=item.id)
     OR EXISTS(SELECT 1 FROM app.fulfillment_item WHERE order_item_id=item.id AND unit_index>item.quantity)
     OR item.snapshot IS DISTINCT FROM jsonb_build_object('name',(SELECT name FROM app.product_revision WHERE product_id=item.product_id AND revision=item.product_revision),
       'offer',(SELECT jsonb_build_object('label',r.label,'offer_kind',r.kind,'attributes',r.attributes,'contents',(SELECT jsonb_agg(jsonb_build_object('stock_item_id',c.stock_item_id,'name',c.name,'quantity',c.quantity) ORDER BY c.stock_item_id) FROM app.offer_component c WHERE c.product_id=r.product_id AND c.revision=r.revision AND c.offer_id=r.offer_id)) FROM app.offer_revision r WHERE r.product_id=item.product_id AND r.revision=item.product_revision AND r.offer_id=item.offer_id))
   THEN RAISE EXCEPTION 'Original purchased units and contents must match frozen offer' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR occurrence IN SELECT fi.* FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE i.order_id=o.id LOOP
   SELECT jsonb_agg(jsonb_build_array(c.stock_item_id,c.quantity) ORDER BY c.stock_item_id) INTO expected FROM app.offer_component c JOIN app.order_item i ON i.id=occurrence.order_item_id WHERE c.product_id=i.product_id AND c.revision=i.product_revision AND c.offer_id=i.offer_id;
   SELECT jsonb_agg(jsonb_build_array(x.stock_item_id,x.quantity) ORDER BY x.stock_item_id) INTO actual FROM (SELECT stock_item_id,sum(quantity) AS quantity FROM app.fulfillment_component_allocation WHERE fulfillment_item_id=occurrence.id GROUP BY stock_item_id) x;
   IF actual IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM app.fulfillment_component_allocation a JOIN app.inventory_balance b ON b.id=a.balance_id JOIN app.order_shipment s ON s.id=occurrence.shipment_id WHERE a.fulfillment_item_id=occurrence.id AND (b.stock_item_id<>a.stock_item_id OR b.warehouse_id<>s.warehouse_id))
   THEN RAISE EXCEPTION 'Each unit has complete own-warehouse physical components' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO expected FROM app.stock_reservation_component WHERE reservation_id=o.stock_reservation_id;
 SELECT jsonb_agg(jsonb_build_array(balance_id,quantity) ORDER BY balance_id) INTO actual FROM (SELECT a.balance_id,sum(a.quantity) quantity FROM app.fulfillment_component_allocation a JOIN app.fulfillment_item f ON f.id=a.fulfillment_item_id JOIN app.order_item i ON i.id=f.order_item_id WHERE i.order_id=o.id GROUP BY a.balance_id) x;
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM app.stock_reservation r WHERE r.id=o.stock_reservation_id AND r.kind='checkout' AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.expires_at=o.expires_at AND r.status=CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.fulfillment_item unit ON unit.id=cancellation.fulfillment_item_id JOIN app.order_item oi ON oi.id=unit.order_item_id WHERE oi.order_id=o.id AND cancellation.replacement_link_id IS NULL)
  THEN app.retired_reservation_state(r.id) ELSE CASE WHEN o.status='cancelled' THEN 'expired' WHEN NOT EXISTS(SELECT 1 FROM app.order_shipment os LEFT JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=os.id WHERE os.order_id=o.id AND (fulfillment.id IS NULL OR fulfillment.handover_at IS NULL)) THEN 'consumed' ELSE 'active' END END)
 THEN RAISE EXCEPTION 'Physical lot partition conserves the exact order hold' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.stock_reservation_item r FULL JOIN (SELECT f.id::text line_id,i.product_id,i.product_revision,i.offer_id,s.warehouse_id,1 offer_quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.order_shipment s ON s.id=f.shipment_id WHERE i.order_id=o.id) wanted ON wanted.line_id=r.line_id AND r.reservation_id=o.stock_reservation_id WHERE (r.reservation_id=o.stock_reservation_id OR r.reservation_id IS NULL) AND (r.product_id,r.product_revision,r.offer_id,r.warehouse_id,r.offer_quantity) IS DISTINCT FROM (wanted.product_id,wanted.product_revision,wanted.offer_id,wanted.warehouse_id,wanted.offer_quantity))
 THEN RAISE EXCEPTION 'Order stock hold preserves every purchased unit identity' USING ERRCODE='23514'; END IF;
 IF o.promotion_reservation_id IS NOT NULL AND (SELECT jsonb_agg(jsonb_build_object('promotion_id',a.promotion_id,'version_id',a.version_id,'amount',a.amount,'shipments',(SELECT jsonb_agg(jsonb_build_object('shipment_id',s.shipment_id,'amount',s.amount) ORDER BY s.shipment_id) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id)) ORDER BY a.promotion_id) FROM app.promotion_allocation a WHERE a.reservation_id=o.promotion_reservation_id) IS DISTINCT FROM (SELECT jsonb_agg(a ORDER BY a->>'promotion_id') FROM jsonb_array_elements(q.document->'promotions') a)
 THEN RAISE EXCEPTION 'Order preserves exact selected promotion versions and allocations' USING ERRCODE='23514'; END IF;
 IF (o.subsidy_amount=0 AND o.promotion_reservation_id IS NOT NULL) OR (o.subsidy_amount>0 AND NOT EXISTS(SELECT 1 FROM app.promotion_reservation r WHERE r.id=o.promotion_reservation_id AND r.subsidy_amount=o.subsidy_amount AND r.merchandise_amount=o.merchandise_amount AND r.shipping_amount=o.shipping_amount AND r.expires_at=o.expires_at AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.status=CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.fulfillment_item unit ON unit.id=cancellation.fulfillment_item_id JOIN app.order_item oi ON oi.id=unit.order_item_id WHERE oi.order_id=o.id AND cancellation.replacement_link_id IS NULL)
  THEN CASE WHEN EXISTS(SELECT 1 FROM app.promotion_movement movement WHERE movement.reservation_id=r.id AND movement.kind='consume') THEN 'consumed'
   WHEN (SELECT coalesce(sum(reserved_delta::numeric),0) FROM app.promotion_movement WHERE reservation_id=r.id)=0 THEN 'released' ELSE 'active' END
  ELSE CASE WHEN o.status='cancelled' THEN 'expired' WHEN EXISTS(SELECT 1 FROM app.order_shipment os JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=os.id WHERE os.order_id=o.id AND fulfillment.handover_at IS NOT NULL) THEN 'consumed' ELSE 'active' END END))
 THEN RAISE EXCEPTION 'Order requires its exact subsidy hold' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.order_shipment s CROSS JOIN LATERAL app.commerce_parcel_line_money(s.snapshot,s.subsidy_amount) subsidy CROSS JOIN LATERAL app.commerce_parcel_line_money(s.snapshot,s.buyer_shipping) buyer JOIN app.order_item i ON i.line_id=buyer.line_id AND i.order_id=s.order_id JOIN LATERAL (SELECT f.*,row_number() OVER (ORDER BY unit_index) ordinal FROM app.fulfillment_item f WHERE f.order_item_id=i.id AND f.shipment_id=s.id) unit ON true WHERE s.order_id=o.id AND subsidy.line_id=buyer.line_id AND (unit.subsidy_amount<>subsidy.amount/subsidy.quantity+CASE WHEN unit.ordinal<=subsidy.amount%subsidy.quantity THEN 1 ELSE 0 END OR unit.buyer_shipping<>buyer.amount/buyer.quantity+CASE WHEN unit.ordinal<=buyer.amount%buyer.quantity THEN 1 ELSE 0 END))
 THEN RAISE EXCEPTION 'Original unit money follows exact line and unit remainders' USING ERRCODE='23514'; END IF;
 IF (o.owner_guest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.order_access WHERE order_id=o.id AND guest_id=o.owner_guest_id))
   OR (o.owner_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM app.order_access WHERE order_id=o.id))
 THEN RAISE EXCEPTION 'Order access matches its owner' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.purchase_signal_payload(selected uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('currency','IDR','contents',coalesce(jsonb_agg(jsonb_build_object('id',o.catalog_id,'quantity',i.quantity,'merchandise_amount',i.unit_price::bigint*i.quantity) ORDER BY i.id),'[]'::jsonb),'content_ids',coalesce(jsonb_agg(o.catalog_id ORDER BY i.id),'[]'::jsonb))
 FROM app.order_item i JOIN app.offer o ON o.id=i.offer_id WHERE i.order_id=selected;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.signal_operation_payload(selected uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE operation app.commerce_operation%ROWTYPE; previous jsonb; line jsonb; old_quantity integer; quantity integer; contents jsonb:='[]'::jsonb; ids jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO operation FROM app.commerce_operation WHERE id=selected;
 IF operation.action='order.create' THEN RETURN jsonb_build_object('currency','IDR','order_id',operation.resource_id,'contents',contents,'content_ids',ids); END IF;
 IF operation.action NOT IN ('cart.create','cart.line.add','cart.line.update','cart.line.remove') THEN RETURN NULL; END IF;
 SELECT result INTO previous FROM app.commerce_operation WHERE resource_id=operation.resource_id AND action IN ('cart.create','cart.line.add','cart.line.update','cart.line.remove') AND (result->>'version')::int=(operation.result->>'version')::int-1 ORDER BY created_at DESC LIMIT 1;
 FOR line IN SELECT value FROM jsonb_array_elements(operation.result->'lines') LOOP
  SELECT (value->>'quantity')::int INTO old_quantity FROM jsonb_array_elements(coalesce(previous->'lines','[]'::jsonb)) WHERE value->>'variant_id'=line->>'variant_id';
  quantity:=greatest(0,(line->>'quantity')::int-coalesce(old_quantity,0));
  IF quantity>0 THEN contents:=contents||jsonb_build_array(jsonb_build_object('id',line->>'catalog_id','quantity',quantity,'merchandise_amount',(line->>'unit_price')::bigint*quantity));ids:=ids||jsonb_build_array(line->>'catalog_id'); END IF;
 END LOOP;
 RETURN jsonb_build_object('currency','IDR','action',operation.action,'cart_id',operation.resource_id,'contents',contents,'content_ids',ids);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.purchase_receipt_payload(selected uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN receipt.kind='prepaid' THEN app.purchase_signal_payload(receipt.order_id) ELSE (
  SELECT jsonb_build_object('currency','IDR','contents',coalesce(jsonb_agg(jsonb_build_object('id',part.catalog_id,'quantity',part.quantity,'merchandise_amount',part.unit_price::bigint*part.quantity) ORDER BY part.id),'[]'::jsonb),'content_ids',coalesce(jsonb_agg(part.catalog_id ORDER BY part.id),'[]'::jsonb)) FROM (
   SELECT i.id,o.catalog_id,i.unit_price,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.offer o ON o.id=i.offer_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=receipt.order_id AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id)) GROUP BY i.id,o.catalog_id,i.unit_price
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
   SELECT jsonb_agg(jsonb_build_array(i.id,i.quantity,i.unit_price::bigint*i.quantity) ORDER BY i.id) INTO expected FROM app.order_item i WHERE i.order_id=event.order_id;
  ELSE
   SELECT jsonb_agg(jsonb_build_array(part.id,part.quantity,part.unit_price::bigint*part.quantity) ORDER BY part.id) INTO expected FROM (SELECT i.id,i.unit_price,count(*)::int quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE f.shipment_id=receipt.shipment_id AND i.order_id=event.order_id AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id)) GROUP BY i.id,i.unit_price) part;
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
