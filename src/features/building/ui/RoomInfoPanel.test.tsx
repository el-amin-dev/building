import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { FLOOR_PLAN, getSpace, getSpaceLabel } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import { PORT_SCHEDULE } from '../domain/ports/index.ts';
import { getRoomInfo, NO_DAYLIGHT_NOTE } from '../domain/roomInfo.ts';
import { SERVICE_LAYERS } from '../domain/sourceOfTruth/plan.ts';
import type { RoomInfo } from '../domain/roomInfo.ts';
import { BUILT_FLOOR } from './floorInstance.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';
import { RoomInfoPanel } from './RoomInfoPanel.tsx';
import { ViewModeToggle } from './ViewModeToggle.tsx';

/**
 * The storey the panel is read on.
 *
 * Not the ground floor on purpose: a panel that ignored the storey would still print `F1-`
 * there, so every label assertion would pass on a component that read nothing.
 */
const CURRENT_FLOOR = 3;

/** The room most tests stand in: two rectangles, four fixtures, windows and four ports. */
const KITCHEN: SpaceId = 'kitchen';

/** The three habitable rooms ADR-006 records as having no daylight at all. */
const DARK_ROOMS: readonly SpaceId[] = ['livingRoom', 'bedroomMaleKids', 'bedroomFemaleKids'];

/** A room with no window whose balcony leaf still lights it: the sentence must not appear. */
const LIT_ROOM: SpaceId = 'masterBedroom';

/**
 * A balcony the daylight derivation calls `none`, because no window happens to name it.
 *
 * It is `openAir`, so it is under the sky and the no-daylight sentence would be false on it.
 */
const BALCONY: SpaceId = 'ccBalcony';

/** The words the trigger wears in front of the room label. */
const TRIGGER_CAPTION = 'About this room';

/** What the panel calls each thing it lists; the component's own words. */
const MATRICULE_TERM = 'Matricule';
const SIZE_TERM = 'Clear size';
const AREA_TERM = 'Area';
const DOORS_TERM = 'Doors and openings';
const WINDOWS_TERM = 'Windows';
const FIXTURES_TERM = 'Fixtures';
const OPEN_ITEMS_TERM = 'Open items';
const SERVICES_TERM = 'Services';

/** An empty list said in words. */
const NO_WINDOWS = 'No windows';
const NO_FIXTURES = 'Nothing stands in it';
const NO_SERVICES = 'No service reaches it';

/** A room with taps: its water line must name the fitting, not just the layer. */
const TAPPED_ROOM: SpaceId = 'mainShowerCubicle';

/**
 * The one space of the floor no run terminates in, so the empty sentence is real.
 *
 * Both chamber vents used to be declared as ending INTO a balcony, which made this
 * slab's whole service list read `Gas`. They cap now — a vent discharges into the open
 * air, it does not serve it — and balcony A is the floor's only unserviced space.
 */
const UNSERVED_ROOM: SpaceId = 'balconyA';

/** The Tailwind class carrying the 24 px target floor of WCAG 2.5.8. */
const MIN_TARGET_CLASS = 'min-h-6';

/** The class that hides the trigger's caption below the `sm` breakpoint. */
const HIDDEN_CAPTION_CLASS = 'sr-only';

/** The heading level the panel is titled at, under the app's own `sr-only` `h1`. */
const HEADING_LEVEL = 2;

/** How many `role="status"` elements this HUD allows: the view status, and nothing else. */
const STATUS_COUNT = 1;

const REGION_TEST_ID = 'interior-region';
const FOCUSABLE_TAB_INDEX = 0;

/**
 * Everything the model says about a room on {@link CURRENT_FLOOR}.
 *
 * The tests below assert against this rather than against numbers copied out of the plan:
 * what is being checked is that the panel prints the model's answers, not that the model
 * is right — `domain/roomInfo.test.ts` is where that is settled.
 *
 * @param spaceId - The room.
 * @param floor - The storey it is on.
 * @returns Its {@link RoomInfo}.
 */
function infoOf(spaceId: SpaceId, floor: number = CURRENT_FLOOR): RoomInfo {
  return getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT_FLOOR, makeFloorSpaceRef(floor, spaceId));
}

/**
 * The label of a room, spelt by the one label formatter of the model.
 *
 * @param spaceId - The room.
 * @param floor - The storey it is on.
 * @returns e.g. `F3-R11/KIT · Kitchen`.
 */
