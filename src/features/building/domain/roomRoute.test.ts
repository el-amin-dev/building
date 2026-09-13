/**
 * Tests of the waypoint geometry.
 *
 * The numbers pinned here were derived by hand from the source of truth before
 * the module existed, and every one of them is a claim about the owner's floor
 * rather than a snapshot of whatever the code returns:
 *
 * - the stairs and the corridor join with NO wall, and they do it twice — over
 *   z 4.00–5.50 and over z 5.50–6.00. The crossing belongs in the wide one, so
 *   its centre is z 4.75 and not 5.75, and its two approach points straddle
 *   x 5.60 with nothing between them;
 * - the stair bay's bounding centre, (3.60, 5.00), is a hole: only the arrival
 *   landing is floor at this level;
 * - the guest room's north strip is the bigger rect by plain area and the wrong
 *   place to be sent to, being 0.75 m of circulation;
 * - the guest bathroom's open part is 0.55 m deep, so its approach point sits at
 *   its own mid-depth, z 7.475, leaving 0.025 m at each side of the body.
 *
 * The headline test is the last one: for every space reachable from the arrival,
 * the body square is covered by the floor at every waypoint, and along every leg
 * it leaves the floor only inside the clear opening of a port. That is Part 3's
 * exit criterion — movement crosses a wall at a port and nowhere else — asserted
 * over the whole floor rather than on a chosen room.
 *
 * The routes for that test come from `findSpaceRoute` (`reachability.ts`), the
 * real chooser of routes, so the two halves of the walk are tested together.
 * Every other test builds its route as a literal array, so nothing here depends
 * on how a route was chosen.
 */
