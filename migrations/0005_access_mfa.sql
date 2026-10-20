CREATE TABLE "app"."access_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."access_proof" (
	"digest" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"action" text NOT NULL,
	"subject_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"subject_id" text,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_outcome_check" CHECK ("app"."audit_event"."outcome" IN ('allowed','denied'))
);
--> statement-breakpoint
CREATE TABLE "app"."mfa_session" (
	"session_id" text PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."role_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"roles" text[] DEFAULT ARRAY['buyer']::text[] NOT NULL,
	"permissions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "role_grant_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "role_grant_roles_check" CHECK ("app"."role_grant"."roles" <@ ARRAY['owner','ecommerce_admin','warehouse','customer_service','finance','buyer','affiliate']::text[] AND array_position("app"."role_grant"."roles", NULL) IS NULL),
	CONSTRAINT "role_grant_revision_check" CHECK ("app"."role_grant"."revision" > 0),
	CONSTRAINT "role_grant_finance_check" CHECK (NOT ("app"."role_grant"."permissions" && ARRAY['finance.summary.read','finance.costs.read','finance.costs.write']::text[]) OR "app"."role_grant"."roles" && ARRAY['owner','finance']::text[])
);
--> statement-breakpoint
CREATE TABLE "app"."auth_two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "auth_two_factor_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."warehouse_membership" (
	"user_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	CONSTRAINT "warehouse_membership_user_id_warehouse_id_pk" PRIMARY KEY("user_id","warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "app"."auth_user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."access_proof" ADD CONSTRAINT "access_proof_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."auth_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mfa_session" ADD CONSTRAINT "mfa_session_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."auth_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_grant" ADD CONSTRAINT "role_grant_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."warehouse_membership" ADD CONSTRAINT "warehouse_membership_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."warehouse_membership" ADD CONSTRAINT "warehouse_membership_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_operation_identity_idx" ON "app"."access_operation" USING btree ("actor_id","action","key");--> statement-breakpoint
CREATE INDEX "audit_subject_idx" ON "app"."audit_event" USING btree ("subject_id","created_at");
--> statement-breakpoint
CREATE FUNCTION app.reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON app.audit_event
FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
