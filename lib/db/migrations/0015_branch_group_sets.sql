-- 0015_branch_group_sets.sql
-- Group sets: a named dimension ("Region", "Service Tier", "Branch Format")
-- that owns a handful of branch groups.  A location may belong to at most
-- one group per set.
--
-- Enforcement choice: OPTION (A) — set_id is denormalized onto
-- branch_group_members and kept in sync by triggers, then enforced with a
-- partial unique index.  Chosen over a validate-only trigger (option b)
-- because the constraint is checkable by reading the table and survives
-- bulk inserts that bypass application code.  Crucially, set_id is derived
-- by a BEFORE INSERT OR UPDATE trigger from branch_groups — the existing
-- write path (setBranchGroupMembers) supplies only group_id + community_id,
-- so an application-supplied set_id would always be NULL and the partial
-- index would silently enforce nothing.
-- All DDL uses IF NOT EXISTS / OR REPLACE guards for idempotency.

-- ── Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branch_group_sets (
  id              varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text      NOT NULL,
  sort_order      integer   NOT NULL DEFAULT 0,
  created_at      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT branch_group_sets_org_name_unique UNIQUE (organization_id, name)
);

-- ── branch_groups.set_id (nullable on purpose: set-less groups keep working) ─
ALTER TABLE branch_groups
  ADD COLUMN IF NOT EXISTS set_id varchar REFERENCES branch_group_sets(id) ON DELETE SET NULL;

-- ── Denormalized set_id on memberships ────────────────────────────────────
ALTER TABLE branch_group_members
  ADD COLUMN IF NOT EXISTS set_id varchar;

-- Derive set_id from the group on every insert/update.  Overwrites whatever
-- the caller supplied — the group is the single source of truth.
CREATE OR REPLACE FUNCTION branch_group_members_derive_set_id() RETURNS trigger AS $$
BEGIN
  SELECT bg.set_id INTO NEW.set_id FROM branch_groups bg WHERE bg.id = NEW.group_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS branch_group_members_set_id_trg ON branch_group_members;
CREATE TRIGGER branch_group_members_set_id_trg
  BEFORE INSERT OR UPDATE ON branch_group_members
  FOR EACH ROW EXECUTE FUNCTION branch_group_members_derive_set_id();

-- Keep member rows in sync when a group is moved into / out of a set.
CREATE OR REPLACE FUNCTION branch_groups_propagate_set_id() RETURNS trigger AS $$
BEGIN
  UPDATE branch_group_members SET set_id = NEW.set_id WHERE group_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS branch_groups_propagate_set_id_trg ON branch_groups;
CREATE TRIGGER branch_groups_propagate_set_id_trg
  AFTER UPDATE OF set_id ON branch_groups
  FOR EACH ROW
  WHEN (NEW.set_id IS DISTINCT FROM OLD.set_id)
  EXECUTE FUNCTION branch_groups_propagate_set_id();

-- Backfill any pre-existing membership rows (no-op when set_id is all NULL).
UPDATE branch_group_members bgm
   SET set_id = bg.set_id
  FROM branch_groups bg
 WHERE bg.id = bgm.group_id
   AND bgm.set_id IS DISTINCT FROM bg.set_id;

-- One group per set per location.  Set-less groups (set_id IS NULL) are
-- exempt: a location may be in many set-less groups, as today.
CREATE UNIQUE INDEX IF NOT EXISTS branch_group_members_one_per_set_idx
  ON branch_group_members (community_id, set_id)
  WHERE set_id IS NOT NULL;

-- ── Seed the pilot (PNC) org's sets ───────────────────────────────────────
-- Conservative by design: create the three sets; assign existing groups to
-- Region only when their name is an unambiguous compass region.  Anything
-- else stays set_id NULL — a wrong assignment is worse than an empty one.
DO $$
DECLARE
  pnc_org    varchar;
  region_set varchar;
  grp        record;
BEGIN
  SELECT o.id INTO pnc_org
    FROM organizations o
   WHERE o.name ILIKE '%PNC%'
      OR EXISTS (
           SELECT 1 FROM communities c
            WHERE c.organization_id = o.id AND c.name ILIKE '%PNC%'
         )
   ORDER BY o.created_at
   LIMIT 1;

  IF pnc_org IS NULL THEN
    RETURN;  -- no pilot org in this environment; nothing to seed
  END IF;

  INSERT INTO branch_group_sets (organization_id, name, sort_order) VALUES
    (pnc_org, 'Region',        0),
    (pnc_org, 'Service Tier',  1),
    (pnc_org, 'Branch Format', 2)
  ON CONFLICT (organization_id, name) DO NOTHING;

  SELECT id INTO region_set
    FROM branch_group_sets
   WHERE organization_id = pnc_org AND name = 'Region';

  -- Assign one group at a time: pulling a group into the set fires the
  -- propagate trigger, and pre-existing overlapping memberships (one branch
  -- already in two region-named groups) would violate the one-per-set index.
  -- A wrong/failed assignment must not abort the whole migration — skip the
  -- offending group and leave its set_id NULL for Randy to resolve in the UI.
  FOR grp IN
    SELECT id, name FROM branch_groups
     WHERE organization_id = pnc_org
       AND set_id IS NULL
       AND lower(name) IN (
         'north', 'south', 'east', 'west', 'central',
         'northeast', 'northwest', 'southeast', 'southwest',
         'north region', 'south region', 'east region', 'west region', 'central region'
       )
  LOOP
    BEGIN
      UPDATE branch_groups SET set_id = region_set WHERE id = grp.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'group set seed: skipping group "%" — a member already belongs to another Region group', grp.name;
    END;
  END LOOP;
END $$;
