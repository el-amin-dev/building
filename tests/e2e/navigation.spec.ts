import { expect, test, type Locator, type Page } from '@playwright/test';

/** Compact key summary shown on the HUD; `aria-hidden`, so it is found by text, not by role. */
const INTERIOR_HINT_TEXT = 'Move: W A S D · Look: I J K L · Person view: V';
/** Full key description the interior region is described by (visually hidden). */
const INTERIOR_HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Press Tab to reach the view toggle.';
/** Accessible name of the view toggle button. */
const VIEW_TOGGLE_NAME = 'Interior view';
/** Accessible name of the camera mode toggle button, shown in the interior view only. */
const CAMERA_TOGGLE_NAME = 'Third person';
/** Accessible name of the interior 3D region, distinct from the toggle's. */
const INTERIOR_REGION_NAME = 'Interior 3D view';
/** Status line of the exterior view. */
const EXTERIOR_STATUS = 'View: Exterior';
/** Status line of the interior view in first person. */
const FIRST_PERSON_STATUS = 'View: Interior · First person';
/** Status line of the interior view in third person. */
const THIRD_PERSON_STATUS = 'View: Interior · Third person';
/** Physical key switching between first and third person. */
const CAMERA_MODE_KEY = 'KeyV';

/** Upper bound for the scene to stop changing between two consecutive canvas captures. */
const SETTLE_TIMEOUT_MS = 15_000;
/** Delay between consecutive captures while waiting for the scene to settle. */
const SETTLE_POLL_INTERVAL_MS = 250;
/** Upper bound for a held key to produce a visible change in the rendered frame. */
const MOVEMENT_TIMEOUT_MS = 5_000;
/** Delay between captures while waiting for a held key to change the rendered frame. */
const MOVEMENT_POLL_INTERVAL_MS = 100;
/** How long a key is held while asserting that it has no effect. */
const UNFOCUSED_KEY_HOLD_MS = 500;

/** Captures the canvas once two consecutive captures are identical, i.e. the scene is at rest. */
async function captureSettledCanvas(canvas: Locator): Promise<Buffer> {
  let previous = await canvas.screenshot();
  await expect
    .poll(
      async () => {
        const current = await canvas.screenshot();
        const isStable = current.equals(previous);
        previous = current;
        return isStable;
      },
      { timeout: SETTLE_TIMEOUT_MS, intervals: [SETTLE_POLL_INTERVAL_MS] },
    )
    .toBe(true);
  return previous;
}

/** Waits until the canvas no longer matches the baseline. */
async function expectCanvasChanged(canvas: Locator, baseline: Buffer, message: string) {
  await expect
    .poll(async () => !(await canvas.screenshot()).equals(baseline), {
      message,
      timeout: MOVEMENT_TIMEOUT_MS,
      intervals: [MOVEMENT_POLL_INTERVAL_MS],
    })
    .toBe(true);
}

/** Holds a key until the canvas no longer matches the baseline, then releases it. */
async function expectKeyChangesCanvas(
  page: Page,
  canvas: Locator,
  baseline: Buffer,
  code: string,
): Promise<void> {
  await page.keyboard.down(code);
  try {
    await expectCanvasChanged(canvas, baseline, `holding ${code} should change the rendered frame`);
  } finally {
    await page.keyboard.up(code);
  }
}

/** Holds a key for a fixed time, during which it is expected to have no effect. */
async function holdKeyForNoEffect(page: Page, code: string): Promise<void> {
  await page.keyboard.down(code);
  try {
    // A fixed wait is intentional: the assertion is that nothing changes during the hold.
    await page.waitForTimeout(UNFOCUSED_KEY_HOLD_MS);
  } finally {
    await page.keyboard.up(code);
  }
}

