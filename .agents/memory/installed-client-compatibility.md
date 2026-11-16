---
name: Installed-client compatibility
description: Why API hardening must tolerate extra fields from existing mobile installations.
---

Unknown JSON fields must be stripped, not rejected, unless the user's contract explicitly requires otherwise.

**Why:** The user states that installed mobile clients send extra fields. Strict rejection would break those installations even when their ordinary request fields remain valid.

**How to apply:** When hardening API request handling, allow older payloads through while selecting only supported fields for persistence and policy decisions.
