import { describe, expect, it } from 'vitest';
import {
  FLOOR_PLAN,
  findSpaceAt,
  getNeighbours,
  getSpace,
  hasFloor,
  validateFloorPlan,
} from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { LENGTH_TOLERANCE, makeRect } from './planGeometry.ts';
import type { PlanPoint } from './planGeometry.ts';
import { PORT_SCHEDULE, getPortPartners, validatePorts } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { findSpaceRoute, getReachableSpaceIds } from './reachability.ts';

/** Where the stairs deliver the explorer onto this floor: the east landing. */
const STAIRS_ARRIVAL: PlanPoint = Object.freeze({ x: 4.65, z: 4.65 });

/** A point inside the side-A wall (x 1.30–1.60), away from any door. */
const INSIDE_A_WALL: PlanPoint = Object.freeze({ x: 1.45, z: 2.0 });

/** A point in the west void, which has no floor to stand on. */
const INSIDE_VOID_WEST: PlanPoint = Object.freeze({ x: 6.0, z: 9.2 });

/** A point on the walkable side-B balcony slab. */
const ON_BALCONY_SLAB: PlanPoint = Object.freeze({ x: 14.45, z: 9.2 });

/** A point on the stair landing, east of flight B (stairs x 1.60–5.60, z 4.00–6.00). */
const STAIRS_LANDING: PlanPoint = Object.freeze({ x: 5.1, z: 5.0 });

/** A point in the corridor's main run (x 5.60–20.20, z 4.00–5.50). */
const IN_CORRIDOR: PlanPoint = Object.freeze({ x: 8.0, z: 4.65 });

/** A point in the guest room's north strip (x 1.60–9.70, z 6.30–7.05). */
const IN_GUEST_ROOM: PlanPoint = Object.freeze({ x: 9.0, z: 6.8 });

/** An id no space of the plan carries, to prove an unknown target throws. */
const UNKNOWN_SPACE_ID = 'nowhere' as SpaceId;

/**
 * The three routes of this floor, written out by hand.
 *
 * Every one of them crosses the stair landing, and that is the floor and not the
 * algorithm: no port joins the corridor to the guest room, and the kitchen's
 * opening onto the guest room is a `pass` window of the source of truth, not a
 * port, so it is no way through. The test below asserts both of those facts, so
 * this list cannot quietly become wrong.
 */
const STAIRS_TO_KITCHEN: readonly SpaceId[] = ['stairs', 'corridor', 'kitchen'];
const CORRIDOR_TO_GUEST_ROOM: readonly SpaceId[] = ['corridor', 'stairs', 'guestRoom'];
const GUEST_ROOM_TO_KITCHEN: readonly SpaceId[] = ['guestRoom', 'stairs', 'corridor', 'kitchen'];

/** Length of the route to the space the explorer already stands in: the target alone. */
const ROUTE_TO_HERE_LENGTH = 1;

/** Length of both tied routes from the stair landing to the kitchen: two steps, three spaces. */
const TIED_ROUTE_LENGTH = 3;

/**
 * A door this floor does not have, from the guest room straight into the kitchen.
 *
 * It exists to make the equal-hop tie the real floor has none of: with it, the
 * kitchen sits two steps from the stair landing both through the corridor and
 * through the guest room, so which one is returned pins the tie-break rule
 * rather than the hop count.
 *
 * Only `spaces` is read on this walk — the step rule asks `getPortPartners` for
 * the access graph and never looks at port geometry — so this port is never
 * checked against the plan and must not be handed to anything that cuts an
 * opening.
 */
const GUEST_ROOM_TO_KITCHEN_DOOR: Port = Object.freeze({
  spaces: Object.freeze(['guestRoom', 'kitchen'] as const),
  kind: 'door',
  along: 'z',
  spanMin: 6.3,
  width: 0.9,
});

