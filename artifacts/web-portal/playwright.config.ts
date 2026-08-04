import { defineConfig } from '@playwright/test';
import { existsSync } from 'fs';

/**
 * Playwright configuration for web-portal browser-level tests.
 *
 * Run:  pnpm --filter @workspace/web-portal test
 *
 * The tests rely on the web-portal dev server being reachable at its
 * configured PORT (defaults to 3100 locally, but driven by $PORT in the
 * Replit environment).  Set the env var before running if needed:
 *
 *   PORT=3100 pnpm --filter @workspace/web-portal test
 *
 * Browser resolution order:
 *   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var (CI override)
 *   2. NIX_CHROMIUM env var (Replit Nix-managed binary)
 *   3. System chromium at the known Nix store path
 *   4. Playwright's own downloaded binary (default)
 */

const NIX_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  process.env.NIX_CHROMIUM ||
  '/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 3100}`,
    browserName: 'chromium',
    // Use the Nix-managed Chromium in Replit where the downloaded playwright
    // binary lacks required system libraries.  Falls back gracefully when the
    // path does not exist (e.g. local dev machines or CI with their own binary).
    // NOTE: executablePath must live under launchOptions — a top-level
    // use.executablePath is silently ignored by @playwright/test.
    ...(existsSync(NIX_CHROMIUM) ? { launchOptions: { executablePath: NIX_CHROMIUM } } : {}),
  },
  // Run tests in a single worker to avoid port contention during CI.
  workers: 1,
});
