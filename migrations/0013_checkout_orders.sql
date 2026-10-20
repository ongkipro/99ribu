CREATE TABLE "app"."cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text,
	"owner_guest_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"transport" text NOT NULL,
	"cap_digest" text,
	"cap_issued_at" timestamp with time zone,
	"cap_expires_at" timestamp with time zone,
	"clock_namespace" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"active_quote_id" uuid,
	"submitted_order_id" uuid,
	CONSTRAINT "cart_owner_check" CHECK (("app"."cart"."owner_user_id" IS NULL) <> ("app"."cart"."owner_guest_id" IS NULL)),
	CONSTRAINT "cart_state_check" CHECK ("app"."cart"."revision">0 AND "app"."cart"."state" IN ('open','submitted') AND "app"."cart"."transport" IN ('browser','header') AND ("app"."cart"."owner_user_id" IS NULL OR "app"."cart"."transport"='browser') AND (("app"."cart"."state"='open' AND "app"."cart"."submitted_order_id" IS NULL) OR ("app"."cart"."state"='submitted' AND "app"."cart"."submitted_order_id" IS NOT NULL))),
	CONSTRAINT "cart_deadline_check" CHECK ("app"."cart"."expires_at">"app"."cart"."created_at" AND "app"."cart"."expires_at"<="app"."cart"."created_at"+interval '7 days'),
	CONSTRAINT "cart_capability_check" CHECK (("app"."cart"."owner_guest_id" IS NOT NULL AND "app"."cart"."cap_digest" IS NOT NULL AND "app"."cart"."cap_digest" ~ '^[0-9a-f]{64}$' AND "app"."cart"."cap_issued_at" IS NOT NULL AND "app"."cart"."cap_expires_at" IS NOT NULL AND "app"."cart"."cap_expires_at"="app"."cart"."cap_issued_at"+interval '7 days') OR ("app"."cart"."owner_user_id" IS NOT NULL AND "app"."cart"."cap_digest" IS NULL AND "app"."cart"."cap_issued_at" IS NULL AND "app"."cart"."cap_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."cart_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_revision" integer NOT NULL,
	"offer_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer DEFAULT 99000 NOT NULL,
	CONSTRAINT "cart_line_offer_unique" UNIQUE("cart_id","offer_id"),
	CONSTRAINT "cart_line_value_check" CHECK ("app"."cart_line"."quantity" between 1 and 50 AND "app"."cart_line"."unit_price"=99000)
);
--> statement-breakpoint
CREATE TABLE "app"."checkout_quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"cart_revision" integer NOT NULL,
	"parent_id" uuid,
	"operation_id" uuid NOT NULL,
	"document" jsonb NOT NULL,
	"payment_method" text NOT NULL,
	"merchandise_amount" bigint NOT NULL,
	"shipping_amount" bigint NOT NULL,
	"subsidy_amount" bigint NOT NULL,
	"buyer_total" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "checkout_quote_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "checkout_quote_value_check" CHECK ("app"."checkout_quote"."cart_revision">0 AND "app"."checkout_quote"."payment_method" IN ('prepaid','cod') AND "app"."checkout_quote"."merchandise_amount" between 99000 and 4950000 AND "app"."checkout_quote"."merchandise_amount"%99000=0 AND "app"."checkout_quote"."shipping_amount" between 0 and 9007199254740991 AND "app"."checkout_quote"."subsidy_amount" between 0 and "app"."checkout_quote"."shipping_amount" AND "app"."checkout_quote"."buyer_total"="app"."checkout_quote"."merchandise_amount"+"app"."checkout_quote"."shipping_amount"-"app"."checkout_quote"."subsidy_amount" AND "app"."checkout_quote"."buyer_total"<=9007199254740991),
	CONSTRAINT "checkout_quote_document_check" CHECK (jsonb_typeof("app"."checkout_quote"."document")='object' AND octet_length("app"."checkout_quote"."document"::text)<=1048576),
	CONSTRAINT "checkout_quote_deadline_check" CHECK ("app"."checkout_quote"."expires_at">"app"."checkout_quote"."created_at" AND "app"."checkout_quote"."expires_at"<="app"."checkout_quote"."created_at"+interval '10 minutes')
);
--> statement-breakpoint
CREATE TABLE "app"."commerce_guest_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "commerce_guest_context_digest_unique" UNIQUE("digest"),
	CONSTRAINT "commerce_guest_value_check" CHECK ("app"."commerce_guest_context"."digest" ~ '^[0-9a-f]{64}$' AND "app"."commerce_guest_context"."expires_at">"app"."commerce_guest_context"."created_at" AND "app"."commerce_guest_context"."expires_at"<="app"."commerce_guest_context"."created_at"+interval '7 days')
);
--> statement-breakpoint
CREATE TABLE "app"."commerce_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_scope" text NOT NULL,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_operation_key_unique" UNIQUE("actor_scope","key"),
	CONSTRAINT "commerce_operation_value_check" CHECK (char_length("app"."commerce_operation"."actor_scope") between 6 and 250 AND char_length("app"."commerce_operation"."key") between 1 and 200 AND "app"."commerce_operation"."request_hash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("app"."commerce_operation"."result")='object')
);
--> statement-breakpoint
CREATE TABLE "app"."commerce_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"cart_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"owner_user_id" text,
	"owner_guest_id" uuid,
	"stock_reservation_id" uuid NOT NULL,
	"promotion_reservation_id" uuid,
	"operation_id" uuid NOT NULL,
	"payment_method" text NOT NULL,
	"merchandise_amount" bigint NOT NULL,
	"shipping_amount" bigint NOT NULL,
	"subsidy_amount" bigint NOT NULL,
	"buyer_total" bigint NOT NULL,
	"buyer_note" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"clock_namespace" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commerce_order_number_unique" UNIQUE("number"),
	CONSTRAINT "commerce_order_cart_id_unique" UNIQUE("cart_id"),
	CONSTRAINT "commerce_order_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "commerce_order_stock_reservation_id_unique" UNIQUE("stock_reservation_id"),
	CONSTRAINT "commerce_order_promotion_reservation_id_unique" UNIQUE("promotion_reservation_id"),
	CONSTRAINT "commerce_order_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "commerce_order_owner_check" CHECK (("app"."commerce_order"."owner_user_id" IS NULL) <> ("app"."commerce_order"."owner_guest_id" IS NULL)),
	CONSTRAINT "commerce_order_value_check" CHECK ("app"."commerce_order"."number" ~ '^99-[A-Z0-9]{16}$' AND "app"."commerce_order"."payment_method" IN ('prepaid','cod') AND "app"."commerce_order"."merchandise_amount" between 99000 and 4950000 AND "app"."commerce_order"."shipping_amount" between 0 and 9007199254740991 AND "app"."commerce_order"."subsidy_amount" between 0 and "app"."commerce_order"."shipping_amount" AND "app"."commerce_order"."buyer_total"="app"."commerce_order"."merchandise_amount"+"app"."commerce_order"."shipping_amount"-"app"."commerce_order"."subsidy_amount" AND "app"."commerce_order"."buyer_total"<=9007199254740991 AND ("app"."commerce_order"."buyer_note" IS NULL OR char_length("app"."commerce_order"."buyer_note")<=500)),
	CONSTRAINT "commerce_order_state_check" CHECK (("app"."commerce_order"."status"='preparing' AND "app"."commerce_order"."revision"=0 AND "app"."commerce_order"."payment_status"='pending') OR ("app"."commerce_order"."status"='pending' AND "app"."commerce_order"."revision"=1 AND "app"."commerce_order"."payment_status"='pending') OR ("app"."commerce_order"."status"='cancelled' AND "app"."commerce_order"."revision"=2 AND "app"."commerce_order"."payment_status"='expired')),
	CONSTRAINT "commerce_order_deadline_check" CHECK ("app"."commerce_order"."expires_at"="app"."commerce_order"."created_at"+interval '30 minutes')
);
--> statement-breakpoint
CREATE TABLE "app"."fulfillment_component_allocation" (
	"fulfillment_item_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "fulfillment_component_allocation_fulfillment_item_id_balance_id_pk" PRIMARY KEY("fulfillment_item_id","balance_id"),
	CONSTRAINT "fulfillment_component_quantity_check" CHECK ("app"."fulfillment_component_allocation"."quantity" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "app"."fulfillment_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"unit_index" integer NOT NULL,
	"buyer_shipping" bigint NOT NULL,
	"subsidy_amount" bigint NOT NULL,
	CONSTRAINT "fulfillment_item_occurrence_unique" UNIQUE("order_item_id","unit_index"),
	CONSTRAINT "fulfillment_item_value_check" CHECK ("app"."fulfillment_item"."unit_index" between 1 and 50 AND "app"."fulfillment_item"."buyer_shipping" between 0 and 9007199254740991 AND "app"."fulfillment_item"."subsidy_amount" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."order_access" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"guest_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "order_access_digest_unique" UNIQUE("digest"),
	CONSTRAINT "order_access_value_check" CHECK ("app"."order_access"."digest" ~ '^[0-9a-f]{64}$' AND "app"."order_access"."expires_at"="app"."order_access"."issued_at"+interval '7 days')
);
--> statement-breakpoint
CREATE TABLE "app"."order_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"payment_status" text NOT NULL,
	"reason" text NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "order_event_revision_unique" UNIQUE("order_id","revision"),
	CONSTRAINT "order_event_value_check" CHECK (char_length("app"."order_event"."reason") between 1 and 500 AND (("app"."order_event"."revision"=1 AND "app"."order_event"."status"='pending' AND "app"."order_event"."payment_status"='pending') OR ("app"."order_event"."revision"=2 AND "app"."order_event"."status"='cancelled' AND "app"."order_event"."payment_status"='expired')))
);
--> statement-breakpoint
CREATE TABLE "app"."order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_revision" integer NOT NULL,
	"offer_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer DEFAULT 99000 NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "order_item_line_unique" UNIQUE("order_id","line_id"),
	CONSTRAINT "order_item_value_check" CHECK ("app"."order_item"."quantity" between 1 and 50 AND "app"."order_item"."unit_price"=99000 AND jsonb_typeof("app"."order_item"."snapshot")='object')
);
--> statement-breakpoint
CREATE TABLE "app"."order_shipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"parcel_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"merchandise_amount" bigint NOT NULL,
	"shipping_amount" bigint NOT NULL,
	"subsidy_amount" bigint NOT NULL,
	"buyer_shipping" bigint NOT NULL,
	"cod_due" bigint NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "order_shipment_parcel_unique" UNIQUE("order_id","parcel_id"),
	CONSTRAINT "order_shipment_value_check" CHECK ("app"."order_shipment"."merchandise_amount">0 AND "app"."order_shipment"."shipping_amount" between 0 and 9007199254740991 AND "app"."order_shipment"."subsidy_amount" between 0 and "app"."order_shipment"."shipping_amount" AND "app"."order_shipment"."buyer_shipping"="app"."order_shipment"."shipping_amount"-"app"."order_shipment"."subsidy_amount" AND "app"."order_shipment"."cod_due" between 0 and 9007199254740991 AND jsonb_typeof("app"."order_shipment"."snapshot")='object')
);
--> statement-breakpoint
ALTER TABLE "app"."cart" ADD CONSTRAINT "cart_owner_user_id_auth_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cart" ADD CONSTRAINT "cart_owner_guest_id_commerce_guest_context_id_fk" FOREIGN KEY ("owner_guest_id") REFERENCES "app"."commerce_guest_context"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cart" ADD CONSTRAINT "cart_clock_namespace_local_fixture_namespace_name_fk" FOREIGN KEY ("clock_namespace") REFERENCES "app"."local_fixture_namespace"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cart_line" ADD CONSTRAINT "cart_line_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "app"."cart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cart_line" ADD CONSTRAINT "cart_line_publication_fk" FOREIGN KEY ("publication_id","product_id","product_revision") REFERENCES "app"."publication_version"("id","product_id","product_revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cart_line" ADD CONSTRAINT "cart_line_offer_fk" FOREIGN KEY ("publication_id","offer_id") REFERENCES "app"."publication_offer"("publication_id","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD CONSTRAINT "checkout_quote_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "app"."cart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "app"."cart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_quote_id_checkout_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."checkout_quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_owner_user_id_auth_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_owner_guest_id_commerce_guest_context_id_fk" FOREIGN KEY ("owner_guest_id") REFERENCES "app"."commerce_guest_context"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_stock_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("stock_reservation_id") REFERENCES "app"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_promotion_reservation_id_promotion_reservation_id_fk" FOREIGN KEY ("promotion_reservation_id") REFERENCES "app"."promotion_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_clock_namespace_local_fixture_namespace_name_fk" FOREIGN KEY ("clock_namespace") REFERENCES "app"."local_fixture_namespace"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_component_allocation" ADD CONSTRAINT "fulfillment_component_allocation_fulfillment_item_id_fulfillment_item_id_fk" FOREIGN KEY ("fulfillment_item_id") REFERENCES "app"."fulfillment_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_component_allocation" ADD CONSTRAINT "fulfillment_component_allocation_balance_id_inventory_balance_id_fk" FOREIGN KEY ("balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_component_allocation" ADD CONSTRAINT "fulfillment_component_allocation_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_item" ADD CONSTRAINT "fulfillment_item_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "app"."order_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_item" ADD CONSTRAINT "fulfillment_item_shipment_id_order_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "app"."order_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_access" ADD CONSTRAINT "order_access_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_access" ADD CONSTRAINT "order_access_guest_id_commerce_guest_context_id_fk" FOREIGN KEY ("guest_id") REFERENCES "app"."commerce_guest_context"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_event" ADD CONSTRAINT "order_event_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_item" ADD CONSTRAINT "order_item_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_item" ADD CONSTRAINT "order_item_publication_fk" FOREIGN KEY ("publication_id","product_id","product_revision") REFERENCES "app"."publication_version"("id","product_id","product_revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_item" ADD CONSTRAINT "order_item_offer_fk" FOREIGN KEY ("publication_id","offer_id") REFERENCES "app"."publication_offer"("publication_id","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_shipment" ADD CONSTRAINT "order_shipment_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_shipment" ADD CONSTRAINT "order_shipment_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_user_idx" ON "app"."cart" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "cart_guest_idx" ON "app"."cart" USING btree ("owner_guest_id");--> statement-breakpoint
CREATE INDEX "checkout_quote_cart_idx" ON "app"."checkout_quote" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "commerce_order_expiry_idx" ON "app"."commerce_order" USING btree ("expires_at") WHERE "app"."commerce_order"."status"='pending';--> statement-breakpoint
-- Additive S20 guards. Applied predecessor migrations are unchanged.
CREATE FUNCTION app.commerce_plan_skeleton(plan jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT (plan-'shipping_total'-'packages') || jsonb_build_object('packages',(
   SELECT jsonb_agg(p-'selected_option_id'-'shipping_amount' ORDER BY p->>'id') FROM jsonb_array_elements(plan->'packages') p));
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_checkout_quote() RETURNS trigger LANGUAGE plpgsql AS $$
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
   OR (plan->>'source') IS DISTINCT FROM 'TEST-ONLY'
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
   IF chosen IS NULL OR chosen->>'source' IS DISTINCT FROM 'TEST-ONLY'
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
--> statement-breakpoint
CREATE TRIGGER checkout_quote_guard BEFORE INSERT ON app.checkout_quote FOR EACH ROW EXECUTE FUNCTION app.guard_checkout_quote();
--> statement-breakpoint
CREATE FUNCTION app.guard_commerce_cart() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cart history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.revision<>1 OR NEW.state<>'open' OR NEW.active_quote_id IS NOT NULL THEN RAISE EXCEPTION 'Cart begins open and empty' USING ERRCODE='23514'; END IF;
 ELSE
   IF (to_jsonb(NEW)-'revision'-'state'-'active_quote_id'-'submitted_order_id') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'state'-'active_quote_id'-'submitted_order_id')
     OR OLD.state<>'open' OR NEW.revision NOT IN (OLD.revision,OLD.revision+1)
     OR (NEW.revision=OLD.revision+1 AND NEW.active_quote_id IS NOT NULL)
   THEN RAISE EXCEPTION 'Cart ownership and submitted history cannot change' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.active_quote_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.checkout_quote WHERE id=NEW.active_quote_id AND cart_id=NEW.id AND cart_revision=NEW.revision)
 THEN RAISE EXCEPTION 'Active quote belongs to current cart revision' USING ERRCODE='23514'; END IF;
 IF NEW.submitted_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.commerce_order WHERE id=NEW.submitted_order_id AND cart_id=NEW.id AND quote_id=NEW.active_quote_id)
 THEN RAISE EXCEPTION 'Submitted order belongs to active cart quote' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER commerce_cart_guard BEFORE INSERT OR UPDATE OR DELETE ON app.cart FOR EACH ROW EXECUTE FUNCTION app.guard_commerce_cart();
