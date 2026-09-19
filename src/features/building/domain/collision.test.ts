/**
 * What this file pins, and the two figures that came out other than planned.
 *
 * The floor closes on the 225.00 m² plot in four parts, and this file is where
 * collision is checked against them: FLOOR 165.920 (the slabs) + VOID 9.360 +
 * SHAFT 6.000 + WALLS 43.720. Collision splits the last one where the body is,
 * which is the whole point of the module: 39.6475 m² of that masonry stands at
 * body height and the remaining 4.0725 m² is door thresholds, which are walkable
 * floor. So the walk field's floor is 165.920 + 4.0725 = 169.9925 m², its solids
 * 39.6475 and its holes 15.360, and those three sum to 225.000 exactly.
 *
 * Two counts differ from what the part was planned against:
 *
 * - the thresholds are **24 rectangles, not 19**. A threshold is a wall block,
 *   and `getWallPieces` cuts the walls on a grid that includes every room face,
 *   so a threshold is split wherever such a line crosses it: the master
 *   bedroom's door is cut at z 3.85, where the living room and the two kids'
 *   bedrooms end, the side-A balcony's guest door into two, and the laundry door
 *   into four. Nothing is missing and nothing overlaps — each of the 19 openings
 *   is still tiled exactly, which is what is asserted below, and the 24 pieces
 *   still total 4.0725 m². Asserting "one rect per door" would have required
 *   re-merging the pieces here, which is `walls.ts`'s private cell merge copied
 *   for no behavioural gain;
 * - the `stairs ↔ corridor` zero-gap pair is **not in `PORT_SCHEDULE`** at all —
 *   it is a `JOIN_OVERRIDE` of thickness 0, because the owner's demountable panel
 *   there is deliberately not modelled. So all 19 scheduled ports do have an
 *   opening, and the `getPortOpening` rejection is asserted on a port built for
 *   that pair rather than skipped in the loop.
 *
 * One more fact is recorded rather than worked around: a railing is the only
 * blocker that genuinely overlaps the floor. It straddles the edge it guards, so
 * its inner 0.025 m stands on the balcony slab (`railings.ts`, ADR-008). The
 * no-overlap assertion is therefore made against the blockers that came out of
 * the sweep, and the railing overlap is asserted separately as the expected case.
 */

import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from './builtFloor.ts';
import {
  BODY_SPAN,
  getClearance,
  getWalkField,
  isClear,
  makeWalkField,
  moveBody,
} from './collision.ts';
import type { PlanVector, WalkField } from './collision.ts';
import { FLOOR_PLAN, PLOT_RECT, findSpaceAt, hasFloor } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import { PERSON_SPEC } from './person.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectContainsPoint,
  rectContainsRect,
  rectsOverlap,
} from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { PORT_SCHEDULE, getPortContact, getPortOpening } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { getReachableSpaceIds } from './reachability.ts';
import { getStairsLayout } from './stairs.ts';
import { getWallFootprintArea } from './walls.ts';

const PRECISION_DIGITS = 9;
const NONE = 0;
const ONE = 1;
const HALF = 0.5;

/** Area of the 22.50 × 10.00 m plot, in m² (brief §1, §8). */
const PLOT_AREA = 225;

/** Area the slabs cover, in m²: the plan's own FLOOR total plus the arrival landing. */
const SLAB_AREA = 165.92;

/** Area of the 19 door thresholds, in m²: Σ(port width × the wall thickness it cuts). */
const THRESHOLD_AREA = 4.0725;

/** Area a body may stand on, in m²: the slabs plus the thresholds. */
const FLOOR_AREA = SLAB_AREA + THRESHOLD_AREA;

/** Area of the masonry standing at body height, in m²: the 43.720 m² of wall less the thresholds. */
const SOLID_AREA = 39.6475;

/** Area of the two side-B voids, in m² (brief §5.2). */
const VOID_AREA = 9.36;

/** Area of the open stair shaft, in m²: the 8.00 m² bay less the 2.00 m² arrival landing. */
const SHAFT_AREA = 6;

/** Area a body would fall through, in m². */
const FALL_AREA = VOID_AREA + SHAFT_AREA;

/** Ports in the schedule: 18 doors and the living-room opening. */
const PORT_COUNT = 19;

/** Windows of the floor (`sourceOfTruth/plan.ts`). */
const WINDOW_COUNT = 8;

/** Slabs of the floor: one per clear rect of a floored space, the bay aside. */
const SLAB_COUNT = 22;

/** Threshold pieces the wall grid yields for the 19 doors — see the file header. */
const THRESHOLD_PIECE_COUNT = 24;

