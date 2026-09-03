---
name: Map renderer 'ready' event semantics
description: Why page code must treat the shared map renderer's 'ready' event as late/replayable, never as "page just loaded".
---

## Rule
Any consumer of the shared map renderer's `ready` event must treat it as "data applied (possibly late or again)", not "page just loaded". Handlers must never unconditionally reset UI state (active tab, sub-layer selections, category) or refit the viewport; first-load behaviour must be single-shot, and later `ready` must restore the user's current selections without a refit. Listener/overlay registration belongs in the page-render path, never inside a `ready` handler (a re-emitted `ready` would attach duplicates).

**Why:** the leaflet iframe announces readiness on a retry schedule (up to several seconds), so `ready` can arrive after the user has already switched tabs, toggled sub-layers, or panned — an unconditional reset replays first-load behaviour and destroys their state. This caused the branch-detail "snaps back to Summary" defect.

**How to apply:** guard first-load behaviour with a single-shot flag scoped to the page render; on later `ready`, reapply the current tab/category/sub-layer state using the non-fitting restore options; register DOM listeners once in the render path.

## Related gotcha
`use.executablePath` at the top level of a Playwright test config is silently ignored — it must live under `use.launchOptions`.

Custom layers are not part of the renderer's fetched `_mapLayers`, so `fit()` cannot derive their bounds. Consumers that display only custom geometry must calculate its bounds and send `fitBounds` explicitly. Set `directTap: true` when custom features should select immediately rather than opening the standard detail popup.
