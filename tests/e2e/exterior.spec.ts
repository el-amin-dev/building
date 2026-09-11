import { expect, test } from '@playwright/test';
import { EXTERIOR_STATUS } from './constants.ts';
import { captureSettledScene, expectCanvasVisible, getHudOverlay } from './sceneCapture.ts';

/**
 * Baseline of the default exterior framing: the whole floor seen from outside, as the app
 * opens. It is the one image that shows the built floor as a whole — a wall, a slab, the
 * side-B void or the stairs bay going missing changes it.
 *
 * There is deliberately no companion baseline for the interior start frame yet. The interior
 * renders in one of two settled lighting states — the same geometry, shaded differently, 19%
 * of the frame apart — and which one appears depends on machine load, not on anything the
 * test does: serially it is always the lighter state, under the suite's own parallel workers
 * it is sometimes the darker one, and neither converges to the other however long the scene
 * is left alone. Until that is settled in the scene code, an interior baseline would assert
 * whichever state the machine that generated it happened to produce.
 */
const EXTERIOR_SNAPSHOT = 'exterior-default.png';

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
    await captureSettledScene(page);

    const hudOverlay = getHudOverlay(page);
    // A mask locator matching nothing would silently compare the HUD instead of the scene.
    await expect(hudOverlay).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveScreenshot(EXTERIOR_SNAPSHOT, {
      mask: [hudOverlay],
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      timeout: SCREENSHOT_TIMEOUT_MS,
    });

    expect(pageErrors).toEqual([]);
  });
});
