-- Ledger rules live in the database, not only in app code, so no forgotten code path can skip them.

-- A record is locked once locked_at is set or 30 minutes have passed since it was created.
-- Checking the time here means no cron job has to fill locked_at.
CREATE FUNCTION ledger_is_locked(locked_at TIMESTAMPTZ, created_at TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT locked_at IS NOT NULL OR created_at < now() - interval '30 minutes'
$$;

-- Drafts can be edited and deleted freely. After the lock: no UPDATE or DELETE, only a new version.
CREATE FUNCTION ledger_lock_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  probe ledger_entries;
BEGIN
  -- Setting locked_at and nothing else is always allowed (resident view, charge issue).
  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL THEN
    probe := NEW;
    probe.locked_at := NULL;
    IF probe IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;
  END IF;

  IF ledger_is_locked(OLD.locked_at, OLD.created_at) THEN
    RAISE EXCEPTION 'ledger entry % is locked; create a revision instead', OLD.id
      USING ERRCODE = 'LE001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at cannot change' USING ERRCODE = 'LE002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_update_ledger BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_lock_guard();
CREATE TRIGGER guard_delete_ledger BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_lock_guard();

-- Checks on new rows that a CHECK constraint can't express.
CREATE FUNCTION ledger_insert_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  t ledger_entries;
BEGIN
  -- A future created_at would stretch the draft window.
  IF NEW.created_at > now() THEN
    RAISE EXCEPTION 'created_at cannot be in the future' USING ERRCODE = 'LE002';
  END IF;

  IF NEW.target_id IS NOT NULL THEN
    SELECT * INTO t FROM ledger_entries WHERE id = NEW.target_id;
    IF t.building_id <> NEW.building_id THEN
      RAISE EXCEPTION 'target is in another building' USING ERRCODE = 'LE003';
    END IF;
    IF t.kind IN ('reversal', 'document_attached') THEN
      RAISE EXCEPTION 'cannot target a % entry', t.kind USING ERRCODE = 'LE003';
    END IF;
    IF NEW.kind = 'reversal' AND NEW.amount_rial <> t.amount_rial THEN
      RAISE EXCEPTION 'a reversal must have the amount of its target' USING ERRCODE = 'LE003';
    END IF;
    IF NEW.kind = 'document_attached' AND t.kind <> 'expense' THEN
      RAISE EXCEPTION 'documents attach to expenses only' USING ERRCODE = 'LE003';
    END IF;
  END IF;

  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO t FROM ledger_entries WHERE id = NEW.supersedes_id;
    IF t.building_id <> NEW.building_id OR t.kind <> NEW.kind THEN
      RAISE EXCEPTION 'a revision must keep the building and kind' USING ERRCODE = 'LE003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_insert_ledger BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_insert_guard();

-- Each record has at most one successor (the chain stays linear) and one reversal.
CREATE UNIQUE INDEX one_revision_per_entry
  ON ledger_entries (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX one_reversal_per_entry
  ON ledger_entries (target_id) WHERE kind = 'reversal';

-- The app connects as app_user: data access only, no DDL, no TRUNCATE
-- (row triggers do not fire on TRUNCATE). Migrations run as the owner role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
REVOKE ALL ON schema_migrations FROM app_user;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
