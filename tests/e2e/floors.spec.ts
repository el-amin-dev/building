import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  CAMERA_TOGGLE_NAME,
  EXTERIOR_STATUS,
  FIRST_PERSON_STATUS,
  VIEW_TOGGLE_NAME,
} from './constants.ts';
import {
  captureScene,
  captureSettledScene,
  expectCameraIdle,
  expectCanvasVisible,
  getViewRegion,
} from './sceneCapture.ts';

/**
 * Stacking storeys, and walking between them.
 *
 * Two halves, in the order a person meets them: the HUD stepper that says how tall the
 * building is, and the stair that is the only way from one of its storeys to the next.
 *
 * ## Wall-clock arithmetic — where every budget in this file comes from
 *
 * The same arithmetic `explore.spec.ts` sets out, and for the same reason: the body advances
 * once per **rendered frame**, by `walkSpeed × dt` with `dt` capped at `maxStepSeconds`
 * (1.4 m/s and 0.1 s, `domain/eyeNavigation.ts`). Under the software WebGL rasteriser these
 * tests run on, `explore.spec.ts` measured the whole floor drawing at roughly 2 fps, so a
 * second of wall clock buys about 2 × 1.4 × 0.1 = **0.28 m** rather than 1.4 m. Nothing here
 * speeds the walker up; the speed under test is the product's.
 *
 * That 0.28 m/s is the **slow bound**, not a measurement of this file: the climb below walks
 * its 13.6 m in some 16 s here, nearer 0.85 m/s, which is a renderer getting through about
 * six frames a second. Each test therefore sets its own timeout from its own measured local
 * time, in a named constant whose docblock carries the arithmetic, and the one test long
 * enough for the difference to matter is checked against the slow bound as well.
 * `test.slow()` only triples the 30 s default, which covers none of the heavy ones.
 *
 * One number the frame rate does *not* move: a frame advances the body by at most
 * `walkSpeed × maxStepSeconds` = **0.14 m**, whatever the rate, because the cap is on the
 * step and not on the clock. That is the granularity every waypoint below is chosen with.
 *
 * ## Why the climb is walked with the strafe keys and never turns
 *
 * The stair is a dog-leg (`domain/sourceOfTruth/plan.ts`): its bay spans x 1.60–5.60,
 * z 4.00–6.00, and the two flights sit on **different z strips** of it — flight A on the
 * north strip (z 4.00–5.00) rising west from the arrival landing to the half-landing above,
 * flight B on the south strip (z 5.00–6.00) rising east from that half-landing to the landing
 * of the storey above. Walking into the bay and turning 180° on the spot puts the body back
 * on the strip it came up, which descends: the turn has to be a turn *across* the bay, which
 * on the plan is a strafe of a full metre at the half-landing.
 *
 * The legs themselves are walked with W/S/A/D at the **start yaw**, which no leg changes —
 * the same turn-free discipline `explore.spec.ts` keeps, and here it is load-bearing rather
 * than tidy. A flight strip is 1.00 m wide and the body is a circle of radius 0.25 m, so a
 * leg has 0.25 m of lateral room either side of the strip centre. Yaw turns at 90°/s, and at
 * ~2 fps one frame of turning is 90 × 0.1 = **9°** — which is the finest a held J or L can be
 * aimed, since the key is released a frame after the reading that satisfied the poll. Over
 * the 2.00 m run of a flight, 9° of heading error is 2.00 × sin 9° = **0.31 m** of drift:
 * more lateral room than the strip has. A drifted body does not fail loudly either — it
 * wanders onto the neighbouring strip, whose surface at that x is half a storey away and out
 * of a walker's reach (`STAIR_REACH_RISERS`), so the step is refused, the leg stops making
 * progress and the test hangs until its timeout.
 *
 * Held at the start yaw instead, the legs are exactly axis-aligned — W is +x, S is −x, D is
 * +z, A is −z ({@link START_YAW}) — and the drift is zero by construction. The route is the
 * one the unit suite walks as `CLIMB` (`domain/eyeNavigation.test.ts`), which sets the
 * heading on the pose for the same reason: the assertions are about the climb, not about how
 * well a turn was timed. {@link expectHeadingHeld} asserts the yaw after every leg, so a leg
 * that did start turning is caught rather than left to time out.
 *
 * ## Why the pose is read off the minimap marker
 *
 * A leg that stopped when the *room* changed would not stop at all here: the whole climb
 * happens inside one space, `R06/STR`, and the only room change in it is the storey. So each
 * leg stops on a **coordinate** instead, read live off the minimap marker's `data-plan-x`,
 * `data-plan-z` and `data-yaw` (`ui/Minimap.tsx`), which is what makes the leg lengths a
 * consequence of where the body is rather than of how long a machine took to get it there.
 */

