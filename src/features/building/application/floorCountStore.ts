import { create } from 'zustand';
import { clampFloorCount, FLOOR_COUNT_STEP, INITIAL_FLOOR_COUNT } from '../domain/storeys.ts';

/** State and actions of the storey count. */
export interface FloorCountState {
  /** How many identical storeys are displayed, 1…10. Reactive; changes a handful of times ever. */
  readonly floorCount: number;
  /** Adds one storey above; a no-op at the maximum. */
  readonly increaseFloorCount: () => void;
  /** Removes the top storey; a no-op at the minimum. */
  readonly decreaseFloorCount: () => void;
  /** Sets the count, clamped; for tests and a future URL parameter. */
  readonly setFloorCount: (count: number) => void;
}

/** The part of the state an update may replace: the count and nothing else. */
type FloorCountUpdate = Pick<FloorCountState, 'floorCount'>;

/**
 * Applies a requested count, or keeps the state exactly as it was.
 *
 * Returning the previous state *object* — not an equal copy of it — is what
 * makes a press at either end of the range free: zustand compares identity, so
 * no subscriber is notified for a change that changed nothing.
 *
 * @param state - The current state.
 * @param count - The requested count; clamped by the domain.
 * @returns The previous state when the clamped count is the current one,
 *   otherwise the new count.
 * @throws RangeError when `count` is not finite (see `clampFloorCount`).
 */
function withFloorCount(state: FloorCountState, count: number): FloorCountState | FloorCountUpdate {
  const floorCount = clampFloorCount(count);
  return floorCount === state.floorCount ? state : { floorCount };
}

/**
 * Global store holding how many storeys of the typical floor are stacked.
 *
 * The store holds no bounds of its own: the minimum, the maximum and the clamp
 * all come from `domain/storeys.ts`, so the stepper that presents the count,
 * the level table that places the storeys and this store cannot disagree about
 * what a legal count is.
 *
 * It lives in a store rather than in the component that steps it for the reason
 * the view mode does: the count is read by the scene, the HUD and the minimap
 * alike, and the stepper unmounts with its view. Every update that changes
 * nothing returns the previous state unchanged, as the other stores do.
 *
 * @returns A React hook selecting from {@link FloorCountState}.
 */
export const useFloorCountStore = create<FloorCountState>()((set) => ({
  floorCount: INITIAL_FLOOR_COUNT,
  increaseFloorCount: () =>
    set((state) => withFloorCount(state, state.floorCount + FLOOR_COUNT_STEP)),
  decreaseFloorCount: () =>
    set((state) => withFloorCount(state, state.floorCount - FLOOR_COUNT_STEP)),
  setFloorCount: (count) => set((state) => withFloorCount(state, count)),
}));

/**
 * Reads the storey count without subscribing to it.
 *
 * A published seam, not an internal: the frame loop and the camera rules need
 * the height of the stack without re-rendering on it, the same way
 * `getPlacementOrbitPose` is read.
 *
 * @returns The number of storeys currently displayed, 1…10.
 */
export function getFloorCount(): number {
  return useFloorCountStore.getState().floorCount;
}
