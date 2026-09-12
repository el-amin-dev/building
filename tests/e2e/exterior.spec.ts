import { expect, test, type Page } from '@playwright/test';
import { EXTERIOR_STATUS, FIRST_PERSON_STATUS, VIEW_TOGGLE_NAME } from './constants.ts';
import { captureSettledScene, expectCanvasVisible, getHudOverlay } from './sceneCapture.ts';

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
 * Share of the frame allowed to differ from the baseline.
 *
 * Not a tolerance for a scene that changed: the scene is settled before it is captured, so a
 * real change (a missing wall, a moved camera) is far larger than this. It absorbs the
 * single-pixel noise a software WebGL rasteriser leaves along the edges of the geometry, which
 * is not bit-identical between runs.
 */
const MAX_DIFF_PIXEL_RATIO = 0.01;

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
 * Waits for the scene to come to rest, then compares the masked canvas with `snapshot`.
 *
 * Shared by both baselines so they are taken the same way: settled first, HUD masked, and the
 * same budget and diff ratio. `captureSettledScene` has already asserted that the mask
 * locator matches exactly one element, which is what keeps `mask` here from silently
 * comparing the HUD instead of the rendered scene.
 *
 * @param page - The page under test, already on the view being pinned.
 * @param snapshot - File name of the baseline to compare against.
 */
async function expectSettledSceneMatches(page: Page, snapshot: string): Promise<void> {
  await captureSettledScene(page);
  await expect(page.locator('canvas')).toHaveScreenshot(snapshot, {
    mask: [getHudOverlay(page)],
    maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
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
