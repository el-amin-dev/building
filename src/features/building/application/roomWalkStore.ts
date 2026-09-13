import { create } from 'zustand';
import type { SpaceId } from '../domain/floorPlan/index.ts';

/**
 * Where a "go to room" walk stands: `idle` when nothing was asked for, `walking` while the
 * body is on its way, and one of the three outcomes once the frame loop reports back.
 *
 * There is deliberately no `cancelled`: cancelling is silent, because the viewer took the
 * controls back and has nothing to be told. Cancelling returns straight to `idle`.
 */
export type RoomWalkStatus = 'idle' | 'walking' | 'arrived' | 'unreachable' | 'blocked';

/** The three outcomes a walk can be reported to have reached. */
type RoomWalkOutcome = Extract<RoomWalkStatus, 'arrived' | 'unreachable' | 'blocked'>;

/**
 * The request id before any walk has ever been asked for. The first `startWalkTo` raises it,
 * so no live request ever carries this value and a report cannot match it by accident.
 */
const INITIAL_REQUEST_ID = 0;

/** How much `startWalkTo` raises `requestId`, so every request gets its own number. */
const REQUEST_ID_STEP = 1;

/** State and actions of the "go to room" walk. */
export interface RoomWalkState {
  /** The room asked for; kept while `status` reports the outcome, `undefined` when idle. */
  readonly target: SpaceId | undefined;
  /** Where the current walk stands. */
  readonly status: RoomWalkStatus;
  /**
   * Increments on every `startWalkTo`, so the frame loop can tell a new request from the
   * one it is already following — including the same room chosen twice.
   */
  readonly requestId: number;

  /** Asks for a walk to `spaceId`. What the "Go to room" menu and the minimap call. */
  readonly startWalkTo: (spaceId: SpaceId) => void;
  /** Abandons the walk and returns to `idle`; a no-op update returns the previous state. */
  readonly cancelWalk: () => void;

  /** Reported by the frame loop; ignored unless `id` is the current `requestId`. */
  readonly reportArrived: (id: number) => void;
  /** Reported by the frame loop; ignored unless `id` is the current `requestId`. */
  readonly reportBlocked: (id: number) => void;
  /** Reported by the frame loop; ignored unless `id` is the current `requestId`. */
  readonly reportUnreachable: (id: number) => void;
}

/**
 * Global store carrying the "go to room" command and its outcome.
 *
 * Picking a room makes the viewer walk there through real doorways, so the command and its
 * outcome change a handful of times per walk and belong in a store the HUD can subscribe to.
 * The per-frame follower state does not live here: it stays in a ref inside the frame-loop
 * hook, because per-frame data in a store re-renders every subscriber sixty times a second
 * (ADR-004, ADR-007). For the same reason the store holds no route, waypoints or progress —
 * routing needs the pose, which lives in that ref; the named destination is the progress the
 * readout shows.
 *
 * Every report carries the `requestId` it belongs to and is dropped unless a walk with that
 * id is still running, so a late report cannot resurrect a walk the viewer already cancelled.
 * Every update that changes nothing returns the previous state unchanged, so no subscriber
 * is notified pointlessly.
 *
 * @returns A React hook selecting from {@link RoomWalkState}.
 */
export const useRoomWalkStore = create<RoomWalkState>()((set) => {
  /** Records `outcome`, unless the walk it belongs to is over or was never the live one. */
  const report = (id: number, outcome: RoomWalkOutcome): void =>
    set((state) =>
      state.status === 'walking' && state.requestId === id ? { status: outcome } : state,
    );

  return {
    target: undefined,
    status: 'idle',
    requestId: INITIAL_REQUEST_ID,

    startWalkTo: (spaceId) =>
      set((state) => ({
        target: spaceId,
        status: 'walking',
        requestId: state.requestId + REQUEST_ID_STEP,
      })),
    cancelWalk: () =>
      set((state) => (state.status === 'idle' ? state : { target: undefined, status: 'idle' })),

    reportArrived: (id) => report(id, 'arrived'),
    reportBlocked: (id) => report(id, 'blocked'),
    reportUnreachable: (id) => report(id, 'unreachable'),
  };
});