import { describe, expect, it } from 'vitest';
import { EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import { FLOOR_PLAN, getNeighbours, getSpace, getSpaceBounds } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { LENGTH_TOLERANCE, makeRect, rectArea, rectContainsPoint } from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { PORT_SCHEDULE, getPortOpening, getPortPartners } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { findSpaceRoute, getReachableSpaceIds } from './reachability.ts';
import { ROOM_ROUTE_CONFIG, getRouteWaypoints } from './roomRoute.ts';
import type { RoomRouteConfig } from './roomRoute.ts';
import { getSlabs } from './slabs.ts';

/** Where the stairs deliver the explorer onto this floor, on the arrival landing. */
const ARRIVAL: PlanPoint = Object.freeze({ x: 5.1, z: 5.0 });

/** A point inside no space of the plan: a `from` that starts a route where it ends. */
const OFF_PLAN: PlanPoint = Object.freeze({ x: -10, z: -10 });

/** Radius of the body every expectation below is measured for, in metres. */
const BODY_RADIUS = ROOM_ROUTE_CONFIG.bodyRadius;
/** Side of the square the body occupies on the plan, in metres. */
const BODY_SIDE = BODY_RADIUS * 2;

/** The default distance an approach point stands back from its wall face, in metres. */
const APPROACH_SET_BACK = 0.3;
/** Expected body radius and approach margin of the default tuning, in metres. */
const EXPECTED_BODY_RADIUS = 0.25;
const EXPECTED_APPROACH_MARGIN = 0.05;

/** Spaces an explorer can reach from the arrival: all 22 of the plan but its two voids. */
const REACHABLE_SPACE_COUNT = 20;

/** Longest distance between two samples of a leg, in metres. */
const SAMPLE_STEP_METRES = 0.05;

/** Digits compared when a distance is not expected to be exact on the grid. */
const PRECISION_DIGITS = 9;

/** The x face the stairs and the corridor share, with no wall between them, in metres. */
const STAIRS_CORRIDOR_FACE = 5.6;
/** Span of the wide zero-gap stairs ↔ corridor contact, on z, in metres. */
const WIDE_JOIN_SPAN: readonly [number, number] = [4, 5.5];
/** Span of the narrow one, over the corridor's stair-hall rect, in metres. */
const NARROW_JOIN_SPAN: readonly [number, number] = [5.5, 6];

/** A door too narrow for the body: 0.40 m against the 0.50 m it occupies. */
const NARROW_PORT_WIDTH = 0.4;

/** Depth of a rect no body of 0.25 m radius can stand in, in metres. */
const UNSTANDABLE_DEPTH = 0.4;

/**
 * Builds a copy of a plan with one space's rects replaced.
 *
 * @param plan - The plan to copy. Not mutated.
 * @param id - Identifier of the space to change.
 * @param rects - The rects it should have instead.
 * @returns A frozen plan; every other space is the original object.
 */
function withRects(plan: FloorPlan, id: SpaceId, rects: readonly PlanRect[]): FloorPlan {
  return Object.freeze({
    ...plan,
    spaces: Object.freeze(
      plan.spaces.map((space) => (space.id === id ? Object.freeze({ ...space, rects }) : space)),
    ),
  });
}

/**
 * Builds a copy of a port schedule with the width of one port replaced.
 *
 * @param ports - The schedule to copy. Not mutated.
 * @param pair - The two spaces of the port to change, in either order.
 * @param width - The clear width it should have instead, in metres.
 * @returns A frozen schedule; every other port is the original object.
 */
function withPortWidth(
  ports: readonly Port[],
  pair: readonly [SpaceId, SpaceId],
  width: number,
): readonly Port[] {
  return Object.freeze(
    ports.map((port) =>
      port.spaces.includes(pair[0]) && port.spaces.includes(pair[1])
        ? Object.freeze({ ...port, width })
        : port,
    ),
  );
}

/** Finds the port naming two spaces, in either order. */
function findPort(a: SpaceId, b: SpaceId): Port | undefined {
  return PORT_SCHEDULE.find((port) => port.spaces.includes(a) && port.spaces.includes(b));
}

/** The footprints of every slab of the floor: the floor a body may stand on. */
function getFloorRects(): readonly PlanRect[] {
  return getSlabs(FLOOR_PLAN).map((slab) => slab.rect);
}

/**
 * The floor plus the clear openings of the ports a route passes through.
 *
 * A slab stops at the inside face of a wall, so no slab is poured inside the
 * 0.30 m a doorway is deep: crossing a wall, the body is briefly on no slab at
 * all. What must hold is that it is then inside the opening of a port and
 * nowhere else, which is what adding exactly those openings — and nothing else
 * — tests.
 *
 * @param route - The spaces walked through, in order.
 * @returns The slab footprints followed by one opening footprint per port of the
 *   route. A zero-gap join contributes nothing: it has no wall to pass through.
 */
function getAllowedRects(route: readonly SpaceId[]): readonly PlanRect[] {
  const openings: PlanRect[] = [];
  for (let step = 0; step + 1 < route.length; step += 1) {
    const port = findPort(route[step], route[step + 1]);
    if (port !== undefined) {
      openings.push(getPortOpening(FLOOR_PLAN, port).rect);
    }
  }
  return [...getFloorRects(), ...openings];
}

/**
 * The coordinates an interval has to be cut at to tile it with elementary cells.
 *
 * @param min - Start of the interval.
 * @param max - End of the interval.
 * @param faces - Candidate cuts; those outside the interval are dropped.
 * @returns The ascending, deduplicated cuts, starting at `min` and ending at `max`.
 */
function getCuts(min: number, max: number, faces: readonly number[]): readonly number[] {
  const inside = faces.filter(
    (face) => face > min + LENGTH_TOLERANCE && face < max - LENGTH_TOLERANCE,
  );
  return [...new Set([min, ...inside, max])].sort((a, b) => a - b);
}

/**
 * Tells whether the body square centred on a point is covered by a union of rects.
 *
 * Exact, and it has to be: the body regularly straddles two rects that only
 * together cover it — a connector waypoint sits on the face two rects share, and
 * a doorway is covered by one room's slab, the opening and the other room's slab.
 * Testing containment in a single rect would fail every one of those. The square
 * is therefore cut into elementary cells at every rect face crossing it, and the
 * square is covered when every cell is: the cells are rectangles no face of the
 * union crosses, so a cell lies wholly inside a rect exactly when its centre
 * does.
 *
 * @param centre - Centre of the body square.
 * @param rects - The rects whose union is the covering.
 * @returns `true` when no part of the square lies outside the union.
 */
function isBodyCovered(centre: PlanPoint, rects: readonly PlanRect[]): boolean {
  const square = makeRect(
    centre.x - BODY_RADIUS,
    centre.x + BODY_RADIUS,
    centre.z - BODY_RADIUS,
    centre.z + BODY_RADIUS,
  );
  const xs = getCuts(
    square.minX,
    square.maxX,
    rects.flatMap((rect) => [rect.minX, rect.maxX]),
  );
  const zs = getCuts(
    square.minZ,
    square.maxZ,
    rects.flatMap((rect) => [rect.minZ, rect.maxZ]),
  );
  for (let xStep = 0; xStep + 1 < xs.length; xStep += 1) {
    for (let zStep = 0; zStep + 1 < zs.length; zStep += 1) {
      const cellCentre: PlanPoint = {
        x: (xs[xStep] + xs[xStep + 1]) / 2,
        z: (zs[zStep] + zs[zStep + 1]) / 2,
      };
      if (!rects.some((rect) => rectContainsPoint(rect, cellCentre))) {
        return false;
      }
    }
  }
  return true;
}

/**
 * The point a walker sent to a space is put down at.
 *
 * Read through the only API that exposes it: `getRouteWaypoints` of the
 * single-space route `[id]` ends at exactly that point, and a `from` lying in no
 * walkable rect of the space starts the route in the destination rect itself, so
 * no connector precedes it and the one waypoint yielded IS the destination.
 *
 * @param plan - The plan to read.
 * @param id - Identifier of the space to walk to.
 * @param config - Tuning; defaults to {@link ROOM_ROUTE_CONFIG}.
 * @returns The destination point of that space.
 * @throws RangeError for the same reasons `getRouteWaypoints` does.
 */
function destinationOf(
  plan: FloorPlan,
  id: SpaceId,
  config: RoomRouteConfig = ROOM_ROUTE_CONFIG,
): PlanPoint {
  const waypoints = getRouteWaypoints(plan, PORT_SCHEDULE, [id], OFF_PLAN, config);
  expect(waypoints).toHaveLength(1);
  return waypoints[0];
}

/**
 * Samples a straight leg at no more than {@link SAMPLE_STEP_METRES} apart.
 *
 * @param from - Start of the leg.
 * @param to - End of the leg.
 * @returns The samples, including both ends; a single pair for a zero-length leg.
 */
function sampleLeg(from: PlanPoint, to: PlanPoint): readonly PlanPoint[] {
  const spanX = to.x - from.x;
  const spanZ = to.z - from.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(spanX, spanZ) / SAMPLE_STEP_METRES));
  return Array.from({ length: steps + 1 }, (_unused, index) => ({
    x: from.x + (spanX * index) / steps,
    z: from.z + (spanZ * index) / steps,
  }));
}

