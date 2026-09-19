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

/** Spaces an explorer can reach from the arrival: all 21 of the plan but its two voids. */
const REACHABLE_SPACE_COUNT = 19;

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
    // The strip is STILL the larger rect by plain area, and still the wrong
    // answer — but only just. The leg grew from 2.80 m wide to 3.80 when the
    // guest shower was dropped and the suite slid east, so 4.34 m² became 5.89
    // against the strip's unchanged 6.075. The margin the rule is decided on is
    // standing area, not this one: eroded by the 0.25 m body the strip keeps
    // 7.60 × 0.25 = 1.90 and the leg 3.30 × 1.05 = 3.465.
    expect(rectArea(strip)).toBeCloseTo(6.075, PRECISION_DIGITS);
    expect(rectArea(room)).toBeCloseTo(5.89, PRECISION_DIGITS);
    expect(rectArea(strip)).toBeGreaterThan(rectArea(room));
    const destination = destinationOf(FLOOR_PLAN, 'guestRoom');
    expect(destination).toEqual({ x: 6, z: 7.825 });
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
      // The seam between the guest room's two rects, crossed square-on: a body
      // radius short of it, then a body radius past it.
      { x: 6, z: 6.8 },
      { x: 6, z: 7.3 },
      { x: 6, z: 7.825 },
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
      // Leaving the room leg for the strip, the same seam is crossed the other way.
      { x: 6, z: 7.3 },
      { x: 6, z: 6.8 },
      { x: 5.1, z: 6.6 },
      { x: 5.1, z: 5.7 },
      { x: 5.3, z: 4.75 },
      { x: 5.9, z: 4.75 },
      { x: 13.15, z: 5.2 },
      { x: 13.15, z: 6.1 },
      { x: 13.15, z: 7.2 },
    ]);
  });

  /**
   * The guest suite is the tightest chain on the floor, and the one the room tour
   * spends longest on: a 0.55 m open part, one cubicle 0.70 m deep behind a 0.60 m
   * leaf, and a seam to cross before any of it. The sweep over every reachable
   * space, below, already proves no waypoint of it stands in masonry — but it
   * proves that of 342 routes at once and names none of them. These three pin the
   * chain itself, so a regression here reads as "the guest suite" rather than as
   * one number in a table of hundreds.
   *
   * The suite is a chain and no longer a fork: the shower the walk used to branch
   * to at the open part is gone (owner, 2026-09-19), so the second half of this
   * test compares the bath route against the route that stops at the open part
   * instead of against the shower's.
   */
  it('threads the guest suite, through its 0.55 m open part into its one cubicle', () => {
    const toBath = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['guestRoom', 'guestSanitair', 'guestBathCubicle'],
      ARRIVAL,
    );
    expect(toBath).toEqual([
      // Out of the room leg, across the seam, into the circulation strip.
      { x: 6, z: 7.3 },
      { x: 6, z: 6.8 },
      // The strip carries the walk east to the sanitair door — x 8.10–8.80 now
      // that the suite has slid east, so 8.45 on its centre line — and the open
      // part takes its approach point at its own mid-depth: 0.55 m leaves 0.025 m
      // at each side of a 0.50 m body, which is the whole of what this room has.
      { x: 8.45, z: 6.75 },
      { x: 8.45, z: 7.475 },
      // The 0.60 m cubicle leaf at x 8.20–8.80, crossed square-on either side,
      // then the centre of the cubicle it opens into. The suite's two leaves sit
      // in OPPOSITE faces of a room 0.55 m deep — the room door at x 8.10–8.80 in
      // the north face, this one at 8.20–8.80 in the south — so the walk crosses
      // the open part almost straight through and barely moves along x.
      { x: 8.5, z: 7.475 },
      { x: 8.5, z: 8.2 },
      { x: 8.95, z: 8.25 },
    ]);
    const toOpenPart = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['guestRoom', 'guestSanitair'],
      ARRIVAL,
    );
    // The walk to the open part IS the first half of the walk to the bath: the
    // two share every waypoint up to it, and only then does the cubicle leg begin.
    expect(toOpenPart.slice(0, 4)).toEqual(toBath.slice(0, 4));
    // And the shorter walk is asserted whole, not as the prefix restated: the
    // prefix case above would pass on any tail at all, so the one waypoint that is
    // this route's own — the open part's own destination, the centre of a room that
    // is 1.80 m wide and 0.55 m deep — is the only part of it that is being tested
    // here. It stops at the seam it entered by, on the same z as the approach point,
    // because there is no second leaf to cross.
    expect(toOpenPart).toEqual([
      { x: 6, z: 7.3 },
      { x: 6, z: 6.8 },
      { x: 8.45, z: 6.75 },
      { x: 8.45, z: 7.475 },
      { x: 8.95, z: 7.475 },
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
      // Out of the room leg, square-on across the seam, and only then along the
      // strip. This is the walk that used to wedge: with one waypoint on the seam
      // the next leg ran diagonally to the door and clipped the notch at x 6.90,
      // 0.06 m inside the wall, every single time.
      { x: 6, z: 7.3 },
      { x: 6, z: 6.8 },
      { x: 8.45, z: 6.75 },
      { x: 8.45, z: 7.475 },
      { x: 8.95, z: 7.475 },
    ]);
    const [openPart] = getSpace(FLOOR_PLAN, 'guestSanitair').rects;
    const inside = waypoints[3];
    // 0.025 m clear at each side; a flat 0.30 would have put the body's far
    // edge exactly on the far wall at z 7.75.
    expect(inside.z - BODY_RADIUS - openPart.minZ).toBeCloseTo(0.025, PRECISION_DIGITS);
    expect(openPart.maxZ - (inside.z + BODY_RADIUS)).toBeCloseTo(0.025, PRECISION_DIGITS);
    expect(openPart.minZ + APPROACH_SET_BACK + BODY_RADIUS).toBe(openPart.maxZ);
  });
});

