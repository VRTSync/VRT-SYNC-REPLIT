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
