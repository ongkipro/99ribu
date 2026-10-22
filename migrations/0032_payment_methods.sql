CREATE TABLE "app"."manual_bank_confirmation" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"bank_reference" text NOT NULL,
	"transferred_at" timestamp with time zone NOT NULL,
	"evidence" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "manual_bank_confirmation_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "manual_bank_confirmation_value_check" CHECK ("app"."manual_bank_confirmation"."amount" between 1 and 9007199254740991 AND "app"."manual_bank_confirmation"."bank_reference" ~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{2,79}$' AND char_length("app"."manual_bank_confirmation"."evidence") between 1 and 500 AND char_length("app"."manual_bank_confirmation"."reason") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_deadline_check";--> statement-breakpoint
ALTER TABLE "app"."economic_receipt" DROP CONSTRAINT "economic_receipt_money_check";--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" DROP CONSTRAINT "payment_attempt_identity_check";--> statement-breakpoint
ALTER TABLE "app"."policy_head" DROP CONSTRAINT "policy_scope_check";--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" DROP CONSTRAINT "promotion_reservation_deadline_check";--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" DROP CONSTRAINT "recovery_allocation_value_check";--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" DROP CONSTRAINT "refund_allocation_value_check";--> statement-breakpoint
ALTER TABLE "app"."return_item" DROP CONSTRAINT "return_item_value_check";--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD COLUMN "payment_channel" text;--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD COLUMN "payment_charge_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD COLUMN "cod_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "payment_channel" text;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "payment_charge_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "cod_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "transfer_code" integer;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD COLUMN "payment_policy_version_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."economic_receipt" ADD COLUMN "payment_charge" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."fulfillment_item" ADD COLUMN "payment_charge" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."order_shipment" ADD COLUMN "payment_charge" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD COLUMN "payment_charge" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" ADD COLUMN "payment_charge" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD COLUMN "payment_charge" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."manual_bank_confirmation" ADD CONSTRAINT "manual_bank_confirmation_attempt_id_payment_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."payment_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."manual_bank_confirmation" ADD CONSTRAINT "manual_bank_confirmation_operation_id_local_payment_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."local_payment_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_payment_policy_version_id_policy_version_id_fk" FOREIGN KEY ("payment_policy_version_id") REFERENCES "app"."policy_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_order_open_transfer_code_unique" ON "app"."commerce_order" USING btree ("transfer_code") WHERE "app"."commerce_order"."payment_channel"='manual-bank' AND "app"."commerce_order"."status"='pending' AND "app"."commerce_order"."payment_status"='pending';--> statement-breakpoint
ALTER TABLE "app"."checkout_quote" ADD CONSTRAINT "checkout_quote_payment_check" CHECK (("app"."checkout_quote"."payment_channel" IS NULL OR ("app"."checkout_quote"."payment_method"='cod' AND "app"."checkout_quote"."payment_channel"='cod') OR ("app"."checkout_quote"."payment_method"='prepaid' AND "app"."checkout_quote"."payment_channel" IN ('local-prepaid','manual-bank'))) AND "app"."checkout_quote"."payment_charge_amount" between 0 and 9007199254740991 AND ("app"."checkout_quote"."cod_fee_bps" IS NULL OR "app"."checkout_quote"."cod_fee_bps" between 0 and 2000) AND ("app"."checkout_quote"."payment_method"='cod' OR ("app"."checkout_quote"."payment_charge_amount"=0 AND "app"."checkout_quote"."cod_fee_bps" IS NULL)));--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_payment_check" CHECK (("app"."commerce_order"."payment_channel" IS NULL OR ("app"."commerce_order"."payment_method"='cod' AND "app"."commerce_order"."payment_channel"='cod') OR ("app"."commerce_order"."payment_method"='prepaid' AND "app"."commerce_order"."payment_channel" IN ('local-prepaid','manual-bank'))) AND "app"."commerce_order"."payment_charge_amount" between 0 and 9007199254740991 AND ("app"."commerce_order"."cod_fee_bps" IS NULL OR "app"."commerce_order"."cod_fee_bps" between 0 and 2000) AND (("app"."commerce_order"."payment_channel"='manual-bank')=("app"."commerce_order"."transfer_code" IS NOT NULL)) AND ("app"."commerce_order"."transfer_code" IS NULL OR ("app"."commerce_order"."transfer_code" between 1 and 999 AND "app"."commerce_order"."payment_charge_amount"="app"."commerce_order"."transfer_code" AND "app"."commerce_order"."payment_policy_version_id" IS NOT NULL)) AND ("app"."commerce_order"."payment_method"='cod' OR "app"."commerce_order"."payment_channel"='manual-bank' OR ("app"."commerce_order"."payment_charge_amount"=0 AND "app"."commerce_order"."cod_fee_bps" IS NULL)));--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_deadline_check" CHECK ("app"."commerce_order"."expires_at"="app"."commerce_order"."created_at"+interval '30 minutes' OR ("app"."commerce_order"."payment_channel"='manual-bank' AND "app"."commerce_order"."expires_at"="app"."commerce_order"."created_at"+interval '24 hours'));--> statement-breakpoint
ALTER TABLE "app"."economic_receipt" ADD CONSTRAINT "economic_receipt_money_check" CHECK ("app"."economic_receipt"."amount" between 1 and 9007199254740991 AND "app"."economic_receipt"."merchandise_amount" between 1 and 9007199254740991 AND "app"."economic_receipt"."buyer_shipping" between 0 and 9007199254740991 AND "app"."economic_receipt"."payment_charge" between 0 and 9007199254740991 AND "app"."economic_receipt"."amount"::numeric="app"."economic_receipt"."merchandise_amount"::numeric+"app"."economic_receipt"."buyer_shipping"::numeric+"app"."economic_receipt"."payment_charge"::numeric);--> statement-breakpoint
ALTER TABLE "app"."fulfillment_item" ADD CONSTRAINT "fulfillment_item_payment_charge_check" CHECK ("app"."fulfillment_item"."payment_charge" between 0 and 9007199254740991);--> statement-breakpoint
ALTER TABLE "app"."order_shipment" ADD CONSTRAINT "order_shipment_payment_charge_check" CHECK ("app"."order_shipment"."payment_charge" between 0 and 9007199254740991);--> statement-breakpoint
ALTER TABLE "app"."payment_attempt" ADD CONSTRAINT "payment_attempt_identity_check" CHECK ("app"."payment_attempt"."method_id" IN ('local-prepaid','manual-bank') AND "app"."payment_attempt"."key" ~ '^[A-Za-z0-9_-]{16,200}$' AND "app"."payment_attempt"."request_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "app"."policy_head" ADD CONSTRAINT "policy_scope_check" CHECK (("app"."policy_head"."kind" IN ('commercial','payment') AND "app"."policy_head"."warehouse_id" IS NULL) OR ("app"."policy_head"."kind" = 'warehouse_calendar' AND "app"."policy_head"."warehouse_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" ADD CONSTRAINT "promotion_reservation_deadline_check" CHECK ("app"."promotion_reservation"."expires_at">"app"."promotion_reservation"."created_at" AND "app"."promotion_reservation"."expires_at"<="app"."promotion_reservation"."created_at"+interval '24 hours');--> statement-breakpoint
ALTER TABLE "app"."recovery_refund_allocation" ADD CONSTRAINT "recovery_allocation_value_check" CHECK ("app"."recovery_refund_allocation"."amount" between 1 and 9007199254740991 AND (("app"."recovery_refund_allocation"."exception_unit_id" IS NOT NULL AND "app"."recovery_refund_allocation"."fulfillment_item_id" IS NOT NULL AND "app"."recovery_refund_allocation"."receipt_id" IS NOT NULL AND "app"."recovery_refund_allocation"."merchandise_amount"=99000 AND "app"."recovery_refund_allocation"."buyer_shipping">=0 AND "app"."recovery_refund_allocation"."payment_charge">=0 AND "app"."recovery_refund_allocation"."amount"::numeric="app"."recovery_refund_allocation"."merchandise_amount"::numeric+"app"."recovery_refund_allocation"."buyer_shipping"::numeric+"app"."recovery_refund_allocation"."payment_charge"::numeric) OR ("app"."recovery_refund_allocation"."exception_unit_id" IS NULL AND "app"."recovery_refund_allocation"."fulfillment_item_id" IS NULL AND "app"."recovery_refund_allocation"."receipt_id" IS NULL AND "app"."recovery_refund_allocation"."purchase_event_id" IS NULL AND "app"."recovery_refund_allocation"."merchandise_amount"=0 AND "app"."recovery_refund_allocation"."buyer_shipping"=0 AND "app"."recovery_refund_allocation"."payment_charge"=0)));--> statement-breakpoint
ALTER TABLE "app"."refund_allocation" ADD CONSTRAINT "refund_allocation_value_check" CHECK ("app"."refund_allocation"."merchandise_amount"=99000 AND "app"."refund_allocation"."buyer_shipping">=0 AND "app"."refund_allocation"."payment_charge">=0 AND "app"."refund_allocation"."amount" between 99000 and 9007199254740991 AND "app"."refund_allocation"."amount"::numeric="app"."refund_allocation"."merchandise_amount"::numeric+"app"."refund_allocation"."buyer_shipping"::numeric+"app"."refund_allocation"."payment_charge"::numeric);--> statement-breakpoint
ALTER TABLE "app"."return_item" ADD CONSTRAINT "return_item_value_check" CHECK ("app"."return_item"."reason" IN ('wrong_item','damaged','defective','not_as_described','incomplete','expired','broken_mandatory_seal') AND char_length("app"."return_item"."details")<=2000 AND "app"."return_item"."merchandise_amount"=99000 AND "app"."return_item"."buyer_shipping" between 0 and 9007199254641991 AND "app"."return_item"."payment_charge" between 0 and 9007199254740991 AND "app"."return_item"."claim_state" IN ('held','released','refunded','replacing','replaced') AND "app"."return_item"."inspection_status" IN ('pending','accepted','rejected','needs_review','waived'));--> statement-breakpoint
-- S92 (DEC-008/009): the company payment policy version (DEC-008/009, separate from commercial so publications stay valid) in force at a business instant.
CREATE FUNCTION app.current_payment_policy_version(p_at timestamptz) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT v.id FROM app.policy_version v JOIN app.policy_head h ON h.id=v.head_id
 WHERE h.kind='payment' AND h.warehouse_id IS NULL AND v.effective_at<=p_at ORDER BY v.effective_at DESC,v.revision DESC LIMIT 1;
$$;
--> statement-breakpoint
-- A quote freezes its payment channel and the buyer COD fee rate in force:
-- per parcel ceil((merchandise + buyer shipping) x bps / 10000), whole rupiah.
CREATE FUNCTION app.guard_checkout_quote_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.cart; v_parent app.checkout_quote; v_values jsonb; v_bps integer; v_expected numeric;
BEGIN
 SELECT * INTO c FROM app.cart WHERE id=NEW.cart_id;
 SELECT v.values INTO v_values FROM app.policy_version v WHERE v.id=app.current_payment_policy_version(NEW.created_at);
 v_bps:=coalesce((v_values->>'cod_fee_bps')::integer,0);
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
CREATE TRIGGER checkout_quote_payment_guard BEFORE INSERT ON app.checkout_quote FOR EACH ROW EXECUTE FUNCTION app.guard_checkout_quote_payment();
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
     OR (NEW.payment_method,NEW.merchandise_amount,NEW.shipping_amount,NEW.subsidy_amount,NEW.buyer_total) IS DISTINCT FROM (q.payment_method,q.merchandise_amount,q.shipping_amount,q.subsidy_amount,q.buyer_total)
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
     AND s.cod_due=CASE WHEN o.payment_method='cod' THEN s.merchandise_amount+s.buyer_shipping+s.payment_charge ELSE 0 END
     AND s.payment_charge=(SELECT sum(payment_charge) FROM app.fulfillment_item WHERE shipment_id=s.id)
     AND (o.payment_method<>'cod' OR s.payment_charge=ceil((s.merchandise_amount+s.buyer_shipping)::numeric*coalesce(o.cod_fee_bps,0)/10000))
     AND s.merchandise_amount=(SELECT count(*)*99000 FROM app.fulfillment_item WHERE shipment_id=s.id)
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
CREATE OR REPLACE FUNCTION app.guard_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; paid bigint; parcels bigint; v_exception_event app.exception_event; v_receipt app.local_parcel_receipt;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id FOR UPDATE;
 SELECT event.* INTO v_exception_event FROM app.exception_event event JOIN app.commerce_exception c ON c.id=event.exception_id
  JOIN app.exception_operation operation ON operation.id=event.source_id
  WHERE event.id=NEW.source_id AND c.order_id=o.id AND event.kind='cancel' AND event.source_kind='operation'
   AND operation.action='apply' AND operation.created_xid=pg_current_xact_id()::text AND operation.response='{}'::jsonb;
 IF v_exception_event.id IS NOT NULL THEN
  IF o.actionable_at IS NULL OR NEW.revision<>o.revision+1 OR NEW.created_at IS DISTINCT FROM v_exception_event.occurred_at
     OR NEW.status IS DISTINCT FROM app.original_order_status(o.id)
     OR NEW.payment_status IS DISTINCT FROM (CASE WHEN o.payment_method='cod' THEN app.cod_collection_payment_status(o.id) ELSE o.payment_status END)
     OR NOT EXISTS(SELECT 1 FROM app.exception_cancellation WHERE event_id=v_exception_event.id AND replacement_link_id IS NULL)
     OR EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND source_id=NEW.source_id)
  THEN RAISE EXCEPTION 'Applied original retirement advances one exact current parent without rewriting money or physical history' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT source.* INTO v_receipt FROM app.local_parcel_receipt source JOIN app.parcel_receipt_result result ON result.event_id=source.id
  JOIN app.order_shipment shipment ON shipment.id=source.shipment_id WHERE source.id=NEW.source_id AND shipment.order_id=o.id AND result.outcome='received' AND result.receipt_count>0;
 IF NEW.status='partially_completed' AND v_receipt.id IS NOT NULL THEN
  IF o.actionable_at IS NULL OR o.status NOT IN ('pending','processing') OR NEW.revision<>o.revision+1
     OR NEW.payment_status IS DISTINCT FROM o.payment_status OR NEW.created_at IS DISTINCT FROM v_receipt.occurred_at
     OR app.original_order_status(o.id)<>'partially_completed' OR EXISTS(SELECT 1 FROM app.order_event WHERE order_id=o.id AND source_id=NEW.source_id)
  THEN RAISE EXCEPTION 'Partial completion requires the exact final surviving original buyer receipt and completed callback proof' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;

 IF NEW.status='processing' AND NEW.payment_status=o.payment_status AND o.status='pending' THEN
  IF o.actionable_at IS NULL OR NEW.revision<>o.revision+1 OR NOT EXISTS(SELECT 1 FROM app.fulfillment_event event JOIN app.fulfillment f ON f.id=event.fulfillment_id JOIN app.order_shipment shipment ON shipment.id=f.shipment_id WHERE event.id=NEW.source_id AND event.kind='prepare' AND shipment.order_id=o.id AND event.occurred_at=NEW.created_at) THEN RAISE EXCEPTION 'Processing requires actual original parcel preparation' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF o.payment_method='cod' AND NEW.revision>=2 AND NEW.payment_status IN ('cod_due','partially_collected','confirmed') THEN
  IF NEW.status<>o.status OR NEW.status NOT IN ('pending','processing','partially_completed') OR NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
   THEN RAISE EXCEPTION 'COD event advances the current original order' USING ERRCODE='23514';END IF;
  IF NEW.revision=2 THEN
   IF NEW.payment_status<>'cod_due' OR o.status<>'pending' OR o.payment_status<>'pending' OR NOT EXISTS(SELECT 1 FROM app.cod_confirmation c WHERE c.id=NEW.source_id AND c.order_id=o.id AND c.accepted_at=NEW.created_at)
   THEN RAISE EXCEPTION 'COD confirmation event requires its exact original source' USING ERRCODE='23514';END IF;
  ELSE
   SELECT count(*) INTO paid FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.outcome='collected' AND e.order_id=o.id;
   SELECT count(*) INTO parcels FROM app.order_shipment WHERE order_id=o.id;
   IF o.status NOT IN ('pending','processing','partially_completed') OR o.payment_status NOT IN ('cod_due','partially_collected') OR o.actionable_at IS NULL
    OR NEW.payment_status IS DISTINCT FROM app.cod_collection_payment_status(o.id)
    OR NOT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.economic_receipt e ON e.id=r.receipt_id WHERE r.event_id=NEW.source_id AND r.outcome='collected' AND e.kind='cod' AND e.order_id=o.id AND e.occurred_at=NEW.created_at)
   THEN RAISE EXCEPTION 'COD collection event requires original qualified parcel money' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.revision>2 OR NEW.revision<>o.revision+1 OR NEW.created_at>app.reservation_clock(o.clock_namespace)
   OR (NEW.revision=1 AND (o.status<>'preparing' OR NEW.source_id<>o.operation_id))
   OR (NEW.revision=2 AND NEW.payment_status='expired' AND (o.status<>'pending' OR o.payment_status<>'pending' OR o.expires_at>app.reservation_clock(o.clock_namespace)
     OR EXISTS(SELECT 1 FROM app.payment_attempt a JOIN app.outbox_job j ON j.id=a.creation_job_id WHERE a.order_id=o.id AND a.status IN ('pending','unknown') AND j.status IN ('processing','unknown') AND NOT EXISTS(SELECT 1 FROM app.local_payment_operation p JOIN app.local_payment_event e ON e.operation_id=p.id WHERE p.attempt_id=a.id AND p.status IN ('confirmed','failed','expired') AND e.status=p.status))
     OR EXISTS(SELECT 1 FROM app.payment_attempt a JOIN app.local_payment_operation p ON p.attempt_id=a.id JOIN app.local_payment_event e ON e.operation_id=p.id WHERE a.order_id=o.id AND a.status IN ('pending','unknown') AND e.status='confirmed' AND e.amount=o.buyer_total+o.payment_charge_amount AND e.occurred_at<o.expires_at AND NOT EXISTS(SELECT 1 FROM app.payment_event_result WHERE event_id=e.id))
     OR NOT EXISTS(
     SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.source_id AND (
       (j.kind='checkout.order.expire' AND j.payload->>'orderId'=o.id::text)
       OR (j.kind='inventory.reservation.expire' AND j.payload->>'reservationId'=o.stock_reservation_id::text)
       OR (j.kind='promotion.reservation.expire' AND j.payload->>'reservationId'=o.promotion_reservation_id::text)))))
   OR (NEW.revision=2 AND NEW.payment_status='confirmed' AND (o.status<>'pending' OR o.payment_status<>'pending' OR o.payment_method<>'prepaid' OR NOT EXISTS(
     SELECT 1 FROM app.payment_event_result r JOIN app.payment_provider_event v ON v.id=r.event_id
       JOIN app.local_payment_event e ON e.id=v.id JOIN app.payment_attempt a ON a.id=v.attempt_id
       JOIN app.economic_receipt receipt ON receipt.id=r.receipt_id JOIN app.stock_reservation hold ON hold.id=o.stock_reservation_id
     WHERE r.event_id=NEW.source_id AND r.outcome='confirmed' AND a.order_id=o.id AND receipt.order_id=o.id
       AND receipt.amount=o.buyer_total+o.payment_charge_amount AND receipt.effect_reference=e.operation_id::text AND receipt.occurred_at=NEW.created_at
       AND e.status='confirmed' AND e.occurred_at<o.expires_at AND e.occurred_at>=a.created_at AND hold.status='active')))
 THEN RAISE EXCEPTION 'Order event requires current transition and trusted cause' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; event app.payment_attempt_event%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id;
  IF NEW.revision<>0 OR NEW.status<>'preparing' OR NEW.provider_operation_id IS NOT NULL OR NEW.receipt_id IS NOT NULL
    OR o.status IS DISTINCT FROM 'pending' OR o.payment_status IS DISTINCT FROM 'pending' OR o.payment_method IS DISTINCT FROM 'prepaid'
    OR NEW.expected_amount IS DISTINCT FROM o.buyer_total+o.payment_charge_amount OR NEW.expires_at IS DISTINCT FROM o.expires_at
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
CREATE OR REPLACE FUNCTION app.guard_finance_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h app.finance_transaction; o app.commerce_order; s app.order_shipment; v_operation app.local_cod_operation; v_basis jsonb;
BEGIN
 SELECT * INTO h FROM app.finance_transaction WHERE id=NEW.transaction_id;
 IF h.id IS NULL THEN RAISE EXCEPTION 'Journal parent is required' USING ERRCODE='23503'; END IF;
 IF h.created_xid<>pg_current_xact_id()::text THEN RAISE EXCEPTION 'Historical journal is sealed' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='economic_receipt' THEN
  IF h.kind<>'economic_receipt' OR (h.order_id,h.source,h.environment,h.effect_reference,h.occurred_at) IS DISTINCT FROM (NEW.order_id,NEW.source,NEW.environment,NEW.effect_reference,NEW.occurred_at)
  THEN RAISE EXCEPTION 'Economic receipt and journal share one identity' USING ERRCODE='23514'; END IF;
  SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id;
  IF o.id IS NULL OR o.payment_method<>NEW.kind THEN RAISE EXCEPTION 'Receipt requires its purchased payment method' USING ERRCODE='23514'; END IF;
  IF NEW.kind='prepaid' THEN
   IF (NEW.amount,NEW.merchandise_amount,NEW.buyer_shipping,NEW.payment_charge) IS DISTINCT FROM (o.buyer_total+o.payment_charge_amount,o.merchandise_amount,o.shipping_amount-o.subsidy_amount,o.payment_charge_amount)
   THEN RAISE EXCEPTION 'Prepaid receipt equals frozen buyer total' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO s FROM app.order_shipment WHERE id=NEW.shipment_id AND order_id=NEW.order_id;
   SELECT * INTO v_operation FROM app.local_cod_operation WHERE id::text=NEW.effect_reference AND shipment_id=s.id AND environment=NEW.environment;
   IF s.id IS NULL OR v_operation.id IS NULL OR v_operation.status<>'collected'
   THEN RAISE EXCEPTION 'COD receipt retains its actual original collection operation' USING ERRCODE='23514'; END IF;
   v_basis:=app.cod_operation_collection_basis(v_operation.id);
   IF (NEW.amount,NEW.merchandise_amount,NEW.buyer_shipping,NEW.payment_charge) IS DISTINCT FROM
      ((v_basis->>'amount')::bigint,(v_basis->>'merchandise_amount')::bigint,(v_basis->>'buyer_shipping')::bigint,(v_basis->>'payment_charge')::bigint)
   THEN RAISE EXCEPTION 'COD receipt equals its exact frozen original source unit entitlement' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.recorded_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.cod_current_collection_basis(p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_charge numeric; v_parcel app.order_shipment; v_order app.commerce_order; v_units jsonb; v_merchandise numeric; v_shipping numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Current COD entitlement requires fresh original-order locking' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_parcel FROM app.order_shipment WHERE id=p_shipment_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_parcel.order_id FOR UPDATE;
 IF v_parcel.id IS NULL OR v_order.payment_method IS DISTINCT FROM 'cod'
 THEN RAISE EXCEPTION 'COD basis belongs to its original COD parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric),0),coalesce(sum(f.buyer_shipping::numeric),0),coalesce(sum(f.payment_charge::numeric),0)
  INTO v_units,v_merchandise,v_shipping,v_charge FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=v_parcel.id AND i.order_id=v_order.id AND NOT EXISTS(
   SELECT 1 FROM app.exception_cancellation cancelled WHERE cancelled.fulfillment_item_id=f.id AND cancelled.replacement_link_id IS NULL);
 IF jsonb_array_length(v_units)>100 OR v_merchandise+v_shipping+v_charge>9007199254740991
 THEN RAISE EXCEPTION 'COD basis retains bounded original unit money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'merchandise_amount',v_merchandise,'buyer_shipping',v_shipping,'payment_charge',v_charge,'amount',v_merchandise+v_shipping+v_charge);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.cod_operation_collection_basis(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_charge numeric; v_operation app.local_cod_operation; v_order app.commerce_order; v_units jsonb; v_merchandise numeric; v_shipping numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Original COD source scope requires fresh locking isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_operation FROM app.local_cod_operation WHERE id=p_operation_id;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=v_operation.shipment_id FOR UPDATE OF o;
 IF v_operation.id IS NULL OR v_order.payment_method IS DISTINCT FROM 'cod'
 THEN RAISE EXCEPTION 'COD source scope retains its original parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric),0),coalesce(sum(f.buyer_shipping::numeric),0),coalesce(sum(f.payment_charge::numeric),0)
  INTO v_units,v_merchandise,v_shipping,v_charge FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=v_operation.shipment_id AND i.order_id=v_order.id AND (v_operation.unit_ids IS NULL OR v_operation.unit_ids ? f.id::text);
 IF jsonb_array_length(v_units)>100 OR v_merchandise+v_shipping+v_charge>9007199254740991
    OR v_merchandise+v_shipping+v_charge IS DISTINCT FROM v_operation.requested_amount::numeric
    OR (v_operation.unit_ids IS NOT NULL AND v_units IS DISTINCT FROM v_operation.unit_ids)
 THEN RAISE EXCEPTION 'Original COD snapshot retains exactly its unique complete funded units and frozen money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'merchandise_amount',v_merchandise,'buyer_shipping',v_shipping,'payment_charge',v_charge,'amount',v_merchandise+v_shipping+v_charge);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.seal_cod_event_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e app.local_cod_event; operation app.local_cod_operation; s app.order_shipment; journal app.finance_transaction;
 receipt app.economic_receipt; v_basis jsonb; v_exact boolean; v_eligible boolean; selected uuid;
BEGIN
 SELECT * INTO e FROM app.local_cod_event WHERE id=NEW.event_id;
 SELECT * INTO operation FROM app.local_cod_operation WHERE id=e.operation_id;
 SELECT * INTO s FROM app.order_shipment WHERE id=operation.shipment_id;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM app.cod_provider_event p JOIN app.outbox_job j ON j.id=p.callback_job_id
    WHERE p.id=e.id AND p.shipment_id=s.id AND j.kind='cod.callback' AND j.dedup_key='cod-callback:'||e.id::text
     AND j.payload=jsonb_build_object('eventId',e.id::text) AND j.status='completed' AND j.completed_at IS NOT NULL
     AND j.result=jsonb_build_object('event_id',e.id::text,'outcome',NEW.outcome))
 THEN RAISE EXCEPTION 'COD result retains exact original callback identity and atomic completion' USING ERRCODE='23514'; END IF;
 v_basis:=app.cod_operation_collection_basis(operation.id);
 v_exact:=e.amount=(v_basis->>'amount')::bigint AND jsonb_array_length(v_basis->'unit_ids')>0;
 IF NEW.outcome IN ('collected','recovery') THEN
  SELECT * INTO journal FROM app.finance_transaction WHERE id=NEW.transaction_id;
  IF e.status<>'collected' OR journal.id IS NULL OR journal.order_id IS DISTINCT FROM s.order_id
     OR journal.environment IS DISTINCT FROM operation.environment OR journal.effect_reference IS DISTINCT FROM operation.id::text
     OR journal.occurred_at IS DISTINCT FROM e.occurred_at OR (SELECT count(*) FROM app.finance_posting WHERE transaction_id=journal.id)<>2
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='provider_receivable' AND side='debit' AND amount=e.amount)
     OR NOT EXISTS(SELECT 1 FROM app.finance_posting WHERE transaction_id=journal.id AND account='buyer_funds_liability' AND side='credit' AND amount=e.amount)
  THEN RAISE EXCEPTION 'COD money retains its actual original balanced collected amount' USING ERRCODE='23514'; END IF;
  IF NEW.receipt_id IS NOT NULL THEN
   SELECT * INTO receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
   v_eligible:=app.cod_operation_purchase_eligible(operation.id);
   IF NOT v_exact OR journal.kind<>'economic_receipt' OR journal.source<>'local.cod' OR receipt.id IS NULL OR receipt.kind<>'cod'
      OR (receipt.order_id,receipt.shipment_id,receipt.transaction_id,receipt.source,receipt.environment,receipt.effect_reference,receipt.amount,receipt.occurred_at,receipt.event_id)
        IS DISTINCT FROM (s.order_id,s.id,journal.id,'local.cod'::text,operation.environment,operation.id::text,e.amount,e.occurred_at,e.id::text)
      OR (receipt.merchandise_amount,receipt.buyer_shipping,receipt.payment_charge) IS DISTINCT FROM ((v_basis->>'merchandise_amount')::bigint,(v_basis->>'buyer_shipping')::bigint,(v_basis->>'payment_charge')::bigint)
      OR (NEW.outcome='collected' AND (NEW.reason<>'verified_collection' OR NOT v_eligible))
      OR (NEW.outcome='recovery' AND (NEW.reason<>'late_collection' OR v_eligible))
   THEN RAISE EXCEPTION 'Qualified COD money preserves exact original source units and separates late recovery from a new sale' USING ERRCODE='23514'; END IF;
   IF NEW.outcome='collected' THEN
    IF NOT EXISTS(SELECT 1 FROM app.order_event WHERE order_id=s.order_id AND source_id=e.id
       AND payment_status IN ('partially_collected','confirmed') AND created_at=e.occurred_at)
    THEN RAISE EXCEPTION 'Accepted COD collection retains its original parent payment event' USING ERRCODE='23514'; END IF;
    SELECT id INTO selected FROM app.commerce_event WHERE receipt_id=receipt.id AND name='Purchase'; PERFORM app.assert_commerce_event(selected);
   ELSIF EXISTS(SELECT 1 FROM app.commerce_event WHERE receipt_id=receipt.id AND name='Purchase')
      OR EXISTS(SELECT 1 FROM app.order_event WHERE order_id=s.order_id AND source_id=e.id)
   THEN RAISE EXCEPTION 'Late qualified COD money creates no Purchase or revived order state' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.outcome<>'recovery' OR journal.kind<>'adjustment' OR journal.source<>'local.cod.recovery'
      OR (NEW.reason='amount_mismatch' AND v_exact)
      OR (NEW.reason='conflicting_allocation' AND (NOT v_exact OR NOT EXISTS(
        SELECT 1 FROM app.economic_receipt WHERE shipment_id=s.id AND kind='cod' AND effect_reference<>operation.id::text)))
      OR NEW.reason NOT IN ('amount_mismatch','conflicting_allocation')
   THEN RAISE EXCEPTION 'Unallocated COD money cannot invent funded goods or hide an original source' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF NEW.outcome='refused' THEN
  IF e.status<>'refused' OR e.amount<>0 OR NEW.reason<>'recipient_refused' OR NEW.receipt_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
  THEN RAISE EXCEPTION 'COD refusal is zero money, not returned stock or a refund' USING ERRCODE='23514'; END IF;
 ELSIF NEW.outcome='duplicate' THEN
  IF NEW.reason<>'duplicate_callback' OR NOT EXISTS(SELECT 1 FROM app.cod_event_result r JOIN app.local_cod_event original ON original.id=r.event_id
     WHERE original.operation_id=operation.id AND r.outcome IN ('collected','recovery','refused')
      AND r.receipt_id IS NOT DISTINCT FROM NEW.receipt_id AND r.transaction_id IS NOT DISTINCT FROM NEW.transaction_id)
  THEN RAISE EXCEPTION 'Duplicate COD retains its original accepted financial result' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM app.assert_cod_order(s.order_id); RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.waybill_current_request_basis(p_shipment_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_order app.commerce_order; v_units jsonb; v_amount numeric;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable')
 THEN RAISE EXCEPTION 'Waybill scope requires fresh original-order locking' USING ERRCODE='23514'; END IF;
 SELECT o.* INTO v_order FROM app.commerce_order o JOIN app.order_shipment s ON s.order_id=o.id WHERE s.id=p_shipment_id FOR UPDATE OF o;
 IF v_order.id IS NULL THEN RAISE EXCEPTION 'Waybill scope retains its actual original parcel' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f.id) ORDER BY f.id),'[]'::jsonb),coalesce(sum(i.unit_price::numeric+f.buyer_shipping::numeric+f.payment_charge::numeric),0)
  INTO v_units,v_amount FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
  WHERE f.shipment_id=p_shipment_id AND i.order_id=v_order.id AND NOT EXISTS(
   SELECT 1 FROM app.exception_cancellation cancelled WHERE cancelled.fulfillment_item_id=f.id AND cancelled.replacement_link_id IS NULL);
 IF jsonb_array_length(v_units) NOT BETWEEN 1 AND 100 OR v_amount>9007199254740991
 THEN RAISE EXCEPTION 'Waybill request requires surviving complete original units and bounded original money' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('unit_ids',v_units,'cod_due',CASE WHEN v_order.payment_method='cod' THEN v_amount ELSE 0 END);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_return_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_case app.return_case; v_operation app.return_operation; v_original record;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original return quantities and eligibility are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['claim_state','inspection_status']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['claim_state','inspection_status'])
  THEN RAISE EXCEPTION 'Return unit retains original receipt, price, charges, reason and deadline' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO v_case FROM app.return_case c WHERE c.id=NEW.case_id;
 SELECT * INTO v_operation FROM app.return_operation op WHERE op.id=v_case.operation_id;
 IF v_case.id IS NULL OR v_operation.id IS NULL OR v_operation.action<>'return.create'
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
    OR v_case.revision<>1 OR v_case.status<>'requested' OR NEW.claim_state<>'held' OR NEW.inspection_status<>'pending'
 THEN RAISE EXCEPTION 'Original return unit is inserted only with its creating buyer operation' USING ERRCODE='23514'; END IF;
 SELECT f.buyer_shipping,f.payment_charge,i.unit_price,CASE WHEN NEW.replacement_link_id IS NULL THEN r.received_at ELSE replacement_receipt.received_at END received_at INTO v_original
 FROM app.fulfillment_item f JOIN app.order_item i ON i.id=f.order_item_id
 JOIN app.buyer_receipt r ON r.fulfillment_item_id=f.id
 LEFT JOIN app.replacement_link link ON link.id=NEW.replacement_link_id AND link.original_fulfillment_item_id=f.id
 LEFT JOIN app.replacement_buyer_receipt replacement_receipt ON replacement_receipt.replacement_link_id=link.id
 WHERE f.id=NEW.fulfillment_item_id AND i.order_id=v_case.order_id AND r.id=NEW.buyer_receipt_id
   AND (NEW.replacement_link_id IS NULL OR replacement_receipt.id IS NOT NULL);
 IF NOT FOUND OR NEW.merchandise_amount IS DISTINCT FROM v_original.unit_price
    OR NEW.buyer_shipping IS DISTINCT FROM v_original.buyer_shipping OR NEW.payment_charge IS DISTINCT FROM v_original.payment_charge
    OR NEW.deadline_at IS DISTINCT FROM v_original.received_at+interval '168 hours'
    OR v_case.created_at<v_original.received_at OR v_case.created_at>NEW.deadline_at
 THEN RAISE EXCEPTION 'Return unit requires its actually received original offer entitlement and submission window' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;


