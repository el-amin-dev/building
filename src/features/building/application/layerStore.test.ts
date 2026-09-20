import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanServiceLayerKey } from '../domain/sourceOfTruth/plan.ts';
import { SERVICE_LAYERS } from '../domain/sourceOfTruth/plan.ts';
import { getShownLayers, isLayerShown, useLayerStore } from './layerStore.ts';

/** The first layer of the plan, whichever it is: the tests name no layer of their own. */
const A_LAYER: PlanServiceLayerKey = SERVICE_LAYERS[0].key;

/** A second, different layer, to prove one tick leaves the others alone. */
const ANOTHER_LAYER: PlanServiceLayerKey = SERVICE_LAYERS[1].key;

/** A key no layer answers to, cast past the checker to reach the runtime guard. */
const UNKNOWN_LAYER = 'sprinklers' as PlanServiceLayerKey;

/** Ticks every layer through the single-layer action, so the all-on state is really reached. */
function showEveryLayer(): void {
  for (const layer of SERVICE_LAYERS) {
    useLayerStore.getState().setLayer(layer.key, true);
  }
}

describe('useLayerStore', () => {
  beforeEach(() => {
    useLayerStore.setState(useLayerStore.getInitialState(), true);
  });

  it('starts with every layer off, showing the naked walls', () => {
    expect(Object.values(useLayerStore.getState().shown)).toEqual(SERVICE_LAYERS.map(() => false));
  });

  it('holds one flag per layer of the plan, in the plan order', () => {
    expect(Object.keys(useLayerStore.getState().shown)).toEqual(
      SERVICE_LAYERS.map((layer) => layer.key),
    );
  });

  it('hands out a frozen record', () => {
    expect(Object.isFrozen(useLayerStore.getState().shown)).toBe(true);
  });

  describe('toggleLayer', () => {
    it('ticks a layer that is off', () => {
      useLayerStore.getState().toggleLayer(A_LAYER);

      expect(useLayerStore.getState().shown[A_LAYER]).toBe(true);
    });

    it('unticks a layer that is on', () => {
      useLayerStore.getState().toggleLayer(A_LAYER);

      useLayerStore.getState().toggleLayer(A_LAYER);

      expect(useLayerStore.getState().shown[A_LAYER]).toBe(false);
    });

    it('leaves the other layers alone', () => {
      useLayerStore.getState().toggleLayer(A_LAYER);

      expect(useLayerStore.getState().shown[ANOTHER_LAYER]).toBe(false);
    });

    it('notifies a subscriber, because a toggle always changes something', () => {
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      useLayerStore.getState().toggleLayer(A_LAYER);
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('rejects a key no layer answers to', () => {
      expect(() => {
        useLayerStore.getState().toggleLayer(UNKNOWN_LAYER);
      }).toThrow(RangeError);
    });
  });

  describe('setLayer', () => {
    it('shows a layer', () => {
      useLayerStore.getState().setLayer(A_LAYER, true);

      expect(useLayerStore.getState().shown[A_LAYER]).toBe(true);
    });

    it('hides a layer again', () => {
      useLayerStore.getState().setLayer(A_LAYER, true);

      useLayerStore.getState().setLayer(A_LAYER, false);

      expect(useLayerStore.getState().shown[A_LAYER]).toBe(false);
    });

    it('keeps the very state object when the layer is already as asked', () => {
      useLayerStore.getState().setLayer(A_LAYER, true);
      const before = useLayerStore.getState();

      useLayerStore.getState().setLayer(A_LAYER, true);

      expect(Object.is(useLayerStore.getState(), before)).toBe(true);
    });

    it('notifies nobody when the layer is already as asked', () => {
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      useLayerStore.getState().setLayer(A_LAYER, false);
      unsubscribe();

      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies a subscriber when the layer does change', () => {
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      useLayerStore.getState().setLayer(A_LAYER, true);
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('rejects a key no layer answers to, naming it and the valid ones', () => {
      expect(() => {
        useLayerStore.getState().setLayer(UNKNOWN_LAYER, true);
      }).toThrow(RangeError);

      expect(() => {
        useLayerStore.getState().setLayer(UNKNOWN_LAYER, true);
      }).toThrow(/sprinklers/);

      expect(() => {
        useLayerStore.getState().setLayer(UNKNOWN_LAYER, true);
      }).toThrow(new RegExp(String(SERVICE_LAYERS[0].key)));
    });
  });

  describe('showAllLayers', () => {
    it('ticks every layer', () => {
      useLayerStore.getState().showAllLayers();

      expect(Object.values(useLayerStore.getState().shown)).toEqual(SERVICE_LAYERS.map(() => true));
    });

    it('keeps the very state object when everything is already on', () => {
      showEveryLayer();
      const before = useLayerStore.getState();

      useLayerStore.getState().showAllLayers();

      expect(Object.is(useLayerStore.getState(), before)).toBe(true);
    });

    it('notifies nobody when everything is already on', () => {
      showEveryLayer();
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      useLayerStore.getState().showAllLayers();
      unsubscribe();

      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies a subscriber when a layer was still off', () => {
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      useLayerStore.getState().showAllLayers();
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('hideAllLayers', () => {
    it('unticks every layer', () => {
      showEveryLayer();

      useLayerStore.getState().hideAllLayers();

      expect(Object.values(useLayerStore.getState().shown)).toEqual(
        SERVICE_LAYERS.map(() => false),
      );
    });

    it('keeps the very state object when nothing is on', () => {
      const before = useLayerStore.getState();

      useLayerStore.getState().hideAllLayers();

      expect(Object.is(useLayerStore.getState(), before)).toBe(true);
    });

    it('notifies nobody when nothing is on', () => {
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      useLayerStore.getState().hideAllLayers();
      unsubscribe();

      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies a subscriber when a layer was on', () => {
      useLayerStore.getState().setLayer(A_LAYER, true);
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      useLayerStore.getState().hideAllLayers();
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('getShownLayers', () => {
    it('reads the current record', () => {
      useLayerStore.getState().setLayer(A_LAYER, true);

      expect(getShownLayers()[A_LAYER]).toBe(true);
    });

    it('reads without subscribing', () => {
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      getShownLayers();
      unsubscribe();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('isLayerShown', () => {
    it('answers for a layer that is off', () => {
      expect(isLayerShown(A_LAYER)).toBe(false);
    });

    it('answers for a layer that is on', () => {
      useLayerStore.getState().setLayer(A_LAYER, true);

      expect(isLayerShown(A_LAYER)).toBe(true);
    });

    it('reads without subscribing', () => {
      const listener = vi.fn();
      const unsubscribe = useLayerStore.subscribe(listener);

      isLayerShown(A_LAYER);
      unsubscribe();

      expect(listener).not.toHaveBeenCalled();
    });

    it('rejects a key no layer answers to', () => {
      expect(() => isLayerShown(UNKNOWN_LAYER)).toThrow(RangeError);
    });
  });
});
