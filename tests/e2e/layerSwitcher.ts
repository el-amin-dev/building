/**
 * Shared helpers for driving the HUD's layer switcher from an end-to-end spec.
 *
 * Three specs need the same few things — the nine layer names in the plan's order, the
 * trigger, the open panel, and a way to say "show these layers and nothing else" — and they
 * need them to agree: `layers.spec.ts` asserts the control's behaviour, `exterior.spec.ts`
 * pins a baseline of a *particular* combination of layers, and `docsCapture.spec.ts` writes
 * the README images of another. A baseline taken with a different idea of what "Furniture"
 * is called than the spec that asserts it would be a baseline of the wrong building, so the
 * names live here once.
 *
 * They are written out rather than imported from `src/features/building/domain/`, on
 * purpose: these are end-to-end tests of the app as a viewer meets it, and importing the
 * plan would let a rename in the source of truth pass through the checkbox labels and the
 * assertions together without a single test noticing. The unit test
 * (`LayerSwitcher.test.tsx`) is the one that asserts the panel follows the plan; this file
 * is the one that asserts the plan reached the screen under the names the owner reads.
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { LAYER_PANEL_SELECTOR } from './constants.ts';

/**
 * The nine build layers, spelled and ordered exactly as the panel lists them.
 *
 * The order is the plan's, which is the order a building is actually built in: what falls
 * first, then what is supplied, then what is boxed in, then what is stood in the rooms, then
 * the finish. A test that ticks them by index is ticking them in that order.
 */
export const LAYER_NAMES = Object.freeze([
  'Drainage',
  'Water',
  'Gas',
  'Electricity',
  'Low voltage',
  'Climate',
  'Covers',
  'Furniture',
  'Finishing',
] as const);

/** One of the nine, by name. */
export type LayerName = (typeof LAYER_NAMES)[number];

/**
 * The six layers that are services: runs drawn through the building rather than things
 * standing in it.
 *
 * `Covers`, `Furniture` and `Finishing` are the other three, and the plan marks the
 * difference itself (`service: true`). Named here because "show me the services" is the
 * request both a documentation image and a pointer test actually make.
 */
export const SERVICE_LAYER_NAMES: readonly LayerName[] = Object.freeze([
  'Drainage',
  'Water',
  'Gas',
  'Electricity',
  'Low voltage',
  'Climate',
] as const);

/**
 * The two layers that, together and with every service off, reproduce the floor as v1.0.0
 * drew it.
 *
 * NOT all nine. Ticking a service layer is what makes that service visible, so all nine on
 * is v1.0.0 **plus** every run drawn over it — a different picture, and the one a baseline
 * would silently pin if it took the DoD's word for it.
 */
export const FURNISHED_LAYER_NAMES: readonly LayerName[] = Object.freeze([
  'Furniture',
  'Finishing',
] as const);

/** The word the trigger wears at every width; the summary follows it after a colon. */
const TRIGGER_CAPTION = 'Layers';

/** What the trigger says while nothing is ticked: the view the app opens on, named. */
const NAKED_SUMMARY = 'Naked walls';

/** Separates the caption from the summary, in the markup and so in the name. */
const SUMMARY_SEPARATOR = ': ';

/**
 * The extra space Chromium puts between the two halves of the name below the `sm` breakpoint.
 *
 * **Measured in the browser, and it is not what the part was written expecting.** The trigger
 * is two spans, `Layers` and `: Naked walls`, and the second wears `sr-only sm:not-sr-only`.
 * Tailwind's `sr-only` includes `position: absolute` (the built rule is
 * `clip-path:inset(50%);…;position:absolute;overflow:hidden`), and CSS *blockifies* an
 * absolutely positioned inline element — its computed `display` becomes `block`. Chromium's
 * accessible-name computation inserts a space around block-level content, so below `sm` the
 * name comes back as `Layers : Naked walls`, and at `sm` and up, where `not-sr-only` restores
 * `position: static`, as `Layers: Naked walls`.
 *
 * So the accessible name is **not** byte-identical at every width. It is the same sentence in
 * the same order — a screen reader says "Layers, Naked walls" either way, and the colon is not
 * spoken — so this is a fact to pin rather than a defect to fix, and the tests pin both forms
 * instead of normalising the difference away. `LayerSwitcher.test.tsx` cannot see it: jsdom
 * does not lay anything out, so it computes the tight form at every width.
 */
const CLIPPED_GAP = ' ';

/** The trigger's whole accessible name at the default state, at `sm` and above. */
export const NAKED_TRIGGER_NAME = `${TRIGGER_CAPTION}${SUMMARY_SEPARATOR}${NAKED_SUMMARY}`;

