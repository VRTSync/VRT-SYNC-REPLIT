---
name: Reusing one pg placeholder across differently-typed columns
description: Why $n reused for two columns of different types fails at parse time in raw pg queries
---

In a raw `pg` query, do not reuse a single `$n` placeholder for two columns of
different types. Postgres deduces one type per parameter, so
`VALUES (..., $10, $10, ...)` where one target is `date` and the other is
`timestamp` fails at parse time with:

`42P08 inconsistent types deduced for parameter $10 — date versus timestamp
without time zone`

Cast at each use site (`$10::date`, `$10::timestamp`) or pass the value twice
as separate parameters.

**Why:** it looks like a harmless de-duplication and it type-checks fine in
TypeScript, so it survives review; the failure only appears when the statement
actually executes against the real schema. In an import path that nobody had
run end-to-end, it sat there silently making the whole commit impossible.

**How to apply:** whenever you write a multi-column INSERT by hand and are
tempted to reuse a placeholder, check the two columns' SQL types first — the
window/due-date pairs in this schema are exactly the mismatched case (`date`
vs `timestamp`).
