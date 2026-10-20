-- S03 foundation: domain tables are introduced in their owning slices.
CREATE SCHEMA "app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "app" FROM PUBLIC;