--> statement-breakpoint
CREATE FUNCTION app.guard_commerce_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_cart app.cart%ROWTYPE; selected uuid;
BEGIN
 selected:=CASE WHEN TG_OP='DELETE' THEN OLD.cart_id ELSE NEW.cart_id END;
 SELECT * INTO current_cart FROM app.cart WHERE id=selected FOR UPDATE;
 IF current_cart.state IS DISTINCT FROM 'open' OR current_cart.expires_at<=app.reservation_clock(current_cart.clock_namespace)
   OR (TG_OP='UPDATE' AND (NEW.id,NEW.cart_id,NEW.offer_id,NEW.product_id) IS DISTINCT FROM (OLD.id,OLD.cart_id,OLD.offer_id,OLD.product_id))
 THEN RAISE EXCEPTION 'Only current open cart lines may change' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER commerce_line_guard BEFORE INSERT OR UPDATE OR DELETE ON app.cart_line FOR EACH ROW EXECUTE FUNCTION app.guard_commerce_line();
--> statement-breakpoint
CREATE FUNCTION app.guard_commerce_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q app.checkout_quote%ROWTYPE; c app.cart%ROWTYPE; event app.order_event%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Order history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
   SELECT * INTO q FROM app.checkout_quote WHERE id=NEW.quote_id;
   SELECT * INTO c FROM app.cart WHERE id=NEW.cart_id FOR UPDATE;
   IF NEW.status<>'preparing' OR NEW.revision<>0 OR q.cart_id IS DISTINCT FROM c.id OR c.state IS DISTINCT FROM 'open'
     OR c.active_quote_id IS DISTINCT FROM q.id OR c.revision IS DISTINCT FROM q.cart_revision
     OR (NEW.owner_user_id,NEW.owner_guest_id,NEW.clock_namespace) IS DISTINCT FROM (c.owner_user_id,c.owner_guest_id,c.clock_namespace)
     OR (NEW.payment_method,NEW.merchandise_amount,NEW.shipping_amount,NEW.subsidy_amount,NEW.buyer_total) IS DISTINCT FROM (q.payment_method,q.merchandise_amount,q.shipping_amount,q.subsidy_amount,q.buyer_total)
     OR q.expires_at<=app.reservation_clock(c.clock_namespace)
   THEN RAISE EXCEPTION 'Order requires current owned quote and frozen totals' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO event FROM app.order_event WHERE order_id=OLD.id AND revision=OLD.revision+1;
   IF (to_jsonb(NEW)-'revision'-'status'-'payment_status') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'status'-'payment_status')
     OR NEW.revision<>OLD.revision+1 OR (NEW.revision,NEW.status,NEW.payment_status) IS DISTINCT FROM (event.revision,event.status,event.payment_status)
   THEN RAISE EXCEPTION 'Order head advances with exact immutable event' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER commerce_order_guard BEFORE INSERT OR UPDATE OR DELETE ON app.commerce_order FOR EACH ROW EXECUTE FUNCTION app.guard_commerce_order();