test.describe('interior navigation', () => {
  test('moves and turns with the keyboard, then returns to the exterior view', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    const toggle = page.getByRole('button', { name: VIEW_TOGGLE_NAME });
    const status = page.getByRole('status');
    const hint = page.getByText(INTERIOR_HINT_TEXT, { exact: true });

    await toggle.click();

    const region = page.getByRole('application', { name: INTERIOR_REGION_NAME });
    await expect(region).toBeFocused();
    await expect(region).toHaveAccessibleDescription(INTERIOR_HINT_DESCRIPTION);
    await expect(hint).toBeVisible();
    await expect(status).toHaveText(FIRST_PERSON_STATUS);

    // The eye starts in a corner of the walkable area facing the opposite corner, with several
    // metres of floor ahead, so holding W walks forward and changes the frame.
    const beforeWalk = await captureSettledCanvas(canvas);
    await expectKeyChangesCanvas(page, canvas, beforeWalk, 'KeyW');

    const beforeTurn = await captureSettledCanvas(canvas);
    await expectKeyChangesCanvas(page, canvas, beforeTurn, 'KeyJ');

    await expect(region).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(status).toHaveText(EXTERIOR_STATUS);
    await expect(page.getByRole('application')).toHaveCount(0);
    await expect(hint).toBeHidden();

    expect(pageErrors).toEqual([]);
  });

  test('switches between first and third person with V and the HUD button', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    const viewToggle = page.getByRole('button', { name: VIEW_TOGGLE_NAME });
    const cameraToggle = page.getByRole('button', { name: CAMERA_TOGGLE_NAME });
    const status = page.getByRole('status');
    await expect(cameraToggle).toHaveCount(0);

    await viewToggle.click();

    const region = page.getByRole('application', { name: INTERIOR_REGION_NAME });
    await expect(region).toBeFocused();
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toHaveText(FIRST_PERSON_STATUS);

    const firstPersonFrame = await captureSettledCanvas(canvas);
    await page.keyboard.press(CAMERA_MODE_KEY);
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveText(THIRD_PERSON_STATUS);
    await expectCanvasChanged(canvas, firstPersonFrame, 'V should change the rendered frame');
    await expect(region).toBeFocused();

    // The start corner pulls the follow camera in; walking forward moves the person and its camera.
    const beforeWalk = await captureSettledCanvas(canvas);
    await expectKeyChangesCanvas(page, canvas, beforeWalk, 'KeyW');

    await page.keyboard.press(CAMERA_MODE_KEY);
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toHaveText(FIRST_PERSON_STATUS);

    await cameraToggle.click();
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveText(THIRD_PERSON_STATUS);

    await viewToggle.click();
    await expect(status).toHaveText(EXTERIOR_STATUS);
    await expect(cameraToggle).toHaveCount(0);

    await viewToggle.click();
    await expect(region).toBeFocused();
    await expect(status).toHaveText(THIRD_PERSON_STATUS);
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');

    expect(pageErrors).toEqual([]);
  });

  test('ignores movement and camera mode keys while the interior view is not focused', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    const toggle = page.getByRole('button', { name: VIEW_TOGGLE_NAME });
    const status = page.getByRole('status');
    await toggle.click();
    await expect(status).toHaveText(FIRST_PERSON_STATUS);
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toBeFocused();

    // Reach the toggle by keyboard rather than `toggle.focus()`: the HUD overlays the canvas, and
    // a programmatic focus leaves the toggle's focus-visible ring off until the first key press,
    // which would change the captured frame for reasons unrelated to navigation.
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();

    const baseline = await captureSettledCanvas(canvas);

    await holdKeyForNoEffect(page, 'KeyW');
    expect((await canvas.screenshot()).equals(baseline)).toBe(true);

    await holdKeyForNoEffect(page, CAMERA_MODE_KEY);
    expect((await canvas.screenshot()).equals(baseline)).toBe(true);
    await expect(status).toHaveText(FIRST_PERSON_STATUS);
    await expect(page.getByRole('button', { name: CAMERA_TOGGLE_NAME })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(toggle).toBeFocused();

    expect(pageErrors).toEqual([]);
  });
});
