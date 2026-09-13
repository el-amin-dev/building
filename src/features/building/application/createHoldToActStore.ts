import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

/**
 * The empty action set, shared as the initial state of every hold-to-act store and reused
 * by `releaseAllActions`, so releasing twice keeps one identity.
 *
 * Never mutated: every update builds a new set. Typed `never` so the one instance serves
 * stores over any action vocabulary, and frozen so a caller cannot take the set out of a
 * store and hang state on it.
 */
const NO_ACTIONS: ReadonlySet<never> = Object.freeze(new Set<never>());

/**
 * State and actions of one hold-to-act control: the actions its viewer is holding down.
 *
 * @typeParam TAction - The control's action vocabulary, e.g. `EyeAction`.
 */
export interface HoldToActState<TAction extends string> {
  /**
   * The actions currently held on the control, by pointer, touch or keyboard. Replaced by
   * a new set on every change, never mutated in place.
   */
  readonly activeActions: ReadonlySet<TAction>;
  /** Starts holding an action. Holding one already held changes nothing. */
  readonly pressAction: (action: TAction) => void;
  /** Stops holding an action. Releasing one that is not held changes nothing. */
  readonly releaseAction: (action: TAction) => void;
  /**
   * Stops holding every action at once. The last resort against a stuck action: a held
   * turn the viewer can no longer release would spin the camera forever.
   */
  readonly releaseAllActions: () => void;
}

/**
 * A hold-to-act store: the React hook selecting from {@link HoldToActState}, with zustand's
 * imperative handle (`getState`, `setState`, `getInitialState`, `subscribe`) on it.
 *
 * Passed around as a value — `HoldPad` takes one as a prop — so a pad is bound to a
 * vocabulary and a store without knowing which.
 *
 * @typeParam TAction - The control's action vocabulary.
 */
export type HoldToActStore<TAction extends string> = UseBoundStore<
  StoreApi<HoldToActState<TAction>>
>;

/**
 * Creates a global store holding the actions one on-screen hold-to-act control is asking for.
 *
 * It is the on-screen counterpart of the held keys tracked by `usePressedKeys`: the
 * per-frame camera loop reads `activeActions` and passes it as the `extraActions` of the
 * navigation module's intent rule — `getMovementIntent` for the interior eye,
 * `getOrbitIntent` for the exterior orbit — so both input paths are merged by the same
 * domain rule in one call.
 *
 * Every update that changes nothing returns the previous state unchanged, so a repeated
 * press or a redundant release notifies no subscriber.
 *
 * One store per control rather than one shared store: the vocabularies are disjoint types,
 * the views a control belongs to are mutually exclusive, and `releaseAllActions` — the net
 * against a stuck action — has to be able to clear everything without knowing which actions
 * belong to which view.
 *
 * @typeParam TAction - The control's action vocabulary, e.g. `EyeAction`.
 * @returns A fresh {@link HoldToActStore} holding no action.
 */
export function createHoldToActStore<TAction extends string>(): HoldToActStore<TAction> {
  return create<HoldToActState<TAction>>()((set) => ({
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
}
