import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from './heights.ts';

const EXPECTED_FLOOR_TO_FLOOR = 3.0;
const EXPECTED_WALL = 2.7;
const EXPECTED_DOOR = 2.1;
const EXPECTED_RAILING = 1.1;
const ALTERED_WALL_HEIGHT = 9;

describe('heights', () => {
  it('exposes the unified vertical sizes in metres', () => {
    expect(FLOOR_HEIGHTS).toEqual({
      floorToFloor: EXPECTED_FLOOR_TO_FLOOR,
      wall: EXPECTED_WALL,
      door: EXPECTED_DOOR,
      railing: EXPECTED_RAILING,
    });
  });

  it('holds building dimensions only, not the eye height', () => {
    expect(Object.hasOwn(FLOOR_HEIGHTS, 'eye')).toBe(false);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FLOOR_HEIGHTS)).toBe(true);
  });

  it('rejects assignment and keeps its value', () => {
    const mutable = FLOOR_HEIGHTS as { wall: number };

    expect(() => {
      mutable.wall = ALTERED_WALL_HEIGHT;
    }).toThrow(TypeError);
    expect(FLOOR_HEIGHTS.wall).toBe(EXPECTED_WALL);
  });

  it('orders railing below door below wall below floor-to-floor', () => {
    expect(FLOOR_HEIGHTS.railing).toBeLessThan(FLOOR_HEIGHTS.door);
    expect(FLOOR_HEIGHTS.door).toBeLessThan(FLOOR_HEIGHTS.wall);
    expect(FLOOR_HEIGHTS.wall).toBeLessThan(FLOOR_HEIGHTS.floorToFloor);
  });

  it('leaves a positive slab and structure allowance above the walls', () => {
    expect(FLOOR_HEIGHTS.floorToFloor - FLOOR_HEIGHTS.wall).toBeGreaterThan(0);
  });
});
