-- S104 hot-path indexes (expand-only). The Drizzle migrator applies every pending migration inside one
-- transaction, so CREATE INDEX CONCURRENTLY is not available here. Plain CREATE INDEX holds a SHARE lock
-- (writes wait, reads continue) only for the build; at launch sizes (largest table: outbox_job) each build
-- is well under a second. IF NOT EXISTS lets an operator pre-build a large index CONCURRENTLY under the same name
-- (RELEASE.md "Migrations 0036/0037").
-- fulfillment_causal_source_unique and shipment_booking_operation_fk already exist (hand-written in 0019);
-- schema.ts now declares them so the snapshot carries them, and this file deliberately does not re-create them.
CREATE INDEX IF NOT EXISTS "checkout_quote_contact_phone_suffix_idx" ON "app"."checkout_quote" USING btree (reverse(regexp_replace(coalesce("document"->'contact'->>'phone',''),'[^0-9]','','g')) text_pattern_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_quote_address_phone_suffix_idx" ON "app"."checkout_quote" USING btree (reverse(regexp_replace(coalesce("document"->'address'->>'phone',''),'[^0-9]','','g')) text_pattern_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commerce_order_transfer_code_recent_idx" ON "app"."commerce_order" USING btree ("expires_at","transfer_code") WHERE "app"."commerce_order"."payment_channel"='manual-bank';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_tracking_number_idx" ON "app"."fulfillment" USING btree ("tracking_number") WHERE "app"."fulfillment"."tracking_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_balance_stock_item_idx" ON "app"."inventory_balance" USING btree ("stock_item_id","warehouse_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_shipment_warehouse_idx" ON "app"."order_shipment" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_kind_due_idx" ON "app"."outbox_job" USING btree ("kind","run_at","created_at","id") WHERE "app"."outbox_job"."status" IN ('pending','unknown');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_lease_idx" ON "app"."outbox_job" USING btree ("lease_until") WHERE "app"."outbox_job"."status" = 'processing';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempt_open_method_idx" ON "app"."payment_attempt" USING btree ("method_id","expires_at") WHERE "app"."payment_attempt"."status" IN ('preparing','pending','unknown');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipping_label_artifact_shipment_idx" ON "app"."shipping_label_artifact" USING btree ("shipment_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_conversation_inbox_idx" ON "app"."support_conversation" USING btree (coalesce("last_public_message_at","created_at"),"id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_conversation_assignee_inbox_idx" ON "app"."support_conversation" USING btree ("assigned_user_id",coalesce("last_public_message_at","created_at"),"id");