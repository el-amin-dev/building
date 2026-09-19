import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  CAMERA_TOGGLE_NAME,
  CAMERA_TRANSITION_ATTRIBUTE,
  CAMERA_TRANSITION_IDLE,
  CAMERA_TRANSITION_RUNNING,
  EXTERIOR_STATUS,
  FIRST_PERSON_STATUS,
  VIEW_TOGGLE_NAME,
} from './constants.ts';
import {
  captureScene,
  captureSettledScene,
  expectCameraIdle,
  expectCanvasVisible,
  expectSceneChanged,
  getViewRegion,
} from './sceneCapture.ts';

/**
 * Walking the floor: the required route, the three ways a walk ends, and reduced motion.
 *
 * ## Wall-clock arithmetic — where every budget in this file comes from
 *
 * The body advances once per **rendered frame**, by `walkSpeed × dt` with `dt` capped at
 * `maxStepSeconds` (1.4 m/s and 0.1 s, `domain/eyeNavigation.ts`). The cap is what makes the
 * frame rate matter: under the software WebGL rasteriser these tests run on, the whole floor
 * draws at roughly 2 fps, so a second of wall clock buys about 2 × 1.4 × 0.1 = **0.28 m**
 * rather than 1.4 m — a fifth of the nominal speed. The walker is deliberately not sped up
 * for the tests; the speed under test is the product's.
 *
 * At 0.28 m/s the legs of the route cost:
 *
 * - **D / A**, the guest-room pair: z 5.00 → 6.30 across the 0.30 m wall, 1.30 m out and
 *   0.75 m back — the A leg walks clear of the doorway rather than stopping at the room
 *   boundary ({@link CLEAR_OF_DOORWAY_Z}) — about 5 s and 3 s;
 * - **W / S**, the corridor pair: x 5.10 → 5.60 over the join that carries no wall at all,
 *   0.50 m each way, about 2 s per leg;
 * - **the kitchen walk**: the route the follower takes is stairs → corridor → kitchen, some
 *   13 m of it, about 47 s.
 *
 * That is a little over a minute of locomotion for the whole route, before the settled
 * captures around it (each of which is itself a series of canvas screenshots costing most of a
 * second apiece) and before any variance in the frame rate. `test.slow()` only triples the
 * 30 s default, which does not cover it, so every test here sets its own timeout from the
 * numbers above with room to spare.
 *
 * ## Why the route runs D/A before W/S
 *
 * The task's order is W/S first, and that order is unsafe for the leg that follows it. The
 * `stairs ↔ guestRoom` door spans x 4.65–5.55 (`along: 'x', spanMin: 4.65, width: 0.9`), so a
 * body of radius 0.25 m passes only while its centre is within x 4.90–5.30 — a 0.40 m window.
 * A held key is released once the readout has changed, which is up to a poll interval and a
 * frame or two after the boundary was crossed, so W then S leaves the body somewhere around
 * x 5.3–5.5: at or outside that window, where D would walk into masonry and the test would
 * hang until its timeout.
 *
 * Run from the start pose instead, the D leg begins at x 5.10, the dead centre of the window,
 * and D and A move along z only — so x is still exactly 5.10 when A brings the body back.
 * Nothing is re-centred and no leg turns. The W/S pair is then free to overshoot, because the
 * stairwell's whole east face is open to the corridor and the automatic walk after it routes
 * from wherever the body stands. Same six assertions, same turn-free legs, in the one order
 * that cannot wedge itself against a doorjamb.
 *
 * The same hazard bites one leg later, and for the same reason: a leg that stops the moment
 * the *room* changes stops a few centimetres past the boundary, which for a door means
 * standing in the doorway. The A leg therefore stops on a *coordinate* instead — see
 * {@link CLEAR_OF_DOORWAY_Z} — so the corridor leg that follows starts on open floor rather
 * than with the body's circle overlapping the wall band it has just come through.
 */

/** The room readout: a live region with no role, so it is found by its id. */
const ROOM_READOUT_SELECTOR = '#current-room';

