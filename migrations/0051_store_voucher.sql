CREATE TABLE "app"."promotion_line_allocation" (
	"reservation_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "promotion_line_allocation_reservation_id_promotion_id_line_id_pk" PRIMARY KEY("reservation_id","promotion_id","line_id"),
	CONSTRAINT "promotion_line_allocation_value_check" CHECK ("app"."promotion_line_allocation"."amount" between 1 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" DROP CONSTRAINT "checkout_quote_value_check";--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_value_check";--> statement-breakpoint
ALTER TABLE "app"."fulfillment_item" DROP CONSTRAINT "fulfillment_item_value_check";--> statement-breakpoint
ALTER TABLE "app"."order_shipment" DROP CONSTRAINT "order_shipment_value_check";--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" DROP CONSTRAINT "promotion_reservation_amount_check";--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD COLUMN "merchandise_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "merchandise_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_item" ADD COLUMN "merchandise_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."order_shipment" ADD COLUMN "merchandise_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" ADD COLUMN "discount_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."promotion_version" ADD COLUMN "target" text DEFAULT 'shipping' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."promotion_line_allocation" ADD CONSTRAINT "promotion_line_parent_fk" FOREIGN KEY ("reservation_id","promotion_id") REFERENCES "app"."promotion_allocation"("reservation_id","promotion_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_line_allocation" ADD CONSTRAINT "promotion_line_item_fk" FOREIGN KEY ("reservation_id","line_id") REFERENCES "app"."promotion_reservation_item"("reservation_id","line_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD CONSTRAINT "checkout_quote_value_check" CHECK ("app"."checkout_quote"."cart_revision">0 AND "app"."checkout_quote"."payment_method" IN ('prepaid','cod') AND "app"."checkout_quote"."merchandise_amount" between 1 and 4950000 AND "app"."checkout_quote"."shipping_amount" between 0 and 9007199254740991 AND "app"."checkout_quote"."subsidy_amount" between 0 and "app"."checkout_quote"."shipping_amount" AND "app"."checkout_quote"."merchandise_discount">=0 AND "app"."checkout_quote"."merchandise_discount"<"app"."checkout_quote"."merchandise_amount" AND "app"."checkout_quote"."buyer_total"="app"."checkout_quote"."merchandise_amount"-"app"."checkout_quote"."merchandise_discount"+"app"."checkout_quote"."shipping_amount"-"app"."checkout_quote"."subsidy_amount" AND "app"."checkout_quote"."buyer_total"<=9007199254740991);--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_value_check" CHECK ("app"."commerce_order"."number" ~ '^99-[A-Z0-9]{16}$' AND "app"."commerce_order"."payment_method" IN ('prepaid','cod') AND "app"."commerce_order"."merchandise_amount" between 1 and 4950000 AND "app"."commerce_order"."shipping_amount" between 0 and 9007199254740991 AND "app"."commerce_order"."subsidy_amount" between 0 and "app"."commerce_order"."shipping_amount" AND "app"."commerce_order"."merchandise_discount">=0 AND "app"."commerce_order"."merchandise_discount"<"app"."commerce_order"."merchandise_amount" AND "app"."commerce_order"."buyer_total"="app"."commerce_order"."merchandise_amount"-"app"."commerce_order"."merchandise_discount"+"app"."commerce_order"."shipping_amount"-"app"."commerce_order"."subsidy_amount" AND "app"."commerce_order"."buyer_total"<=9007199254740991 AND ("app"."commerce_order"."buyer_note" IS NULL OR char_length("app"."commerce_order"."buyer_note")<=500));--> statement-breakpoint
ALTER TABLE "app"."fulfillment_item" ADD CONSTRAINT "fulfillment_item_value_check" CHECK ("app"."fulfillment_item"."unit_index" between 1 and 50 AND "app"."fulfillment_item"."buyer_shipping" between 0 and 9007199254740991 AND "app"."fulfillment_item"."subsidy_amount" between 0 and 9007199254740991 AND "app"."fulfillment_item"."merchandise_discount" between 0 and 98999);--> statement-breakpoint
ALTER TABLE "app"."order_shipment" ADD CONSTRAINT "order_shipment_value_check" CHECK ("app"."order_shipment"."merchandise_amount">0 AND "app"."order_shipment"."merchandise_discount">=0 AND "app"."order_shipment"."merchandise_discount"<"app"."order_shipment"."merchandise_amount" AND "app"."order_shipment"."shipping_amount" between 0 and 9007199254740991 AND "app"."order_shipment"."subsidy_amount" between 0 and "app"."order_shipment"."shipping_amount" AND "app"."order_shipment"."buyer_shipping"="app"."order_shipment"."shipping_amount"-"app"."order_shipment"."subsidy_amount" AND "app"."order_shipment"."cod_due" between 0 and 9007199254740991 AND jsonb_typeof("app"."order_shipment"."snapshot")='object');--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" ADD CONSTRAINT "promotion_reservation_amount_check" CHECK ("app"."promotion_reservation"."merchandise_amount" between 1 and 9007199254740991 AND "app"."promotion_reservation"."shipping_amount" between 1 and 9007199254740991 AND "app"."promotion_reservation"."subsidy_amount">=0 AND "app"."promotion_reservation"."subsidy_amount"<="app"."promotion_reservation"."shipping_amount" AND "app"."promotion_reservation"."discount_amount">=0 AND "app"."promotion_reservation"."discount_amount"<"app"."promotion_reservation"."merchandise_amount" AND "app"."promotion_reservation"."subsidy_amount"+"app"."promotion_reservation"."discount_amount">0);--> statement-breakpoint
ALTER TABLE "app"."promotion_version" ADD CONSTRAINT "promotion_version_target_check" CHECK ("app"."promotion_version"."target" IN ('shipping','merchandise'));--> statement-breakpoint
-- S177 stage 2B (docs/spec/vouchers/S177-stage-2b-design.md): line allocations are sealed with their reservation and immutable.
CREATE TRIGGER promotion_line_allocation_insert BEFORE INSERT ON app.promotion_line_allocation FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_part();
--> statement-breakpoint
CREATE TRIGGER promotion_line_allocation_immutable BEFORE UPDATE OR DELETE ON app.promotion_line_allocation FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
-- The shipping oracle (0012) ignores store-voucher rules; their benefit is checked by the merchandise oracle below.
CREATE OR REPLACE FUNCTION app.expected_promotion_allocations(selected uuid)
RETURNS TABLE(promotion_id uuid,shipment_id text,amount bigint) LANGUAGE plpgsql AS $$
DECLARE r app.promotion_reservation; rule record; allocation record; remaining jsonb; total numeric; benefit numeric;
BEGIN
  SELECT * INTO r FROM app.promotion_reservation WHERE id=selected;
  SELECT jsonb_object_agg(s.shipment_id,s.shipping_fee) INTO remaining FROM app.promotion_shipment s WHERE s.reservation_id=selected;
  FOR rule IN SELECT v.* FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id
    WHERE a.reservation_id=selected AND v.target='shipping' ORDER BY v.priority DESC,v.promotion_id LOOP
    IF NOT rule.active OR r.created_at<rule.starts_at OR r.created_at>=rule.ends_at OR NOT r.payment_method=ANY(rule.payment_methods)
      OR r.merchandise_amount<rule.minimum_merchandise THEN RAISE EXCEPTION 'Ineligible promotion snapshot' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum((remaining->>s.shipment_id)::numeric),0) INTO total FROM app.promotion_shipment s WHERE s.reservation_id=selected
      AND (cardinality(rule.service_ids)=0 OR s.service_id=ANY(rule.service_ids)) AND (cardinality(rule.region_ids)=0 OR s.region_ids&&rule.region_ids);
    benefit:=least(total,rule.maximum_per_order,CASE WHEN rule.kind='fixed' THEN rule.value ELSE floor((total*rule.value+5000)/10000) END);
    IF benefit<=0 THEN RAISE EXCEPTION 'Empty benefit is not reserved' USING ERRCODE='23514'; END IF;
    FOR allocation IN
      WITH weights AS (SELECT s.shipment_id,(remaining->>s.shipment_id)::numeric AS weight FROM app.promotion_shipment s
        WHERE s.reservation_id=selected AND (cardinality(rule.service_ids)=0 OR s.service_id=ANY(rule.service_ids))
        AND (cardinality(rule.region_ids)=0 OR s.region_ids&&rule.region_ids)),
      fractions AS (SELECT *,floor(benefit*weight/total) AS base,mod(benefit*weight,total) AS remainder FROM weights),
      ranked AS (SELECT fractions.*,row_number() OVER(ORDER BY fractions.remainder DESC,fractions.shipment_id COLLATE "C") AS rank,sum(fractions.base) OVER() AS allocated FROM fractions)
      SELECT ranked.shipment_id,(base+CASE WHEN rank<=benefit-allocated THEN 1 ELSE 0 END)::bigint AS portion FROM ranked
    LOOP
      remaining:=jsonb_set(remaining,ARRAY[allocation.shipment_id],to_jsonb((remaining->>allocation.shipment_id)::bigint-allocation.portion));
      IF allocation.portion>0 THEN promotion_id:=rule.promotion_id; shipment_id:=allocation.shipment_id; amount:=allocation.portion; RETURN NEXT; END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
-- Store-voucher oracle (TS twin: allocateMerchandise/merchandiseBenefit in src/modules/promotions/allocation.ts). Order-level
-- eligibility; benefit = least(fixed | round(gross × bps), maximum, Σ q × (price − 1)); lines by weight q × (price − 1),
-- largest remainder, ties by line_id in C order. Every unit keeps at least Rp1.
CREATE FUNCTION app.expected_merchandise_allocations(selected uuid)
RETURNS TABLE(promotion_id uuid,line_id text,amount bigint) LANGUAGE plpgsql AS $$
DECLARE r app.promotion_reservation; rule record; allocation record; capacity numeric; benefit numeric;
BEGIN
  SELECT * INTO r FROM app.promotion_reservation WHERE id=selected;
  SELECT coalesce(sum(i.quantity::numeric*(v.price-1)),0) INTO capacity FROM app.promotion_reservation_item i JOIN app.offer_revision v
    ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=selected;
  FOR rule IN SELECT v.* FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id
    WHERE a.reservation_id=selected AND v.target='merchandise' ORDER BY v.promotion_id LOOP
    IF NOT rule.active OR r.created_at<rule.starts_at OR r.created_at>=rule.ends_at OR NOT r.payment_method=ANY(rule.payment_methods)
      OR r.merchandise_amount<rule.minimum_merchandise
      OR EXISTS(SELECT 1 FROM app.promotion_shipment s WHERE s.reservation_id=selected AND ((cardinality(rule.service_ids)>0 AND NOT s.service_id=ANY(rule.service_ids))
        OR (cardinality(rule.region_ids)>0 AND NOT s.region_ids&&rule.region_ids)))
      OR NOT EXISTS(SELECT 1 FROM app.promotion p WHERE p.id=rule.promotion_id AND p.code IS NOT NULL)
      THEN RAISE EXCEPTION 'Ineligible store voucher snapshot' USING ERRCODE='23514'; END IF;
    benefit:=least(capacity,rule.maximum_per_order,CASE WHEN rule.kind='fixed' THEN rule.value ELSE floor((r.merchandise_amount*rule.value+5000)/10000) END);
    IF benefit<=0 THEN RAISE EXCEPTION 'Empty benefit is not reserved' USING ERRCODE='23514'; END IF;
    FOR allocation IN
      WITH weights AS (SELECT i.line_id,i.quantity::numeric*(v.price-1) AS weight FROM app.promotion_reservation_item i JOIN app.offer_revision v
        ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=selected),
      fractions AS (SELECT *,floor(benefit*weight/capacity) AS base,mod(benefit*weight,capacity) AS remainder FROM weights),
      ranked AS (SELECT fractions.*,row_number() OVER(ORDER BY fractions.remainder DESC,fractions.line_id COLLATE "C") AS rank,sum(fractions.base) OVER() AS allocated FROM fractions)
      SELECT ranked.line_id,(base+CASE WHEN rank<=benefit-allocated THEN 1 ELSE 0 END)::bigint AS portion FROM ranked
    LOOP
      IF allocation.portion>0 THEN promotion_id:=rule.promotion_id; line_id:=allocation.line_id; amount:=allocation.portion; RETURN NEXT; END IF;
    END LOOP;
  END LOOP;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_promotion_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE business_now timestamptz; expected numeric; n int;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reservation identity is permanent' USING ERRCODE='23514'; END IF;
  business_now:=app.reservation_clock(NEW.clock_namespace);
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'preparing' OR NEW.created_at>business_now OR NEW.created_at<business_now-interval '5 seconds' OR NEW.expires_at<=business_now THEN
      RAISE EXCEPTION 'Invalid new promotion reservation' USING ERRCODE='23514'; END IF; RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','resolved_at','resolution_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolved_at','resolution_reason']) THEN
    RAISE EXCEPTION 'Immutable reservation intent' USING ERRCODE='23514'; END IF;
  IF OLD.status='preparing' AND NEW.status='active' THEN
    IF NEW.expires_at<=business_now THEN RAISE EXCEPTION 'Reservation expired before activation' USING ERRCODE='23514'; END IF;
    SELECT sum(i.quantity::numeric*v.price) INTO expected FROM app.promotion_reservation_item i JOIN app.offer_revision v
      ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=NEW.id AND NOT v.retired;
    IF expected IS NULL OR expected<>NEW.merchandise_amount OR EXISTS(SELECT 1 FROM app.promotion_reservation_item i JOIN app.offer_revision v
      ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=NEW.id AND v.retired) THEN
      RAISE EXCEPTION 'Invalid fixed-offer merchandise snapshot' USING ERRCODE='23514'; END IF;
    SELECT sum(shipping_fee::numeric),count(*) INTO expected,n FROM app.promotion_shipment WHERE reservation_id=NEW.id;
    IF n=0 OR expected<>NEW.shipping_amount OR EXISTS(SELECT 1 FROM app.promotion_shipment s JOIN app.warehouse w ON w.id=s.origin_warehouse_id
      WHERE s.reservation_id=NEW.id AND (NOT w.active OR (NEW.clock_namespace IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.local_fixture_warehouse f
      WHERE f.namespace=NEW.clock_namespace AND f.warehouse_id=w.id)))) THEN RAISE EXCEPTION 'Invalid shipment snapshot' USING ERRCODE='23514'; END IF;
    -- S177 stage 2B: shipping allocations make the subsidy, at most one store voucher makes the discount; exclusivity is
    -- among shipping promotions only (a store voucher stacks with them, owner decision 11).
    SELECT count(*) INTO n FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id;
    IF n=0 OR (SELECT coalesce(sum(a.amount::numeric),0) FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id
        WHERE a.reservation_id=NEW.id AND v.target='shipping')<>NEW.subsidy_amount
      OR (SELECT coalesce(sum(a.amount::numeric),0) FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id
        WHERE a.reservation_id=NEW.id AND v.target='merchandise')<>NEW.discount_amount
      OR (SELECT count(*) FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id AND v.target='merchandise')>1 THEN
      RAISE EXCEPTION 'Invalid promotion allocation/effects' USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO n FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id AND v.target='shipping';
    IF EXISTS(SELECT 1 FROM app.promotion_allocation a JOIN app.promotion p ON p.id=a.promotion_id
      JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id AND (v.revision<>p.configuration_revision OR
      (n>1 AND v.target='shipping' AND v.stacking='exclusive') OR NOT EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=a.promotion_id AND m.kind='reserve' AND m.amount=a.amount))) THEN
      RAISE EXCEPTION 'Invalid promotion allocation/effects' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM ((SELECT * FROM app.expected_promotion_allocations(NEW.id) EXCEPT SELECT promotion_id,shipment_id,amount FROM app.promotion_shipment_allocation WHERE reservation_id=NEW.id)
      UNION ALL (SELECT promotion_id,shipment_id,amount FROM app.promotion_shipment_allocation WHERE reservation_id=NEW.id EXCEPT SELECT * FROM app.expected_promotion_allocations(NEW.id))) mismatch)
      OR EXISTS(SELECT 1 FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id AND v.target='shipping'
        AND a.amount<>(SELECT coalesce(sum(s.amount::numeric),0) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id)) THEN
      RAISE EXCEPTION 'Incorrect deterministic shipment allocation' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM ((SELECT * FROM app.expected_merchandise_allocations(NEW.id) EXCEPT SELECT promotion_id,line_id,amount FROM app.promotion_line_allocation WHERE reservation_id=NEW.id)
      UNION ALL (SELECT promotion_id,line_id,amount FROM app.promotion_line_allocation WHERE reservation_id=NEW.id EXCEPT SELECT * FROM app.expected_merchandise_allocations(NEW.id))) mismatch)
      OR EXISTS(SELECT 1 FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id AND v.target='merchandise'
        AND (a.amount<>(SELECT coalesce(sum(l.amount::numeric),0) FROM app.promotion_line_allocation l WHERE l.reservation_id=a.reservation_id AND l.promotion_id=a.promotion_id)
          OR EXISTS(SELECT 1 FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id))) THEN
      RAISE EXCEPTION 'Incorrect deterministic store voucher allocation' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='active' AND NEW.status IN ('released','expired','consumed') THEN
    IF NEW.resolved_at IS DISTINCT FROM business_now AND (NEW.resolved_at>business_now OR NEW.resolved_at<business_now-interval '5 seconds') THEN
      RAISE EXCEPTION 'Invalid resolution time' USING ERRCODE='23514'; END IF;
    IF (NEW.status='expired' AND NEW.expires_at>business_now)
      OR (NEW.status='consumed' AND NEW.expires_at<=business_now AND NOT EXISTS(SELECT 1 FROM app.commerce_order o JOIN app.order_shipment shipment ON shipment.order_id=o.id JOIN app.fulfillment fulfillment ON fulfillment.shipment_id=shipment.id WHERE o.promotion_reservation_id=NEW.id AND o.actionable_at IS NOT NULL AND fulfillment.handover_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM app.promotion_allocation allocation WHERE allocation.reservation_id=NEW.id AND (
       (SELECT coalesce(sum(m.reserved_delta::numeric),0) FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id)<>0
       OR (NEW.status<>'consumed' AND (SELECT coalesce(sum(m.committed_delta::numeric),0) FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id)<>0)
       OR NOT EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id AND m.kind='reserve' AND m.amount=allocation.amount)
       OR (NEW.status='consumed' AND EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id AND m.kind='release'))
       OR (NEW.status<>'consumed' AND EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=allocation.promotion_id AND m.kind IN ('consume','cancel_committed')))))
    THEN RAISE EXCEPTION 'Invalid terminal reservation or exact remaining budget effects' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
