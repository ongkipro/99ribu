ALTER TABLE "app"."order_event" ADD COLUMN "recorded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."order_event" ALTER COLUMN "recorded_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
CREATE INDEX "commerce_order_history_idx" ON "app"."commerce_order" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "order_event_history_idx" ON "app"."order_event" USING btree ("order_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION app.record_order_event_ingestion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.recorded_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_event_ingestion BEFORE INSERT ON app.order_event FOR EACH ROW EXECUTE FUNCTION app.record_order_event_ingestion();
