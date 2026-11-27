---
name: Incremental React rollout scope
description: Approved coexistence and staff task-link boundaries for the React shell rollout.
---

The React rollout is incremental: the new frame at `/app` must coexist with the working `/web` portal. Do not move users to it automatically or replace existing screens until a later explicitly approved cutover.

**Why:** The user's R1 brief keeps current screens working while subsequent slices replace them individually; clients retain their separate portfolio and Map Creators remain mobile-only.

**How to apply:** Keep shell navigation pointed at working legacy screens until their replacements are approved. Do not treat completing the frame as authorization for cutover.

Staff task search results and notifications may receive narrowly scoped support in the existing community Tasks view so they open the correct selected task.

**Why:** On 2026-11-26 the user explicitly approved this exception after inspection found the proposed standalone staff Tasks destination was not registered.

**How to apply:** Implement community-task deep linking without introducing a standalone staff Tasks page, restoring the excluded Create Task menu item, or changing API permissions. This records approved scope, not a claim that the shell or link support has shipped.