function labelOf(spaceId: SpaceId = KITCHEN, floor: number = CURRENT_FLOOR): string {
  return getSpaceLabel(getSpace(FLOOR_PLAN, spaceId), floor);
}

/**
 * The accessible name of the trigger for a room: the caption, then the label.
 *
 * @param spaceId - The room the viewer is standing in.
 * @param floor - The storey they are on.
 * @returns The whole name.
 */
function triggerName(spaceId: SpaceId = KITCHEN, floor: number = CURRENT_FLOOR): string {
  return `${TRIGGER_CAPTION} ${labelOf(spaceId, floor)}`;
}

function enterInterior(): void {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

/**
 * Stands the explorer in a room on a storey, the way the pose store reports one.
 *
 * @param spaceId - The room, or `undefined` for no room at all.
 * @param floor - The storey it is on.
 */
function standIn(spaceId: SpaceId | undefined, floor: number = CURRENT_FLOOR): void {
  act(() => {
    useExplorerPoseStore.setState({
      currentSpace: spaceId === undefined ? undefined : makeFloorSpaceRef(floor, spaceId),
      currentFloor: floor,
    });
  });
}

function getTrigger(spaceId: SpaceId = KITCHEN, floor: number = CURRENT_FLOOR): HTMLElement {
  return screen.getByRole('button', { name: triggerName(spaceId, floor) });
}

function queryPanel(spaceId: SpaceId = KITCHEN, floor: number = CURRENT_FLOOR): HTMLElement | null {
  return screen.queryByRole('region', { name: labelOf(spaceId, floor) });
}

function getPanel(spaceId: SpaceId = KITCHEN, floor: number = CURRENT_FLOOR): HTMLElement {
  return screen.getByRole('region', { name: labelOf(spaceId, floor) });
}

/**
 * The answer the panel gives under one of its terms.
 *
 * @param term - The term, as the panel spells it.
 * @returns The `<dd>` after that `<dt>`.
 */
function valueOf(term: string): HTMLElement {
  const definition = screen.getByText(term).nextElementSibling;
  if (!(definition instanceof HTMLElement)) {
    throw new Error(`the term "${term}" is followed by no value`);
  }
  return definition;
}

/**
 * Every line the panel lists under one of its terms.
 *
 * @param term - The term, as the panel spells it.
 * @returns The text of each list item under it.
 */
function linesOf(term: string): readonly string[] {
  return within(valueOf(term))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
}

/** Renders a focusable stand-in for the interior region before the panel, as in the app. */
function renderWithRegion(): HTMLElement {
  render(
    <>
      <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      <RoomInfoPanel />
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
}

/**
 * Presses the trigger with the keyboard, which leaves focus on it.
 *
 * `userEvent.keyboard` on a focused button fires a click whose `detail` is 0, which is how
 * the component tells a key press from a pointer one.
 *
 * @param user - The user-event session.
 * @param spaceId - The room the viewer is standing in.
 */
async function openByKeyboard(
  user: ReturnType<typeof userEvent.setup>,
  spaceId: SpaceId = KITCHEN,
): Promise<void> {
  getTrigger(spaceId).focus();
  await user.keyboard('{Enter}');
}

describe('RoomInfoPanel', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useExplorerPoseStore.setState(useExplorerPoseStore.getInitialState(), true);
    standIn(KITCHEN);
  });

  it('renders nothing in the exterior view', () => {
    const { container } = render(<RoomInfoPanel />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing while the viewer is in no room at all', () => {
    standIn(undefined);
    const { container } = render(<RoomInfoPanel />);

    enterInterior();

    // Over a void, inside a wall, and before the first frame resolves a room: there is
    // nothing for a panel about "this room" to be about.
    expect(container).toBeEmptyDOMElement();
  });

  it('names the room the viewer is standing in, storey and all', () => {
    enterInterior();
    render(<RoomInfoPanel />);

    expect(getTrigger()).toBeInTheDocument();
    expect(getTrigger()).toHaveAccessibleName(triggerName());
  });

  it('renames itself as the viewer walks into another room', () => {
    enterInterior();
    render(<RoomInfoPanel />);

    standIn('corridor');

    expect(getTrigger('corridor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: triggerName() })).toBeNull();
  });

  it('keeps the caption in the trigger and the room label out of a phone’s way', () => {
    enterInterior();
    render(<RoomInfoPanel />);

    // The LABEL is the half that hides below `sm`, not the caption. This trigger shares a
    // row with "Go to room", and `F1-R06/STR · Stairwell` is three times the width of
    // "About this room": keeping the label wraps the row at 400 px and takes the 3D view
    // under the 60 % of viewport height `remoteControl.spec.ts` holds it to.
    const label = within(getTrigger()).getByText(labelOf());
    expect(label).toHaveClass(HIDDEN_CAPTION_CLASS);
    expect(label).toHaveClass('sm:not-sr-only');
    expect(screen.getByText(TRIGGER_CAPTION)).not.toHaveClass(HIDDEN_CAPTION_CLASS);
    // Nothing is lost to assistive technology: the name is the whole text content.
    expect(getTrigger()).toHaveAccessibleName(
      new RegExp(labelOf().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
  });

  it('starts closed, and names the panel it controls only while it is open', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(getTrigger()).not.toHaveAttribute('aria-controls');
    expect(queryPanel()).toBeNull();

    await openByKeyboard(user);

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
    expect(getPanel().getAttribute('id')).toBe(getTrigger().getAttribute('aria-controls'));

    await user.keyboard('{Enter}');

    // Closed again: an `aria-controls` naming an unmounted panel is an IDREF assistive
    // technology cannot resolve, and axe reports it as incomplete rather than a violation.
    expect(getTrigger()).not.toHaveAttribute('aria-controls');
    expect(queryPanel()).toBeNull();
  });

  it('anchors the open panel out of flow, so the HUD overlay box cannot grow', async () => {
    const user = userEvent.setup();
    enterInterior();
    const { container } = render(<RoomInfoPanel />);

    await openByKeyboard(user);

    // jsdom computes no layout, so the assertion that matters — the 3D view keeping 60 %
    // of a 400 px-wide screen — is an end-to-end one (`tests/e2e/remoteControl.spec.ts`).
    // What is checkable here is that the panel is taken out of the flow it would otherwise
    // stretch, and that the wrapper is the box its offsets resolve against.
    const panel = getPanel();
    expect(panel).toHaveClass('absolute');
    expect(panel).toHaveClass('top-full');
    expect(panel).toHaveClass('left-0');
    expect(panel).toHaveClass('overflow-y-auto');
    expect(container.firstElementChild).toHaveClass('relative');
  });

  it('heads the panel with the room label and takes its own name from it', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);

    const heading = screen.getByRole('heading', { level: HEADING_LEVEL, name: labelOf() });
    expect(getPanel()).toHaveAttribute('aria-labelledby', heading.getAttribute('id'));
  });

  it('gives the matricule of the room on the storey it is on', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);

    expect(valueOf(MATRICULE_TERM)).toHaveTextContent(infoOf(KITCHEN).matricule);
  });

  it('reports the kitchen rectangle by rectangle, never as one bounding box', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    const { rects } = infoOf(KITCHEN);
    const sizes = linesOf(SIZE_TERM);

    // The kitchen is drawn as two rectangles, so its bounding box states a width and a
    // depth the room does not have (`domain/roomInfo.ts`). One line per rectangle is the
    // guard against a panel that measured the box instead.
    expect(rects.length).toBeGreaterThan(1);
    expect(sizes).toHaveLength(rects.length);
    sizes.forEach((size) => {
      expect(size).toMatch(/^\d+\.\d{2} × \d+\.\d{2} m$/u);
    });
    const boundingWidth =
      Math.max(...rects.map((rect) => rect.maxX)) - Math.min(...rects.map((rect) => rect.minX));
    expect(sizes.join(' ')).not.toContain(boundingWidth.toFixed(2));
  });

  it('states the clear floor area to two decimals', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);

    expect(valueOf(AREA_TERM)).toHaveTextContent(`${infoOf(KITCHEN).area.toFixed(2)} m²`);
  });

  it('lists every passage into the room and where each one leads', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    const { doors } = infoOf(KITCHEN);
    const lines = linesOf(DOORS_TERM);

    expect(lines).toHaveLength(doors.length);
    doors.forEach((door, index) => {
      expect(lines[index]).toContain(door.partnerName);
      expect(lines[index]).toContain(door.kind);
      expect(lines[index]).toContain(door.width.toFixed(2));
    });
  });

  it('says whether a leaf slides, where one does', async () => {
    const user = userEvent.setup();
    standIn('mainSanitair');
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, 'mainSanitair');
    const { doors } = infoOf('mainSanitair');
    const lines = linesOf(DOORS_TERM);

    expect(doors.some((door) => door.sliding)).toBe(true);
    doors.forEach((door, index) => {
      expect((lines[index] ?? '').includes('sliding')).toBe(door.sliding);
    });
  });

  it('lists the windows of the room with what each one is for', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    const { windows } = infoOf(KITCHEN);
    const lines = linesOf(WINDOWS_TERM);

    expect(windows.length).toBeGreaterThan(0);
    expect(lines).toHaveLength(windows.length);
    windows.forEach((window, index) => {
      expect(lines[index]).toContain(window.kind);
    });
  });

  it('lists what stands in the room by its X matricule', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    const { fixtures } = infoOf(KITCHEN);
    const lines = linesOf(FIXTURES_TERM);

    expect(fixtures.length).toBeGreaterThan(0);
    expect(lines).toHaveLength(fixtures.length);
    fixtures.forEach((fixture, index) => {
      expect(lines[index]).toContain(fixture.matricule);
      expect(lines[index]).toContain(fixture.kind);
    });
  });

  it('carries the note the plan puts on a fixture, where it puts one', async () => {
    const user = userEvent.setup();
    standIn('laundry');
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, 'laundry');
    const noted = infoOf('laundry').fixtures.filter((fixture) => fixture.note !== undefined);
    const lines = linesOf(FIXTURES_TERM).join(' ');

    expect(noted.length).toBeGreaterThan(0);
    noted.forEach((fixture) => {
      expect(lines).toContain(fixture.note);
    });
  });

  it('says an empty list in words rather than showing an empty region', async () => {
    const user = userEvent.setup();
    standIn(BALCONY);
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, BALCONY);
    const info = infoOf(BALCONY);

    expect(info.windows).toHaveLength(0);
    expect(info.fixtures).toHaveLength(0);
    expect(valueOf(WINDOWS_TERM)).toHaveTextContent(NO_WINDOWS);
    expect(valueOf(FIXTURES_TERM)).toHaveTextContent(NO_FIXTURES);
    expect(within(valueOf(WINDOWS_TERM)).queryByRole('list')).toBeNull();
  });

  it.each([...DARK_ROOMS])('tells the viewer %s has no daylight', async (spaceId) => {
    const user = userEvent.setup();
    standIn(spaceId);
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, spaceId);

    expect(linesOf(OPEN_ITEMS_TERM)).toContain(NO_DAYLIGHT_NOTE);
  });

  it('says nothing of the sort about a room a balcony door lights', async () => {
    const user = userEvent.setup();
    standIn(LIT_ROOM);
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, LIT_ROOM);

    // The master bedroom has no window at all, by the owner's choice, and is not dark: a
    // glazing test would call it dark and be wrong.
    expect(infoOf(LIT_ROOM).daylight).toBe('door');
    expect(getPanel(LIT_ROOM)).not.toHaveTextContent(NO_DAYLIGHT_NOTE);
  });

  it('never says a balcony is lit by electricity, and keeps everything else it says', async () => {
    const user = userEvent.setup();
    standIn(BALCONY);
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, BALCONY);
    const info = infoOf(BALCONY);
    const shown = linesOf(OPEN_ITEMS_TERM);

    // The model derives `none` for a balcony no window names, and says so in its open
    // items; it is under the open sky, so the sentence is suppressed here rather than by
    // teaching the domain a daylight source it has no value for.
    expect(info.daylight).toBe('none');
    expect(info.openItems).toContain(NO_DAYLIGHT_NOTE);
    expect(shown).not.toContain(NO_DAYLIGHT_NOTE);
    expect(shown).toEqual(info.openItems.filter((item) => item !== NO_DAYLIGHT_NOTE));
    expect(shown.length).toBeGreaterThan(0);
  });

  it("lists every service reaching the room, in the model's order and in its words", async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    const { services } = infoOf(KITCHEN);

    // The kitchen is the room every layer but the low-voltage-free cubicles reaches:
    // drainage, water, gas, electricity, low voltage and climate.
    expect(services.length).toBeGreaterThan(0);
    expect(linesOf(SERVICES_TERM)).toHaveLength(services.length);
    linesOf(SERVICES_TERM).forEach((line, index) => {
      expect(line).toContain(services[index]?.name);
    });
  });

  it("never spells a layer itself: every line opens with the plan's own name", async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    const names = SERVICE_LAYERS.map((layer) => layer.name);

    linesOf(SERVICES_TERM).forEach((line) => {
      expect(names.some((name) => line.startsWith(name))).toBe(true);
    });
  });

  it('separates a service that lands on a fitting from one that merely reaches the room', async () => {
    const user = userEvent.setup();
    standIn(TAPPED_ROOM);
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, TAPPED_ROOM);
    const { services } = infoOf(TAPPED_ROOM);
    const lines = linesOf(SERVICES_TERM);
    const water = services.find((service) => service.layer === 'water');
    const power = services.find((service) => service.layer === 'electricity');

    // "There is water in this room" and "this shower has a tap" are two statements, and
    // the bare layer name is the first of them.
    expect(water?.fittings).toEqual(['shower']);
    expect(power?.fittings).toEqual([]);
    expect(lines.some((line) => line.includes('shower'))).toBe(true);
    expect(lines).toContain(power?.name);
  });

  it('tells the viewer standing on a balcony what reaches it', async () => {
    const user = userEvent.setup();
    standIn(BALCONY);
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, BALCONY);
    const { services } = infoOf(BALCONY);

    // Climate alone, and every part of that is load-bearing: the outdoor cooling unit
    // genuinely stands on this balcony, while the electrical chamber's vent — which used
    // to put `Electricity` here — now terminates at a cap instead of in the space.
    expect(services.map((service) => service.layer)).toEqual(['climate']);
    expect(linesOf(SERVICES_TERM)).toEqual(services.map((service) => service.name));
  });

  it('says the empty list in words rather than an empty list, where nothing reaches', async () => {
    const user = userEvent.setup();
    standIn(UNSERVED_ROOM);
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user, UNSERVED_ROOM);

    // "list, 0 items" reads as a bug to a screen-reader user, so there is no list at all.
    expect(infoOf(UNSERVED_ROOM).services).toEqual([]);
    expect(valueOf(SERVICES_TERM)).toHaveTextContent(NO_SERVICES);
    expect(within(valueOf(SERVICES_TERM)).queryByRole('list')).toBeNull();
  });

  it('shows the services as a list and not as the empty sentence', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);

    expect(within(valueOf(SERVICES_TERM)).getByRole('list')).toBeInTheDocument();
    expect(valueOf(SERVICES_TERM)).not.toHaveTextContent(NO_SERVICES);
  });

  it('leaves the single status role of the HUD alone', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(
      <>
        <ViewModeToggle />
        <RoomInfoPanel />
      </>,
    );

    expect(screen.getAllByRole('status')).toHaveLength(STATUS_COUNT);

    await openByKeyboard(user);

    // The view status of `ViewModeToggle` is the one status of this HUD: the screenshot
    // mask and several bare `getByRole('status')` queries all depend on there being one.
    expect(screen.getAllByRole('status')).toHaveLength(STATUS_COUNT);
  });

  it('announces nothing as the viewer walks: the panel is read on demand', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    const panel = getPanel();

    // `RoomReadout` already announces the room. A second live region over the same fact
    // would announce every doorway twice.
    expect(panel).not.toHaveAttribute('aria-live');
    expect(panel).not.toHaveAttribute('aria-atomic');
    expect(panel).not.toHaveAttribute('role');
  });

  it('follows the viewer from room to room while it is open', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    standIn('corridor');

    expect(getPanel('corridor')).toBeInTheDocument();
    expect(queryPanel()).toBeNull();
  });

  it('closes on Escape and keeps focus on the trigger', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    await user.keyboard('{Escape}');

    expect(queryPanel()).toBeNull();
    expect(getTrigger()).toHaveFocus();
  });

  it('hands focus to the 3D view after a pointer press, so the keys keep working', async () => {
    const user = userEvent.setup();
    enterInterior();
    const region = renderWithRegion();

    await user.click(getTrigger());

    expect(getPanel()).toBeInTheDocument();
    expect(region).toHaveFocus();
  });

  it('leaves focus on the trigger after a keyboard press, where the user put it', async () => {
    const user = userEvent.setup();
    enterInterior();
    const region = renderWithRegion();

    await openByKeyboard(user);

    expect(getPanel()).toBeInTheDocument();
    expect(getTrigger()).toHaveFocus();
    expect(region).not.toHaveFocus();
  });

  it('closes when the viewer leaves the interior, so it is shut on return', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomInfoPanel />);

    await openByKeyboard(user);
    enterInterior();
    enterInterior();

    expect(queryPanel()).toBeNull();
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives its trigger at least the 24 px target floor', () => {
    enterInterior();
    render(<RoomInfoPanel />);

    expect(getTrigger()).toHaveClass(MIN_TARGET_CLASS);
    expect(getTrigger()).toHaveClass('focus-visible:outline-amber-400');
  });
});
