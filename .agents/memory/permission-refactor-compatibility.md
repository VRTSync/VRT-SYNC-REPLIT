---
name: Permission refactor compatibility
description: User-approved compatibility constraints when extracting authorization policies.
---

Authorization extraction must preserve existing endpoint differences rather than silently replacing them with stricter general community-access rules. The later approved unassigned-HOA security slice supersedes the old unassigned-user exceptions described below.

**Why:** The user explicitly approved preserving the task list versus page-data discrepancy for HOA accounts without an assigned community. Page-data historically skips the membership check for both HOA roles; the ordinary task list still checks requested-community membership when the HOA assignment is null. Normalizing this during a behavior-preserving refactor would change access.

**How to apply:** Preserve assigned-HOA task behavior; unassigned HOA users are now denied on both task surfaces, including retained memberships and cached grants. Do not restore the former compatibility exception.

Existing test assertions and expected values remain immutable during behavior-preserving permission extraction.

**Why:** The user approved adapting source-loading, bundling and mock fixtures for the task-route extraction, but did not approve weakening the regression expectations.

**How to apply:** Route moves can require harness changes so tests still execute real production handlers and policies. Preserve every existing assertion and expected response while updating that setup.

The former requirement to retain HOA submission and portfolio/invoice organization session fallbacks applied only during the behavior-preserving extraction; the approved security slice explicitly removed them.

**Why:** The user explicitly scoped these known stale-session access gaps out of this extraction. Removing them here would combine a security behavior change with a structural refactor.

**How to apply:** Permissions must use current user scope only. Preserve authentication session synchronization, but never reintroduce session-scope consumers in routes or policies.

Asset reads, layer lists, layer GeoJSON and offline packs retain the narrower “admin or community membership row” rule for assigned HOA and other roles, rather than granting access from an HOA assignment or commercial organization alone. Layer summaries intentionally use the broader general community rule. Unassigned HOA actors are denied membership grants even when rows remain. Note deletion now requires admin, or author plus current asset-community access.

**Why:** The user explicitly designated these differences as intentional compatibility constraints, with consistent asset/map access deferred to a product decision and former-member note deletion deferred to a security slice.

**How to apply:** Keep asset/map-data decisions separate from general community access; do not make layer summaries use the narrower rule. Preserve the approved unassigned-HOA denial and former-note-author protection during later refactors.
