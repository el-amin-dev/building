import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from './builtFloor.ts';
import { FLOOR_PLAN, PLOT_RECT, getSpaceArea } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import type { PlanBox } from './planBox.ts';
import {
  LENGTH_TOLERANCE,
  rectArea,
  rectContainsPoint,
  rectsOverlap,
  toPlanLength,
} from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { PORT_SCHEDULE, getPortOpening } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { getWallFootprintArea, getWallPieces } from './walls.ts';
import type { FloorWindow } from './windows.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const NONE = 0;
const ONE = 1;

/** Level of the finished floor: the datum every vertical size is measured from. */
const FLOOR_LEVEL = 0;

/** Underside of the slab, where every wall starts: −0.30 m (3.00 − 2.70). */
const SLAB_BOTTOM = -(FLOOR_HEIGHTS.floorToFloor - FLOOR_HEIGHTS.wall);

/* ------------------------------------------------------------------ *
 * Composed counts of the typical floor.
 * ------------------------------------------------------------------ */

/** Ports of the door schedule, brief §6 as amended by ADR-006. */
const PORT_COUNT = 19;
/** Windows the rule of ADR-006 places on the side-A and side-B faces. */
const WINDOW_COUNT = 8;
/** Holes fed to the wall generator: every port opening, then every window opening. */
const OPENING_COUNT = PORT_COUNT + WINDOW_COUNT;
/** Wall blocks left once the 27 openings are punched out. */
const WALL_PIECE_COUNT = 218;
/** Blocks that start at the underside of the slab. */
const BASE_PIECE_COUNT = 172;
/** Blocks that start at the head of an opening: the lintels. */
const HEAD_PIECE_COUNT = 46;
/** One slab per clear rect of every space that has a floor. */
const SLAB_COUNT = 18;
/** Guard railings on the two balcony-slab/void edges of the side-B strip. */
const RAILING_COUNT = 2;
/** Steps of the dog-leg: 8 treads, the half-landing, 8 treads. */
const STEP_COUNT = 17;

/* ------------------------------------------------------------------ *
 * Areas of brief §8.
 * ------------------------------------------------------------------ */

/** Wall footprint of the typical floor, brief §8, in square metres. */
const WALL_FOOTPRINT_AREA = 42.52;
/** Floor total of the typical floor, brief §8, in square metres. */
const FLOOR_AREA_TOTAL = 167.38;
/** The side-B void, in square metres: the plot less the walls and the floors. */
const VOID_AREA = 15.1;
/** The 22.50 × 10.00 m plot of brief §1, in square metres. */
const PLOT_AREA = 225;

/* ------------------------------------------------------------------ *
 * Injected heights.
 * ------------------------------------------------------------------ */

/**
 * Vertical sizes with every field changed, to prove that no level of a
 * {@link BuiltFloor} is hard-coded. No value is a real one, and neither the slab
 * thickness they imply (4.44 − 3.33 = 1.11) nor any of the 17 tread tops
 * (k · 4.44 / 17) lands on a real level.
 */
const OTHER_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 4.44,
  wall: 3.33,
  door: 2.22,
  railing: 1.55,
  windowSill: 1.11,
  windowHead: 2.22,
});

/**
 * Levels that must never appear once {@link OTHER_HEIGHTS} is injected: every
 * production height, the slab underside it implies, and the riser of the real
 * floor-to-floor height.
 */
const FORBIDDEN_LEVELS: readonly number[] = [
  FLOOR_HEIGHTS.floorToFloor,
  FLOOR_HEIGHTS.wall,
  FLOOR_HEIGHTS.door,
  FLOOR_HEIGHTS.railing,
  FLOOR_HEIGHTS.windowSill,
  SLAB_BOTTOM,
  -SLAB_BOTTOM,
  FLOOR_HEIGHTS.floorToFloor / STEP_COUNT,
];

/* ------------------------------------------------------------------ *
 * Mutation-guard figures.
 * ------------------------------------------------------------------ */