/** Guard railings: the three open edges of the side-B strip. */
const RAILING_COUNT = 3;

/** Spaces of the plan that have a floor, and so can be walked to. */
const FLOORED_SPACE_COUNT = 19;

/** Clear width of the narrowest port of the floor, in metres: the guest bath-cubicle door. */
const NARROWEST_PORT_WIDTH = 0.6;

/** Lowest sill of any window of the floor, in metres: the two merged laundry windows. */
const LOWEST_SILL = 0.6;

const BUILT = getBuiltFloor();
const FIELD = getWalkField(BUILT, FLOOR_PLAN.plot);
const STAIRS = getStairsLayout(FLOOR_PLAN);
const RADIUS = PERSON_SPEC.radius;

/** The arrival pose of the floor: the centre of the 1.00 × 2.00 m landing that is floor here. */
const ARRIVAL: PlanPoint = Object.freeze({ x: STAIRS.arrival.x, z: STAIRS.arrival.z });

/**
 * Restates the solid rule of `collision.ts` so the tests test it rather than
 * import it: a box is solid where the body is when it overlaps the body span by
 * more than the length tolerance.
 */
function isSolidAtBodyHeight(box: PlanBox): boolean {
  return (
    Math.min(box.top, BODY_SPAN.top) - Math.max(box.bottom, BODY_SPAN.bottom) > LENGTH_TOLERANCE
  );
}

/** Compares two rectangles face by face, within the length tolerance. */
function sameRect(a: PlanRect, b: PlanRect): boolean {
  return (
    Math.abs(a.minX - b.minX) <= LENGTH_TOLERANCE &&
    Math.abs(a.maxX - b.maxX) <= LENGTH_TOLERANCE &&
    Math.abs(a.minZ - b.minZ) <= LENGTH_TOLERANCE &&
    Math.abs(a.maxZ - b.maxZ) <= LENGTH_TOLERANCE
  );
}

/** Sums the areas of a list of rectangles, in m². */
function totalArea(rects: readonly PlanRect[]): number {
  return rects.reduce((sum, rect) => sum + rectArea(rect), NONE);
}

/**
 * Tells whether a point has floor under it, restating the rule rather than
 * importing it: a floor rectangle contains it, by the exact half-open test of
 * `rectContainsPoint`, so rectangles tiling the floor never both claim an edge.
 *
 * Asked of the point, not of the body circle: this is what a body stands on, and
 * a body may legitimately overhang a threshold or a slab edge its centre is
 * clear of.
 */
function isOnFloor(point: PlanPoint, field: WalkField): boolean {
  return field.floor.some((rect) => rectContainsPoint(rect, point));
}

/** The centre of a rectangle. */
function centreOf(rect: PlanRect): PlanPoint {
  return { x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF };
}

const SLAB_RECTS = BUILT.slabs.map((slab) => slab.rect);
const RAILING_RECTS = BUILT.railings.map((railing) => railing.rect);
const SOLID_RECTS = BUILT.walls.filter(isSolidAtBodyHeight).map((wall) => wall.rect);
const PORT_OPENINGS = PORT_SCHEDULE.map((port) => getPortOpening(FLOOR_PLAN, port).rect);

/** The floor rectangles that are not slabs: the door thresholds. */
const THRESHOLD_RECTS = FIELD.floor.filter(
  (rect) => !SLAB_RECTS.some((slab) => sameRect(rect, slab)),
);

/** The blockers the sweep produced for holes: every blocker that is not masonry or a railing. */
const FALL_CELLS = FIELD.blockers.filter(
  (cell) =>
    !SOLID_RECTS.some((rect) => sameRect(rect, cell)) &&
    !RAILING_RECTS.some((rect) => sameRect(rect, cell)),
);

