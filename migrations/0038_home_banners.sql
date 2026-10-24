CREATE TABLE "app"."home_banner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "home_banner_revision_check" CHECK ("app"."home_banner"."revision">=0)
);
--> statement-breakpoint
CREATE TABLE "app"."home_banner_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"banner_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"action_label" text NOT NULL,
	"href" text NOT NULL,
	"image_sha256" text NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"image_alt" text NOT NULL,
	"tint" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"position" integer NOT NULL,
	"active" boolean NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "home_banner_version_unique" UNIQUE("banner_id","revision"),
	CONSTRAINT "home_banner_version_text_check" CHECK ("app"."home_banner_version"."revision">0 AND char_length("app"."home_banner_version"."title") between 1 and 60 AND ("app"."home_banner_version"."subtitle" IS NULL OR char_length("app"."home_banner_version"."subtitle") between 1 and 140)
  AND char_length("app"."home_banner_version"."action_label") between 1 and 24 AND char_length("app"."home_banner_version"."image_alt") between 1 and 160 AND char_length("app"."home_banner_version"."reason") between 1 and 500),
	CONSTRAINT "home_banner_version_href_check" CHECK ("app"."home_banner_version"."href" ~ '^/(promo|kategori|kategori/[a-z0-9-]{1,80}|cari|produk/[a-z0-9-]{1,160})([?][A-Za-z0-9_.~%=&+*-]+)?$' AND char_length("app"."home_banner_version"."href")<=400),
	CONSTRAINT "home_banner_version_image_check" CHECK ("app"."home_banner_version"."image_sha256" ~ '^[0-9a-f]{64}$' AND "app"."home_banner_version"."image_width" between 1 and 16384 AND "app"."home_banner_version"."image_height" between 1 and 16384
  AND ("app"."home_banner_version"."tint" IS NULL OR "app"."home_banner_version"."tint" IN ('amber','slate','rose','blue','green','violet','teal'))),
	CONSTRAINT "home_banner_version_window_check" CHECK ("app"."home_banner_version"."starts_at"<"app"."home_banner_version"."ends_at" AND "app"."home_banner_version"."position" between 0 and 999 AND NOT ("app"."home_banner_version"."retired" AND "app"."home_banner_version"."active"))
);
--> statement-breakpoint
ALTER TABLE "app"."home_banner_version" ADD CONSTRAINT "home_banner_version_banner_id_home_banner_id_fk" FOREIGN KEY ("banner_id") REFERENCES "app"."home_banner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- S110 home banners (expand-only; hand-written triggers are outside the Drizzle snapshot). A banner identity is
-- permanent and starts empty; its revision advances by exactly one and only onto its appended version. Versions are
-- immutable, append strictly after the head, and nothing follows a retirement. A deferred seal refuses a commit that
-- leaves an identity without its current version or a version beyond the head. Functions pin search_path (see 0037).
CREATE FUNCTION app.guard_home_banner() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Home banner identity is permanent' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>0 THEN RAISE EXCEPTION 'Home banner starts empty' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp(); RETURN NEW;
 END IF;
 IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
  OR NOT EXISTS(SELECT 1 FROM app.home_banner_version v WHERE v.banner_id=NEW.id AND v.revision=NEW.revision) THEN
  RAISE EXCEPTION 'Home banner revision requires its appended version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER home_banner_guard BEFORE INSERT OR UPDATE OR DELETE ON app.home_banner FOR EACH ROW EXECUTE FUNCTION app.guard_home_banner();
--> statement-breakpoint
CREATE FUNCTION app.guard_home_banner_version() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE head app.home_banner; was_retired boolean;
BEGIN
 SELECT * INTO head FROM app.home_banner WHERE id=NEW.banner_id FOR UPDATE;
 IF head.id IS NULL OR NEW.revision<>head.revision+1 THEN
  RAISE EXCEPTION 'Home banner versions append right after the head' USING ERRCODE='23514';
 END IF;
 SELECT v.retired INTO was_retired FROM app.home_banner_version v WHERE v.banner_id=NEW.banner_id AND v.revision=head.revision;
 IF was_retired THEN RAISE EXCEPTION 'A retired home banner is final' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER home_banner_version_guard BEFORE INSERT ON app.home_banner_version FOR EACH ROW EXECUTE FUNCTION app.guard_home_banner_version();
--> statement-breakpoint
CREATE TRIGGER home_banner_version_immutable BEFORE UPDATE OR DELETE ON app.home_banner_version FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
--> statement-breakpoint
CREATE FUNCTION app.seal_home_banner() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE selected uuid;
BEGIN
 IF TG_TABLE_NAME='home_banner' THEN selected:=NEW.id; ELSE selected:=NEW.banner_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.home_banner h JOIN app.home_banner_version v ON v.banner_id=h.id AND v.revision=h.revision WHERE h.id=selected)
  OR EXISTS(SELECT 1 FROM app.home_banner h JOIN app.home_banner_version v ON v.banner_id=h.id WHERE h.id=selected AND v.revision>h.revision) THEN
  RAISE EXCEPTION 'Unsealed home banner' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER home_banner_sealed AFTER INSERT OR UPDATE ON app.home_banner DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_home_banner();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER home_banner_version_sealed AFTER INSERT ON app.home_banner_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seal_home_banner();