/** Wall blocks when only the 19 port openings are punched out. */
const PORT_ONLY_PIECE_COUNT = 173;
/** Blocks covering a window centre when the windows are dropped: the wall is solid. */
const SOLID_PIECES_AT_WINDOW = 1;

/**
 * Clear width of a default door leaf, taken from the schedule rather than written
 * here, for the synthetic port of the validation guard.
 */
const DOOR_WIDTH = PORT_SCHEDULE[0].width;

/**
 * A port across the stairs/corridor join, which brief §4.2 leaves without a wall.
 * `validatePorts` must reject it, so `getBuiltFloor` never reaches the wall
 * generator with a hole that cuts nothing.
 */
const ZERO_WALL_PORT: Port = Object.freeze({
  spaces: Object.freeze(['stairs', 'corridor'] as const),
  kind: 'door',
  along: 'z',
  spanMin: 4.2,
  width: DOOR_WIDTH,
});

const FLOOR = getBuiltFloor();

/** The 19 port openings of {@link FLOOR}, in schedule order. */
const PORT_OPENINGS = FLOOR.openings.slice(0, PORT_COUNT);

/**
 * Names a port for a test title.
 *
 * @param port - The port to name.
 * @returns The two space ids joined, such as `corridor ↔ kitchen`.
 */
function portLabel(port: Port): string {
  const [first, second] = port.spaces;
  return `${first} ↔ ${second}`;
}

/** Every port of the schedule with its name and its opening, for the hole table. */
const PORT_CASES: readonly (readonly [string, PlanBox])[] = PORT_SCHEDULE.map(
  (port, index) => [portLabel(port), PORT_OPENINGS[index]] as const,
);

/** Every window with its name, for the hole table. */
const WINDOW_CASES: readonly (readonly [string, FloorWindow])[] = FLOOR.windows.map(
  (window) => [`${window.spaceId} ${window.side}`, window] as const,
);

/**
 * Returns the centre of a rectangle, which never lies on a grid line of the wall
 * generator and so identifies the wall blocks over one opening exactly.
 *
 * @param rect - The rectangle to measure.
 * @returns Its midpoint, in plan coordinates.
 */
function centreOf(rect: PlanRect): PlanPoint {
  return { x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF };
}

/**
 * Formats a footprint for a failure message.
 *
 * @param rect - The rectangle to format.
 * @returns Its four faces, in metres.
 */
function footprintKey(rect: PlanRect): string {
  return `x ${String(rect.minX)}–${String(rect.maxX)} z ${String(rect.minZ)}–${String(rect.maxZ)}`;
}

/**
 * Tells whether two boxes share a volume.
 *
 * @param a - First box.
 * @param b - Second box.
 * @returns `true` when their footprints overlap and their vertical spans do, both
 *   by more than {@link LENGTH_TOLERANCE}; boxes that merely touch do not overlap.
 */
function boxesOverlap(a: PlanBox, b: PlanBox): boolean {
  return (
    rectsOverlap(a.rect, b.rect) &&
    Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > LENGTH_TOLERANCE
  );
}

/**
 * Lists the wall blocks that stand in the way of an opening.
 *
 * @param pieces - The wall blocks to search.
 * @param opening - The hole that must be clear.
 * @returns The blocks covering the opening's centre whose span overlaps its own.
 */
function coveringPieces(pieces: readonly PlanBox[], opening: PlanBox): readonly PlanBox[] {
  const centre = centreOf(opening.rect);
  return pieces.filter(
    (piece) =>
      rectContainsPoint(piece.rect, centre) &&
      Math.min(piece.top, opening.top) - Math.max(piece.bottom, opening.bottom) > LENGTH_TOLERANCE,
  );
}

/**
 * Lists the wall blocks sitting on top of an opening: its lintel.
 *
 * @param pieces - The wall blocks to search.
 * @param opening - The hole to look above.
 * @returns The blocks over the opening's centre that start at or above its head.
 */
function piecesAbove(pieces: readonly PlanBox[], opening: PlanBox): readonly PlanBox[] {
  const centre = centreOf(opening.rect);
  return pieces.filter(
    (piece) =>
      rectContainsPoint(piece.rect, centre) && piece.bottom >= opening.top - LENGTH_TOLERANCE,
  );
}

