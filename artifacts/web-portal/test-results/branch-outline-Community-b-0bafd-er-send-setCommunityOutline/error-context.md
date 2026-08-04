# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: branch-outline.spec.ts >> Community boundary outline — branch detail tab switching >> no outline layer: tab switches complete without JS errors and never send setCommunityOutline
- Location: tests/branch-outline.spec.ts:244:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /home/runner/workspace/.cache/ms-playwright/firefox-1538/firefox/firefox
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     pnpm exec playwright install                           ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```