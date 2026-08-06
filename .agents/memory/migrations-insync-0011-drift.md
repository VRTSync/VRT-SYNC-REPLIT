---
name: Migration file hashes are immutable once applied
description: Editing an applied migration file breaks the inSync status endpoint forever
---

Never edit a migration file after it has been applied — the stored hash in `drizzle.__drizzle_migrations` no longer matches, the runner silently skips it (its journal `when` is in the past), and the admin migrations status endpoint reports drift/`inSync: false` permanently.

**Why:** One historical migration was edited post-apply, so the status endpoint can never go green; treating that as a fresh failure wastes debugging time on every subsequent migration task.

**How to apply:** When verifying a new migration, confirm *your* tag is in the applied list and the row count grew — do not chase pre-existing drift. If you must amend a not-yet-deployed migration that dev already applied, make it idempotent and update dev's stored hash in the same change.
