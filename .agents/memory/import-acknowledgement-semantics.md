---
name: Import acknowledgement semantics
description: How the two admin importers treat an acknowledged unmatched pilot code, and why their totals behave differently
---

Both admin importers (master bill, seasonal contract) validate against the same
fixed pilot allowlist. When a listed code has no community row, it is surfaced
as a structured unmatched entry with a per-code checkbox — never as a blocking
error string, and never as a bulk "skip all" control.

**Rule: acknowledging changes the numbers for the master bill, and must change
nothing for the seasonal importer.**

**Why:** the master bill imports *rows keyed by code*, so excluding a code
removes its rows and dollars — the preview totals have to follow or they
misrepresent what will be written. The seasonal importer expands a fixed
programme across the communities that *resolved*, so its projections are
already computed for the short portfolio; recalculating on acknowledgement
would double-count the exclusion. A changed seasonal figure after ticking a
box is a bug, not a feature.

**How to apply:** when touching either preview, keep the acknowledgement
handler for the seasonal side limited to re-labelling/enabling the commit
button. Label the scope of the seasonal totals ("Projected for N of M pilot
locations") instead of adjusting them.

Related invariants worth preserving:

- The unresolvable code stays in the allowlist. Removing it moves the failure
  to the parse/expansion stage where no acknowledgement UI can surface it, and
  the exclusion vanishes from the audit trail.
- Only "no matching community" is acknowledgeable. Ambiguous codes, cross-org
  spans, and layout assertion failures remain hard blocks.
- Commit re-derives resolution in its own transaction and requires
  resolved + acknowledged to cover the whole allowlist; short of that it
  aborts rather than importing partially.

**Fixture note:** among the three master-bill workbooks, only the May 2026 one
contains a row for the unresolvable branch. Previewing June or July shows no
acknowledgement panel at all — that is correct behaviour, not a regression, and
it is an easy way to waste a test cycle.