--> statement-breakpoint
CREATE FUNCTION app.guard_order_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid; current_order app.commerce_order%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME IN ('order_item','order_shipment') THEN selected:=NEW.order_id;
 ELSIF TG_TABLE_NAME='fulfillment_item' THEN SELECT order_id INTO selected FROM app.order_item WHERE id=NEW.order_item_id;
 ELSE SELECT i.order_id INTO selected FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id WHERE f.id=NEW.fulfillment_item_id;
 END IF;
 SELECT * INTO current_order FROM app.commerce_order WHERE id=selected FOR UPDATE;
 IF current_order.status IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'Order parts seal before activation' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='fulfillment_item' THEN
   IF NOT EXISTS(SELECT 1 FROM app.order_shipment WHERE id=NEW.shipment_id AND order_id=selected) THEN RAISE EXCEPTION 'Fulfillment cannot cross orders' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
 IF NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
   OR (NEW.revision=1 AND (o.status<>'preparing' OR NEW.source_id<>o.operation_id))
   OR (NEW.revision=2 AND (o.status<>'pending' OR o.expires_at>app.reservation_clock(o.clock_namespace) OR NOT EXISTS(
     SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.source_id AND (
       (j.kind='checkout.order.expire' AND j.payload->>'orderId'=o.id::text)
       OR (j.kind='inventory.reservation.expire' AND j.payload->>'reservationId'=o.stock_reservation_id::text)
       OR (j.kind='promotion.reservation.expire' AND j.payload->>'reservationId'=o.promotion_reservation_id::text)))))
 THEN RAISE EXCEPTION 'Order event requires current transition and trusted cause' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_event_guard BEFORE INSERT ON app.order_event FOR EACH ROW EXECUTE FUNCTION app.guard_order_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_commerce_order() RETURNS trigger LANGUAGE plpgsql AS $$
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
     AND s.cod_due=CASE WHEN o.payment_method='cod' THEN s.merchandise_amount+s.buyer_shipping ELSE 0 END
     AND s.merchandise_amount=(SELECT count(*)*99000 FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND s.subsidy_amount=(SELECT sum(subsidy_amount) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND s.buyer_shipping=(SELECT sum(buyer_shipping) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parcel->'lines') l WHERE (l->>'quantity')::int<>(SELECT count(*) FROM app.fulfillment_item fi JOIN app.order_item i ON i.id=fi.order_item_id WHERE fi.shipment_id=s.id AND i.line_id=(l->>'line_id')::uuid)))
   THEN RAISE EXCEPTION 'Original shipment conserves quote, unit quantities and money' USING ERRCODE='23514'; END IF;
 END LOOP;
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
 IF actual IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM app.stock_reservation r WHERE r.id=o.stock_reservation_id AND r.kind='checkout' AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.expires_at=o.expires_at AND r.status=CASE WHEN o.status='pending' THEN 'active' ELSE 'expired' END)
 THEN RAISE EXCEPTION 'Physical lot partition conserves the exact order hold' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.stock_reservation_item r FULL JOIN (SELECT f.id::text line_id,i.product_id,i.product_revision,i.offer_id,s.warehouse_id,1 offer_quantity FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id JOIN app.order_shipment s ON s.id=f.shipment_id WHERE i.order_id=o.id) wanted ON wanted.line_id=r.line_id AND r.reservation_id=o.stock_reservation_id WHERE (r.reservation_id=o.stock_reservation_id OR r.reservation_id IS NULL) AND (r.product_id,r.product_revision,r.offer_id,r.warehouse_id,r.offer_quantity) IS DISTINCT FROM (wanted.product_id,wanted.product_revision,wanted.offer_id,wanted.warehouse_id,wanted.offer_quantity))
 THEN RAISE EXCEPTION 'Order stock hold preserves every purchased unit identity' USING ERRCODE='23514'; END IF;
 IF o.promotion_reservation_id IS NOT NULL AND (SELECT jsonb_agg(jsonb_build_object('promotion_id',a.promotion_id,'version_id',a.version_id,'amount',a.amount,'shipments',(SELECT jsonb_agg(jsonb_build_object('shipment_id',s.shipment_id,'amount',s.amount) ORDER BY s.shipment_id) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id)) ORDER BY a.promotion_id) FROM app.promotion_allocation a WHERE a.reservation_id=o.promotion_reservation_id) IS DISTINCT FROM (SELECT jsonb_agg(a ORDER BY a->>'promotion_id') FROM jsonb_array_elements(q.document->'promotions') a)
 THEN RAISE EXCEPTION 'Order preserves exact selected promotion versions and allocations' USING ERRCODE='23514'; END IF;
 IF (o.subsidy_amount=0 AND o.promotion_reservation_id IS NOT NULL) OR (o.subsidy_amount>0 AND NOT EXISTS(SELECT 1 FROM app.promotion_reservation r WHERE r.id=o.promotion_reservation_id AND r.subsidy_amount=o.subsidy_amount AND r.merchandise_amount=o.merchandise_amount AND r.shipping_amount=o.shipping_amount AND r.expires_at=o.expires_at AND r.clock_namespace IS NOT DISTINCT FROM o.clock_namespace AND r.status=CASE WHEN o.status='pending' THEN 'active' ELSE 'expired' END))
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
CREATE CONSTRAINT TRIGGER commerce_order_sealed AFTER INSERT OR UPDATE ON app.commerce_order DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_commerce_order();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER order_event_applied AFTER INSERT ON app.order_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_commerce_order();
--> statement-breakpoint
CREATE FUNCTION app.seal_checkout_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.commerce_operation op JOIN app.cart c ON c.id=NEW.cart_id WHERE op.id=NEW.operation_id AND op.action IN ('quote.create','quote.select') AND op.resource_id=NEW.id AND op.actor_scope=coalesce('user:'||c.owner_user_id,'guest:'||c.owner_guest_id::text))
 THEN RAISE EXCEPTION 'Quote and owned operation must commit together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER checkout_quote_sealed AFTER INSERT ON app.checkout_quote DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_checkout_quote();
