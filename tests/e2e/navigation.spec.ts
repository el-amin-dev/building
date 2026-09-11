import { expect, test, type Page } from '@playwright/test';

/** Compact key summary shown on the HUD; `aria-hidden`, so it is found by text, not by role. */
const INTERIOR_HINT_TEXT =
  'Move: W A S D · Look: I J K L · Person view: V · or use the on-screen remote control';
/** Full key description the interior region is described by (visually hidden). */
const INTERIOR_HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. Press Tab to reach the view toggle, then the Third person toggle, then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';
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
/**
 * Upper bound for a held key to produce a visible change in the rendered frame.
 *
 * As generous as the settle budget, and for the same reason: the scene draws the whole
 * floor, so a frame costs far more than it did for the single interim chamber this budget
 * was first tuned for, and under software WebGL with parallel workers seconds can pass
 * between two rendered frames. What is asserted is unchanged — holding the key must change
 * the rendered scene — this is only how long that change may take to show up.
 */
const MOVEMENT_TIMEOUT_MS = 15_000;
/** Delay between captures while waiting for a held key to change the rendered frame. */
const MOVEMENT_POLL_INTERVAL_MS = 100;
/**
 * Upper bound for the first third-person frame. It is the mannequin's first visible frame, so
 * its shaders compile then; with software WebGL and parallel workers that alone can take seconds.
 */
const FIRST_MANNEQUIN_FRAME_TIMEOUT_MS = 15_000;
/** How long a key is held while asserting that it has no effect. */
const UNFOCUSED_KEY_HOLD_MS = 500;

/**
 * Captures the canvas with the whole HUD overlay masked, so only the rendered scene is compared.
 *
 * The HUD (view toggle panel, camera toggle panel, navigation hint and remote control) overlays
 * the canvas, and its status text and `aria-pressed` colours change with the camera mode;
 * unmasked, those alone would make a frame comparison pass. The overlay is masked as one
 * full-width block, found as the child of `<main>` holding the status: masking each panel on its
 * own is not enough, since the panels resize with the status text and a mask of another size
 * changes the frame by itself.
 */
async function captureScene(page: Page): Promise<Buffer> {
  return page.locator('canvas').screenshot({ mask: [getHudOverlay(page)] });
}

/** The HUD overlay: the child of `<main>` holding the view status. */
function getHudOverlay(page: Page) {
  return page.locator('main > div').filter({ has: page.getByRole('status') });
}

/** Captures the masked scene once two consecutive captures are identical, i.e. it is at rest. */
async function captureSettledScene(page: Page): Promise<Buffer> {
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
async function expectSceneChanged(
  page: Page,
  baseline: Buffer,
  message: string,
  timeout: number = MOVEMENT_TIMEOUT_MS,
) {
  await expect
    .poll(async () => !(await captureScene(page)).equals(baseline), {
      message,
      timeout,
      intervals: [MOVEMENT_POLL_INTERVAL_MS],
    })
    .toBe(true);
}

/** Holds a key until the masked scene no longer matches the baseline, then releases it. */
async function expectKeyChangesScene(page: Page, baseline: Buffer, code: string): Promise<void> {
  await page.keyboard.down(code);
  try {
    await expectSceneChanged(page, baseline, `holding ${code} should change the rendered scene`);
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

/** Asserts that the canvas is visible, for tests that start from the exterior view. */
async function expectCanvasVisible(page: Page): Promise<void> {
  await expect(page.locator('canvas')).toBeVisible();
}

test.describe('interior navigation', () => {
  test('moves and turns with the keyboard, then returns to the exterior view', async ({ page }) => {
    // Polling frames rendered by software WebGL comes close to the default test timeout.
    test.slow();
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expectCanvasVisible(page);

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
    const beforeWalk = await captureSettledScene(page);
    await expectKeyChangesScene(page, beforeWalk, 'KeyW');

    const beforeTurn = await captureSettledScene(page);
    await expectKeyChangesScene(page, beforeTurn, 'KeyJ');

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
    // Several settled captures plus the mannequin's first frame (shader compilation, see
    // FIRST_MANNEQUIN_FRAME_TIMEOUT_MS) exceed the default test timeout under parallel workers.
    test.slow();
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expectCanvasVisible(page);

    const viewToggle = page.getByRole('button', { name: VIEW_TOGGLE_NAME });
    const cameraToggle = page.getByRole('button', { name: CAMERA_TOGGLE_NAME });
    const status = page.getByRole('status');
    await expect(cameraToggle).toHaveCount(0);

    await viewToggle.click();

    const region = page.getByRole('application', { name: INTERIOR_REGION_NAME });
    await expect(region).toBeFocused();
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toHaveText(FIRST_PERSON_STATUS);

    // At the start pose, right after entering, with the person's back in a corner: pressing V
    // must change the rendered 3D frame (HUD masked). The unit tests guard the camera raise.
    const firstPersonScene = await captureSettledScene(page);
    await page.keyboard.press(CAMERA_MODE_KEY);
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveText(THIRD_PERSON_STATUS);
    await expectSceneChanged(
      page,
      firstPersonScene,
      'V at the start pose should change the rendered scene, HUD masked',
      FIRST_MANNEQUIN_FRAME_TIMEOUT_MS,
    );
    await expect(region).toBeFocused();

    // Walking forward moves the person and the camera following it.
    const beforeWalk = await captureSettledScene(page);
    await expectKeyChangesScene(page, beforeWalk, 'KeyW');

    await page.keyboard.press(CAMERA_MODE_KEY);
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toHaveText(FIRST_PERSON_STATUS);

    // A mouse click on the HUD button hands focus back to the view, so the keys keep working.
    await cameraToggle.click();
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveText(THIRD_PERSON_STATUS);
    await expect(region).toBeFocused();
    const afterClick = await captureSettledScene(page);
    await expectKeyChangesScene(page, afterClick, 'KeyW');

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
    await expectCanvasVisible(page);

    const toggle = page.getByRole('button', { name: VIEW_TOGGLE_NAME });
    const status = page.getByRole('status');
    await toggle.click();
    await expect(status).toHaveText(FIRST_PERSON_STATUS);
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toBeFocused();

    // Reach the toggle by keyboard rather than `toggle.focus()`, so focus lands as a user would put
    // it; the region's focus indicator, drawn over the canvas edges, is off from here on.
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();

    const baseline = await captureSettledScene(page);

    await holdKeyForNoEffect(page, 'KeyW');
    expect((await captureScene(page)).equals(baseline)).toBe(true);

    await holdKeyForNoEffect(page, CAMERA_MODE_KEY);
    expect((await captureScene(page)).equals(baseline)).toBe(true);
    await expect(status).toHaveText(FIRST_PERSON_STATUS);
    await expect(page.getByRole('button', { name: CAMERA_TOGGLE_NAME })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(toggle).toBeFocused();

    expect(pageErrors).toEqual([]);
  });
});
