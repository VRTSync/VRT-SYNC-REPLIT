---
name: Transactional database test fixtures
description: Preserve outer rollback when production storage begins explicit Drizzle transactions.
---

Tests that issue raw BEGIN on a pg client and wrap it in a fresh drizzle(client) do not make Drizzle aware of the outer transaction.

**Why:** Adding db.transaction in production storage can issue another BEGIN followed by COMMIT, committing test fixtures instead of keeping them inside the intended rollback.

**How to apply:** When a production path becomes transactional, check its PostgreSQL test harness too. Provide nested savepoints or run the fixture inside a real Drizzle transaction; do not assume a raw outer BEGIN protects fixtures from inner transaction commits.

Partial-success contract imports must retain their per-row success behavior even when the overall multi-table operation becomes transactional.

**Why:** The user approved transaction handling specifically on the condition that successful imported rows continue to survive individual row failures; an all-or-nothing import would change existing behavior.

**How to apply:** Use a savepoint for each recoverable row inside the outer transaction. A failed PostgreSQL statement otherwise aborts the transaction and prevents subsequent rows from succeeding.