describe('ROOM_ROUTE_CONFIG', () => {
  it('walks the body the navigation already keeps clear of the walls', () => {
    expect(ROOM_ROUTE_CONFIG.bodyRadius).toBe(EYE_NAVIGATION_CONFIG.bodyRadius);
    expect(ROOM_ROUTE_CONFIG.bodyRadius).toBe(EXPECTED_BODY_RADIUS);
  });

  it('keeps a 0.05 m jamb clearance, the narrowest the plan itself leaves', () => {
    expect(ROOM_ROUTE_CONFIG.approachMargin).toBe(EXPECTED_APPROACH_MARGIN);
    expect(ROOM_ROUTE_CONFIG.bodyRadius + ROOM_ROUTE_CONFIG.approachMargin).toBe(APPROACH_SET_BACK);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ROOM_ROUTE_CONFIG)).toBe(true);
  });
});

describe('the destination of a space', () => {
  it('sends the walker into the corridor, the kitchen and the stair landing', () => {
    expect(destinationOf(FLOOR_PLAN, 'corridor')).toEqual({ x: 12.9, z: 4.75 });
    expect(destinationOf(FLOOR_PLAN, 'kitchen')).toEqual({ x: 13.15, z: 7.2 });
    expect(destinationOf(FLOOR_PLAN, 'stairs')).toEqual({ x: 5.1, z: 5 });
  });

  it('prefers the kitchen rect with the greater standing area, not the greater area', () => {
    const [west, east] = getSpace(FLOOR_PLAN, 'kitchen').rects;
    expect(rectArea(west)).toBeCloseTo(5.06, PRECISION_DIGITS);
    expect(rectArea(east)).toBeCloseTo(5.32, PRECISION_DIGITS);
    const destination = destinationOf(FLOOR_PLAN, 'kitchen');
    expect(rectContainsPoint(east, destination)).toBe(true);
    expect(rectContainsPoint(west, destination)).toBe(false);
  });

  it('avoids the stair bay bounding centre, which is a hole at this level', () => {
    const boundsCentre: PlanPoint = (() => {
      const bounds = getSpaceBounds(getSpace(FLOOR_PLAN, 'stairs'));
      return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
    })();
    // Unsnapped on purpose: this is the alternative rule being disproved, read
    // straight off the bounding box the way a caller of `getSpaceBounds` would.
    expect(boundsCentre.x).toBeCloseTo(3.6, PRECISION_DIGITS);
    expect(boundsCentre.z).toBeCloseTo(5, PRECISION_DIGITS);
    const floor = getFloorRects();
    expect(floor.some((rect) => rectContainsPoint(rect, boundsCentre))).toBe(false);
    expect(floor.some((rect) => rectContainsPoint(rect, destinationOf(FLOOR_PLAN, 'stairs')))).toBe(
      true,
    );
  });

  it('sends the walker into the guest room, not into its 0.75 m circulation strip', () => {
    const [strip, room] = getSpace(FLOOR_PLAN, 'guestRoom').rects;
    // The strip is the larger rect by plain area, and the wrong answer.
    expect(rectArea(strip)).toBeCloseTo(6.075, PRECISION_DIGITS);
    expect(rectArea(room)).toBeCloseTo(4.34, PRECISION_DIGITS);
    const destination = destinationOf(FLOOR_PLAN, 'guestRoom');
    expect(destination).toEqual({ x: 5.5, z: 7.825 });
    expect(rectContainsPoint(room, destination)).toBe(true);
    expect(rectContainsPoint(strip, destination)).toBe(false);
  });

  it('stands the body clear of the walls in every space reachable from the arrival', () => {
    const floor = getFloorRects();
    const standing = [...getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, ARRIVAL)].filter((id) =>
      isBodyCovered(destinationOf(FLOOR_PLAN, id), floor),
    );
    expect(standing).toHaveLength(REACHABLE_SPACE_COUNT);
  });

  it('returns a frozen point', () => {
    expect(Object.isFrozen(destinationOf(FLOOR_PLAN, 'kitchen'))).toBe(true);
  });

  it('refuses a space with no floor at this level', () => {
    expect(() => destinationOf(FLOOR_PLAN, 'voidWest')).toThrow(RangeError);
    expect(() => destinationOf(FLOOR_PLAN, 'voidWest')).toThrow(/"voidWest"/);
  });

  it('refuses a space too shallow for the body to stand in', () => {
    const flattened = withRects(FLOOR_PLAN, 'utilityRoom', [
      makeRect(20.5, 22.2, 4.15, 4.15 + UNSTANDABLE_DEPTH),
    ]);
    expect(() => destinationOf(flattened, 'utilityRoom')).toThrow(/"utilityRoom"/);
  });

  it('refuses a tuning with no positive body radius', () => {
    const noBody: RoomRouteConfig = { bodyRadius: 0, approachMargin: EXPECTED_APPROACH_MARGIN };
    expect(() => destinationOf(FLOOR_PLAN, 'kitchen', noBody)).toThrow(/bodyRadius/);
  });
});

