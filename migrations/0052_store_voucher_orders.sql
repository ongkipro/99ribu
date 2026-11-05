-- S177 stage 2B: a quote's store-voucher share per unit, numbered per line across parcels in package order (TS twin:
-- merchandiseShares in src/modules/checkout/quotes.ts): floor(line amount / quantity) each, +1 to the first (amount mod quantity).
CREATE FUNCTION app.quote_unit_discounts(document jsonb)
RETURNS TABLE(parcel_id text,line_id text,unit_index int,amount bigint) LANGUAGE sql IMMUTABLE AS $$
 WITH line_amounts AS (
  SELECT l->>'line_id' line_id,sum((l->>'amount')::numeric) amount FROM jsonb_array_elements(coalesce(document->'promotions','[]'::jsonb)) a
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(a->'lines','[]'::jsonb)) l GROUP BY l->>'line_id'),
 quantities AS (SELECT l->>'line_id' line_id,(l->>'quantity')::int quantity FROM jsonb_array_elements(document->'selected_plan'->'lines') l),
 units AS (
  SELECT p.value->>'id' parcel_id,pl.value->>'line_id' line_id,
   row_number() OVER (PARTITION BY pl.value->>'line_id' ORDER BY p.ordinality,pl.ordinality,n)::int unit_index
  FROM jsonb_array_elements(document->'selected_plan'->'packages') WITH ORDINALITY p
  CROSS JOIN LATERAL jsonb_array_elements(p.value->'lines') WITH ORDINALITY pl
  CROSS JOIN LATERAL generate_series(1,(pl.value->>'quantity')::int) n)
 SELECT u.parcel_id,u.line_id,u.unit_index,
  (floor(coalesce(a.amount,0)/q.quantity)+CASE WHEN u.unit_index<=mod(coalesce(a.amount,0),q.quantity) THEN 1 ELSE 0 END)::bigint
 FROM units u JOIN quantities q ON q.line_id=u.line_id LEFT JOIN line_amounts a ON a.line_id=u.line_id