/**
 * New east face of the stairs in the variant that breaks the corridor join, in
 * metres.
 *
 * The stairs run x 1.60–5.60 and the corridor starts at x 5.60, so any value
 * below 5.60 opens a gap and removes the join. It cannot go much below: the
 * stairs ↔ guestRoom door occupies x 4.65–5.55 of the stairs' south wall, and
 * `getPortContact` requires the whole port span to lie inside one contact, so
 * cutting the stairs back past 5.55 would make the schedule invalid and the
 * variant would prove nothing about reachability. 5.55 is therefore the
 * shortest stairs that keeps every door buildable while losing the join.
 */
const SHORTENED_STAIRS_MAX_X = 5.55;

const EXPECTED_REACHABLE_COUNT = 19;
const LAUNDRY_PORT_COUNT = 2;
const STAIRS_PORT_COUNT = 1;
const ONLY_THE_STAIRS = 1;

/** The two spaces with no floor: open to the sky (brief §5.2). */
const VOID_IDS: readonly SpaceId[] = ['voidWest', 'voidEast'];

/**
 * Every space an explorer can walk to on this floor, written out by hand: all
 * 21 spaces of the plan except the two voids.
 *
 * The stairs hand the walker to the guest room's north strip, the strip reaches
 * the side-A balcony and the control center, the balcony reaches the master
 * bedroom and the master bedroom reaches the corridor, which serves the whole
 * top row and the service row. That is one component, and the list is what
 * proves it stays one.
 */
