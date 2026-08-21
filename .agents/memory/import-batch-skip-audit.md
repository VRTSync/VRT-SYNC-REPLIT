---
name: Import batch skip audit
description: Import batch records must persist which rows were skipped and why, not just aggregate counts.
---

# Import batch skip audit

**Rule:** an import batch record must persist the structured per-row skip
report (excel row + reason) and any codes an operator explicitly acknowledged,
alongside the aggregate inserted/skipped counts.

**Why:** aggregate counts cannot answer the question people actually ask
months later -- "why is this property missing from this billing period?" The
source spreadsheet is long gone by then, and an operator's deliberate decision
to skip a property is indistinguishable from a bug unless it was recorded at
the time it was made.

**How to apply:** merge the parse-stage skips (unknown code, unparseable
amount, sentinel rows) with operator-acknowledged skips into one list sorted
by source row, and write it to the batch record in the same transaction as the
inserts. Show that same unified list in the post-import summary, and preview
it live as the operator ticks acknowledgements so the pre-commit numbers and
the post-commit report never disagree.
