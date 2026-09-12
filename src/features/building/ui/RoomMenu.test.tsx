import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { FLOOR_PLAN, getSpace, getSpaceLabel } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { INTERIOR_REGION_ID, ROOM_LIST_ID } from './hudIds.ts';
import { RoomMenu } from './RoomMenu.tsx';
import { ROOM_TARGETS } from './roomTargets.ts';

const TRIGGER_NAME = 'Go to room';
const STOP_NAME = 'Stop walking';
const REGION_TEST_ID = 'interior-region';
const FOCUSABLE_TAB_INDEX = 0;

/** The Tailwind class carrying the 24 px target floor of WCAG 2.5.8. */
const MIN_TARGET_CLASS = 'min-h-6';

/** The room picked in the tests below. */
const PICKED_ROOM_ID: SpaceId = 'kitchen';

/** Its label, as the model formats it: `R11/KIT · Kitchen`. */
const PICKED_ROOM_LABEL = getSpaceLabel(getSpace(FLOOR_PLAN, PICKED_ROOM_ID));

/** The request id of the first walk asked for after a store reset. */
const FIRST_REQUEST_ID = 1;

/** The menu's own buttons while a walk is running: the trigger and "Stop walking". */
const HUD_BUTTON_COUNT = 2;

function enterInterior() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function startWalking() {
  act(() => {
    useRoomWalkStore.getState().startWalkTo(PICKED_ROOM_ID);
  });
}

function getTrigger(): HTMLElement {
  return screen.getByRole('button', { name: TRIGGER_NAME });
}

function queryList(): HTMLElement | null {
  return screen.queryByRole('list');
}

