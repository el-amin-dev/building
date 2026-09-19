import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import { useRoomWalkStore, type RoomWalkState } from './roomWalkStore.ts';

/** The lowest storey the plan numbers. */
const GROUND_FLOOR = 1;

/** The storey above it: the same plan, one floor-to-floor height up. */
const FIRST_FLOOR = 2;

/** The ground-floor kitchen: the room most of these walks ask for. */
const KITCHEN = makeFloorSpaceRef(GROUND_FLOOR, 'kitchen');

/** The kitchen of the storey above: the same room of the plan, a different place. */
const KITCHEN_UPSTAIRS = makeFloorSpaceRef(FIRST_FLOOR, 'kitchen');

/** Another room of the ground floor, for choosing a different target mid-walk. */
const LAUNDRY = makeFloorSpaceRef(GROUND_FLOOR, 'laundry');

/** The request id the store starts on, before any walk has been asked for. */
const INITIAL_REQUEST_ID = 0;

/** The id of the first walk asked for after a reset. */
const FIRST_REQUEST_ID = 1;

/** An id belonging to no walk, used to check that a mismatched report is dropped. */
const FOREIGN_REQUEST_ID = 999;

/** Each report action with the status it is expected to record. */
const REPORTS = [
  ['reportArrived', 'arrived'],
  ['reportBlocked', 'blocked'],
  ['reportUnreachable', 'unreachable'],
] as const satisfies readonly (readonly [keyof RoomWalkState, string])[];

function state(): RoomWalkState {
  return useRoomWalkStore.getState();
}

describe('useRoomWalkStore', () => {
  beforeEach(() => {
    useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
  });

  it('asks for no room at first', () => {
    expect(state().target).toBeUndefined();
    expect(state().status).toBe('idle');
    expect(state().requestId).toBe(INITIAL_REQUEST_ID);
  });

  it('starts walking to the room asked for, carrying the ref it was handed', () => {
    state().startWalkTo(KITCHEN);

    // The very ref, not a copy: it is frozen, so nothing downstream can edit the target.
    expect(state().target).toBe(KITCHEN);
    expect(Object.isFrozen(state().target)).toBe(true);
    expect(state().status).toBe('walking');
    expect(state().requestId).toBe(FIRST_REQUEST_ID);
  });

  it('counts the kitchen of each storey as its own request', () => {
    // The same room of the one plan, two different places: neither may stand in for the other.
    expect(KITCHEN.spaceId).toBe(KITCHEN_UPSTAIRS.spaceId);
    expect(KITCHEN.floor).not.toBe(KITCHEN_UPSTAIRS.floor);

    state().startWalkTo(KITCHEN);
    const ground = state().requestId;
    state().startWalkTo(KITCHEN_UPSTAIRS);

    expect(ground).toBe(FIRST_REQUEST_ID);
    expect(state().requestId).toBe(FIRST_REQUEST_ID + 1);
    expect(state().target).toBe(KITCHEN_UPSTAIRS);
    expect(state().status).toBe('walking');
  });

  it('counts the same room chosen twice as a new request', () => {
    state().startWalkTo(KITCHEN);
    state().startWalkTo(KITCHEN);

    expect(state().target).toBe(KITCHEN);
    expect(state().status).toBe('walking');
    expect(state().requestId).toBe(FIRST_REQUEST_ID + 1);
  });

  it('replaces the target when another room is chosen mid-walk', () => {
    state().startWalkTo(KITCHEN);
    state().startWalkTo(LAUNDRY);

    expect(state().target).toBe(LAUNDRY);
    expect(state().status).toBe('walking');
    expect(state().requestId).toBe(FIRST_REQUEST_ID + 1);
  });

  it('goes back to idle and forgets the target when the walk is cancelled', () => {
    state().startWalkTo(KITCHEN);

    state().cancelWalk();

    expect(state().status).toBe('idle');
    expect(state().target).toBeUndefined();
  });

  it('leaves the state alone when cancelling while already idle', () => {
    const before = state();
    const listener = vi.fn();
    const unsubscribe = useRoomWalkStore.subscribe(listener);

    state().cancelWalk();

    expect(state()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('cannot be resurrected by a report from a cancelled walk', () => {
    state().startWalkTo(KITCHEN);
    const cancelledId = state().requestId;
    state().cancelWalk();
    const before = state();

    state().reportArrived(cancelledId);

    expect(state()).toBe(before);
    expect(state().status).toBe('idle');
    expect(state().target).toBeUndefined();
  });

  it.each(REPORTS)('records %s as %s and keeps the target', (method, expected) => {
    state().startWalkTo(KITCHEN);
    const liveId = state().requestId;

    state()[method](liveId);

    expect(state().status).toBe(expected);
    expect(state().target).toBe(KITCHEN);
    expect(state().requestId).toBe(liveId);
  });

  it.each(REPORTS)('drops %s when its id is not the live request', (method) => {
    state().startWalkTo(KITCHEN);
    const before = state();
    const listener = vi.fn();
    const unsubscribe = useRoomWalkStore.subscribe(listener);

    state()[method](FOREIGN_REQUEST_ID);

    expect(state()).toBe(before);
    expect(state().status).toBe('walking');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('drops a second report once the walk is over', () => {
    state().startWalkTo(KITCHEN);
    const liveId = state().requestId;
    state().reportArrived(liveId);
    const arrived = state();

    state().reportBlocked(liveId);

    expect(state()).toBe(arrived);
    expect(state().status).toBe('arrived');
  });
});
