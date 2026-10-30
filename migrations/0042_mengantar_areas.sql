CREATE TABLE "app"."shipping_area" (
	"id" text PRIMARY KEY NOT NULL,
	"province" text NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"subdistrict" text NOT NULL,
	"postal_code" text NOT NULL,
	"dataset_version" text NOT NULL,
	CONSTRAINT "shipping_area_id_check" CHECK ("app"."shipping_area"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "shipping_area_postal_check" CHECK ("app"."shipping_area"."postal_code" = '' OR "app"."shipping_area"."postal_code" ~ '^[0-9]{5}$'),
	CONSTRAINT "shipping_area_names_check" CHECK (char_length("app"."shipping_area"."province") BETWEEN 1 AND 100 AND char_length("app"."shipping_area"."city") BETWEEN 1 AND 100 AND char_length("app"."shipping_area"."district") BETWEEN 1 AND 100 AND char_length("app"."shipping_area"."subdistrict") <= 100)
);
--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD COLUMN "provider_area_id" text;--> statement-breakpoint
CREATE INDEX "shipping_area_postal_idx" ON "app"."shipping_area" USING btree ("postal_code");--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD CONSTRAINT "warehouse_provider_area_id_shipping_area_id_fk" FOREIGN KEY ("provider_area_id") REFERENCES "app"."shipping_area"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- S95: a warehouse's Mengantar origin area belongs to its location. Changing province, city or district without
-- naming a new area clears it, so a moved warehouse is never quoted from its old kelurahan.
CREATE FUNCTION app.clear_warehouse_provider_area() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.province, NEW.city, NEW.district) IS DISTINCT FROM (OLD.province, OLD.city, OLD.district)
   AND NEW.provider_area_id IS NOT DISTINCT FROM OLD.provider_area_id THEN NEW.provider_area_id:=NULL; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER warehouse_provider_area_location BEFORE UPDATE OF province, city, district ON app.warehouse
 FOR EACH ROW EXECUTE FUNCTION app.clear_warehouse_provider_area();--> statement-breakpoint
-- S95: quotes may now carry live Mengantar rates. A plan is either all TEST-ONLY (local/test simulator) or all
-- mengantar: each chosen rate must have the plan's own source. Everything else in the guard is unchanged from 0013.
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
   OR NEW.merchandise_amount IS DISTINCT FROM (SELECT sum(quantity*99000) FROM app.cart_line WHERE cart_id=c.id)
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
     OR (parcel->>'merchandise_amount')::numeric IS DISTINCT FROM (SELECT sum((l->>'quantity')::numeric*99000) FROM jsonb_array_elements(parcel->'lines') l)
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
