import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  EXTERIOR_STATUS,
  FIRST_PERSON_STATUS,
  INTERIOR_REGION_NAME,
  VIEW_TOGGLE_NAME,
} from './constants.ts';
import {
  closeLayerPanel,
  getLayerCheckbox,
  getLayerPanel,
  getLayerTrigger,
  LAYER_NAMES,
  layerTriggerName,
  NAKED_TRIGGER_NAME,
  openLayerPanel,
} from './layerSwitcher.ts';
import { expectCanvasVisible, getHudOverlay } from './sceneCapture.ts';

/**
 * The HUD's layer switcher, driven the way a viewer drives it.
 *
 * What this spec is for, over and above `LayerSwitcher.test.tsx`: that test renders the
 * component into jsdom, where nothing has a size, nothing paints and nothing stacks. Three of
 * the things this control promises are only true in a browser — that the panel is reachable
 * by pointer at a phone width, that it paints **over** the hold-to-act pads rather than under
 * them, and that opening it does not push the HUD band down over the 3D view — and all three
 * are things a viewer notices immediately and a jsdom test cannot see at all.
 *
 * The pointer path is not a nicety here. The owner cannot always use a keyboard (ADR-008,
 * ADR-013), so a control that can only be operated with Tab and Space is a control he does not
 * have. That is the whole reason the phone-width test below hit-tests every one of the nine
 * boxes rather than only asserting they exist.
 */

/** The narrow phone viewport every width-sensitive HUD test in this suite uses. */
const PHONE_VIEWPORT = Object.freeze({ width: 400, height: 800 });

/**
 * The share of the phone viewport's height the 3D view is actually left with, **measured**.
 *
 * ## Why this is not 0.6
 *
 * `remoteControl.spec.ts` states the budget — at least 60 % of an 800 px viewport free of
 * HUD — and this part put a new trigger on the HUD's second row without anyone measuring the
 * result. Measured now, at a 400 px width, in the interior, with the whole HUD rendered:
 *
 * - the band runs y 0–208 and the pad's top edge is at y 664, so **456 px of 800 are free:
 *   0.57**, which is under the 0.60 budget;
 * - the `Layers` trigger is **not** the cause. The second row is a single line 36 px tall and
 *   340 px wide of the 384 available, with all three of "Go to room", "About this room" and
 *   "Layers" on it. Nothing wrapped. Take the trigger away and the band is the same height.
 * - what closes the gap is the room readout, `#current-room`. It is `sr-only` and **empty**
 *   until the first rendered frame resolves which room the explorer is in, and an empty
 *   `sr-only` element has no box, so the band is 172 px tall for a moment and 208 px tall
 *   from then on — a 36 px step, which is 0.045 of the viewport, which is exactly the
 *   difference between 0.615 and 0.57.
 *
 * `remoteControl.spec.ts` measures immediately after the pad appears, which is inside that
 * window, so the 0.615 it records and asserts against 0.60 is a HUD with a row missing. Its
 * budget is not being met by the HUD a viewer sees; it is being met by a race.
 *
 * ## What is done about it here
 *
 * Nothing is lowered and nothing is silenced. The 0.60 budget belongs to
 * `remoteControl.spec.ts` and stays there, un-weakened, to be answered by whoever owns the
 * HUD's height. What this spec asserts instead is what THIS part is answerable for — that
 * the trigger shares a line with the two panels beside it, and that opening the panel moves
 * neither the band nor the pad — and it holds the measured fraction as a ratchet so the view
 * cannot quietly get smaller still. A ratchet at the measurement is not a budget, and this
 * one is deliberately not called one.
 */
const MEASURED_FREE_VIEW_FRACTION = 0.57;

/**
 * Decimal places the free-view fraction must agree to across opening the panel.
 *
 * Five, of a fraction of 800 px, is a hundredth of a pixel: the assertion is that the band
 * and the pad did not move at all, with only float noise allowed for. A panel in flow would
 * move them by dozens of pixels, not by a hundredth of one.
 */
const UNMOVED_PRECISION = 5;

/** Absolute floor for a touch target, in CSS pixels: what WCAG 2.5.8 itself requires. */
const WCAG_MIN_TARGET_SIZE_PX = 24;