describe('an intra-space connector', () => {
  it('crosses the face the two rects of the guest room share square-on', () => {
    const waypoints = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['corridor', 'stairs', 'guestRoom'],
      ARRIVAL,
    );
    const [strip, room] = getSpace(FLOOR_PLAN, 'guestRoom').rects;
    // A pair, not a point: a body radius either side of the seam and at the same
    // position along it, so the crossing is perpendicular. A single waypoint on the
    // face let the body arrive along one diagonal and leave along another, and the
    // corner it cut between them is the notch the connector exists to avoid.
    const before = waypoints[waypoints.length - 3];
    const after = waypoints[waypoints.length - 2];
    // This route arrives in the strip and ends in the room leg, so the body leaves
    // the strip first: 6.80 is a body radius short of the seam, 7.30 a radius past it.
    expect(before).toEqual({ x: 6, z: 6.8 });
    expect(after).toEqual({ x: 6, z: 7.3 });
    expect(before.x).toBe(after.x);
    expect(strip.maxZ).toBe(room.minZ);
    expect(before.z + BODY_RADIUS).toBeCloseTo(strip.maxZ, PRECISION_DIGITS);
    expect(after.z - BODY_RADIUS).toBeCloseTo(room.minZ, PRECISION_DIGITS);
    expect(isBodyCovered(before, getFloorRects())).toBe(true);
    expect(isBodyCovered(after, getFloorRects())).toBe(true);
  });

  it('is left out when a space is entered and left through the same rect', () => {
    const waypoints = getRouteWaypoints(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      ['stairs', 'corridor', 'kitchen'],
      ARRIVAL,
    );
    // Two crossings, two points each, then the destination: no connector pair.
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

  it('keeps it on the floor from every room, not only from the stair arrival', () => {
    // The test above walks from ONE point, and that is how a real defect survived it:
    // every leg out of the guest room's south leg cut the notch where its two rects
    // stop overlapping, and no route from the arrival starts there. Seven of these
    // pairs walked through wall before the seam was crossed square-on.
    const reachable = [...getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, ARRIVAL)];
    const floor = getFloorRects();
    const offFloor: string[] = [];
    for (const fromId of reachable) {
      const [rect] = getSpace(FLOOR_PLAN, fromId).rects;
      const standing: PlanPoint = Object.freeze({
        x: (rect.minX + rect.maxX) / 2,
        z: (rect.minZ + rect.maxZ) / 2,
      });
      if (!isBodyCovered(standing, floor)) {
        continue;
      }
      for (const toId of reachable) {
        const route = findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, standing, toId);
        if (route.length === 0) {
          continue;
        }
        const waypoints = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, route, standing);
        const allowed = getAllowedRects(route);
        let previous = standing;
        for (const waypoint of waypoints) {
          for (const sample of sampleLeg(previous, waypoint)) {
            if (!isBodyCovered(sample, allowed)) {
              offFloor.push(`${fromId} → ${toId} at (${String(sample.x)}, ${String(sample.z)})`);
            }
          }
          previous = waypoint;
        }
      }
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