describe('getWalkField tiling', () => {
  it('closes the 225.00 m² plot on floor, solid and fall', () => {
    const floor = totalArea(FIELD.floor);
    const solid = getWallFootprintArea(BUILT.walls.filter(isSolidAtBodyHeight));
    const fall = totalArea(FALL_CELLS);

    expect(floor).toBeCloseTo(FLOOR_AREA, PRECISION_DIGITS);
    expect(solid).toBeCloseTo(SOLID_AREA, PRECISION_DIGITS);
    expect(fall).toBeCloseTo(FALL_AREA, PRECISION_DIGITS);
    expect(floor + solid + fall).toBeCloseTo(PLOT_AREA, PRECISION_DIGITS);
    expect(rectArea(PLOT_RECT)).toBe(PLOT_AREA);
  });

  it('measures the fall area as the two voids plus the stair shaft', () => {
    const voidRects = FLOOR_PLAN.spaces
      .filter((space) => !hasFloor(space.kind))
      .flatMap((space) => space.rects);

    expect(totalArea(voidRects)).toBeCloseTo(VOID_AREA, PRECISION_DIGITS);
    expect(totalArea(STAIRS.blockedRects)).toBeCloseTo(SHAFT_AREA, PRECISION_DIGITS);
    expect(totalArea(FALL_CELLS)).toBeCloseTo(VOID_AREA + SHAFT_AREA, PRECISION_DIGITS);
  });

  it('puts every fall cell in a void or in the stair shaft', () => {
    const voidRects = FLOOR_PLAN.spaces
      .filter((space) => !hasFloor(space.kind))
      .flatMap((space) => space.rects);
    const misplaced = FALL_CELLS.filter((cell) => {
      const centre = centreOf(cell);
      return (
        !voidRects.some((rect) => rectContainsPoint(rect, centre)) &&
        !STAIRS.blockedRects.some((rect) => rectContainsPoint(rect, centre))
      );
    });

    expect(misplaced).toStrictEqual([]);
    expect(FALL_CELLS.length).toBeGreaterThan(NONE);
  });

  it('classifies every part of the plot once: a hole is never paved or solid', () => {
    expect(
      FALL_CELLS.filter((cell) => SLAB_RECTS.some((slab) => rectsOverlap(slab, cell))),
    ).toStrictEqual([]);
    expect(
      FALL_CELLS.filter((cell) => SOLID_RECTS.some((wall) => rectsOverlap(wall, cell))),
    ).toStrictEqual([]);
  });

  it('never overlaps floor with a blocker the sweep produced', () => {
    const swept = FIELD.blockers.filter(
      (blocker) => !RAILING_RECTS.some((railing) => sameRect(railing, blocker)),
    );
    const overlapping = FIELD.floor.filter((rect) =>
      swept.some((blocker) => rectsOverlap(rect, blocker)),
    );

    expect(overlapping).toStrictEqual([]);
  });

  it('appends the railings after the sweep, overlapping the slab they guard', () => {
    RAILING_RECTS.forEach((railing) => {
      expect(FIELD.blockers.some((blocker) => sameRect(blocker, railing))).toBe(true);
    });
    expect(BUILT.railings).toHaveLength(RAILING_COUNT);
    // The overhang of ADR-008: each railing stands partly on the floor it guards.
    expect(
      FIELD.floor.filter((rect) => RAILING_RECTS.some((r) => rectsOverlap(rect, r))).length,
    ).toBeGreaterThan(NONE);
  });

  it('seals the floor inside the plot: nothing walkable touches the boundary', () => {
    const touching = FIELD.floor.filter(
      (rect) =>
        Math.abs(rect.minX - PLOT_RECT.minX) <= LENGTH_TOLERANCE ||
        Math.abs(rect.maxX - PLOT_RECT.maxX) <= LENGTH_TOLERANCE ||
        Math.abs(rect.minZ - PLOT_RECT.minZ) <= LENGTH_TOLERANCE ||
        Math.abs(rect.maxZ - PLOT_RECT.maxZ) <= LENGTH_TOLERANCE,
    );

    expect(touching).toStrictEqual([]);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(FIELD)).toBe(true);
    expect(Object.isFrozen(FIELD.floor)).toBe(true);
    expect(Object.isFrozen(FIELD.blockers)).toBe(true);
    FIELD.floor.forEach((rect) => expect(Object.isFrozen(rect)).toBe(true));
    FIELD.blockers.forEach((rect) => expect(Object.isFrozen(rect)).toBe(true));
  });
});