describe('getRouteWaypoints', () => {
  it('walks the stairs to the corridor in one straight run', () => {
    expect(getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['stairs', 'corridor'], ARRIVAL)).toEqual([
      { x: 5.3, z: 4.75 },
      { x: 5.9, z: 4.75 },
      { x: 12.9, z: 4.75 },
    ]);
  });

  it('keeps that run collinear, so nothing turns in the doorway', () => {
    const run = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['stairs', 'corridor'], ARRIVAL);
    expect(new Set(run.map((point) => point.z)).size).toBe(1);
  });

  it('walks the corridor through the stairs into the guest room', () => {
    expect(
      getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['corridor', 'stairs', 'guestRoom'], ARRIVAL),
    ).toEqual([
      { x: 5.9, z: 4.75 },
      { x: 5.3, z: 4.75 },
      { x: 5.1, z: 5.7 },
      { x: 5.1, z: 6.6 },
      { x: 5.5, z: 7.05 },
      { x: 5.5, z: 7.825 },
    ]);
  });

  it('walks the guest room to the kitchen across the whole floor', () => {
    expect(
      getRouteWaypoints(
        FLOOR_PLAN,
        PORT_SCHEDULE,
        ['guestRoom', 'stairs', 'corridor', 'kitchen'],
        ARRIVAL,
      ),
    ).toEqual([
      { x: 5.5, z: 7.05 },
      { x: 5.1, z: 6.6 },
      { x: 5.1, z: 5.7 },
      { x: 5.3, z: 4.75 },
      { x: 5.9, z: 4.75 },
      { x: 13.15, z: 5.2 },
      { x: 13.15, z: 6.1 },
      { x: 13.15, z: 7.2 },
    ]);
  });

  it('ends every route at the destination of its last space', () => {
    const route: readonly SpaceId[] = ['guestRoom', 'stairs', 'corridor', 'kitchen'];
    const waypoints = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, route, ARRIVAL);
    expect(waypoints[waypoints.length - 1]).toEqual(destinationOf(FLOOR_PLAN, 'kitchen'));
  });

  it('yields only the destination for a single-space route, and nothing for an empty one', () => {
    expect(getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['stairs'], ARRIVAL)).toEqual([
      { x: 5.1, z: 5 },
    ]);
    expect(getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, [], ARRIVAL)).toEqual([]);
  });

  it('returns a frozen array of frozen points', () => {
    const waypoints = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['stairs', 'corridor'], ARRIVAL);
    expect(Object.isFrozen(waypoints)).toBe(true);
    expect(waypoints.every((point) => Object.isFrozen(point))).toBe(true);
  });

  it('mutates none of its inputs', () => {
    const route: readonly SpaceId[] = ['guestRoom', 'stairs', 'corridor', 'kitchen'];
    const planBefore = JSON.stringify(FLOOR_PLAN);
    const portsBefore = JSON.stringify(PORT_SCHEDULE);
    const routeBefore = JSON.stringify(route);
    const fromBefore = JSON.stringify(ARRIVAL);
    getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, route, ARRIVAL);
    expect(JSON.stringify(FLOOR_PLAN)).toBe(planBefore);
    expect(JSON.stringify(PORT_SCHEDULE)).toBe(portsBefore);
    expect(JSON.stringify(route)).toBe(routeBefore);
    expect(JSON.stringify(ARRIVAL)).toBe(fromBefore);
  });
});