/** Renders a focusable stand-in for the interior region before the menu, as in the app. */
function renderWithRegion(): HTMLElement {
  render(
    <>
      <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      <RoomMenu />
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
}

describe('RoomMenu', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
  });

  it('renders nothing in the exterior view', () => {
    const { container } = render(<RoomMenu />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: TRIGGER_NAME })).toBeNull();
  });

  it('appears with the interior view and disappears when leaving it', () => {
    render(<RoomMenu />);

    enterInterior();
    expect(getTrigger()).toBeInTheDocument();

    enterInterior();
    expect(screen.queryByRole('button', { name: TRIGGER_NAME })).toBeNull();
  });

  it('names the list it controls and reports whether it is open', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(queryList()).toBeNull();

    await user.click(getTrigger());

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
    expect(getTrigger()).toHaveAttribute('aria-controls', ROOM_LIST_ID);
    expect(queryList()).toHaveAttribute('id', ROOM_LIST_ID);

    await user.click(getTrigger());

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(queryList()).toBeNull();
  });

  it('names no list while the list is closed, so the IDREF always resolves', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);

    // Closed: the `<ul>` is not mounted, so an `aria-controls` naming it would dangle.
    expect(getTrigger()).not.toHaveAttribute('aria-controls');
    expect(document.getElementById(ROOM_LIST_ID)).toBeNull();

    await user.click(getTrigger());
    expect(document.getElementById(ROOM_LIST_ID)).not.toBeNull();

    await user.click(getTrigger());

    expect(getTrigger()).not.toHaveAttribute('aria-controls');
    expect(document.getElementById(ROOM_LIST_ID)).toBeNull();
  });

  it('anchors the open list to the trigger instead of to its static position', async () => {
    const user = userEvent.setup();
    enterInterior();
    const { container } = render(<RoomMenu />);

    await user.click(getTrigger());
    const list = screen.getByRole('list');

    // jsdom computes no layout, so the assertion that matters — every room inside the
    // window — is an end-to-end one (`tests/e2e/explore.spec.ts`). What is checkable here
    // is that the offsets exist at all and that the wrapper is the box they resolve
    // against: an `absolute` list with no `top` falls back to its static position, which
    // the wrapper's centring flex row put 106 px above the top of the screen.
    expect(list).toHaveClass('absolute');
    expect(list).toHaveClass('top-full');
    expect(list).toHaveClass('left-0');
    expect(list).toHaveClass('overflow-y-auto');
    expect(container.firstElementChild).toHaveClass('relative');
  });

  it('offers one button per walkable room, named by the model', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);

    await user.click(getTrigger());
    const list = screen.getByRole('list');

    expect(within(list).getAllByRole('button')).toHaveLength(ROOM_TARGETS.length);
    ROOM_TARGETS.forEach((space) => {
      expect(within(list).getByRole('button', { name: getSpaceLabel(space) })).toBeInTheDocument();
    });
  });

  it('offers no void, which is not a place a person can be', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);

    await user.click(getTrigger());

    expect(ROOM_TARGETS.map((space) => space.id)).not.toContain('voidWest');
    expect(ROOM_TARGETS.map((space) => space.id)).not.toContain('voidEast');
    expect(within(screen.getByRole('list')).queryByRole('button', { name: /void/i })).toBeNull();
  });

  it('reaches the rooms with Tab, in the order they are offered', async () => {
    const user = userEvent.setup();
    enterInterior();
    renderWithRegion();

    await user.click(getTrigger());
    const items = within(screen.getByRole('list')).getAllByRole('button');

    await user.tab();
    expect(items[0]).toHaveFocus();
    await user.tab();
    expect(items[1]).toHaveFocus();
  });

  it('asks for a walk on a pointer pick, closes the list and hands focus to the view', async () => {
    const user = userEvent.setup();
    enterInterior();
    const region = renderWithRegion();

    await user.click(getTrigger());
    await user.click(screen.getByRole('button', { name: PICKED_ROOM_LABEL }));

    expect(useRoomWalkStore.getState().target).toBe(PICKED_ROOM_ID);
    expect(useRoomWalkStore.getState().status).toBe('walking');
    expect(useRoomWalkStore.getState().requestId).toBe(FIRST_REQUEST_ID);
    expect(queryList()).toBeNull();
    expect(region).toHaveFocus();
  });

  it('asks for a walk on a keyboard pick and leaves focus on the trigger', async () => {
    const user = userEvent.setup();
    enterInterior();
    renderWithRegion();

    await user.click(getTrigger());
    await user.tab();
    const first = ROOM_TARGETS[0];
    expect(screen.getByRole('button', { name: getSpaceLabel(first) })).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(useRoomWalkStore.getState().target).toBe(first.id);
    expect(useRoomWalkStore.getState().status).toBe('walking');
    expect(queryList()).toBeNull();
    expect(getTrigger()).toHaveFocus();
  });

  it('closes on Escape from the trigger and keeps focus there', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);

    await user.click(getTrigger());
    await user.keyboard('{Escape}');

    expect(queryList()).toBeNull();
    expect(getTrigger()).toHaveFocus();
    expect(useRoomWalkStore.getState().status).toBe('idle');
  });

  it('closes on Escape from inside the list and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);

    await user.click(getTrigger());
    await user.tab();
    await user.keyboard('{Escape}');

    expect(queryList()).toBeNull();
    expect(getTrigger()).toHaveFocus();
    expect(useRoomWalkStore.getState().status).toBe('idle');
  });

  it('offers no way to stop while nothing is walking', () => {
    enterInterior();
    render(<RoomMenu />);

    expect(screen.queryByRole('button', { name: STOP_NAME })).toBeNull();
  });

  it('stops a walk in progress and takes its button away again', async () => {
    const user = userEvent.setup();
    enterInterior();
    const region = renderWithRegion();
    startWalking();

    await user.click(screen.getByRole('button', { name: STOP_NAME }));

    expect(useRoomWalkStore.getState().status).toBe('idle');
    expect(useRoomWalkStore.getState().target).toBeUndefined();
    expect(screen.queryByRole('button', { name: STOP_NAME })).toBeNull();
    expect(region).toHaveFocus();
  });

  it('closes the list when the viewer leaves the interior, so it is shut on return', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);

    await user.click(getTrigger());
    enterInterior();
    enterInterior();

    expect(queryList()).toBeNull();
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives every control at least the 24 px target floor', async () => {
    const user = userEvent.setup();
    enterInterior();
    render(<RoomMenu />);
    startWalking();

    await user.click(getTrigger());
    const controls = screen.getAllByRole('button');

    expect(controls).toHaveLength(ROOM_TARGETS.length + HUD_BUTTON_COUNT);
    controls.forEach((control) => {
      expect(control).toHaveClass(MIN_TARGET_CLASS);
    });
  });
});
