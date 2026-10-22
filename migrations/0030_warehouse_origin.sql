ALTER TABLE "app"."warehouse" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD COLUMN "origin_key" text;--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD CONSTRAINT "warehouse_origin_key_unique" UNIQUE("origin_key");--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD CONSTRAINT "warehouse_location_check" CHECK (("app"."warehouse"."province" IS NULL OR char_length("app"."warehouse"."province") BETWEEN 1 AND 100) AND ("app"."warehouse"."district" IS NULL OR char_length("app"."warehouse"."district") BETWEEN 1 AND 100));--> statement-breakpoint
ALTER TABLE "app"."warehouse" ADD CONSTRAINT "warehouse_origin_key_check" CHECK ("app"."warehouse"."origin_key" IS NULL OR ("app"."warehouse"."origin_key" ~ '^[0-9a-f]{32}$' AND "app"."warehouse"."province" IS NOT NULL AND "app"."warehouse"."district" IS NOT NULL));