describe('the zero-gap stairs ↔ corridor crossing', () => {
  it('is two contacts, and the crossing takes the wider one', () => {
    const joins = getNeighbours(FLOOR_PLAN, 'stairs').filter(
      (contact) => contact.neighbourId === 'corridor' && contact.gap <= LENGTH_TOLERANCE,
    );
    expect(joins.map((contact) => [contact.spanMin, contact.spanMax])).toEqual([
      [...WIDE_JOIN_SPAN],
      [...NARROW_JOIN_SPAN],
    ]);
    const [outer] = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['stairs', 'corridor'], ARRIVAL);
    // The centre of the wide contact, not of the narrow one at z 5.75.
    expect(outer.z).toBe((WIDE_JOIN_SPAN[0] + WIDE_JOIN_SPAN[1]) / 2);
    expect(outer.z).not.toBe((NARROW_JOIN_SPAN[0] + NARROW_JOIN_SPAN[1]) / 2);
  });

  it('straddles the shared face with no wall between its two approach points', () => {
    const [outer, inner] = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['stairs', 'corridor'],
      ARRIVAL,
    );
    expect((outer.x + inner.x) / 2).toBe(STAIRS_CORRIDOR_FACE);
    expect(inner.x - outer.x).toBeCloseTo(APPROACH_SET_BACK * 2, PRECISION_DIGITS);
  });

  it('is walked the same way from either end', () => {
    const [outer, inner] = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['stairs', 'corridor'],
      ARRIVAL,
    );
    const [back, forth] = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['corridor', 'stairs'],
      ARRIVAL,
    );
    expect(back).toEqual(inner);
    expect(forth).toEqual(outer);
  });

  it('cannot come from getPortOpening, which has no wall to cut here', () => {
    // No port names this pair: the two spaces simply meet. A port placed here
    // to ask the question is rejected for the reason the crossing exists.
    expect(getPortPartners(PORT_SCHEDULE, 'stairs')).not.toContain('corridor');
    const hypothetical: Port = Object.freeze({
      spaces: Object.freeze(['stairs', 'corridor'] as const),
      kind: 'door',
      along: 'z',
      spanMin: WIDE_JOIN_SPAN[0],
      width: WIDE_JOIN_SPAN[1] - WIDE_JOIN_SPAN[0],
    });
    expect(() => getPortOpening(FLOOR_PLAN, hypothetical)).toThrow(RangeError);
    expect(() => getPortOpening(FLOOR_PLAN, hypothetical)).toThrow(/no wall to cut/);
  });
});

