import { expect, test, type Page } from '@playwright/test';
import { INTERIOR_REGION_NAME, VIEW_TOGGLE_NAME } from './constants.ts';
import {
  captureScene,
  captureSettledScene,
  expectCanvasVisible,
  expectSceneChanged,
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
 * How long the scene is left alone after a release before it is captured again. A fixed wait
 * is the point: the assertion is that nothing moves any more once the button is let go.
 */
const AFTER_RELEASE_MS = 700;

/** A point in page coordinates, for a real mouse press. */
interface Point {
  readonly x: number;
  readonly y: number;
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
 */
async function expectButtonMovesThenStops(
  page: Page,
  name: string,
  releaseAt?: Point,
): Promise<void> {
  const baseline = await captureSettledScene(page);
  const centre = await getPadButtonCentre(page, name);

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  try {
    await expectSceneChanged(page, baseline, `holding "${name}" should change the rendered scene`);
  } finally {
    if (releaseAt !== undefined) {
      await page.mouse.move(releaseAt.x, releaseAt.y);
    }
    await page.mouse.up();
  }

  const stopped = await captureSettledScene(page);
  // A fixed wait is intentional: the assertion is that nothing changes after the release.
  await page.waitForTimeout(AFTER_RELEASE_MS);
  expect(
    (await captureScene(page)).equals(stopped),
    `releasing "${name}" should stop the movement`,
  ).toBe(true);
}

/** Enters the interior view with a mouse click only, and returns the pad's group locator. */
async function enterInteriorWithMouse(page: Page) {
  await page.goto('/');
  await expectCanvasVisible(page);

  await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();

  const remote = page.getByRole('group', { name: REMOTE_GROUP_NAME });
  await expect(remote).toBeVisible();
  return remote;
}

test.describe('on-screen remote control', () => {
  test('moves and turns with the mouse alone, and stops on release', async ({ page }) => {
    // Polling frames rendered by software WebGL comes close to the default test timeout.
    test.slow();
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
    await expectButtonMovesThenStops(page, TURN_LEFT_NAME, away);

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

    // The HUD holds the toggles, the hint and the pad at this width. None of them may push the
    // page sideways: a horizontal scroll would leave part of the pad off screen.
    const documentWidths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      documentWidths.scrollWidth,
      'the page must not scroll horizontally at a phone width',
    ).toBeLessThanOrEqual(documentWidths.clientWidth);

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

    // Fitting is not enough: holding a button at this width must still walk, and let go.
    await expectButtonMovesThenStops(page, MOVE_FORWARD_NAME);
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toBeFocused();

    expect(pageErrors).toEqual([]);
  });
});
