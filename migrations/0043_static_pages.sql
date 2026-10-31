CREATE TABLE "app"."static_page_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "static_page_version_unique" UNIQUE("slug","revision"),
	CONSTRAINT "static_page_version_check" CHECK ("app"."static_page_version"."slug" IN ('tentang','kontak','syarat','privasi') AND "app"."static_page_version"."revision">0 AND char_length("app"."static_page_version"."title") between 1 and 80 AND char_length("app"."static_page_version"."body") between 1 and 20000 AND char_length("app"."static_page_version"."reason") between 1 and 500)
);
--> statement-breakpoint
-- S-C1 (expand-only; hand-written trigger outside the Drizzle snapshot): versions are immutable and append strictly
-- after the slug's latest revision; the server time is the creation time.
CREATE FUNCTION app.guard_static_page_version() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.revision<>coalesce((SELECT max(v.revision) FROM app.static_page_version v WHERE v.slug=NEW.slug),0)+1 THEN
  RAISE EXCEPTION 'Static page versions append right after the latest revision' USING ERRCODE='23514';
 END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER static_page_version_guard BEFORE INSERT ON app.static_page_version FOR EACH ROW EXECUTE FUNCTION app.guard_static_page_version();
--> statement-breakpoint
CREATE TRIGGER static_page_version_immutable BEFORE UPDATE OR DELETE ON app.static_page_version FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