/** What the readout says in each room of the route. */
const STAIRWELL_LINE = 'Room: F1-R06/STR · Stairwell';
const CORRIDOR_LINE = 'Room: F1-R07/COR · Corridor';
const GUEST_ROOM_LINE = 'Room: F1-R09/GST · Guest room';
const KITCHEN_LINE = 'Room: F1-R11/KIT · Kitchen';
/** What it says instead while an automatic walk is on its way there. */
const WALKING_TO_KITCHEN_LINE = 'Walking to F1-R11/KIT · Kitchen';
/** How every walk announcement opens, whichever room it names. */
const WALKING_PREFIX = 'Walking to';

/** Accessible name of the disclosure that opens the room list, and of the kitchen in it. */
const ROOM_MENU_NAME = 'Go to room';
const KITCHEN_ITEM_NAME = 'R11/KIT · Kitchen';
/** Accessible name of the button that abandons a walk in progress. */
const STOP_WALKING_NAME = 'Stop walking';

/** The open room list, by its id: a plain `<ul>`, so it is found the way the readout is. */
const ROOM_LIST_SELECTOR = '#room-list';
/** How many rooms the list offers: the 22 spaces of the plan less its two floorless voids. */
const ROOM_COUNT = 20;
/** The left and top edges of the window, in CSS pixels. */
const VIEWPORT_ORIGIN_PX = 0;
/** A narrow phone viewport, the second width the open list is measured at. */
const PHONE_VIEWPORT = Object.freeze({ width: 400, height: 800 });
/**
 * Budget for opening the list at two viewports and measuring twenty items in each: two page
 * loads, two camera flights, and no locomotion at all.
 */
const LIST_LAYOUT_TEST_TIMEOUT_MS = 120_000;

/** Physical keys held or pressed here; W/S move along x, D/A along z, V switches the camera. */
const FORWARD_KEY = 'KeyW';
const BACK_KEY = 'KeyS';
const RIGHT_KEY = 'KeyD';
const LEFT_KEY = 'KeyA';
const CAMERA_MODE_KEY = 'KeyV';
/** Abandons an automatic walk while the view has focus. */
const CANCEL_WALK_KEY = 'Escape';

/**
 * The minimap marker, which carries the live pose as data attributes.
 *
 * The readout answers "which room", which is what this spec is about; the marker answers
 * "where exactly", which is what a leg needs when the room alone would stop it inside a
 * doorway. The minimap is interior-only and `sm` and wider, so it is in the DOM at the
 * default viewport these tests run at.
 */
const POSE_MARKER_SELECTOR = '[data-plan-z]';
/** Attribute of {@link POSE_MARKER_SELECTOR} carrying the plan z of the pose, in metres. */
const PLAN_Z_ATTRIBUTE = 'data-plan-z';
/**
 * How far back along z the A leg walks before the corridor leg starts, in metres.
 *
 * The `stairs ↔ guestRoom` wall band is z 6.00–6.30 and the body is a circle of radius
 * 0.25 m, so the body is clear of that band only once its centre is at z 5.75 or less.
 * Stopping the A leg when the readout flips to the stairwell stops it at about z 5.95
 * instead — still in the doorway, where the next leg's push toward +x drives the body's
 * circle into the door's east jamb at x 5.55 and wedges it there, walking nowhere. This is
 * 5.75 with 0.15 m of margin for the frame the key is released on.
 */
const CLEAR_OF_DOORWAY_Z = 5.6;

/** Delay between reads of the room readout while waiting for it to change. */
const ROOM_POLL_INTERVAL_MS = 250;
/**
 * Upper bound for a manual leg of the route to change the room readout.
 *
 * The longest is 1.30 m, about 5 s at the 0.28 m/s the arithmetic above works out to. This is
 * an order of magnitude more, so a slow machine costs time rather than a failure.
 */
const ROOM_CHANGE_TIMEOUT_MS = 60_000;
/**
 * Upper bound for the automatic walk to the kitchen to arrive: some 13 m, about 47 s at
 * 0.28 m/s, with the same order of magnitude of head-room.
 */
const KITCHEN_WALK_TIMEOUT_MS = 180_000;