describe('getWalkField thresholds', () => {
  it('makes every door a walkable threshold, tiled exactly', () => {
    expect(PORT_SCHEDULE).toHaveLength(PORT_COUNT);
    PORT_OPENINGS.forEach((opening, index) => {
      const pieces = FIELD.floor.filter((rect) => rectContainsRect(opening, rect));
      const port = PORT_SCHEDULE[index];

      expect(pieces.length).toBeGreaterThan(NONE);
      expect(totalArea(pieces)).toBeCloseTo(rectArea(opening), PRECISION_DIGITS);
      expect(rectArea(opening)).toBeCloseTo(
        port.width * getPortContact(FLOOR_PLAN, port).gap,
        PRECISION_DIGITS,
      );
    });
  });

  it('adds the thresholds to the slabs and nothing else', () => {
    expect(BUILT.slabs).toHaveLength(SLAB_COUNT);
    expect(THRESHOLD_RECTS).toHaveLength(THRESHOLD_PIECE_COUNT);
    expect(totalArea(THRESHOLD_RECTS)).toBeCloseTo(THRESHOLD_AREA, PRECISION_DIGITS);
    expect(totalArea(SLAB_RECTS)).toBeCloseTo(SLAB_AREA, PRECISION_DIGITS);

    // No walkable masonry anywhere but under a door: every threshold piece lies
    // inside exactly one port opening.
    THRESHOLD_RECTS.forEach((rect) => {
      expect(PORT_OPENINGS.filter((opening) => rectContainsRect(opening, rect))).toHaveLength(ONE);
    });
  });

  it('rejects an opening for the zero-gap stairs ↔ corridor join', () => {
    // That pair is a JOIN_OVERRIDE of thickness 0, not a port: there is no wall
    // to cut, so a port drawn there cannot have an opening.
    const acrossTheJoin: Port = {
      spaces: ['stairs', 'corridor'],
      kind: 'door',
      along: 'z',
      spanMin: 4.5,
      width: 0.9,
    };

    expect(() => getPortOpening(FLOOR_PLAN, acrossTheJoin)).toThrow(RangeError);
    expect(() => getPortOpening(FLOOR_PLAN, acrossTheJoin)).toThrow(/no wall to cut/);
    expect(
      PORT_SCHEDULE.filter(
        (port) => port.spaces.includes('stairs') && port.spaces.includes('corridor'),
      ),
    ).toStrictEqual([]);
  });
});

describe('getWalkField refuses windows', () => {
  it('leaves the wall solid at body height at every window', () => {
    expect(BUILT.windows).toHaveLength(WINDOW_COUNT);
    BUILT.windows.forEach((window) => {
      const centre = centreOf(window.opening.rect);

      expect(FIELD.blockers.some((rect) => rectContainsPoint(rect, centre))).toBe(true);
      expect(isOnFloor(centre, FIELD)).toBe(false);
    });
  });

  it('states the invariant that makes it so: every sill is above the body span floor', () => {
    const sills = BUILT.windows.map((window) => window.sill);

    expect(Math.min(...sills)).toBe(LOWEST_SILL);
    expect(Math.min(...sills)).toBeGreaterThan(BODY_SPAN.bottom + LENGTH_TOLERANCE);
  });
});

describe('the three predicates are exclusive', () => {
  /** A one-square-metre plot, so one box classifies the whole field. */
  const CELL = makeRect(0, 1, 0, 1);

  /** Underside of the slab, in metres: where a wall of this floor starts. */
  const SLAB_UNDERSIDE = -0.3;

  /** Top of a full-height wall, in metres. */
  const WALL_TOP = 2.7;

  /** Bottom of a door lintel, in metres: the door head. */
  const LINTEL_BOTTOM = 2.1;

  /** Top of a stated parapet, in metres: the side-A balustrade. */
  const PARAPET_TOP = 1.1;

  function fieldOf(box: PlanBox): WalkField {
    return getWalkField({ walls: [box], slabs: [], railings: [] }, CELL);
  }

  it('reads a box whose top is the finished floor as floor, never as solid', () => {
    const threshold = fieldOf(makeBox(CELL, SLAB_UNDERSIDE, BODY_SPAN.bottom));

    expect(threshold.floor).toHaveLength(ONE);
    expect(threshold.floor[0]).toStrictEqual(CELL);
    expect(threshold.blockers).toStrictEqual([]);
  });

  it('reads a lintel as neither floor nor solid, so the plot under it falls', () => {
    const lintel = fieldOf(makeBox(CELL, LINTEL_BOTTOM, WALL_TOP));

    expect(lintel.floor).toStrictEqual([]);
    expect(lintel.blockers).toHaveLength(ONE);
    expect(lintel.blockers[0]).toStrictEqual(CELL);
  });

  it('reads a parapet as solid', () => {
    const parapet = fieldOf(makeBox(CELL, BODY_SPAN.bottom, PARAPET_TOP));

    expect(parapet.floor).toStrictEqual([]);
    expect(parapet.blockers).toHaveLength(ONE);
    expect(parapet.blockers[0]).toStrictEqual(CELL);
  });

  it('reads a full-height wall as solid', () => {
    const wall = fieldOf(makeBox(CELL, SLAB_UNDERSIDE, WALL_TOP));

    expect(wall.floor).toStrictEqual([]);
    expect(wall.blockers).toHaveLength(ONE);
  });

  it('classifies bare plot with no box at all as a fall', () => {
    const bare = getWalkField({ walls: [], slabs: [], railings: [] }, CELL);

    expect(bare.floor).toStrictEqual([]);
    expect(bare.blockers).toHaveLength(ONE);
  });
});