$$;
--> statement-breakpoint
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
    WHERE a->>'shipment_id'=parcel->>'id'),0)-coalesce((SELECT sum(d.amount) FROM app.quote_unit_discounts(NEW.document) d WHERE d.parcel_id=parcel->>'id'),0))*v_bps/10000)),0)
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
CREATE OR REPLACE FUNCTION app.guard_commerce_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q app.checkout_quote%ROWTYPE; c app.cart%ROWTYPE; event app.order_event%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Order history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
   SELECT * INTO q FROM app.checkout_quote WHERE id=NEW.quote_id;
   SELECT * INTO c FROM app.cart WHERE id=NEW.cart_id FOR UPDATE;
   IF NEW.status<>'preparing' OR NEW.revision<>0 OR q.cart_id IS DISTINCT FROM c.id OR c.state IS DISTINCT FROM 'open'
     OR c.active_quote_id IS DISTINCT FROM q.id OR c.revision IS DISTINCT FROM q.cart_revision
     OR (NEW.owner_user_id,NEW.owner_guest_id,NEW.clock_namespace) IS DISTINCT FROM (c.owner_user_id,c.owner_guest_id,c.clock_namespace)
     OR (NEW.payment_method,NEW.merchandise_amount,NEW.shipping_amount,NEW.subsidy_amount,NEW.buyer_total,NEW.merchandise_discount) IS DISTINCT FROM (q.payment_method,q.merchandise_amount,q.shipping_amount,q.subsidy_amount,q.buyer_total,q.merchandise_discount)
     OR q.expires_at<=app.reservation_clock(c.clock_namespace)
     -- S92 (DEC-008/009): the order freezes the quote's payment channel and COD fee;
     -- a manual-bank order freezes its unique code and current payment policy version.
     OR NEW.payment_channel IS DISTINCT FROM coalesce(q.payment_channel,CASE WHEN q.payment_method='cod' THEN 'cod' ELSE 'local-prepaid' END)
     OR (NEW.payment_method='cod' AND (NEW.payment_charge_amount,NEW.cod_fee_bps) IS DISTINCT FROM (q.payment_charge_amount,q.cod_fee_bps))
     OR (NEW.payment_channel='manual-bank' AND (NEW.payment_policy_version_id IS DISTINCT FROM app.current_payment_policy_version(app.reservation_clock(c.clock_namespace))
       OR jsonb_array_length(coalesce((SELECT v.values->'manual_bank_accounts' FROM app.policy_version v WHERE v.id=NEW.payment_policy_version_id),'[]'::jsonb))=0))
     OR (NEW.payment_channel<>'manual-bank' AND NEW.payment_policy_version_id IS NOT NULL)
   THEN RAISE EXCEPTION 'Order requires current owned quote and frozen totals' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO event FROM app.order_event WHERE order_id=OLD.id AND revision=OLD.revision+1;
   IF (to_jsonb(NEW)-'revision'-'status'-'payment_status'-'actionable_at') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'status'-'payment_status'-'actionable_at')
     OR (NEW.actionable_at IS DISTINCT FROM OLD.actionable_at AND NOT (OLD.actionable_at IS NULL AND ((NEW.payment_status='confirmed' AND EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.event_id=event.source_id AND r.outcome='confirmed' AND e.order_id=OLD.id AND e.occurred_at=NEW.actionable_at)) OR (OLD.payment_method='cod' AND NEW.payment_status='cod_due' AND EXISTS(SELECT 1 FROM app.cod_confirmation cod WHERE cod.id=event.source_id AND cod.order_id=OLD.id AND cod.accepted_at=NEW.actionable_at)))))
     OR NEW.revision<>OLD.revision+1 OR (NEW.revision,NEW.status,NEW.payment_status) IS DISTINCT FROM (event.revision,event.status,event.payment_status)
   THEN RAISE EXCEPTION 'Order head advances with exact immutable event' USING ERRCODE='23514'; END IF;
 END IF;
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
     AND s.cod_due=CASE WHEN o.payment_method='cod' THEN s.merchandise_amount-s.merchandise_discount+s.buyer_shipping+s.payment_charge ELSE 0 END
     AND s.merchandise_discount=(SELECT coalesce(sum(d.amount),0) FROM app.quote_unit_discounts(q.document) d WHERE d.parcel_id=parcel->>'id')
     AND s.merchandise_discount=(SELECT coalesce(sum(merchandise_discount),0) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND s.payment_charge=(SELECT sum(payment_charge) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND (o.payment_method<>'cod' OR s.payment_charge=ceil((s.merchandise_amount-s.merchandise_discount+s.buyer_shipping)::numeric*coalesce(o.cod_fee_bps,0)/10000))
     AND s.merchandise_amount=(SELECT coalesce(sum(i.unit_price),0) FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE fi.shipment_id=s.id)
     AND s.subsidy_amount=(SELECT sum(subsidy_amount) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND s.buyer_shipping=(SELECT sum(buyer_shipping) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parcel->'lines') l WHERE (l->>'quantity')::int<>(SELECT count(*) FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE fi.shipment_id=s.id AND i.line_id=(l->>'line_id')::uuid)))
   THEN RAISE EXCEPTION 'Original shipment conserves quote, unit quantities and money' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF o.payment_charge_amount IS DISTINCT FROM (SELECT coalesce(sum(payment_charge),0) FROM app.order_shipment WHERE order_id=o.id)
 THEN RAISE EXCEPTION 'Buyer-paid payment charge conserves every parcel and unit share' USING ERRCODE='23514'; END IF;
 -- S177 stage 2B: the store-voucher discount is frozen per unit by the quote's line split and unit numbering.
 IF o.merchandise_discount IS DISTINCT FROM q.merchandise_discount
   OR o.merchandise_discount IS DISTINCT FROM (SELECT coalesce(sum(merchandise_discount),0) FROM app.order_shipment WHERE order_id=o.id)
   OR EXISTS(SELECT 1 FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.order_shipment s ON s.id=f.shipment_id
     LEFT JOIN app.quote_unit_discounts(q.document) d ON d.line_id=i.line_id::text AND d.unit_index=f.unit_index
     WHERE i.order_id=o.id AND (d.amount IS NULL OR d.parcel_id IS DISTINCT FROM s.parcel_id OR f.merchandise_discount<>d.amount OR f.merchandise_discount>=i.unit_price))
 THEN RAISE EXCEPTION 'Store voucher discount follows the quote unit split' USING ERRCODE='23514'; END IF;
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
 IF o.promotion_reservation_id IS NOT NULL AND (SELECT jsonb_agg(jsonb_build_object('promotion_id',a.promotion_id,'version_id',a.version_id,'amount',a.amount,'shipments',coalesce((SELECT jsonb_agg(jsonb_build_object('shipment_id',s.shipment_id,'amount',s.amount) ORDER BY s.shipment_id) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id),'[]'::jsonb))
   ||CASE WHEN EXISTS(SELECT 1 FROM app.promotion_line_allocation l WHERE l.reservation_id=a.reservation_id AND l.promotion_id=a.promotion_id)
     THEN jsonb_build_object('lines',(SELECT jsonb_agg(jsonb_build_object('line_id',l.line_id,'amount',l.amount) ORDER BY l.line_id COLLATE "C") FROM app.promotion_line_allocation l WHERE l.reservation_id=a.reservation_id AND l.promotion_id=a.promotion_id)) ELSE '{}'::jsonb END ORDER BY a.promotion_id) FROM app.promotion_allocation a WHERE a.reservation_id=o.promotion_reservation_id) IS DISTINCT FROM (SELECT jsonb_agg(a ORDER BY a->>'promotion_id') FROM jsonb_array_elements(q.document->'promotions') a)
 THEN RAISE EXCEPTION 'Order preserves exact selected promotion versions and allocations' USING ERRCODE='23514'; END IF;
 IF (o.subsidy_amount=0 AND o.merchandise_discount=0 AND o.promotion_reservation_id IS NOT NULL) OR ((o.subsidy_amount>0 OR o.merchandise_discount>0) AND NOT EXISTS(SELECT 1 FROM app.promotion_reservation r WHERE r.id=o.promotion_reservation_id AND r.subsidy_amount=o.subsidy_amount AND r.discount_amount=o.merchandise_discount AND r.merchandise_amount=o.merchandise_amount AND r.shipping_amount=o.shipping_amount AND r.expires_at=o.expires_at AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.status=CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.fulfillment_item unit ON unit.id=cancellation.fulfillment_item_id JOIN app.order_item oi ON oi.id=unit.order_item_id WHERE oi.order_id=o.id AND cancellation.replacement_link_id IS NULL)
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