/**
 * Budget for the whole route: six legs of locomotion (a little over a minute together), the
 * settled captures around them, and the page load.
 */
const ROUTE_TEST_TIMEOUT_MS = 300_000;
/**
 * Budget for a test that starts the kitchen walk and interrupts it: the walk, whatever part of
 * it runs before the interruption, and the captures that prove the scene then stops.
 */
const CANCEL_TEST_TIMEOUT_MS = 240_000;
/** Budget for the test that lets the kitchen walk run to its end under reduced motion. */
const REDUCED_MOTION_TEST_TIMEOUT_MS = 240_000;

/**
 * How long the scene is left alone after a cancellation before it is captured again. A fixed
 * wait is the point: the assertion is that nothing moves any more once the walk is abandoned.
 */
const AFTER_CANCEL_MS = 1_000;

/** How many times the camera transition attribute is sampled across a reduced-motion toggle. */
const REDUCED_MOTION_SAMPLE_COUNT = 8;
/** Delay between those samples; together they cover more than the 0.9 s a flight would last. */
const REDUCED_MOTION_SAMPLE_INTERVAL_MS = 150;

/** The room readout, by its id. */
function getRoomReadout(page: Page): Locator {
  return page.locator(ROOM_READOUT_SELECTOR);
}

/**
 * Waits until the room readout reads exactly `line`.
 *
 * Polled rather than waited out: the readout changes when the body crosses a boundary, which
 * happens after however many frames the renderer gets through, and no fixed wait can stand in
 * for that.
 */
async function expectRoomLine(
  page: Page,
  line: string,
  timeout: number = ROOM_CHANGE_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(async () => (await getRoomReadout(page).textContent()) ?? '', {
      message: `the room readout should read "${line}"`,
      timeout,
      intervals: [ROOM_POLL_INTERVAL_MS],
    })
    .toBe(line);
}

/**
 * Holds one key until the readout announces `line`, then releases it.
 *
 * The release is in a `finally`, as every hold in these specs is: a key left down would drive
 * the body for the rest of the test.
 */
async function holdKeyUntilRoom(page: Page, code: string, line: string): Promise<void> {
  await page.keyboard.down(code);
  try {
    await expectRoomLine(page, line);
  } finally {
    await page.keyboard.up(code);
  }
}

/** The live plan z of the pose, read off the minimap marker; `NaN` before the first sample. */
async function getPlanZ(page: Page): Promise<number> {
  const value = await page.locator(POSE_MARKER_SELECTOR).getAttribute(PLAN_Z_ATTRIBUTE);
  return value === null ? Number.NaN : Number(value);
}

/**
 * Holds one key until the pose has walked back to `limit` metres or less along z, then
 * releases it.
 *
 * For the leg where a room boundary is the wrong place to stop: see
 * {@link CLEAR_OF_DOORWAY_Z}. `NaN` never satisfies the comparison, so a marker that has not
 * been placed yet simply keeps the poll going.
 */
async function holdKeyUntilPlanZAtMost(page: Page, code: string, limit: number): Promise<void> {
  await page.keyboard.down(code);
  try {
    await expect
      .poll(() => getPlanZ(page), {
        message: `holding ${code} should walk the pose back to z ${String(limit)} or less`,
        timeout: ROOM_CHANGE_TIMEOUT_MS,
        intervals: [ROOM_POLL_INTERVAL_MS],
      })
      .toBeLessThanOrEqual(limit);
  } finally {
    await page.keyboard.up(code);
  }
}

/** Opens the page, enters the interior view, and waits for the start pose to be announced. */
async function enterInterior(page: Page): Promise<void> {
  await page.goto('/');
  await expectCanvasVisible(page);

  await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();
  await expect(page.getByRole('status')).toHaveText(FIRST_PERSON_STATUS);
  await expect(getViewRegion(page)).toBeFocused();
  await expectCameraIdle(page);
  await expectRoomLine(page, STAIRWELL_LINE);
}

/**
 * Picks the kitchen from the "Go to room" list with the pointer, which starts the walk and
 * hands focus back to the view region, so Escape and the movement keys keep working.
 */