-- Extend physical occurrence identity; original financial qualification and
-- the existing all-occurrence original-unit refund-allocation cap are retained.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.refund; v_operation app.return_operation; v_item app.return_item; v_unit app.fulfillment_item;
 v_order app.commerce_order; v_receipt app.economic_receipt; v_purchase app.commerce_event; v_original app.order_item;
BEGIN
 SELECT * INTO v_refund FROM app.refund WHERE id=NEW.refund_id;
 SELECT * INTO v_operation FROM app.return_operation WHERE id=v_refund.operation_id;
 SELECT * INTO v_item FROM app.return_item WHERE id=NEW.return_item_id AND case_id=v_refund.case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_refund.order_id FOR UPDATE;
 SELECT * INTO v_unit FROM app.fulfillment_item WHERE id=v_item.fulfillment_item_id FOR UPDATE;
 SELECT * INTO v_original FROM app.order_item WHERE id=v_unit.order_item_id;
 SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
 SELECT * INTO v_purchase FROM app.commerce_event WHERE receipt_id=NEW.receipt_id AND name='Purchase';
 IF v_refund.id IS NULL OR v_operation.id IS NULL OR v_operation.action<>'refund.queue'
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb OR v_refund.revision<>1
    OR v_item.id IS NULL OR v_item.claim_state<>'held' OR v_item.inspection_status NOT IN ('accepted','waived')
    OR v_original.order_id IS DISTINCT FROM v_order.id OR v_receipt.order_id IS DISTINCT FROM v_order.id
    OR v_receipt.environment IS DISTINCT FROM (CASE current_database() WHEN '99ribu_test' THEN 'test' WHEN '99ribu_local' THEN 'local' ELSE NULL END)
    OR (v_order.payment_method='cod' AND (v_receipt.kind<>'cod' OR v_receipt.shipment_id IS DISTINCT FROM v_unit.shipment_id))
    OR (v_order.payment_method='prepaid' AND (v_receipt.kind<>'prepaid' OR v_receipt.shipment_id IS NOT NULL))
    OR (NEW.merchandise_amount,NEW.buyer_shipping,NEW.payment_charge,NEW.amount) IS DISTINCT FROM (v_item.merchandise_amount,v_unit.buyer_shipping,v_unit.payment_charge,v_item.merchandise_amount+v_unit.buyer_shipping+v_unit.payment_charge)
    OR v_item.payment_charge IS DISTINCT FROM v_unit.payment_charge
    OR NEW.purchase_event_id IS DISTINCT FROM v_purchase.id
    OR (v_purchase.id IS NOT NULL AND (v_purchase.order_id,v_purchase.occurred_at,v_purchase.merchandise_amount) IS DISTINCT FROM (v_order.id,v_receipt.occurred_at,v_receipt.merchandise_amount))
    OR EXISTS(SELECT 1 FROM app.refund_allocation a JOIN app.return_item r ON r.id=a.return_item_id WHERE r.fulfillment_item_id=v_unit.id)
 THEN RAISE EXCEPTION 'Refund allocation binds each whole original unit, frozen shipping and original optional Purchase once' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_refund_collection(v_receipt.id); RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP FUNCTION app.recovery_refund_eligible_units(uuid);
