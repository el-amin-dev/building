import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomWalkStore, type RoomWalkState } from './roomWalkStore.ts';

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

  it('starts walking to the room asked for', () => {
    state().startWalkTo('kitchen');

    expect(state().target).toBe('kitchen');
    expect(state().status).toBe('walking');
    expect(state().requestId).toBe(FIRST_REQUEST_ID);
  });

  it('counts the same room chosen twice as a new request', () => {
    state().startWalkTo('kitchen');
    state().startWalkTo('kitchen');

    expect(state().target).toBe('kitchen');
    expect(state().status).toBe('walking');
    expect(state().requestId).toBe(FIRST_REQUEST_ID + 1);
  });

  it('replaces the target when another room is chosen mid-walk', () => {
    state().startWalkTo('kitchen');
    state().startWalkTo('laundry');

    expect(state().target).toBe('laundry');
    expect(state().status).toBe('walking');
    expect(state().requestId).toBe(FIRST_REQUEST_ID + 1);
  });

  it('goes back to idle and forgets the target when the walk is cancelled', () => {
    state().startWalkTo('kitchen');

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
    state().startWalkTo('kitchen');
    const cancelledId = state().requestId;
    state().cancelWalk();
    const before = state();

    state().reportArrived(cancelledId);

    expect(state()).toBe(before);
    expect(state().status).toBe('idle');
    expect(state().target).toBeUndefined();
  });

  it.each(REPORTS)('records %s as %s and keeps the target', (method, expected) => {
    state().startWalkTo('kitchen');
    const liveId = state().requestId;

    state()[method](liveId);

    expect(state().status).toBe(expected);
    expect(state().target).toBe('kitchen');
    expect(state().requestId).toBe(liveId);
  });

  it.each(REPORTS)('drops %s when its id is not the live request', (method) => {
    state().startWalkTo('kitchen');
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
    state().startWalkTo('kitchen');
    const liveId = state().requestId;
    state().reportArrived(liveId);
    const arrived = state();

    state().reportBlocked(liveId);

    expect(state()).toBe(arrived);
    expect(state().status).toBe('arrived');
  });
});
