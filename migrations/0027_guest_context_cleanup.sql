CREATE INDEX "commerce_guest_expiry_idx" ON "app"."commerce_guest_context" USING btree ("expires_at");--> statement-breakpoint
-- S76 / DEC-002 (custom, expand-only): an expired guest context that nothing
-- references may be deleted. Hard FKs (cart, commerce_order, order_access,
-- return_operation, exception_operation) and soft references (support/referral
-- guest ids, 'guest:<id>' actor scopes) all count as referencing.
-- lazy: soft-reference probes are unindexed; fine at local scale, add indexes if cleanup shows in plans.
CREATE FUNCTION app.commerce_guest_context_referenced(p_guest_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM app.cart WHERE owner_guest_id=p_guest_id)
  OR EXISTS(SELECT 1 FROM app.commerce_order WHERE owner_guest_id=p_guest_id)
  OR EXISTS(SELECT 1 FROM app.order_access WHERE guest_id=p_guest_id)
  OR EXISTS(SELECT 1 FROM app.return_operation WHERE guest_id=p_guest_id OR actor_scope='guest:'||p_guest_id::text)
  OR EXISTS(SELECT 1 FROM app.exception_operation WHERE guest_id=p_guest_id OR actor_scope='guest:'||p_guest_id::text)
  OR EXISTS(SELECT 1 FROM app.commerce_operation WHERE actor_scope='guest:'||p_guest_id::text)
  OR EXISTS(SELECT 1 FROM app.guest_support_identity WHERE guest_id=p_guest_id)
  OR EXISTS(SELECT 1 FROM app.referral_touch WHERE guest_id=p_guest_id)
  OR EXISTS(SELECT 1 FROM app.support_challenge WHERE actor_scope='guest:'||p_guest_id::text)
$$;
--> statement-breakpoint
-- Same revocation-only rule as 0013 for both relations; order_access stays
-- undeletable. Only the guest-context DELETE branch is new.
CREATE OR REPLACE FUNCTION app.guard_commerce_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_TABLE_NAME='commerce_guest_context' THEN
  IF OLD.expires_at>clock_timestamp() OR app.commerce_guest_context_referenced(OLD.id)
  THEN RAISE EXCEPTION 'Only an expired, unreferenced guest context can be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at>clock_timestamp()
 THEN RAISE EXCEPTION 'Commerce authority can only be revoked' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
