import { expect, test, type Locator, type Page } from '@playwright/test';

/** Compact key summary shown on the HUD; `aria-hidden`, so it is found by text, not by role. */
const INTERIOR_HINT_TEXT = 'Move: W A S D · Look: I J K L';
/** Full key description the interior region is described by (visually hidden). */
const INTERIOR_HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. Keys follow their positions on a QWERTY keyboard. Press Tab to reach the view toggle.';
/** Accessible name of the view toggle button. */
const VIEW_TOGGLE_NAME = 'Interior view';
/** Accessible name of the interior 3D region, distinct from the toggle's. */
const INTERIOR_REGION_NAME = 'Interior 3D view';

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

/** Holds a key until the canvas no longer matches the baseline, then releases it. */
async function expectKeyChangesCanvas(
  page: Page,
  canvas: Locator,
  baseline: Buffer,
  code: string,
): Promise<void> {
  await page.keyboard.down(code);
  try {
    await expect
      .poll(async () => !(await canvas.screenshot()).equals(baseline), {
        message: `holding ${code} should change the rendered frame`,
        timeout: MOVEMENT_TIMEOUT_MS,
        intervals: [MOVEMENT_POLL_INTERVAL_MS],
      })
      .toBe(true);
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
    await expect(status).toHaveText('View: Interior');

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
    await expect(status).toHaveText('View: Exterior');
    await expect(page.getByRole('application')).toHaveCount(0);
    await expect(hint).toBeHidden();

    expect(pageErrors).toEqual([]);
  });

  test('ignores movement keys while the interior view is not focused', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    const toggle = page.getByRole('button', { name: VIEW_TOGGLE_NAME });
    await toggle.click();
    await expect(page.getByRole('status')).toHaveText('View: Interior');
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toBeFocused();

    // Reach the toggle by keyboard rather than `toggle.focus()`: the HUD overlays the canvas, and
    // a programmatic focus leaves the toggle's focus-visible ring off until the first key press,
    // which would change the captured frame for reasons unrelated to navigation.
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();

    const baseline = await captureSettledCanvas(canvas);

    await page.keyboard.down('KeyW');
    try {
      // A fixed wait is intentional: the assertion is that nothing changes during the hold.
      await page.waitForTimeout(UNFOCUSED_KEY_HOLD_MS);
    } finally {
      await page.keyboard.up('KeyW');
    }

    expect((await canvas.screenshot()).equals(baseline)).toBe(true);
    await expect(toggle).toBeFocused();

    expect(pageErrors).toEqual([]);
  });
});