describe('a crossing the body does not fit through', () => {
  it('is refused, naming both spaces', () => {
    const narrowed = withPortWidth(PORT_SCHEDULE, ['corridor', 'kitchen'], NARROW_PORT_WIDTH);
    expect(() => getRouteWaypoints(FLOOR_PLAN, narrowed, ['corridor', 'kitchen'], ARRIVAL)).toThrow(
      RangeError,
    );
    expect(() => getRouteWaypoints(FLOOR_PLAN, narrowed, ['corridor', 'kitchen'], ARRIVAL)).toThrow(
      /"corridor".*"kitchen"/,
    );
  });

  it('is walkable again at exactly the width of the body', () => {
    const tight = withPortWidth(PORT_SCHEDULE, ['corridor', 'kitchen'], BODY_SIDE);
    expect(getRouteWaypoints(FLOOR_PLAN, tight, ['corridor', 'kitchen'], ARRIVAL)).toHaveLength(3);
  });
});

describe('spaces that cannot be walked between', () => {
  it('refuses a pair joined by neither a port nor a zero-gap join', () => {
    expect(() =>
      getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['stairs', 'kitchen'], ARRIVAL),
    ).toThrow(/"stairs".*"kitchen"/);
  });

  it('refuses a route through a space with no floor at this level', () => {
    expect(() =>
      getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, ['voidWest', 'balconySlabB'], ARRIVAL),
    ).toThrow(/"voidWest"/);
  });

  it('refuses a space whose walkable rects are split by a gap the body cannot pass', () => {
    // The two rects of the guest room, kept apart by a 1.00 m strip of nothing.
    // The route enters through the north strip, while the detached rect is the
    // larger standing area and so the destination: there is no way across.
    const split = withRects(FLOOR_PLAN, 'guestRoom', [
      makeRect(1.6, 9.7, 6.3, 7.05),
      makeRect(4.1, 9, 8.05, 9),
    ]);
    expect(() => getRouteWaypoints(split, PORT_SCHEDULE, ['stairs', 'guestRoom'], ARRIVAL)).toThrow(
      /"guestRoom"/,
    );
  });
});

