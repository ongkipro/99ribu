-- S105 retention support (expand-only). Plain CREATE INDEX inside the migrator's single transaction (see 0036).
-- access_operation.created_at uses the STABLE default now(): a catalog-only change, no table rewrite.
ALTER TABLE "app"."access_operation" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_operation_created_idx" ON "app"."access_operation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commerce_event_visitor_idx" ON "app"."commerce_event" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_ad_attribution_visitor_idx" ON "app"."order_ad_attribution" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_completed_idx" ON "app"."outbox_job" USING btree ("completed_at") WHERE "app"."outbox_job"."status" = 'completed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_session_expires_idx" ON "app"."auth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_verification_expires_idx" ON "app"."auth_verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_session_expires_idx" ON "app"."visitor_session" USING btree ("expires_at");
--> statement-breakpoint
-- S105 retention (hand-written; functions and triggers are outside the Drizzle snapshot).
-- Visitor/consent/funnel/advertising rows are append-only by trigger. They may now be deleted only by the
-- table owner inside app.purge_expired_visitor_history, which runs SECURITY DEFINER and sets the transaction-
-- local setting app.retention_purge=on only around its own deletes. The app role can set the setting but is never the table owner,
-- so a direct DELETE still fails with the original 23514 messages. No trigger is disabled.
CREATE FUNCTION app.retention_purge_allowed(relation oid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(current_setting('app.retention_purge', true), '') = 'on'
  AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = relation)