describe('makeWalkField', () => {
  it('freezes the arrays and every rectangle in them', () => {
    const floor = [{ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }];
    const blockers = [{ minX: 1, maxX: 2, minZ: 0, maxZ: 1 }];
    const field = makeWalkField(floor, blockers);

    expect(Object.isFrozen(field)).toBe(true);
    expect(Object.isFrozen(field.floor)).toBe(true);
    expect(Object.isFrozen(field.blockers)).toBe(true);
    expect(Object.isFrozen(field.floor[0])).toBe(true);
    expect(Object.isFrozen(field.blockers[0])).toBe(true);
  });

  it('copies the lists rather than capturing them', () => {
    const floor: PlanRect[] = [makeRect(0, 1, 0, 1)];
    const field = makeWalkField(floor, []);
    floor.push(makeRect(5, 6, 5, 6));

    expect(field.floor).toHaveLength(ONE);
  });
});

describe('moveBody on the real floor', () => {
  /** The master bedroom's clear rect: x 1.60–6.60, z 0.30–3.70, walls all round. */
  const MASTER_WEST_FACE = 1.6;
  const MASTER_NORTH_FACE = 0.3;

  /** Where the body comes to rest against those two faces, in metres. */
  const FLUSH_WEST = MASTER_WEST_FACE + RADIUS;
  const FLUSH_NORTH = MASTER_NORTH_FACE + RADIUS;

  it('stops flush at the face minus the radius', () => {
    const move = moveBody({ x: 3, z: 1 }, { x: 0, z: -2 }, FIELD, RADIUS);

    expect(move.point.z).toBeCloseTo(FLUSH_NORTH, PRECISION_DIGITS);
    expect(move.point.x).toBe(3);
    expect(move.blocked).toBe(true);
  });

  it('slides on a diagonal: x runs on while z clamps', () => {
    const move = moveBody({ x: 3, z: 1 }, { x: 1, z: -1 }, FIELD, RADIUS);

    expect(move.applied.x).toBeCloseTo(1, PRECISION_DIGITS);
    expect(move.point.z).toBeCloseTo(FLUSH_NORTH, PRECISION_DIGITS);
    expect(move.blocked).toBe(true);
  });

  it('slides on the mirrored diagonal: z runs on while x clamps', () => {
    const move = moveBody({ x: 2, z: 1 }, { x: -1, z: 1 }, FIELD, RADIUS);

    expect(move.applied.z).toBeCloseTo(1, PRECISION_DIGITS);
    expect(move.point.x).toBeCloseTo(FLUSH_WEST, PRECISION_DIGITS);
    expect(move.blocked).toBe(true);
  });

  it('wedges in an inside corner: both axes clamp and the body does not move', () => {
    const move = moveBody({ x: FLUSH_WEST, z: FLUSH_NORTH }, { x: -1, z: -1 }, FIELD, RADIUS);

    expect(move.applied).toStrictEqual({ x: NONE, z: NONE });
    expect(move.blocked).toBe(true);
  });

  it('slides flush ALONG a face it has already stopped against, unblocked', () => {
    // This is what the strict band test buys: after stopping at face − radius the
    // body sits exactly on the edge of the neighbouring band, and a non-strict
    // test would judge it inside and refuse to let it move at all.
    const stopped = moveBody({ x: 3, z: 1 }, { x: 0, z: -2 }, FIELD, RADIUS);
    const along = moveBody(stopped.point, { x: 1, z: 0 }, FIELD, RADIUS);

    expect(along.point.z).toBeCloseTo(FLUSH_NORTH, PRECISION_DIGITS);
    expect(along.applied.x).toBeCloseTo(1, PRECISION_DIGITS);
    expect(along.blocked).toBe(false);
  });

  it('reports an idle request as not blocked', () => {
    const move = moveBody({ x: 3, z: 1 }, { x: 0, z: 0 }, FIELD, RADIUS);

    expect(move.applied).toStrictEqual({ x: NONE, z: NONE });
    expect(move.point).toStrictEqual({ x: 3, z: 1 });
    expect(move.blocked).toBe(false);
  });

  it('walks through a 0.90 m doorjamb only inside the width the body leaves', () => {
    const port = PORT_SCHEDULE.filter(
      (candidate) => candidate.spaces[0] === 'masterBedroom' && candidate.spaces[1] === 'corridor',
    )[0];
    const opening = getPortOpening(FLOOR_PLAN, port).rect;
    const start = opening.minZ - RADIUS;
    const travel = opening.maxZ + RADIUS - start;
    const windowMin = opening.minX + RADIUS;
    const windowMax = opening.maxX - RADIUS;
    const crossAt = (x: number): boolean =>
      !moveBody({ x, z: start }, { x: 0, z: travel }, FIELD, RADIUS).blocked;

    expect(windowMax - windowMin).toBeCloseTo(port.width - 2 * RADIUS, PRECISION_DIGITS);
    expect(crossAt(centreOf(opening).x)).toBe(true);
    expect(crossAt(windowMin)).toBe(true);
    expect(crossAt(windowMax)).toBe(true);
    expect(crossAt(windowMin - 0.01)).toBe(false);
    expect(crossAt(windowMax + 0.01)).toBe(false);
  });

  it('passes a 0.50 m body through the 0.60 m guest cubicle door', () => {
    const port = PORT_SCHEDULE.filter(
      (candidate) =>
        candidate.spaces[0] === 'guestSanitair' && candidate.spaces[1] === 'guestBathCubicle',
    )[0];
    const opening = getPortOpening(FLOOR_PLAN, port).rect;
    const start = opening.minZ - RADIUS;
    const travel = opening.maxZ + RADIUS - start;
    const passable = opening.maxX - RADIUS - (opening.minX + RADIUS);

    expect(port.width).toBe(NARROWEST_PORT_WIDTH);
    expect(passable).toBeCloseTo(NARROWEST_PORT_WIDTH - 2 * RADIUS, PRECISION_DIGITS);

    const centred = moveBody(
      { x: centreOf(opening).x, z: start },
      { x: 0, z: travel },
      FIELD,
      RADIUS,
    );

    expect(centred.blocked).toBe(false);
    expect(findSpaceAt(FLOOR_PLAN, centred.point)?.id).toBe('guestBathCubicle');
  });

  it('does not tunnel a 0.15 m partition, however long the step', () => {
    // The laundry | main sanitair partition, x 17.55–17.70. Its door spans
    // z 5.90–6.80, so z 7.00 is masonry.
    const LAUNDRY_EAST_FACE = 17.55;

    /** A step too short to reach the wall: it must simply be taken. */
    const SHORT_STEP = 0.5;
    const from: PlanPoint = { x: 16.5, z: 7 };
    const short = moveBody(from, { x: SHORT_STEP, z: 0 }, FIELD, RADIUS);

    expect(short.point.x).toBeCloseTo(from.x + SHORT_STEP, PRECISION_DIGITS);
    expect(short.blocked).toBe(false);

    // Every step that WOULD reach past the wall stops flush at the same place,
    // however far past it aimed: the clamp is to the near face, not to the target.
    [1, 5, 50].forEach((distance) => {
      const move = moveBody(from, { x: distance, z: 0 }, FIELD, RADIUS);

      expect(move.point.x).toBeCloseTo(LAUNDRY_EAST_FACE - RADIUS, PRECISION_DIGITS);
      expect(move.blocked).toBe(true);
    });
  });

  it('does not tunnel a 0.05 m railing, however long the step', () => {
    // The control-centre balcony's rail straddles the void edge at x 4.90, so its
    // near face is 0.025 in front of it and the body stops 0.275 short of the void.
    const VOID_EDGE = 4.9;
    const RAIL_OVERHANG = 0.025;
    const move = moveBody({ x: 4.5, z: 9.3 }, { x: 50, z: 0 }, FIELD, RADIUS);

    expect(move.point.x).toBeCloseTo(VOID_EDGE - RAIL_OVERHANG - RADIUS, PRECISION_DIGITS);
    expect(VOID_EDGE - move.point.x).toBeCloseTo(RAIL_OVERHANG + RADIUS, PRECISION_DIGITS);
    expect(move.blocked).toBe(true);
  });

  it('never crosses a gap narrower than the body, however many steps', () => {
    /** Two blockers leaving a 0.40 m gap: less than the 0.50 m the body needs. */
    const GAP_MIN = 1;
    const GAP_MAX = 1.4;
    const narrow = makeWalkField(
      [makeRect(-2, 4, -2, 4)],
      [makeRect(0, 1, -2, GAP_MIN), makeRect(0, 1, GAP_MAX, 4)],
    );
    let at: PlanPoint = { x: -1, z: (GAP_MIN + GAP_MAX) * HALF };

    for (let step = 0; step < 50; step += 1) {
      at = moveBody(at, { x: 0.5, z: 0 }, narrow, RADIUS).point;
    }

    expect(at.x).toBeCloseTo(-RADIUS, PRECISION_DIGITS);
    expect(at.x).toBeLessThan(NONE);
  });

  it('is pure: it mutates neither the point, the step nor the field', () => {
    const from: PlanPoint = Object.freeze({ x: 3, z: 1 });
    const delta: PlanVector = Object.freeze({ x: 1, z: -1 });
    const floorBefore = FIELD.floor.length;
    const blockersBefore = FIELD.blockers.length;
    const move = moveBody(from, delta, FIELD, RADIUS);

    expect(from).toStrictEqual({ x: 3, z: 1 });
    expect(delta).toStrictEqual({ x: 1, z: -1 });
    expect(move.requested).toStrictEqual({ x: 1, z: -1 });
    expect(FIELD.floor).toHaveLength(floorBefore);
    expect(FIELD.blockers).toHaveLength(blockersBefore);
    expect(moveBody(from, delta, FIELD, RADIUS)).toStrictEqual(move);
  });
});

