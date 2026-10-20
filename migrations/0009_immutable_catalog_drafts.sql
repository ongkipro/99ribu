CREATE TABLE "app"."category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"depth" integer NOT NULL,
	"attribute_definitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug"),
	CONSTRAINT "category_depth_check" CHECK ("app"."category"."depth" between 1 and 3 AND (("app"."category"."depth"=1) = ("app"."category"."parent_id" IS NULL))),
	CONSTRAINT "category_slug_check" CHECK ("app"."category"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("app"."category"."slug") <= 100),
	CONSTRAINT "category_definitions_check" CHECK (jsonb_typeof("app"."category"."attribute_definitions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "app"."offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"catalog_id" text NOT NULL,
	"sku" text NOT NULL,
	CONSTRAINT "offer_catalog_id_unique" UNIQUE("catalog_id"),
	CONSTRAINT "offer_sku_unique" UNIQUE("sku"),
	CONSTRAINT "offer_catalog_id_check" CHECK ("app"."offer"."catalog_id" ~ '^v_[0-9a-f-]{36}$'),
	CONSTRAINT "offer_sku_check" CHECK ("app"."offer"."sku" ~ '^[A-Z0-9_-]{1,100}$')
);
--> statement-breakpoint
CREATE TABLE "app"."offer_component" (
	"product_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"offer_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "offer_component_product_id_revision_offer_id_stock_item_id_pk" PRIMARY KEY("product_id","revision","offer_id","stock_item_id"),
	CONSTRAINT "offer_component_quantity_check" CHECK ("app"."offer_component"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."offer_revision" (
	"product_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"offer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"image" jsonb,
	"kind" text NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"price" integer DEFAULT 99000 NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"weight_grams" integer NOT NULL,
	"length_mm" integer NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"default_warehouse_id" uuid NOT NULL,
	CONSTRAINT "offer_revision_product_id_revision_offer_id_pk" PRIMARY KEY("product_id","revision","offer_id"),
	CONSTRAINT "offer_fixed_price_check" CHECK ("app"."offer_revision"."price"=99000 AND "app"."offer_revision"."currency"='IDR'),
	CONSTRAINT "offer_kind_check" CHECK ("app"."offer_revision"."kind" IN ('unit','multipack','bundle')),
	CONSTRAINT "offer_physical_check" CHECK ("app"."offer_revision"."weight_grams">0 AND "app"."offer_revision"."length_mm">0 AND "app"."offer_revision"."width_mm">0 AND "app"."offer_revision"."height_mm">0),
	CONSTRAINT "offer_attributes_check" CHECK (jsonb_typeof("app"."offer_revision"."attributes")='array')
);
--> statement-breakpoint
CREATE TABLE "app"."product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_id" text NOT NULL,
	"slug" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_catalog_id_unique" UNIQUE("catalog_id"),
	CONSTRAINT "product_slug_unique" UNIQUE("slug"),
	CONSTRAINT "product_catalog_id_check" CHECK ("app"."product"."catalog_id" ~ '^p_[0-9a-f-]{36}$'),
	CONSTRAINT "product_revision_check" CHECK ("app"."product"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."product_revision" (
	"product_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"images" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_revision_product_id_revision_pk" PRIMARY KEY("product_id","revision"),
	CONSTRAINT "product_revision_number_check" CHECK ("app"."product_revision"."revision" > 0),
	CONSTRAINT "product_revision_arrays_check" CHECK (jsonb_typeof("app"."product_revision"."images")='array' AND jsonb_typeof("app"."product_revision"."facts")='array')
);
--> statement-breakpoint
CREATE TABLE "app"."stock_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "stock_item_sku_unique" UNIQUE("sku"),
	CONSTRAINT "stock_item_sku_check" CHECK ("app"."stock_item"."sku" ~ '^[A-Z0-9_-]{1,100}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "offer_product_identity_unique" ON "app"."offer" USING btree ("product_id","id");--> statement-breakpoint
ALTER TABLE "app"."category" ADD CONSTRAINT "category_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer" ADD CONSTRAINT "offer_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer_component" ADD CONSTRAINT "offer_component_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "app"."stock_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer_component" ADD CONSTRAINT "offer_component_revision_fk" FOREIGN KEY ("product_id","revision","offer_id") REFERENCES "app"."offer_revision"("product_id","revision","offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer_revision" ADD CONSTRAINT "offer_revision_default_warehouse_id_warehouse_id_fk" FOREIGN KEY ("default_warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer_revision" ADD CONSTRAINT "offer_revision_product_fk" FOREIGN KEY ("product_id","revision") REFERENCES "app"."product_revision"("product_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offer_revision" ADD CONSTRAINT "offer_revision_identity_fk" FOREIGN KEY ("product_id","offer_id") REFERENCES "app"."offer"("product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_revision" ADD CONSTRAINT "product_revision_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_revision" ADD CONSTRAINT "product_revision_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION app.reject_catalog_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Catalog identities and revision history are immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['category','stock_item','offer','product_revision','offer_revision','offer_component'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation()',tab || '_immutable',tab);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_identity_delete BEFORE DELETE ON app.product
FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.guard_category_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_depth integer;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT depth INTO parent_depth FROM app.category WHERE id=NEW.parent_id;
    IF parent_depth IS NULL OR NEW.depth <> parent_depth+1 THEN
      RAISE EXCEPTION 'Category depth must follow its immutable parent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER category_parent_guard BEFORE INSERT ON app.category
FOR EACH ROW EXECUTE FUNCTION app.guard_category_insert();
--> statement-breakpoint
CREATE FUNCTION app.guard_catalog_revision_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision integer;
BEGIN
  SELECT revision INTO current_revision FROM app.product WHERE id=NEW.product_id FOR UPDATE;
  IF current_revision IS NULL OR NEW.revision <> current_revision+1 THEN
    RAISE EXCEPTION 'Only the next unsealed product revision accepts inserts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['product_revision','offer_revision','offer_component'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_catalog_revision_insert()',tab || '_append',tab);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.guard_product_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id
    OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.revision <> OLD.revision+1 THEN
    RAISE EXCEPTION 'Product identity is immutable and revisions append' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.product_revision WHERE product_id=NEW.id AND revision=NEW.revision)
    OR NOT EXISTS (SELECT 1 FROM app.offer_revision WHERE product_id=NEW.id AND revision=NEW.revision AND NOT retired) THEN
    RAISE EXCEPTION 'A product revision requires a complete active offer' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.offer_revision v LEFT JOIN app.offer_component c
      ON c.product_id=v.product_id AND c.revision=v.revision AND c.offer_id=v.offer_id
    WHERE v.product_id=NEW.id AND v.revision=NEW.revision
    GROUP BY v.offer_id,v.kind HAVING count(c.stock_item_id)=0
      OR (v.kind='unit' AND (count(c.stock_item_id)<>1 OR min(c.quantity)<>1))
      OR (v.kind='multipack' AND (count(c.stock_item_id)<>1 OR min(c.quantity)<2))
      OR (v.kind='bundle' AND count(c.stock_item_id)<2)
  ) THEN
    RAISE EXCEPTION 'Offer components do not match its kind' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_revision_guard BEFORE UPDATE ON app.product
FOR EACH ROW EXECUTE FUNCTION app.guard_product_revision();
