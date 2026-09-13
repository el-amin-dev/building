import { describe, expect, it } from 'vitest';
import { getCurrentSpace } from './currentSpace.ts';
import { FLOOR_PLAN, findSpaceAt, getSpace } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import type { PlanPoint } from './planGeometry.ts';

/** A point at the centre of a room, and the space it must resolve to. */
interface Centre {
  readonly id: SpaceId;
  readonly point: PlanPoint;
}

/**
 * One centre per kind of space that has a floor: two rooms, the stairwell (mapped to
 * `circulation`), the corridor and a balcony (`openAir`, which is walkable and therefore a
 * room the readout may name).
 */
const CENTRES: readonly Centre[] = [
  { id: 'masterBedroom', point: { x: 4.1, z: 2.0 } },
  { id: 'kitchen', point: { x: 11.1, z: 7.45 } },
  { id: 'stairs', point: { x: 3.6, z: 5.0 } },
  { id: 'corridor', point: { x: 10.0, z: 4.75 } },
  { id: 'balconyA', point: { x: 0.8, z: 5.0 } },
];

/** Inside the 0.30 m wall between the master bedroom (to x 6.60) and the living room (from x 6.90). */
const IN_BEDROOM_LIVING_WALL: PlanPoint = { x: 6.75, z: 2.0 };

/** Inside `voidWest` (x 4.90–11.65, z 8.90–9.70), which has no floor to stand on. */
const IN_VOID_WEST: PlanPoint = { x: 8.0, z: 9.3 };

/** Outside the plot altogether, where no space and no wall covers the point. */
const OUTSIDE_PLOT: PlanPoint = { x: 30.0, z: 30.0 };

/**
 * The zero-gap join at x 5.60: the stairwell runs to it and the corridor starts at it.
 * `findSpaceAt` is half-open, so the point belongs to the space on the + side.
 */
const ON_STAIRS_CORRIDOR_JOIN: PlanPoint = { x: 5.6, z: 4.5 };

const PREVIOUS_ID: SpaceId = 'livingRoom';
const PREVIOUS = getSpace(FLOOR_PLAN, PREVIOUS_ID);

describe('getCurrentSpace', () => {
  it.each(CENTRES)('resolves the space at the centre of $id', ({ id, point }) => {
    expect(getCurrentSpace(FLOOR_PLAN, point)).toBe(getSpace(FLOOR_PLAN, id));
  });

  it.each(CENTRES)(
    'prefers the space under the point over the previous one in $id',
    ({ id, point }) => {
      expect(getCurrentSpace(FLOOR_PLAN, point, PREVIOUS)).toBe(getSpace(FLOOR_PLAN, id));
    },
  );

  it('keeps the previous space inside the wall between the master bedroom and the living room', () => {
    expect(findSpaceAt(FLOOR_PLAN, IN_BEDROOM_LIVING_WALL)).toBeUndefined();

    expect(getCurrentSpace(FLOOR_PLAN, IN_BEDROOM_LIVING_WALL, PREVIOUS)).toBe(PREVIOUS);
  });

  it('keeps the previous space over the void, and never names the void itself', () => {
    expect(findSpaceAt(FLOOR_PLAN, IN_VOID_WEST)).toBe(getSpace(FLOOR_PLAN, 'voidWest'));

    expect(getCurrentSpace(FLOOR_PLAN, IN_VOID_WEST, PREVIOUS)).toBe(PREVIOUS);
  });

  it('keeps the previous space outside the plot', () => {
    expect(getCurrentSpace(FLOOR_PLAN, OUTSIDE_PLOT, PREVIOUS)).toBe(PREVIOUS);
  });

  it.each([IN_BEDROOM_LIVING_WALL, IN_VOID_WEST, OUTSIDE_PLOT])(
    'answers "unknown" with no previous space at (%o)',
    (point) => {
      expect(getCurrentSpace(FLOOR_PLAN, point)).toBeUndefined();
    },
  );

  it('agrees with findSpaceAt on the half-open join at x 5.60', () => {
    const located = findSpaceAt(FLOOR_PLAN, ON_STAIRS_CORRIDOR_JOIN);

    expect(located).toBe(getSpace(FLOOR_PLAN, 'corridor'));
    expect(getCurrentSpace(FLOOR_PLAN, ON_STAIRS_CORRIDOR_JOIN, PREVIOUS)).toBe(located);
  });

  it('takes a full eye pose, whose extra fields it ignores', () => {
    const pose = { x: 11.1, z: 7.45, yaw: 1.5, pitch: -0.2 };

    expect(getCurrentSpace(FLOOR_PLAN, pose)).toBe(getSpace(FLOOR_PLAN, 'kitchen'));
  });

  it.each([
    { x: Number.NaN, z: 0 },
    { x: 0, z: Number.POSITIVE_INFINITY },
  ])('throws on the non-finite point (%o)', (point) => {
    expect(() => getCurrentSpace(FLOOR_PLAN, point, PREVIOUS)).toThrow(RangeError);
  });
});
