CREATE TABLE "app"."promotion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"configuration_revision" integer DEFAULT 0 NOT NULL,
	"budget_revision" integer DEFAULT 0 NOT NULL,
	"reserved_amount" bigint DEFAULT 0 NOT NULL,
	"committed_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "promotion_revisions_check" CHECK ("app"."promotion"."configuration_revision">=0 AND "app"."promotion"."budget_revision">=0),
	CONSTRAINT "promotion_money_check" CHECK ("app"."promotion"."reserved_amount">=0 AND "app"."promotion"."committed_amount">=0 AND "app"."promotion"."reserved_amount"::numeric+"app"."promotion"."committed_amount"::numeric<=9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_allocation" (
	"reservation_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "promotion_allocation_reservation_id_promotion_id_pk" PRIMARY KEY("reservation_id","promotion_id"),
	CONSTRAINT "promotion_allocation_value_check" CHECK ("app"."promotion_allocation"."amount" between 1 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_buyer_usage" (
	"promotion_id" uuid NOT NULL,
	"customer_key" text NOT NULL,
	"reserved_uses" integer DEFAULT 0 NOT NULL,
	"committed_uses" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "promotion_buyer_usage_promotion_id_customer_key_pk" PRIMARY KEY("promotion_id","customer_key"),
	CONSTRAINT "promotion_buyer_key_check" CHECK ("app"."promotion_buyer_usage"."customer_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "promotion_buyer_usage_check" CHECK ("app"."promotion_buyer_usage"."reserved_uses">=0 AND "app"."promotion_buyer_usage"."committed_uses">=0 AND "app"."promotion_buyer_usage"."revision">=0 AND "app"."promotion_buyer_usage"."reserved_uses"::bigint+"app"."promotion_buyer_usage"."committed_uses"::bigint<=2147483647)
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"customer_key" text NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"budget_revision" integer NOT NULL,
	"buyer_revision" integer NOT NULL,
	"reserved_delta" bigint NOT NULL,
	"committed_delta" bigint NOT NULL,
	"reserved_uses_delta" integer NOT NULL,
	"committed_uses_delta" integer NOT NULL,
	"actor_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "promotion_movement_budget_unique" UNIQUE("promotion_id","budget_revision"),
	CONSTRAINT "promotion_movement_buyer_unique" UNIQUE("promotion_id","customer_key","buyer_revision"),
	CONSTRAINT "promotion_movement_effect_unique" UNIQUE("reservation_id","promotion_id","kind"),
	CONSTRAINT "promotion_movement_value_check" CHECK ("app"."promotion_movement"."amount" between 1 and 9007199254740991 AND "app"."promotion_movement"."budget_revision">0 AND "app"."promotion_movement"."buyer_revision">0 AND char_length("app"."promotion_movement"."reason") between 1 and 500),
	CONSTRAINT "promotion_movement_delta_check" CHECK (("app"."promotion_movement"."kind"='reserve' AND "app"."promotion_movement"."reserved_delta"="app"."promotion_movement"."amount" AND "app"."promotion_movement"."committed_delta"=0 AND "app"."promotion_movement"."reserved_uses_delta"=1 AND "app"."promotion_movement"."committed_uses_delta"=0) OR ("app"."promotion_movement"."kind"='release' AND "app"."promotion_movement"."reserved_delta"=-"app"."promotion_movement"."amount" AND "app"."promotion_movement"."committed_delta"=0 AND "app"."promotion_movement"."reserved_uses_delta"=-1 AND "app"."promotion_movement"."committed_uses_delta"=0) OR ("app"."promotion_movement"."kind"='consume' AND "app"."promotion_movement"."reserved_delta"=-"app"."promotion_movement"."amount" AND "app"."promotion_movement"."committed_delta"="app"."promotion_movement"."amount" AND "app"."promotion_movement"."reserved_uses_delta"=-1 AND "app"."promotion_movement"."committed_uses_delta"=1))
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"customer_key" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"payment_method" text NOT NULL,
	"merchandise_amount" bigint NOT NULL,
	"shipping_amount" bigint NOT NULL,
	"subsidy_amount" bigint NOT NULL,
	"clock_namespace" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	CONSTRAINT "promotion_reservation_key_unique" UNIQUE("key"),
	CONSTRAINT "promotion_reservation_identity_check" CHECK ("app"."promotion_reservation"."request_hash" ~ '^[0-9a-f]{64}$' AND "app"."promotion_reservation"."customer_key" ~ '^[0-9a-f]{64}$' AND char_length("app"."promotion_reservation"."key") between 1 and 200),
	CONSTRAINT "promotion_reservation_state_check" CHECK ("app"."promotion_reservation"."status" IN ('preparing','active','released','expired','consumed') AND "app"."promotion_reservation"."payment_method" IN ('prepaid','cod')),
	CONSTRAINT "promotion_reservation_amount_check" CHECK ("app"."promotion_reservation"."merchandise_amount" between 99000 and 9007199254740991 AND "app"."promotion_reservation"."merchandise_amount"%99000=0 AND "app"."promotion_reservation"."shipping_amount" between 1 and 9007199254740991 AND "app"."promotion_reservation"."subsidy_amount">0 AND "app"."promotion_reservation"."subsidy_amount"<="app"."promotion_reservation"."shipping_amount"),
	CONSTRAINT "promotion_reservation_deadline_check" CHECK ("app"."promotion_reservation"."expires_at">"app"."promotion_reservation"."created_at" AND "app"."promotion_reservation"."expires_at"<="app"."promotion_reservation"."created_at"+interval '1 hour'),
	CONSTRAINT "promotion_reservation_resolution_check" CHECK (("app"."promotion_reservation"."status" IN ('preparing','active') AND "app"."promotion_reservation"."resolved_at" IS NULL AND "app"."promotion_reservation"."resolution_reason" IS NULL) OR ("app"."promotion_reservation"."status" IN ('released','expired','consumed') AND "app"."promotion_reservation"."resolved_at" IS NOT NULL AND "app"."promotion_reservation"."resolution_reason" IS NOT NULL AND char_length("app"."promotion_reservation"."resolution_reason") between 1 and 500))
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_reservation_item" (
	"reservation_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"product_revision" integer NOT NULL,
	"offer_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "promotion_reservation_item_reservation_id_line_id_pk" PRIMARY KEY("reservation_id","line_id"),
	CONSTRAINT "promotion_reservation_item_check" CHECK ("app"."promotion_reservation_item"."quantity" between 1 and 1000000 AND char_length("app"."promotion_reservation_item"."line_id") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_shipment" (
	"reservation_id" uuid NOT NULL,
	"shipment_id" text NOT NULL,
	"origin_warehouse_id" uuid NOT NULL,
	"shipping_fee" bigint NOT NULL,
	"service_id" text NOT NULL,
	"region_ids" text[] NOT NULL,
	CONSTRAINT "promotion_shipment_reservation_id_shipment_id_pk" PRIMARY KEY("reservation_id","shipment_id"),
	CONSTRAINT "promotion_shipment_value_check" CHECK ("app"."promotion_shipment"."shipping_fee" between 0 and 9007199254740991 AND char_length("app"."promotion_shipment"."shipment_id") between 1 and 100 AND char_length("app"."promotion_shipment"."service_id") between 1 and 100 AND cardinality("app"."promotion_shipment"."region_ids") between 1 and 10 AND array_position("app"."promotion_shipment"."region_ids",NULL) IS NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_shipment_allocation" (
	"reservation_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"shipment_id" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "promotion_shipment_allocation_reservation_id_promotion_id_shipment_id_pk" PRIMARY KEY("reservation_id","promotion_id","shipment_id"),
	CONSTRAINT "promotion_shipment_allocation_value_check" CHECK ("app"."promotion_shipment_allocation"."amount" between 1 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"name" text NOT NULL,
	"active" boolean NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"value" bigint NOT NULL,
	"maximum_per_order" bigint NOT NULL,
	"minimum_merchandise" bigint NOT NULL,
	"budget" bigint NOT NULL,
	"per_buyer_limit" integer NOT NULL,
	"payment_methods" text[] NOT NULL,
	"region_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"service_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"stacking" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "promotion_version_unique" UNIQUE("promotion_id","revision"),
	CONSTRAINT "promotion_version_identity_unique" UNIQUE("id","promotion_id"),
	CONSTRAINT "promotion_version_metadata_check" CHECK ("app"."promotion_version"."revision">0 AND char_length("app"."promotion_version"."name") between 1 and 200 AND char_length("app"."promotion_version"."reason") between 1 and 500 AND "app"."promotion_version"."starts_at"<"app"."promotion_version"."ends_at"),
	CONSTRAINT "promotion_version_money_check" CHECK ("app"."promotion_version"."value" between 0 and 9007199254740991 AND "app"."promotion_version"."maximum_per_order" between 0 and 9007199254740991 AND "app"."promotion_version"."minimum_merchandise" between 0 and 9007199254740991 AND "app"."promotion_version"."budget" between 0 and 9007199254740991),
	CONSTRAINT "promotion_version_kind_check" CHECK (("app"."promotion_version"."kind"='fixed') OR ("app"."promotion_version"."kind"='percentage' AND "app"."promotion_version"."value"<=10000)),
	CONSTRAINT "promotion_version_active_check" CHECK (NOT "app"."promotion_version"."active" OR ("app"."promotion_version"."value">0 AND "app"."promotion_version"."maximum_per_order">0 AND "app"."promotion_version"."budget">0)),
	CONSTRAINT "promotion_version_rules_check" CHECK ("app"."promotion_version"."per_buyer_limit" between 1 and 1000000 AND "app"."promotion_version"."priority" between 0 and 10000 AND "app"."promotion_version"."stacking" IN ('exclusive','allowed')),
	CONSTRAINT "promotion_version_methods_check" CHECK (cardinality("app"."promotion_version"."payment_methods") between 1 and 2 AND "app"."promotion_version"."payment_methods" <@ ARRAY['prepaid','cod']::text[] AND array_position("app"."promotion_version"."payment_methods",NULL) IS NULL),
	CONSTRAINT "promotion_version_targets_check" CHECK (cardinality("app"."promotion_version"."region_ids")<=100 AND cardinality("app"."promotion_version"."service_ids")<=100 AND array_position("app"."promotion_version"."region_ids",NULL) IS NULL AND array_position("app"."promotion_version"."service_ids",NULL) IS NULL)
);
--> statement-breakpoint
ALTER TABLE "app"."promotion_allocation" ADD CONSTRAINT "promotion_allocation_reservation_id_promotion_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."promotion_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_allocation" ADD CONSTRAINT "promotion_allocation_version_fk" FOREIGN KEY ("version_id","promotion_id") REFERENCES "app"."promotion_version"("id","promotion_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_buyer_usage" ADD CONSTRAINT "promotion_buyer_usage_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "app"."promotion"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD CONSTRAINT "promotion_movement_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "app"."promotion"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD CONSTRAINT "promotion_movement_reservation_id_promotion_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."promotion_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_movement" ADD CONSTRAINT "promotion_movement_buyer_fk" FOREIGN KEY ("promotion_id","customer_key") REFERENCES "app"."promotion_buyer_usage"("promotion_id","customer_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation" ADD CONSTRAINT "promotion_reservation_clock_namespace_local_fixture_namespace_name_fk" FOREIGN KEY ("clock_namespace") REFERENCES "app"."local_fixture_namespace"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation_item" ADD CONSTRAINT "promotion_reservation_item_reservation_id_promotion_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."promotion_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_reservation_item" ADD CONSTRAINT "promotion_reservation_offer_fk" FOREIGN KEY ("product_id","product_revision","offer_id") REFERENCES "app"."offer_revision"("product_id","revision","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_shipment" ADD CONSTRAINT "promotion_shipment_reservation_id_promotion_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."promotion_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_shipment" ADD CONSTRAINT "promotion_shipment_origin_warehouse_id_warehouse_id_fk" FOREIGN KEY ("origin_warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_shipment_allocation" ADD CONSTRAINT "promotion_shipment_parent_fk" FOREIGN KEY ("reservation_id","promotion_id") REFERENCES "app"."promotion_allocation"("reservation_id","promotion_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_shipment_allocation" ADD CONSTRAINT "promotion_shipment_fee_fk" FOREIGN KEY ("reservation_id","shipment_id") REFERENCES "app"."promotion_shipment"("reservation_id","shipment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_version" ADD CONSTRAINT "promotion_version_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "app"."promotion"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotion_reservation_expiry_idx" ON "app"."promotion_reservation" USING btree ("expires_at") WHERE "app"."promotion_reservation"."status"='active';
--> statement-breakpoint
-- Lifetime budget/quota counters only advance through immutable exact effects.
CREATE FUNCTION app.guard_promotion_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v app.promotion_version; m app.promotion_movement;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Promotion identity is permanent' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.configuration_revision<>0 OR NEW.budget_revision<>0 OR NEW.reserved_amount<>0 OR NEW.committed_amount<>0 THEN
      RAISE EXCEPTION 'Promotion starts empty' USING ERRCODE='23514'; END IF;
    NEW.created_at:=clock_timestamp(); RETURN NEW;
  END IF;
  IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Immutable promotion identity' USING ERRCODE='23514'; END IF;
  IF NEW.configuration_revision=OLD.configuration_revision+1 AND NEW.budget_revision=OLD.budget_revision
    AND NEW.reserved_amount=OLD.reserved_amount AND NEW.committed_amount=OLD.committed_amount THEN
    SELECT * INTO v FROM app.promotion_version WHERE promotion_id=NEW.id AND revision=NEW.configuration_revision;
    IF v.id IS NULL OR v.budget::numeric<NEW.reserved_amount::numeric+NEW.committed_amount::numeric THEN
      RAISE EXCEPTION 'Unfunded promotion configuration' USING ERRCODE='23514'; END IF;
  ELSIF NEW.configuration_revision=OLD.configuration_revision AND NEW.budget_revision=OLD.budget_revision+1 THEN
    SELECT * INTO m FROM app.promotion_movement WHERE promotion_id=NEW.id AND budget_revision=NEW.budget_revision;
    IF m.id IS NULL OR NEW.reserved_amount::numeric<>OLD.reserved_amount::numeric+m.reserved_delta::numeric
      OR NEW.committed_amount::numeric<>OLD.committed_amount::numeric+m.committed_delta::numeric THEN
      RAISE EXCEPTION 'Promotion counter requires exact movement' USING ERRCODE='23514'; END IF;
    SELECT * INTO v FROM app.promotion_version WHERE promotion_id=NEW.id AND revision=NEW.configuration_revision;
    IF NEW.reserved_amount::numeric+NEW.committed_amount::numeric>v.budget THEN RAISE EXCEPTION 'Campaign budget exceeded' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid promotion head transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER promotion_head_guard BEFORE INSERT OR UPDATE OR DELETE ON app.promotion FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_head();
--> statement-breakpoint
CREATE FUNCTION app.guard_promotion_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h app.promotion;
BEGIN
  SELECT * INTO h FROM app.promotion WHERE id=NEW.promotion_id FOR UPDATE;
  IF NEW.revision<>h.configuration_revision+1 OR NEW.budget::numeric<h.reserved_amount::numeric+h.committed_amount::numeric THEN
    RAISE EXCEPTION 'Invalid promotion configuration revision or budget' USING ERRCODE='23514'; END IF;
  IF cardinality(NEW.payment_methods)<>(SELECT count(DISTINCT x) FROM unnest(NEW.payment_methods) x) THEN RAISE EXCEPTION 'Duplicate payment methods' USING ERRCODE='23514'; END IF;
  IF cardinality(NEW.region_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.region_ids) x)
    OR cardinality(NEW.service_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.service_ids) x)
    OR EXISTS(SELECT 1 FROM unnest(NEW.region_ids||NEW.service_ids) x WHERE x !~ '^[A-Za-z0-9_-]{1,100}$') THEN
    RAISE EXCEPTION 'Invalid promotion targets' USING ERRCODE='23514'; END IF;
  IF NEW.active AND NEW.ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'Active campaign already ended' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER promotion_version_guard BEFORE INSERT ON app.promotion_version FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_version();
--> statement-breakpoint
CREATE TRIGGER promotion_version_immutable BEFORE UPDATE OR DELETE ON app.promotion_version FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.seal_promotion_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid;
BEGIN
  IF TG_TABLE_NAME='promotion' THEN selected:=NEW.id; ELSE selected:=NEW.promotion_id; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.promotion p JOIN app.promotion_version v ON v.promotion_id=p.id AND v.revision=p.configuration_revision WHERE p.id=selected)
    OR EXISTS(SELECT 1 FROM app.promotion_version v JOIN app.promotion p ON p.id=v.promotion_id WHERE p.id=selected AND v.revision>p.configuration_revision) THEN
    RAISE EXCEPTION 'Unsealed promotion configuration' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER promotion_configuration_sealed AFTER INSERT OR UPDATE ON app.promotion DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_promotion_configuration();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER promotion_version_sealed AFTER INSERT ON app.promotion_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_promotion_configuration();
--> statement-breakpoint
CREATE FUNCTION app.guard_promotion_buyer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m app.promotion_movement;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Quota history is permanent' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.reserved_uses<>0 OR NEW.committed_uses<>0 OR NEW.revision<>0 THEN RAISE EXCEPTION 'Quota starts empty' USING ERRCODE='23514'; END IF; RETURN NEW;
  END IF;
  SELECT * INTO m FROM app.promotion_movement WHERE promotion_id=NEW.promotion_id AND customer_key=NEW.customer_key AND buyer_revision=NEW.revision;
  IF NEW.promotion_id<>OLD.promotion_id OR NEW.customer_key<>OLD.customer_key OR NEW.revision<>OLD.revision+1 OR m.id IS NULL
    OR NEW.reserved_uses<>OLD.reserved_uses+m.reserved_uses_delta OR NEW.committed_uses<>OLD.committed_uses+m.committed_uses_delta THEN
    RAISE EXCEPTION 'Quota requires exact movement' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER promotion_buyer_guard BEFORE INSERT OR UPDATE OR DELETE ON app.promotion_buyer_usage FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_buyer();
--> statement-breakpoint
CREATE FUNCTION app.guard_promotion_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h app.promotion; b app.promotion_buyer_usage; r app.promotion_reservation; a app.promotion_allocation; v app.promotion_version;
BEGIN
  SELECT * INTO h FROM app.promotion WHERE id=NEW.promotion_id FOR UPDATE;
  SELECT * INTO b FROM app.promotion_buyer_usage WHERE promotion_id=NEW.promotion_id AND customer_key=NEW.customer_key FOR UPDATE;
  SELECT * INTO r FROM app.promotion_reservation WHERE id=NEW.reservation_id;
  SELECT * INTO a FROM app.promotion_allocation WHERE reservation_id=r.id AND promotion_id=NEW.promotion_id;
  SELECT * INTO v FROM app.promotion_version WHERE promotion_id=h.id AND revision=h.configuration_revision;
  IF h.id IS NULL OR b.promotion_id IS NULL OR a.promotion_id IS NULL OR NEW.amount<>a.amount OR NEW.customer_key<>r.customer_key
    OR NEW.budget_revision<>h.budget_revision+1 OR NEW.buyer_revision<>b.revision+1
    OR (NEW.kind='reserve' AND (r.status<>'preparing' OR b.reserved_uses::bigint+b.committed_uses::bigint>=v.per_buyer_limit))
    OR (NEW.kind IN ('release','consume') AND (r.status<>'active' OR NOT EXISTS(SELECT 1 FROM app.promotion_movement WHERE reservation_id=r.id AND promotion_id=h.id AND kind='reserve'))) THEN
    RAISE EXCEPTION 'Invalid budget/quota effect' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER promotion_movement_guard BEFORE INSERT ON app.promotion_movement FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_movement();
--> statement-breakpoint
CREATE TRIGGER promotion_movement_immutable BEFORE UPDATE OR DELETE ON app.promotion_movement FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.seal_promotion_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.promotion p JOIN app.promotion_buyer_usage b ON b.promotion_id=p.id AND b.customer_key=NEW.customer_key
    WHERE p.id=NEW.promotion_id AND p.budget_revision>=NEW.budget_revision AND b.revision>=NEW.buyer_revision)
    OR NOT EXISTS(SELECT 1 FROM app.promotion_reservation r WHERE r.id=NEW.reservation_id AND
      ((NEW.kind='reserve' AND r.status<>'preparing') OR (NEW.kind='release' AND r.status IN ('released','expired')) OR (NEW.kind='consume' AND r.status='consumed'))) THEN
    RAISE EXCEPTION 'Unapplied promotion movement' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER promotion_movement_applied AFTER INSERT ON app.promotion_movement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_promotion_movement();
--> statement-breakpoint
CREATE FUNCTION app.guard_promotion_part() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.promotion_reservation WHERE id=NEW.reservation_id AND status='preparing') THEN
    RAISE EXCEPTION 'Promotion snapshot sealed' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER promotion_item_insert BEFORE INSERT ON app.promotion_reservation_item FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_part();
--> statement-breakpoint
CREATE TRIGGER promotion_item_immutable BEFORE UPDATE OR DELETE ON app.promotion_reservation_item FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE TRIGGER promotion_shipment_insert BEFORE INSERT ON app.promotion_shipment FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_part();
--> statement-breakpoint
CREATE TRIGGER promotion_shipment_immutable BEFORE UPDATE OR DELETE ON app.promotion_shipment FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE TRIGGER promotion_allocation_insert BEFORE INSERT ON app.promotion_allocation FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_part();
--> statement-breakpoint
CREATE TRIGGER promotion_allocation_immutable BEFORE UPDATE OR DELETE ON app.promotion_allocation FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE TRIGGER promotion_shipment_allocation_insert BEFORE INSERT ON app.promotion_shipment_allocation FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_part();
--> statement-breakpoint
CREATE TRIGGER promotion_shipment_allocation_immutable BEFORE UPDATE OR DELETE ON app.promotion_shipment_allocation FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
-- Independent exact integer allocation oracle. No floating point or client totals.
CREATE FUNCTION app.expected_promotion_allocations(selected uuid)
RETURNS TABLE(promotion_id uuid,shipment_id text,amount bigint) LANGUAGE plpgsql AS $$
DECLARE r app.promotion_reservation; rule record; allocation record; remaining jsonb; total numeric; benefit numeric;
BEGIN
  SELECT * INTO r FROM app.promotion_reservation WHERE id=selected;
  SELECT jsonb_object_agg(s.shipment_id,s.shipping_fee) INTO remaining FROM app.promotion_shipment s WHERE s.reservation_id=selected;
  FOR rule IN SELECT v.* FROM app.promotion_allocation a JOIN app.promotion_version v ON v.id=a.version_id
    WHERE a.reservation_id=selected ORDER BY v.priority DESC,v.promotion_id LOOP
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
CREATE FUNCTION app.guard_promotion_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
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
    SELECT sum(a.amount::numeric),count(*) INTO expected,n FROM app.promotion_allocation a WHERE a.reservation_id=NEW.id;
    IF n=0 OR expected<>NEW.subsidy_amount OR EXISTS(SELECT 1 FROM app.promotion_allocation a JOIN app.promotion p ON p.id=a.promotion_id
      JOIN app.promotion_version v ON v.id=a.version_id WHERE a.reservation_id=NEW.id AND (v.revision<>p.configuration_revision OR
      (n>1 AND v.stacking='exclusive') OR NOT EXISTS(SELECT 1 FROM app.promotion_movement m WHERE m.reservation_id=NEW.id AND m.promotion_id=a.promotion_id AND m.kind='reserve' AND m.amount=a.amount))) THEN
      RAISE EXCEPTION 'Invalid promotion allocation/effects' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM ((SELECT * FROM app.expected_promotion_allocations(NEW.id) EXCEPT SELECT promotion_id,shipment_id,amount FROM app.promotion_shipment_allocation WHERE reservation_id=NEW.id)
      UNION ALL (SELECT promotion_id,shipment_id,amount FROM app.promotion_shipment_allocation WHERE reservation_id=NEW.id EXCEPT SELECT * FROM app.expected_promotion_allocations(NEW.id))) mismatch)
      OR EXISTS(SELECT 1 FROM app.promotion_allocation a WHERE a.reservation_id=NEW.id AND a.amount<>(SELECT coalesce(sum(s.amount::numeric),0) FROM app.promotion_shipment_allocation s WHERE s.reservation_id=a.reservation_id AND s.promotion_id=a.promotion_id)) THEN
      RAISE EXCEPTION 'Incorrect deterministic shipment allocation' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='active' AND NEW.status IN ('released','expired','consumed') THEN
    IF NEW.resolved_at IS DISTINCT FROM business_now AND (NEW.resolved_at>business_now OR NEW.resolved_at<business_now-interval '5 seconds') THEN
      RAISE EXCEPTION 'Invalid resolution time' USING ERRCODE='23514'; END IF;
    IF (NEW.status='expired' AND NEW.expires_at>business_now) OR (NEW.status='consumed' AND NEW.expires_at<=business_now)
      OR EXISTS(SELECT 1 FROM app.promotion_allocation a WHERE a.reservation_id=NEW.id AND NOT EXISTS(SELECT 1 FROM app.promotion_movement m
      WHERE m.reservation_id=NEW.id AND m.promotion_id=a.promotion_id AND m.kind=CASE WHEN NEW.status='consumed' THEN 'consume' ELSE 'release' END AND m.amount=a.amount)) THEN
      RAISE EXCEPTION 'Invalid terminal reservation/effects' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER promotion_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON app.promotion_reservation FOR EACH ROW EXECUTE FUNCTION app.guard_promotion_reservation();
--> statement-breakpoint
CREATE FUNCTION app.seal_promotion_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM app.promotion_reservation WHERE id=NEW.id AND status='preparing') THEN RAISE EXCEPTION 'Unsealed promotion reservation' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER promotion_reservation_sealed AFTER INSERT ON app.promotion_reservation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_promotion_reservation();
