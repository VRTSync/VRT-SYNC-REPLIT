import { defineConfig } from '@playwright/test';

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
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 3100}`,
    // All postMessage / iframe interactions are same-origin — no special
    // permissions needed beyond the default browser context.
    browserName: 'firefox',
  },
  // Run tests in a single worker to avoid port contention during CI.
  workers: 1,
});