/**
 * The trigger's accessible name after `shownCount` layers have been ticked.
 *
 * @param shownCount - How many boxes are ticked; zero gives {@link NAKED_TRIGGER_NAME}.
 * @param clipped - Whether the summary half is `sr-only`, which it is below the `sm`
 *   breakpoint and only there; see {@link CLIPPED_GAP} for why that changes the string.
 * @returns `Layers: Naked walls`, `Layers: 3 of 9 on`, or their clipped spellings.
 */
export function layerTriggerName(shownCount: number, clipped = false): string {
  const summary =
    shownCount === 0 ? NAKED_SUMMARY : `${String(shownCount)} of ${String(LAYER_NAMES.length)} on`;
  const gap = clipped ? CLIPPED_GAP : '';
  return `${TRIGGER_CAPTION}${gap}${SUMMARY_SEPARATOR}${summary}`;
}

/**
 * The switcher's trigger.
 *
 * Found by a name that *starts* with the caption, because the rest of the name is the state
 * under test: a locator spelling the whole name would have to be rewritten for every count.
 */
export function getLayerTrigger(page: Page): Locator {
  return page.getByRole('button', { name: new RegExp(`^${TRIGGER_CAPTION}`) });
}

/**
 * The open panel: the `<fieldset>` holding the nine boxes.
 *
 * By id, which is the contract `hudIds.ts` publishes and the trigger's `aria-controls`
 * names while it is open.
 */
export function getLayerPanel(page: Page): Locator {
  return page.locator(LAYER_PANEL_SELECTOR);
}

/**
 * One layer's checkbox, by the name on its row.
 *
 * `exact` because these names are each other's substrings nowhere today and that is exactly
 * the kind of thing a tenth layer breaks quietly.
 */
export function getLayerCheckbox(page: Page, name: LayerName): Locator {
  return page.getByRole('checkbox', { name, exact: true });
}

/**
 * Opens the panel with a real pointer click and waits until it is open.
 *
 * Two-step, like the room list: `aria-expanded` first, then an element inside it, so a
 * caller that goes on to click a box is not racing the panel's mount.
 */
export async function openLayerPanel(page: Page): Promise<Locator> {
  const trigger = getLayerTrigger(page);
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(getLayerCheckbox(page, LAYER_NAMES[0])).toBeVisible();
  return getLayerPanel(page);
}

/** Closes the panel with a pointer click on the trigger and waits until it is gone. */
export async function closeLayerPanel(page: Page): Promise<void> {
  const trigger = getLayerTrigger(page);
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(getLayerPanel(page)).toHaveCount(0);
}

/**
 * Ticks exactly `names` and leaves the panel closed.
 *
 * The boxes are additive and the page starts naked, so this is a set of ticks rather than a
 * set of assignments — and it asserts the count it ended on, so a click that lands on the
 * wrong row fails here rather than in whatever the caller does next with the picture.
 *
 * @param page - The page under test, in either view.
 * @param names - The layers to show, from a naked start.
 */
export async function showLayers(page: Page, names: readonly LayerName[]): Promise<void> {
  const trigger = getLayerTrigger(page);
  await expect(trigger).toHaveAccessibleName(NAKED_TRIGGER_NAME);
  await openLayerPanel(page);
  for (const name of names) {
    const box = getLayerCheckbox(page, name);
    await box.check();
    await expect(box).toBeChecked();
  }
  await expect(trigger).toHaveAccessibleName(layerTriggerName(names.length));
  await closeLayerPanel(page);
}

/**
 * Brings the switcher to exactly `names` from whatever state it is in, and leaves the panel
 * closed.
 *
 * {@link showLayers} is the same thing for a page that is still naked, and it says so by
 * asserting it; this one is for a sequence that has already ticked something and now wants a
 * different combination — a run of documentation captures, where one page walks through
 * several states. Every one of the nine is set, so what is *not* named is as definite as what
 * is: a layer left over from the previous shot is the way a picture ends up showing something
 * nobody meant to put in it.
 *
 * @param page - The page under test, in either view.
 * @param names - The layers that must end up ticked; every other layer is unticked.
 */
export async function setLayers(page: Page, names: readonly LayerName[]): Promise<void> {
  const wanted = new Set<LayerName>(names);
  const trigger = getLayerTrigger(page);
  await openLayerPanel(page);
  for (const name of LAYER_NAMES) {
    const box = getLayerCheckbox(page, name);
    await box.setChecked(wanted.has(name));
    await expect(box).toBeChecked({ checked: wanted.has(name) });
  }
  await expect(trigger).toHaveAccessibleName(layerTriggerName(wanted.size));
  await closeLayerPanel(page);
}
