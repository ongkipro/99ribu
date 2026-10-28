-- Clean public product URLs (/produk/<public_slug>). app.product.slug stays the immutable internal identity
-- (p-<uuid>, copied into drafts and publications); public_slug is the stored, unique, immutable URL segment.
-- The first holder of a name keeps the clean slug, later products of the same name get -2, -3, ...
CREATE SEQUENCE "app"."product_public_slug_seq";--> statement-breakpoint
ALTER TABLE "app"."product" ADD COLUMN "public_slug" text;--> statement-breakpoint
ALTER TABLE "app"."product" ADD CONSTRAINT "product_public_slug_unique" UNIQUE("public_slug");--> statement-breakpoint
-- Hand-written below (functions, triggers, backfill) lie outside the Drizzle snapshot.
-- Name -> slug base: lower case, common Latin accents transliterated, every other run of non-alphanumerics a single
-- hyphen, trimmed, at most 60 characters cut at a word boundary (no partial word while a hyphen exists in the first 60),
-- 'produk' when nothing is left.
CREATE FUNCTION app.public_slug_base(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE s text:=lower(coalesce(name,''));
BEGIN
 s:=replace(replace(replace(s,'ß','ss'),'æ','ae'),'œ','oe');
 s:=translate(s,'àáâãäåāăąçćĉčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľłñńņňòóôõöøōŏőŕŗřśŝşšțţťùúûüũūŭůűųŵýÿŷźżž','aaaaaaaaaccccddeeeeeeeeegggghhiiiiiiiiijkllllnnnnooooooooorrrsssstttuuuuuuuuuuwyyyzzz');
 s:=btrim(regexp_replace(s,'[^a-z0-9]+','-','g'),'-');
 IF char_length(s)>60 THEN
  IF substr(s,61,1)='-' THEN s:=left(s,60);
  ELSIF position('-' in left(s,60))>0 THEN s:=regexp_replace(left(s,60),'-[^-]*$','');
  ELSE s:=left(s,60);
  END IF;
  s:=btrim(s,'-');
 END IF;
 RETURN CASE WHEN s='' THEN 'produk' ELSE s END;
END $$;
--> statement-breakpoint
-- The caller inserts the product in the same transaction; the advisory lock (held until it ends) makes two creations
-- of one name pick different slugs. The lock key ignores a trailing counter so "x" and "x-2" serialise together; the
-- unique constraint stays the backstop. A counter longer than the base allows shortens the base, never the counter.
CREATE FUNCTION app.next_public_slug(name text) RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE base text:=app.public_slug_base(name); candidate text; n integer:=1; suffix text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('product_public_slug:'||regexp_replace(base,'-[0-9]+$','')));
 candidate:=base;
 WHILE EXISTS (SELECT 1 FROM app.product WHERE public_slug=candidate) LOOP
  n:=n+1; suffix:='-'||n; candidate:=btrim(left(base,64-char_length(suffix)),'-')||suffix;
 END LOOP;
 RETURN candidate;
END $$;
--> statement-breakpoint
-- Direct SQL inserts that name no slug (tests, repairs) get produk-<sequence>, never a random value.
CREATE FUNCTION app.fill_product_public_slug() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE candidate text;
BEGIN
 IF NEW.public_slug IS NULL THEN
  LOOP
   candidate:='produk-'||nextval('app.product_public_slug_seq');
   EXIT WHEN NOT EXISTS (SELECT 1 FROM app.product WHERE public_slug=candidate);
  END LOOP;
  NEW.public_slug:=candidate;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_public_slug_fill BEFORE INSERT ON app.product FOR EACH ROW EXECUTE FUNCTION app.fill_product_public_slug();
--> statement-breakpoint
-- Backfill: every existing product from its latest revision name, oldest first (first revision time, then id), so the
-- first holder of a name keeps the clean slug. The revision guard rejects updates that do not append a revision, so it
-- is off for this step only. Probing a name held by many products is linear per product, so the backfill runs
-- without the connection's statement timeout (restored right after).
SET LOCAL statement_timeout = 0;
--> statement-breakpoint
ALTER TABLE app.product DISABLE TRIGGER product_revision_guard;
--> statement-breakpoint
DO $$
DECLARE p record;
BEGIN
 FOR p IN SELECT pr.id,(SELECT r.name FROM app.product_revision r WHERE r.product_id=pr.id ORDER BY r.revision DESC LIMIT 1) AS name
   FROM app.product pr LEFT JOIN LATERAL (SELECT min(r.created_at) AS first_at FROM app.product_revision r WHERE r.product_id=pr.id) f ON true
   WHERE pr.public_slug IS NULL ORDER BY f.first_at NULLS LAST,pr.id
 LOOP
  UPDATE app.product SET public_slug=app.next_public_slug(coalesce(p.name,'')) WHERE id=p.id;
 END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE app.product ENABLE TRIGGER product_revision_guard;
--> statement-breakpoint
RESET statement_timeout;
--> statement-breakpoint
ALTER TABLE "app"."product" ALTER COLUMN "public_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."product" ADD CONSTRAINT "product_public_slug_check" CHECK ("app"."product"."public_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("app"."product"."public_slug") between 1 and 64);--> statement-breakpoint
-- A URL assigned once never changes: the public slug joins the identity the product guard (0009) already freezes.
CREATE OR REPLACE FUNCTION app.guard_product_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id
    OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.public_slug IS DISTINCT FROM OLD.public_slug OR NEW.revision <> OLD.revision+1 THEN
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
