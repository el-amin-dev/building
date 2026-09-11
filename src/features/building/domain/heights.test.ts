import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from './heights.ts';

const ALTERED_EYE_HEIGHT = 9;

describe('heights', () => {
  it('exposes the unified vertical sizes in metres', () => {
    expect(FLOOR_HEIGHTS).toEqual({
      floorToFloor: 3.0,
      wall: 2.7,
      door: 2.1,
      railing: 1.1,
      eye: 1.6,
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FLOOR_HEIGHTS)).toBe(true);
  });

  it('rejects assignment and keeps its value', () => {
    const mutable = FLOOR_HEIGHTS as { eye: number };
    const originalEye = FLOOR_HEIGHTS.eye;

    expect(() => {
      mutable.eye = ALTERED_EYE_HEIGHT;
    }).toThrow(TypeError);
    expect(FLOOR_HEIGHTS.eye).toBe(originalEye);
  });

  it('orders railing below eye below door below wall below floor-to-floor', () => {
    expect(FLOOR_HEIGHTS.railing).toBeLessThan(FLOOR_HEIGHTS.eye);
    expect(FLOOR_HEIGHTS.eye).toBeLessThan(FLOOR_HEIGHTS.door);
    expect(FLOOR_HEIGHTS.door).toBeLessThan(FLOOR_HEIGHTS.wall);
    expect(FLOOR_HEIGHTS.wall).toBeLessThan(FLOOR_HEIGHTS.floorToFloor);
  });

  it('leaves a positive slab and structure allowance above the walls', () => {
    expect(FLOOR_HEIGHTS.floorToFloor - FLOOR_HEIGHTS.wall).toBeGreaterThan(0);
  });
});
