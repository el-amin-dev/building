/**
 * Shared canvas-capture helpers for the end-to-end specs.
 *
 * Every frame comparison in `exterior.spec.ts`, `navigation.spec.ts` and
 * `remoteControl.spec.ts` needs the same two things: a screenshot of the canvas with the whole
 * HUD hidden, so only the rendered scene is compared, and a way to wait until the scene is at
 * rest before comparing it. They live here so the specs share one definition of "the scene"
 * and one set of budgets, rather than a copy each.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

/**
 * The HUD overlay: the one div of `<main>` that wraps every HUD panel.
 *
 * Found by `data-hud-overlay`, the attribute `src/app/App.tsx` stamps on it and documents as a
 * test contract. {@link HIDE_HUD_STYLE_PATH} keys on the same string, so the selector that
 * counts the overlay and the rule that hides it are one string, in two files that name it
 * identically. That is deliberate: the previous locator described the overlay by shape
 * (`main > div` holding the status) and the stylesheet did not exist, so nothing tied what was
 * hidden to what was asserted about it.
 */
export function getHudOverlay(page: Page): Locator {
  return page.locator('[data-hud-overlay]');
}

/**
 * Stylesheet that hides the HUD, as the path `toHaveScreenshot`'s `stylePath` option takes.
 *
 * Resolved from this module's own URL rather than the working directory, so it is found
 * wherever Playwright is invoked from.
 */
export const HIDE_HUD_STYLE_PATH = fileURLToPath(new URL('./hideHud.css', import.meta.url));

/**
 * The same stylesheet as text, as `locator.screenshot`'s `style` option takes.
 *
 * The two screenshot APIs disagree about this one option — the matcher takes a path, a plain
 * capture takes the CSS itself — so the file is read once here rather than duplicated as a
 * string literal. A single file feeds both, and neither can be changed without the other.
 */
const HIDE_HUD_STYLE = readFileSync(HIDE_HUD_STYLE_PATH, 'utf8');

/**
 * Fraction of the canvas height the HUD overlay is allowed to occupy.
 *
 * A tripwire on HUD growth, **not a tolerance**: nothing is compared any less strictly when the
 * HUD is taller, since the HUD is hidden rather than painted over. It exists because the HUD
 * growing until it covers the viewport is the one way the interior frame could again become
 * mostly furniture — a hidden panel still owns its box, and a panel tall enough to push the
 * canvas out of the frame would leave a baseline of very little scene. Measured on
 * 2026-09-19 at the 1280 × 720 default viewport: 176 px of 720 (0.244) in the exterior view,
 * 504 px of 720 (0.701) in the interior — the tallest, first person with the room menu, the
 * hint, the readout, the minimap and the remote control all up. The budget is that maximum
 * plus a fifth, so a wording change does not trip it and another panel the size of the minimap
 * does.
 */
export const MAX_HUD_HEIGHT_FRACTION = 0.84;

/**
 * Asserts that the HUD overlay still covers less than {@link MAX_HUD_HEIGHT_FRACTION} of the
 * canvas.
 *
 * Cheap — two bounding boxes, no capture — and the second half of the guard whose first half is
 * the `toHaveCount(1)` in {@link captureSettledScene}. Together they say: the selector the
 * stylesheet also uses matched exactly one node, and that node has not grown to swallow the
 * frame.
 */
export async function expectHudWithinBudget(page: Page): Promise<void> {
  const overlay = getHudOverlay(page);
  await expect(overlay).toHaveCount(1);
  const hudBox = await overlay.boundingBox();
  const canvasBox = await page.locator('canvas').boundingBox();
  if (hudBox === null || canvasBox === null) {
    throw new Error('the HUD overlay and the canvas must both have a bounding box');
  }
  expect(
    hudBox.height / canvasBox.height,
    'the HUD has grown: see MAX_HUD_HEIGHT_FRACTION in tests/e2e/sceneCapture.ts',
  ).toBeLessThanOrEqual(MAX_HUD_HEIGHT_FRACTION);
}

/**
 * Captures the canvas with the whole HUD hidden, so only the rendered scene is compared.
 *
 * The HUD (view and camera toggles, floor stepper, room menu, navigation hint, readout,
 * minimap and pad) overlays the canvas; its status text and `aria-pressed` colours change with
 * the camera mode and while a pad button is held, and the readout and minimap change as the
 * viewer walks — so left visible, those alone would make a frame comparison pass.
 *
 * It is **hidden, not masked**. A mask paints magenta rectangles into the capture, which are
 * compared like any other pixels: the frame that comes back is part scene, part fixture. That
 * cost is invisible and it grew — the overlay box grew with the HUD until the committed
 * interior baseline was 645,120 magenta pixels of 1280 × 720, 70 % of its own frame, rows 0 to
 * 503, with the exterior one at 24 %. Part 3.5's olive slab soffit sat in the masked band: a
 * Chrome sweep found it, the baseline could not. `opacity: 0` from
 * {@link HIDE_HUD_STYLE_PATH} paints nothing over the frame at all, so the whole canvas is
 * compared and the comparison cannot shrink behind the HUD's back. `opacity` and not
 * `visibility: hidden`, for a reason that file states in full: hiding the overlay blurs
 * whatever inside it has focus, and one navigation test depends on focus surviving a capture.
 *
 * This also answers the objection that used to argue for masking the overlay as one block
 * rather than panel by panel — that the panels resize with their text, so a mask of another
 * size changes the frame by itself. It applied to every mask and to none of this: a hidden
 * panel contributes no pixels whatever size it is.
 */
export async function captureScene(page: Page): Promise<Buffer> {
  return page.locator('canvas').screenshot({ style: HIDE_HUD_STYLE });
}

/**
 * Captures the scene once it is settled, which means two things, in this order:
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
  // The stylesheet hides whatever this selector matches, so a selector matching nothing — a
  // renamed attribute, a second overlay — would silently compare the HUD again.
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

/** Waits until the scene no longer matches the baseline. */
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
