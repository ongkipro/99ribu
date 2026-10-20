CREATE TABLE "app"."component_cost_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"unit_cost" integer,
	"effective_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "component_cost_revision_unique" UNIQUE("stock_item_id","revision"),
	CONSTRAINT "component_cost_identity_unique" UNIQUE("id","stock_item_id"),
	CONSTRAINT "component_cost_value_check" CHECK ("app"."component_cost_version"."revision">0 AND ("app"."component_cost_version"."unit_cost" IS NULL OR "app"."component_cost_version"."unit_cost">=0)),
	CONSTRAINT "component_cost_reason_check" CHECK (char_length("app"."component_cost_version"."source") between 1 and 500 AND char_length("app"."component_cost_version"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."offer_cost_assumption_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"packaging_idr" integer,
	"provider_fee_idr" integer,
	"subsidy_idr" integer,
	"returns_reserve_idr" integer,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "offer_assumption_revision_unique" UNIQUE("offer_id","revision"),
	CONSTRAINT "offer_assumption_identity_unique" UNIQUE("id","offer_id"),
	CONSTRAINT "offer_assumption_value_check" CHECK ("app"."offer_cost_assumption_version"."revision">0 AND ("app"."offer_cost_assumption_version"."packaging_idr" IS NULL OR "app"."offer_cost_assumption_version"."packaging_idr">=0) AND ("app"."offer_cost_assumption_version"."provider_fee_idr" IS NULL OR "app"."offer_cost_assumption_version"."provider_fee_idr">=0) AND ("app"."offer_cost_assumption_version"."subsidy_idr" IS NULL OR "app"."offer_cost_assumption_version"."subsidy_idr">=0) AND ("app"."offer_cost_assumption_version"."returns_reserve_idr" IS NULL OR "app"."offer_cost_assumption_version"."returns_reserve_idr">=0)),
	CONSTRAINT "offer_assumption_reason_check" CHECK (char_length("app"."offer_cost_assumption_version"."source") between 1 and 500 AND char_length("app"."offer_cost_assumption_version"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "app"."publication_component_cost" (
	"publication_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"cost_version_id" uuid,
	CONSTRAINT "publication_component_cost_publication_id_offer_id_stock_item_id_pk" PRIMARY KEY("publication_id","offer_id","stock_item_id"),
	CONSTRAINT "publication_component_quantity_check" CHECK ("app"."publication_component_cost"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "app"."publication_head" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "publication_head_revision_check" CHECK ("app"."publication_head"."revision">=0)
);
--> statement-breakpoint
CREATE TABLE "app"."publication_offer" (
	"publication_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_revision" integer NOT NULL,
	"offer_id" uuid NOT NULL,
	"assumption_version_id" uuid,
	"estimated_hpp" bigint,
	"estimated_contribution" bigint,
	"complete" boolean NOT NULL,
	CONSTRAINT "publication_offer_publication_id_offer_id_pk" PRIMARY KEY("publication_id","offer_id"),
	CONSTRAINT "publication_offer_amount_check" CHECK (("app"."publication_offer"."estimated_hpp" IS NULL OR "app"."publication_offer"."estimated_hpp" between 0 and 9007199254740991) AND ("app"."publication_offer"."estimated_contribution" IS NULL OR "app"."publication_offer"."estimated_contribution" between -9007199254740991 and 99000)),
	CONSTRAINT "publication_offer_complete_check" CHECK (("app"."publication_offer"."complete" AND "app"."publication_offer"."estimated_hpp" IS NOT NULL AND "app"."publication_offer"."estimated_contribution" IS NOT NULL) OR (NOT "app"."publication_offer"."complete" AND "app"."publication_offer"."estimated_contribution" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."publication_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"product_revision" integer NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"minimum_contribution_idr" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"exception_reason" text,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "publication_version_unique" UNIQUE("product_id","revision"),
	CONSTRAINT "publication_identity_unique" UNIQUE("id","product_id","product_revision"),
	CONSTRAINT "publication_version_value_check" CHECK ("app"."publication_version"."revision">0 AND "app"."publication_version"."product_revision">0 AND "app"."publication_version"."minimum_contribution_idr" between 0 and 99000 AND "app"."publication_version"."commission_bps" between 0 and 10000),
	CONSTRAINT "publication_reason_check" CHECK (char_length("app"."publication_version"."reason") between 1 and 500 AND ("app"."publication_version"."exception_reason" IS NULL OR char_length("app"."publication_version"."exception_reason") between 1 and 500))
);
--> statement-breakpoint
ALTER TABLE "app"."component_cost_version" ADD CONSTRAINT "component_cost_version_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer_cost_assumption_version" ADD CONSTRAINT "offer_cost_assumption_version_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "app"."offer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_component_cost" ADD CONSTRAINT "publication_component_cost_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_component_cost" ADD CONSTRAINT "publication_component_offer_fk" FOREIGN KEY ("publication_id","offer_id") REFERENCES "app"."publication_offer"("publication_id","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_component_cost" ADD CONSTRAINT "publication_component_cost_fk" FOREIGN KEY ("cost_version_id","stock_item_id") REFERENCES "app"."component_cost_version"("id","stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_head" ADD CONSTRAINT "publication_head_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_offer" ADD CONSTRAINT "publication_offer_parent_fk" FOREIGN KEY ("publication_id","product_id","product_revision") REFERENCES "app"."publication_version"("id","product_id","product_revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_offer" ADD CONSTRAINT "publication_offer_definition_fk" FOREIGN KEY ("product_id","product_revision","offer_id") REFERENCES "app"."offer_revision"("product_id","revision","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_offer" ADD CONSTRAINT "publication_offer_assumption_fk" FOREIGN KEY ("assumption_version_id","offer_id") REFERENCES "app"."offer_cost_assumption_version"("id","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_version" ADD CONSTRAINT "publication_version_product_id_publication_head_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."publication_head"("product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_version" ADD CONSTRAINT "publication_version_policy_version_id_policy_version_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "app"."policy_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."publication_version" ADD CONSTRAINT "publication_product_revision_fk" FOREIGN KEY ("product_id","product_revision") REFERENCES "app"."product_revision"("product_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "component_cost_effective_idx" ON "app"."component_cost_version" USING btree ("stock_item_id","effective_at","revision");--> statement-breakpoint
CREATE INDEX "offer_assumption_effective_idx" ON "app"."offer_cost_assumption_version" USING btree ("offer_id","effective_at","revision");
--> statement-breakpoint
CREATE FUNCTION app.guard_prospective_cost_append() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_revision integer; last_effective timestamptz; accepted_at timestamptz;
BEGIN
  IF TG_TABLE_NAME='component_cost_version' THEN
    PERFORM id FROM app.stock_item WHERE id=NEW.stock_item_id FOR UPDATE;
    SELECT revision,effective_at INTO last_revision,last_effective FROM app.component_cost_version
      WHERE stock_item_id=NEW.stock_item_id ORDER BY revision DESC LIMIT 1;
  ELSE
    PERFORM id FROM app.offer WHERE id=NEW.offer_id FOR UPDATE;
    SELECT revision,effective_at INTO last_revision,last_effective FROM app.offer_cost_assumption_version
      WHERE offer_id=NEW.offer_id ORDER BY revision DESC LIMIT 1;
  END IF;
  accepted_at:=clock_timestamp();
  IF NEW.revision<>coalesce(last_revision,0)+1 THEN
    RAISE EXCEPTION 'Cost revision must append to the locked identity' USING ERRCODE='23514';
  END IF;
  NEW.effective_at:=coalesce(NEW.effective_at,accepted_at);
  IF NEW.effective_at<accepted_at OR NEW.effective_at>accepted_at+interval '366 days' THEN
    RAISE EXCEPTION 'Cost effective time must be prospective and bounded' USING ERRCODE='22007';
  END IF;
  IF last_effective IS NOT NULL AND NEW.effective_at<last_effective THEN
    RAISE EXCEPTION 'Cost schedule cannot reverse' USING ERRCODE='23514';
  END IF;
  NEW.created_at:=accepted_at;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER component_cost_append BEFORE INSERT ON app.component_cost_version
FOR EACH ROW EXECUTE FUNCTION app.guard_prospective_cost_append();
--> statement-breakpoint
CREATE TRIGGER offer_assumption_append BEFORE INSERT ON app.offer_cost_assumption_version
FOR EACH ROW EXECUTE FUNCTION app.guard_prospective_cost_append();
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['component_cost_version','offer_cost_assumption_version','publication_version','publication_offer','publication_component_cost'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',relation||'_history_immutable',relation);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_publication_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Publication heads preserve history' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>0 THEN RAISE EXCEPTION 'Publication heads start empty' USING ERRCODE='23514'; END IF;
  ELSIF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS (
    SELECT 1 FROM app.publication_version WHERE product_id=NEW.product_id AND revision=NEW.revision
  ) THEN RAISE EXCEPTION 'Publication head advances with its immutable version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER publication_head_guard BEFORE INSERT OR UPDATE OR DELETE ON app.publication_head
FOR EACH ROW EXECUTE FUNCTION app.guard_publication_head();
--> statement-breakpoint
CREATE FUNCTION app.guard_publication_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_product integer; current_publication integer;
BEGIN
  SELECT revision INTO current_product FROM app.product WHERE id=NEW.product_id FOR UPDATE;
  SELECT revision INTO current_publication FROM app.publication_head WHERE product_id=NEW.product_id FOR UPDATE;
  IF current_product IS DISTINCT FROM NEW.product_revision OR current_publication IS NULL OR NEW.revision<>current_publication+1 THEN
    RAISE EXCEPTION 'Publication requires the locked current draft and next publication revision' USING ERRCODE='23514';
  END IF;
  IF NEW.evaluated_at<transaction_timestamp() OR NEW.evaluated_at>clock_timestamp() THEN
    RAISE EXCEPTION 'Publication evaluation uses current server time' USING ERRCODE='22007';
  END IF;
  IF NEW.exception_reason IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.role_grant WHERE user_id=NEW.actor_id AND 'owner'=ANY(roles)
  ) THEN RAISE EXCEPTION 'Publication financial exception requires its actual owner' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER publication_version_guard BEFORE INSERT ON app.publication_version
FOR EACH ROW EXECUTE FUNCTION app.guard_publication_version();
--> statement-breakpoint
CREATE FUNCTION app.guard_publication_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot_revision integer; head_revision integer;
BEGIN
  SELECT v.revision,h.revision INTO snapshot_revision,head_revision FROM app.publication_version v
    JOIN app.publication_head h ON h.product_id=v.product_id WHERE v.id=NEW.publication_id FOR UPDATE OF h;
  IF snapshot_revision IS NULL OR head_revision>=snapshot_revision THEN
    RAISE EXCEPTION 'Publication snapshot parts seal with their head' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER publication_offer_append BEFORE INSERT ON app.publication_offer
FOR EACH ROW EXECUTE FUNCTION app.guard_publication_part();
--> statement-breakpoint
CREATE TRIGGER publication_component_append BEFORE INSERT ON app.publication_component_cost
FOR EACH ROW EXECUTE FUNCTION app.guard_publication_part();
--> statement-breakpoint
CREATE FUNCTION app.check_publication_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_row app.policy_version%ROWTYPE; offer_row app.publication_offer%ROWTYPE;
  assumption app.offer_cost_assumption_version%ROWTYPE; missing_hpp boolean; hpp numeric; contribution numeric; all_known boolean;
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
    all_known:=hpp IS NOT NULL AND assumption.id IS NOT NULL AND assumption.packaging_idr IS NOT NULL
      AND assumption.provider_fee_idr IS NOT NULL AND assumption.subsidy_idr IS NOT NULL AND assumption.returns_reserve_idr IS NOT NULL;
    contribution:=CASE WHEN all_known THEN 99000-hpp-assumption.packaging_idr-assumption.provider_fee_idr-assumption.subsidy_idr-assumption.returns_reserve_idr
      -floor((99000::numeric*NEW.commission_bps+5000)/10000) ELSE NULL END;
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
CREATE CONSTRAINT TRIGGER publication_sealed AFTER INSERT ON app.publication_version
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_publication_sealed();
