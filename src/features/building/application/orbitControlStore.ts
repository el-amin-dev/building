import { createHoldToActStore } from './createHoldToActStore.ts';
import type { HoldToActState } from './createHoldToActStore.ts';
import type { OrbitAction } from '../domain/orbitNavigation.ts';

/** State and actions of the on-screen orbit pad; see {@link HoldToActState}. */
export type OrbitControlState = HoldToActState<OrbitAction>;

/**
 * Global store holding the actions the on-screen orbit pad is asking for.
 *
 * One instance of the shared hold-to-act store, over the exterior orbit's action vocabulary:
 * the per-frame camera loop reads `activeActions` and turns it into an orbit intent with
 * `getOrbitIntent`, so the pad and the arrow/zoom keys go through the same domain rule. See
 * {@link createHoldToActStore} for the update semantics.
 *
 * Separate from `useRemoteControlStore` rather than merged with it: the two vocabularies are
 * disjoint types, at most one of the two views is showing at a time, and each pad's
 * `releaseAllActions` net must be able to clear everything it owns without reaching into the
 * other view's actions.
 *
 * @returns A React hook selecting from {@link OrbitControlState}.
 */
export const useOrbitControlStore = createHoldToActStore<OrbitAction>();