describe('getClearance', () => {
  /** A field with a single blocker at x 2.00–3.00, z 0.00–1.00. */
  const BLOCKER = makeRect(2, 3, 0, 1);
  const LONE = makeWalkField([makeRect(-5, 5, -5, 5)], [BLOCKER]);
  const EAST: PlanVector = Object.freeze({ x: 1, z: 0 });

  it('is Infinity when nothing is in the way', () => {
    const empty = makeWalkField([makeRect(-5, 5, -5, 5)], []);

    expect(getClearance({ x: 0, z: 0.5 }, EAST, empty, RADIUS)).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures the exact face distance at a zero radius', () => {
    expect(getClearance({ x: 0, z: 0.5 }, EAST, LONE, NONE)).toBeCloseTo(2, PRECISION_DIGITS);
  });

  it('measures the face distance less the radius for a body', () => {
    const THIN = 0.15;

    expect(getClearance({ x: 0, z: 0.5 }, EAST, LONE, THIN)).toBeCloseTo(
      2 - THIN,
      PRECISION_DIGITS,
    );
  });

  it('ignores a face the direction runs parallel to', () => {
    // Level with the blocker's z faces but clear of its band: nothing ahead.
    expect(getClearance({ x: 0, z: 2 }, EAST, LONE, NONE)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is zero when the body already overlaps a blocker', () => {
    expect(getClearance({ x: 2.5, z: 0.5 }, EAST, LONE, NONE)).toBe(NONE);
    expect(getClearance({ x: 1.9, z: 0.5 }, EAST, LONE, RADIUS)).toBe(NONE);
  });

  it('is Infinity for a direction of zero length', () => {
    expect(getClearance({ x: 0, z: 0.5 }, { x: 0, z: 0 }, LONE, RADIUS)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('measures the real floor: the master bedroom walls from one point', () => {
    const MASTER_NORTH_FACE = 0.3;
    const from: PlanPoint = { x: 3, z: 1 };

    expect(getClearance(from, { x: 0, z: -1 }, FIELD, NONE)).toBeCloseTo(
      1 - MASTER_NORTH_FACE,
      PRECISION_DIGITS,
    );
    expect(getClearance(from, { x: 0, z: -1 }, FIELD, RADIUS)).toBeCloseTo(
      1 - MASTER_NORTH_FACE - RADIUS,
      PRECISION_DIGITS,
    );
  });
});

describe('isClear against the floor rectangles', () => {
  it('lets the body stand on the arrival landing', () => {
    expect(isOnFloor(ARRIVAL, FIELD)).toBe(true);
    expect(isClear(ARRIVAL, FIELD, RADIUS)).toBe(true);
  });

  it('lets the body stand in a doorway', () => {
    const opening = PORT_OPENINGS[ONE];

    expect(isOnFloor(centreOf(opening), FIELD)).toBe(true);
  });

  it('refuses a void and the stair shaft', () => {
    const inVoid: PlanPoint = { x: 8, z: 9.3 };
    const inShaft: PlanPoint = { x: 3.5, z: 5 };

    expect(isOnFloor(inVoid, FIELD)).toBe(false);
    expect(isClear(inVoid, FIELD, RADIUS)).toBe(false);
    expect(isOnFloor(inShaft, FIELD)).toBe(false);
    expect(isClear(inShaft, FIELD, RADIUS)).toBe(false);
  });
});

describe('ports against the body', () => {
  it('is wider than the body at every port, the narrowest named', () => {
    PORT_SCHEDULE.forEach((port) => {
      expect(port.width).toBeGreaterThan(2 * RADIUS + LENGTH_TOLERANCE);
    });
    expect(Math.min(...PORT_SCHEDULE.map((port) => port.width))).toBe(NARROWEST_PORT_WIDTH);
    expect(NARROWEST_PORT_WIDTH).toBeGreaterThan(2 * PERSON_SPEC.radius);
  });
});

describe('the stairs shaft', () => {
  it('stops a body walking west off the arrival landing', () => {
    const move = moveBody(ARRIVAL, { x: -50, z: 0 }, FIELD, RADIUS);
    const inBand = STAIRS.blockedRects.filter(
      (rect) => ARRIVAL.z > rect.minZ - RADIUS && ARRIVAL.z < rect.maxZ + RADIUS,
    );
    const nearest = Math.max(...inBand.map((rect) => rect.maxX));

    expect(inBand.length).toBeGreaterThan(NONE);
    expect(move.point.x).toBeCloseTo(nearest + RADIUS, PRECISION_DIGITS);
    expect(move.blocked).toBe(true);
    expect(ARRIVAL.x - move.point.x).toBeCloseTo(ARRIVAL.x - nearest - RADIUS, PRECISION_DIGITS);
  });

  it('leaves the body a whole radius clear of the shaft edge', () => {
    const move = moveBody(ARRIVAL, { x: -50, z: 0 }, FIELD, RADIUS);
    const landingWestFace = STAIRS.landingRect.minX;

    expect(move.point.x - landingWestFace).toBeCloseTo(RADIUS, PRECISION_DIGITS);
  });
});

describe('reachability against collision', () => {
  /**
   * Crosses one port by walking flush to flush: from the body resting against
   * the wall on one side, across the opening, to resting against it on the other.
   */
  function crossPort(port: Port): readonly [SpaceId | undefined, SpaceId | undefined] {
    const opening = getPortOpening(FLOOR_PLAN, port).rect;
    const alongX =
      getPortContact(FLOOR_PLAN, port).side === 'minZ' ||
      getPortContact(FLOOR_PLAN, port).side === 'maxZ';
    const centre = centreOf(opening);
    const nearFace = (alongX ? opening.minZ : opening.minX) - RADIUS;
    const farFace = (alongX ? opening.maxZ : opening.maxX) + RADIUS;
    const at = (across: number): PlanPoint =>
      alongX ? { x: centre.x, z: across } : { x: across, z: centre.z };
    const travel = farFace - nearFace;
    const forward = moveBody(
      at(nearFace),
      alongX ? { x: 0, z: travel } : { x: travel, z: 0 },
      FIELD,
      RADIUS,
    );
    const back = moveBody(
      at(farFace),
      alongX ? { x: 0, z: -travel } : { x: -travel, z: 0 },
      FIELD,
      RADIUS,
    );

    expect(forward.blocked).toBe(false);
    expect(back.blocked).toBe(false);
    return [findSpaceAt(FLOOR_PLAN, back.point)?.id, findSpaceAt(FLOOR_PLAN, forward.point)?.id];
  }

  it('crosses every port both ways and reaches exactly the reachable spaces', () => {
    const adjacency = new Map<SpaceId, Set<SpaceId>>();
    PORT_SCHEDULE.forEach((port) => {
      const [from, to] = crossPort(port);

      expect(from).toBeDefined();
      expect(to).toBeDefined();
      if (from === undefined || to === undefined) {
        return;
      }
      (adjacency.get(from) ?? adjacency.set(from, new Set()).get(from))?.add(to);
      (adjacency.get(to) ?? adjacency.set(to, new Set()).get(to))?.add(from);
    });

    const start = findSpaceAt(FLOOR_PLAN, ARRIVAL)?.id;
    expect(start).toBe('stairs');

    const reached = new Set<SpaceId>(start === undefined ? [] : [start]);
    const queue: SpaceId[] = [...reached];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      adjacency.get(queue[cursor])?.forEach((next) => {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      });
    }

    const expected = getReachableSpaceIds(FLOOR_PLAN, PORT_SCHEDULE, ARRIVAL);

    expect(reached.size).toBe(FLOORED_SPACE_COUNT);
    expect([...reached].sort()).toStrictEqual([...expected].sort());
    expect(FLOOR_PLAN.spaces.filter((space) => hasFloor(space.kind))).toHaveLength(
      FLOORED_SPACE_COUNT,
    );
  });
});