async function startWalkToKitchen(page: Page): Promise<void> {
  await page.getByRole('button', { name: ROOM_MENU_NAME }).click();
  await page.getByRole('button', { name: KITCHEN_ITEM_NAME }).click();
  await expect(getRoomReadout(page)).toHaveText(WALKING_TO_KITCHEN_LINE);
  await expect(page.getByRole('button', { name: STOP_WALKING_NAME })).toBeVisible();
  await expect(getViewRegion(page)).toBeFocused();
}

/**
 * Opens the room list and names every room that cannot be brought inside the window.
 *
 * **Why this is measured, and why in a browser.** The list is `position: absolute`, and an
 * absolute box with no offset falls back to its *static* position — where it would have sat
 * in the panel's centring flex row. That centred a 256 px list on a ~44 px panel and put its
 * top at −106 px, so the first rooms were above the top of the screen and stayed there:
 * focusing one scrolled nothing, because `main` is `overflow: hidden` and the `<ul>` has no
 * room to scroll upward, which left them unreachable by pointer *and* by keyboard. jsdom
 * computes no layout and cannot see any of it; the earlier specs missed it because the one
 * room they pick happened to land inside the visible band.
 *
 * Each item is focused before it is measured, which is exactly the distinction that matters:
 * a room merely scrolled out of a list that *can* scroll comes into view and is operable,
 * while a room parked outside the window does not move and is not. Every item, not a sample:
 * which rooms fall off depends on the viewport and on how many rooms the plan has.
 *
 * @param page - The page, already in the interior view.
 * @returns One line per unreachable room, naming it and the box it was stuck at.
 */
async function getUnreachableRooms(page: Page): Promise<string[]> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('the page has no viewport size to measure the room list against');
  }

  const trigger = page.getByRole('button', { name: ROOM_MENU_NAME });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const items = page.locator(ROOM_LIST_SELECTOR).getByRole('button');
  await expect(items).toHaveCount(ROOM_COUNT);

  const unreachable: string[] = [];
  for (const item of await items.all()) {
    const name = ((await item.textContent()) ?? '').trim();
    await item.focus();
    const box = await item.boundingBox();
    if (box === null) {
      unreachable.push(`${name}: no box at all`);
      continue;
    }
    const isInside =
      box.x >= VIEWPORT_ORIGIN_PX &&
      box.y >= VIEWPORT_ORIGIN_PX &&
      box.x + box.width <= viewport.width &&
      box.y + box.height <= viewport.height;
    if (!isInside) {
      unreachable.push(
        `${name}: x ${String(box.x)}…${String(box.x + box.width)}, y ${String(box.y)}…${String(box.y + box.height)}`,
      );
    }
  }
  return unreachable;
}

/**
 * Asserts the open list hangs below its trigger and sits wholly inside the window.
 *
 * The panel it is anchored to is near the top of the screen, so the list's own 256 px cap is
 * what keeps its scroll port on screen; a list that overflowed the bottom edge would have
 * rows nothing could scroll to, the same defect the other way up.
 */
async function expectListAnchoredInsideViewport(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('the page has no viewport size to measure the room list against');
  }
  const triggerBox = await page.getByRole('button', { name: ROOM_MENU_NAME }).boundingBox();
  const listBox = await page.locator(ROOM_LIST_SELECTOR).boundingBox();
  expect(triggerBox, 'the trigger should have a box').not.toBeNull();
  expect(listBox, 'the open list should have a box').not.toBeNull();
  if (triggerBox === null || listBox === null) {
    return;
  }

  expect(
    listBox.y,
    'the open list should start below the trigger, not on top of the controls above it',
  ).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  expect(
    listBox.y,
    'the open list should not hang off the top of the window',
  ).toBeGreaterThanOrEqual(VIEWPORT_ORIGIN_PX);
  expect(
    listBox.y + listBox.height,
    'the open list should not hang off the bottom of the window',
  ).toBeLessThanOrEqual(viewport.height);
  expect(
    listBox.x,
    'the open list should not hang off the left of the window',
  ).toBeGreaterThanOrEqual(VIEWPORT_ORIGIN_PX);
  expect(
    listBox.x + listBox.width,
    'the open list should not hang off the right of the window',
  ).toBeLessThanOrEqual(viewport.width);
}

