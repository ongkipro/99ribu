CREATE TABLE "app"."ad_delivery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ad_delivery_attempt_value_check" CHECK ("app"."ad_delivery_attempt"."kind" IN ('dispatch','reconcile') AND "app"."ad_delivery_attempt"."outcome" IN ('accepted','suppressed','definitive_no_effect'))
);
--> statement-breakpoint
CREATE TABLE "app"."ad_event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"destination_version" text DEFAULT 'local-sink-v1' NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"job_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ad_event_outbox_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "ad_event_delivery_unique" UNIQUE("event_id","platform","destination_version"),
	CONSTRAINT "ad_event_outbox_value_check" CHECK ("app"."ad_event_outbox"."platform" IN ('meta','google','tiktok') AND "app"."ad_event_outbox"."destination_version"='local-sink-v1' AND "app"."ad_event_outbox"."status" IN ('queued','suppressed','accepted','cancelled','quarantined') AND "app"."ad_event_outbox"."reason" IN ('eligible','no_consent','expired','withdrawn','unavailable_context','source_not_eligible','accepted_local','definitive_no_effect') AND ("app"."ad_event_outbox"."status"<>'queued' OR "app"."ad_event_outbox"."job_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."commerce_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"source_kind" text NOT NULL,
	"source_reference" text NOT NULL,
	"request_hash" text NOT NULL,
	"visitor_id" uuid,
	"consent_receipt_id" uuid,
	"order_id" uuid,
	"receipt_id" uuid,
	"merchandise_amount" bigint DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commerce_event_receipt_id_unique" UNIQUE("receipt_id"),
	CONSTRAINT "commerce_event_source_unique" UNIQUE("source_kind","source_reference"),
	CONSTRAINT "commerce_event_value_check" CHECK ("app"."commerce_event"."schema_version"=1 AND "app"."commerce_event"."source_kind" IN ('economic_receipt','commerce_operation','browser') AND char_length("app"."commerce_event"."source_reference") between 1 and 500 AND "app"."commerce_event"."request_hash" ~ '^[0-9a-f]{64}$' AND "app"."commerce_event"."merchandise_amount" between 0 and 9007199254740991 AND jsonb_typeof("app"."commerce_event"."payload")='object' AND (("app"."commerce_event"."name"='Purchase' AND "app"."commerce_event"."source_kind"='economic_receipt' AND "app"."commerce_event"."receipt_id" IS NOT NULL AND "app"."commerce_event"."order_id" IS NOT NULL AND "app"."commerce_event"."merchandise_amount">0) OR ("app"."commerce_event"."name" IN ('product_viewed','offer_selected','cart_changed','checkout_started','contact_validated','address_validated','shipping_selected','payment_method_selected','order_placed','receipt_viewed') AND "app"."commerce_event"."source_kind"<>'economic_receipt' AND "app"."commerce_event"."receipt_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."consent_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"policy_version" text NOT NULL,
	"choices" jsonb NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "consent_revision_unique" UNIQUE("visitor_id","revision"),
	CONSTRAINT "consent_request_unique" UNIQUE("visitor_id","key"),
	CONSTRAINT "consent_value_check" CHECK ("app"."consent_receipt"."revision">0 AND "app"."consent_receipt"."key" ~ '^[A-Za-z0-9_-]{16,200}$' AND "app"."consent_receipt"."request_hash" ~ '^[0-9a-f]{64}$' AND char_length("app"."consent_receipt"."policy_version") between 1 and 100 AND jsonb_typeof("app"."consent_receipt"."choices")='object' AND "app"."consent_receipt"."expires_at">"app"."consent_receipt"."effective_at")
);
--> statement-breakpoint
CREATE TABLE "app"."funnel_intake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"client_event_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"consent_receipt_id" uuid NOT NULL,
	"event_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "funnel_intake_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "funnel_intake_request_unique" UNIQUE("visitor_id","client_event_id"),
	CONSTRAINT "funnel_intake_value_check" CHECK ("app"."funnel_intake"."client_event_id" ~ '^[A-Za-z0-9_-]{16,100}$' AND "app"."funnel_intake"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."local_ad_sink" (
	"outbox_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "local_ad_sink_event_unique" UNIQUE("event_id","platform"),
	CONSTRAINT "local_ad_sink_value_check" CHECK ("app"."local_ad_sink"."platform" IN ('meta','google','tiktok') AND "app"."local_ad_sink"."payload_hash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("app"."local_ad_sink"."payload")='object')
);
--> statement-breakpoint
CREATE TABLE "app"."order_ad_attribution" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"consent_receipt_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_allocation" (
	"event_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"merchandise_amount" bigint NOT NULL,
	CONSTRAINT "purchase_allocation_event_id_order_item_id_pk" PRIMARY KEY("event_id","order_item_id"),
	CONSTRAINT "purchase_allocation_value_check" CHECK ("app"."purchase_allocation"."quantity">0 AND "app"."purchase_allocation"."merchandise_amount" between 1 and 9007199254740991 AND "app"."purchase_allocation"."merchandise_amount"=99000::bigint*"app"."purchase_allocation"."quantity")
);
--> statement-breakpoint
CREATE TABLE "app"."visitor_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest" text NOT NULL,
	"principal_scope" text NOT NULL,
	"status" text NOT NULL,
	"activation_key" text,
	"activation_hash" text,
	"consent_revision" integer DEFAULT 0 NOT NULL,
	"current_consent_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "visitor_session_digest_unique" UNIQUE("digest"),
	CONSTRAINT "visitor_identity_check" CHECK ("app"."visitor_session"."digest" ~ '^[0-9a-f]{64}$' AND char_length("app"."visitor_session"."principal_scope") between 1 and 500 AND ("app"."visitor_session"."principal_scope"='browser' OR "app"."visitor_session"."principal_scope" LIKE 'user:%')),
	CONSTRAINT "visitor_state_check" CHECK ("app"."visitor_session"."status" IN ('preparing','active','revoked') AND "app"."visitor_session"."expires_at">"app"."visitor_session"."created_at" AND "app"."visitor_session"."consent_revision">=0 AND (("app"."visitor_session"."consent_revision"=0)=("app"."visitor_session"."current_consent_id" IS NULL)) AND (("app"."visitor_session"."status"='preparing' AND "app"."visitor_session"."activated_at" IS NULL AND "app"."visitor_session"."activation_key" IS NULL AND "app"."visitor_session"."activation_hash" IS NULL) OR ("app"."visitor_session"."status"<>'preparing' AND "app"."visitor_session"."activated_at" IS NOT NULL AND "app"."visitor_session"."activation_key" IS NOT NULL AND "app"."visitor_session"."activation_hash" IS NOT NULL AND "app"."visitor_session"."activation_key" ~ '^[A-Za-z0-9_-]{16,200}$' AND "app"."visitor_session"."activation_hash" ~ '^[0-9a-f]{64}$')))
);
--> statement-breakpoint
ALTER TABLE "app"."ad_delivery_attempt" ADD CONSTRAINT "ad_delivery_attempt_outbox_id_ad_event_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "app"."ad_event_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_event_outbox" ADD CONSTRAINT "ad_event_outbox_event_id_commerce_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ad_event_outbox" ADD CONSTRAINT "ad_event_outbox_job_id_outbox_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "app"."outbox_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_event" ADD CONSTRAINT "commerce_event_visitor_id_visitor_session_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "app"."visitor_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_event" ADD CONSTRAINT "commerce_event_consent_receipt_id_consent_receipt_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "app"."consent_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_event" ADD CONSTRAINT "commerce_event_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commerce_event" ADD CONSTRAINT "commerce_event_receipt_id_economic_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."economic_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consent_receipt" ADD CONSTRAINT "consent_receipt_visitor_id_visitor_session_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "app"."visitor_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funnel_intake" ADD CONSTRAINT "funnel_intake_visitor_id_visitor_session_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "app"."visitor_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funnel_intake" ADD CONSTRAINT "funnel_intake_consent_receipt_id_consent_receipt_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "app"."consent_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funnel_intake" ADD CONSTRAINT "funnel_intake_event_id_commerce_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_ad_sink" ADD CONSTRAINT "local_ad_sink_outbox_id_ad_event_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "app"."ad_event_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_ad_sink" ADD CONSTRAINT "local_ad_sink_event_id_commerce_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_ad_attribution" ADD CONSTRAINT "order_ad_attribution_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_ad_attribution" ADD CONSTRAINT "order_ad_attribution_visitor_id_visitor_session_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "app"."visitor_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_ad_attribution" ADD CONSTRAINT "order_ad_attribution_consent_receipt_id_consent_receipt_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "app"."consent_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_allocation" ADD CONSTRAINT "purchase_allocation_event_id_commerce_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."commerce_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_allocation" ADD CONSTRAINT "purchase_allocation_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "app"."order_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."visitor_session" ADD CONSTRAINT "visitor_session_current_consent_id_consent_receipt_id_fk" FOREIGN KEY ("current_consent_id") REFERENCES "app"."consent_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_event_status_idx" ON "app"."ad_event_outbox" USING btree ("status","recorded_at","id");--> statement-breakpoint
CREATE INDEX "commerce_event_order_idx" ON "app"."commerce_event" USING btree ("order_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_authenticated_activation_unique" ON "app"."visitor_session" USING btree ("principal_scope","activation_key") WHERE "app"."visitor_session"."principal_scope"<>'browser' AND "app"."visitor_session"."activation_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "app"."visitor_bootstrap_request" (
	"visitor_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"principal_scope" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "visitor_bootstrap_request_visitor_id_key_pk" PRIMARY KEY("visitor_id","key"),
	CONSTRAINT "visitor_bootstrap_request_value_check" CHECK ("app"."visitor_bootstrap_request"."key" ~ '^[A-Za-z0-9_-]{16,200}$' AND "app"."visitor_bootstrap_request"."request_hash" ~ '^[0-9a-f]{64}$' AND char_length("app"."visitor_bootstrap_request"."principal_scope") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "app"."visitor_bootstrap_request" ADD CONSTRAINT "visitor_bootstrap_request_visitor_id_visitor_session_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "app"."visitor_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_bootstrap_authenticated_key_unique" ON "app"."visitor_bootstrap_request" USING btree ("principal_scope","key") WHERE "app"."visitor_bootstrap_request"."principal_scope"<>'browser';
--> statement-breakpoint
CREATE FUNCTION app.valid_consent_choices(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE keys text[]; part jsonb;
BEGIN
 IF jsonb_typeof(value)<>'object' OR jsonb_typeof(value->'google_signals') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(value) key;
 IF keys IS DISTINCT FROM ARRAY['advertising_measurement','analytics','google','google_signals','marketing','meta','tiktok'] THEN RETURN false; END IF;
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(value->'google_signals') key;
 IF keys IS DISTINCT FROM ARRAY['ad_personalization','ad_storage','ad_user_data','analytics_storage'] THEN RETURN false; END IF;
 FOR part IN SELECT v FROM jsonb_each(value-'google_signals') pair(k,v) UNION ALL SELECT v FROM jsonb_each(value->'google_signals') pair(k,v) LOOP
  IF jsonb_typeof(part)<>'string' OR part#>>'{}' NOT IN ('granted','denied','unspecified') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.ad_measurement_allowed(choices jsonb, platform text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(platform IN ('meta','google','tiktok') AND choices->>'advertising_measurement'='granted' AND choices->>platform='granted',false);
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_visitor_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt app.consent_receipt%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Visitor purpose history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status NOT IN ('preparing','active') OR NEW.consent_revision<>0 OR NEW.current_consent_id IS NOT NULL
    OR NEW.created_at>clock_timestamp() OR NEW.created_at<clock_timestamp()-interval '5 seconds'
    OR NEW.expires_at>NEW.created_at+(CASE WHEN NEW.status='preparing' THEN interval '10 minutes' ELSE interval '24 hours' END)
    OR (NEW.status='active' AND NEW.activated_at IS DISTINCT FROM NEW.created_at)
    OR (NEW.principal_scope<>'browser' AND NOT EXISTS(SELECT 1 FROM app.auth_session s JOIN app.auth_user u ON u.id=s.user_id WHERE NEW.principal_scope='user:'||s.user_id||':'||s.id AND s.expires_at>clock_timestamp() AND u.email_verified))
  THEN RAISE EXCEPTION 'Visitor issuance requires current purpose and bounded wall time' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  IF (NEW.id,NEW.digest,NEW.principal_scope,NEW.created_at,NEW.recorded_at) IS DISTINCT FROM (OLD.id,OLD.digest,OLD.principal_scope,OLD.created_at,OLD.recorded_at)
   OR OLD.status='revoked' OR OLD.expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'Visitor authority cannot be relinked or revived' USING ERRCODE='23514'; END IF;
  IF OLD.status='preparing' THEN
   IF NEW.status<>'active' OR NEW.activated_at<OLD.created_at OR NEW.activated_at>clock_timestamp() OR NEW.expires_at>NEW.activated_at+interval '24 hours' OR NEW.consent_revision<>0 OR NEW.current_consent_id IS NOT NULL
   THEN RAISE EXCEPTION 'Visitor activation requires its live original nonce' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status='revoked' THEN
   IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Visitor revocation preserves its history' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO receipt FROM app.consent_receipt WHERE id=NEW.current_consent_id;
   IF (to_jsonb(NEW)-'consent_revision'-'current_consent_id') IS DISTINCT FROM (to_jsonb(OLD)-'consent_revision'-'current_consent_id')
    OR NEW.consent_revision<>OLD.consent_revision+1 OR receipt.visitor_id IS DISTINCT FROM OLD.id OR receipt.revision IS DISTINCT FROM NEW.consent_revision
   THEN RAISE EXCEPTION 'Visitor consent head advances with exact receipt' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER visitor_session_guard BEFORE INSERT OR UPDATE OR DELETE ON app.visitor_session FOR EACH ROW EXECUTE FUNCTION app.guard_visitor_session();
--> statement-breakpoint
CREATE FUNCTION app.guard_consent_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE visitor app.visitor_session%ROWTYPE;
BEGIN
 SELECT * INTO visitor FROM app.visitor_session WHERE id=NEW.visitor_id FOR UPDATE;
 IF visitor.status IS DISTINCT FROM 'active' OR visitor.expires_at<=clock_timestamp() OR NEW.revision<>visitor.consent_revision+1
  OR NEW.policy_version<>'local-privacy-v1' OR app.valid_consent_choices(NEW.choices) IS DISTINCT FROM true
  OR NEW.effective_at<clock_timestamp()-interval '5 seconds' OR NEW.effective_at>clock_timestamp() OR NEW.expires_at>visitor.expires_at OR NEW.expires_at>NEW.effective_at+interval '24 hours'
 THEN RAISE EXCEPTION 'Consent requires current own visitor, policy and exact choices' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_receipt_guard BEFORE INSERT ON app.consent_receipt FOR EACH ROW EXECUTE FUNCTION app.guard_consent_receipt();
--> statement-breakpoint
CREATE FUNCTION app.seal_visitor_consent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE visitor app.visitor_session%ROWTYPE; selected uuid; receipt app.consent_receipt%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='visitor_session' THEN selected:=NEW.id; ELSE selected:=NEW.visitor_id; END IF;
 SELECT * INTO visitor FROM app.visitor_session WHERE id=selected;
 SELECT * INTO receipt FROM app.consent_receipt WHERE id=visitor.current_consent_id;
 IF (visitor.status='active' AND NOT EXISTS(SELECT 1 FROM app.visitor_bootstrap_request WHERE visitor_id=visitor.id AND key=visitor.activation_key AND request_hash=visitor.activation_hash AND principal_scope=visitor.principal_scope))
  OR visitor.consent_revision<>(SELECT count(*) FROM app.consent_receipt WHERE visitor_id=selected)
  OR (visitor.consent_revision>0 AND (receipt.visitor_id IS DISTINCT FROM visitor.id OR receipt.revision IS DISTINCT FROM visitor.consent_revision))
 THEN RAISE EXCEPTION 'Visitor and consent history seal together' USING ERRCODE='23514'; END IF;
 IF visitor.current_consent_id IS NOT NULL AND EXISTS(SELECT 1 FROM app.ad_event_outbox o JOIN app.commerce_event e ON e.id=o.event_id WHERE e.visitor_id=visitor.id AND o.status='queued' AND NOT app.ad_measurement_allowed(receipt.choices,o.platform))
 THEN RAISE EXCEPTION 'Consent withdrawal cancels unsent optional delivery' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER visitor_consent_sealed AFTER INSERT OR UPDATE ON app.visitor_session DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_visitor_consent();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER consent_receipt_applied AFTER INSERT ON app.consent_receipt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_visitor_consent();
--> statement-breakpoint
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['consent_receipt','order_ad_attribution','commerce_event','purchase_allocation','ad_delivery_attempt','local_ad_sink','funnel_intake','visitor_bootstrap_request'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_immutable',relation);
 END LOOP;
END $$;

--> statement-breakpoint
ALTER TABLE app.funnel_intake ALTER CONSTRAINT funnel_intake_event_id_commerce_event_id_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION app.purchase_signal_payload(selected uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('currency','IDR','contents',coalesce(jsonb_agg(jsonb_build_object('id',o.catalog_id,'quantity',i.quantity,'merchandise_amount',99000::bigint*i.quantity) ORDER BY i.id),'[]'::jsonb),'content_ids',coalesce(jsonb_agg(o.catalog_id ORDER BY i.id),'[]'::jsonb))
 FROM app.order_item i JOIN app.offer o ON o.id=i.offer_id WHERE i.order_id=selected;
$$;
--> statement-breakpoint
CREATE FUNCTION app.signal_operation_payload(selected uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE operation app.commerce_operation%ROWTYPE; previous jsonb; line jsonb; old_quantity integer; quantity integer; contents jsonb:='[]'::jsonb; ids jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO operation FROM app.commerce_operation WHERE id=selected;
 IF operation.action='order.create' THEN RETURN jsonb_build_object('currency','IDR','order_id',operation.resource_id,'contents',contents,'content_ids',ids); END IF;
 IF operation.action NOT IN ('cart.create','cart.line.add','cart.line.update','cart.line.remove') THEN RETURN NULL; END IF;
 SELECT result INTO previous FROM app.commerce_operation WHERE resource_id=operation.resource_id AND action IN ('cart.create','cart.line.add','cart.line.update','cart.line.remove') AND (result->>'version')::int=(operation.result->>'version')::int-1 ORDER BY created_at DESC LIMIT 1;
 FOR line IN SELECT value FROM jsonb_array_elements(operation.result->'lines') LOOP
  SELECT (value->>'quantity')::int INTO old_quantity FROM jsonb_array_elements(coalesce(previous->'lines','[]'::jsonb)) WHERE value->>'variant_id'=line->>'variant_id';
  quantity:=greatest(0,(line->>'quantity')::int-coalesce(old_quantity,0));
  IF quantity>0 THEN contents:=contents||jsonb_build_array(jsonb_build_object('id',line->>'catalog_id','quantity',quantity,'merchandise_amount',99000::bigint*quantity));ids:=ids||jsonb_build_array(line->>'catalog_id'); END IF;
 END LOOP;
 RETURN jsonb_build_object('currency','IDR','action',operation.action,'cart_id',operation.resource_id,'contents',contents,'content_ids',ids);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_order_ad_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o app.commerce_order%ROWTYPE; v app.visitor_session%ROWTYPE; c app.consent_receipt%ROWTYPE;
BEGIN
 SELECT * INTO o FROM app.commerce_order WHERE id=NEW.order_id;
 SELECT * INTO v FROM app.visitor_session WHERE id=NEW.visitor_id FOR UPDATE;
 SELECT * INTO c FROM app.consent_receipt WHERE id=v.current_consent_id;
 IF o.status IS DISTINCT FROM 'pending' OR o.payment_status IS DISTINCT FROM 'pending' OR o.expires_at<=app.reservation_clock(o.clock_namespace)
  OR v.status IS DISTINCT FROM 'active' OR v.expires_at<=clock_timestamp() OR c.id IS DISTINCT FROM NEW.consent_receipt_id OR c.visitor_id IS DISTINCT FROM v.id OR c.expires_at<=clock_timestamp()
  OR NOT (coalesce(c.choices->>'analytics'='granted',false) OR app.ad_measurement_allowed(c.choices,'meta') OR app.ad_measurement_allowed(c.choices,'google') OR app.ad_measurement_allowed(c.choices,'tiktok'))
  OR NOT ((v.principal_scope='browser' AND o.owner_guest_id IS NOT NULL) OR (o.owner_user_id IS NOT NULL AND left(v.principal_scope,length('user:'||o.owner_user_id||':'))='user:'||o.owner_user_id||':'))
 THEN RAISE EXCEPTION 'Optional order attribution requires an eligible current independently owned context' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_ad_attribution_guard BEFORE INSERT ON app.order_ad_attribution FOR EACH ROW EXECUTE FUNCTION app.guard_order_ad_attribution();
--> statement-breakpoint
CREATE FUNCTION app.guard_commerce_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt app.economic_receipt%ROWTYPE; operation app.commerce_operation%ROWTYPE; visitor app.visitor_session%ROWTYPE; consent app.consent_receipt%ROWTYPE; expected jsonb;
BEGIN
 IF NEW.name='Purchase' THEN
  SELECT * INTO receipt FROM app.economic_receipt WHERE id=NEW.receipt_id;
  IF receipt.id IS NULL OR receipt.kind<>'prepaid' OR NEW.order_id IS DISTINCT FROM receipt.order_id OR NEW.source_reference<>receipt.id::text OR NEW.occurred_at IS DISTINCT FROM receipt.occurred_at OR NEW.merchandise_amount IS DISTINCT FROM receipt.merchandise_amount
   OR NOT EXISTS(SELECT 1 FROM app.payment_event_result r JOIN app.commerce_order o ON o.id=receipt.order_id WHERE r.receipt_id=receipt.id AND r.outcome='confirmed' AND o.payment_status='confirmed')
   OR NEW.payload IS DISTINCT FROM app.purchase_signal_payload(receipt.order_id)
  THEN RAISE EXCEPTION 'Purchase requires accepted original receipt and frozen merchandise' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO visitor FROM app.visitor_session WHERE id=NEW.visitor_id;
  SELECT * INTO consent FROM app.consent_receipt WHERE id=NEW.consent_receipt_id;
  IF visitor.status IS DISTINCT FROM 'active' OR consent.visitor_id IS DISTINCT FROM visitor.id OR consent.id IS DISTINCT FROM visitor.current_consent_id
   OR consent.effective_at>NEW.occurred_at OR consent.expires_at<=NEW.occurred_at
   OR NOT (coalesce(consent.choices->>'analytics'='granted',false) OR app.ad_measurement_allowed(consent.choices,'meta') OR app.ad_measurement_allowed(consent.choices,'google') OR app.ad_measurement_allowed(consent.choices,'tiktok'))
  THEN RAISE EXCEPTION 'Optional behavior requires captured current consent' USING ERRCODE='23514'; END IF;
  IF NEW.source_kind='commerce_operation' THEN
   SELECT * INTO operation FROM app.commerce_operation WHERE id::text=NEW.source_reference;
   expected:=app.signal_operation_payload(operation.id);
   IF expected IS NULL OR NEW.payload IS DISTINCT FROM expected OR NEW.occurred_at IS DISTINCT FROM date_trunc('milliseconds',operation.created_at)
    OR NEW.merchandise_amount IS DISTINCT FROM (SELECT coalesce(sum((value->>'merchandise_amount')::bigint),0) FROM jsonb_array_elements(expected->'contents'))
    OR (operation.action='order.create' AND (NEW.name<>'order_placed' OR NEW.order_id IS DISTINCT FROM operation.resource_id))
    OR (operation.action<>'order.create' AND (NEW.name<>'cart_changed' OR NEW.order_id IS NOT NULL))
    OR NOT ((visitor.principal_scope='browser' AND operation.actor_scope LIKE 'guest:%') OR EXISTS(SELECT 1 FROM app.auth_session s WHERE visitor.principal_scope='user:'||s.user_id||':'||s.id AND operation.actor_scope='user:'||s.user_id))
   THEN RAISE EXCEPTION 'Server funnel signal must match its actual committed operation' USING ERRCODE='23514'; END IF;
  ELSIF NEW.source_kind='browser' THEN
   IF NEW.merchandise_amount<>0 OR NOT EXISTS(SELECT 1 FROM app.funnel_intake i WHERE i.id::text=NEW.source_reference AND i.event_id=NEW.id AND i.visitor_id=NEW.visitor_id AND i.consent_receipt_id=NEW.consent_receipt_id)
    OR NEW.occurred_at<clock_timestamp()-interval '5 minutes' OR NEW.occurred_at>clock_timestamp()+interval '5 minutes'
    OR NEW.payload-'currency'-'contents'-'content_ids'-'cart_id'-'order_id'-'product_id'-'variant_id'<>'{}'::jsonb
    OR NEW.payload->>'currency' IS DISTINCT FROM 'IDR' OR NEW.payload->'contents' IS DISTINCT FROM '[]'::jsonb OR NEW.payload->'content_ids' IS DISTINCT FROM '[]'::jsonb
   THEN RAISE EXCEPTION 'Browser observation cannot manufacture economic or optimized cart truth' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.name='Purchase' AND NEW.visitor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.order_ad_attribution a JOIN app.consent_receipt c ON c.visitor_id=a.visitor_id WHERE a.order_id=NEW.order_id AND a.visitor_id=NEW.visitor_id AND a.recorded_at<=NEW.occurred_at AND c.id=NEW.consent_receipt_id AND c.effective_at<=NEW.occurred_at AND c.expires_at>NEW.occurred_at) THEN RAISE EXCEPTION 'Purchase cannot backfill optional visitor context' USING ERRCODE='23514'; END IF;
 IF NEW.consent_receipt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.consent_receipt WHERE id=NEW.consent_receipt_id AND visitor_id=NEW.visitor_id)
 THEN RAISE EXCEPTION 'Signal consent cannot cross visitors' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER commerce_event_guard BEFORE INSERT ON app.commerce_event FOR EACH ROW EXECUTE FUNCTION app.guard_commerce_event();
--> statement-breakpoint
CREATE FUNCTION app.assert_commerce_event(selected uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE event app.commerce_event%ROWTYPE;
BEGIN
 SELECT * INTO event FROM app.commerce_event WHERE id=selected;
 IF event.id IS NULL OR (SELECT count(*) FROM app.ad_event_outbox WHERE event_id=selected)<>3
  OR (SELECT count(DISTINCT platform) FROM app.ad_event_outbox WHERE event_id=selected)<>3
  OR EXISTS(SELECT 1 FROM app.ad_event_outbox o JOIN app.outbox_job j ON j.id=o.job_id WHERE o.event_id=selected AND o.status='suppressed' AND j.status<>'completed')
 THEN RAISE EXCEPTION 'Canonical signal and all platform eligibility decisions seal together' USING ERRCODE='23514'; END IF;
 IF event.name='Purchase' THEN
  IF event.merchandise_amount IS DISTINCT FROM (SELECT sum(merchandise_amount) FROM app.purchase_allocation WHERE event_id=event.id)
   OR EXISTS(SELECT 1 FROM app.purchase_allocation a JOIN app.order_item i ON i.id=a.order_item_id WHERE a.event_id=event.id AND (i.order_id<>event.order_id OR a.quantity<>i.quantity OR a.merchandise_amount<>99000::bigint*i.quantity))
   OR (SELECT count(*) FROM app.purchase_allocation WHERE event_id=event.id)<>(SELECT count(*) FROM app.order_item WHERE order_id=event.order_id)
   OR EXISTS(SELECT 1 FROM app.purchase_allocation a JOIN app.order_item i ON i.id=a.order_item_id WHERE i.order_id=event.order_id GROUP BY i.id,i.quantity HAVING sum(a.quantity)>i.quantity)
  THEN RAISE EXCEPTION 'Purchase allocations conserve original merchandise exactly once' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM app.purchase_allocation WHERE event_id=event.id) THEN RAISE EXCEPTION 'Nonfinancial observation cannot allocate purchase merchandise' USING ERRCODE='23514'; END IF;
 IF event.source_kind='browser' AND NOT EXISTS(SELECT 1 FROM app.funnel_intake WHERE event_id=event.id AND id::text=event.source_reference AND visitor_id=event.visitor_id AND consent_receipt_id=event.consent_receipt_id)
 THEN RAISE EXCEPTION 'Observed event and original intake seal together' USING ERRCODE='23514'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.seal_commerce_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid;
BEGIN
 IF TG_TABLE_NAME='commerce_event' THEN selected:=NEW.id; ELSE selected:=NEW.event_id; END IF;
 PERFORM app.assert_commerce_event(selected);RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commerce_event_sealed AFTER INSERT ON app.commerce_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_commerce_event();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER purchase_allocation_sealed AFTER INSERT ON app.purchase_allocation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_commerce_event();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ad_event_outbox_sealed AFTER INSERT ON app.ad_event_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_commerce_event();
--> statement-breakpoint
CREATE FUNCTION app.seal_funded_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid;
BEGIN
 IF NEW.outcome='confirmed' THEN
  SELECT id INTO selected FROM app.commerce_event WHERE receipt_id=NEW.receipt_id AND name='Purchase';
  PERFORM app.assert_commerce_event(selected);
 END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER funded_purchase_sealed AFTER INSERT ON app.payment_event_result DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_funded_purchase();

--> statement-breakpoint
CREATE FUNCTION app.signal_delivery_reason(selected uuid, platform text) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE event app.commerce_event%ROWTYPE; visitor app.visitor_session%ROWTYPE; captured app.consent_receipt%ROWTYPE; current_choice app.consent_receipt%ROWTYPE; wall timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO event FROM app.commerce_event WHERE id=selected;
 IF event.id IS NULL OR platform NOT IN ('meta','google','tiktok') OR event.occurred_at>wall+interval '5 seconds'
  OR NOT (event.name='Purchase' OR (event.source_kind='commerce_operation' AND event.name='cart_changed' AND jsonb_array_length(event.payload->'contents')>0 AND event.payload->>'action' IN ('cart.create','cart.line.add','cart.line.update')))
 THEN RETURN 'source_not_eligible'; END IF;
 SELECT * INTO visitor FROM app.visitor_session WHERE id=event.visitor_id;
 SELECT * INTO captured FROM app.consent_receipt WHERE id=event.consent_receipt_id;
 SELECT * INTO current_choice FROM app.consent_receipt WHERE id=visitor.current_consent_id;
 IF visitor.status IS DISTINCT FROM 'active' OR visitor.expires_at<=wall OR visitor.created_at>event.occurred_at OR visitor.expires_at<=event.occurred_at
  OR captured.visitor_id IS DISTINCT FROM visitor.id OR current_choice.visitor_id IS DISTINCT FROM visitor.id
  OR captured.policy_version IS DISTINCT FROM 'local-privacy-v1' OR current_choice.policy_version IS DISTINCT FROM 'local-privacy-v1'
  OR captured.effective_at>event.occurred_at OR captured.expires_at<=event.occurred_at OR current_choice.effective_at>wall OR current_choice.expires_at<=wall
  OR NOT app.ad_measurement_allowed(captured.choices,platform) OR NOT app.ad_measurement_allowed(current_choice.choices,platform)
 THEN RETURN 'no_consent'; END IF;
 IF event.occurred_at+interval '24 hours'<=wall THEN RETURN 'expired'; END IF;
 RETURN 'eligible';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_ad_event_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event app.commerce_event%ROWTYPE; visitor app.visitor_session%ROWTYPE; captured app.consent_receipt%ROWTYPE; reason text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Advertising decision history is retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO event FROM app.commerce_event WHERE id=NEW.event_id;
 IF event.visitor_id IS NOT NULL THEN SELECT * INTO visitor FROM app.visitor_session WHERE id=event.visitor_id FOR UPDATE; END IF;
 SELECT * INTO captured FROM app.consent_receipt WHERE id=event.consent_receipt_id;
 reason:=app.signal_delivery_reason(event.id,NEW.platform);
 IF TG_OP='INSERT' THEN
  IF NEW.status NOT IN ('queued','suppressed') OR (NEW.status='queued' AND NEW.reason<>'eligible') OR (NEW.status='suppressed' AND NEW.reason NOT IN ('no_consent','expired','unavailable_context','source_not_eligible'))
    OR NEW.expires_at>event.occurred_at+interval '24 hours' OR (visitor.id IS NOT NULL AND NEW.expires_at>visitor.expires_at)
    OR (captured.id IS NOT NULL AND NEW.expires_at>captured.expires_at)
    OR (NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.job_id AND j.kind='advertising.dispatch' AND j.dedup_key='ad-dispatch:'||NEW.id::text AND j.payload=jsonb_build_object('outboxId',NEW.id)))
  THEN RAISE EXCEPTION 'Advertising decision requires exact source and original expiry' USING ERRCODE='23514'; END IF;
  IF NEW.status='queued' AND (reason<>'eligible' OR NEW.expires_at<=clock_timestamp()) THEN
   NEW.status:='suppressed';NEW.reason:=CASE WHEN reason='eligible' THEN 'expired' ELSE reason END;
  END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-'status'-'reason') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'reason') OR OLD.status<>'queued'
   OR (NEW.status='accepted' AND (NEW.reason<>'accepted_local' OR NOT EXISTS(SELECT 1 FROM app.local_ad_sink WHERE outbox_id=OLD.id AND event_id=OLD.event_id AND platform=OLD.platform)))
   OR (NEW.status='cancelled' AND (NEW.reason NOT IN ('expired','withdrawn') OR (reason='eligible' AND OLD.expires_at>clock_timestamp())))
   OR (NEW.status='quarantined' AND (NEW.reason<>'definitive_no_effect' OR EXISTS(SELECT 1 FROM app.local_ad_sink WHERE outbox_id=OLD.id) OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=OLD.job_id AND status='processing' AND dispatched_at IS NOT NULL AND lease_until>clock_timestamp())))
   OR NEW.status NOT IN ('accepted','cancelled','quarantined')
  THEN RAISE EXCEPTION 'Advertising phase requires durable evidence and preserves identity' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ad_event_outbox_guard BEFORE INSERT OR UPDATE OR DELETE ON app.ad_event_outbox FOR EACH ROW EXECUTE FUNCTION app.guard_ad_event_outbox();
--> statement-breakpoint
CREATE FUNCTION app.guard_local_ad_sink() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event app.commerce_event%ROWTYPE; outbox app.ad_event_outbox%ROWTYPE; expected jsonb;
BEGIN
 SELECT e.* INTO event FROM app.commerce_event e JOIN app.ad_event_outbox o ON o.event_id=e.id WHERE o.id=NEW.outbox_id;
 IF event.visitor_id IS NOT NULL THEN PERFORM id FROM app.visitor_session WHERE id=event.visitor_id FOR UPDATE; END IF;
 SELECT * INTO outbox FROM app.ad_event_outbox WHERE id=NEW.outbox_id FOR UPDATE;
 expected:=jsonb_build_object('event_id',event.id,'event_name',event.name,'occurred_at',to_char(event.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'currency','IDR','value',event.merchandise_amount,'contents',event.payload->'contents','content_ids',event.payload->'content_ids');
 IF outbox.status IS DISTINCT FROM 'queued' OR outbox.event_id IS DISTINCT FROM NEW.event_id OR outbox.platform IS DISTINCT FROM NEW.platform OR NEW.payload IS DISTINCT FROM expected
  OR outbox.expires_at<=clock_timestamp() OR app.signal_delivery_reason(event.id,outbox.platform)<>'eligible'
  OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=outbox.job_id AND status='processing' AND dispatched_at IS NOT NULL AND lease_token IS NOT NULL AND lease_until>clock_timestamp())
 THEN RAISE EXCEPTION 'Local delivery requires current consent, exact canonical payload and active dispatch' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_ad_sink_guard BEFORE INSERT ON app.local_ad_sink FOR EACH ROW EXECUTE FUNCTION app.guard_local_ad_sink();
--> statement-breakpoint
CREATE FUNCTION app.guard_ad_delivery_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.outcome='accepted' AND NOT EXISTS(SELECT 1 FROM app.local_ad_sink WHERE outbox_id=NEW.outbox_id))
  OR (NEW.outcome='suppressed' AND NOT EXISTS(SELECT 1 FROM app.ad_event_outbox WHERE id=NEW.outbox_id AND status IN ('suppressed','cancelled')))
  OR (NEW.outcome='definitive_no_effect' AND (EXISTS(SELECT 1 FROM app.local_ad_sink WHERE outbox_id=NEW.outbox_id) OR NOT EXISTS(SELECT 1 FROM app.ad_event_outbox WHERE id=NEW.outbox_id AND status='quarantined')))
 THEN RAISE EXCEPTION 'Delivery attempt requires its durable known outcome' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ad_delivery_attempt_guard BEFORE INSERT ON app.ad_delivery_attempt FOR EACH ROW EXECUTE FUNCTION app.guard_ad_delivery_attempt();
--> statement-breakpoint
CREATE FUNCTION app.seal_local_ad_sink() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.ad_event_outbox WHERE id=NEW.outbox_id AND event_id=NEW.event_id AND platform=NEW.platform AND status='accepted')
  OR NOT EXISTS(SELECT 1 FROM app.ad_delivery_attempt WHERE outbox_id=NEW.outbox_id AND outcome='accepted')
 THEN RAISE EXCEPTION 'Local effect, accepted phase and delivery evidence seal together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER local_ad_sink_sealed AFTER INSERT ON app.local_ad_sink DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_local_ad_sink();
--> statement-breakpoint
CREATE FUNCTION app.guard_funnel_intake() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE visitor app.visitor_session%ROWTYPE; consent app.consent_receipt%ROWTYPE; capture boolean;
BEGIN
 SELECT * INTO visitor FROM app.visitor_session WHERE id=NEW.visitor_id FOR UPDATE;
 SELECT * INTO consent FROM app.consent_receipt WHERE id=NEW.consent_receipt_id;
 capture:=coalesce(consent.choices->>'analytics'='granted',false) OR app.ad_measurement_allowed(consent.choices,'meta') OR app.ad_measurement_allowed(consent.choices,'google') OR app.ad_measurement_allowed(consent.choices,'tiktok');
 IF visitor.status IS DISTINCT FROM 'active' OR visitor.expires_at<=clock_timestamp() OR consent.id IS DISTINCT FROM visitor.current_consent_id OR consent.visitor_id IS DISTINCT FROM visitor.id OR consent.expires_at<=clock_timestamp() OR (capture IS DISTINCT FROM (NEW.event_id IS NOT NULL))
 THEN RAISE EXCEPTION 'Observed intake requires current exact consent and preserves denied-data minimization' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER funnel_intake_guard BEFORE INSERT ON app.funnel_intake FOR EACH ROW EXECUTE FUNCTION app.guard_funnel_intake();
--> statement-breakpoint
CREATE FUNCTION app.seal_funnel_intake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.commerce_event WHERE id=NEW.event_id AND source_kind='browser' AND source_reference=NEW.id::text AND visitor_id=NEW.visitor_id AND consent_receipt_id=NEW.consent_receipt_id)
 THEN RAISE EXCEPTION 'Observed intake and captured event seal together' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER funnel_intake_sealed AFTER INSERT ON app.funnel_intake DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_funnel_intake();

--> statement-breakpoint
CREATE FUNCTION app.guard_visitor_bootstrap_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE visitor app.visitor_session%ROWTYPE;
BEGIN
 SELECT * INTO visitor FROM app.visitor_session WHERE id=NEW.visitor_id FOR UPDATE;
 IF visitor.status IS DISTINCT FROM 'active' OR visitor.expires_at<=clock_timestamp() OR NEW.principal_scope IS DISTINCT FROM visitor.principal_scope
  OR (NEW.key=visitor.activation_key AND NEW.request_hash<>visitor.activation_hash)
 THEN RAISE EXCEPTION 'Bootstrap request binds its current original visitor context' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER visitor_bootstrap_request_guard BEFORE INSERT ON app.visitor_bootstrap_request FOR EACH ROW EXECUTE FUNCTION app.guard_visitor_bootstrap_request();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER visitor_bootstrap_sealed AFTER INSERT ON app.visitor_bootstrap_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_visitor_consent();