/** The room readout: a live region with no role, so it is found by its id. */
const ROOM_READOUT_SELECTOR = '#current-room';
/** What the readout says on the arrival landing of the ground storey, and of the one above. */
const GROUND_STAIRWELL_LINE = 'Room: F1-R06/STR · Stairwell';
const UPPER_STAIRWELL_LINE = 'Room: F2-R06/STR · Stairwell';

/** The stepper's reading: a live element with no role, so it is found by its id. */
const FLOOR_COUNT_SELECTOR = '#floor-count';
/**
 * What that element reads at the three counts this file visits.
 *
 * The whole text, prefix included: the `sr-only` lead-in is what makes the announcement a
 * sentence, and it is read from the same element the digits are shown in, so asserting the
 * pair together is what proves the two cannot drift (`ui/FloorCountStepper.tsx`).
 */
const ONE_STOREY_READING = 'Floors shown: 01';
const TWO_STOREYS_READING = 'Floors shown: 02';
const TEN_STOREYS_READING = 'Floors shown: 10';

/** Accessible names of the two stepper buttons. */
const DECREASE_NAME = 'Remove a floor';
const INCREASE_NAME = 'Add a floor';
/** Accessible name of the disclosure that opens the room list, the Tab stop after the pair. */
const ROOM_MENU_NAME = 'Go to room';

/** Values of `aria-disabled`, which is how a bound is worn here — never the `disabled` flag. */
const DISABLED = 'true';
const NOT_DISABLED = 'false';

/**
 * Presses it takes to cross the whole range, 1…10 (`domain/storeys.ts`).
 *
 * One fewer than the ten counts, because the range starts at one of them.
 */
const STEPS_ACROSS_RANGE = 9;

/**
 * The minimap marker, which carries the live pose as data attributes.
 *
 * The minimap is interior-only and `sm` and wider, so it is in the DOM at the default
 * viewport these tests run at.
 */
const POSE_MARKER_SELECTOR = '[data-plan-z]';
const PLAN_X_ATTRIBUTE = 'data-plan-x';
const PLAN_Z_ATTRIBUTE = 'data-plan-z';
const YAW_ATTRIBUTE = 'data-yaw';

/**
 * The yaw the interior opens on, as the marker prints it: −π/2, facing the corridor.
 *
 * With this heading forward is `(−sin yaw, −cos yaw) = (+1, 0)` and right is
 * `(cos yaw, −sin yaw) = (0, +1)`, so W walks +x, S walks −x, D strafes +z and A strafes −z.
 * Every leg of the climb is one of those four, and none of them changes the yaw — which is
 * why this is a constant to assert against rather than a value to sample.
 */
const START_YAW = '-1.571';

/** Physical keys the climb is walked with, at {@link START_YAW}. */
const EAST_KEY = 'KeyW';
const WEST_KEY = 'KeyS';
const SOUTH_KEY = 'KeyD';
const NORTH_KEY = 'KeyA';

/**
 * Where the body must be along z to be squarely on the north strip, in metres.
 *
 * Flight A is z 4.00–5.00 and the body is a circle of radius 0.25 m, so its centre belongs
 * between z 4.25 and z 4.75; 4.50 is the middle of that.
 *
 * The leg stops at 4.50 **or less**, and how far past it the body gets depends on how many
 * frames pass between the reading that satisfies the poll and the key coming back up — a
 * poll interval and a frame or two, so up to some 0.30 m at 0.14 m a frame. The waypoint is
 * safe anyway, and not by luck: the bay's own north face is at z 4.00, so collision stops
 * the body at z 4.25 however long the key is held (`domain/collision.ts`). Overshoot on this
 * leg costs frames, never the strip.
 */
