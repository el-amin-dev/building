import { create } from 'zustand';
import type { PlanServiceLayerKey } from '../domain/sourceOfTruth/plan.ts';
import { SERVICE_LAYERS } from '../domain/sourceOfTruth/plan.ts';

/** Which build layers are drawn: one flag per layer of the plan, never a partial record. */
export type ShownLayers = Readonly<Record<PlanServiceLayerKey, boolean>>;

/**
 * The layer keys, in the order the plan lists them — the order the checkboxes take.
 *
 * Read from `SERVICE_LAYERS` rather than written out here: a tenth layer added to the
 * source of truth appears in the store, in the initial record and in the error message
 * below with no edit to this file.
 */
const LAYER_KEYS: readonly PlanServiceLayerKey[] = SERVICE_LAYERS.map((layer) => layer.key);

/**
 * Builds the record that says the same thing about every layer.
 *
 * @param shown - Whether every layer is drawn.
 * @returns A frozen flag per layer of {@link SERVICE_LAYERS}.
 */
function everyLayer(shown: boolean): ShownLayers {
  const record = {} as Record<PlanServiceLayerKey, boolean>;
  for (const key of LAYER_KEYS) {
    record[key] = shown;
  }
  return Object.freeze(record);
}

/**
 * The naked building: no layer ticked.
 *
 * The initial state and the answer `hideAllLayers` hands back, so hiding everything twice
 * keeps one identity — the same trick `NO_ACTIONS` plays in `createHoldToActStore`.
 */
const NO_LAYERS_SHOWN: ShownLayers = everyLayer(false);

/** Every layer ticked, shared by `showAllLayers` for the same reason. */
const ALL_LAYERS_SHOWN: ShownLayers = everyLayer(true);

/**
 * Rejects anything that is not a layer of the plan.
 *
 * @param key - The key to check.
 * @throws RangeError naming the key and listing the valid ones.
 */
function assertLayerKey(key: PlanServiceLayerKey): void {
  if (!Object.hasOwn(NO_LAYERS_SHOWN, key)) {
    throw new RangeError(`layer must be one of ${LAYER_KEYS.join(', ')}, got "${String(key)}"`);
  }
}

/** State and actions of the build layers. */
export interface LayerState {
  /**
   * Whether each layer is drawn. Every layer is off to begin with: the building shows its
   * naked walls until a checkbox is ticked. Replaced by a new frozen record on every
   * change, never mutated in place.
   */
  readonly shown: ShownLayers;
  /** Ticks a layer that is off, unticks one that is on. */
  readonly toggleLayer: (key: PlanServiceLayerKey) => void;
  /** Sets one layer; asking for the state it is already in changes nothing. */
  readonly setLayer: (key: PlanServiceLayerKey, shown: boolean) => void;
  /** Ticks every layer at once; a no-op when they are all ticked already. */
  readonly showAllLayers: () => void;
  /** Unticks every layer at once, back to the naked walls; a no-op when none is ticked. */
  readonly hideAllLayers: () => void;
}

/** The part of the state an update may replace: the record and nothing else. */
type LayerUpdate = Pick<LayerState, 'shown'>;

/**
 * Applies a requested flag to one layer, or keeps the state exactly as it was.
 *
 * Returning the previous state *object* — not an equal copy of it — is what makes a
 * redundant tick free: zustand compares identity, so no subscriber is notified for a
 * change that changed nothing, and the frame loop reading `shown` sees the same record.
 *
 * @param state - The current state.
 * @param key - The layer to set.
 * @param shown - Whether it is to be drawn.
 * @returns The previous state when the layer is already in that state, otherwise a new
 *   frozen record.
 * @throws RangeError when `key` is not a layer of the plan.
 */
function withLayer(
  state: LayerState,
  key: PlanServiceLayerKey,
  shown: boolean,
): LayerState | LayerUpdate {
  assertLayerKey(key);
  return state.shown[key] === shown
    ? state
    : { shown: Object.freeze({ ...state.shown, [key]: shown }) };
}

/**
 * Applies a requested flag to every layer at once, or keeps the state exactly as it was.
 *
 * @param state - The current state.
 * @param shown - Whether every layer is to be drawn.
 * @returns The previous state when every layer is already in that state, otherwise the
 *   shared all-on or all-off record.
 */
function withEveryLayer(state: LayerState, shown: boolean): LayerState | LayerUpdate {
  const alreadyThere = LAYER_KEYS.every((key) => state.shown[key] === shown);
  return alreadyThere ? state : { shown: shown ? ALL_LAYERS_SHOWN : NO_LAYERS_SHOWN };
}

/**
 * Global store holding which build layers are drawn over the naked building.
 *
 * The store holds no layer list of its own: the keys, their order and their labels all
 * come from `domain/sourceOfTruth/plan.ts`, so the checkbox panel that ticks a layer, the
 * scene that draws it and this store cannot disagree about which layers exist.
 *
 * It lives in a store rather than in the panel that ticks it for the reason the storey
 * count does: the flags are read by the scene and the HUD alike, and the panel unmounts
 * with its view. Every update that changes nothing returns the previous state unchanged,
 * as the other stores do.
 *
 * @returns A React hook selecting from {@link LayerState}.
 */
export const useLayerStore = create<LayerState>()((set) => ({
  shown: NO_LAYERS_SHOWN,
  toggleLayer: (key) =>
    set((state) => {
      assertLayerKey(key);
      return withLayer(state, key, !state.shown[key]);
    }),
  setLayer: (key, shown) => set((state) => withLayer(state, key, shown)),
  showAllLayers: () => set((state) => withEveryLayer(state, true)),
  hideAllLayers: () => set((state) => withEveryLayer(state, false)),
}));

/**
 * Reads which layers are drawn without subscribing to them.
 *
 * A published seam, not an internal: the frame loop needs to know what to draw without
 * re-rendering on it, the same way `getFloorCount` is read.
 *
 * @returns The frozen flag-per-layer record currently held.
 */
export function getShownLayers(): ShownLayers {
  return useLayerStore.getState().shown;
}

/**
 * Reads whether one layer is drawn, without subscribing to it.
 *
 * @param key - The layer to read.
 * @returns Whether that layer is currently drawn.
 * @throws RangeError when `key` is not a layer of the plan.
 */
export function isLayerShown(key: PlanServiceLayerKey): boolean {
  assertLayerKey(key);
  return useLayerStore.getState().shown[key];
}
