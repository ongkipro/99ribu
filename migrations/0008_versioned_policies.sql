CREATE TABLE "app"."policy_head" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"warehouse_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "policy_scope_check" CHECK (("app"."policy_head"."kind" = 'commercial' AND "app"."policy_head"."warehouse_id" IS NULL) OR ("app"."policy_head"."kind" = 'warehouse_calendar' AND "app"."policy_head"."warehouse_id" IS NOT NULL)),
	CONSTRAINT "policy_revision_check" CHECK ("app"."policy_head"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."policy_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"head_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"values" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_version_revision_check" CHECK ("app"."policy_version"."revision" > 0),
	CONSTRAINT "policy_version_values_check" CHECK (jsonb_typeof("app"."policy_version"."values") = 'object'),
	CONSTRAINT "policy_version_reason_check" CHECK (char_length("app"."policy_version"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "app"."policy_head" ADD CONSTRAINT "policy_head_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."policy_version" ADD CONSTRAINT "policy_version_head_id_policy_head_id_fk" FOREIGN KEY ("head_id") REFERENCES "app"."policy_head"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_company_unique" ON "app"."policy_head" USING btree ("kind") WHERE "app"."policy_head"."warehouse_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_warehouse_unique" ON "app"."policy_head" USING btree ("kind","warehouse_id") WHERE "app"."policy_head"."warehouse_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_version_unique" ON "app"."policy_version" USING btree ("head_id","revision");--> statement-breakpoint
CREATE INDEX "policy_effective_idx" ON "app"."policy_version" USING btree ("head_id","effective_at","revision");
--> statement-breakpoint
CREATE FUNCTION app.reject_policy_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Policy versions are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_version_immutable BEFORE UPDATE OR DELETE ON app.policy_version
FOR EACH ROW EXECUTE FUNCTION app.reject_policy_version_mutation();
--> statement-breakpoint
CREATE FUNCTION app.guard_policy_head_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Policy scope is immutable and revisions append' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.policy_version WHERE head_id = NEW.id AND revision = NEW.revision) THEN
    RAISE EXCEPTION 'Policy revision requires its immutable version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_head_guard BEFORE UPDATE ON app.policy_head
FOR EACH ROW EXECUTE FUNCTION app.guard_policy_head_update();
