CREATE TABLE "app"."outbox_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedup_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbox_job_dedup_key_unique" UNIQUE("dedup_key"),
	CONSTRAINT "outbox_status_check" CHECK ("app"."outbox_job"."status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "outbox_attempts_check" CHECK ("app"."outbox_job"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."local_delivery" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "app"."outbox_job" USING btree ("run_at","created_at","id") WHERE "app"."outbox_job"."status" = 'pending';