$$;
--> statement-breakpoint
CREATE FUNCTION app.reject_signal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND app.retention_purge_allowed(TG_RELID) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Catalog identities and revision history are immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER commerce_event_immutable BEFORE DELETE OR UPDATE ON app.commerce_event FOR EACH ROW EXECUTE FUNCTION app.reject_signal_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER funnel_intake_immutable BEFORE DELETE OR UPDATE ON app.funnel_intake FOR EACH ROW EXECUTE FUNCTION app.reject_signal_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER visitor_bootstrap_request_immutable BEFORE DELETE OR UPDATE ON app.visitor_bootstrap_request FOR EACH ROW EXECUTE FUNCTION app.reject_signal_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER consent_receipt_immutable BEFORE DELETE OR UPDATE ON app.consent_receipt FOR EACH ROW EXECUTE FUNCTION app.reject_signal_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER ad_delivery_attempt_immutable BEFORE DELETE OR UPDATE ON app.ad_delivery_attempt FOR EACH ROW EXECUTE FUNCTION app.reject_signal_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER local_ad_sink_immutable BEFORE DELETE OR UPDATE ON app.local_ad_sink FOR EACH ROW EXECUTE FUNCTION app.reject_signal_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_visitor_session()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE receipt app.consent_receipt%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF app.retention_purge_allowed(TG_RELID) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Visitor purpose history is retained' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status NOT IN ('preparing','active') OR NEW.consent_revision<>0 OR NEW.current_consent_id IS NOT NULL
    OR NEW.created_at>clock_timestamp() OR NEW.created_at<clock_timestamp()-interval '5 seconds'
    OR NEW.expires_at>NEW.created_at+(CASE WHEN NEW.status='preparing' THEN interval '10 minutes' ELSE interval '24 hours' END)
    OR (NEW.status='active' AND NEW.activated_at IS DISTINCT FROM NEW.created_at)
    OR (NEW.principal_scope<>'browser' AND NOT EXISTS(SELECT 1 FROM app.auth_session s JOIN app.auth_user u ON u.id=s.user_id WHERE NEW.principal_scope='user:'||s.user_id||':'||s.id AND s.expires_at>clock_timestamp() AND u.email_verified))
  THEN RAISE EXCEPTION 'Visitor issuance requires current purpose and bounded wall time' USING ERRCODE='23514'; END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  IF (NEW.id,NEW.digest,NEW.principal_scope,NEW.created_at,NEW.recorded_at) IS DISTINCT FROM (OLD.id,OLD.digest,OLD.principal_scope,OLD.created_at,OLD.recorded_at)
   OR OLD.status='revoked' OR OLD.expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'Visitor authority cannot be relinked or revived' USING ERRCODE='23514'; END IF;
  IF OLD.status='preparing' THEN
   IF NEW.status<>'active' OR NEW.activated_at<OLD.created_at OR NEW.activated_at>clock_timestamp() OR NEW.expires_at>NEW.activated_at+interval '24 hours' OR NEW.consent_revision<>0 OR NEW.current_consent_id IS NOT NULL
   THEN RAISE EXCEPTION 'Visitor activation requires its live original nonce' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status='revoked' THEN
   IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Visitor revocation preserves its history' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO receipt FROM app.consent_receipt WHERE id=NEW.current_consent_id;
   IF (to_jsonb(NEW)-'consent_revision'-'current_consent_id') IS DISTINCT FROM (to_jsonb(OLD)-'consent_revision'-'current_consent_id')
    OR NEW.consent_revision<>OLD.consent_revision+1 OR receipt.visitor_id IS DISTINCT FROM OLD.id OR receipt.revision IS DISTINCT FROM NEW.consent_revision
   THEN RAISE EXCEPTION 'Visitor consent head advances with exact receipt' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_ad_event_outbox()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE event app.commerce_event%ROWTYPE; visitor app.visitor_session%ROWTYPE; captured app.consent_receipt%ROWTYPE; reason text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF app.retention_purge_allowed(TG_RELID) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Advertising decision history is retained' USING ERRCODE='23514';
 END IF;
 SELECT * INTO event FROM app.commerce_event WHERE id=NEW.event_id;
 IF event.visitor_id IS NOT NULL THEN SELECT * INTO visitor FROM app.visitor_session WHERE id=event.visitor_id FOR UPDATE; END IF;
 SELECT * INTO captured FROM app.consent_receipt WHERE id=event.consent_receipt_id;
 reason:=app.signal_delivery_reason(event.id,NEW.platform);
 IF TG_OP='INSERT' THEN
  IF NEW.status NOT IN ('queued','suppressed') OR (NEW.status='queued' AND NEW.reason<>'eligible') OR (NEW.status='suppressed' AND NEW.reason NOT IN ('no_consent','expired','unavailable_context','source_not_eligible'))
    OR NEW.expires_at>event.occurred_at+interval '24 hours' OR (visitor.id IS NOT NULL AND NEW.expires_at>visitor.expires_at)
    OR (captured.id IS NOT NULL AND NEW.expires_at>captured.expires_at)
    OR (NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.outbox_job j WHERE j.id=NEW.job_id AND j.kind='advertising.dispatch' AND j.dedup_key='ad-dispatch:'||NEW.id::text AND j.payload=jsonb_build_object('outboxId',NEW.id)))
  THEN RAISE EXCEPTION 'Advertising decision requires exact source and original expiry' USING ERRCODE='23514'; END IF;
  IF NEW.status='queued' AND (reason<>'eligible' OR NEW.expires_at<=clock_timestamp()) THEN
   NEW.status:='suppressed';NEW.reason:=CASE WHEN reason='eligible' THEN 'expired' ELSE reason END;
  END IF;
  NEW.recorded_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-'status'-'reason') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'reason') OR OLD.status<>'queued'
   OR (NEW.status='accepted' AND (NEW.reason<>'accepted_local' OR NOT EXISTS(SELECT 1 FROM app.local_ad_sink WHERE outbox_id=OLD.id AND event_id=OLD.event_id AND platform=OLD.platform)))
   OR (NEW.status='cancelled' AND (NEW.reason NOT IN ('expired','withdrawn') OR (reason='eligible' AND OLD.expires_at>clock_timestamp())))
   OR (NEW.status='quarantined' AND (NEW.reason<>'definitive_no_effect' OR EXISTS(SELECT 1 FROM app.local_ad_sink WHERE outbox_id=OLD.id) OR NOT EXISTS(SELECT 1 FROM app.outbox_job WHERE id=OLD.job_id AND status='processing' AND dispatched_at IS NOT NULL AND lease_until>clock_timestamp())))
   OR NEW.status NOT IN ('accepted','cancelled','quarantined')
  THEN RAISE EXCEPTION 'Advertising phase requires durable evidence and preserves identity' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$function$;
