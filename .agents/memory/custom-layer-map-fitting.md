---
name: Custom-layer map fitting
description: Shared map viewport fitting must include only custom layers currently shown by the renderer.
---

## Rule
The shared renderer's viewport fit must combine its normal community/controller geometry with geometry from custom layers that are currently shown. Hidden custom layers must not influence bounds.

**Why:** portfolio branch pins are custom layers, not regular community layers. Ignoring them leaves the portfolio at the continental default, while including hidden historical filter layers makes refits frame locations the user filtered out.

**How to apply:** when adding a custom layer, retain its geometry in renderer state; when showing custom layers, update the visible-ID set; have the existing fit path walk only that visible custom geometry alongside its original sources.

## The zoom cap lives in the Leaflet bridge, not the caller
Every fit command in the shared Leaflet template applies a community-scale max-zoom ceiling. Correct bounds therefore do **not** guarantee a close view: a single commercial property is small enough that the fit is clipped and the site renders as a speck centred in the panel.

**Why:** the ceiling was chosen for HOA-sized communities, where it never binds. It silently binds on single-site surfaces, which looks like a broken fit rather than a cap — expect to lose time hunting for bad bounds that are in fact correct.

**How to apply:** diagnose by comparing the rendered scale against the cap before suspecting the bounds maths. Surfaces showing one property pass a closer per-instance cap through the renderer; leave the bridge default alone so community and multi-location surfaces are unaffected. The cap must reach both the outline fit and the visible-content fallback, or a property with no outline stays zoomed out.