/** Waits until the readout stops announcing a walk, i.e. the walk has been abandoned. */
async function expectWalkAbandoned(page: Page): Promise<void> {
  await expect
    .poll(
      async () => ((await getRoomReadout(page).textContent()) ?? '').startsWith(WALKING_PREFIX),
      {
        message: 'the readout should stop announcing the walk once it is cancelled',
        timeout: ROOM_CHANGE_TIMEOUT_MS,
        intervals: [ROOM_POLL_INTERVAL_MS],
      },
    )
    .toBe(false);
  await expect(page.getByRole('button', { name: STOP_WALKING_NAME })).toHaveCount(0);
}

/** Asserts that the scene is at rest and stays that way over {@link AFTER_CANCEL_MS}. */
async function expectSceneStopped(page: Page, message: string): Promise<void> {
  const stopped = await captureSettledScene(page);
  // A fixed wait is intentional: the assertion is that nothing changes during it.
  await page.waitForTimeout(AFTER_CANCEL_MS);
  expect((await captureScene(page)).equals(stopped), message).toBe(true);
}

test.describe('exploring the floor', () => {
  test('walks the stairs arrival to the corridor, the guest room and the kitchen', async ({
    page,
  }) => {
    test.setTimeout(ROUTE_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    // 1. The interior opens on the stair arrival landing, (5.10, 5.00) facing the corridor, so
    //    W is +x, S is −x, D is +z and A is −z: the whole route needs no turning.
    await enterInterior(page);

    // 2. D crosses the 0.90 m `stairs ↔ guestRoom` door — 1.30 m north, through the wall at
    //    z 6.00–6.30 — from the one x the door is centred on. See the file's docblock for why
    //    this pair runs before the corridor pair.
    await holdKeyUntilRoom(page, RIGHT_KEY, GUEST_ROOM_LINE);

    // 3. A steps back through the same door onto the landing; x never changed. It walks clear
    //    of the doorway rather than stopping at the room boundary, so the leg after it starts
    //    on open floor — see CLEAR_OF_DOORWAY_Z.
    await holdKeyUntilPlanZAtMost(page, LEFT_KEY, CLEAR_OF_DOORWAY_Z);
    await expectRoomLine(page, STAIRWELL_LINE);

    // 4. W crosses the join at x 5.60, where the stair landing meets the corridor with no wall
    //    at all — the demountable panel the owner asked not to be drawn.
    await holdKeyUntilRoom(page, FORWARD_KEY, CORRIDOR_LINE);

    // 5. S comes back over it.
    await holdKeyUntilRoom(page, BACK_KEY, STAIRWELL_LINE);

    // 6. The kitchen is reached with the automatic walk on purpose: its door is a 0.40 m window
    //    some 8 m east, and releasing a held key inside one by eye is exactly the flakiness the
    //    turn-free legs above exist to avoid. The walk announces where it is going, then the
    //    arrival is the destination turning up as the room the explorer is in.
    await startWalkToKitchen(page);
    await expectRoomLine(page, KITCHEN_LINE, KITCHEN_WALK_TIMEOUT_MS);

    expect(pageErrors).toEqual([]);
  });

  test('keeps every room of the open list reachable, at both widths', async ({ page }) => {
    test.setTimeout(LIST_LAYOUT_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await enterInterior(page);
    expect(await getUnreachableRooms(page), 'rooms off screen at the default viewport').toEqual([]);
    await expectListAnchoredInsideViewport(page);

    // Again at a phone width, where the HUD band is shorter still. Reloaded rather than
    // resized, as the accessibility audit does it: the layout is settled at mount, so
    // resizing an already-open list would not exercise the same thing.
    await page.setViewportSize(PHONE_VIEWPORT);
    await enterInterior(page);
    expect(await getUnreachableRooms(page), 'rooms off screen at a phone width').toEqual([]);
    await expectListAnchoredInsideViewport(page);

    expect(pageErrors).toEqual([]);
  });

  test('abandons an automatic walk as soon as a movement key is held', async ({ page }) => {
    test.setTimeout(CANCEL_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await enterInterior(page);
    await startWalkToKitchen(page);

    // Taking the controls back ends the trip rather than fighting it for the body.
    await page.keyboard.down(FORWARD_KEY);
    try {
      await expectWalkAbandoned(page);
    } finally {
      await page.keyboard.up(FORWARD_KEY);
    }

    // And it stays ended: nothing keeps walking to the kitchen behind the viewer's back.
    await expectSceneStopped(page, 'a cancelled walk should not keep moving the scene');
    expect(((await getRoomReadout(page).textContent()) ?? '').startsWith(WALKING_PREFIX)).toBe(
      false,
    );

    expect(pageErrors).toEqual([]);
  });

  test('keeps walking when V switches the camera mode mid-walk', async ({ page }) => {
    test.setTimeout(CANCEL_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await enterInterior(page);
    await startWalkToKitchen(page);

    // V is not a movement key: it changes how the camera follows the body, which is not the
    // viewer taking the controls back, so the walk must survive it.
    const cameraToggle = page.getByRole('button', { name: CAMERA_TOGGLE_NAME });
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press(CAMERA_MODE_KEY);
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(getRoomReadout(page)).toHaveText(WALKING_TO_KITCHEN_LINE);

    // The walk finishes in third person, which is the whole assertion: the camera mode changed
    // and the trip carried on to its destination.
    await expectRoomLine(page, KITCHEN_LINE, KITCHEN_WALK_TIMEOUT_MS);
    await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');

    expect(pageErrors).toEqual([]);
  });

  test('makes the view flight instant under reduced motion, but still walks', async ({ page }) => {
    test.setTimeout(REDUCED_MOTION_TEST_TIMEOUT_MS);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expectCanvasVisible(page);

    const region = getViewRegion(page);
    await expect(region).toHaveAttribute(CAMERA_TRANSITION_ATTRIBUTE, CAMERA_TRANSITION_IDLE);

    // The flight is suppressed rather than shortened, so the attribute never reads "running" at
    // any point after a toggle. Sampled repeatedly across a window longer than the 0.9 s a
    // flight would take, in both directions: a single read could simply have missed it.
    const toggle = page.getByRole('button', { name: VIEW_TOGGLE_NAME });
    await toggle.click();
    await expect(page.getByRole('status')).toHaveText(FIRST_PERSON_STATUS);
    await expectNeverRunning(page);

    await toggle.click();
    await expect(page.getByRole('status')).toHaveText(EXTERIOR_STATUS);
    await expectNeverRunning(page);

    // Locomotion is not decoration: the preference governs the camera flight and nothing else,
    // so an automatic walk still walks at its normal pace — the scene moves while it is on its
    // way, which is what tells the two apart.
    await toggle.click();
    await expect(region).toBeFocused();
    await expectRoomLine(page, STAIRWELL_LINE);
    const beforeWalk = await captureSettledScene(page);
    await startWalkToKitchen(page);
    await expectSceneChanged(
      page,
      beforeWalk,
      'an automatic walk must still move the scene under reduced motion',
      KITCHEN_WALK_TIMEOUT_MS,
    );

    // Escape, the keyboard half of stopping a walk, with focus on the view.
    await page.keyboard.press(CANCEL_WALK_KEY);
    await expectWalkAbandoned(page);

    expect(pageErrors).toEqual([]);
  });
});

/**
 * Samples the camera transition attribute across a window longer than a flight would last and
 * asserts that it never reads "running".
 */
async function expectNeverRunning(page: Page): Promise<void> {
  const region = getViewRegion(page);
  for (let sample = 0; sample < REDUCED_MOTION_SAMPLE_COUNT; sample += 1) {
    expect(
      await region.getAttribute(CAMERA_TRANSITION_ATTRIBUTE),
      'the camera flight must be suppressed under reduced motion',
    ).not.toBe(CAMERA_TRANSITION_RUNNING);
    // A fixed wait is intentional: the assertion is that nothing starts during the window.
    await page.waitForTimeout(REDUCED_MOTION_SAMPLE_INTERVAL_MS);
  }
}