/**
 * Lists the wall blocks under an opening: a threshold under a door, a sill under
 * a window.
 *
 * @param pieces - The wall blocks to search.
 * @param opening - The hole to look below.
 * @returns The blocks under the opening's centre that end at or below its underside.
 */
function piecesBelow(pieces: readonly PlanBox[], opening: PlanBox): readonly PlanBox[] {
  const centre = centreOf(opening.rect);
  return pieces.filter(
    (piece) =>
      rectContainsPoint(piece.rect, centre) && piece.top <= opening.bottom + LENGTH_TOLERANCE,
  );
}

/**
 * Sums the footprints of a set of boxes.
 *
 * @param boxes - The boxes to measure.
 * @returns The total area, in square metres.
 */
function totalRectArea(boxes: readonly { readonly rect: PlanRect }[]): number {
  return boxes.reduce((sum, box) => sum + rectArea(box.rect), 0);
}

/**
 * Tells whether a level equals one of a set of levels.
 *
 * @param level - The level to test, in metres.
 * @param levels - The levels to match against.
 * @returns `true` when one of them is within {@link LENGTH_TOLERANCE} of `level`.
 */
function isOneOf(level: number, levels: readonly number[]): boolean {
  return levels.some((candidate) => Math.abs(level - candidate) <= LENGTH_TOLERANCE);
}

/**
 * Returns the area of the plan that has no floor: the side-B void.
 *
 * Derived from the plan rather than written down, so the 225.00 m² total is a
 * check on the plan and not on a copied number.
 *
 * @param plan - The floor plan to measure.
 * @returns The summed area of its `'void'` spaces, in square metres.
 */
function voidArea(plan: typeof FLOOR_PLAN): number {
  return plan.spaces
    .filter((space) => space.kind === 'void')
    .reduce((sum, space) => sum + getSpaceArea(space), 0);
}

/**
 * Lists every vertical level a built floor carries, across every part of it.
 *
 * @param floor - The built floor to read.
 * @returns Every bottom and top of the walls, the slabs, the steps, the TV panel,
 *   the window openings and the port openings, plus the railing tops.
 */
function everyLevel(floor: ReturnType<typeof getBuiltFloor>): readonly number[] {
  return [
    ...floor.walls.flatMap((piece) => [piece.bottom, piece.top]),
    ...floor.slabs.flatMap((slab) => [slab.bottom, slab.top]),
    ...floor.railings.map((railing) => railing.top),
    ...floor.stairs.steps.flatMap((step) => [step.bottom, step.top]),
    floor.tvPanel.bottom,
    floor.tvPanel.top,
    ...floor.windows.flatMap((window) => [window.opening.bottom, window.opening.top]),
    ...floor.openings.flatMap((opening) => [opening.bottom, opening.top]),
  ];
}

