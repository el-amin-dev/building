import { createHoldToActStore } from './createHoldToActStore.ts';
import type { HoldToActState } from './createHoldToActStore.ts';
import type { EyeAction } from '../domain/eyeNavigation.ts';

/** State and actions of the on-screen remote control; see {@link HoldToActState}. */
export type RemoteControlState = HoldToActState<EyeAction>;

/**
 * Global store holding the actions the on-screen remote control is asking for.
 *
 * One instance of the shared hold-to-act store, over the interior eye's action vocabulary:
 * the per-frame camera loop reads `activeActions` and turns it into a movement intent with
 * `getIntentFromActions`, so the remote control and the keyboard go through the same domain
 * rule. See {@link createHoldToActStore} for the update semantics.
 *
 * @returns A React hook selecting from {@link RemoteControlState}.
 */
export const useRemoteControlStore = createHoldToActStore<EyeAction>();
