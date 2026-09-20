import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStore } from '../application/layerStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { SERVICE_LAYERS } from '../domain/sourceOfTruth/plan.ts';
import { FLOOR_MATERIAL_KEYS } from './floorLayout.ts';
import type { FloorLayout } from './floorLayout.ts';
import { LAYER_PANEL_ID, LAYER_SUMMARY_ID } from './hudIds.ts';
import { LayerSwitcher } from './LayerSwitcher.tsx';
import { ViewModeToggle } from './ViewModeToggle.tsx';

/** The word the trigger wears at every width; the summary follows it after a colon. */
const TRIGGER_CAPTION = 'Layers';

/** What the trigger says while no box is ticked: the default view, named. */
const NAKED_SUMMARY = 'Naked walls';

/** The trigger's whole accessible name at the default state. */
const NAKED_TRIGGER_NAME = `${TRIGGER_CAPTION}: ${NAKED_SUMMARY}`;

/** What the live region reads out, prefix included, before anything is ticked. */
const NAKED_READING = `Layers shown: ${NAKED_SUMMARY}`;

/** The group's name, from its `<legend>`. */
const LEGEND = 'Build layers';

/** The layer a single tick is proved on: the second of the nine, so order cannot fake it. */
const TICKED_LAYER = SERVICE_LAYERS[1];

/** The first layer, ticked alongside it where two are needed. */
const FIRST_LAYER = SERVICE_LAYERS[0];

/** The Tailwind class carrying the 24 px target floor of WCAG 2.5.8. */
const MIN_TARGET_CLASS = 'min-h-6';

/** The single focus-ring colour every focusable control of this HUD wears. */
const FOCUS_RING_CLASS = 'focus-visible:outline-amber-400';

/** The two halves of the focus ring the colour rides on, asserted literally beside it. */
const FOCUS_OUTLINE_CLASS = 'focus-visible:outline-3';
const FOCUS_OFFSET_CLASS = 'focus-visible:outline-offset-2';

/** How many `role="status"` elements this HUD allows: the view status, and nothing else. */
const STATUS_COUNT = 1;

/** `KeyboardEvent.key` that closes the panel. */
const CLOSE_KEY = '{Escape}';

/** Ticked boxes after one tick, and after two. */
const ONE_TICKED = 1;
const TWO_TICKED = 2;

/** What the panel says about a ticked layer with nothing to draw, and how a row is marked. */
const EMPTY_SENTENCE = 'Nothing to draw on this floor';
const EMPTY_MARK = '— nothing to draw';

/**
 * A floor with every bucket present and every one of them empty.
 *
 * **No plan of this building produces one**: all nine layers have geometry on the real floor
 * (`floorLayout.test.ts` pins that), so the empty state is unreachable in the running app
 * and can only be exercised by handing the switcher a layout built here. It becomes
 * reachable the day the plan declares a layer no run carries, or a storey is built that
 * holds none of one layer's runs — and the sentence is written now so that day is a data
 * change and not a bug report.
 */
const EMPTY_LAYOUT: FloorLayout = Object.freeze(
  Object.fromEntries(FLOOR_MATERIAL_KEYS.map((key) => [key, Object.freeze([])])) as Record<
    string,
    readonly never[]
  >,
) as FloorLayout;

/** The live reading with `count` boxes ticked, before anything is said about empty ones. */
function readingFor(count: number): string {
  return `Layers shown: ${String(count)} of ${String(SERVICE_LAYERS.length)} on`;
}

/** Ticks every layer at once, without clicking nine boxes. */
function tickEveryLayer(): void {
  act(() => {
    for (const layer of SERVICE_LAYERS) {
      useLayerStore.getState().toggleLayer(layer.key);
    }
  });
}