--> statement-breakpoint
CREATE FUNCTION app.guard_commerce_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at>clock_timestamp()
 THEN RAISE EXCEPTION 'Commerce authority can only be revoked' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['checkout_quote','commerce_operation','order_item','order_shipment','fulfillment_item','fulfillment_component_allocation','order_event'] LOOP
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['order_item','order_shipment','fulfillment_item','fulfillment_component_allocation'] LOOP
   EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_order_part()',relation||'_guard',relation);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['commerce_guest_context','order_access'] LOOP
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_commerce_revocation()',relation||'_revocation',relation);
 END LOOP;
END;
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER checkout_stock_hold_sealed AFTER UPDATE ON app.stock_reservation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_commerce_order();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER checkout_promotion_hold_sealed AFTER UPDATE ON app.promotion_reservation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_commerce_order();
--> statement-breakpoint
CREATE FUNCTION app.guard_order_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.commerce_order WHERE id=NEW.order_id AND status='preparing' AND owner_guest_id=NEW.guest_id)
 THEN RAISE EXCEPTION 'Order capability seals with its guest-owned order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_access_guard BEFORE INSERT ON app.order_access FOR EACH ROW EXECUTE FUNCTION app.guard_order_access();

--> statement-breakpoint
CREATE FUNCTION app.commerce_parcel_line_money(parcel jsonb,allocated_amount bigint) RETURNS TABLE(line_id uuid,quantity int,amount bigint) LANGUAGE sql IMMUTABLE STRICT AS $$
 WITH lines AS (SELECT (l->>'line_id')::uuid line_id,(l->>'quantity')::int quantity FROM jsonb_array_elements(parcel->'lines') l),
 portions AS (SELECT line_id,quantity,($2::numeric*quantity/sum(quantity) OVER ())::numeric numerator,sum(quantity) OVER () total FROM lines),
 shares AS (SELECT line_id,quantity,floor(numerator)::bigint base,mod($2::numeric*quantity,total) remainder FROM portions),
 ranked AS (SELECT *,row_number() OVER (ORDER BY remainder DESC,line_id) rank,$2-sum(base) OVER () extra FROM shares)
 SELECT line_id,quantity,base+CASE WHEN rank<=extra THEN 1 ELSE 0 END FROM ranked;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_cart_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT coalesce(sum(quantity),0) FROM app.cart_line WHERE cart_id=coalesce(NEW.cart_id,OLD.cart_id))>50
 THEN RAISE EXCEPTION 'Cart supports at most fifty complete offer units' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cart_quantity_sealed AFTER INSERT OR UPDATE OR DELETE ON app.cart_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_cart_quantity();
