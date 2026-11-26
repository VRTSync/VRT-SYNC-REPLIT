---
name: Live account scope
description: Why removing an assignment must also invalidate legacy session scope fallbacks.
---

A null community or organization assignment in the live database record means that scope was removed, not that an older login-time value can be used.

**Why:** Updating permission guards alone does not prevent legacy handlers from restoring access through a session fallback when the current assignment is null. This can permit writes to a former community even while non-null reassignment tests pass.

**How to apply:** Any live-permission change must cover both non-null reassignment and direct removal to null with an existing cookie. Keep legacy session scope synchronized or cleared while such consumers remain; do not remove that compatibility protection merely because the guards use the current user.

For HOA security hardening, an empty community assignment must deny community-scoped access even if membership rows remain.

**Why:** On 2026-11-26, the user explicitly approved covering leftover memberships rather than limiting the security change to the individually listed policy rules. Removal of one assignment must not leave another membership-based path available.

**How to apply:** Treat the live HOA assignment as required, not interchangeable with membership or a cached membership grant. Include retained-membership cases in security regression tests while preserving assigned HOA and non-HOA behavior. This approved security scope is an intentional exception to the earlier F3 behavior-preservation constraints, not a claim that the planned hardening has already shipped.
