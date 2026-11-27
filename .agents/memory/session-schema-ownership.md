---
name: Session schema ownership
description: Why sessions are migration-owned and excluded from Drizzle push
---

Keep the session table migration-owned and excluded from Drizzle schema push
unless a future tooling change demonstrably preserves its existing constraint.

**Why:** The installed drizzle-kit introspector treats a single-column primary
key as an inline column property and discards its custom constraint name. An
explicitly named table-level primary key therefore produces a read-only push
proposal that drops and re-adds the same constraint. An inline declaration
cannot describe the legacy custom name exactly. Do not normalize live
constraints merely to satisfy tooling.

**How to apply:** Preserve the session-table exclusion in the database tooling
configuration and keep its generation snapshots migration-owned. Before
adopting an ORM declaration or upgrading tooling, preview generation and a
read-only live diff; never call the diff's apply function or run a mutating push
to inspect it. Stop for any proposed session table/constraint drop, recreation
or rename, including during the supported user-triggered Publish review.
