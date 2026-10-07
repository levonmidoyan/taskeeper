-- notification_unsent_idx once covered every unsent row, so change
-- notifications (never emailed) piled up in it forever. `drizzle-kit push`
-- does not notice a changed index predicate, so rebuild it here when it still
-- has the old one. Matches src/db/schema/reminder.ts. Safe to rerun.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'notification_unsent_idx' AND indexdef LIKE '%kind%'
  ) THEN
    DROP INDEX IF EXISTS notification_unsent_idx;
    CREATE INDEX notification_unsent_idx ON notification (created_at)
      WHERE email_sent_at IS NULL AND kind IN ('reminder', 'digest');
  END IF;
END
$$;
