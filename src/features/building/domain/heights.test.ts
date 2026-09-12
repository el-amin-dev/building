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

  /*
   * THREE CASES DELETED HERE, with `windowSill` and `windowHead` themselves.
   * All three are unreachable: `FloorHeights` has no window fields to assert on
   * any more, and nothing reads a floor-wide sill or head, so there is nothing
   * left for a replacement case to pin. Every fact they used to state is now
   * either false or owned by the WINDOW SCHEDULE in `sourceOfTruth/plan.ts`, and
   * asserted in `windows.test.ts` per window:
   *
   * - `spans one window height between the sill and the head` proved
   *   `windowHead − windowSill === 1.20`, i.e. that every window on the floor was
   *   1.20 m tall. That is simply no longer true: the floor's windows are 1.20,
   *   0.80, 0.40 and 1.70 m tall, chosen per purpose;
   * - `puts the window head at the door height as a separate field` proved
   *   `windowHead === door` (both 2.10) while insisting the two stayed separate
   *   fields so that moving a window could never move a door. With the window
   *   fields gone that coincidence cannot arise, which is the stronger form of
   *   the same guarantee;
   * - `keeps the window opening between the floor and the top of the walls`
   *   proved `0 < windowSill < windowHead < wall` for the one floor-wide opening.
   *   The invariant still matters, but per window and against its own levels:
   *   `windows.ts` rejects a window whose head does not fit under `heights.wall`,
   *   and `windows.test.ts` covers that in `refuses a wall too low for the
   *   windows it must carry`.
   */
});