const NORTH_STRIP_Z = 4.5;
/**
 * The same for the south strip, flight B's z 5.00–6.00: its centre line, reached from below.
 *
 * Capped the same way at the other end of the bay — the south face is at z 6.00, so the body
 * cannot be strafed past z 5.75 whatever the overshoot.
 */
const SOUTH_STRIP_Z = 5.5;
/**
 * Where the body must be along x to be squarely on the half-landing, in metres.
 *
 * The half-landing is x 1.60–2.60, so a body of radius 0.25 m is wholly on it between x 1.85
 * and x 2.35. 2.30 is inside that band, and overshoot past it is capped the way the two
 * strafe waypoints are: the bay's west face is at x 1.60, so collision holds the body at
 * x 1.85 however far the leg is allowed to run.
 */
const HALF_LANDING_X = 2.3;

/** Delay between reads of the readout or the pose marker while waiting for one to change. */
const POSE_POLL_INTERVAL_MS = 250;
/**
 * Upper bound for one leg of the climb to reach its waypoint.
 *
 * The longest is 2.80 m, some 10 s at the 0.28 m/s the arithmetic above works out to. This is
 * six times that, so a slow machine costs time rather than a failure.
 */
const LEG_TIMEOUT_MS = 60_000;

/**
 * Budget for the test that steps the stack across its whole range twice.
 *
 * Measured on this machine, serially, with the reporter's own per-test clock: **0.7 s**.
 * There is no locomotion in it and no canvas capture — twenty Enter presses and a page load.
 * What it could cost elsewhere is the rebuild behind each press: the tenth storey is ten
 * times the geometry of the first, and the exterior camera reframes to hold it, every frame
 * of that rasterised in software on a runner with no GPU.
 *
 * 45 s is some **60×** the local time, which is the margin the unknown above is worth; it is
 * still 20× the 3× CI slowdown `explore.spec.ts` records. Nothing in the test waits anything
 * out: every assertion here is a state change that has either happened or not.
 */
const STEPPER_RANGE_TEST_TIMEOUT_MS = 45_000;
/**
 * Budget for the test that proves a press redraws the building.
 *
 * Measured on this machine, serially: **9.4 s**. Three settled captures — each a series of
 * canvas screenshots until two come back byte-identical — around two presses that each
 * rebuild the storeys, plus the page load.
 *
 * 90 s is nearly **10×** the local time, and some 3× the 3× CI projection.
 */
const STACK_REDRAW_TEST_TIMEOUT_MS = 90_000;
/**
 * Budget for the test that finds the stepper in both views and walks the Tab order.
 *
 * Measured on this machine, serially: **3.4 s** — a page load, one camera flight into the
 * interior and nine Tab presses, with no locomotion and no canvas capture.
 *
 * 45 s is over **13×** the local time and over 4× the 3× CI projection.
 */
const BOTH_VIEWS_TEST_TIMEOUT_MS = 45_000;
/**
 * Budget for the climb: up one storey and back down, by the dog-leg.
 *
 * Measured on this machine, serially: **16.4 s**, for 13.6 m of locomotion — up: 0.56 m
 * north, 2.80 m west, 1.12 m south, 2.52 m east; down: 2.52 m west, 1.12 m north, 2.52 m
 * east — plus the page load, the press that puts the second storey there to climb to, and
 * the camera flight into the interior.
 *
 * The frame rate is the whole variance here, so the two ends of it are worth writing down.
 * Measured, those 13.6 m took about 16 s, i.e. some **0.85 m/s**, which is a renderer getting
 * through six frames a second; at the **0.28 m/s** the file's arithmetic derives for a 2 fps
 * software rasteriser the same walk is some **49 s**, and it is that slower figure the budget
 * is sized against rather than the happier measurement.
 *
 * 180 s is **11×** the measured local time and still some **3.7×** the 49 s the conservative
 * frame rate projects. It masks nothing: every wait in the test is a poll on the live pose
 * that ends the instant the body reaches its waypoint, so a faster renderer finishes sooner
 * and the number is never reached.
 */
