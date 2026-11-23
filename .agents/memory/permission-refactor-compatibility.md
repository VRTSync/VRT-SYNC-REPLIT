---
name: Permission refactor compatibility
description: User-approved compatibility constraints when extracting authorization policies.
---

Authorization extraction must preserve existing endpoint differences rather than silently replacing them with stricter general community-access rules.

**Why:** The user explicitly approved preserving the task list versus page-data discrepancy for HOA accounts without an assigned community. Page-data historically skips the membership check for both HOA roles; the ordinary task list still checks requested-community membership when the HOA assignment is null. Normalizing this during a behavior-preserving refactor would change access.

**How to apply:** Give policy decisions enough endpoint context to retain existing behavior. Treat any intentional access change as a separate, explicitly approved security slice.

Existing test assertions and expected values remain immutable during behavior-preserving permission extraction.

**Why:** The user approved adapting source-loading, bundling and mock fixtures for the task-route extraction, but did not approve weakening the regression expectations.

**How to apply:** Route moves can require harness changes so tests still execute real production handlers and policies. Preserve every existing assertion and expected response while updating that setup.

During behavior-preserving permission extraction, retain the legacy HOA submission and portfolio organization session fallbacks, even when the current user record has no assignment.

**Why:** The user explicitly scoped these known stale-session access gaps out of this extraction. Removing them here would combine a security behavior change with a structural refactor.

**How to apply:** Preserve the HOA logical-OR fallback and portfolio nullish fallback exactly. Close either gap only in a separately approved security change.

Asset reads, layer lists, layer GeoJSON and offline packs must retain the narrower “admin or community membership row” rule, rather than granting access from an HOA assignment or commercial organization alone. Layer summaries intentionally use the broader general community rule. Asset-note deletion retains author-or-admin access without a current membership check.

**Why:** The user explicitly designated these differences as intentional compatibility constraints, with consistent asset/map access deferred to a product decision and former-member note deletion deferred to a security slice.

**How to apply:** Keep asset/map-data decisions separate from general community access; do not make layer summaries use the narrower rule. Do not broaden reads or tighten note deletion as part of structural refactors.
