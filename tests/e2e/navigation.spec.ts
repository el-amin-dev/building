import { expect, test, type Page } from '@playwright/test';
import {
  CAMERA_TOGGLE_NAME,
  EXTERIOR_REGION_NAME,
  EXTERIOR_STATUS,
  FIRST_PERSON_STATUS,
  INTERIOR_REGION_NAME,
  VIEW_TOGGLE_NAME,
} from './constants.ts';
import {
  captureScene,
  captureSettledScene,
  expectCanvasVisible,
  expectSceneChanged,
} from './sceneCapture.ts';

/** Compact key summary shown on the HUD; `aria-hidden`, so it is found by text, not by role. */
const INTERIOR_HINT_TEXT =
  'Move: W A S D · Look: I J K L · Person view: V · Escape stops a walk · or use the on-screen remote control';
/** Full key description the view region is described by, in both views (visually hidden). */
const INTERIOR_HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. The "Go to room" button in the HUD lists every room of the floor and walks you to the one you pick, through the doors; that walk stops when you activate the "Stop walking" button beside it, when you press Escape while the view has focus, or as soon as you move yourself with any key or pad button. In the exterior view the left and right arrows orbit the camera around the building, the up and down arrows tilt it, and the plus and minus keys zoom in and out; the on-screen camera pad offers those same six movements. Press Tab to reach the view toggle, then the Third person toggle, then "Go to room", then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';
/** Status line of the interior view in third person. */
const THIRD_PERSON_STATUS = 'View: Interior · Third person';
/** Physical key switching between first and third person. */
const CAMERA_MODE_KEY = 'KeyV';

/**
 * Upper bound for the first third-person frame. It is the mannequin's first visible frame, so
 * its shaders compile then; with software WebGL and parallel workers that alone can take seconds.
 */
const FIRST_MANNEQUIN_FRAME_TIMEOUT_MS = 15_000;
/** How long a key is held while asserting that it has no effect. */
const UNFOCUSED_KEY_HOLD_MS = 500;

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

    // The eye starts on the stair arrival landing, (5.10, 5.00) facing the corridor, so forward
    // is +x and the corridor runs some 15 m ahead of it through a join that carries no wall at
    // all: holding W walks into it and changes the frame.
    const beforeWalk = await captureSettledScene(page);
    await expectKeyChangesScene(page, beforeWalk, 'KeyW');

    const beforeTurn = await captureSettledScene(page);
    await expectKeyChangesScene(page, beforeTurn, 'KeyJ');

    await expect(region).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(status).toHaveText(EXTERIOR_STATUS);
    // The region is a focusable `role="application"` in both views now (ADR-013), so leaving the
    // interior renames it rather than removing it: what goes is the interior name, not the role.
    await expect(page.getByRole('application', { name: EXTERIOR_REGION_NAME })).toBeVisible();
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toHaveCount(0);
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

    // At the start pose, right after entering: pressing V must change the rendered 3D frame
    // (HUD masked). The unit tests guard the distance the follow camera keeps on the arrival
    // landing, where the stair shaft close behind the person pulls it in.
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
    // W, not S: each hold lasts until the software renderer draws a changed frame, which can be
    // long enough to walk the person as far as whatever it faces, so this leg has to be the
    // direction with room left in it. From the arrival landing that is forward, where the
    // corridor runs some 15 m ahead; backward reaches the brink of the stair shaft a body radius
    // behind the start pose, where the walk field stops the body and no frame changes any more.
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