const CLIMB_TEST_TIMEOUT_MS = 180_000;

/** The room readout, by its id. */
function getRoomReadout(page: Page): Locator {
  return page.locator(ROOM_READOUT_SELECTOR);
}

/** The stepper's live reading, by its id. */
function getFloorCountReading(page: Page): Locator {
  return page.locator(FLOOR_COUNT_SELECTOR);
}

/** The button that takes the top storey off the stack. */
function getDecreaseButton(page: Page): Locator {
  return page.getByRole('button', { name: DECREASE_NAME });
}

/** The button that adds a storey above the stack. */
function getIncreaseButton(page: Page): Locator {
  return page.getByRole('button', { name: INCREASE_NAME });
}

/** One live attribute of the pose marker; `null` before the marker has been placed. */
async function getPoseAttribute(page: Page, attribute: string): Promise<string | null> {
  return page.locator(POSE_MARKER_SELECTOR).getAttribute(attribute);
}

/** The live plan x or z of the pose, in metres; `NaN` before the first sample. */
async function getPlanCoordinate(page: Page, attribute: string): Promise<number> {
  const value = await getPoseAttribute(page, attribute);
  return value === null ? Number.NaN : Number(value);
}

/**
 * Holds one key until `until` resolves, then releases it.
 *
 * The release is in a `finally`, as every hold in these specs is: a key left down would drive
 * the body for the rest of the test.
 */
async function holdKey(page: Page, code: string, until: () => Promise<void>): Promise<void> {
  await page.keyboard.down(code);
  try {
    await until();
  } finally {
    await page.keyboard.up(code);
  }
}

/**
 * Holds one key until the pose passes a waypoint along one plan axis, then releases it.
 *
 * `NaN` satisfies neither comparison, so a marker that has not been placed yet simply keeps
 * the poll going.
 *
 * @param page - The page, in the interior view with the minimap rendered.
 * @param code - The key held, one of the four of {@link START_YAW}.
 * @param attribute - Which plan coordinate the waypoint is on.
 * @param limit - The waypoint, in metres.
 * @param direction - Whether the leg walks toward larger or smaller values of it.
 */
async function walkLeg(
  page: Page,
  code: string,
  attribute: string,
  limit: number,
  direction: 'atLeast' | 'atMost',
): Promise<void> {
  await holdKey(page, code, async () => {
    const poll = expect.poll(() => getPlanCoordinate(page, attribute), {
      message: `holding ${code} should walk the pose to ${attribute} ${direction} ${String(limit)}`,
      timeout: LEG_TIMEOUT_MS,
      intervals: [POSE_POLL_INTERVAL_MS],
    });
    if (direction === 'atLeast') {
      await poll.toBeGreaterThanOrEqual(limit);
    } else {
      await poll.toBeLessThanOrEqual(limit);
    }
  });
}

/** Holds one key until the room readout reads exactly `line`, then releases it. */
async function walkLegUntilRoom(page: Page, code: string, line: string): Promise<void> {
  await holdKey(page, code, async () => {
    await expect
      .poll(async () => (await getRoomReadout(page).textContent()) ?? '', {
        message: `holding ${code} should bring the readout to "${line}"`,
        timeout: LEG_TIMEOUT_MS,
        intervals: [POSE_POLL_INTERVAL_MS],
      })
      .toBe(line);
  });
}

/**
 * Asserts the heading has not moved off {@link START_YAW}.
 *
 * Called after every leg: a leg that turned would drift off its flight strip and stall, and
 * catching it here names the fault instead of leaving the next leg to time out.
 */
async function expectHeadingHeld(page: Page): Promise<void> {
  expect(
    await getPoseAttribute(page, YAW_ATTRIBUTE),
    'no leg of the climb turns: the strafe keys do the dog-leg',
  ).toBe(START_YAW);
}