describe('the composed floor', () => {
  it('builds every part of the typical floor once', () => {
    expect(FLOOR.walls).toHaveLength(WALL_PIECE_COUNT);
    expect(FLOOR.slabs).toHaveLength(SLAB_COUNT);
    expect(FLOOR.railings).toHaveLength(RAILING_COUNT);
    expect(FLOOR.windows).toHaveLength(WINDOW_COUNT);
    expect(FLOOR.stairs.steps).toHaveLength(STEP_COUNT);
    expect(FLOOR.openings).toHaveLength(OPENING_COUNT);
  });

  it('defaults to the real plan, the real schedule and the real heights', () => {
    expect(getBuiltFloor()).toEqual(getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, FLOOR_HEIGHTS));
  });

  it('lists the port openings first, then the window openings', () => {
    PORT_SCHEDULE.forEach((port, index) => {
      expect(FLOOR.openings[index]).toEqual(getPortOpening(FLOOR_PLAN, port));
    });
    FLOOR.windows.forEach((window, index) => {
      expect(FLOOR.openings[PORT_COUNT + index]).toBe(window.opening);
    });
  });

  it('gives the doors a door head and the windows a sill and a head', () => {
    PORT_OPENINGS.forEach((opening) => {
      expect(opening.bottom).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
      expect(opening.top).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
    });
    FLOOR.windows.forEach((window) => {
      expect(window.opening.bottom).toBeCloseTo(FLOOR_HEIGHTS.windowSill, PRECISION_DIGITS);
      expect(window.opening.top).toBeCloseTo(FLOOR_HEIGHTS.windowHead, PRECISION_DIGITS);
    });
  });

  it('splits the walls into bases on the slab and lintels over the openings', () => {
    const bases = FLOOR.walls.filter(
      (piece) => Math.abs(piece.bottom - SLAB_BOTTOM) <= LENGTH_TOLERANCE,
    );
    const heads = FLOOR.walls.filter((piece) => piece.bottom > SLAB_BOTTOM + LENGTH_TOLERANCE);

    expect(bases).toHaveLength(BASE_PIECE_COUNT);
    expect(heads).toHaveLength(HEAD_PIECE_COUNT);
    expect(bases.length + heads.length).toBe(WALL_PIECE_COUNT);
  });

  it('returns a frozen result whose arrays and members are frozen', () => {
    expect(Object.isFrozen(FLOOR)).toBe(true);
    expect(Object.isFrozen(FLOOR.walls)).toBe(true);
    expect(Object.isFrozen(FLOOR.slabs)).toBe(true);
    expect(Object.isFrozen(FLOOR.railings)).toBe(true);
    expect(Object.isFrozen(FLOOR.windows)).toBe(true);
    expect(Object.isFrozen(FLOOR.openings)).toBe(true);
    expect(Object.isFrozen(FLOOR.stairs)).toBe(true);
    expect(Object.isFrozen(FLOOR.stairs.steps)).toBe(true);
    expect(Object.isFrozen(FLOOR.tvPanel)).toBe(true);
    [...FLOOR.walls, ...FLOOR.slabs, ...FLOOR.openings, ...FLOOR.stairs.steps].forEach((box) => {
      expect(Object.isFrozen(box)).toBe(true);
      expect(Object.isFrozen(box.rect)).toBe(true);
    });
    FLOOR.windows.forEach((window) => {
      expect(Object.isFrozen(window)).toBe(true);
      expect(Object.isFrozen(window.opening)).toBe(true);
    });
    FLOOR.railings.forEach((railing) => {
      expect(Object.isFrozen(railing)).toBe(true);
      expect(Object.isFrozen(railing.rect)).toBe(true);
    });
  });

  it('produces equal geometry on two calls with the same arguments', () => {
    const again = getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, FLOOR_HEIGHTS);

    expect(again).toEqual(FLOOR);
    expect(again).not.toBe(FLOOR);
  });
});

