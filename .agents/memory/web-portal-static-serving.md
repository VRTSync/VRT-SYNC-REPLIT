---
name: Web-portal dev server serves a built copy
description: Why edits to web-portal public/ or templates/ don't take effect until the workflow restarts.
---

## Rule
The web-portal `dev` script runs a build that copies `public/` and `templates/` into `dist/`, and the server serves from `dist/`. Edits to files under `artifacts/web-portal/public/` or `templates/` are NOT live — restart the Web Portal workflow (which rebuilds) before browser-testing changes.

**Why:** Playwright tests exercised stale behaviour after editing `public/portfolio/*.js`; the fix appeared "not working" until a workflow restart rebuilt `dist/`.

**How to apply:** after any static-asset or template change in web-portal, restart `artifacts/web-portal: Web Portal` before verifying in a browser or test.
