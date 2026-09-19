import { expect, test, type Page } from '@playwright/test';
import { EXTERIOR_STATUS, FIRST_PERSON_STATUS, VIEW_TOGGLE_NAME } from './constants.ts';
import {
  captureSettledScene,
  expectCanvasVisible,
  expectHudWithinBudget,
  HIDE_HUD_STYLE_PATH,
} from './sceneCapture.ts';

/**
 * Baseline of the default exterior framing: the whole floor seen from outside, as the app
 * opens. It is the one image that shows the built floor as a whole — a wall, a slab, the
 * side-B void or the stairs bay going missing changes it.
 */
const EXTERIOR_SNAPSHOT = 'exterior-default.png';

/**
 * Baseline of the interior start pose: the first frame of the walk, mid-room and facing the
 * balcony doorway.
 *
 * This one is pinned as of the lighting fix in `SceneLighting`, and could not be before it.
 * The debug panel's Leva store seeded the light intensities from whichever view rendered
 * first and never re-seeded them, so the same interior geometry settled into one of two
 * shadings — 19% of the frame apart — decided only by the order the views had mounted in,
 * with neither state converging to the other however long the scene was left alone. A
 * baseline taken then would have asserted whichever of the two the generating machine
 * happened to produce. The panel now owns view-independent *factors*, all seeded at 1,
 * instead of the intensities themselves, so the rendered lighting is a function of the view
 * alone: this frame is byte-identical across separate browser sessions whether the interior
 * is entered directly, after the exterior has settled, or after a round trip out and back.
 */
const INTERIOR_SNAPSHOT = 'interior-first-person.png';

/**
 * Budget for `toHaveScreenshot` to reach a stable frame and compare it.
 *
 * The matcher takes its own screenshots until two in a row are identical, and only then
 * compares. A single 1280 × 720 canvas capture costs a software WebGL rasteriser most of a
 * second, so the 5 s default expires before two frames are in hand — the scene is at rest by
 * then (`captureSettledScene` has already proven it), the captures are simply slow. This is
 * the same budget the settle helper uses, and it is a budget, not a diff tolerance.
 */
const SCREENSHOT_TIMEOUT_MS = 15_000;

/**
 * Waits for the scene to come to rest, then compares the whole canvas with `snapshot`.
 *
 * Shared by both baselines so they are taken the same way: settled first, HUD hidden by
 * `hideHud.css`, and the same budget. Nothing is painted over the frame, so the comparison
 * covers all 921,600 pixels of it in either view — the frame the matcher sees is the frame the
 * renderer drew.
 *
 * How much of it may differ is `maxDiffPixels` in `playwright.config.ts`, which is the single
 * source for every screenshot comparison in the suite; this spec deliberately declares no
 * number of its own, because the local override it used to carry is how the two drifted apart.
 * {@link expectHudWithinBudget} runs first: `captureSettledScene` has already asserted that the
 * selector the stylesheet hides matches exactly one element, and this adds that the element has
 * not grown to swallow the canvas.
 *
 * @param page - The page under test, already on the view being pinned.
 * @param snapshot - File name of the baseline to compare against.
 */
async function expectSettledSceneMatches(page: Page, snapshot: string): Promise<void> {
  await captureSettledScene(page);
  await expectHudWithinBudget(page);
  await expect(page.locator('canvas')).toHaveScreenshot(snapshot, {
    stylePath: HIDE_HUD_STYLE_PATH,
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
}

test.describe('rendered floor baselines', () => {
  test('matches the exterior baseline of the whole floor', async ({ page }) => {
    // The first frame of the run compiles the scene's shaders, and the whole floor is far
    // heavier than the interim chamber these budgets were first tuned for.
    test.slow();
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expectCanvasVisible(page);

    // The exterior view is the default: nothing is toggled before the baseline is taken.
    await expect(page.getByRole('status')).toHaveText(EXTERIOR_STATUS);

    await expectSettledSceneMatches(page, EXTERIOR_SNAPSHOT);

    expect(pageErrors).toEqual([]);
  });

  test('matches the interior baseline of the start pose', async ({ page }) => {
    // Two settled scenes in one test — the exterior the app opens on, then the interior.
    test.slow();
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expectCanvasVisible(page);
    await expect(page.getByRole('status')).toHaveText(EXTERIOR_STATUS);

    await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();
    await expect(page.getByRole('status')).toHaveText(FIRST_PERSON_STATUS);

    await expectSettledSceneMatches(page, INTERIOR_SNAPSHOT);

    expect(pageErrors).toEqual([]);
  });
});
