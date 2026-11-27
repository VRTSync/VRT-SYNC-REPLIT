# Running the API tests

See [verification results and known limitations](./TEST-VERIFICATION.md) for the
fresh-database foundation acceptance run.

Use a **non-production, migrated development/test database**:

```sh
pnpm --filter @workspace/db run migrate:up
pnpm --filter @workspace/api-server test
```

The suite reads `DATABASE_URL`. Do not point it at production. Run `migrate:up`,
not schema push alone: migrations seed the asset-type catalogue (including
`tree`) and High Plains company used by fixtures, and create `user_sessions`
before an API process has ever started.

## Isolated migrations-only check

Set `FRESH_DB_ADMIN_URL` through Replit Secrets (or your local secret manager),
then run:

```sh
bash scripts/test-fresh-db.sh
```

The URL must explicitly name an admin database on a **permitted throwaway
PostgreSQL server**, with permission to create/drop databases and terminate
connections to its own databases. Never supply a production server. The runner
does not fall back to `DATABASE_URL`, accept credentials on its command line, or
print connection strings. TLS URL parameters are supported; other connection
query parameters are rejected so they cannot override the database target.

The runner creates a cryptographically random `vrtsync_test_…` database from
`template0`, then runs **only** `migrate:up` and the full API test command against
it. It does not start the API, push a schema, or copy development data. The admin
database and normal development database are never test/reset/drop targets.

Cleanup runs on success, setup/test failure, SIGINT, SIGTERM and SIGHUP. It checks
the created database's name and OID, stops test subprocesses on interruption,
blocks reconnects and terminates connections **only to that exact database**,
then drops it. The migration/test failure status is preserved; cleanup failure
is reported and turns an otherwise successful run into failure. SIGKILL, machine
loss or a lost admin connection can prevent cleanup; the logged random database
name identifies the disposable database for an administrator to remove.

If a managed server refuses `CREATE DATABASE`, the script reports the failure
without running tests against the admin database. Use a permitted throwaway
PostgreSQL server instead; never wipe a shared database as a substitute.

## Sessions and publishing

Sessions are intentionally **migration-owned, not declared in the Drizzle
schema**. The installed drizzle-kit introspector forgets custom single-column
primary-key names. A named table-level declaration produced a read-only proposal
to drop/re-add `session_pkey`; an inline declaration would not represent its exact
name. Neither is acceptable. `drizzle.config.ts` excludes `user_sessions` from
push through `tablesFilter`, while the generation snapshot carries forward the
other tables unchanged. Keep that exclusion when changing database tooling.
Do not bypass it with an ad hoc push configuration.

The migration uses the existing `session_pkey` primary key and
`IDX_session_expire` index names, `varchar`, `json` (not `jsonb`) and
`timestamp(6)` without timezone. Migration `0026` only creates missing objects;
it does not normalize live constraint names, rewrite rows, or change API/portal
session options.

Runner safety checks (no database connection):

```sh
node --test scripts/test-fresh-db.test.mjs
```

After merge, publishing remains a user-triggered action. Review the supported
Publish schema diff first: stop if it proposes dropping, recreating or renaming
the session table, primary key or expiry index. Development evidence alone does
not establish that production has no session schema differences. Do not run
production DDL or change deployment/startup commands to apply this slice.