/** Opens the page in the exterior view, with the canvas up. */
async function openExterior(page: Page): Promise<void> {
  await page.goto('/');
  await expectCanvasVisible(page);
  await expect(page.getByRole('status')).toHaveText(EXTERIOR_STATUS);
}

/** Enters the interior view and waits for the start pose to be announced. */
async function enterInterior(page: Page): Promise<void> {
  await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();
  await expect(page.getByRole('status')).toHaveText(FIRST_PERSON_STATUS);
  await expect(getViewRegion(page)).toBeFocused();
  await expectCameraIdle(page);
  await expect(getRoomReadout(page)).toHaveText(GROUND_STAIRWELL_LINE);
}

/** Presses Enter on the focused button `times` times. */
async function pressEnter(page: Page, times: number): Promise<void> {
  for (let press = 0; press < times; press += 1) {
    await page.keyboard.press('Enter');
  }
}

test.describe('stacking storeys', () => {
  test('offers the floor stepper in both views, in the Tab order the hint promises', async ({
    page,
  }) => {
    test.setTimeout(BOTH_VIEWS_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);

    // How tall the building is, is as much an exterior fact as an interior one, so the stepper
    // is the one HUD panel with no view branch at all (`app/App.tsx`).
    await expect(getFloorCountReading(page)).toHaveText(ONE_STOREY_READING);
    await expect(getDecreaseButton(page)).toHaveAttribute('aria-disabled', DISABLED);
    await expect(getIncreaseButton(page)).toHaveAttribute('aria-disabled', NOT_DISABLED);

    // The order the navigation hint promises, walked with the key it names. Outside, the
    // Third person toggle and the room menu are not rendered, so the pair follows the view
    // toggle directly.
    await page.keyboard.press('Tab');
    await expect(getViewRegion(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: VIEW_TOGGLE_NAME })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(getDecreaseButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(getIncreaseButton(page)).toBeFocused();

    await enterInterior(page);
    await expect(getFloorCountReading(page)).toHaveText(ONE_STOREY_READING);

    // Inside, the same order with the two interior controls in it: view toggle, Third person,
    // the stepper's pair, then "Go to room".
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: VIEW_TOGGLE_NAME })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: CAMERA_TOGGLE_NAME })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(getDecreaseButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(getIncreaseButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: ROOM_MENU_NAME })).toBeFocused();

    expect(pageErrors).toEqual([]);
  });

  test('steps the stack to ten and back to one without ever dropping focus', async ({ page }) => {
    test.setTimeout(STEPPER_RANGE_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);

    // Nine presses from the bottom of the range reach the top of it.
    const increase = getIncreaseButton(page);
    await increase.focus();
    await pressEnter(page, STEPS_ACROSS_RANGE);
    await expect(getFloorCountReading(page)).toHaveText(TEN_STOREYS_READING);
    await expect(increase).toHaveAttribute('aria-disabled', DISABLED);
    await expect(getDecreaseButton(page)).toHaveAttribute('aria-disabled', NOT_DISABLED);

    // The whole reason the bound is `aria-disabled` and not the `disabled` attribute: the last
    // press of a run happens under the user's own focus, and a `disabled` element cannot hold
    // focus — it would drop them onto `<body>` mid-run with no idea where they landed.
    await expect(increase).toBeFocused();
    // And a press at the bound is a no-op rather than an eleventh storey.
    await pressEnter(page, 1);
    await expect(getFloorCountReading(page)).toHaveText(TEN_STOREYS_READING);
    await expect(increase).toBeFocused();

    const decrease = getDecreaseButton(page);
    await decrease.focus();
    await pressEnter(page, STEPS_ACROSS_RANGE);
    await expect(getFloorCountReading(page)).toHaveText(ONE_STOREY_READING);
    await expect(decrease).toHaveAttribute('aria-disabled', DISABLED);
    await expect(increase).toHaveAttribute('aria-disabled', NOT_DISABLED);
    await expect(decrease).toBeFocused();
    await pressEnter(page, 1);
    await expect(getFloorCountReading(page)).toHaveText(ONE_STOREY_READING);
    await expect(decrease).toBeFocused();

    expect(pageErrors).toEqual([]);
  });

  test('redraws the building when a storey is added, and undraws it when one is removed', async ({
    page,
  }) => {
    test.setTimeout(STACK_REDRAW_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);
    // The HUD is masked out of every capture here, the stepper's own reading included, so a
    // changed frame is changed geometry and nothing else.
    const oneStorey = await captureSettledScene(page);

    await getIncreaseButton(page).click();
    await expect(getFloorCountReading(page)).toHaveText(TWO_STOREYS_READING);
    const twoStoreys = await captureSettledScene(page);
    expect(
      twoStoreys.equals(oneStorey),
      'adding a storey should change the rendered building, HUD masked',
    ).toBe(false);

    await getDecreaseButton(page).click();
    await expect(getFloorCountReading(page)).toHaveText(ONE_STOREY_READING);
    // Byte-identical to the first capture, not merely different from the second: the stack is
    // rebuilt from the count, so removing the storey that was added has to leave the same
    // building standing, not a similar one.
    expect(
      (await captureSettledScene(page)).equals(oneStorey),
      'removing the storey again should leave the building exactly as it was',
    ).toBe(true);
    expect((await captureScene(page)).equals(twoStoreys)).toBe(false);

    expect(pageErrors).toEqual([]);
  });

  test('climbs the dog-leg stair to the second storey and walks back down', async ({ page }) => {
    test.setTimeout(CLIMB_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);

    // There is nowhere to climb to until the stack has a second storey: the stairwell is
    // capped at the storeys that exist, so on a one-storey building the flight out of the
    // arrival landing leads nowhere.
    await getIncreaseButton(page).click();
    await expect(getFloorCountReading(page)).toHaveText(TWO_STOREYS_READING);

    await enterInterior(page);
    await expectHeadingHeld(page);

    // 1. Off the arrival landing onto the north strip, where flight A starts: A strafes −z.
    await walkLeg(page, NORTH_KEY, PLAN_Z_ATTRIBUTE, NORTH_STRIP_Z, 'atMost');
    await expectHeadingHeld(page);
    await expect(getRoomReadout(page)).toHaveText(GROUND_STAIRWELL_LINE);

    // 2. West up flight A, to the half-landing half a storey above this floor: S walks −x.
    await walkLeg(page, WEST_KEY, PLAN_X_ATTRIBUTE, HALF_LANDING_X, 'atMost');
    await expectHeadingHeld(page);

    // 3. The dog-leg itself: a metre south across the half-landing, from the strip just
    //    climbed to the strip flight B rises on. This is the leg a 180° turn cannot stand in
    //    for — turning on the spot would send the body back down the flight it came up.
    await walkLeg(page, SOUTH_KEY, PLAN_Z_ATTRIBUTE, SOUTH_STRIP_Z, 'atLeast');
    await expectHeadingHeld(page);
    // Still the ground storey's stairwell: a half storey climbed is not a storey.
    await expect(getRoomReadout(page)).toHaveText(GROUND_STAIRWELL_LINE);

    // 4. East up flight B and onto the landing of the storey above, which is where the whole
    //    climb is announced: the readout's floor prefix turns over from F1 to F2.
    await walkLegUntilRoom(page, EAST_KEY, UPPER_STAIRWELL_LINE);
    await expectHeadingHeld(page);

    // And back down, the same dog-leg walked the other way: west down flight B, north across
    // the half-landing, then east down flight A onto the floor it started on.
    await walkLeg(page, WEST_KEY, PLAN_X_ATTRIBUTE, HALF_LANDING_X, 'atMost');
    await expectHeadingHeld(page);
    await walkLeg(page, NORTH_KEY, PLAN_Z_ATTRIBUTE, NORTH_STRIP_Z, 'atMost');
    await expectHeadingHeld(page);
    await walkLegUntilRoom(page, EAST_KEY, GROUND_STAIRWELL_LINE);
    await expectHeadingHeld(page);

    expect(pageErrors).toEqual([]);
  });
});
