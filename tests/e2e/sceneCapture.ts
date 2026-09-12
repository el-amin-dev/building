/**
 * Shared canvas-capture helpers for the end-to-end specs.
 *
 * Every frame comparison in `exterior.spec.ts`, `navigation.spec.ts` and
 * `remoteControl.spec.ts` needs the same two things: a screenshot of the canvas with the
 * whole HUD masked, so only the rendered scene is compared, and a way to wait until the
 * scene is at rest before comparing it. They live here so the specs share one definition of
 * "the scene" and one set of budgets, rather than a copy each.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { CAMERA_TRANSITION_ATTRIBUTE, CAMERA_TRANSITION_IDLE } from './constants.ts';

/** Upper bound for the scene to stop changing between two consecutive canvas captures. */
export const SETTLE_TIMEOUT_MS = 15_000;
/** Delay between consecutive captures while waiting for the scene to settle. */
export const SETTLE_POLL_INTERVAL_MS = 250;
/**
 * Upper bound for a held key or pad button to produce a visible change in the rendered frame.
 *
 * As generous as the settle budget, and for the same reason: the scene draws the whole
 * floor, so a frame costs far more than it did for the single interim chamber this budget
 * was first tuned for, and under software WebGL with parallel workers seconds can pass
 * between two rendered frames. What is asserted is unchanged — holding the key or button
 * must change the rendered scene, and releasing it must stop the movement — this is only how
 * long that change may take to show up.
 */
export const MOVEMENT_TIMEOUT_MS = 15_000;
/** Delay between captures while waiting for a held key or button to change the rendered frame. */
export const MOVEMENT_POLL_INTERVAL_MS = 100;
/**
 * Upper bound for a camera flight between the two views to finish.
 *
 * The flight itself lasts 0.9 s of wall clock, but it only advances on rendered frames, and
 * the whole floor under a software WebGL rasteriser can leave seconds between two of them.
 * The same budget as the others, and for the same reason.
 */
export const CAMERA_IDLE_TIMEOUT_MS = 15_000;

/**
 * The 3D view region: the focusable `role="application"` wrapping the canvas.
 *
 * One element serves both views (ADR-013), so this locator matches exactly one node whichever
 * view is active, and it is the element carrying {@link CAMERA_TRANSITION_ATTRIBUTE}.
 */
export function getViewRegion(page: Page): Locator {
  return page.getByRole('application');
}

/**
 * Asserts that no camera flight between the views is pending.
 *
 * The first step of {@link captureSettledScene}, and usable on its own wherever a test needs
 * the camera to have arrived before it looks at anything.
 */
export async function expectCameraIdle(page: Page): Promise<void> {
  await expect(getViewRegion(page)).toHaveAttribute(
    CAMERA_TRANSITION_ATTRIBUTE,
    CAMERA_TRANSITION_IDLE,
    { timeout: CAMERA_IDLE_TIMEOUT_MS },
  );
}

/** The HUD overlay: the child of `<main>` holding the view status. */
export function getHudOverlay(page: Page): Locator {
  return page.locator('main > div').filter({ has: page.getByRole('status') });
}

/**
 * Captures the canvas with the whole HUD overlay masked, so only the rendered scene is compared.
 *
 * The HUD (view toggle panel, camera toggle panel, navigation hint and remote control) overlays
 * the canvas; its status text and `aria-pressed` colours change with the camera mode and while a
 * pad button is held, so unmasked, those alone would make a frame comparison pass. The overlay
 * is masked as one full-width block, found as the child of `<main>` holding the status: masking
 * each panel on its own is not enough, since the panels resize with the status text and a mask of
 * another size changes the frame by itself.
 */
export async function captureScene(page: Page): Promise<Buffer> {
  return page.locator('canvas').screenshot({ mask: [getHudOverlay(page)] });
}

/**
 * Captures the masked scene once it is settled, which means two things, in this order:
 *
 * 1. **no camera flight is pending.** A view toggle starts a 0.9 s eased flight between the
 *    two views, and a capture taken during it is a frame of a moving camera. The rule below
 *    would *usually* catch that, since the camera keeps moving between two captures taken
 *    250 ms apart — but usually is not a guarantee, and `data-camera-transition` is one, so
 *    the region is asked outright whether the camera has arrived (`expectCameraIdle`);
 * 2. **the scene has stopped changing**: two consecutive captures byte-identical.
 */
export async function captureSettledScene(page: Page): Promise<Buffer> {
  await expectCameraIdle(page);
  // A mask locator matching nothing would silently compare the HUD again.
  await expect(getHudOverlay(page)).toHaveCount(1);
  let previous = await captureScene(page);
  await expect
    .poll(
      async () => {
        const current = await captureScene(page);
        const isStable = current.equals(previous);
        previous = current;
        return isStable;
      },
      { timeout: SETTLE_TIMEOUT_MS, intervals: [SETTLE_POLL_INTERVAL_MS] },
    )
    .toBe(true);
  return previous;
}

/** Waits until the masked scene no longer matches the baseline. */
export async function expectSceneChanged(
  page: Page,
  baseline: Buffer,
  message: string,
  timeout: number = MOVEMENT_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(async () => !(await captureScene(page)).equals(baseline), {
      message,
      timeout,
      intervals: [MOVEMENT_POLL_INTERVAL_MS],
    })
    .toBe(true);
}

/** Asserts that the canvas is visible, for tests that start from the exterior view. */
export async function expectCanvasVisible(page: Page): Promise<void> {
  await expect(page.locator('canvas')).toBeVisible();
}
