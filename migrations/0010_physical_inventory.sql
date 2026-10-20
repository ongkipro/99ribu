CREATE TABLE "app"."inventory_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"lot_id" uuid,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"quarantined" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_balance_scope_unique" UNIQUE NULLS NOT DISTINCT("warehouse_id","stock_item_id","lot_id"),
	CONSTRAINT "inventory_balance_quantities_check" CHECK ("app"."inventory_balance"."on_hand">=0 AND "app"."inventory_balance"."reserved">=0 AND "app"."inventory_balance"."quarantined">=0 AND "app"."inventory_balance"."reserved"::bigint+"app"."inventory_balance"."quarantined"::bigint<="app"."inventory_balance"."on_hand"::bigint),
	CONSTRAINT "inventory_balance_revision_check" CHECK ("app"."inventory_balance"."revision">=0)
);
--> statement-breakpoint
CREATE TABLE "app"."inventory_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"expires_on" date,
	"origin_warehouse_id" uuid NOT NULL,
	CONSTRAINT "inventory_lot_code_unique" UNIQUE("stock_item_id","code"),
	CONSTRAINT "inventory_lot_stock_identity_unique" UNIQUE("stock_item_id","id"),
	CONSTRAINT "inventory_lot_code_check" CHECK (char_length("app"."inventory_lot"."code") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "app"."stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"on_hand_delta" integer NOT NULL,
	"reserved_delta" integer NOT NULL,
	"quarantined_delta" integer NOT NULL,
	"source_ref" text NOT NULL,
	"actor_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_revision_unique" UNIQUE("balance_id","revision"),
	CONSTRAINT "stock_movement_effect_unique" UNIQUE("balance_id","kind","source_ref"),
	CONSTRAINT "stock_movement_quantity_check" CHECK ("app"."stock_movement"."quantity">0 AND "app"."stock_movement"."revision">0),
	CONSTRAINT "stock_movement_kind_check" CHECK ("app"."stock_movement"."kind" IN ('receive','adjust_up','adjust_down','quarantine','release_quarantine','write_off','reserve','release','consume','transfer_out','transfer_in')),
	CONSTRAINT "stock_movement_reason_check" CHECK (char_length("app"."stock_movement"."reason") between 1 and 500 AND char_length("app"."stock_movement"."source_ref") between 1 and 200),
	CONSTRAINT "stock_movement_delta_check" CHECK (
    ("app"."stock_movement"."kind" IN ('receive','transfer_in') AND "app"."stock_movement"."on_hand_delta"="app"."stock_movement"."quantity" AND "app"."stock_movement"."reserved_delta"=0 AND "app"."stock_movement"."quarantined_delta" between 0 and "app"."stock_movement"."quantity") OR
    ("app"."stock_movement"."kind"='adjust_up' AND "app"."stock_movement"."on_hand_delta"="app"."stock_movement"."quantity" AND "app"."stock_movement"."reserved_delta"=0 AND "app"."stock_movement"."quarantined_delta"=0) OR
    ("app"."stock_movement"."kind"='adjust_down' AND "app"."stock_movement"."on_hand_delta"=-"app"."stock_movement"."quantity" AND "app"."stock_movement"."reserved_delta"=0 AND "app"."stock_movement"."quarantined_delta"=0) OR
    ("app"."stock_movement"."kind"='quarantine' AND "app"."stock_movement"."on_hand_delta"=0 AND "app"."stock_movement"."reserved_delta"=0 AND "app"."stock_movement"."quarantined_delta"="app"."stock_movement"."quantity") OR
    ("app"."stock_movement"."kind"='release_quarantine' AND "app"."stock_movement"."on_hand_delta"=0 AND "app"."stock_movement"."reserved_delta"=0 AND "app"."stock_movement"."quarantined_delta"=-"app"."stock_movement"."quantity") OR
    ("app"."stock_movement"."kind"='write_off' AND "app"."stock_movement"."on_hand_delta"=-"app"."stock_movement"."quantity" AND "app"."stock_movement"."reserved_delta"=0 AND "app"."stock_movement"."quarantined_delta"=-"app"."stock_movement"."quantity") OR
    ("app"."stock_movement"."kind"='reserve' AND "app"."stock_movement"."on_hand_delta"=0 AND "app"."stock_movement"."reserved_delta"="app"."stock_movement"."quantity" AND "app"."stock_movement"."quarantined_delta"=0) OR
    ("app"."stock_movement"."kind"='release' AND "app"."stock_movement"."on_hand_delta"=0 AND "app"."stock_movement"."reserved_delta"=-"app"."stock_movement"."quantity" AND "app"."stock_movement"."quarantined_delta"=0) OR
    ("app"."stock_movement"."kind" IN ('consume','transfer_out') AND "app"."stock_movement"."on_hand_delta"=-"app"."stock_movement"."quantity" AND "app"."stock_movement"."reserved_delta"=-"app"."stock_movement"."quantity" AND "app"."stock_movement"."quarantined_delta"=0))
);
--> statement-breakpoint
CREATE TABLE "app"."stock_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"expires_at" timestamp with time zone,
	"clock_namespace" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	CONSTRAINT "stock_reservation_key_unique" UNIQUE("key"),
	CONSTRAINT "stock_reservation_hash_check" CHECK ("app"."stock_reservation"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "stock_reservation_kind_check" CHECK (("app"."stock_reservation"."kind"='checkout' AND "app"."stock_reservation"."expires_at" IS NOT NULL AND "app"."stock_reservation"."expires_at">"app"."stock_reservation"."created_at") OR ("app"."stock_reservation"."kind"='transfer' AND "app"."stock_reservation"."expires_at" IS NULL)),
	CONSTRAINT "stock_reservation_status_check" CHECK ("app"."stock_reservation"."status" IN ('preparing','active','released','expired','consumed')),
	CONSTRAINT "stock_reservation_resolution_check" CHECK (("app"."stock_reservation"."status" IN ('preparing','active') AND "app"."stock_reservation"."resolved_at" IS NULL AND "app"."stock_reservation"."resolution_reason" IS NULL) OR ("app"."stock_reservation"."status" IN ('released','expired','consumed') AND "app"."stock_reservation"."resolved_at" IS NOT NULL AND "app"."stock_reservation"."resolution_reason" IS NOT NULL AND char_length("app"."stock_reservation"."resolution_reason") between 1 and 500))
);
--> statement-breakpoint
CREATE TABLE "app"."stock_reservation_component" (
	"reservation_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "stock_reservation_component_reservation_id_balance_id_pk" PRIMARY KEY("reservation_id","balance_id"),
	CONSTRAINT "stock_reservation_component_quantity_check" CHECK ("app"."stock_reservation_component"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "app"."stock_reservation_item" (
	"reservation_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"product_revision" integer NOT NULL,
	"offer_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"offer_quantity" integer NOT NULL,
	CONSTRAINT "stock_reservation_item_reservation_id_line_id_pk" PRIMARY KEY("reservation_id","line_id"),
	CONSTRAINT "stock_reservation_item_quantity_check" CHECK ("app"."stock_reservation_item"."offer_quantity">0 AND char_length("app"."stock_reservation_item"."line_id") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "app"."transfer_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"received_quantity" integer NOT NULL,
	"quarantined_quantity" integer NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_receipt_revision_unique" UNIQUE("transfer_id","revision"),
	CONSTRAINT "transfer_receipt_quantity_check" CHECK ("app"."transfer_receipt"."revision">1 AND "app"."transfer_receipt"."received_quantity">=0 AND "app"."transfer_receipt"."quarantined_quantity">=0 AND "app"."transfer_receipt"."quarantined_quantity"<="app"."transfer_receipt"."received_quantity")
);
--> statement-breakpoint
CREATE TABLE "app"."transfer_receipt_component" (
	"receipt_id" uuid NOT NULL,
	"source_balance_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"quarantined_quantity" integer NOT NULL,
	CONSTRAINT "transfer_receipt_component_receipt_id_source_balance_id_pk" PRIMARY KEY("receipt_id","source_balance_id"),
	CONSTRAINT "transfer_receipt_component_quantity_check" CHECK ("app"."transfer_receipt_component"."quantity">0 AND "app"."transfer_receipt_component"."quarantined_quantity">=0 AND "app"."transfer_receipt_component"."quarantined_quantity"<="app"."transfer_receipt_component"."quantity")
);
--> statement-breakpoint
CREATE TABLE "app"."warehouse_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"quarantined_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_transfer_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "warehouse_transfer_quantity_check" CHECK ("app"."warehouse_transfer"."quantity">0 AND "app"."warehouse_transfer"."received_quantity">=0 AND "app"."warehouse_transfer"."received_quantity"<="app"."warehouse_transfer"."quantity" AND "app"."warehouse_transfer"."quarantined_quantity">=0 AND "app"."warehouse_transfer"."quarantined_quantity"<="app"."warehouse_transfer"."received_quantity"),
	CONSTRAINT "warehouse_transfer_scope_check" CHECK ("app"."warehouse_transfer"."from_warehouse_id"<>"app"."warehouse_transfer"."to_warehouse_id" AND "app"."warehouse_transfer"."revision">0),
	CONSTRAINT "warehouse_transfer_status_check" CHECK ("app"."warehouse_transfer"."status" IN ('requested','dispatched','received','exception','cancelled')),
	CONSTRAINT "warehouse_transfer_state_check" CHECK (("app"."warehouse_transfer"."status" IN ('requested','cancelled') AND "app"."warehouse_transfer"."received_quantity"=0) OR "app"."warehouse_transfer"."status" IN ('dispatched','exception') OR ("app"."warehouse_transfer"."status"='received' AND "app"."warehouse_transfer"."received_quantity"="app"."warehouse_transfer"."quantity"))
);
--> statement-breakpoint
ALTER TABLE "app"."inventory_balance" ADD CONSTRAINT "inventory_balance_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_balance" ADD CONSTRAINT "inventory_balance_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_balance" ADD CONSTRAINT "inventory_balance_lot_fk" FOREIGN KEY ("stock_item_id","lot_id") REFERENCES "app"."inventory_lot"("stock_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_lot" ADD CONSTRAINT "inventory_lot_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_lot" ADD CONSTRAINT "inventory_lot_origin_warehouse_id_warehouse_id_fk" FOREIGN KEY ("origin_warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movement" ADD CONSTRAINT "stock_movement_balance_id_inventory_balance_id_fk" FOREIGN KEY ("balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_reservation" ADD CONSTRAINT "stock_reservation_clock_namespace_local_fixture_namespace_name_fk" FOREIGN KEY ("clock_namespace") REFERENCES "app"."local_fixture_namespace"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_reservation_component" ADD CONSTRAINT "stock_reservation_component_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_reservation_component" ADD CONSTRAINT "stock_reservation_component_balance_id_inventory_balance_id_fk" FOREIGN KEY ("balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_reservation_item" ADD CONSTRAINT "stock_reservation_item_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_reservation_item" ADD CONSTRAINT "stock_reservation_item_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_reservation_item" ADD CONSTRAINT "stock_reservation_offer_fk" FOREIGN KEY ("product_id","product_revision","offer_id") REFERENCES "app"."offer_revision"("product_id","revision","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."transfer_receipt" ADD CONSTRAINT "transfer_receipt_transfer_id_warehouse_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "app"."warehouse_transfer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."transfer_receipt_component" ADD CONSTRAINT "transfer_receipt_component_receipt_id_transfer_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."transfer_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."transfer_receipt_component" ADD CONSTRAINT "transfer_receipt_component_source_balance_id_inventory_balance_id_fk" FOREIGN KEY ("source_balance_id") REFERENCES "app"."inventory_balance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."warehouse_transfer" ADD CONSTRAINT "warehouse_transfer_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."warehouse_transfer" ADD CONSTRAINT "warehouse_transfer_to_warehouse_id_warehouse_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."warehouse_transfer" ADD CONSTRAINT "warehouse_transfer_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."warehouse_transfer" ADD CONSTRAINT "warehouse_transfer_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_reservation_expiry_idx" ON "app"."stock_reservation" USING btree ("expires_at") WHERE "app"."stock_reservation"."status"='active' AND "app"."stock_reservation"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION app.inventory_clock(warehouse_uuid uuid, clock_namespace text DEFAULT NULL) RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((SELECT n.clock FROM app.local_fixture_warehouse w JOIN app.local_fixture_namespace n ON n.name=w.namespace
    WHERE w.warehouse_id=warehouse_uuid AND w.namespace=clock_namespace),clock_timestamp());
$$;
--> statement-breakpoint
CREATE FUNCTION app.reservation_clock(clock_namespace text) RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((SELECT clock FROM app.local_fixture_namespace WHERE name=clock_namespace),clock_timestamp());
$$;
--> statement-breakpoint
CREATE FUNCTION app.reject_inventory_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory identities and posted history are immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['inventory_lot','stock_movement','stock_reservation_item','stock_reservation_component','transfer_receipt','transfer_receipt_component'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_inventory_mutation()',tab || '_immutable',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['inventory_balance','stock_reservation','warehouse_transfer'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_inventory_mutation()',tab || '_no_delete',tab);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_inventory_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE movement app.stock_movement%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>0 OR NEW.on_hand<>0 OR NEW.reserved<>0 OR NEW.quarantined<>0 THEN
      RAISE EXCEPTION 'A new inventory position starts empty' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
    OR NEW.stock_item_id IS DISTINCT FROM OLD.stock_item_id OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
    OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Inventory identity is immutable and revisions append' USING ERRCODE='23514';
  END IF;
  SELECT * INTO movement FROM app.stock_movement WHERE balance_id=NEW.id AND revision=NEW.revision;
  IF movement.id IS NULL OR NEW.on_hand::bigint<>OLD.on_hand::bigint+movement.on_hand_delta
    OR NEW.reserved::bigint<>OLD.reserved::bigint+movement.reserved_delta
    OR NEW.quarantined::bigint<>OLD.quarantined::bigint+movement.quarantined_delta THEN
    RAISE EXCEPTION 'Inventory changes require their exact posted movement' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_balance_guard BEFORE INSERT OR UPDATE ON app.inventory_balance
FOR EACH ROW EXECUTE FUNCTION app.guard_inventory_balance();
--> statement-breakpoint
CREATE FUNCTION app.guard_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision integer;
BEGIN
  SELECT revision INTO current_revision FROM app.inventory_balance WHERE id=NEW.balance_id FOR UPDATE;
  IF current_revision IS NULL OR NEW.revision<>current_revision+1 THEN
    RAISE EXCEPTION 'A movement must advance the locked inventory position' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_movement_append BEFORE INSERT ON app.stock_movement
FOR EACH ROW EXECUTE FUNCTION app.guard_stock_movement();
--> statement-breakpoint
CREATE FUNCTION app.check_stock_movement_applied() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.inventory_balance WHERE id=NEW.balance_id AND revision>=NEW.revision) THEN
    RAISE EXCEPTION 'A movement and its balance commit together' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_movement_applied AFTER INSERT ON app.stock_movement
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_stock_movement_applied();
--> statement-breakpoint
CREATE FUNCTION app.guard_reservation_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
  SELECT status INTO current_status FROM app.stock_reservation WHERE id=NEW.reservation_id FOR UPDATE;
  IF current_status IS DISTINCT FROM 'preparing' THEN
    RAISE EXCEPTION 'Only an unsealed reservation accepts parts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_reservation_item_append BEFORE INSERT ON app.stock_reservation_item
FOR EACH ROW EXECUTE FUNCTION app.guard_reservation_part();
--> statement-breakpoint
CREATE TRIGGER stock_reservation_component_append BEFORE INSERT ON app.stock_reservation_component
FOR EACH ROW EXECUTE FUNCTION app.guard_reservation_part();
--> statement-breakpoint
CREATE FUNCTION app.guard_stock_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE movement_kind text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'preparing' THEN
      RAISE EXCEPTION 'A reservation starts unsealed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.key IS DISTINCT FROM OLD.key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.clock_namespace IS DISTINCT FROM OLD.clock_namespace
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Reservation intent is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='preparing' AND NEW.status='active' THEN
    IF NOT EXISTS (SELECT 1 FROM app.stock_reservation_component WHERE reservation_id=NEW.id) THEN
      RAISE EXCEPTION 'A reservation requires physical components' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='checkout' THEN
      IF NOT EXISTS (SELECT 1 FROM app.stock_reservation_item WHERE reservation_id=NEW.id)
        OR EXISTS (SELECT 1 FROM app.stock_reservation_item i JOIN app.offer_revision v ON v.product_id=i.product_id AND v.revision=i.product_revision AND v.offer_id=i.offer_id WHERE i.reservation_id=NEW.id AND v.retired) THEN
        RAISE EXCEPTION 'Checkout reservations require active immutable offers' USING ERRCODE='23514';
      END IF;
      IF EXISTS (
        WITH required AS (
          SELECT i.warehouse_id,c.stock_item_id,sum(i.offer_quantity::bigint*c.quantity::bigint) AS quantity
          FROM app.stock_reservation_item i JOIN app.offer_component c ON c.product_id=i.product_id AND c.revision=i.product_revision AND c.offer_id=i.offer_id
          WHERE i.reservation_id=NEW.id GROUP BY i.warehouse_id,c.stock_item_id
        ), allocated AS (
          SELECT b.warehouse_id,b.stock_item_id,sum(c.quantity::bigint) AS quantity
          FROM app.stock_reservation_component c JOIN app.inventory_balance b ON b.id=c.balance_id
          WHERE c.reservation_id=NEW.id GROUP BY b.warehouse_id,b.stock_item_id
        ) SELECT 1 FROM required r FULL JOIN allocated a USING (warehouse_id,stock_item_id)
        WHERE coalesce(r.quantity,0)<>coalesce(a.quantity,0)
      ) THEN
        RAISE EXCEPTION 'Checkout holds must match complete offer contents' USING ERRCODE='23514';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM app.warehouse_transfer WHERE reservation_id=NEW.id)
        OR EXISTS (SELECT 1 FROM app.stock_reservation_item WHERE reservation_id=NEW.id)
        OR EXISTS (
          SELECT 1 FROM app.warehouse_transfer t JOIN app.stock_reservation_component c ON c.reservation_id=t.reservation_id
          JOIN app.inventory_balance b ON b.id=c.balance_id WHERE t.reservation_id=NEW.id
          GROUP BY t.quantity,t.from_warehouse_id,t.stock_item_id
          HAVING sum(c.quantity::bigint)<>t.quantity OR bool_or(b.warehouse_id<>t.from_warehouse_id OR b.stock_item_id<>t.stock_item_id)
        ) THEN
        RAISE EXCEPTION 'Transfer holds must match their source stock' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.clock_namespace IS NOT NULL AND EXISTS (SELECT 1 FROM app.stock_reservation_component c JOIN app.inventory_balance b ON b.id=c.balance_id
      WHERE c.reservation_id=NEW.id AND (SELECT namespace FROM app.local_fixture_warehouse WHERE warehouse_id=b.warehouse_id) IS DISTINCT FROM NEW.clock_namespace) THEN
      RAISE EXCEPTION 'Reservation clock must match its warehouse context' USING ERRCODE='23514';
    END IF;
    movement_kind:='reserve';
  ELSIF OLD.status='active' AND NEW.status IN ('released','expired','consumed') THEN
    IF NEW.status='expired' AND (NEW.kind<>'checkout' OR NEW.expires_at>app.reservation_clock(NEW.clock_namespace)) THEN
      RAISE EXCEPTION 'Only due checkout reservations expire' USING ERRCODE='23514';
    END IF;
    movement_kind:=CASE WHEN NEW.status='consumed' THEN CASE WHEN NEW.kind='transfer' THEN 'transfer_out' ELSE 'consume' END ELSE 'release' END;
  ELSE
    RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('active','consumed') AND EXISTS (
    SELECT 1 FROM app.stock_reservation_component c JOIN app.inventory_balance b ON b.id=c.balance_id
    JOIN app.inventory_lot l ON l.id=b.lot_id JOIN app.warehouse w ON w.id=b.warehouse_id
    WHERE c.reservation_id=NEW.id AND l.expires_on<(app.inventory_clock(w.id,NEW.clock_namespace) AT TIME ZONE w.timezone)::date
  ) THEN
    RAISE EXCEPTION 'Expired batches cannot be reserved or dispatched' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('active','consumed') AND NEW.kind='checkout' AND NEW.expires_at<=app.reservation_clock(NEW.clock_namespace) THEN
    RAISE EXCEPTION 'Expired reservations cannot activate or consume' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM app.stock_reservation_component c WHERE c.reservation_id=NEW.id AND NOT EXISTS (
    SELECT 1 FROM app.stock_movement m WHERE m.balance_id=c.balance_id AND m.kind=movement_kind AND m.source_ref=NEW.id::text AND m.quantity=c.quantity
  )) THEN
    RAISE EXCEPTION 'Reservation transitions require their physical movements' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_reservation_guard BEFORE INSERT OR UPDATE ON app.stock_reservation
FOR EACH ROW EXECUTE FUNCTION app.guard_stock_reservation();
--> statement-breakpoint
CREATE FUNCTION app.check_stock_reservation_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_reservation app.stock_reservation%ROWTYPE; transfer_status text;
BEGIN
  SELECT * INTO current_reservation FROM app.stock_reservation WHERE id=NEW.id;
  IF current_reservation.status='preparing' THEN
    RAISE EXCEPTION 'An unsealed reservation cannot commit' USING ERRCODE='23514';
  END IF;
  IF current_reservation.kind='transfer' THEN
    SELECT status INTO transfer_status FROM app.warehouse_transfer WHERE reservation_id=NEW.id;
    IF transfer_status IS NULL OR NOT (
      (current_reservation.status='active' AND transfer_status='requested') OR
      (current_reservation.status='consumed' AND transfer_status IN ('dispatched','exception','received')) OR
      (current_reservation.status='released' AND transfer_status='cancelled')
    ) THEN
      RAISE EXCEPTION 'Transfer and physical hold resolve together' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_reservation_sealed AFTER INSERT OR UPDATE ON app.stock_reservation
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_stock_reservation_sealed();
--> statement-breakpoint
CREATE FUNCTION app.guard_warehouse_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation_status text; reservation_kind text; clock_namespace text; receipt app.transfer_receipt%ROWTYPE;
BEGIN
  SELECT status,kind,r.clock_namespace INTO reservation_status,reservation_kind,clock_namespace FROM app.stock_reservation r WHERE id=NEW.reservation_id;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'requested' OR NEW.revision<>1 OR reservation_status IS DISTINCT FROM 'preparing' OR reservation_kind IS DISTINCT FROM 'transfer'
      OR (clock_namespace IS NOT NULL AND (
        (SELECT namespace FROM app.local_fixture_warehouse WHERE warehouse_id=NEW.from_warehouse_id) IS DISTINCT FROM clock_namespace OR
        (SELECT namespace FROM app.local_fixture_warehouse WHERE warehouse_id=NEW.to_warehouse_id) IS DISTINCT FROM clock_namespace)) THEN
      RAISE EXCEPTION 'Transfer creation requires its unsealed source hold and clock context' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.from_warehouse_id IS DISTINCT FROM OLD.from_warehouse_id
    OR NEW.to_warehouse_id IS DISTINCT FROM OLD.to_warehouse_id OR NEW.stock_item_id IS DISTINCT FROM OLD.stock_item_id
    OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Transfer intent is immutable and revisions append' USING ERRCODE='23514';
  END IF;
  IF OLD.status='requested' AND NEW.status IN ('dispatched','cancelled') THEN
    IF reservation_status IS DISTINCT FROM (CASE WHEN NEW.status='dispatched' THEN 'consumed' ELSE 'released' END)
      OR NEW.received_quantity<>OLD.received_quantity OR NEW.quarantined_quantity<>OLD.quarantined_quantity THEN
      RAISE EXCEPTION 'Transfer dispatch or cancellation requires its physical hold resolution' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.status IN ('dispatched','exception') AND NEW.status IN ('received','exception') THEN
    SELECT * INTO receipt FROM app.transfer_receipt WHERE transfer_id=NEW.id AND revision=NEW.revision;
    IF receipt.id IS NULL OR NEW.received_quantity::bigint<>OLD.received_quantity::bigint+receipt.received_quantity
      OR NEW.quarantined_quantity::bigint<>OLD.quarantined_quantity::bigint+receipt.quarantined_quantity
      OR (NEW.received_quantity=NEW.quantity)<>(NEW.status='received') THEN
      RAISE EXCEPTION 'Transfer receipt counters require their immutable receipt' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid transfer transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER warehouse_transfer_guard BEFORE INSERT OR UPDATE ON app.warehouse_transfer
FOR EACH ROW EXECUTE FUNCTION app.guard_warehouse_transfer();
--> statement-breakpoint
CREATE FUNCTION app.guard_transfer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_transfer app.warehouse_transfer%ROWTYPE;
BEGIN
  SELECT * INTO current_transfer FROM app.warehouse_transfer WHERE id=NEW.transfer_id FOR UPDATE;
  IF current_transfer.status NOT IN ('dispatched','exception') OR current_transfer.id IS NULL OR NEW.revision<>current_transfer.revision+1 THEN
    RAISE EXCEPTION 'Receipt requires its locked dispatched transfer revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transfer_receipt_append BEFORE INSERT ON app.transfer_receipt
FOR EACH ROW EXECUTE FUNCTION app.guard_transfer_receipt();
--> statement-breakpoint
CREATE FUNCTION app.guard_transfer_receipt_component() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transfer_row app.warehouse_transfer%ROWTYPE; receipt_revision integer; allocated integer; already_received bigint;
BEGIN
  SELECT t.* INTO transfer_row FROM app.warehouse_transfer t JOIN app.transfer_receipt r ON r.transfer_id=t.id
    WHERE r.id=NEW.receipt_id FOR UPDATE OF t;
  SELECT revision INTO receipt_revision FROM app.transfer_receipt WHERE id=NEW.receipt_id;
  SELECT quantity INTO allocated FROM app.stock_reservation_component WHERE reservation_id=transfer_row.reservation_id AND balance_id=NEW.source_balance_id;
  SELECT coalesce(sum(c.quantity::bigint),0) INTO already_received FROM app.transfer_receipt_component c
    JOIN app.transfer_receipt r ON r.id=c.receipt_id WHERE r.transfer_id=transfer_row.id AND c.source_balance_id=NEW.source_balance_id;
  IF transfer_row.id IS NULL OR receipt_revision<>transfer_row.revision+1 OR allocated IS NULL
    OR NEW.quantity::bigint+already_received>allocated::bigint THEN
    RAISE EXCEPTION 'Receipt allocation must remain inside its dispatched source lot' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transfer_receipt_component_append BEFORE INSERT ON app.transfer_receipt_component
FOR EACH ROW EXECUTE FUNCTION app.guard_transfer_receipt_component();
--> statement-breakpoint
CREATE FUNCTION app.check_transfer_receipt_applied() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total_received bigint; total_quarantined bigint;
BEGIN
  SELECT coalesce(sum(quantity::bigint),0),coalesce(sum(quarantined_quantity::bigint),0)
    INTO total_received,total_quarantined FROM app.transfer_receipt_component WHERE receipt_id=NEW.id;
  IF total_received<>NEW.received_quantity OR total_quarantined<>NEW.quarantined_quantity
    OR NOT EXISTS (SELECT 1 FROM app.warehouse_transfer WHERE id=NEW.transfer_id AND revision>=NEW.revision) THEN
    RAISE EXCEPTION 'Transfer receipt, allocations and head commit together' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.transfer_receipt_component c JOIN app.inventory_balance source ON source.id=c.source_balance_id
    JOIN app.warehouse_transfer t ON t.id=NEW.transfer_id WHERE c.receipt_id=NEW.id AND NOT EXISTS (
      SELECT 1 FROM app.stock_movement m JOIN app.inventory_balance destination ON destination.id=m.balance_id
      WHERE m.kind='transfer_in' AND m.source_ref=NEW.id::text AND m.quantity=c.quantity
        AND m.quarantined_delta=c.quarantined_quantity AND destination.warehouse_id=t.to_warehouse_id
        AND destination.stock_item_id=source.stock_item_id AND destination.lot_id IS NOT DISTINCT FROM source.lot_id
    )
  ) THEN
    RAISE EXCEPTION 'Transfer receipt requires exact destination lot movements' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transfer_receipt_applied AFTER INSERT ON app.transfer_receipt
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_transfer_receipt_applied();
