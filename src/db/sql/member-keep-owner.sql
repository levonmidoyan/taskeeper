-- A workspace other people still use must keep an owner. The app checks this
-- in src/server/members/service.ts and src/server/account/deletion.ts, but
-- Better Auth deletes a leaving user's member rows (ON DELETE CASCADE from
-- "user") after that check has finished, so only the database can see the
-- final state. Applied by scripts/db-sql.ts after `drizzle-kit push`, which
-- does not manage functions or triggers. Safe to rerun.

CREATE OR REPLACE FUNCTION member_keep_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' THEN
    RETURN NULL;
  END IF;

  -- The same row lock members/service.ts takes, so this check and a concurrent
  -- owner change in the same workspace run one after the other. Each statement
  -- below then reads what the other one committed.
  PERFORM 1 FROM organization WHERE id = OLD.organization_id FOR UPDATE;
  -- The workspace itself is being deleted and its members go with it.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM member WHERE organization_id = OLD.organization_id)
    AND NOT EXISTS (
      SELECT 1 FROM member WHERE organization_id = OLD.organization_id AND role = 'owner'
    )
  THEN
    RAISE EXCEPTION 'A workspace must keep at least one owner.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'member_keep_owner';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS member_keep_owner ON member;
CREATE TRIGGER member_keep_owner
  AFTER DELETE OR UPDATE OF role ON member
  FOR EACH ROW WHEN (OLD.role = 'owner')
  EXECUTE FUNCTION member_keep_owner();
