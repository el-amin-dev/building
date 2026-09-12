import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from './heights.ts';

const PRECISION_DIGITS = 9;
const EXPECTED_FLOOR_TO_FLOOR = 3.0;
const EXPECTED_WALL = 2.7;
const EXPECTED_DOOR = 2.1;
const EXPECTED_RAILING = 1.1;
const EXPECTED_WINDOW_SILL = 0.9;
const EXPECTED_WINDOW_HEAD = 2.1;
/** Vertical size of a window opening: 1.20 m everywhere (owner answer, ADR-006). */
const WINDOW_HEIGHT = 1.2;
const FLOOR_LEVEL = 0;
const ALTERED_WALL_HEIGHT = 9;

describe('heights', () => {
  it('exposes the unified vertical sizes in metres', () => {
    expect(FLOOR_HEIGHTS).toEqual({
      floorToFloor: EXPECTED_FLOOR_TO_FLOOR,
      wall: EXPECTED_WALL,
      door: EXPECTED_DOOR,
      railing: EXPECTED_RAILING,
      windowSill: EXPECTED_WINDOW_SILL,
      windowHead: EXPECTED_WINDOW_HEAD,
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

  it('spans one window height between the sill and the head', () => {
    expect(FLOOR_HEIGHTS.windowHead - FLOOR_HEIGHTS.windowSill).toBeCloseTo(
      WINDOW_HEIGHT,
      PRECISION_DIGITS,
    );
  });

  it('puts the window head at the door height as a separate field', () => {
    expect(FLOOR_HEIGHTS.windowHead).toBe(FLOOR_HEIGHTS.door);
    expect(Object.hasOwn(FLOOR_HEIGHTS, 'windowHead')).toBe(true);
  });

  it('keeps the window opening between the floor and the top of the walls', () => {
    expect(FLOOR_HEIGHTS.windowSill).toBeGreaterThan(FLOOR_LEVEL);
    expect(FLOOR_HEIGHTS.windowSill).toBeLessThan(FLOOR_HEIGHTS.windowHead);
    expect(FLOOR_HEIGHTS.windowHead).toBeLessThan(FLOOR_HEIGHTS.wall);
  });
});