--> statement-breakpoint
-- One bounded batch: visitors whose session expired more than 90 days ago and whose history carries no money,
-- order or transmitted-signal reference (order attribution, an event with an order/receipt, or an ad decision
-- other than suppressed/cancelled). Their decisions, attempts, funnel intakes, events, bootstrap requests,
-- consent receipts and the session itself are deleted together. FK RESTRICT stays the backstop: an unexpected
-- reference aborts the batch instead of deleting history. Returns the number of visitors purged. `retain` below
-- 90 days is refused unless the calling session is the table owner (migrations and the isolated retention test).
CREATE FUNCTION app.purge_expired_visitor_history(batch integer, retain interval DEFAULT interval '90 days') RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE visitors uuid[]; events uuid[];
BEGIN
 IF batch IS NULL OR batch < 1 OR batch > 1000 THEN RAISE EXCEPTION 'Retention batch must be 1..1000' USING ERRCODE='22023'; END IF;
 IF retain IS NULL OR (retain < interval '90 days' AND session_user <> current_user) THEN
  RAISE EXCEPTION 'Visitor history is retained for 90 days after expiry' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(array_agg(candidate.id), '{}') INTO visitors FROM (
  SELECT v.id FROM app.visitor_session v
  WHERE v.expires_at < clock_timestamp() - retain
   AND NOT EXISTS (SELECT 1 FROM app.order_ad_attribution a WHERE a.visitor_id = v.id)
   AND NOT EXISTS (SELECT 1 FROM app.commerce_event e WHERE e.visitor_id = v.id AND (e.order_id IS NOT NULL OR e.receipt_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM app.ad_event_outbox o WHERE o.event_id = e.id AND o.status NOT IN ('suppressed', 'cancelled'))))
  ORDER BY v.expires_at, v.id LIMIT batch FOR UPDATE OF v SKIP LOCKED) candidate;
 IF cardinality(visitors) = 0 THEN RETURN 0; END IF;
 -- Transaction-local, reset below; an error rolls it back with the batch. Outside this owner-run function the
 -- setting alone grants nothing (retention_purge_allowed also requires the table owner as current_user).
 PERFORM set_config('app.retention_purge', 'on', true);
 SELECT coalesce(array_agg(e.id), '{}') INTO events FROM app.commerce_event e WHERE e.visitor_id = ANY(visitors);
 DELETE FROM app.ad_delivery_attempt d USING app.ad_event_outbox o WHERE d.outbox_id = o.id AND o.event_id = ANY(events);
 DELETE FROM app.local_ad_sink WHERE event_id = ANY(events);
 DELETE FROM app.ad_event_outbox WHERE event_id = ANY(events);
 DELETE FROM app.funnel_intake WHERE visitor_id = ANY(visitors) OR event_id = ANY(events);
 DELETE FROM app.commerce_event WHERE id = ANY(events);
 DELETE FROM app.visitor_bootstrap_request WHERE visitor_id = ANY(visitors);
 -- consent_receipt.visitor_id and visitor_session.current_consent_id reference each other: one statement.
 WITH receipts AS (DELETE FROM app.consent_receipt WHERE visitor_id = ANY(visitors))
 DELETE FROM app.visitor_session WHERE id = ANY(visitors);
 PERFORM set_config('app.retention_purge', '', true);
 RETURN cardinality(visitors);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.purge_expired_visitor_history(integer, interval) FROM PUBLIC;