function toggleView(): void {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function getTrigger(): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${TRIGGER_CAPTION}`) });
}

function queryPanel(): HTMLElement | null {
  return document.getElementById(LAYER_PANEL_ID);
}

function getPanel(): HTMLElement {
  const panel = queryPanel();
  if (panel === null) {
    throw new Error(`no element with id "${LAYER_PANEL_ID}" is in the document`);
  }
  return panel;
}

/** The live reading inside the open panel. */
function getSummary(): HTMLElement {
  const summary = document.getElementById(LAYER_SUMMARY_ID);
  if (summary === null) {
    throw new Error(`no element with id "${LAYER_SUMMARY_ID}" is in the document`);
  }
  return summary;
}

/** Every box of the open panel, in DOM order. */
function getBoxes(): HTMLInputElement[] {
  return within(getPanel()).getAllByRole('checkbox');
}

async function open(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(getTrigger());
}

describe('LayerSwitcher', () => {
  beforeEach(() => {
    useLayerStore.setState(useLayerStore.getInitialState(), true);
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('starts closed, with every layer off, and calls that state naked walls', () => {
    render(<LayerSwitcher />);

    expect(queryPanel()).toBeNull();
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(getTrigger()).toHaveAccessibleName(NAKED_TRIGGER_NAME);
  });

  it('lists the nine layers in the plan order, under the plan names', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);

    const names = getBoxes().map((box) => box.labels?.[0]?.textContent?.trim());
    expect(names).toStrictEqual(SERVICE_LAYERS.map((layer) => layer.name));
  });

  it('gives every layer a real native checkbox with its own accessible name', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);

    const boxes = getBoxes();
    expect(boxes).toHaveLength(SERVICE_LAYERS.length);
    for (const [index, box] of boxes.entries()) {
      expect(box.tagName).toBe('INPUT');
      expect(box.type).toBe('checkbox');
      expect(box).toHaveAccessibleName(SERVICE_LAYERS[index].name);
      expect(box).not.toBeChecked();
    }
  });

  it('groups the boxes in a fieldset named by its legend', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);

    expect(getPanel().tagName).toBe('FIELDSET');
    expect(screen.getByRole('group', { name: LEGEND })).toBe(getPanel());
  });

  it('toggles the layer the box belongs to, by its own key', async () => {
    const user = userEvent.setup();
    const toggleLayer = vi.fn();
    useLayerStore.setState({ toggleLayer });
    render(<LayerSwitcher />);

    await open(user);
    await user.click(screen.getByRole('checkbox', { name: TICKED_LAYER.name }));

    expect(toggleLayer).toHaveBeenCalledTimes(ONE_TICKED);
    expect(toggleLayer).toHaveBeenCalledWith(TICKED_LAYER.key);
  });

  it('ticks the box the store says is shown, and unticks it again', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);
    const box = screen.getByRole('checkbox', { name: TICKED_LAYER.name });
    await user.click(box);

    expect(box).toBeChecked();
    expect(useLayerStore.getState().shown[TICKED_LAYER.key]).toBe(true);

    await user.click(box);

    expect(box).not.toBeChecked();
    expect(useLayerStore.getState().shown[TICKED_LAYER.key]).toBe(false);
  });

  it('counts what is on, in the trigger name and in the live reading', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);
    expect(getSummary().textContent).toBe(NAKED_READING);

    await user.click(screen.getByRole('checkbox', { name: FIRST_LAYER.name }));
    await user.click(screen.getByRole('checkbox', { name: TICKED_LAYER.name }));

    const counted = `${String(TWO_TICKED)} of ${String(SERVICE_LAYERS.length)} on`;
    expect(getSummary().textContent).toBe(`Layers shown: ${counted}`);
    expect(getTrigger()).toHaveAccessibleName(`${TRIGGER_CAPTION}: ${counted}`);
  });

  it('announces the reading politely, and adds no second status to the HUD', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ViewModeToggle />
        <LayerSwitcher />
      </>,
    );

    await open(user);

    expect(getSummary()).toHaveAttribute('aria-live', 'polite');
    expect(screen.getAllByRole('status')).toHaveLength(STATUS_COUNT);
  });

  it('wears the HUD focus ring and the 24 px target floor on every box', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);

    expect(getTrigger()).toHaveClass(MIN_TARGET_CLASS);
    expect(getTrigger()).toHaveClass(FOCUS_RING_CLASS);
    for (const box of getBoxes()) {
      expect(box).toHaveClass(MIN_TARGET_CLASS);
      expect(box).toHaveClass('min-w-6');
      expect(box).toHaveClass(FOCUS_OUTLINE_CLASS);
      expect(box).toHaveClass(FOCUS_OFFSET_CLASS);
      expect(box).toHaveClass(FOCUS_RING_CLASS);
    }
  });

  it('keeps the open panel out of the flow, above the HUD, and below its trigger', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);

    expect(getPanel()).toHaveClass('absolute');
    expect(getPanel()).toHaveClass('top-full');
    expect(getPanel()).toHaveClass('left-0');
    // z-30, not the z-20 every other HUD overlay uses, and it was measured rather
    // than chosen. The hold-to-act pads are z-20 AND come later in the DOM, so at
    // equal z they paint over anything opening downward from the rows above: with
    // the panel at z-20, `document.elementFromPoint` at the first checkbox
    // returned an orbit-pad button, and `Drainage` could not be clicked at all.
    // Unit tests cannot see this — jsdom has no layout — and axe does not either.
    // A disclosure panel is above a pad; a pad is above the canvas.
    expect(getPanel()).toHaveClass('z-30');
  });

  it('stays mounted in both views, because the layering is a fact of both', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    expect(getTrigger()).toBeInTheDocument();

    toggleView();
    expect(useViewStore.getState().viewMode).toBe('interior');
    expect(getTrigger()).toBeInTheDocument();

    await open(user);
    expect(getBoxes()).toHaveLength(SERVICE_LAYERS.length);

    toggleView();
    expect(useViewStore.getState().viewMode).toBe('exterior');
    expect(getTrigger()).toBeInTheDocument();
    expect(getBoxes()).toHaveLength(SERVICE_LAYERS.length);
  });

  it('names the panel it controls only while that panel exists', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    expect(getTrigger()).not.toHaveAttribute('aria-controls');

    await open(user);

    expect(getTrigger()).toHaveAttribute('aria-controls', LAYER_PANEL_ID);
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await user.tab();
    await user.keyboard('{Enter}');
    expect(getPanel()).toBeInTheDocument();

    await user.keyboard(CLOSE_KEY);

    expect(queryPanel()).toBeNull();
    expect(getTrigger()).toHaveFocus();
  });

  it('never says a layer is empty on the floor as it is really drawn', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);
    tickEveryLayer();

    // The negative control for everything below: with all nine on, the real floor draws
    // something for every one of them, so the empty sentence must not appear anywhere.
    expect(getSummary().textContent).toBe(readingFor(SERVICE_LAYERS.length));
    expect(getPanel().textContent).not.toContain(EMPTY_MARK);
  });

  it('marks a ticked layer with nothing to draw, and says so in the live reading', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher layout={EMPTY_LAYOUT} />);

    await open(user);
    await user.click(screen.getByRole('checkbox', { name: TICKED_LAYER.name }));

    // Both halves, because either alone is half a message: the marker is a pixel a screen
    // reader would have to be sitting on the row to meet, and the sentence is the element
    // this panel's assistive technology is already listening to.
    expect(getSummary().textContent).toBe(
      `${readingFor(ONE_TICKED)}${EMPTY_SENTENCE}: ${TICKED_LAYER.name}`,
    );
    // Glued, because an accessible name trims each node before joining them: the dash is
    // inside the marker's own words for exactly that reason.
    expect(getBoxes()[1]).toHaveAccessibleName(`${TICKED_LAYER.name}${EMPTY_MARK}`);
    expect(getBoxes()[0]).toHaveAccessibleName(FIRST_LAYER.name);
  });

  it('marks only the rows that are ticked, and names them in the plan order', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher layout={EMPTY_LAYOUT} />);

    await open(user);
    await user.click(screen.getByRole('checkbox', { name: TICKED_LAYER.name }));
    await user.click(screen.getByRole('checkbox', { name: FIRST_LAYER.name }));

    // The first layer was ticked second and is still named first: the sentence reads the
    // plan's order, which is the order the rows are in.
    expect(getSummary().textContent).toBe(
      `${readingFor(TWO_TICKED)}${EMPTY_SENTENCE}: ${FIRST_LAYER.name}, ${TICKED_LAYER.name}`,
    );
    const marked = getBoxes().filter((box) =>
      (box.labels?.[0]?.textContent ?? '').includes(EMPTY_MARK),
    );
    expect(marked).toHaveLength(TWO_TICKED);
  });

  it('says nothing about a layer nobody ticked, however empty it is', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher layout={EMPTY_LAYOUT} />);

    await open(user);

    // An unticked layer draws nothing by definition; saying so about all nine would turn
    // the naked-walls default into nine complaints.
    expect(getSummary().textContent).toBe(NAKED_READING);
    expect(getPanel().textContent).not.toContain(EMPTY_MARK);
  });

  it('leaves focus on the box that was ticked, so a run of ticks is one gesture', async () => {
    const user = userEvent.setup();
    render(<LayerSwitcher />);

    await open(user);
    const box = screen.getByRole('checkbox', { name: FIRST_LAYER.name });
    await user.click(box);

    expect(box).toHaveFocus();
    expect(getPanel()).toBeInTheDocument();
  });
});
