import { defineConfig, devices } from '@playwright/test';
import { E2E_APP_TITLE } from './tests/e2e/constants.ts';
import { E2E_SERVER_PORT } from './tooling/ports.ts';

const isCI = Boolean(process.env.CI);
const BASE_URL = `http://localhost:${E2E_SERVER_PORT}`;
const CI_RETRIES = 2;
const CI_WORKERS = 1;
const WEB_SERVER_TIMEOUT_MS = 120_000;
/**
 * Share of a frame allowed to differ from its screenshot baseline, for every comparison.
 *
 * A settled scene is compared, so a real change is far larger than this; what it absorbs is
 * the single-pixel noise a software WebGL rasteriser leaves along the edges of the geometry.
 */
const MAX_DIFF_PIXEL_RATIO = 0.01;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? CI_RETRIES : 0,
  workers: isCI ? CI_WORKERS : undefined,
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
    toHaveScreenshot: { maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO },
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
