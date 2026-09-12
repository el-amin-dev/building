import { describe, expect, it } from 'vitest';
import {
  FLOOR_PLAN,
  findSpaceAt,
  getNeighbours,
  hasFloor,
  validateFloorPlan,
} from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { LENGTH_TOLERANCE, makeRect } from './planGeometry.ts';
import type { PlanPoint } from './planGeometry.ts';
import { PORT_SCHEDULE, validatePorts } from './ports/index.ts';
import { getReachableSpaceIds } from './reachability.ts';

/** Where the stairs deliver the explorer onto this floor: the stairs centre. */
const STAIRS_ARRIVAL: PlanPoint = Object.freeze({ x: 4.65, z: 4.65 });

/** A point inside the side-A wall (x 1.30–1.60), away from any door. */
const INSIDE_A_WALL: PlanPoint = Object.freeze({ x: 1.45, z: 2.0 });

/** A point in the west void, which has no floor to stand on. */
const INSIDE_VOID_WEST: PlanPoint = Object.freeze({ x: 6.0, z: 9.2 });

/** A point on the walkable side-B balcony slab. */
const ON_BALCONY_SLAB: PlanPoint = Object.freeze({ x: 14.45, z: 9.2 });

/** New east face of the stairs in the variant that breaks the corridor join, in metres. */
const SHORTENED_STAIRS_MAX_X = 5.1;

const EXPECTED_REACHABLE_COUNT = 16;
const LAUNDRY_PORT_COUNT = 3;

/** The two spaces with no floor: open to the sky (brief §5.2). */
const VOID_IDS: readonly SpaceId[] = ['voidWest', 'voidEast'];

/**
 * Every space an explorer can walk to on this floor, written out by hand: all
 * 18 spaces of the plan except the two voids. The stairs, the corridor and the
 * link corridor tie the three rows together, so the floor is one component.
 */
const EXPECTED_REACHABLE_IDS: readonly SpaceId[] = [
  'balconyA',
  'masterBedroom',
  'livingRoom',
  'bedroomMaleKids',
  'bedroomFemaleKids',
  'stairs',
  'corridor',
  'linkCorridor',
  'controlCenter',
  'guestRoom',
  'guestSanitair',
  'kitchen',
  'laundry',
  'mainSanitair',
  'utilityRoom',
  'balconySlabB',
];

/**
 * Builds a copy of the plan whose stairs stop short of the corridor, so the two
 * no longer join with a zero gap.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param maxX - New east face of the stairs, in metres.
 * @returns A new plan with a shortened stairs space.
 */
function withStairsShortened(plan: FloorPlan, maxX: number): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) =>
      space.id === 'stairs'
        ? {
            ...space,
            rects: space.rects.map((rect) => makeRect(rect.minX, maxX, rect.minZ, rect.maxZ)),
          }
        : space,
    ),
  };
}

/**
 * Tells whether two spaces of a plan join anywhere with no wall between them.
 *
 * @param plan - The plan to inspect.
 * @param id - One space.
 * @param neighbourId - The other space.
 * @returns `true` when a contact between them has a zero gap.
 */
function joinsWithNoWall(plan: FloorPlan, id: SpaceId, neighbourId: SpaceId): boolean {
  return getNeighbours(plan, id).some(
    (contact) => contact.neighbourId === neighbourId && contact.gap <= LENGTH_TOLERANCE,
  );
}

/**
 * Returns the reachable ids from the stairs arrival point, sorted.
 *
 * @param plan - The plan to walk.
 * @param ports - The port schedule to walk.
 * @returns The reachable ids, sorted.
 */
function reachableFromStairs(plan: FloorPlan, ports = PORT_SCHEDULE): readonly SpaceId[] {
  return [...getReachableSpaceIds(plan, ports, STAIRS_ARRIVAL)].sort();
}

