import { defineConfig, devices } from '@playwright/test';
import { E2E_APP_TITLE } from './tests/e2e/constants.ts';
import { E2E_SERVER_PORT } from './tooling/ports.ts';

const isCI = Boolean(process.env.CI);
const BASE_URL = `http://localhost:${E2E_SERVER_PORT}`;
const CI_RETRIES = 2;
const CI_WORKERS = 1;
/**
 * Workers to run the suite with locally: one, the same as CI.
 *
 * Every test renders the whole floor through a software WebGL rasteriser, so each one is
 * CPU-bound rather than waiting on anything, and one browser alone drives this machine's load
 * average to about 10. Measured: Playwright's default (half the cores) starves three of the
 * heavy interactive tests until `locator.screenshot` hits the 90 s test timeout, and two
 * workers starve the same three while taking the load average from 3 to 20. Each of them
 * passes alone well inside its budget — the slowest in 45 s.
 *
 * So the suite is serial, which costs wall-clock and buys two things: a run that does not
 * compete with itself, and a local result that predicts CI, where the worker count is the
 * same. No test timeout is raised to hide the contention.
 */
const LOCAL_WORKERS = 1;
const WEB_SERVER_TIMEOUT_MS = 120_000;
/**
 * Pixels two renders of the same scene may differ by before a baseline comparison fails.
 *
 * A COUNT, not a ratio, and that is the point of it. The old rule was a 1 % diff-pixel
 * ratio, which reads as a small number and means 9 216 pixels of a 1280 × 720 frame —
 * room for a corner of the building to move unnoticed. It did: `exterior-default` was
 * written at `1351df3` and went untouched through `b333280`, the commit that rebuilt the
 * whole floor on a new source of truth, because the frame it produced was inside 1 % of
 * the frame before it. A ratio also rescales with the viewport, so the same number quietly
 * means something different at another size; a count does not.
 *
 * **Measured, on this machine, on 2026-09-19: the noise floor is zero.** Both baselines
 * were regenerated with the HUD hidden rather than masked, and then compared 20 times over
 * with this value set to 0 — all 20 passed. The software rasteriser is deterministic here,
 * so there is no per-run noise to accommodate at all.
 *
 * 200 is therefore a deliberate cushion rather than a measured tolerance: about 0.02 % of
 * the frame, against the 9 216 the ratio allowed, and enough that a Mesa or driver update
 * that shifts a few edge pixels reports a diff to look at instead of a red suite with no
 * diagnosis. Shipping the measured 0 would have been the more precise lie.
 *
 * A loaded sample was attempted and abandoned: driving the machine to a load average near
 * 30 makes the heavy interactive tests starve for reasons that have nothing to do with
 * rendering (`docs/RUNBOOK.md` already records that), so it measures the machine and not
 * the picture. Re-measuring is a matter of re-running the idle protocol above.
 */
const MAX_DIFF_PIXELS = 200;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? CI_RETRIES : 0,
  workers: isCI ? CI_WORKERS : LOCAL_WORKERS,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  /** Baselines are committed next to the specs, one per project and platform. */
  snapshotPathTemplate:
    'tests/e2e/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  /**
   * On CI a missing baseline is a failure, never a new baseline: `'none'` keeps a run from
   * silently writing one and reporting green. Locally, a missing baseline is written.
   */
  updateSnapshots: isCI ? 'none' : 'missing',
  expect: {
    toHaveScreenshot: { maxDiffPixels: MAX_DIFF_PIXELS },
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: WEB_SERVER_TIMEOUT_MS,
    env: {
      PREVIEW_SERVER_PORT: String(E2E_SERVER_PORT),
      VITE_APP_TITLE: E2E_APP_TITLE,
    },
  },
});
