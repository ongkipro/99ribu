ALTER TABLE "app"."outbox_job" DROP CONSTRAINT "outbox_status_check";--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD COLUMN "max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD CONSTRAINT "outbox_max_attempts_check" CHECK ("app"."outbox_job"."max_attempts" between 1 and 10);--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD CONSTRAINT "outbox_lease_check" CHECK (("app"."outbox_job"."status" = 'processing' AND "app"."outbox_job"."lease_token" IS NOT NULL AND "app"."outbox_job"."lease_until" IS NOT NULL) OR ("app"."outbox_job"."status" <> 'processing' AND "app"."outbox_job"."lease_token" IS NULL AND "app"."outbox_job"."lease_until" IS NULL));--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD CONSTRAINT "outbox_unknown_check" CHECK ("app"."outbox_job"."status" <> 'unknown' OR "app"."outbox_job"."dispatched_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."outbox_job" ADD CONSTRAINT "outbox_status_check" CHECK ("app"."outbox_job"."status" in ('pending', 'processing', 'unknown', 'completed', 'failed'));