describe('getReachableSpaceIds', () => {
  it('lists every floor space of the plan as expected, and neither void', () => {
    const floorIds = FLOOR_PLAN.spaces
      .filter((space) => hasFloor(space.kind))
      .map((space) => space.id);

    expect([...EXPECTED_REACHABLE_IDS].sort()).toEqual([...floorIds].sort());
    expect(EXPECTED_REACHABLE_IDS).toHaveLength(EXPECTED_REACHABLE_COUNT);
  });

  it('resolves the stairs arrival point to the stairs space', () => {
    expect(findSpaceAt(FLOOR_PLAN, STAIRS_ARRIVAL)?.id).toBe('stairs');
  });

  it('reaches all sixteen floor spaces from the stairs arrival point', () => {
    expect(reachableFromStairs(FLOOR_PLAN)).toEqual([...EXPECTED_REACHABLE_IDS].sort());
  });

  it.each(VOID_IDS)('never reaches %s, which has no floor', (id) => {
    expect(getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_ARRIVAL).has(id)).toBe(false);
  });

  it('keeps the balcony slab from leaking into the voids it shares its strip with', () => {
    const fromSlab = getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, ON_BALCONY_SLAB);

    expect(joinsWithNoWall(FLOOR_PLAN, 'balconySlabB', 'voidWest')).toBe(true);
    expect(joinsWithNoWall(FLOOR_PLAN, 'balconySlabB', 'voidEast')).toBe(true);
    expect([...fromSlab].sort()).toEqual([...EXPECTED_REACHABLE_IDS].sort());
  });

  it('freezes the returned set', () => {
    expect(Object.isFrozen(getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_ARRIVAL))).toBe(
      true,
    );
  });

  it('starts the walk in the space holding the point', () => {
    const reached = getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_ARRIVAL);

    expect([...reached][0]).toBe('stairs');
  });

  describe('when the laundry loses its three ports', () => {
    const withoutLaundryPorts = PORT_SCHEDULE.filter((port) => !port.spaces.includes('laundry'));

    it('drops exactly three ports from the schedule', () => {
      expect(PORT_SCHEDULE.length - withoutLaundryPorts.length).toBe(LAUNDRY_PORT_COUNT);
    });

    it('drops only the laundry from the reachable set', () => {
      expect(reachableFromStairs(FLOOR_PLAN, withoutLaundryPorts)).toEqual(
        EXPECTED_REACHABLE_IDS.filter((id) => id !== 'laundry').sort(),
      );
    });
  });

  describe('when the stairs no longer join the corridor', () => {
    const variant = withStairsShortened(FLOOR_PLAN, SHORTENED_STAIRS_MAX_X);

    it('is still a valid floor with a valid schedule', () => {
      expect(validateFloorPlan(variant)).toBe(variant);
      expect(validatePorts(variant, PORT_SCHEDULE)).toBe(PORT_SCHEDULE);
    });

    it('really removes the zero-gap join the original plan has', () => {
      expect(joinsWithNoWall(FLOOR_PLAN, 'stairs', 'corridor')).toBe(true);
      expect(joinsWithNoWall(variant, 'stairs', 'corridor')).toBe(false);
    });

    it('still reaches everything through the link corridor', () => {
      expect(reachableFromStairs(variant)).toEqual([...EXPECTED_REACHABLE_IDS].sort());
    });
  });

  describe('rejected start points', () => {
    it('throws when the point lies inside a wall', () => {
      expect(findSpaceAt(FLOOR_PLAN, INSIDE_A_WALL)).toBeUndefined();
      expect(() => getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_A_WALL)).toThrow(
        RangeError,
      );
      expect(() => getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_A_WALL)).toThrow(
        /lies in no space/,
      );
    });

    it('throws when the point lies in a void', () => {
      expect(findSpaceAt(FLOOR_PLAN, INSIDE_VOID_WEST)?.id).toBe('voidWest');
      expect(() => getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_VOID_WEST)).toThrow(
        RangeError,
      );
      expect(() => getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_VOID_WEST)).toThrow(
        /no floor to walk on/,
      );
    });
  });
});
