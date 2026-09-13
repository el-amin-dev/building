import { expect, test, type Locator, type Page } from '@playwright/test';
import { INTERIOR_REGION_NAME, VIEW_TOGGLE_NAME } from './constants.ts';
import {
  captureScene,
  captureSettledScene,
  expectCanvasVisible,
  getHudOverlay,
  MOVEMENT_POLL_INTERVAL_MS,
  MOVEMENT_TIMEOUT_MS,
} from './sceneCapture.ts';

/** Accessible name of the on-screen remote control group. */
const REMOTE_GROUP_NAME = 'Remote control';
/** Accessible names of the two buttons held in these tests. */
const MOVE_FORWARD_NAME = 'Move forward';
const TURN_LEFT_NAME = 'Turn left';
/** Number of buttons on the pad: one per navigation action. */
const REMOTE_BUTTON_COUNT = 8;
/** Smallest touch target the pad promises, in CSS pixels (WCAG 2.5.8 asks for 24). */
const MIN_TARGET_SIZE_PX = 44;
/** Absolute floor for a touch target, in CSS pixels: what WCAG 2.5.8 itself requires. */
const WCAG_MIN_TARGET_SIZE_PX = 24;
/** A narrow phone viewport, the tightest width the HUD is expected to hold the pad in. */
const PHONE_VIEWPORT = Object.freeze({ width: 400, height: 800 });
/**
 * Smallest share of the viewport height the 3D view keeps free of HUD panels at a phone width.
 *
 * The pad is the only way to move for someone who cannot use a keyboard, so it may not be paid
 * for with the view it moves through: the toggles stay in a band at the top, the pad anchors to
 * the bottom, and what is between the two belongs to the scene.
 */
const MIN_FREE_VIEW_FRACTION = 0.6;
/**
 * A phrase only the full key description carries.
 *
 * The visible hint is shortened at a phone width; the description the 3D region points at must
 * not be, so this phrase — about holding a pad button, which the short hint does not spell out —
 * has to survive there.
 */
const FULL_DESCRIPTION_PHRASE = /hold one of its buttons with a pointer or a finger/;

/**
 * How long the scene is left alone after a release before it is captured again. A fixed wait
 * is the point: the assertion is that nothing moves any more once the button is let go.
 */
const AFTER_RELEASE_MS = 700;

/**
 * Budget for the test that walks and turns with the mouse alone.
 *
 * ## Where the number comes from
 *
 * Measured on this machine, serially, with the reporter's own per-test clock: **32 s**, and
 * 34–45 s across earlier runs — call the slowest local run 45 s.
 *
 * CI has no GPU, so every frame of the whole floor is rasterised in software on the CPU. The
 * same suite takes **12.8 min** there against **4.5 min** here: a **3× slowdown**, and it lands
 * squarely on what this test spends its time doing. It settles the scene four times (each
 * settle is a series of canvas screenshots until two come back byte-identical), polls canvas
 * screenshots twice until a held button changes one, and waits out two fixed
 * {@link AFTER_RELEASE_MS} windows — all of it paid for one rendered frame at a time.
 *
 * So 45 s here is some **135 s** there, against the 90 s that `test.slow()` (three times the
 * 30 s default) used to allow. That is why this test, and only this test, failed on CI through
 * both retries while passing locally every time: the budget was smaller than the work, not the
 * work larger than it should be.
 *
 * 240 s is a little over **5×** the slowest local run and nearly **2×** the projected CI time,
 * so a runner having a worse-than-usual day costs wall clock rather than a red build.
 *
 * ## Why this is not a mask over a slow app
 *
 * Nothing here waits out one of the product's own timings. Every hold ends the instant a
 * changed frame is captured, so a faster renderer finishes sooner and the budget is never
 * reached; it is an upper bound on how long a frame may take to arrive, not a pause. The
 * proof is the same test on hardware that draws the floor with a GPU, where it takes half a
 * minute. What is being paid for is the rasteriser, not the renderer.
 */
const MOUSE_WALK_TEST_TIMEOUT_MS = 240_000;

/** A point in page coordinates, for a real mouse press. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** The pad, by its accessible name. */
function getRemotePad(page: Page): Locator {
  return page.getByRole('group', { name: REMOTE_GROUP_NAME });
}

/** How a test captures the rendered scene: every HUD panel of its layout masked. */
type CaptureScene = (page: Page) => Promise<Buffer>;

