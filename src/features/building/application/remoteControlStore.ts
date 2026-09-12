import { create } from 'zustand';
import type { EyeAction } from '../domain/eyeNavigation.ts';

/**
 * The empty action set, shared as the initial state and reused by `releaseAllActions`, so
 * releasing twice keeps one identity. Never mutated: every update builds a new set.
 */
const NO_ACTIONS: ReadonlySet<EyeAction> = new Set<EyeAction>();

/** State and actions of the on-screen remote control. */
export interface RemoteControlState {
  /**
   * The navigation actions currently held on the remote control, by pointer, touch or
   * keyboard. Replaced by a new set on every change, never mutated in place.
   */
  readonly activeActions: ReadonlySet<EyeAction>;
  /** Starts holding an action. Holding one already held changes nothing. */
  readonly pressAction: (action: EyeAction) => void;
  /** Stops holding an action. Releasing one that is not held changes nothing. */
  readonly releaseAction: (action: EyeAction) => void;
  /**
   * Stops holding every action at once. The last resort against a stuck action: a held
   * turn the viewer can no longer release would spin the camera forever.
   */
  readonly releaseAllActions: () => void;
}

/**
 * Global store holding the actions the on-screen remote control is asking for.
 *
 * It is the remote-control counterpart of the held keys tracked by `usePressedKeys`: the
 * per-frame camera loop reads `activeActions` and turns it into a movement intent with
 * `getIntentFromActions`, so both input paths go through the same domain rule.
 *
 * Every update that changes nothing returns the previous state unchanged, so a repeated
 * press or a redundant release notifies no subscriber.
 *
 * @returns A React hook selecting from {@link RemoteControlState}.
 */
export const useRemoteControlStore = create<RemoteControlState>()((set) => ({
  activeActions: NO_ACTIONS,
  pressAction: (action) =>
    set((state) =>
      state.activeActions.has(action)
        ? state
        : { activeActions: new Set(state.activeActions).add(action) },
    ),
  releaseAction: (action) =>
    set((state) => {
      if (!state.activeActions.has(action)) {
        return state;
      }
      const remaining = new Set(state.activeActions);
      remaining.delete(action);
      return { activeActions: remaining };
    }),
  releaseAllActions: () =>
    set((state) => (state.activeActions.size === 0 ? state : { activeActions: NO_ACTIONS })),
}));
