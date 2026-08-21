---
name: Layer colour vs pin-default duplication
description: Where map/layer colours actually live, why one hex change touches several copies, and which copy is dead code.
---

## Rule
A layer or asset-type colour change is never a one-line edit. Two *different* tables are involved, and one of them is duplicated four ways:

1. **Layer palette** — the `MAP_LAYER_DISPLAY` constant in the API server's storage module. Single source; feeds both the portfolio-analytics asset-type payload (`layerColor` per entry) and the branch-map `layerCounts`. Changing it here is enough for both consumers.
2. **Per-asset-type pin defaults** — a separate `subLayerKey → hex` table that is copied into: the shared browser map renderer, the portfolio branch-detail page, the portal map legend, and the shared `layer-colors` workspace lib. The lib copy is the one that also reaches the mobile app and, via `getDefaultLayerColor`, decides what colour gets **stored** on newly created map layer records.

**Why:** the two tables happen to share some hexes, so a naive grep-and-replace looks complete while leaving the lib copy (and therefore mobile + newly stored DB colours) on the old value. Stored `map_layers.color` always wins over the pin default, so an org that already has stored colours will keep showing the retired palette even after a correct code change.

**How to apply:** when repointing a colour, edit the layer palette *and* every pin-default copy including the lib; then rebuild both the api-server and web-portal dists (each bakes its own copy) before trusting a hex sweep. Verify rendering against an org with **no** stored layer colours.

## Dead copy
A second, unserved copy of the portal map legend lives under the API server's `src/public/` tree. The API server registers no static middleware and its dist contains no public directory, so this copy is never served — but keep it in step so hex sweeps stay honest.

## Layout gotcha
The analytics layer bands switch between a two-column grid (wide) and a flex column (narrow). `align-items: start` set for the grid mode leaks into the flex mode as cross-axis start, which shrink-wraps the nested card grid to a single column. The narrow-screen media query must reassert `align-items: stretch`.
