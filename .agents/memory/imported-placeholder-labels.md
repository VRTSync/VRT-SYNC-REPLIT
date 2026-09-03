---
name: Imported placeholder labels
description: How generic GeoJSON names should interact with corrected canonical asset labels.
---

Treat `Untitled polygon` as an absent source label, not as authoritative asset identity. A useful source label may be surfaced, but a generic source value must not overwrite a corrected canonical asset label during layer synchronization.

**Why:** The PNC bluegrass source retained stable feature references and geometry but supplied `Untitled polygon` for every feature. Re-syncing that layer would otherwise erase stable, location-distinguishable names.

**How to apply:** When importing, syncing, or resolving GeoJSON labels, trim candidate values, reject the generic placeholder, preserve an existing canonical label on sync, and use a deterministic generated fallback only when neither source nor asset has a usable name.