/**
 * Captures the scene with both HUD panels masked, as the phone layout needs.
 *
 * At a phone width the pad anchors to the bottom of the screen, outside the HUD overlay's own
 * box, so the shared one-rect mask no longer covers it — and a held button turns amber, which
 * would count as a changed scene all by itself and make the movement assertion pass without any
 * movement. Masking the pad as well keeps the assertion about the 3D scene, exactly as the
 * single mask does at a width where the pad sits inside the overlay.
 */
async function capturePhoneScene(page: Page): Promise<Buffer> {
  return page.locator('canvas').screenshot({ mask: [getHudOverlay(page), getRemotePad(page)] });
}

/**
 * Waits until the scene captured by `capture` no longer matches `baseline`.
 *
 * `expectSceneChanged` of `sceneCapture.ts` with the mask left to the caller, because the phone
 * layout needs two rects masked and the shared helper masks the overlay alone.
 */
async function expectMaskedSceneChanged(
  page: Page,
  capture: CaptureScene,
  baseline: Buffer,
  message: string,
): Promise<void> {
  await expect
    .poll(async () => !(await capture(page)).equals(baseline), {
      message,
      timeout: MOVEMENT_TIMEOUT_MS,
      intervals: [MOVEMENT_POLL_INTERVAL_MS],
    })
    .toBe(true);
}

/** How a pad button is held: where the pointer is let go, and how the scene is captured. */
interface HoldOptions {
  /** Where the pointer is released; the button's own centre when left out. */
  readonly releaseAt?: Point;
  /** Capture masking every HUD panel of the layout under test; the shared one by default. */
  readonly capture?: CaptureScene;
}

/** Centre of a pad button, which must also be a comfortable touch target. */
async function getPadButtonCentre(page: Page, name: string): Promise<Point> {
  const button = page.getByRole('button', { name });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  if (box === null) {
    throw new Error(`the "${name}" button has no bounding box`);
  }
  expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX);
  expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Centre of the canvas: a point well away from the pad, to release the pointer over. */
