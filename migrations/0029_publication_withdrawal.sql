CREATE TABLE "app"."publication_withdrawal" (
	"publication_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"product_revision" integer NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "publication_withdrawal_reason_check" CHECK (char_length("app"."publication_withdrawal"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "app"."publication_withdrawal" ADD CONSTRAINT "publication_withdrawal_publication_fk" FOREIGN KEY ("publication_id","product_id","product_revision") REFERENCES "app"."publication_version"("id","product_id","product_revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- A withdrawal targets only the publication that is the current head, serialized with
-- publication on the same head row lock; history stays immutable.
CREATE FUNCTION app.guard_publication_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE head_revision integer; target_revision integer;
BEGIN
  SELECT revision INTO head_revision FROM app.publication_head WHERE product_id=NEW.product_id FOR UPDATE;
  SELECT revision INTO target_revision FROM app.publication_version WHERE id=NEW.publication_id AND product_id=NEW.product_id;
  IF head_revision IS NULL OR target_revision IS NULL OR head_revision<>target_revision THEN
    RAISE EXCEPTION 'Only the current publication can be withdrawn' USING ERRCODE='23514';
  END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER publication_withdrawal_guard BEFORE INSERT ON app.publication_withdrawal
FOR EACH ROW EXECUTE FUNCTION app.guard_publication_withdrawal();
--> statement-breakpoint
CREATE TRIGGER publication_withdrawal_history_immutable BEFORE UPDATE OR DELETE ON app.publication_withdrawal
FOR EACH ROW EXECUTE FUNCTION app.reject_catalog_mutation();