/**
 * Widest the `sr-only` half of the trigger's name may be, in CSS pixels.
 *
 * Tailwind's `sr-only` clips an element to a single pixel box, so this is "clipped", not "a
 * bit narrow". Below the `sm` breakpoint the summary wears it and the visible caption is the
 * bare word `Layers`; at `sm` and up `not-sr-only` gives it back its size.
 */
const CLIPPED_WIDTH_PX = 1;

/** How many spans the trigger is built from: the caption, then the summary. */
const TRIGGER_SPAN_COUNT = 2;

/** How many `role="status"` elements the HUD allows, panel open or shut. */
const STATUS_COUNT = 1;

/** `z-index` the panel must paint at, above the `z-20` of the hold-to-act pads. */
const PANEL_Z_INDEX = '30';

/**
 * Reads as `layerTriggerName(3, CLIPPED)` at the call site: the summary half of the trigger's
 * name is `sr-only` at this width, which costs the name one extra space.
 */
const CLIPPED = true;

/** The two panels the switcher shares the HUD's second row with, in the interior. */
const ROOM_MENU_NAME = 'Go to room';
const ROOM_PANEL_NAME = 'About this room';

/**
 * Decimal places two panels on one flex line must agree to on their top edge.
 *
 * Zero: whole pixels. They are laid out `items-start` in the same flex row, so they share a
 * top edge exactly; a panel on the NEXT line is 44 px lower, not a fraction of a pixel.
 */
const ROW_ALIGNMENT_PRECISION = 0;

/** The bottom-anchored pad of the interior view, which bounds the free 3D view below. */
const REMOTE_GROUP_NAME = 'Remote control';

/**
 * The pad of the EXTERIOR view, and the panel's real stacking rival.
 *
 * Measured: in the exterior the switcher is the only panel on the HUD's second row, so the
 * panel opens at the very left of the band — straight on top of this pad, which sits in the
 * stack immediately below it. At a 1280 px width the pad spans x 16–348, y 128–216 and the
 * panel x 16–272, y 124–380, so the first checkbox (x 28–52, y 188–212) lies wholly inside
 * the pad's box. In the interior the two never meet at all, whatever the width.
 */
const ORBIT_GROUP_NAME = 'Camera control';

/** The room readout, whose first text proves the interior HUD has finished rendering. */
const ROOM_READOUT_SELECTOR = '#current-room';

/** What the readout says at the start pose: the stair arrival landing. */
const STAIRWELL_LINE = 'Room: F1-R06/STR · Stairwell';

/**
 * The summary half of the trigger's name, as its own element.
 *
 * Addressed by position because it has no id of its own, with the count asserted alongside so
 * a markup change fails loudly here instead of quietly measuring the wrong span.
 */
async function getTriggerSummary(page: Page): Promise<Locator> {
  const spans = getLayerTrigger(page).locator('span');
  await expect(spans).toHaveCount(TRIGGER_SPAN_COUNT);
  return spans.nth(1);
}