const EXPECTED_REACHABLE_IDS: readonly SpaceId[] = [
  'balconyA',
  'masterBedroom',
  'livingRoom',
  'bedroomMaleKids',
  'bedroomFemaleKids',
  'stairs',
  'corridor',
  'controlCenter',
  'guestRoom',
  'guestSanitair',
  'kitchen',
  'laundry',
  'mainSanitair',
  'utilityRoom',
  'ccBalcony',
  'balconySlabB',
  'guestBathCubicle',
  'mainBathCubicle',
  'mainShowerCubicle',
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
 * Lists every unordered pair of floor spaces that meet with no wall at all.
 *
 * @param plan - The plan to inspect.
 * @returns The pairs as sorted `a|b` keys, deduplicated.
 */
function floorJoinsWithNoWall(plan: FloorPlan): readonly string[] {
  const keys = plan.spaces
    .filter((space) => hasFloor(space.kind))
    .flatMap((space) =>
      getNeighbours(plan, space.id)
        .filter(
          (contact) =>
            contact.gap <= LENGTH_TOLERANCE &&
            hasFloor(plan.spaces.find((other) => other.id === contact.neighbourId)?.kind ?? 'void'),
        )
        .map((contact) => [space.id, contact.neighbourId].sort().join('|')),
    );
  return [...new Set(keys)].sort();
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

  it('reaches all nineteen floor spaces from the stairs arrival point', () => {
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

  describe('when the laundry loses its two ports', () => {
    const withoutLaundryPorts = PORT_SCHEDULE.filter((port) => !port.spaces.includes('laundry'));

    it('drops exactly two ports from the schedule', () => {
      expect(PORT_SCHEDULE.length - withoutLaundryPorts.length).toBe(LAUNDRY_PORT_COUNT);
    });

    it('drops only the laundry from the reachable set', () => {
      expect(reachableFromStairs(FLOOR_PLAN, withoutLaundryPorts)).toEqual(
        EXPECTED_REACHABLE_IDS.filter((id) => id !== 'laundry').sort(),
      );
    });
  });

  describe('the floor is connected through ports and only ports', () => {
    const variant = withStairsShortened(FLOOR_PLAN, SHORTENED_STAIRS_MAX_X);

    it('has exactly one wall-less join between two floor spaces: stairs ↔ corridor', () => {
      expect(floorJoinsWithNoWall(FLOOR_PLAN)).toEqual(['corridor|stairs']);
    });

    it('is still a valid floor with a valid schedule once that join is gone', () => {
      expect(validateFloorPlan(variant)).toBe(variant);
      expect(validatePorts(variant, PORT_SCHEDULE)).toBe(PORT_SCHEDULE);
    });

    it('really removes the zero-gap join the original plan has', () => {
      expect(joinsWithNoWall(FLOOR_PLAN, 'stairs', 'corridor')).toBe(true);
      expect(joinsWithNoWall(variant, 'stairs', 'corridor')).toBe(false);
      expect(floorJoinsWithNoWall(variant)).toEqual([]);
    });

    it('still reaches every floor space through the guest-room strip', () => {
      expect(reachableFromStairs(variant)).toEqual([...EXPECTED_REACHABLE_IDS].sort());
    });

    it('can still fail: without the stairs door, the explorer is shut in the stairwell', () => {
      const withoutStairsPort = PORT_SCHEDULE.filter((port) => !port.spaces.includes('stairs'));

      expect(PORT_SCHEDULE.length - withoutStairsPort.length).toBe(STAIRS_PORT_COUNT);
      expect(reachableFromStairs(variant, withoutStairsPort)).toEqual(['stairs']);
      expect(reachableFromStairs(variant, withoutStairsPort)).toHaveLength(ONLY_THE_STAIRS);
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

/**
 * Tells whether a port of a schedule connects two spaces.
 *
 * Re-derived here from the schedule itself rather than read off the walk, so a
 * broken predecessor walk cannot certify its own route.
 *
 * @param ports - The port schedule to search.
 * @param id - One space.
 * @param neighbourId - The other space.
 * @returns `true` when some port names both spaces.
 */
function joinedByPort(ports: readonly Port[], id: SpaceId, neighbourId: SpaceId): boolean {
  return ports.some((port) => port.spaces.includes(id) && port.spaces.includes(neighbourId));
}

describe('findSpaceRoute', () => {
  it('resolves each start point to the space that holds it', () => {
    expect(findSpaceAt(FLOOR_PLAN, STAIRS_LANDING)?.id).toBe('stairs');
    expect(findSpaceAt(FLOOR_PLAN, IN_CORRIDOR)?.id).toBe('corridor');
    expect(findSpaceAt(FLOOR_PLAN, IN_GUEST_ROOM)?.id).toBe('guestRoom');
  });

  it('walks the stair landing to the kitchen through the corridor', () => {
    expect(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, 'kitchen')).toEqual(
      STAIRS_TO_KITCHEN,
    );
  });

  it('walks the corridor to the guest room across the stair landing', () => {
    expect(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, IN_CORRIDOR, 'guestRoom')).toEqual(
      CORRIDOR_TO_GUEST_ROOM,
    );
  });

  it('walks the guest room to the kitchen across the stair landing', () => {
    expect(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, IN_GUEST_ROOM, 'kitchen')).toEqual(
      GUEST_ROOM_TO_KITCHEN,
    );
  });

  it('crosses the landing because the two shortcuts do not exist', () => {
    expect(joinedByPort(PORT_SCHEDULE, 'corridor', 'guestRoom')).toBe(false);
    expect(joinsWithNoWall(FLOOR_PLAN, 'corridor', 'guestRoom')).toBe(false);
    expect(joinedByPort(PORT_SCHEDULE, 'guestRoom', 'kitchen')).toBe(false);
    expect(joinsWithNoWall(FLOOR_PLAN, 'guestRoom', 'kitchen')).toBe(false);
  });

  it('freezes the returned route', () => {
    expect(
      Object.isFrozen(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, 'kitchen')),
    ).toBe(true);
  });

  it('returns the target alone when the explorer already stands in it', () => {
    const here = findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, 'stairs');

    expect(here).toEqual(['stairs']);
    expect(here).toHaveLength(ROUTE_TO_HERE_LENGTH);
    expect(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, IN_CORRIDOR, 'corridor')).toEqual([
      'corridor',
    ]);
  });

  it('steps only along real edges, for every space reachable from the landing', () => {
    const reachable = [...getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING)];
    const broken = reachable.filter((id) => {
      const route = findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, id);
      const endsRight = route[0] === 'stairs' && route[route.length - 1] === id;
      const visitsEachOnce = new Set(route).size === route.length;
      const everyStepIsAnEdge = route.every(
        (step, index) =>
          hasFloor(getSpace(FLOOR_PLAN, step).kind) &&
          (index === 0 ||
            joinedByPort(PORT_SCHEDULE, route[index - 1], step) ||
            joinsWithNoWall(FLOOR_PLAN, route[index - 1], step)),
      );
      return !(endsRight && visitsEachOnce && everyStepIsAnEdge);
    });

    expect(broken).toEqual([]);
    expect(reachable).toHaveLength(EXPECTED_REACHABLE_COUNT);
  });

  it('returns the same route every time it is asked', () => {
    const first = findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, IN_GUEST_ROOM, 'kitchen');
    const second = findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, IN_GUEST_ROOM, 'kitchen');

    expect(first).toEqual(second);
    expect(first).toEqual(GUEST_ROOM_TO_KITCHEN);
  });

  describe('when two routes are the same length', () => {
    const withExtraDoor: readonly Port[] = [...PORT_SCHEDULE, GUEST_ROOM_TO_KITCHEN_DOOR];

    it('really makes a tie: the kitchen stays two steps from the landing', () => {
      expect(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, 'kitchen')).toHaveLength(
        TIED_ROUTE_LENGTH,
      );
      expect(findSpaceRoute(FLOOR_PLAN, withExtraDoor, STAIRS_LANDING, 'kitchen')).toHaveLength(
        TIED_ROUTE_LENGTH,
      );
    });

    it('keeps the predecessor discovered first: the stairs list their port before their join', () => {
      expect(getPortPartners(PORT_SCHEDULE, 'stairs')).toEqual(['guestRoom']);
      expect(joinsWithNoWall(FLOOR_PLAN, 'stairs', 'corridor')).toBe(true);
      expect(findSpaceRoute(FLOOR_PLAN, withExtraDoor, STAIRS_LANDING, 'kitchen')).toEqual([
        'stairs',
        'guestRoom',
        'kitchen',
      ]);
    });
  });

  it.each(VOID_IDS)('finds no route to %s, which has no floor to stand on', (id) => {
    expect(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, id)).toEqual([]);
  });

  describe('when the explorer is shut in the stairwell', () => {
    const variant = withStairsShortened(FLOOR_PLAN, SHORTENED_STAIRS_MAX_X);
    const withoutStairsPort = PORT_SCHEDULE.filter((port) => !port.spaces.includes('stairs'));

    it('finds no route to anything outside it', () => {
      const outside = EXPECTED_REACHABLE_IDS.filter((id) => id !== 'stairs');
      const routed = outside.filter(
        (id) => findSpaceRoute(variant, withoutStairsPort, STAIRS_LANDING, id).length !== 0,
      );

      expect(routed).toEqual([]);
    });

    it('still routes to the stairwell the explorer stands in', () => {
      expect(findSpaceRoute(variant, withoutStairsPort, STAIRS_LANDING, 'stairs')).toEqual([
        'stairs',
      ]);
    });
  });

  describe('rejected arguments', () => {
    it('throws when the target is not a space of the plan', () => {
      expect(() =>
        findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, UNKNOWN_SPACE_ID),
      ).toThrow(RangeError);
      expect(() =>
        findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, STAIRS_LANDING, UNKNOWN_SPACE_ID),
      ).toThrow(/no space with id/);
    });

    it('throws when the start point lies inside a wall', () => {
      expect(() => findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_A_WALL, 'kitchen')).toThrow(
        RangeError,
      );
      expect(() => findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_A_WALL, 'kitchen')).toThrow(
        /lies in no space/,
      );
    });

    it('throws when the start point lies in a void', () => {
      expect(() => findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_VOID_WEST, 'kitchen')).toThrow(
        RangeError,
      );
      expect(() => findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_VOID_WEST, 'kitchen')).toThrow(
        /no floor to walk on/,
      );
    });
  });
});
