/**
 * The screenshots the README shows, captured from the running app on demand.
 *
 * **Not a test, and not part of any gate.** It writes files, which no test may do, so it is
 * skipped unless `CAPTURE_DOCS` is set and it asserts nothing about what it captures. Run it
 * with `pnpm capture:docs` after a change that alters what the app looks like.
 *
 * Why it does not reuse the committed baselines in `exterior.spec.ts`. Those are captures of
 * the canvas with the HUD hidden, pinned to `chromium-linux` and regenerated whenever the
 * geometry, the palette, the lighting or the camera moves. Using them as documentation images
 * would show a product with no interface at all, and would silently rewrite the README every
 * time a baseline is renewed — coupling a document to a fixture whose whole job is to change
 * when the scene does. These are separate captures, of the **whole page with the HUD visible**,
 * which is what a reader of the README is trying to see.
 *
 * What it does borrow is the settle rule: {@link captureSettledScene} waits for the camera
 * flight to finish and then for two consecutive frames to come back byte-identical, so a
 * documentation image is never a frame of a moving camera or a half-drawn scene. Software
 * WebGL can leave seconds between two frames, so that wait is the whole reason this is a
 * Playwright spec rather than a screenshot taken by hand.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { CAMERA_TOGGLE_NAME, VIEW_TOGGLE_NAME } from './constants.ts';
import { captureSettledScene, expectCanvasVisible, getViewRegion } from './sceneCapture.ts';

/** Where the README looks for them. Relative to the repository root, as Playwright runs from it. */
const IMAGE_DIRECTORY = path.join('docs', 'images');

/**
 * The viewport the documentation is shot at: wide enough for the desktop HUD, and the same
 * 16:9 the exterior framing is tuned for, so the building fills the frame the way ADR-008
 * describes rather than being cropped by an arbitrary window.
 */
const DOCS_VIEWPORT = { width: 1280, height: 720 };

/**
 * Captures write files, so they run only when asked for by name.
 *
 * Guarded at describe level rather than per test: a run that forgets the flag should do
 * nothing at all rather than three quarters of the job.
 */
const isCapturing = process.env.CAPTURE_DOCS === '1';

/**
 * Hides the Leva tweak panel, and only it.
 *
 * The end-to-end build runs with the debug flag on, so Leva mounts — and it is a development
 * control for the lighting factors (ADR-009), not part of the product. A reader of the README
 * should see the HUD the app ships with and nothing else. The HUD itself stays visible: that is
 * the whole difference between these captures and the committed baselines, which hide it.
 */
const HIDE_DEBUG_PANEL = '#leva__root { display: none !important; }';

test.describe('documentation screenshots', () => {
  test.skip(!isCapturing, 'set CAPTURE_DOCS=1 (pnpm capture:docs) to write the README images');
  test.use({ viewport: DOCS_VIEWPORT });
  // Every shot waits for a settled scene under a software rasteriser, three times over.
  test.slow();

  test('captures the exterior, the interior and the room menu', async ({ page }) => {
    await mkdir(IMAGE_DIRECTORY, { recursive: true });
    await page.goto('/');
    await expectCanvasVisible(page);

    // 1. The whole floor from outside, in the default frame the camera derives for this aspect.
    await captureSettledScene(page);
    await page.screenshot({
      path: path.join(IMAGE_DIRECTORY, 'exterior.png'),
      style: HIDE_DEBUG_PANEL,
    });

    // 2. Standing inside, first person, at the stair arrival the interior always opens on.
    await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();
    await expect(getViewRegion(page)).toBeVisible();
    await captureSettledScene(page);
    await page.screenshot({
      path: path.join(IMAGE_DIRECTORY, 'interior-first-person.png'),
      style: HIDE_DEBUG_PANEL,
    });

    // 3. The room list open, which is the one piece of the HUD a still picture can explain.
    //    Third person first: a picture of a walk is more legible with the walker in it.
    await page.getByRole('button', { name: CAMERA_TOGGLE_NAME }).click();
    await captureSettledScene(page);
    await page.getByRole('button', { name: 'Go to room' }).click();
    await page.screenshot({
      path: path.join(IMAGE_DIRECTORY, 'room-menu.png'),
      style: HIDE_DEBUG_PANEL,
    });
  });
});
