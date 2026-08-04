---
name: Publish schema-diff vs boot migrations
description: Why boot-time SQL migrations must tolerate a prod schema that already matches dev, and must never reference columns dropped by later migrations.
---

Replit's Publish flow diffs dev vs prod schemas and applies the diff **before** the app boots. Consequences for this project's Drizzle boot-time migration runner:

- The rule: after a publish, prod schema equals *current* dev schema, but the migration tracker may lag. Pending migrations then run against a schema that already has all later changes applied.
- **Why:** a deploy failed silently because a seed INSERT in one migration referenced a column that a later migration drops — the publish diff had created the table without that column, so the INSERT failed and the API server died before its first log line (its first log prints only after migrations complete). Deployment logs showed only healthcheck 500s.
- **How to apply:** every migration must be idempotent AND must not reference columns/tables that any later migration removes or renames. Seed data is never carried by the publish diff — only schema — so seeding must live in migrations and use ON CONFLICT DO NOTHING.
- Also: FK constraints that depend on seed data can never be applied by the publish diff (it creates tables empty). If the diff tries, publish fails validation. Workaround used: drop the FK in the dev DB before publishing, let boot migration 0011 add it in prod (seed first, then FK), then re-add it in dev.
- Debugging tip: reproduce prod state locally by dumping dev schema into a scratch DB, copying the drizzle tracker, and deleting the trailing tracker rows; then boot the production bundle against it.
