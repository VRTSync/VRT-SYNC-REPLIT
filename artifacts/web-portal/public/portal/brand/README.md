# VRTSync web brand asset handoff

This directory is the single handoff location for the web portal brand assets.
The artwork is sourced from the approved mobile exports already present in this
workspace:

- `artifacts/vrtsync-mobile/assets/images/vrtsync-logo.png` — horizontal
  lockup, 710 × 215 px, RGBA with transparency.
- `artifacts/vrtsync-mobile/assets/images/vrtsync-logo-vertical.png` —
  stacked lockup/mark source, 720 × 720 px, RGBA with transparency.

The SVG lockups embed the supplied horizontal PNG byte-for-byte as image data.
They do not trace, recolor, or approximate the logo. `mark.svg` uses the
mark-only crop from the upper portion of the supplied stacked export.

## Files and intended dimensions

| File | Intended use | Intrinsic/export dimensions |
| --- | --- | --- |
| `logo-dark.svg` | Dark-ink lockup on light surfaces | 710 × 215 viewBox |
| `logo-light.svg` | Web lockup handoff alias; validate against an approved inverse lockup before using on dark surfaces | 710 × 215 viewBox |
| `mark.svg` | Mark-only lockup for compact UI and browser icons | 369 × 446 viewBox |
| `favicon-16.png` | Browser tab fallback | 16 × 16 px |
| `favicon-32.png` | Browser tab / Windows shortcut icon | 32 × 32 px |
| `favicon-48.png` | Larger browser/OS icon | 48 × 48 px |
| `favicon.ico` | Multi-size legacy browser fallback | 16, 32, and 48 px entries |
| `apple-touch-icon.png` | iOS/iPadOS home-screen icon | 180 × 180 px |

The favicon exports use the mark only, centered with transparent padding. Keep
the 180 × 180 Apple touch icon at its native size; do not substitute the
wordmark at small sizes.

## Contrast and validation guidance

- Use `logo-dark.svg` only on a light surface. The dark navy `VRT` lettering
  must remain distinguishable from its background.
- The supplied horizontal export contains dark navy lettering and is not an
  inverse white lockup. Do not place it directly on the portal's navy sidebar.
  `logo-light.svg` is included as the named handoff slot, but must be replaced
  with the separately approved inverse artwork before dark-surface
  implementation. Do not create that inverse with CSS filters or code.
- For any authenticated dark sidebar, validate the final approved lockup at
  its intended approximately 32 px rendered height and require at least 3:1
  non-text/brand contrast against the sidebar background.
- Preserve the SVG aspect ratios and explicit image dimensions to avoid
  layout shift. Do not crop or stretch the lockups.
- The current approved social preview remains
  `artifacts/web-portal/public/opengraph.jpg` (1280 × 720 JPEG). It is the
  existing login/share image and should be referenced as the portal's absolute
  Open Graph image URL until a replacement is approved.

## Source audit

The current portal copies are byte-identical to the mobile sources:

- `public/portal/logo.png` = `vrtsync-logo.png` (710 × 215)
- `public/portal/favicon.png` = `vrtsync-logo-vertical.png` (720 × 720)

Those legacy portal-local files are intentionally left in place for the
existing runtime until the branding implementation migrates every reference
to this shared directory. They should be removed only in that follow-up
implementation, after checking both source and built `dist/public` output.