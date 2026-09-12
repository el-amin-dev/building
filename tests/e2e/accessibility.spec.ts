import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { EXTERIOR_STATUS, FIRST_PERSON_STATUS, VIEW_TOGGLE_NAME } from './constants.ts';
import { expectCameraIdle, expectCanvasVisible } from './sceneCapture.ts';

/**
 * axe-core audits of the HUD, in every layout that renders a different set of elements.
 *
 * ## What is audited, and why it is scoped the way it is
 *
 * `include('main')` with `exclude('canvas')`: a WebGL canvas has no DOM to audit at all — its
 * accessible alternative is the role, the name and the description of the region wrapping it,
 * and those live on the `div`, which axe does see. Auditing the canvas element itself would
 * check nothing and only add a rule about an element whose content axe cannot reach.
 *
 * `exclude('#leva__root')` is the Leva debug panel: third-party markup, mounted hidden and
 * only ever shown in development (`DebugPanel`), so it is neither ours to fix nor part of
 * what a viewer of the app is given.
 *
 * **No axe rule is disabled here.** A violation is a finding to report and fix in the HUD,
 * not something to narrow the audit until it disappears.
 *
 * ## Why four runs
 *
 * The HUD is not one DOM. The exterior view renders the camera pad and no interior panel; the
 * interior renders the readout, the room menu, the minimap and the remote control; opening the
 * room list adds twenty buttons and the `aria-expanded`/`aria-controls` pair, which is where
 * most of the new ARIA of this part lives; and below the `sm` breakpoint the minimap is gone,
 * the hint is the short one and the pad is anchored to the bottom of the screen outside the
 * HUD band. An audit of one of those says nothing about the other three.
 */

/** The HUD DOM: everything the app renders, canvas aside. */
const HUD_SCOPE = 'main';
/** The WebGL canvas, which has no DOM to audit. */
const CANVAS_SCOPE = 'canvas';
/** The Leva debug panel: third-party, and shown in development only. */
const LEVA_SCOPE = '#leva__root';

/**
 * The conformance the new UI promises: WCAG 2.2 AA, which includes every A and AA success
 * criterion of 2.0 and 2.1 (the tags are cumulative, so all five are named).
 */
const WCAG_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Accessible name of the disclosure that opens the room list. */
const ROOM_MENU_NAME = 'Go to room';
/** The room whose button is waited for, to prove the list is really open before the audit. */
const KITCHEN_ITEM_NAME = 'R11/KIT · Kitchen';
/** The room readout, whose first text proves the interior HUD has finished rendering. */
const ROOM_READOUT_SELECTOR = '#current-room';
/** What the readout says at the start pose: the stair arrival landing. */
const STAIRWELL_LINE = 'Room: R06/STR · Stairwell';

/** A narrow phone viewport: a different set of HUD elements renders at this width. */
const PHONE_VIEWPORT = Object.freeze({ width: 400, height: 800 });

/**
 * Runs axe over the HUD as it stands.
 *
 * @param page - The page under test, already in the view and layout being audited.
 * @returns The violations axe found, which must be none.
 */
async function analyzeHud(page: Page) {
  const results = await new AxeBuilder({ page })
    .include(HUD_SCOPE)
    .exclude(CANVAS_SCOPE)
    .exclude(LEVA_SCOPE)
    .withTags([...WCAG_TAGS])
    .analyze();
  return results.violations;
}

/**
 * Enters the interior view and waits until its HUD is fully rendered.
 *
 * The readout is `sr-only` and empty until the first frame resolves which room the explorer is
 * in, so an audit taken before that would miss the panel entirely.
 */
async function enterInterior(page: Page): Promise<void> {
  await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();
  await expect(page.getByRole('status')).toHaveText(FIRST_PERSON_STATUS);
  await expectCameraIdle(page);
  await expect(page.locator(ROOM_READOUT_SELECTOR)).toHaveText(STAIRWELL_LINE);
}

test.describe('accessibility', () => {
  test('has no axe violations in the exterior view', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expectCanvasVisible(page);
    await expect(page.getByRole('status')).toHaveText(EXTERIOR_STATUS);
    await expectCameraIdle(page);

    expect(await analyzeHud(page)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('has no axe violations in the interior view', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expectCanvasVisible(page);
    await enterInterior(page);

    expect(await analyzeHud(page)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('has no axe violations with the room list open', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expectCanvasVisible(page);
    await enterInterior(page);

    const trigger = page.getByRole('button', { name: ROOM_MENU_NAME });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: KITCHEN_ITEM_NAME })).toBeVisible();

    expect(await analyzeHud(page)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('has no axe violations in the interior view at a phone width', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto('/');
    await expectCanvasVisible(page);
    await enterInterior(page);

    expect(await analyzeHud(page)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