describe('an approach point in a shallow room', () => {
  it('stops at the mid-depth of the 0.55 m guest bathroom rather than at 0.30', () => {
    const waypoints = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['guestRoom', 'guestSanitair'],
      ARRIVAL,
    );
    expect(waypoints).toEqual([
      { x: 5.5, z: 7.05 },
      { x: 7.75, z: 6.75 },
      { x: 7.75, z: 7.475 },
      { x: 8.45, z: 7.475 },
    ]);
    const [openPart] = getSpace(FLOOR_PLAN, 'guestSanitair').rects;
    const inside = waypoints[2];
    // 0.025 m clear at each side; a flat 0.30 would have put the body's far
    // edge exactly on the far wall at z 7.75.
    expect(inside.z - BODY_RADIUS - openPart.minZ).toBeCloseTo(0.025, PRECISION_DIGITS);
    expect(openPart.maxZ - (inside.z + BODY_RADIUS)).toBeCloseTo(0.025, PRECISION_DIGITS);
    expect(openPart.minZ + APPROACH_SET_BACK + BODY_RADIUS).toBe(openPart.maxZ);
  });
});

describe('an intra-space connector', () => {
  it('lands on the face the two rects of the guest room share', () => {
    const waypoints = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['corridor', 'stairs', 'guestRoom'],
      ARRIVAL,
    );
    const [strip, room] = getSpace(FLOOR_PLAN, 'guestRoom').rects;
    const connector = waypoints[waypoints.length - 2];
    expect(connector).toEqual({ x: 5.5, z: 7.05 });
    expect(connector.z).toBe(strip.maxZ);
    expect(connector.z).toBe(room.minZ);
    expect(isBodyCovered(connector, getFloorRects())).toBe(true);
  });

  it('is left out when a space is entered and left through the same rect', () => {
    const waypoints = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['stairs', 'corridor', 'kitchen'],
      ARRIVAL,
    );
    // Two crossings, two points each, then the destination: no connector.
    expect(waypoints).toHaveLength(5);
  });
});

describe('the wall-crossing proof', () => {
  it('keeps the body on the floor everywhere, leaving it only inside a port opening', () => {
    const reachable = [...getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, ARRIVAL)];
    expect(reachable).toHaveLength(REACHABLE_SPACE_COUNT);
    const floor = getFloorRects();
    const offFloor: string[] = [];
    for (const id of reachable) {
      const route = findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, ARRIVAL, id);
      const waypoints = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, route, ARRIVAL);
      const allowed = getAllowedRects(route);
      expect(waypoints.length).toBeGreaterThan(0);
      expect(waypoints[waypoints.length - 1]).toEqual(destinationOf(FLOOR_PLAN, id));
      let previous = ARRIVAL;
      waypoints.forEach((waypoint, index) => {
        // Standing still, the body is on the floor and on nothing else.
        if (!isBodyCovered(waypoint, floor)) {
          offFloor.push(
            `${id}: waypoint ${String(index)} (${String(waypoint.x)}, ${String(waypoint.z)})`,
          );
        }
        for (const sample of sampleLeg(previous, waypoint)) {
          if (!isBodyCovered(sample, allowed)) {
            offFloor.push(
              `${id}: leg ${String(index)} at (${String(sample.x)}, ${String(sample.z)})`,
            );
          }
        }
        previous = waypoint;
      });
    }
    expect(offFloor).toEqual([]);
  });

  it('needs those port openings: the walk does leave the slabs inside a doorway', () => {
    // The companion of the test above. If the body never left the floor, adding
    // the openings would prove nothing, so this pins that the crossing legs
    // genuinely pass through walls.
    const route: readonly SpaceId[] = ['stairs', 'corridor', 'kitchen'];
    const waypoints = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, route, ARRIVAL);
    const floor = getFloorRects();
    const inDoorway = waypoints.flatMap((waypoint, index) =>
      index === 0 ? [] : sampleLeg(waypoints[index - 1], waypoint),
    );
    expect(inDoorway.some((sample) => !isBodyCovered(sample, floor))).toBe(true);
    expect(inDoorway.every((sample) => isBodyCovered(sample, getAllowedRects(route)))).toBe(true);
  });
});
