CREATE TABLE "app"."local_fixture_namespace" (
	"name" text PRIMARY KEY NOT NULL,
	"clock" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "local_fixture_namespace_name_check" CHECK ("app"."local_fixture_namespace"."name" ~ '^[a-z][a-z0-9-]{0,23}$'),
	CONSTRAINT "local_fixture_namespace_revision_check" CHECK ("app"."local_fixture_namespace"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."local_fixture_principal" (
	"namespace" text NOT NULL,
	"fixture_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "local_fixture_principal_namespace_fixture_id_pk" PRIMARY KEY("namespace","fixture_id"),
	CONSTRAINT "local_fixture_principal_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."local_fixture_warehouse" (
	"namespace" text NOT NULL,
	"fixture_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	CONSTRAINT "local_fixture_warehouse_namespace_fixture_id_pk" PRIMARY KEY("namespace","fixture_id"),
	CONSTRAINT "local_fixture_warehouse_warehouse_id_unique" UNIQUE("warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "app"."local_fixture_principal" ADD CONSTRAINT "local_fixture_principal_namespace_local_fixture_namespace_name_fk" FOREIGN KEY ("namespace") REFERENCES "app"."local_fixture_namespace"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_fixture_principal" ADD CONSTRAINT "local_fixture_principal_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_fixture_warehouse" ADD CONSTRAINT "local_fixture_warehouse_namespace_local_fixture_namespace_name_fk" FOREIGN KEY ("namespace") REFERENCES "app"."local_fixture_namespace"("name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_fixture_warehouse" ADD CONSTRAINT "local_fixture_warehouse_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "app"."warehouse"("id") ON DELETE restrict ON UPDATE no action;