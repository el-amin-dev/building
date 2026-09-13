import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import type { RoomWalkStatus } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { ROOM_READOUT_ID } from './hudIds.ts';
import { RoomReadout } from './RoomReadout.tsx';

/** Where the explorer stands in most tests. */
const CURRENT_ID: SpaceId = 'stairs';
/** The room walks are asked for: a different space from {@link CURRENT_ID} on purpose. */
const TARGET_ID: SpaceId = 'kitchen';

const CURRENT_ROOM_LINE = 'Room: R06/STR · Stairwell';
const TARGET_ROOM_LINE = 'Room: R11/KIT · Kitchen';
const WALKING_LINE = 'Walking to R11/KIT · Kitchen';
const UNREACHABLE_LINE = 'Cannot walk to R11/KIT · Kitchen';
const BLOCKED_LINE = 'Stopped before reaching R11/KIT · Kitchen';
const NO_MESSAGE = '';

/** Classes keeping the live region mounted in the exterior view without showing it. */
const HIDDEN_CLASS = 'sr-only';
/** One of the HUD panel classes, worn only in the interior view. */
const PANEL_CLASS = 'bg-slate-900';

const WALK_STATUSES: readonly RoomWalkStatus[] = [
  'idle',
  'walking',
  'arrived',
  'unreachable',
  'blocked',
];

/** The readout, found by its id: it is empty in several states, so no text query would find it. */
function readout(): HTMLElement {
  const element = document.getElementById(ROOM_READOUT_ID);
  if (element === null) {
    throw new Error(`no element carries the room readout id "${ROOM_READOUT_ID}"`);
  }
  return element;
}

function enterInterior(): void {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function standIn(spaceId: SpaceId | undefined): void {
  act(() => {
    useExplorerPoseStore.setState({ currentSpaceId: spaceId });
  });
}

/** Drives the walk store into `status`, asking for {@link TARGET_ID} where a walk is needed. */
function reachStatus(status: RoomWalkStatus): void {
  if (status === 'idle') {
    return;
  }
  act(() => {
    useRoomWalkStore.getState().startWalkTo(TARGET_ID);
  });
  if (status === 'walking') {
    return;
  }
  const { requestId, reportArrived, reportBlocked, reportUnreachable } =
    useRoomWalkStore.getState();
  const report = { arrived: reportArrived, unreachable: reportUnreachable, blocked: reportBlocked }[
    status
  ];
  act(() => {
    report(requestId);
  });
}

describe('RoomReadout', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
    useExplorerPoseStore.setState(useExplorerPoseStore.getInitialState(), true);
    useExplorerPoseStore.getState().clearPose();
  });

  it('stays mounted, empty and hidden in the exterior view', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);

    expect(readout().textContent).toBe(NO_MESSAGE);
    expect(readout()).toHaveClass(HIDDEN_CLASS);
    expect(readout()).not.toHaveClass(PANEL_CLASS);
  });

  it('carries the live region attributes assistive technology needs', () => {
    render(<RoomReadout />);

    expect(readout()).toHaveAttribute('aria-live', 'polite');
    expect(readout()).toHaveAttribute('aria-atomic', 'true');
    expect(readout().tagName).toBe('P');
  });

  it('announces nothing in the interior view until the first room is resolved', () => {
    render(<RoomReadout />);

    enterInterior();

    expect(readout().textContent).toBe(NO_MESSAGE);
  });

  it('shows no panel in the interior view until there is something to put in it', () => {
    render(<RoomReadout />);

    enterInterior();

    // Mounted and hidden, not absent: `sr-only` is absolutely positioned, so the empty
    // region adds no pixels and no flex gap to a capture taken before the first frame.
    expect(readout()).toBeInTheDocument();
    expect(readout()).toHaveClass(HIDDEN_CLASS);
    expect(readout()).not.toHaveClass(PANEL_CLASS);
    expect(readout().textContent).toBe(NO_MESSAGE);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces the room the explorer is in, in the HUD panel', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);

    enterInterior();

    expect(readout().textContent).toBe(CURRENT_ROOM_LINE);
    expect(readout()).toHaveClass(PANEL_CLASS);
  });

  it('follows the explorer from room to room', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    enterInterior();

    standIn('corridor');
    expect(readout().textContent).toBe('Room: R07/COR · Corridor');

    standIn(TARGET_ID);
    expect(readout().textContent).toBe(TARGET_ROOM_LINE);
  });

  it('empties again when the interior view is left', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    enterInterior();

    act(() => {
      useViewStore.getState().toggleViewMode();
    });

    expect(readout().textContent).toBe(NO_MESSAGE);
    expect(readout()).toHaveClass(HIDDEN_CLASS);
  });

  it('announces the destination while a walk runs', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    enterInterior();

    reachStatus('walking');

    expect(readout().textContent).toBe(WALKING_LINE);
  });

  it('says so when the room cannot be reached, naming the room asked for', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    enterInterior();

    reachStatus('unreachable');

    expect(readout().textContent).toBe(UNREACHABLE_LINE);
  });

  it('says so when the walk was stopped short, naming the room asked for', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    enterInterior();

    reachStatus('blocked');

    expect(readout().textContent).toBe(BLOCKED_LINE);
  });

  it('announces an arrival as the room line of the room arrived in', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    enterInterior();
    reachStatus('walking');

    standIn(TARGET_ID);
    const { requestId, reportArrived } = useRoomWalkStore.getState();
    act(() => {
      reportArrived(requestId);
    });

    expect(readout().textContent).toBe(TARGET_ROOM_LINE);
  });

  it('keeps quiet about the rooms crossed mid-walk, announcing the walk twice in all', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    enterInterior();
    reachStatus('walking');

    for (const crossed of ['corridor', 'livingRoom', TARGET_ID] as const) {
      standIn(crossed);
      expect(readout().textContent).toBe(WALKING_LINE);
    }
  });

  it('stays out of the way of the single status role of the HUD', () => {
    standIn(CURRENT_ID);
    render(<RoomReadout />);
    expect(screen.queryByRole('status')).toBeNull();

    enterInterior();

    for (const status of WALK_STATUSES) {
      reachStatus(status);
      expect(screen.queryByRole('status')).toBeNull();
    }
  });
});
