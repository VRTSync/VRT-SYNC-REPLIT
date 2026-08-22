---
name: Portfolio analytics Tier 1 scope rules
description: Which controls drive the analytics KPI row vs the per-layer cards, and how layer shares are kept at 100%.
---

## Rule
On the portfolio Analytics page, row 1 (portfolio KPIs) is driven by the group-filter chips only and ignores layer focus; row 2 (one card per layer) is what layer focus narrows. Layer shares use a single denominator - the assets across the *rendered* layers - so they always read 100%, and they are computed with the largest-remainder method rather than plain rounding.

**Why:** mixing the two scopes made the KPI row and the layer row disagree (portfolio totals shrinking while the headline said "total"), and naive per-layer rounding produced 99% or 101% totals that read as a bug. A single denominator also avoids a second percentage family that users cannot reconcile.

**How to apply:** when adding a metric to Tier 1, decide first which row it belongs to - portfolio-wide figures ignore layer focus, per-layer figures respect it. Never round shares independently; keep the largest-remainder pass so they sum to exactly 100.

## Related
Coverage of missing sqFt values surfaces only on the Managed Area KPI and on the affected area-layer card - there is no other place in the UI that reports partial measurement, so a redesign of these cards must carry the caveat forward.
