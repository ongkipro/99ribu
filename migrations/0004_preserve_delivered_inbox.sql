-- Before S05, committing an inbox row meant local delivery had completed.
-- New S05 intents always have an outbox job in the same transaction.
UPDATE app.local_delivery AS delivery
SET delivered_at = delivery.created_at
WHERE delivery.delivered_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM app.outbox_job AS job
    WHERE job.kind = 'local.notification'
      AND job.payload->>'deliveryId' = delivery.id::text
  );