describe('the areas of brief §8', () => {
  it('walls 42.52 m² of the plot', () => {
    expect(getWallFootprintArea(FLOOR.walls)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('floors 167.38 m² of the plot', () => {
    expect(totalRectArea(FLOOR.slabs)).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
  });

  it('leaves 15.10 m² of void, and the three make the 225.00 m² plot', () => {
    const walls = getWallFootprintArea(FLOOR.walls);
    const floors = totalRectArea(FLOOR.slabs);
    const voids = voidArea(FLOOR_PLAN);

    expect(voids).toBeCloseTo(VOID_AREA, PRECISION_DIGITS);
    expect(walls + floors + voids).toBeCloseTo(PLOT_AREA, PRECISION_DIGITS);
    expect(walls + floors + voids).toBeCloseTo(rectArea(PLOT_RECT), PRECISION_DIGITS);
  });
});

describe('every port of the real schedule holes its wall', () => {
  it.each(PORT_CASES)('opens %s and keeps a lintel over it', (_label, opening) => {
    expect(coveringPieces(FLOOR.walls, opening)).toEqual([]);

    const above = piecesAbove(FLOOR.walls, opening);
    const below = piecesBelow(FLOOR.walls, opening);

    expect(above.length).toBeGreaterThan(NONE);
    above.forEach((piece) => {
      expect(piece.bottom).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
      expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
    });
    expect(below.length).toBeGreaterThan(NONE);
    below.forEach((piece) => {
      expect(piece.top).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
    });
  });
});

describe('every window of the real floor holes its wall', () => {
  it.each(WINDOW_CASES)('glazes %s between a sill and a head', (_label, window) => {
    expect(coveringPieces(FLOOR.walls, window.opening)).toEqual([]);

    const above = piecesAbove(FLOOR.walls, window.opening);
    const below = piecesBelow(FLOOR.walls, window.opening);

    expect(above.length).toBeGreaterThan(NONE);
    above.forEach((piece) => {
      expect(piece.bottom).toBeCloseTo(FLOOR_HEIGHTS.windowHead, PRECISION_DIGITS);
      expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
    });
    expect(below.length).toBeGreaterThan(NONE);
    below.forEach((piece) => {
      expect(piece.bottom).toBeCloseTo(SLAB_BOTTOM, PRECISION_DIGITS);
      expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.windowSill, PRECISION_DIGITS);
    });
  });
});

describe('nothing intersects in three dimensions', () => {
  it('never overlaps two wall blocks', () => {
    const offenders = FLOOR.walls.flatMap((piece, position) =>
      FLOOR.walls
        .slice(position + ONE)
        .filter((other) => boxesOverlap(piece, other))
        .map((other) => `${footprintKey(piece.rect)} ↔ ${footprintKey(other.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never overlaps a wall and a slab', () => {
    const offenders = FLOOR.walls.flatMap((piece) =>
      FLOOR.slabs
        .filter((slab) => boxesOverlap(piece, slab))
        .map((slab) => `${footprintKey(piece.rect)} ↔ slab of ${slab.spaceId}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never overlaps a step and a wall', () => {
    const offenders = FLOOR.stairs.steps.flatMap((step, index) =>
      FLOOR.walls
        .filter((piece) => boxesOverlap(step, piece))
        .map((piece) => `step ${String(index)} ↔ ${footprintKey(piece.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never overlaps two steps, and keeps them all off the landing', () => {
    const stepOffenders = FLOOR.stairs.steps.flatMap((step, index) =>
      FLOOR.stairs.steps
        .slice(index + ONE)
        .filter((other) => boxesOverlap(step, other))
        .map((other) => `${footprintKey(step.rect)} ↔ ${footprintKey(other.rect)}`),
    );
    const onLanding = FLOOR.stairs.steps
      .filter((step) => rectsOverlap(step.rect, FLOOR.stairs.landingRect))
      .map((step) => footprintKey(step.rect));

    expect(stepOffenders).toEqual([]);
    expect(onLanding).toEqual([]);
  });

  it('never overlaps the TV panel and a wall', () => {
    const offenders = FLOOR.walls
      .filter((piece) => boxesOverlap(FLOOR.tvPanel, piece))
      .map((piece) => footprintKey(piece.rect));

    expect(offenders).toEqual([]);
  });

  it('keeps the railings clear of every wall', () => {
    const offenders = FLOOR.railings.flatMap((railing) =>
      FLOOR.walls
        .filter((piece) => rectsOverlap(railing.rect, piece.rect))
        .map((piece) => `${railing.spaces.join(' ↔ ')} ↔ ${footprintKey(piece.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('stands each railing on the balcony slab it guards', () => {
    // A railing straddles the slab/void edge by design (`railings.ts`): it is a
    // rail on floor area already counted in the 167.38 m², not a wall, so this
    // one footprint overlap is the documented behaviour rather than a clash.
    FLOOR.railings.forEach((railing) => {
      const carried = FLOOR.slabs.filter((slab) => rectsOverlap(railing.rect, slab.rect));

      expect(carried).toHaveLength(ONE);
      expect(carried[0].spaceId).toBe('balconySlabB');
    });
  });
});

describe('injected heights', () => {
  const injected = getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, OTHER_HEIGHTS);
  const levels = everyLevel(injected);

  /** Underside of the slab the injected sizes imply: 4.44 − 3.33. */
  const otherSlabBottom = -toPlanLength(OTHER_HEIGHTS.floorToFloor - OTHER_HEIGHTS.wall);
  /** Top of each of the 17 treads the injected floor-to-floor height implies. */
  const otherTreadTops = Array.from(
    { length: STEP_COUNT },
    (_unused, offset) => ((offset + ONE) * OTHER_HEIGHTS.floorToFloor) / STEP_COUNT,
  );
  const allowedLevels: readonly number[] = [
    otherSlabBottom,
    FLOOR_LEVEL,
    OTHER_HEIGHTS.windowSill,
    OTHER_HEIGHTS.railing,
    OTHER_HEIGHTS.door,
    OTHER_HEIGHTS.wall,
    ...otherTreadTops,
  ];

  it('keeps no production height anywhere in the built floor', () => {
    const survivors = [...new Set(levels.filter((level) => isOneOf(level, FORBIDDEN_LEVELS)))];

    expect(survivors).toEqual([]);
  });

  it('takes every level from the injected sizes alone', () => {
    const strangers = [...new Set(levels.filter((level) => !isOneOf(level, allowedLevels)))];

    expect(strangers).toEqual([]);
    expect(Math.min(...levels)).toBeCloseTo(otherSlabBottom, PRECISION_DIGITS);
    expect(Math.max(...levels)).toBeCloseTo(OTHER_HEIGHTS.floorToFloor, PRECISION_DIGITS);
  });

  it('moves the stairs, the railings and the TV panel with the heights', () => {
    expect(injected.stairs.riser).toBeCloseTo(
      OTHER_HEIGHTS.floorToFloor / STEP_COUNT,
      PRECISION_DIGITS,
    );
    injected.railings.forEach((railing) => {
      expect(railing.top).toBeCloseTo(OTHER_HEIGHTS.railing, PRECISION_DIGITS);
    });
    expect(injected.tvPanel.bottom).toBeCloseTo(OTHER_HEIGHTS.railing, PRECISION_DIGITS);
    expect(injected.tvPanel.top).toBeCloseTo(OTHER_HEIGHTS.door, PRECISION_DIGITS);
    injected.slabs.forEach((slab) => {
      expect(slab.bottom).toBeCloseTo(otherSlabBottom, PRECISION_DIGITS);
      expect(slab.top).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
    });
  });

  it('keeps the plan figures, which no height can change', () => {
    expect(injected.walls).toHaveLength(WALL_PIECE_COUNT);
    expect(injected.openings).toHaveLength(OPENING_COUNT);
    expect(injected.windows).toHaveLength(WINDOW_COUNT);
    expect(getWallFootprintArea(injected.walls)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
    expect(totalRectArea(injected.slabs)).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
  });
});

describe('mutation guards', () => {
  it('solidifies every window when the window openings are dropped', () => {
    const withoutWindows = getWallPieces(FLOOR_PLAN, PORT_OPENINGS);

    expect(withoutWindows).toHaveLength(PORT_ONLY_PIECE_COUNT);
    expect(withoutWindows.length).not.toBe(WALL_PIECE_COUNT);
    FLOOR.windows.forEach((window) => {
      expect(coveringPieces(withoutWindows, window.opening)).toHaveLength(SOLID_PIECES_AT_WINDOW);
      expect(coveringPieces(FLOOR.walls, window.opening)).toEqual([]);
    });
    // The footprint is unchanged: a window takes height out of a wall, not plan area.
    expect(getWallFootprintArea(withoutWindows)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('validates the schedule before it derives anything from it', () => {
    expect(() => getBuiltFloor(FLOOR_PLAN, [...PORT_SCHEDULE, ZERO_WALL_PORT])).toThrow(
      /has no wall to cut/u,
    );
    expect(() => getBuiltFloor(FLOOR_PLAN, [ZERO_WALL_PORT])).toThrow(RangeError);
  });

  it('leaves the plan and the schedule untouched', () => {
    expect(Object.isFrozen(FLOOR_PLAN)).toBe(true);
    expect(Object.isFrozen(PORT_SCHEDULE)).toBe(true);
    expect(PORT_SCHEDULE).toHaveLength(PORT_COUNT);
    expect(getBuiltFloor()).toEqual(FLOOR);
  });
});
