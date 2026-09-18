import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { getFloorCount, useFloorCountStore } from './floorCountStore.ts';

/** Presses the stepper until the stack is as tall as it can be. */
function raiseToMaximum(): void {
  while (getFloorCount() < MAX_FLOOR_COUNT) {
    useFloorCountStore.getState().increaseFloorCount();
  }
}

describe('useFloorCountStore', () => {
  beforeEach(() => {
    useFloorCountStore.setState(useFloorCountStore.getInitialState(), true);
  });

  it('starts with the one designed floor', () => {
    expect(useFloorCountStore.getState().floorCount).toBe(MIN_FLOOR_COUNT);
  });

  it('adds one storey per press', () => {
    useFloorCountStore.getState().increaseFloorCount();
    expect(useFloorCountStore.getState().floorCount).toBe(2);

    useFloorCountStore.getState().increaseFloorCount();
    expect(useFloorCountStore.getState().floorCount).toBe(3);
  });

  it('removes one storey per press', () => {
    useFloorCountStore.getState().setFloorCount(4);

    useFloorCountStore.getState().decreaseFloorCount();

    expect(useFloorCountStore.getState().floorCount).toBe(3);
  });

  it('reaches the maximum in nine presses', () => {
    for (let press = MIN_FLOOR_COUNT; press < MAX_FLOOR_COUNT; press += 1) {
      useFloorCountStore.getState().increaseFloorCount();
    }

    expect(useFloorCountStore.getState().floorCount).toBe(MAX_FLOOR_COUNT);
  });

  it('keeps the very state object when pressed past the maximum', () => {
    raiseToMaximum();
    const before = useFloorCountStore.getState();

    useFloorCountStore.getState().increaseFloorCount();

    expect(Object.is(useFloorCountStore.getState(), before)).toBe(true);
  });

  it('notifies nobody when pressed past the maximum', () => {
    raiseToMaximum();
    const listener = vi.fn();
    const unsubscribe = useFloorCountStore.subscribe(listener);

    useFloorCountStore.getState().increaseFloorCount();
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the very state object when pressed below the minimum', () => {
    const before = useFloorCountStore.getState();

    useFloorCountStore.getState().decreaseFloorCount();

    expect(useFloorCountStore.getState().floorCount).toBe(MIN_FLOOR_COUNT);
    expect(Object.is(useFloorCountStore.getState(), before)).toBe(true);
  });

  it('notifies nobody when pressed below the minimum', () => {
    const listener = vi.fn();
    const unsubscribe = useFloorCountStore.subscribe(listener);

    useFloorCountStore.getState().decreaseFloorCount();
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies a subscriber when the count does change', () => {
    const listener = vi.fn();
    const unsubscribe = useFloorCountStore.subscribe(listener);

    useFloorCountStore.getState().increaseFloorCount();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  describe('setFloorCount', () => {
    it('rounds a fractional count', () => {
      useFloorCountStore.getState().setFloorCount(4.6);

      expect(useFloorCountStore.getState().floorCount).toBe(5);
    });

    it('clamps below the minimum', () => {
      useFloorCountStore.getState().setFloorCount(0);

      expect(useFloorCountStore.getState().floorCount).toBe(MIN_FLOOR_COUNT);
    });

    it('clamps above the maximum', () => {
      useFloorCountStore.getState().setFloorCount(99);

      expect(useFloorCountStore.getState().floorCount).toBe(MAX_FLOOR_COUNT);
    });

    it('keeps the very state object when the count is already the one asked for', () => {
      useFloorCountStore.getState().setFloorCount(4);
      const before = useFloorCountStore.getState();

      useFloorCountStore.getState().setFloorCount(4);

      expect(Object.is(useFloorCountStore.getState(), before)).toBe(true);
    });

    it('rejects a count that is not finite', () => {
      expect(() => {
        useFloorCountStore.getState().setFloorCount(Number.NaN);
      }).toThrow(RangeError);
    });
  });

  describe('getFloorCount', () => {
    it('reads the current count', () => {
      useFloorCountStore.getState().setFloorCount(6);

      expect(getFloorCount()).toBe(6);
    });

    it('reads without subscribing', () => {
      const listener = vi.fn();
      const unsubscribe = useFloorCountStore.subscribe(listener);

      getFloorCount();
      unsubscribe();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