async function getCanvasCentre(page: Page): Promise<Point> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('the canvas has no bounding box');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Holds a pad button with the mouse until the scene changes, then releases it at `releaseAt`
 * (the button's own centre unless another point is given) and asserts the scene stops moving.
 *
 * The scene is settled first, then captured with the caller's mask, so the baseline and every
 * comparison see the same pixels.
 */
async function expectButtonMovesThenStops(
  page: Page,
  name: string,
  options: HoldOptions = {},
): Promise<void> {
  const capture = options.capture ?? captureScene;
  await captureSettledScene(page);
  const baseline = await capture(page);
  const centre = await getPadButtonCentre(page, name);

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  try {
    await expectMaskedSceneChanged(
      page,
      capture,
      baseline,
      `holding "${name}" should change the rendered scene`,
    );
  } finally {
    if (options.releaseAt !== undefined) {
      await page.mouse.move(options.releaseAt.x, options.releaseAt.y);
    }
    await page.mouse.up();
  }

  await captureSettledScene(page);
  const stopped = await capture(page);
  // A fixed wait is intentional: the assertion is that nothing changes after the release.
  await page.waitForTimeout(AFTER_RELEASE_MS);
  expect(
    (await capture(page)).equals(stopped),
    `releasing "${name}" should stop the movement`,
  ).toBe(true);
}

/** Enters the interior view with a mouse click only, and returns the pad's group locator. */
async function enterInteriorWithMouse(page: Page) {
  await page.goto('/');
  await expectCanvasVisible(page);

  await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();

  const remote = getRemotePad(page);
  await expect(remote).toBeVisible();
  return remote;
}

test.describe('on-screen remote control', () => {
  test('moves and turns with the mouse alone, and stops on release', async ({ page }) => {
    // Sized for a GPU-less CI runner rather than left to `test.slow()`; the arithmetic is in
    // the constant's docblock.
    test.setTimeout(MOUSE_WALK_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    const remote = await enterInteriorWithMouse(page);
    await expect(remote.getByRole('button')).toHaveCount(REMOTE_BUTTON_COUNT);

    // Not a single keyboard event in this test: the whole walk is done with the mouse.
    await expectButtonMovesThenStops(page, MOVE_FORWARD_NAME);
    await expectButtonMovesThenStops(page, TURN_LEFT_NAME);

    // A pointer hold hands focus back to the view, so the keys keep working for those who have them.
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toBeFocused();
    expect(pageErrors).toEqual([]);
  });

  test('stops moving when the pointer is released away from the button', async ({ page }) => {
    // Polling frames rendered by software WebGL comes close to the default test timeout.
    test.slow();
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await enterInteriorWithMouse(page);

    // Sliding off the button and letting go over the scene must not leave the turn stuck: a
    // stuck turn would spin the camera forever.
    const away = await getCanvasCentre(page);
    await expectButtonMovesThenStops(page, TURN_LEFT_NAME, { releaseAt: away });

    expect(pageErrors).toEqual([]);
  });

  test('fits a phone width with every button tappable, and still moves there', async ({ page }) => {
    // Polling frames rendered by software WebGL comes close to the default test timeout.
    test.slow();
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.setViewportSize(PHONE_VIEWPORT);
    const remote = await enterInteriorWithMouse(page);
    const buttons = remote.getByRole('button');
    await expect(buttons).toHaveCount(REMOTE_BUTTON_COUNT);

    // The HUD holds the toggles and the shortened hint in a band at the top of this width and the
    // pad at the bottom. None of them may push the page sideways: a horizontal scroll would leave
    // part of the pad off screen.
    const documentWidths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      documentWidths.scrollWidth,
      'the page must not scroll horizontally at a phone width',
    ).toBeLessThanOrEqual(documentWidths.clientWidth);

    // The 3D view is what the pad moves through, so it keeps the screen: the band at the top and
    // the bottom-anchored pad may not eat into it, nor into each other.
    const topBand = await getHudOverlay(page).boundingBox();
    const padBox = await remote.boundingBox();
    if (topBand === null || padBox === null) {
      throw new Error('a HUD panel has no bounding box');
    }
    const topBandBottomPx = topBand.y + topBand.height;
    expect(padBox.y, 'the pad must not overlap the HUD band above it').toBeGreaterThanOrEqual(
      topBandBottomPx,
    );
    expect(padBox.y + padBox.height, 'the pad must stay inside the viewport').toBeLessThanOrEqual(
      PHONE_VIEWPORT.height,
    );
    const freeViewFraction = (padBox.y - topBandBottomPx) / PHONE_VIEWPORT.height;
    expect(
      freeViewFraction,
      'the 3D view must keep most of the viewport height free of HUD panels',
    ).toBeGreaterThanOrEqual(MIN_FREE_VIEW_FRACTION);
    test.info().annotations.push({
      type: 'free 3D view height',
      description: `${Math.round(freeViewFraction * 100)}% of a ${PHONE_VIEWPORT.height} px viewport height`,
    });

    // The visible hint is shortened at this width; what the view region is described by is not.
    await expect(
      page.getByRole('application', { name: INTERIOR_REGION_NAME }),
    ).toHaveAccessibleDescription(FULL_DESCRIPTION_PHRASE);

    let smallestSidePx = Number.POSITIVE_INFINITY;
    for (const button of await buttons.all()) {
      const name = await button.getAttribute('aria-label');
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      if (box === null) {
        throw new Error(`the "${name}" button has no bounding box`);
      }
      expect(box.width, `"${name}" is narrower than a touch target`).toBeGreaterThanOrEqual(
        WCAG_MIN_TARGET_SIZE_PX,
      );
      expect(box.height, `"${name}" is shorter than a touch target`).toBeGreaterThanOrEqual(
        WCAG_MIN_TARGET_SIZE_PX,
      );
      smallestSidePx = Math.min(smallestSidePx, box.width, box.height);
      // A trial click runs the actionability and hit-target checks without clicking: it fails
      // if another HUD panel covers the button's centre, which is what wrapping could cause.
      await button.click({ trial: true });
    }
    test.info().annotations.push({
      type: 'smallest pad button side',
      description: `${smallestSidePx} CSS px at a ${PHONE_VIEWPORT.width} px viewport width`,
    });

    // Fitting is not enough: holding a button at this width must still walk, and let go. Both HUD
    // panels are masked here, so only a moved 3D scene can satisfy the assertion.
    await expectButtonMovesThenStops(page, MOVE_FORWARD_NAME, { capture: capturePhoneScene });
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toBeFocused();

    expect(pageErrors).toEqual([]);
  });
});
