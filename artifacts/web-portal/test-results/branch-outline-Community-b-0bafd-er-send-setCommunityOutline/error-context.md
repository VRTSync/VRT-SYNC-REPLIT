# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: branch-outline.spec.ts >> Community boundary outline — branch detail tab switching >> no outline layer: tab switches complete without JS errors and never send setCommunityOutline
- Location: tests/branch-outline.spec.ts:244:3

# Error details

```
Error: browserType.launch: 
╔══════════════════════════════════════════════════════╗
║ Host system is missing dependencies to run browsers. ║
║ Please install them with the following command:      ║
║                                                      ║
║     sudo pnpm exec playwright install-deps           ║
║                                                      ║
║ Alternatively, use apt:                              ║
║     sudo apt-get install libxcb-shm0\                ║
║         libx11-xcb1\                                 ║
║         libxrandr2\                                  ║
║         libxcomposite1\                              ║
║         libxcursor1\                                 ║
║         libxdamage1\                                 ║
║         libxi6\                                      ║
║         libxext6\                                    ║
║         libxfixes3\                                  ║
║         libx11-6\                                    ║
║         libxcb1\                                     ║
║         libgtk-3-0t64\                               ║
║         libpangocairo-1.0-0\                         ║
║         libpango-1.0-0\                              ║
║         libatk1.0-0t64\                              ║
║         libcairo-gobject2\                           ║
║         libcairo2\                                   ║
║         libgdk-pixbuf-2.0-0\                         ║
║         libglib2.0-0t64\                             ║
║         libxrender1\                                 ║
║         libasound2t64\                               ║
║         libdbus-1-3                                  ║
║                                                      ║
║ <3 Playwright Team                                   ║
╚══════════════════════════════════════════════════════╝
```