--> statement-breakpoint
CREATE FUNCTION app.recovery_refund_eligible_units(p_case_id uuid)
RETURNS TABLE(exception_unit_id uuid,fulfillment_item_id uuid,receipt_id uuid,purchase_event_id uuid,
 merchandise_amount bigint,buyer_shipping bigint,payment_charge bigint,amount numeric,transaction_id uuid,source_event_id uuid,source_amount bigint)
LANGUAGE sql STABLE AS $$
 WITH applied AS (
  SELECT event.id,event.snapshot->'application' application FROM app.exception_event event WHERE event.exception_id=p_case_id
   AND event.kind IN ('cancel','source_reconciled') AND jsonb_typeof(event.snapshot->'application')='object'
   ORDER BY event.revision DESC LIMIT 1
 )
 SELECT unit.id,original.id,receipt.id,purchase.id,item.unit_price::bigint,original.buyer_shipping::bigint,original.payment_charge::bigint,
  item.unit_price::numeric+original.buyer_shipping::numeric+original.payment_charge::numeric,receipt.transaction_id,receipt.event_id::uuid,receipt.amount
 FROM app.commerce_exception case_head JOIN app.commerce_order purchase_order ON purchase_order.id=case_head.order_id
 JOIN app.exception_unit unit ON unit.exception_id=case_head.id JOIN app.fulfillment_item original ON original.id=unit.fulfillment_item_id
 JOIN app.order_item item ON item.id=original.order_item_id AND item.order_id=purchase_order.id
 JOIN app.economic_receipt receipt ON receipt.order_id=purchase_order.id AND receipt.kind=purchase_order.payment_method
  AND ((receipt.kind='prepaid' AND receipt.shipment_id IS NULL) OR (receipt.kind='cod' AND receipt.shipment_id=original.shipment_id))
  AND original.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id))
 LEFT JOIN app.commerce_event purchase ON purchase.receipt_id=receipt.id AND purchase.name='Purchase'
 LEFT JOIN applied ON true
 LEFT JOIN app.exception_event proposal ON proposal.id::text=applied.application->>'proposal_id' AND proposal.exception_id=case_head.id AND proposal.kind='propose'
 WHERE case_head.id=p_case_id AND (
  (case_head.kind='late_collection' AND receipt.event_id=case_head.source_id::text)
  OR (case_head.kind NOT IN ('late_collection','unallocated_collection') AND EXISTS(
   SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.exception_unit_id=unit.id AND cancellation.event_id=applied.id)
   AND (unit.replacement_link_id IS NULL OR proposal.snapshot->'proposal'->>'action'='refund_original_entitlement')))
 ORDER BY unit.id;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_recovery_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_operation app.exception_operation; v_eligible record;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=NEW.refund_id;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=v_refund.operation_id;
 IF v_refund.id IS NULL OR v_refund.revision<>1 OR v_operation.id IS NULL OR v_operation.action<>'refund_queue'
    OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Compensation allocation belongs only to its original unfinished finance queue' USING ERRCODE='23514'; END IF;
 IF v_refund.basis_kind='unallocated' THEN
  IF NEW.exception_unit_id IS NOT NULL OR NEW.fulfillment_item_id IS NOT NULL OR NEW.receipt_id IS NOT NULL OR NEW.purchase_event_id IS NOT NULL
     OR NEW.merchandise_amount<>0 OR NEW.buyer_shipping<>0 OR NEW.payment_charge<>0 OR NEW.amount IS DISTINCT FROM v_refund.amount OR v_refund.amount<>v_refund.source_amount
  THEN RAISE EXCEPTION 'Unallocated compensation retains the original complete money source without any merchandise claim' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO v_eligible FROM app.recovery_refund_eligible_units(v_refund.exception_id) unit WHERE unit.exception_unit_id=NEW.exception_unit_id AND unit.receipt_id=v_refund.receipt_id;
  IF v_eligible.exception_unit_id IS NULL OR (NEW.fulfillment_item_id,NEW.receipt_id,NEW.purchase_event_id,NEW.merchandise_amount,NEW.buyer_shipping,NEW.payment_charge,NEW.amount::numeric)
     IS DISTINCT FROM (v_eligible.fulfillment_item_id,v_eligible.receipt_id,v_eligible.purchase_event_id,v_eligible.merchandise_amount,v_eligible.buyer_shipping,v_eligible.payment_charge,v_eligible.amount)
     OR v_eligible.transaction_id IS DISTINCT FROM v_refund.source_transaction_id OR v_eligible.source_event_id IS DISTINCT FROM v_refund.source_id
  THEN RAISE EXCEPTION 'Compensation allocates only the accepted actually funded original complete unit and its frozen Purchase context' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_recovery_refund(p_refund_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_refund app.recovery_refund; v_event app.recovery_refund_event; v_first app.recovery_refund_event; v_operation app.exception_operation;
 v_count integer; v_amount numeric; v_expected jsonb; v_actual jsonb; v_job app.outbox_job;
 v_request app.local_recovery_operation; v_bank app.local_recovery_event; v_result app.recovery_event_result;
 v_case_event app.exception_event; v_intent app.recovery_adjustment_intent; v_receipt app.economic_receipt;
 v_cumulative numeric; v_history integer; v_confirmed integer; v_case app.commerce_exception; v_complete boolean;
BEGIN
 SELECT * INTO v_refund FROM app.recovery_refund WHERE id=p_refund_id FOR UPDATE;
 SELECT * INTO v_event FROM app.recovery_refund_event WHERE refund_id=p_refund_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO v_first FROM app.recovery_refund_event WHERE refund_id=p_refund_id AND revision=1;
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=v_refund.operation_id;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_refund.exception_id;
 SELECT count(*)>0 AND bool_and(status='succeeded') INTO v_complete FROM app.recovery_refund WHERE exception_id=v_refund.exception_id;
 IF v_refund.id IS NULL OR v_event.id IS NULL OR v_first.id IS NULL OR v_first.kind<>'queue' OR v_first.source_kind<>'operation'
    OR v_first.source_id IS DISTINCT FROM v_operation.id OR v_operation.action<>'refund_queue' OR v_operation.response='{}'::jsonb
    OR v_operation.exception_id IS DISTINCT FROM v_refund.exception_id OR v_first.occurred_at IS DISTINCT FROM v_refund.created_at
    OR v_case.id IS NULL OR (v_complete AND v_case.status<>'resolved') OR (NOT v_complete AND v_case.status NOT IN ('refunding','unknown'))
    OR v_event.revision IS DISTINCT FROM v_refund.revision OR (SELECT count(*) FROM app.recovery_refund_event WHERE refund_id=p_refund_id)<>v_refund.revision
    OR (v_event.status,v_event.job_id,v_event.provider_operation_id,v_event.destination_source_id,v_event.cash_transaction_id)
       IS DISTINCT FROM (v_refund.status,v_refund.current_job_id,v_refund.current_operation_id,v_refund.destination_source_id,v_refund.cash_transaction_id)
 THEN RAISE EXCEPTION 'Recovery refund seals contiguous exact original-source history and its finalized finance command' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_recovery_refund_source(v_refund);
 SELECT count(*),sum(amount::numeric) INTO v_count,v_amount FROM app.recovery_refund_allocation WHERE refund_id=p_refund_id;
 IF v_count NOT BETWEEN 1 AND 100 OR v_amount IS DISTINCT FROM v_refund.amount::numeric
 THEN RAISE EXCEPTION 'Recovery allocation retains every and only full obligated rupiah' USING ERRCODE='23514'; END IF;
 IF v_refund.basis_kind='purchased_units' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_array(exception_unit_id,fulfillment_item_id,receipt_id,purchase_event_id,merchandise_amount,buyer_shipping,payment_charge,amount) ORDER BY exception_unit_id),'[]'::jsonb)
   INTO v_expected FROM app.recovery_refund_eligible_units(v_refund.exception_id) eligible WHERE eligible.receipt_id=v_refund.receipt_id;
  SELECT coalesce(jsonb_agg(jsonb_build_array(exception_unit_id,fulfillment_item_id,receipt_id,purchase_event_id,merchandise_amount,buyer_shipping,payment_charge,amount) ORDER BY exception_unit_id),'[]'::jsonb)
   INTO v_actual FROM app.recovery_refund_allocation WHERE refund_id=p_refund_id;
  IF v_actual IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Recovery queue groups every exact accepted funded unit under its one original receipt' USING ERRCODE='23514'; END IF;
 ELSIF v_count<>1 OR v_refund.amount<>v_refund.source_amount THEN
  RAISE EXCEPTION 'Unallocated recovery keeps one complete original money allocation' USING ERRCODE='23514';
 END IF;
 IF v_refund.current_job_id IS NOT NULL THEN
  SELECT * INTO v_job FROM app.outbox_job WHERE id=v_refund.current_job_id;
  IF v_job.id IS NULL OR v_job.kind<>'recovery.refund.create'
     OR jsonb_typeof(v_job.payload->'attempt') IS DISTINCT FROM 'number' OR v_job.payload->>'attempt'!~'^[1-9][0-9]{0,9}$'
     OR (v_job.payload->>'attempt')::bigint>2147483647
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('refundId',v_refund.id,'attempt',(v_job.payload->>'attempt')::integer)
     OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-create:'||v_refund.id::text||':'||(v_job.payload->>'attempt')
  THEN RAISE EXCEPTION 'Recovery creation retains its exact original refund and bounded attempt intent' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_request FROM app.local_recovery_operation WHERE creation_job_id=v_job.id;
  IF v_refund.current_operation_id IS DISTINCT FROM v_request.id
     OR (v_job.status='completed' AND (v_request.id IS NULL OR v_job.result IS DISTINCT FROM jsonb_build_object('operation_id',v_request.id)))
     OR (v_job.status='failed' AND v_request.id IS NOT NULL)
     OR (v_refund.status='queued' AND v_request.id IS NOT NULL)
     OR (v_refund.status IN ('processing','unknown','succeeded','failed') AND v_request.id IS NULL)
  THEN RAISE EXCEPTION 'Recovery retains the actual committed original bank request or an unprepared source-absent intent' USING ERRCODE='23514'; END IF;
  IF v_request.id IS NOT NULL THEN PERFORM app.assert_recovery_request(v_request.id); END IF;
 ELSIF v_refund.status<>'awaiting_destination' OR v_refund.source_kind<>'cod_event' OR v_refund.destination_source_id IS NOT NULL
    OR v_refund.current_operation_id IS NOT NULL OR v_refund.cash_transaction_id IS NOT NULL
 THEN RAISE EXCEPTION 'Only an unverified original COD recipient can lack its creation job and bank request' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO v_confirmed FROM app.recovery_event_result WHERE refund_id=p_refund_id AND outcome='confirmed';
 IF v_confirmed<>(CASE WHEN v_refund.status='succeeded' THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'Original recovery money confirms once, separately from all failed request history' USING ERRCODE='23514'; END IF;
 FOR v_event IN SELECT * FROM app.recovery_refund_event WHERE refund_id=p_refund_id AND source_kind='provider' ORDER BY revision LOOP
  SELECT * INTO v_bank FROM app.local_recovery_event WHERE id=v_event.source_id;
  SELECT * INTO v_request FROM app.local_recovery_operation WHERE id=v_bank.operation_id;
  SELECT * INTO v_result FROM app.recovery_event_result WHERE event_id=v_bank.id;
  SELECT * INTO v_case_event FROM app.exception_event WHERE id=v_result.exception_event_id;
  SELECT job.* INTO v_job FROM app.recovery_provider_event registered JOIN app.outbox_job job ON job.id=registered.callback_job_id WHERE registered.id=v_bank.id;
  IF v_bank.id IS NULL OR v_request.id IS NULL OR v_request.refund_id IS DISTINCT FROM v_refund.id
     OR v_result.event_id IS NULL OR v_case_event.id IS NULL OR v_job.id IS NULL OR v_job.kind<>'recovery.refund.callback'
     OR v_job.status<>'completed' OR v_job.completed_at IS NULL OR v_job.last_error IS NOT NULL
     OR (v_result.refund_id,v_result.revision,v_result.refund_event_id,v_result.cash_transaction_id)
       IS DISTINCT FROM (v_refund.id,v_event.revision,v_event.id,v_event.cash_transaction_id)
     OR v_result.outcome IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirmed' ELSE 'failed' END)
     OR v_event.status IS DISTINCT FROM v_bank.status OR v_event.provider_operation_id IS DISTINCT FROM v_request.id
     OR v_event.job_id IS DISTINCT FROM v_request.creation_job_id OR v_event.destination_source_id IS DISTINCT FROM v_request.destination_source_id
     OR v_event.kind IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'confirm' ELSE 'fail' END)
     OR v_event.occurred_at<v_bank.occurred_at OR v_bank.occurred_at<v_request.created_at
     OR v_job.payload IS DISTINCT FROM jsonb_build_object('eventId',v_bank.id) OR v_job.dedup_key IS DISTINCT FROM 'recovery-refund-callback:'||v_bank.id::text
     OR v_job.result IS DISTINCT FROM jsonb_build_object('event_id',v_bank.id,'refund_id',v_refund.id,'outcome',v_result.outcome,'version',v_event.revision)
     OR v_case_event.exception_id IS DISTINCT FROM v_refund.exception_id OR v_case_event.source_kind<>'refund' OR v_case_event.source_id IS DISTINCT FROM v_event.id
     OR v_case_event.kind IS DISTINCT FROM (CASE v_bank.status WHEN 'succeeded' THEN 'refund_confirmed' ELSE 'refund_failed' END)
     OR v_case_event.occurred_at IS DISTINCT FROM v_event.occurred_at OR v_case_event.actor_id IS NOT NULL
  THEN RAISE EXCEPTION 'Every recovery callback retains its exact immutable historical result, original bank time and atomically completed job' USING ERRCODE='23514'; END IF;
  PERFORM app.assert_recovery_request(v_request.id);
 END LOOP;
 IF v_refund.status='succeeded' THEN
  IF (SELECT count(*) FROM app.recovery_adjustment_intent WHERE refund_id=p_refund_id)
      IS DISTINCT FROM (CASE WHEN v_refund.basis_kind='purchased_units' THEN 1 ELSE 0 END)
  THEN RAISE EXCEPTION 'Successful purchased compensation retains one original receipt adjustment; unallocated money invents none' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM app.recovery_adjustment_intent WHERE refund_id=p_refund_id) OR v_refund.cash_transaction_id IS NOT NULL
  THEN RAISE EXCEPTION 'Unconfirmed recovery retains no outgoing cash or successful receipt adjustment' USING ERRCODE='23514'; END IF;
 END IF;
 FOR v_intent IN SELECT * FROM app.recovery_adjustment_intent WHERE refund_id=p_refund_id LOOP
  SELECT * INTO v_receipt FROM app.economic_receipt WHERE id=v_intent.receipt_id;
  SELECT * INTO v_bank FROM app.local_recovery_event WHERE operation_id=v_refund.current_operation_id;
  SELECT coalesce(sum(merchandise_refunded),0),count(*) INTO v_cumulative,v_history FROM (
   SELECT merchandise_refunded,sequence FROM app.refund_adjustment_intent WHERE receipt_id=v_intent.receipt_id
   UNION ALL SELECT merchandise_refunded,sequence FROM app.recovery_adjustment_intent WHERE receipt_id=v_intent.receipt_id
  ) history WHERE sequence<=v_intent.sequence;
  IF v_intent.receipt_id IS DISTINCT FROM v_refund.receipt_id OR v_intent.sequence<>v_history
     OR v_intent.retained_merchandise::numeric IS DISTINCT FROM v_receipt.merchandise_amount::numeric-v_cumulative
     OR v_intent.merchandise_refunded::numeric IS DISTINCT FROM (SELECT sum(merchandise_amount::numeric) FROM app.recovery_refund_allocation WHERE refund_id=p_refund_id)
     OR v_intent.original_occurred_at IS DISTINCT FROM v_receipt.occurred_at OR v_intent.confirmed_at IS DISTINCT FROM v_bank.occurred_at
  THEN RAISE EXCEPTION 'Recovery adjustment history retains its original increment and shared sequence-specific merchandise value' USING ERRCODE='23514'; END IF;
 END LOOP;
 PERFORM app.assert_recovery_refund_money(v_refund.obligation_transaction_id);
 IF v_refund.cash_transaction_id IS NOT NULL THEN PERFORM app.assert_recovery_refund_money(v_refund.cash_transaction_id); END IF;
 PERFORM app.assert_recovery_return_effects(v_refund.id);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_exception_refund_proposal(p_case_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_case app.commerce_exception; v_order app.commerce_order; v_source record;
 v_transaction_id uuid; v_used numeric; v_count integer; v_qualified integer; v_distinct integer;
BEGIN
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=p_case_id;
 SELECT * INTO v_order FROM app.commerce_order WHERE id=v_case.order_id FOR UPDATE;
 IF v_case.id IS NULL OR v_order.id IS NULL THEN RAISE EXCEPTION 'Refund proposal requires its actual original case' USING ERRCODE='23514'; END IF;
 PERFORM f.id FROM app.fulfillment_item f JOIN app.exception_unit u ON u.fulfillment_item_id=f.id
  WHERE u.exception_id=p_case_id AND u.active ORDER BY f.id FOR UPDATE OF f;
 IF v_case.kind='unallocated_collection' THEN
  PERFORM app.assert_exception_collection_case(p_case_id);
  SELECT transaction_id INTO v_transaction_id FROM app.payment_event_result WHERE v_case.source_kind='payment_event' AND event_id=v_case.source_id
  UNION ALL SELECT transaction_id FROM app.cod_event_result WHERE v_case.source_kind='cod_event' AND event_id=v_case.source_id;
  PERFORM app.assert_compensation_capacity(v_transaction_id);
  SELECT coalesce(sum(amount),0) INTO v_used FROM (
   SELECT a.amount FROM app.refund_allocation a JOIN app.economic_receipt r ON r.id=a.receipt_id WHERE r.transaction_id=v_transaction_id
   UNION ALL SELECT amount FROM app.recovery_refund WHERE source_transaction_id=v_transaction_id
  ) allocations;
  IF v_used<>0 THEN RAISE EXCEPTION 'Unallocated refund proposal retains its complete still-available original source' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 SELECT count(*),count(DISTINCT u.fulfillment_item_id),count(r.id) INTO v_count,v_distinct,v_qualified
  FROM app.exception_unit u JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id JOIN app.order_item i ON i.id=f.order_item_id
  LEFT JOIN app.economic_receipt r ON r.order_id=i.order_id AND r.kind=v_order.payment_method
   AND ((r.kind='prepaid' AND r.shipment_id IS NULL) OR (r.kind='cod' AND r.shipment_id=f.shipment_id)) AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(r.id))
  WHERE u.exception_id=p_case_id AND u.active;
 IF v_count NOT BETWEEN 1 AND 100 OR v_distinct<>v_count OR v_qualified<>v_count
    OR EXISTS(SELECT 1 FROM app.exception_unit u JOIN app.return_item item ON item.fulfillment_item_id=u.fulfillment_item_id
      JOIN app.refund_allocation a ON a.return_item_id=item.id WHERE u.exception_id=p_case_id AND u.active)
    OR EXISTS(SELECT 1 FROM app.exception_unit u JOIN app.recovery_refund_allocation a ON a.fulfillment_item_id=u.fulfillment_item_id
      WHERE u.exception_id=p_case_id AND u.active)
 THEN RAISE EXCEPTION 'Refund proposal retains its complete unique original units without allocated compensation' USING ERRCODE='23514'; END IF;
 FOR v_source IN
  SELECT r.id,r.transaction_id,r.amount,sum(i.unit_price::numeric+f.buyer_shipping::numeric+f.payment_charge::numeric) proposed
   FROM app.exception_unit u JOIN app.fulfillment_item f ON f.id=u.fulfillment_item_id JOIN app.order_item i ON i.id=f.order_item_id
   JOIN app.economic_receipt r ON r.order_id=i.order_id AND r.kind=v_order.payment_method
    AND ((r.kind='prepaid' AND r.shipment_id IS NULL) OR (r.kind='cod' AND r.shipment_id=f.shipment_id)) AND f.id IN (SELECT id FROM app.receipt_entitled_unit_ids(r.id))
   WHERE u.exception_id=p_case_id AND u.active GROUP BY r.id,r.transaction_id,r.amount ORDER BY r.transaction_id
 LOOP
  PERFORM app.assert_recovery_receipt(v_source.id);
  PERFORM app.assert_compensation_capacity(v_source.transaction_id);
  SELECT coalesce(sum(amount),0) INTO v_used FROM (
   SELECT a.amount FROM app.refund_allocation a JOIN app.economic_receipt receipt ON receipt.id=a.receipt_id WHERE receipt.transaction_id=v_source.transaction_id
   UNION ALL SELECT amount FROM app.recovery_refund WHERE source_transaction_id=v_source.transaction_id
  ) allocations;
  IF v_used+v_source.proposed>v_source.amount
  THEN RAISE EXCEPTION 'Refund proposal fits actual original money after every pending and successful obligation' USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assert_exception_application(p_operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operation app.exception_operation; v_case app.commerce_exception; v_event app.exception_event; v_proposal app.exception_event;
 v_ids jsonb; v_retired jsonb; v_pending integer; v_retired_sources integer; v_funded integer; v_incomplete boolean; v_source record; v_used numeric;
BEGIN
 SELECT * INTO v_operation FROM app.exception_operation WHERE id=p_operation_id;
 IF v_operation.id IS NULL OR v_operation.action<>'apply' OR v_operation.created_xid<>pg_current_xact_id()::text OR v_operation.response='{}'::jsonb
 THEN RAISE EXCEPTION 'Application finalizes once in its actual original CS transaction' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_case FROM app.commerce_exception WHERE id=v_operation.exception_id FOR UPDATE;
 SELECT * INTO v_event FROM app.exception_event WHERE source_kind='operation' AND source_id=v_operation.id;
 SELECT * INTO v_proposal FROM app.exception_event WHERE id::text=v_operation.input->>'proposal_id' AND exception_id=v_case.id AND kind='propose';
 SELECT coalesce(jsonb_agg(to_jsonb(id) ORDER BY id),'[]'::jsonb) INTO v_ids FROM app.exception_unit WHERE exception_id=v_case.id;
 IF v_event.id IS NULL OR v_proposal.id IS NULL OR (SELECT count(*) FROM app.exception_event WHERE source_kind='operation' AND source_id=v_operation.id)<>1
    OR v_event.exception_id IS DISTINCT FROM v_case.id OR v_event.revision::bigint<>(v_operation.input->>'expected_version')::bigint+1
    OR v_event.revision IS DISTINCT FROM v_case.revision OR v_event.status IS DISTINCT FROM v_case.status
    OR v_event.actor_id IS DISTINCT FROM v_operation.actor_id OR v_event.occurred_at IS DISTINCT FROM v_operation.occurred_at
    OR v_event.kind NOT IN ('source_reconciled','cancel') OR v_event.reason IS DISTINCT FROM v_operation.input->>'reason'
    OR v_event.snapshot->'application'->>'proposal_id' IS DISTINCT FROM v_proposal.id::text
    OR v_proposal.snapshot->'proposal'->'unit_ids' IS DISTINCT FROM v_ids
    OR NOT EXISTS(SELECT 1 FROM app.exception_event consent WHERE consent.id::text=v_event.snapshot->'application'->>'consent_event_id'
      AND consent.exception_id=v_case.id AND consent.kind='buyer_accept' AND consent.cause_event_id=v_proposal.id AND consent.revision<v_event.revision)
    OR v_operation.response IS DISTINCT FROM app.exception_projection(v_case.id,false)
 THEN RAISE EXCEPTION 'Application retains one exact current event, complete accepted scope and closed staff response' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.exception_goods_intake WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.exception_stock_observation WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.recovery_refund WHERE operation_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.fulfillment_event WHERE source_kind='operation' AND source_id=p_operation_id)
    OR EXISTS(SELECT 1 FROM app.replacement_event WHERE source_kind='operation' AND source_id=p_operation_id)
 THEN RAISE EXCEPTION 'CS application creates no intake, refund obligation, financial authority or invented physical event' USING ERRCODE='23514'; END IF;
 SELECT count(*) FILTER (WHERE cancellation.status IN ('queued','acknowledged')),count(*) FILTER (WHERE cancellation.status='not_created')
  INTO v_pending,v_retired_sources FROM jsonb_array_elements_text(v_event.snapshot->'application'->'cancellation_ids') ref(id)
   JOIN app.shipment_cancellation cancellation ON cancellation.id::text=ref.id;
 SELECT coalesce(jsonb_agg(to_jsonb(exception_unit_id) ORDER BY exception_unit_id),'[]'::jsonb) INTO v_retired FROM app.exception_cancellation WHERE operation_id=p_operation_id;
 IF v_event.kind='source_reconciled' THEN
  IF v_retired<>'[]'::jsonb OR EXISTS(SELECT 1 FROM app.promotion_movement WHERE exception_operation_id=p_operation_id)
     OR EXISTS(SELECT 1 FROM app.stock_movement WHERE source_ref LIKE 'exception-release:'||p_operation_id::text||':%' OR source_ref='exception-loss:'||p_operation_id::text)
     OR (v_event.status='awaiting_source' AND (v_pending=0 OR v_retired_sources<>0))
     OR (v_event.status='escalated' AND v_retired_sources=0)
     OR (v_event.status IN ('awaiting_return','ready_for_refund') AND (v_pending<>0 OR v_retired_sources<>0))
     OR (v_event.status='ready_for_refund' AND v_case.kind NOT IN ('late_collection','unallocated_collection'))
     OR (v_event.status='awaiting_return' AND v_case.kind NOT IN ('cod_refusal','delivery_failure'))
  THEN RAISE EXCEPTION 'Source reconciliation performs no business retirement and exposes only the actual unresolved phase' USING ERRCODE='23514'; END IF;
  IF v_event.status='ready_for_refund' THEN PERFORM app.assert_exception_refund_proposal(v_case.id); END IF;
  PERFORM app.assert_exception_retirement_stock(p_operation_id); RETURN;
 END IF;
 IF v_case.kind IN ('late_collection','unallocated_collection','waybill_uncertain') OR v_retired IS DISTINCT FROM v_ids OR v_pending<>0 OR v_retired_sources<>0
    OR EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=p_operation_id AND (exception_id<>v_case.id OR event_id<>v_event.id
      OR consent_event_id::text<>v_event.snapshot->'application'->>'consent_event_id' OR occurred_at<>v_operation.occurred_at))
 THEN RAISE EXCEPTION 'Final retirement applies every and only accepted physical occurrence after carrier outcome proof' USING ERRCODE='23514'; END IF;
 v_funded:=0;
 FOR v_source IN SELECT receipt.id,receipt.transaction_id,receipt.amount,sum(item.unit_price::numeric+unit.buyer_shipping::numeric+unit.payment_charge::numeric) proposed,count(*) units
  FROM app.exception_cancellation cancellation JOIN app.fulfillment_item unit ON unit.id=cancellation.fulfillment_item_id
  JOIN app.order_item item ON item.id=unit.order_item_id JOIN app.economic_receipt receipt ON receipt.order_id=v_case.order_id
   AND unit.id IN (SELECT id FROM app.receipt_entitled_unit_ids(receipt.id))
  WHERE cancellation.operation_id=p_operation_id AND (cancellation.replacement_link_id IS NULL OR v_proposal.snapshot->'proposal'->>'action'='refund_original_entitlement')
  GROUP BY receipt.id,receipt.transaction_id,receipt.amount ORDER BY receipt.transaction_id
 LOOP
  PERFORM app.assert_recovery_receipt(v_source.id); PERFORM app.assert_compensation_capacity(v_source.transaction_id);
  SELECT coalesce(sum(amount),0) INTO v_used FROM (
   SELECT allocation.amount FROM app.refund_allocation allocation JOIN app.economic_receipt receipt ON receipt.id=allocation.receipt_id WHERE receipt.transaction_id=v_source.transaction_id
   UNION ALL SELECT amount FROM app.recovery_refund WHERE source_transaction_id=v_source.transaction_id) obligations;
  IF v_used+v_source.proposed>v_source.amount OR EXISTS(
    SELECT 1 FROM app.exception_cancellation cancellation WHERE cancellation.operation_id=p_operation_id
     AND (cancellation.replacement_link_id IS NULL OR v_proposal.snapshot->'proposal'->>'action'='refund_original_entitlement')
     AND (EXISTS(SELECT 1 FROM app.refund_allocation allocation JOIN app.return_item item ON item.id=allocation.return_item_id WHERE item.fulfillment_item_id=cancellation.fulfillment_item_id)
       OR EXISTS(SELECT 1 FROM app.recovery_refund_allocation WHERE fulfillment_item_id=cancellation.fulfillment_item_id)))
  THEN RAISE EXCEPTION 'Retirement requalifies actual original available money without allocating a second entitlement' USING ERRCODE='23514'; END IF;
  v_funded:=v_funded+v_source.units;
 END LOOP;
 SELECT EXISTS(SELECT 1 FROM app.exception_cancellation cancellation JOIN app.fulfillment_component_allocation component ON component.fulfillment_item_id=cancellation.fulfillment_item_id
  CROSS JOIN LATERAL app.physical_intake_basis(cancellation.fulfillment_item_id,NULL,component.balance_id) intake
  WHERE cancellation.operation_id=p_operation_id AND cancellation.stock_disposition='consumed' AND intake.known_quantity<component.quantity) INTO v_incomplete;
 IF v_event.status IS DISTINCT FROM (CASE WHEN v_funded>0 THEN 'ready_for_refund' WHEN v_incomplete THEN 'awaiting_return' ELSE 'resolved' END)
 THEN RAISE EXCEPTION 'Applied case completion derives actual original money and separately outstanding physical intake' USING ERRCODE='23514'; END IF;
 PERFORM app.assert_exception_retirement_stock(p_operation_id);
 IF EXISTS(SELECT 1 FROM app.exception_retirement_components(p_operation_id) component JOIN app.stock_reservation reservation ON reservation.id=component.reservation_id
   WHERE reservation.status IS DISTINCT FROM app.retired_reservation_state(reservation.id))
 THEN RAISE EXCEPTION 'Application seals actual remaining original and replacement stock hold state' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM app.order_event WHERE order_id=v_case.order_id AND source_id=v_event.id)
      IS DISTINCT FROM (CASE WHEN EXISTS(SELECT 1 FROM app.exception_cancellation WHERE operation_id=p_operation_id AND replacement_link_id IS NULL) THEN 1::bigint ELSE 0::bigint END)
 THEN RAISE EXCEPTION 'Only original-unit retirement appends its exact parent order event once' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  SELECT 1 FROM (SELECT link.shipment_id,min(cancellation.exception_unit_id::text)::uuid source_id
   FROM app.exception_cancellation cancellation JOIN app.replacement_link link ON link.id=cancellation.replacement_link_id
   WHERE cancellation.operation_id=p_operation_id GROUP BY link.shipment_id) scope
  WHERE (SELECT count(*) FROM app.replacement_event event WHERE event.shipment_id=scope.shipment_id AND event.source_kind='exception'
    AND event.source_id=scope.source_id AND event.kind='cancel' AND event.occurred_at=v_operation.occurred_at)<>1
 ) THEN RAISE EXCEPTION 'Every affected replacement parcel commits one exact accepted retirement image without creating another sale' USING ERRCODE='23514'; END IF;
 IF EXISTS(
  SELECT 1 FROM app.replacement_event source JOIN app.exception_cancellation representative ON representative.exception_unit_id=source.source_id
   WHERE representative.operation_id=p_operation_id AND source.source_kind='exception' AND source.kind='cancel'
    AND (SELECT count(*) FROM app.return_event claim WHERE claim.source_kind='replacement' AND claim.source_id=source.id AND claim.kind='replacement_cancelled')<>1
 ) THEN RAISE EXCEPTION 'Replacement retirement retains one exact original claim-history transition per affected parcel' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
