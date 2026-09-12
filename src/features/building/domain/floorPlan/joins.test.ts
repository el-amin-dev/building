import { describe, expect, it } from 'vitest';
import { makeRect } from '../planGeometry.ts';
import { FLOOR_PLAN } from './floorPlanData.ts';
import { getJoinThickness } from './joins.ts';
import { getSpace } from './queries.ts';
import type { FloorPlan, JoinOverride, Space, SpaceId, SpaceKind } from './types.ts';

const PARTITION_THICKNESS = 0.2;
const VOID_FACING_THICKNESS = 0.3;
const OVERRIDE_THICKNESS = 0.1;
const NO_WALL = 0;
const PLOT = makeRect(0, 15, 0, 8);
const INTERIOR = makeRect(0.3, 14.7, 0.3, 7.7);
const SOME_RECT = makeRect(1.0, 2.0, 1.0, 2.0);

/**
 * Builds a frozen space whose name is its id; joins do not depend on geometry.
 *
 * @param id - Identifier of the space.
 * @param kind - Kind of the space.
 * @returns A frozen {@link Space} with a single placeholder rect.
 */
function makeSpace(id: SpaceId, kind: SpaceKind): Space {
  return Object.freeze({ id, name: id, kind, rects: Object.freeze([SOME_RECT]) });
}

/**
 * Builds a frozen plan on the test plot.
 *
 * @param spaces - Spaces of the plan.
 * @param joinOverrides - Explicit join thicknesses.
 * @returns A frozen {@link FloorPlan}.
 */
function makePlan(spaces: readonly Space[], joinOverrides: readonly JoinOverride[]): FloorPlan {
  return Object.freeze({
    plot: PLOT,
    interior: INTERIOR,
    spaces: Object.freeze([...spaces]),
    joinOverrides: Object.freeze([...joinOverrides]),
  });
}

const ROOM = makeSpace('livingRoom', 'room');
const OTHER_ROOM = makeSpace('masterBedroom', 'room');
const CIRCULATION = makeSpace('corridor', 'circulation');
const OPEN_AIR = makeSpace('balconyA', 'openAir');
const VOID = makeSpace('voidWest', 'void');
const SPACES = [ROOM, OTHER_ROOM, CIRCULATION, OPEN_AIR, VOID];
const PLAIN_PLAN = makePlan(SPACES, []);
const OVERRIDDEN_PLAN = makePlan(SPACES, [
  { spaces: ['balconyA', 'livingRoom'], thickness: OVERRIDE_THICKNESS, reason: 'test override' },
]);

describe('getJoinThickness', () => {
  it.each([
    ['room', 'room', ROOM, OTHER_ROOM, PARTITION_THICKNESS],
    ['room', 'circulation', ROOM, CIRCULATION, PARTITION_THICKNESS],
    ['room', 'openAir', ROOM, OPEN_AIR, VOID_FACING_THICKNESS],
    ['room', 'void', ROOM, VOID, VOID_FACING_THICKNESS],
    ['circulation', 'openAir', CIRCULATION, OPEN_AIR, VOID_FACING_THICKNESS],
    ['openAir', 'void', OPEN_AIR, VOID, VOID_FACING_THICKNESS],
  ])('joins %s and %s with %s', (_kindA, _kindB, a, b, expected) => {
    expect(getJoinThickness(PLAIN_PLAN, a, b)).toBe(expected);
    expect(getJoinThickness(PLAIN_PLAN, b, a)).toBe(expected);
  });

  it('lets an override win over the default', () => {
    expect(getJoinThickness(OVERRIDDEN_PLAN, ROOM, OPEN_AIR)).toBe(OVERRIDE_THICKNESS);
  });

  it('matches an override in either argument order', () => {
    expect(getJoinThickness(OVERRIDDEN_PLAN, OPEN_AIR, ROOM)).toBe(OVERRIDE_THICKNESS);
  });

  it('keeps the default for joins the override does not name', () => {
    expect(getJoinThickness(OVERRIDDEN_PLAN, OPEN_AIR, CIRCULATION)).toBe(VOID_FACING_THICKNESS);
  });

  it('throws a RangeError naming a space joined with itself', () => {
    const copy = makeSpace('livingRoom', 'room');

    expect(() => getJoinThickness(PLAIN_PLAN, ROOM, ROOM)).toThrow(RangeError);
    expect(() => getJoinThickness(PLAIN_PLAN, ROOM, copy)).toThrow('livingRoom');
  });

  describe('on FLOOR_PLAN', () => {
    it.each([
      ['stairs', 'corridor', NO_WALL],
      ['voidEast', 'utilityRoom', PARTITION_THICKNESS],
      ['kitchen', 'balconySlabB', VOID_FACING_THICKNESS],
    ] as const)('joins %s and %s with %s', (idA, idB, expected) => {
      const a = getSpace(FLOOR_PLAN, idA);
      const b = getSpace(FLOOR_PLAN, idB);

      expect(getJoinThickness(FLOOR_PLAN, a, b)).toBe(expected);
    });
  });
});
