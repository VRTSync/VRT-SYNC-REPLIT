---
name: Custom-layer map fitting
description: Shared map viewport fitting must include only custom layers currently shown by the renderer.
---

## Rule
The shared renderer's viewport fit must combine its normal community/controller geometry with geometry from custom layers that are currently shown. Hidden custom layers must not influence bounds.

**Why:** portfolio branch pins are custom layers, not regular community layers. Ignoring them leaves the portfolio at the continental default, while including hidden historical filter layers makes refits frame locations the user filtered out.

**How to apply:** when adding a custom layer, retain its geometry in renderer state; when showing custom layers, update the visible-ID set; have the existing fit path walk only that visible custom geometry alongside its original sources.