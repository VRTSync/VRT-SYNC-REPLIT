# Fresh-database foundation verification

## Result

- Migrations-only disposable database: **1,839 tests, 52 suites; 1,839 passed,
  zero failed/cancelled/skipped**. This includes the S1 additions and five new
  session/migration regression checks; the historical 1,676 count is not used.
- Development database: the same **1,839/1,839** tests passed.
- Runner safety tests: **13/13** passed, without connecting to a database.
- `pnpm run typecheck:libs` and
  `pnpm --filter @workspace/api-server run typecheck` passed.
- `pnpm --filter @workspace/db run migrate:check` reported `Everything's fine`.
- `migrate:generate --name verify_no_drift` reported
  `No schema changes, nothing to migrate`; it created no additional migration.

The real server permitted disposable databases. The runner created a random
database from `template0`, ran only `migrate:up` and the full API test command,
then removed it. No manual schema creation, schema push, app startup, copied
development data, container or virtual environment was used to prepare it.
Metadata inspection confirmed no disposable runner database remained. The first
run's single test failure also demonstrated real cleanup on a failed API suite.
Separate subprocess tests cover migration failure, test failure, cleanup
failure, identity mismatch, denied creation, missing/unsafe configuration and
SIGINT/SIGTERM/SIGHUP handling, including exit-code preservation.

## Session/schema evidence

- Before implementation, development metadata confirmed `sid varchar NOT NULL`,
  `sess json NOT NULL`, `expire timestamp(6) without time zone NOT NULL`,
  primary key `session_pkey(sid)` and expiry index `IDX_session_expire(expire)`.
- `0026` was unused and was registered with the existing journal/snapshot
  conventions. Its SQL only uses `CREATE TABLE IF NOT EXISTS` and
  `CREATE INDEX IF NOT EXISTS`, retaining those names for fresh databases.
- The new migration was recorded in development with the correct file hash.
  Two subsequent CLI `migrate:up` runs succeeded. Across those checks, the
  existing table OID/physical file, session count, insert/update/delete counters
  and two-index metadata were unchanged. No session contents were inspected.
- The transactional harness inserts only synthetic users/sessions, runs the
  migration twice and checks unchanged tuples (including `xmin`/`ctid`), table,
  primary-key and index identities, then rolls back.
- An exact named Drizzle declaration was tried but **not retained**: read-only
  introspection proposed dropping/re-adding the single-column primary key.
  No such SQL was applied. Sessions remain migration-owned, with an explicit
  push exclusion. The final session-only push preview, using that exclusion
  and excluding unrelated tables, returned **no statements, no warnings and
  `hasDataLoss: false`**. Generation also returned no changes.
- A global live diff is **not claimed clean**: it encounters unrelated existing
  `template_runs.created_at` versus `run_at` drift; targeted inspection also
  found an unrelated `water_usage` table outside the ORM schema. Neither was
  repaired. The existing applied `0011_asset_types_table` hash mismatch remains;
  it is separate from `migrate:check` and from the matching new migration hash.

## Fixture/assertion changes

1. Active-asset `storage.createAsset` fixture: `assetType: "fixture"` → `"tree"`.
2. Archived-asset raw SQL fixture: `'fixture'` → `'tree'`.

Both use a migration-seeded catalogue key instead of development-only data.
All community-card assertions and expected values are unchanged.

With explicit user approval, the performance-history assertion now finds journal
entry `25` instead of asserting that it must remain the final entry. Its expected
tag remains `0025_performance_indexes`; all other existing assertions and
expected values are unchanged. Without this adjustment every new migration
would fail that test.

## Compatibility and release boundary

The real PostgreSQL-backed auth harness verifies login cookies, two-device
sessions, shared-cookie reads by a second portal-style store, logout, expiry,
targeted/all-device revocation, migration rerun cookie survival and community
removal. The full existing suite also covers deactivation, role changes and S1
scope removal. Only synthetic transaction-scoped rows are revoked or expired.
API/portal session options and portal/mobile application code are unchanged.

The API workflow restarted cleanly with zero pending migrations, its health
endpoint returned HTTP 200, and the portal login page rendered. No real user was
signed out for testing. Native installed iOS/Android flows and an authenticated
browser session against the running separate services were **not** exercised;
the two-store compatibility check is an HTTP/database harness, not a device test.

Nothing was published and no production schema was changed. After merge, offer
the user Publish with the supported schema-diff review. Stop for any session
table/constraint/index drop, recreation or rename. No claim is made that the
production schema diff is a no-op before inspecting that actual diff.
