---
name: Live account scope
description: Why removing an assignment must also invalidate legacy session scope fallbacks.
---

A null community or organization assignment in the live database record means that scope was removed, not that an older login-time value can be used.

**Why:** Updating permission guards alone does not prevent legacy handlers from restoring access through a session fallback when the current assignment is null. This can permit writes to a former community even while non-null reassignment tests pass.

**How to apply:** Any live-permission change must cover both non-null reassignment and direct removal to null with an existing cookie. Keep legacy session scope synchronized or cleared while such consumers remain; do not remove that compatibility protection merely because the guards use the current user.