-- Finance confirmation of a manual bank transfer is append-only and is the only
-- way a manual-bank provider operation becomes confirmed.
CREATE FUNCTION app.guard_manual_bank_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt; p app.local_payment_operation;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Manual bank confirmations are retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM app.payment_attempt WHERE id=NEW.attempt_id;
 SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.operation_id;
 IF a.id IS NULL OR a.method_id<>'manual-bank' OR p.attempt_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'Confirmation binds one manual-bank attempt and its own operation' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER manual_bank_confirmation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.manual_bank_confirmation FOR EACH ROW EXECUTE FUNCTION app.guard_manual_bank_confirmation();
--> statement-breakpoint
CREATE FUNCTION app.seal_manual_bank_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.payment_attempt; p app.local_payment_operation; c app.manual_bank_confirmation;
BEGIN
 SELECT * INTO p FROM app.local_payment_operation WHERE id=NEW.id;
 SELECT * INTO a FROM app.payment_attempt WHERE id=p.attempt_id;
 IF a.method_id='manual-bank' AND p.status='confirmed' THEN
  SELECT * INTO c FROM app.manual_bank_confirmation WHERE operation_id=p.id;
  IF c.attempt_id IS NULL OR c.amount IS DISTINCT FROM p.collected_amount
  THEN RAISE EXCEPTION 'A manual-bank collection requires its exact finance confirmation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER manual_bank_operation_sealed AFTER INSERT OR UPDATE ON app.local_payment_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_manual_bank_operation();