/** Width of a locator's box, which it must have. */
async function getWidthPx(locator: Locator, what: string): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} has no bounding box`);
  }
  return box.width;
}

/** Where the two HUD panels of the phone layout sit, and what is left between them. */
interface HudBand {
  /** Top of the HUD band, in CSS pixels from the top of the viewport. */
  readonly bandTopPx: number;
  /** How tall the band is: the toggles, the stepper, the switcher row, the hint, the readout. */
  readonly bandHeightPx: number;
  /** Top of the bottom-anchored remote pad. */
  readonly padTopPx: number;
  /** The share of the viewport height between the band's bottom edge and the pad's top edge. */
  readonly freeViewFraction: number;
}

/**
 * Measures the gap the 3D view is left with at a phone width.
 *
 * The HUD at this width is a band at the top and the pad anchored to the bottom, and what is
 * between the two belongs to the scene — `remoteControl.spec.ts` measures the same gap the
 * same way, so the two numbers are comparable. The parts are returned alongside the fraction
 * because a fraction that moved says only that; which of the three edges moved is the finding.
 */
async function measureHudBand(page: Page): Promise<HudBand> {
  const bandBox = await getHudOverlay(page).boundingBox();
  const padBox = await page.getByRole('group', { name: REMOTE_GROUP_NAME }).boundingBox();
  if (bandBox === null || padBox === null) {
    throw new Error('a HUD panel has no bounding box');
  }
  return {
    bandTopPx: bandBox.y,
    bandHeightPx: bandBox.height,
    padTopPx: padBox.y,
    freeViewFraction: (padBox.y - (bandBox.y + bandBox.height)) / PHONE_VIEWPORT.height,
  };
}

/** Spells a measurement out for a test annotation, edges and all. */
function describeHudBand(band: HudBand): string {
  return [
    `${Math.round(band.freeViewFraction * 100)}% of a ${PHONE_VIEWPORT.height} px viewport height`,
    `(band ${band.bandTopPx}–${band.bandTopPx + band.bandHeightPx} px, pad top ${band.padTopPx} px)`,
  ].join(' ');
}

/** Opens the app in the exterior view it now defaults to. */
async function openExterior(page: Page): Promise<void> {
  await page.goto('/');
  await expectCanvasVisible(page);
  await expect(page.getByRole('status')).toHaveText(EXTERIOR_STATUS);
}

/**
 * Crosses into the interior view and waits until its HUD has finished rendering.
 *
 * The readout matters, and not only to a test that reads it. It is `sr-only` and **empty**
 * until the first frame resolves which room the explorer is in, and an empty `sr-only`
 * element has no box: the HUD band is 36 px shorter until the room arrives. A band measured
 * before then, against one measured after, reports a HUD that grew by a row — which is what
 * this test first accused the layer panel of doing. `accessibility.spec.ts` waits on the same
 * line for the same reason.
 */
async function enterInterior(page: Page): Promise<void> {
  await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();
  await expect(page.getByRole('status')).toHaveText(FIRST_PERSON_STATUS);
  await expect(page.locator(ROOM_READOUT_SELECTOR)).toHaveText(STAIRWELL_LINE);
}

/** Asserts the panel is open, holds the nine layers in the plan's order, and none is ticked. */
async function expectNinePlainLayers(page: Page): Promise<void> {
  const boxes = getLayerPanel(page).getByRole('checkbox');
  await expect(boxes).toHaveCount(LAYER_NAMES.length);
  for (const [index, name] of LAYER_NAMES.entries()) {
    await expect(boxes.nth(index)).toHaveAccessibleName(name);
  }
}

test.describe('build layer switcher', () => {
  test('opens on naked walls, and offers the nine layers in both views', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);

    // The default view of the app: the building with its services still inside the walls, and
    // the trigger saying so in words rather than leaving a viewer to read an empty count.
    const trigger = getLayerTrigger(page);
    await expect(trigger).toHaveAccessibleName(NAKED_TRIGGER_NAME);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // `aria-controls` naming an element that is not in the document is an IDREF assistive
    // technology cannot resolve, and axe reports it as *incomplete* rather than a violation,
    // so no audit would catch it. Hence an assertion.
    await expect(trigger).not.toHaveAttribute('aria-controls', /.*/);
    await expect(getLayerPanel(page)).toHaveCount(0);

    await openLayerPanel(page);
    await expect(trigger).toHaveAttribute('aria-controls', 'layer-panel');
    await expectNinePlainLayers(page);
    // The panel carries a live summary, and it is deliberately not a second `role="status"`:
    // this HUD rations that to the view status alone, and three `getByRole('status')` queries
    // across this suite find the HUD by there being exactly one.
    await expect(page.getByRole('status')).toHaveCount(STATUS_COUNT);

    // Mounted in both views, with no `null` branch: how the building is layered is as much a
    // fact of the exterior it is seen from as of the interior it is walked in. The switcher
    // does not unmount with the view, so the panel is shut here rather than left open — a
    // second click on the trigger over there would close it instead of opening it.
    await closeLayerPanel(page);
    await enterInterior(page);
    await expect(trigger).toHaveAccessibleName(NAKED_TRIGGER_NAME);
    await openLayerPanel(page);
    await expectNinePlainLayers(page);
    await expect(page.getByRole('status')).toHaveCount(STATUS_COUNT);

    expect(pageErrors).toEqual([]);
  });

  test('ticks and unticks every layer, and the trigger name tracks the count', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);
    const trigger = getLayerTrigger(page);
    await openLayerPanel(page);

    // Up: every layer, one at a time, in the plan's order. The count is asserted after each
    // one, so a box wired to the wrong key is caught on the tick that crosses them rather
    // than washing out in a total that still adds up.
    for (const [index, name] of LAYER_NAMES.entries()) {
      const box = getLayerCheckbox(page, name);
      await box.check();
      await expect(box).toBeChecked();
      await expect(trigger).toHaveAccessibleName(layerTriggerName(index + 1));
      // Ticking a box does not close the panel: the boxes are ticked in runs, and a viewer
      // who has just turned gas on is usually about to turn water on too.
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    }

    // And down again, from the other end, back to the naked walls the app opened on.
    for (const [index, name] of [...LAYER_NAMES].reverse().entries()) {
      const box = getLayerCheckbox(page, name);
      await box.uncheck();
      await expect(box).not.toBeChecked();
      await expect(trigger).toHaveAccessibleName(layerTriggerName(LAYER_NAMES.length - index - 1));
    }
    await expect(trigger).toHaveAccessibleName(NAKED_TRIGGER_NAME);

    expect(pageErrors).toEqual([]);
  });

  test('keeps focus on the box that was ticked, and closes on Escape', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);
    const trigger = getLayerTrigger(page);

    // Opened from the keyboard, focus stays on the trigger — `MouseEvent.detail` is 0 for a
    // click a key fired, and the switcher only hands focus to the 3D view for a pointer press.
    await trigger.focus();
    await trigger.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toBeFocused();

    // Ticking never moves focus. Asserted from the keyboard because that is where a move
    // would be visible: a box ticked with Space must still be the focused element after.
    const box = getLayerCheckbox(page, LAYER_NAMES[0]);
    await box.focus();
    await box.press(' ');
    await expect(box).toBeChecked();
    await expect(box).toBeFocused();
    await expect(trigger).toHaveAccessibleName(layerTriggerName(1));

    // Escape closes from anywhere inside the control — here from the box, not the trigger —
    // and puts focus back where the viewer can act on it, exactly as every other HUD
    // disclosure does. It does not untick anything.
    await box.press('Escape');
    await expect(getLayerPanel(page)).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName(layerTriggerName(1));

    // Escape on the trigger itself closes it too, and the state survives the round trip.
    await openLayerPanel(page);
    await trigger.press('Escape');
    await expect(getLayerPanel(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await openLayerPanel(page);
    await expect(getLayerCheckbox(page, LAYER_NAMES[0])).toBeChecked();

    expect(pageErrors).toEqual([]);
  });

  test('hands focus to the 3D view when opened with a pointer', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await openExterior(page);
    await enterInterior(page);

    // `RoomInfoPanel`'s rule: after a pointer press the navigation keys and the remote pad
    // have to keep working while the viewer reads the panel, so focus goes to the view.
    await openLayerPanel(page);
    await expect(page.getByRole('application', { name: INTERIOR_REGION_NAME })).toBeFocused();

    expect(pageErrors).toEqual([]);
  });

  test('paints over the camera pad it opens on top of, and stays clickable', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    // The exterior, at the default width, and both of those are the point. Here the room menu
    // and the room panel render nothing, so the switcher is the ONLY panel on the HUD's second
    // row and its panel opens at the far left of the band — directly over the camera pad in the
    // stack below. In the interior the switcher is pushed right by two panels and the two boxes
    // never meet, so a test written there would assert this into thin air.
    await openExterior(page);
    const panel = await openLayerPanel(page);

    // First, prove the overlap is real, rather than trusting a layout to keep producing it. If
    // the HUD is ever rearranged so the two no longer meet, this fails and says so, instead of
    // leaving a hit-test below that passes because there was nothing to be covered by.
    const pad = page.getByRole('group', { name: ORBIT_GROUP_NAME });
    const panelBox = await panel.boundingBox();
    const padBox = await pad.boundingBox();
    if (panelBox === null || padBox === null) {
      throw new Error('the layer panel and the camera pad must both have a bounding box');
    }
    const overlaps =
      panelBox.x < padBox.x + padBox.width &&
      padBox.x < panelBox.x + panelBox.width &&
      panelBox.y < padBox.y + padBox.height &&
      padBox.y < panelBox.y + panelBox.height;
    expect(overlaps, 'the layer panel is expected to open on top of the camera pad').toBe(true);
    test.info().annotations.push({
      type: 'layer panel over camera pad',
      description: `panel x ${panelBox.x}–${panelBox.x + panelBox.width}, y ${panelBox.y}–${panelBox.y + panelBox.height}; pad x ${padBox.x}–${padBox.x + padBox.width}, y ${padBox.y}–${padBox.y + padBox.height}`,
    });

    // `z-30`, and not the `z-20` every other HUD overlay wears. The hold-to-act pads are `z-20`
    // AND come later in the DOM, so at an equal `z-index` the pad won and the first checkbox —
    // which lies wholly inside the pad's box — could not be clicked at all. That is a real
    // defect and not a nit: the owner cannot always use a keyboard, so a box no pointer can
    // reach is a box he does not have.
    await expect(panel).toHaveCSS('z-index', PANEL_Z_INDEX);

    // The stacking said in CSS, and then the same thing said by the browser: a trial click runs
    // the hit-target check, and a real one proves the press landed on the box and not the pad.
    const first = getLayerCheckbox(page, LAYER_NAMES[0]);
    await first.click({ trial: true });
    await first.click();
    await expect(first).toBeChecked();
    await expect(getLayerTrigger(page)).toHaveAccessibleName(layerTriggerName(1));
    // And the pad underneath was not pressed through the panel: the camera has not been told
    // to do anything, so its buttons are all still unpressed.
    for (const button of await pad.getByRole('button').all()) {
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    }

    expect(pageErrors).toEqual([]);
  });

  test('is reachable and operable by pointer at a phone width', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.setViewportSize(PHONE_VIEWPORT);
    await openExterior(page);
    // In the interior, where the HUD is at its tallest and the switcher is pushed furthest
    // right: the view toggle, the camera toggle, the stepper, the room menu, the room panel,
    // the switcher, the hint, the readout and the remote control are all up. The pad is not
    // what the panel has to paint over at this width — bottom-anchored, it is 270 px below
    // the panel's last row, and the test above covers the width where the two do meet. Here
    // the panel lands on the navigation hint and the room readout instead.
    await enterInterior(page);
    const trigger = getLayerTrigger(page);
    await expect(trigger).toBeVisible();

    // The summary half goes `sr-only` here, so the word on screen is the bare `Layers` and
    // the name still says what is on. It says it in one more space than it does at `sm` and
    // up — `Layers : Naked walls` — because `sr-only` is `position: absolute`, which
    // blockifies the span and makes Chromium put a space around it. Both spellings are
    // asserted, here and above, rather than normalised: see `layerSwitcher.ts`.
    await expect(trigger).toHaveAccessibleName(layerTriggerName(0, CLIPPED));
    const summary = await getTriggerSummary(page);
    const clippedWidthPx = await getWidthPx(summary, "the trigger's summary");
    expect(
      clippedWidthPx,
      'the summary must be clipped to sr-only below the sm breakpoint',
    ).toBeLessThanOrEqual(CLIPPED_WIDTH_PX);

    // Nothing in the HUD may push the page sideways: a horizontal scroll would leave part of
    // the band, or of the panel hanging below it, off screen.
    const documentWidths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      documentWidths.scrollWidth,
      'the page must not scroll horizontally at a phone width',
    ).toBeLessThanOrEqual(documentWidths.clientWidth);

    // The question this part has to answer at this width: did the new trigger fit on the row
    // it joined, or did it wrap the HUD band onto another line? Asked of the layout directly
    // rather than of the band's total height — three panels that share a flex line share a
    // top edge, and a wrapped one does not.
    const rowTops = await Promise.all(
      [ROOM_MENU_NAME, ROOM_PANEL_NAME].map(async (name) => {
        const box = await page.getByRole('button', { name: new RegExp(`^${name}`) }).boundingBox();
        if (box === null) {
          throw new Error(`the "${name}" trigger has no bounding box`);
        }
        return { name, top: box.y };
      }),
    );
    const triggerBox = await trigger.boundingBox();
    if (triggerBox === null) {
      throw new Error('the Layers trigger has no bounding box');
    }
    for (const row of rowTops) {
      expect(
        triggerBox.y,
        `the Layers trigger has wrapped off the row "${row.name}" is on`,
      ).toBeCloseTo(row.top, ROW_ALIGNMENT_PRECISION);
    }

    // And the gap the 3D view is left with, measured whole: see MEASURED_FREE_VIEW_FRACTION
    // for why this is a ratchet on a measurement and not the 60 % budget.
    const closed = await measureHudBand(page);
    test.info().annotations.push({
      type: 'free 3D view height, layer panel closed',
      description: describeHudBand(closed),
    });
    expect(
      closed.freeViewFraction,
      'the 3D view has lost height it had when this was last measured',
    ).toBeGreaterThanOrEqual(MEASURED_FREE_VIEW_FRACTION);

    const panel = await openLayerPanel(page);

    // The nine rows are `absolute`, so the band does not grow by a third of a phone screen
    // when they appear. Asserted as an equality rather than as a second budget: out of flow
    // means out of flow, and a panel that moved the band by a single pixel is in flow.
    const open = await measureHudBand(page);
    test.info().annotations.push({
      type: 'free 3D view height, layer panel open',
      description: describeHudBand(open),
    });
    expect(open.bandHeightPx, 'opening the panel must not grow the HUD band').toBe(
      closed.bandHeightPx,
    );
    expect(open.padTopPx, 'opening the panel must not move the pad').toBe(closed.padTopPx);
    expect(open.freeViewFraction, 'opening the panel must not eat into the 3D view').toBeCloseTo(
      closed.freeViewFraction,
      UNMOVED_PRECISION,
    );

    await expect(panel).toHaveCSS('z-index', PANEL_Z_INDEX);

    // The panel is a fixed `w-64` anchored to a trigger that sits two panels along the row, so
    // at this width its right-hand edge runs off the screen and `main`'s `overflow-hidden`
    // clips it. Measured: the panel spans x 273–529 of a 400 px viewport — half of it is not
    // there. Every box and every WORD is still inside, and that is what is asserted, name by
    // name: the widest of them, `Low voltage`, ends at x 395, five pixels from the edge. A
    // tenth layer with a longer name, or a font that renders a hair wider, puts a label off
    // the screen, and a label nobody can read is a box nobody can knowingly tick.
    let smallestSidePx = Number.POSITIVE_INFINITY;
    let widestLabelRightPx = 0;
    for (const name of LAYER_NAMES) {
      const box = getLayerCheckbox(page, name);
      await expect(box).toBeVisible();
      const boundingBox = await box.boundingBox();
      if (boundingBox === null) {
        throw new Error(`the "${name}" checkbox has no bounding box`);
      }
      expect(boundingBox.width, `"${name}" is narrower than a touch target`).toBeGreaterThanOrEqual(
        WCAG_MIN_TARGET_SIZE_PX,
      );
      expect(boundingBox.height, `"${name}" is shorter than a touch target`).toBeGreaterThanOrEqual(
        WCAG_MIN_TARGET_SIZE_PX,
      );
      smallestSidePx = Math.min(smallestSidePx, boundingBox.width, boundingBox.height);
      // A trial click runs the actionability and hit-target checks without clicking: it fails
      // if another HUD panel covers the box's centre, or if the box is off the screen.
      await box.click({ trial: true });

      // The row is a `<label>` too, so the words are as tappable as the box beside them — and
      // they have to be ON the screen to be either tappable or readable.
      const label = panel.getByText(name, { exact: true });
      await label.click({ trial: true });
      const labelBox = await label.boundingBox();
      if (labelBox === null) {
        throw new Error(`the "${name}" label has no bounding box`);
      }
      expect(
        labelBox.x + labelBox.width,
        `the "${name}" label runs off the right edge of a phone screen`,
      ).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
      widestLabelRightPx = Math.max(widestLabelRightPx, labelBox.x + labelBox.width);
    }
    test.info().annotations.push({
      type: 'smallest layer checkbox side',
      description: `${smallestSidePx} CSS px at a ${PHONE_VIEWPORT.width} px viewport width`,
    });
    test.info().annotations.push({
      type: 'widest layer label right edge',
      description: `${widestLabelRightPx} px of a ${PHONE_VIEWPORT.width} px viewport width`,
    });

    // Hit-testing is not operating. Three real pointer clicks, on rows at both ends of the
    // scrolling list, and the count has to follow them.
    for (const [index, name] of (['Drainage', 'Climate', 'Finishing'] as const).entries()) {
      const box = getLayerCheckbox(page, name);
      await box.click();
      await expect(box).toBeChecked();
      await expect(trigger).toHaveAccessibleName(layerTriggerName(index + 1, CLIPPED));
    }

    expect(pageErrors).toEqual([]);
  });
});
