import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN } from './floorPlan/index.ts';
import type { FloorPlan, Space, SpaceId, SpaceKind } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { boxVolume, makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectContainsPoint,
  rectsOverlap,
} from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { getWallCells, getWallFootprintArea, getWallPieces } from './walls.ts';
import type { WallCell, WallHeightKind } from './walls.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const NONE = 0;

/** Level of the finished floor: the datum every height is measured from. */
const FLOOR_LEVEL = 0;

/** Underside of the slab, where every wall starts: −0.30 m (3.00 − 2.70). */
const SLAB_BOTTOM = -(FLOOR_HEIGHTS.floorToFloor - FLOOR_HEIGHTS.wall);

/* ------------------------------------------------------------------ *
 * Openings of the typical floor: local fixtures.
 * ------------------------------------------------------------------ */

/** Footprint of an opening as `[minX, maxX, minZ, maxZ]`, in metres. */
type OpeningFootprint = readonly [minX: number, maxX: number, minZ: number, maxZ: number];

/**
 * The 19 door and opening footprints of the typical floor, taken from the door
 * schedule (brief §6 as amended by ADR-006), grouped by the wall they sit in.
 *
 * These are local fixtures: the port and window models are built in their own
 * modules, and an integration test will later replace this table and
 * {@link WINDOW_FOOTPRINTS} with the generated schedule. Keeping them here lets
 * the wall generator be checked against the real geometry without waiting for
 * those modules.
 */
const DOOR_FOOTPRINTS: readonly OpeningFootprint[] = [
  // Wall x 1.30–1.60, the side-A balcony wall.
  [1.3, 1.6, 1.85, 2.75],
  [1.3, 1.6, 5.65, 6.45],
  // Wall z 3.70–3.90, between the top row and the corridor.
  [5.65, 6.55, 3.7, 3.9],
  [7.5, 11.0, 3.7, 3.9],
  [14.05, 14.95, 3.7, 3.9],
  [18.55, 19.45, 3.7, 3.9],
  // Wall x 20.20–20.40, into the utility room.
  [20.2, 20.4, 4.2, 5.1],
  // Wall z 5.40–5.60, between the corridor and the service row.
  [4.0, 4.9, 5.4, 5.6],
  [5.67, 6.57, 5.4, 5.6],
  [11.55, 12.45, 5.4, 5.6],
  [18.45, 19.35, 5.4, 5.6],
  // Wall x 9.80–10.00, guest room to kitchen.
  [9.8, 10.0, 6.0, 6.9],
  // Wall x 14.00–14.20, kitchen to laundry.
  [14.0, 14.2, 6.15, 7.05],
  // Wall x 17.40–17.60, laundry to main sanitair.
  [17.4, 17.6, 6.15, 7.05],
  // Wall z 6.50–6.70, link corridor to the control center and the guest room.
  [2.3, 3.2, 6.5, 6.7],
  [4.4, 5.3, 6.5, 6.7],
  // Wall x 8.00–8.20, into the guest sanitair.
  [8.0, 8.2, 7.1, 8.0],
  // Wall z 8.40–8.70, onto the side-B balcony slab.
  [12.7, 13.6, 8.4, 8.7],
  [15.3, 16.2, 8.4, 8.7],
];

/**
 * The 8 window footprints of the typical floor (brief §6, ADR-006), grouped by
 * the wall they sit in; every window is 1.20 m wide. Local fixture, see
 * {@link DOOR_FOOTPRINTS}.
 */
const WINDOW_FOOTPRINTS: readonly OpeningFootprint[] = [
  // Wall x 1.30–1.60: the master bedroom and the control center.
  [1.3, 1.6, 0.43, 1.63],
  [1.3, 1.6, 6.95, 8.15],
  // Wall z 8.40–8.70, the void-facing wall of the service row.
  [2.1, 3.3, 8.4, 8.7],
  [5.4, 6.6, 8.4, 8.7],
  [8.4, 9.6, 8.4, 8.7],
  [10.7, 11.9, 8.4, 8.7],
  [18.3, 19.5, 8.4, 8.7],
  // Wall z 9.70–10.00, side B at the utility room.
  [20.7, 21.9, 9.7, 10.0],
];

/**
 * Builds the opening boxes of the fixtures: doors run from the finished floor to
 * the door head, windows from the sill to the window head.
 *
 * @param heights - Vertical sizes to use.
 * @returns The 19 doors followed by the 8 windows, as boxes.
 */
function fixtureOpenings(heights: FloorHeights): readonly PlanBox[] {
  return [
    ...DOOR_FOOTPRINTS.map(([minX, maxX, minZ, maxZ]) =>
      makeBox(makeRect(minX, maxX, minZ, maxZ), FLOOR_LEVEL, heights.door),
    ),
    ...WINDOW_FOOTPRINTS.map(([minX, maxX, minZ, maxZ]) =>
      makeBox(makeRect(minX, maxX, minZ, maxZ), heights.windowSill, heights.windowHead),
    ),
  ];
}

const OPENINGS = fixtureOpenings(FLOOR_HEIGHTS);
const DOOR_COUNT = 19;
const WINDOW_COUNT = 8;
const OPENING_COUNT = DOOR_COUNT + WINDOW_COUNT;

/* ------------------------------------------------------------------ *
 * Measured figures of the typical floor.
 * ------------------------------------------------------------------ */

/** Wall footprint of the typical floor, brief §8, in square metres. */
const WALL_FOOTPRINT_AREA = 42.52;
/** Cells of the grid cut by the plan and the 27 openings that carry a wall. */
const WALL_CELL_COUNT = 486;
/** Cells of the grid cut by the plan alone that carry a wall. */
const COARSE_WALL_CELL_COUNT = 198;
const FULL_HEIGHT_CELL_COUNT = 404;
const FULL_HEIGHT_AREA = 32.95;
const PARAPET_CELL_COUNT = 82;
const PARAPET_AREA = 9.57;
const PIECE_COUNT = 218;
/** Pieces that start at the underside of the slab. */
const BASE_PIECE_COUNT = 172;
/** Pieces that start at an opening head: the lintels. */
const HEAD_PIECE_COUNT = 46;
const DISTINCT_FOOTPRINT_COUNT = 180;
/** Volume of solid wall with every door and window punched out, in cubic metres. */
const WALL_VOLUME = 99.825;
/** Volume of solid wall before any opening is punched out, in cubic metres. */
const SOLID_WALL_VOLUME = 112.248;
const SOLID_PIECE_COUNT = 57;

/** Shift and shrink used by the mutation guards, in metres. */
const KITCHEN_SHIFT_X = 0.05;
const SHIFTED_PIECE_COUNT = 223;
const SHRUNK_FOOTPRINT_AREA = 42.66;
/** Pieces of the real plan whose footprint is the guest-room/kitchen wall. */
const KITCHEN_WEST_WALL_PIECE_COUNT = 15;
/** The wall between the guest room and the kitchen, x 9.80–10.00. */
const KITCHEN_WEST_WALL: readonly [number, number] = [9.8, 10.0];
/** West face of the kitchen in the untouched plan, in metres. */
const KITCHEN_MIN_X = 10.0;

/** The three walls listed piece by piece, as the two faces across the thickness. */
const CORRIDOR_TOP_BAND: readonly [number, number] = [3.7, 3.9];
const BALCONY_BAND: readonly [number, number] = [1.3, 1.6];
const VOID_BAND: readonly [number, number] = [8.4, 8.7];

/** Every vertical level a piece of the real plan may start or end at. */
const REAL_LEVELS: readonly number[] = [
  SLAB_BOTTOM,
  FLOOR_LEVEL,
  FLOOR_HEIGHTS.windowSill,
  FLOOR_HEIGHTS.railing,
  FLOOR_HEIGHTS.door,
  FLOOR_HEIGHTS.wall,
];

/** Tops a piece of the real plan may have: a sill, a parapet or a wall head. */
const REAL_TOPS: readonly number[] = [
  FLOOR_LEVEL,
  FLOOR_HEIGHTS.windowSill,
  FLOOR_HEIGHTS.railing,
  FLOOR_HEIGHTS.wall,
];

/**
 * Vertical sizes with every value changed, to prove no height is hard-coded.
 * No value is a real one, and no sum or difference of two of them is either.
 */
const OTHER_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 4.44,
  wall: 3.33,
  door: 2.22,
  railing: 1.55,
  windowSill: 1.11,
  windowHead: 2.22,
});

/** Levels that must never appear when {@link OTHER_HEIGHTS} is injected. */
const FORBIDDEN_LEVELS: readonly number[] = [
  FLOOR_HEIGHTS.wall,
  FLOOR_HEIGHTS.door,
  FLOOR_HEIGHTS.railing,
  FLOOR_HEIGHTS.windowSill,
  SLAB_BOTTOM,
  -SLAB_BOTTOM,
];

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

/**
 * Builds a frozen space whose name is its id.
 *
 * @param id - Identifier of the space.
 * @param kind - Kind of the space.
 * @param rects - Clear rects of the space.
 * @returns A frozen space.
 */
function makeSpace(id: SpaceId, kind: SpaceKind, rects: readonly PlanRect[]): Space {
  return Object.freeze({ id, name: id, kind, rects: Object.freeze([...rects]) });
}

/**
 * Builds a frozen plan without join overrides.
 *
 * @param plot - Outer boundary of the floor.
 * @param spaces - Spaces of the plan.
 * @returns A frozen plan whose interior equals its plot, which the wall
 *   generator does not read.
 */
function makePlan(plot: PlanRect, spaces: readonly Space[]): FloorPlan {
  return Object.freeze({
    plot,
    interior: plot,
    spaces: Object.freeze([...spaces]),
    joinOverrides: Object.freeze([]),
  });
}

/**
 * Returns the centre of a rectangle.
 *
 * @param rect - The rectangle.
 * @returns Its centre point.
 */
function centreOf(rect: PlanRect): PlanPoint {
  return { x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF };
}

/**
 * Sums the areas of a list of cells.
 *
 * @param cells - The cells to measure.
 * @returns The total footprint, in square metres.
 */
function cellArea(cells: readonly WallCell[]): number {
  return cells.reduce((sum, cell) => sum + rectArea(cell.rect), 0);
}

/**
 * Finds the single cell that covers a point.
 *
 * @param cells - The wall cells to search.
 * @param point - The point to locate.
 * @returns The covering cell, or `undefined` when the point carries no wall.
 */
function cellAt(cells: readonly WallCell[], point: PlanPoint): WallCell | undefined {
  const covering = cells.filter((cell) => rectContainsPoint(cell.rect, point));
  expect(covering.length).toBeLessThanOrEqual(1);
  return covering[0];
}

/**
 * Finds the single cell whose footprint is exactly the given rectangle.
 *
 * @param cells - The wall cells to search.
 * @param rect - The footprint to match.
 * @returns The matching cell, or `undefined` when the grid holds no such cell.
 */
function cellOfRect(cells: readonly WallCell[], rect: PlanRect): WallCell | undefined {
  return cells.find(
    (cell) =>
      cell.rect.minX === rect.minX &&
      cell.rect.maxX === rect.maxX &&
      cell.rect.minZ === rect.minZ &&
      cell.rect.maxZ === rect.maxZ,
  );
}

/**
 * Checks whether two boxes share a volume.
 *
 * @param a - First box.
 * @param b - Second box.
 * @returns `true` when their footprints overlap and their vertical spans do too,
 *   both by more than `LENGTH_TOLERANCE`.
 */
function boxesOverlap(a: PlanBox, b: PlanBox): boolean {
  const vertical = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
  return vertical > LENGTH_TOLERANCE && rectsOverlap(a.rect, b.rect);
}

/**
 * Formats a footprint as a comparable key.
 *
 * @param rect - The footprint.
 * @returns A key unique to its four coordinates.
 */
function footprintKey(rect: PlanRect): string {
  return [rect.minX, rect.maxX, rect.minZ, rect.maxZ].map(String).join(',');
}

/**
 * Checks whether a level is one of a list, within the plan tolerance.
 *
 * @param level - The level to look up.
 * @param levels - The accepted levels.
 * @returns `true` when the level matches one of them.
 */
function isOneOf(level: number, levels: readonly number[]): boolean {
  return levels.some((candidate) => Math.abs(level - candidate) <= LENGTH_TOLERANCE);
}

/** One expected wall block of a hand-written strip. */
type StripPiece = readonly [minX: number, maxX: number, bottom: number, top: number];

/**
 * Lists the pieces whose footprint lies exactly in one band of the plan, along
 * the axis the band runs, as `[start, end, bottom, top]`.
 *
 * @param pieces - Every wall block.
 * @param band - The band: the two coordinates of the wall across its thickness.
 * @param axis - The axis the wall runs along.
 * @returns The blocks of the band, ordered along the wall then upwards.
 */
function stripPieces(
  pieces: readonly PlanBox[],
  band: readonly [number, number],
  axis: 'x' | 'z',
): readonly StripPiece[] {
  const inBand = pieces.filter((piece) =>
    axis === 'x'
      ? piece.rect.minZ === band[0] && piece.rect.maxZ === band[1]
      : piece.rect.minX === band[0] && piece.rect.maxX === band[1],
  );
  return inBand
    .map((piece): StripPiece => {
      const start = axis === 'x' ? piece.rect.minX : piece.rect.minZ;
      const end = axis === 'x' ? piece.rect.maxX : piece.rect.maxZ;
      return [start, end, piece.bottom, piece.top];
    })
    .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}

/**
 * Rounds the levels of a strip so that hand-written tables stay readable: the
 * slab bottom is −0.2999999999999998 in floating point.
 *
 * @param strip - The measured strip.
 * @returns The same strip with both levels rounded to nine digits.
 */
function roundedStrip(strip: readonly StripPiece[]): readonly StripPiece[] {
  const round = (value: number): number => Number(value.toFixed(PRECISION_DIGITS));
  return strip.map(([start, end, bottom, top]) => [start, end, round(bottom), round(top)]);
}

/**
 * Builds a copy of the plan with every kitchen rect moved along x.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param shift - Distance to move along x, in metres.
 * @returns A new plan whose kitchen is shifted.
 */
function withKitchenShifted(plan: FloorPlan, shift: number): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) =>
      space.id === 'kitchen'
        ? {
            ...space,
            rects: space.rects.map((rect) =>
              makeRect(rect.minX + shift, rect.maxX + shift, rect.minZ, rect.maxZ),
            ),
          }
        : space,
    ),
  };
}

/**
 * Builds a copy of the plan with the kitchen's east face pulled back, which
 * widens the wall to the laundry and so changes the wall footprint.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param shrink - Distance to pull the `maxX` face back, in metres.
 * @returns A new plan whose kitchen is narrower.
 */
function withKitchenShrunk(plan: FloorPlan, shrink: number): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) =>
      space.id === 'kitchen'
        ? {
            ...space,
            rects: space.rects.map((rect) =>
              makeRect(rect.minX, rect.maxX - shrink, rect.minZ, rect.maxZ),
            ),
          }
        : space,
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Synthetic plans.
 * ------------------------------------------------------------------ */

/** A 5.00 × 4.00 plot holding a single 4.40 × 3.40 space, walls 0.30 m all round. */
const TINY_PLOT = makeRect(0, 5, 0, 4);
const TINY_CLEAR = makeRect(0.3, 4.7, 0.3, 3.7);
/** 5 × 4 − 4.40 × 3.40 = 5.04 m². */
const TINY_WALL_AREA = 5.04;
/** Eight cells: three rows of three, less the space itself. */
const TINY_CELL_COUNT = 8;
/** The ring merges into four blocks: the two full-width bands and the two jambs. */
const TINY_PIECE_COUNT = 4;

const TINY_ROOM_PLAN = makePlan(TINY_PLOT, [makeSpace('masterBedroom', 'room', [TINY_CLEAR])]);
const TINY_BALCONY_PLAN = makePlan(TINY_PLOT, [makeSpace('balconyA', 'openAir', [TINY_CLEAR])]);
const TINY_VOID_PLAN = makePlan(TINY_PLOT, [makeSpace('voidWest', 'void', [TINY_CLEAR])]);

/** A door in the west wall of the tiny plan, the full depth of that cell. */
const TINY_DOOR = makeBox(makeRect(0, 0.3, 1.3, 2.2), FLOOR_LEVEL, FLOOR_HEIGHTS.door);
/** An opening taller than the wall, in the same cell: it must leave nothing. */
const TINY_FULL_HEIGHT_OPENING = makeBox(
  makeRect(0, 0.3, 0.3, 3.7),
  SLAB_BOTTOM - 1,
  FLOOR_HEIGHTS.wall + 1,
);

/** A plot whose single space is too far from every boundary to share a wall. */
const ISOLATED_PLAN = makePlan(makeRect(0, 10, 0, 10), [
  makeSpace('masterBedroom', 'room', [makeRect(4, 6, 4, 6)]),
]);

/* ------------------------------------------------------------------ *
 * Probes on the real plan.
 * ------------------------------------------------------------------ */

/** A cell of the real grid, named by the case it pins down. */
type NamedCell = readonly [
  label: string,
  rect: PlanRect,
  height: number,
  kind: WallHeightKind,
  why: string,
];

/**
 * The cells the algorithm was designed against: every one of them is a junction
 * or a side-classification case that a naive rule gets wrong.
 */
const NAMED_CELLS: readonly NamedCell[] = [
  [
    'x 1.30–1.60 × z 0–0.30',
    makeRect(1.3, 1.6, 0, 0.3),
    FLOOR_HEIGHTS.wall,
    'wall',
    'junction where the balcony wall meets side C: the tallest neighbour is the 2.70 balcony wall',
  ],
  [
    'x 0–0.30 × z 0–0.30',
    makeRect(0, 0.3, 0, 0.3),
    FLOOR_HEIGHTS.railing,
    'parapet',
    'outer corner of sides A and C: every neighbour is a parapet along the balcony',
  ],
  [
    'x 1.30–1.60 × z 8.70–9.70',
    makeRect(1.3, 1.6, 8.7, 9.7),
    FLOOR_HEIGHTS.railing,
    'parapet',
    'balconyA to voidWest: open air on both sides, and the 1.60 − 1.30 gap needs the tolerance',
  ],
  [
    'x 20.20–20.40 × z 9.70–10.00',
    makeRect(20.2, 20.4, 9.7, 10),
    FLOOR_HEIGHTS.wall,
    'wall',
    'junction at the voidEast/utility corner: the utility-room wall next to it is full height',
  ],
  [
    'x 0.30–1.30 × z 0–0.30',
    makeRect(0.3, 1.3, 0, 0.3),
    FLOOR_HEIGHTS.railing,
    'parapet',
    'the side-C strip in front of the side-A balcony: open air on one side, outside on the other',
  ],
];

/** A point of the real plan, and the wall it must sit in. */
type ProbePoint = readonly [label: string, point: PlanPoint, height: number, kind: WallHeightKind];

/** Further probes, one per kind of wall on the floor. */
const PROBE_POINTS: readonly ProbePoint[] = [
  [
    'side-A exterior wall beside the balcony',
    { x: 0.15, z: 2.0 },
    FLOOR_HEIGHTS.railing,
    'parapet',
  ],
  ['side-C exterior wall at the master bedroom', { x: 4.1, z: 0.15 }, FLOOR_HEIGHTS.wall, 'wall'],
  ['master bedroom to living room partition', { x: 6.7, z: 2.0 }, FLOOR_HEIGHTS.wall, 'wall'],
  ['balcony wall beside the stairs', { x: 1.45, z: 4.65 }, FLOOR_HEIGHTS.wall, 'wall'],
  ['guest room to kitchen partition', { x: 9.9, z: 7.0 }, FLOOR_HEIGHTS.wall, 'wall'],
  ['side-B parapet along the east void', { x: 18.2, z: 9.85 }, FLOOR_HEIGHTS.railing, 'parapet'],
  ['side-B exterior wall at the utility room', { x: 21.3, z: 9.85 }, FLOOR_HEIGHTS.wall, 'wall'],
  ['side-D exterior wall', { x: 22.35, z: 2.0 }, FLOOR_HEIGHTS.wall, 'wall'],
  [
    'balcony wall where side B turns the corner',
    { x: 1.45, z: 9.85 },
    FLOOR_HEIGHTS.railing,
    'parapet',
  ],
  ['main sanitair to utility room wall', { x: 20.3, z: 6.0 }, FLOOR_HEIGHTS.wall, 'wall'],
  ['guest sanitair corner', { x: 8.1, z: 7.0 }, FLOOR_HEIGHTS.wall, 'wall'],
  ['outer corner of sides A and B', { x: 0.15, z: 9.85 }, FLOOR_HEIGHTS.railing, 'parapet'],
];

/** Points inside a space, where there must be no wall at all. */
const CLEAR_POINTS: readonly (readonly [string, PlanPoint])[] = [
  ['inside the west void', { x: 12.45, z: 9.2 }],
  ['inside the corridor', { x: 9.9, z: 4.65 }],
  ['inside the kitchen', { x: 12.0, z: 7.0 }],
  ['inside the side-A balcony', { x: 0.8, z: 5.0 }],
];

/* ------------------------------------------------------------------ *
 * Hand-written wall strips.
 * ------------------------------------------------------------------ */

/** The wall z 3.70–3.90 between the top row and the corridor, with its four doors. */
const CORRIDOR_TOP_WALL: readonly StripPiece[] = [
  [1.3, 5.65, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [5.65, 6.55, SLAB_BOTTOM, FLOOR_LEVEL],
  [5.65, 6.55, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [6.55, 7.5, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [7.5, 11.0, SLAB_BOTTOM, FLOOR_LEVEL],
  [7.5, 11.0, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [11.0, 14.05, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [14.05, 14.95, SLAB_BOTTOM, FLOOR_LEVEL],
  [14.05, 14.95, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [14.95, 18.55, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [18.55, 19.45, SLAB_BOTTOM, FLOOR_LEVEL],
  [18.55, 19.45, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [19.45, 22.5, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
];

/**
 * The wall x 1.30–1.60 behind the side-A balcony, listed along z: two windows,
 * two doors, and the parapet where it passes the west void. The head of the
 * control-center window is cut at z 7.05, 7.10 and 8.00 by the grid lines of
 * the doors on other walls, which is why it arrives in four blocks.
 */
const BALCONY_WALL: readonly StripPiece[] = [
  [0.3, 0.43, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [0.43, 1.63, SLAB_BOTTOM, FLOOR_HEIGHTS.windowSill],
  [0.43, 1.63, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [1.63, 1.85, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [1.85, 2.75, SLAB_BOTTOM, FLOOR_LEVEL],
  [1.85, 2.75, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [2.75, 3.7, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [3.9, 4.2, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [4.2, 5.1, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [5.1, 5.4, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [5.6, 5.65, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [5.65, 6.0, SLAB_BOTTOM, FLOOR_LEVEL],
  [5.65, 6.0, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [6.0, 6.15, SLAB_BOTTOM, FLOOR_LEVEL],
  [6.0, 6.15, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [6.15, 6.45, SLAB_BOTTOM, FLOOR_LEVEL],
  [6.15, 6.45, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [6.45, 6.5, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [6.7, 6.9, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [6.9, 6.95, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [6.95, 8.15, SLAB_BOTTOM, FLOOR_HEIGHTS.windowSill],
  [6.95, 7.05, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [7.05, 7.1, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [7.1, 8.0, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [8.0, 8.15, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [8.15, 8.4, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [8.7, 9.7, SLAB_BOTTOM, FLOOR_HEIGHTS.railing],
];

/** The wall z 8.40–8.70 facing the void, with five windows and two balcony doors. */
const VOID_WALL: readonly StripPiece[] = [
  [1.3, 2.1, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [2.1, 3.3, SLAB_BOTTOM, FLOOR_HEIGHTS.windowSill],
  [2.1, 3.3, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [3.3, 5.4, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [5.4, 6.6, SLAB_BOTTOM, FLOOR_HEIGHTS.windowSill],
  [5.4, 6.6, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [6.6, 8.4, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [8.4, 9.6, SLAB_BOTTOM, FLOOR_HEIGHTS.windowSill],
  [8.4, 9.6, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [9.6, 10.7, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [10.7, 11.9, SLAB_BOTTOM, FLOOR_HEIGHTS.windowSill],
  [10.7, 11.9, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [11.9, 12.7, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [12.7, 13.6, SLAB_BOTTOM, FLOOR_LEVEL],
  [12.7, 13.6, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [13.6, 15.3, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [15.3, 16.2, SLAB_BOTTOM, FLOOR_LEVEL],
  [15.3, 16.2, FLOOR_HEIGHTS.door, FLOOR_HEIGHTS.wall],
  [16.2, 18.3, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [18.3, 19.5, SLAB_BOTTOM, FLOOR_HEIGHTS.windowSill],
  [18.3, 19.5, FLOOR_HEIGHTS.windowHead, FLOOR_HEIGHTS.wall],
  [19.5, 20.4, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
  [22.2, 22.5, SLAB_BOTTOM, FLOOR_HEIGHTS.wall],
];

const CELLS = getWallCells(FLOOR_PLAN, OPENINGS);
const PIECES = getWallPieces(FLOOR_PLAN, OPENINGS);
const SPACE_RECTS = FLOOR_PLAN.spaces.flatMap((space) => space.rects);

describe('wall cells', () => {
  it('covers the 42.52 m² wall footprint of brief §8 with 486 cells', () => {
    expect(CELLS).toHaveLength(WALL_CELL_COUNT);
    expect(cellArea(CELLS)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('covers the same footprint on the coarse grid, without the openings', () => {
    const coarse = getWallCells(FLOOR_PLAN, []);

    expect(coarse).toHaveLength(COARSE_WALL_CELL_COUNT);
    expect(cellArea(coarse)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('splits the footprint into full-height wall and parapet', () => {
    const full = CELLS.filter((cell) => cell.kind === 'wall');
    const parapet = CELLS.filter((cell) => cell.kind === 'parapet');

    expect(full).toHaveLength(FULL_HEIGHT_CELL_COUNT);
    expect(cellArea(full)).toBeCloseTo(FULL_HEIGHT_AREA, PRECISION_DIGITS);
    expect(parapet).toHaveLength(PARAPET_CELL_COUNT);
    expect(cellArea(parapet)).toBeCloseTo(PARAPET_AREA, PRECISION_DIGITS);
    expect(cellArea(full) + cellArea(parapet)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('uses only the wall and railing heights', () => {
    const heights = new Set(CELLS.map((cell) => cell.height));

    expect([...heights].sort((a, b) => a - b)).toEqual([FLOOR_HEIGHTS.railing, FLOOR_HEIGHTS.wall]);
  });

  it('never overlaps two cells', () => {
    const offenders = CELLS.flatMap((cell, position) =>
      CELLS.slice(position + 1)
        .filter((other) => rectsOverlap(cell.rect, other.rect))
        .map((other) => `${footprintKey(cell.rect)} ↔ ${footprintKey(other.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never puts a cell inside a space', () => {
    const offenders = CELLS.filter((cell) =>
      SPACE_RECTS.some((rect) => rectsOverlap(cell.rect, rect)),
    ).map((cell) => footprintKey(cell.rect));

    expect(offenders).toEqual([]);
  });

  it('classifies the cells identically whether or not the openings cut the grid', () => {
    const coarse = getWallCells(FLOOR_PLAN, []);
    const mismatches = coarse.filter((cell) => {
      const fine = cellAt(CELLS, centreOf(cell.rect));
      return fine === undefined || fine.height !== cell.height || fine.kind !== cell.kind;
    });

    expect(mismatches).toEqual([]);
  });

  describe('named cells of the design', () => {
    it.each(NAMED_CELLS)('gives %s the height %f (%s)', (_label, rect, height, kind) => {
      const cell = cellOfRect(CELLS, rect);

      expect(cell).toBeDefined();
      expect(cell?.height).toBeCloseTo(height, PRECISION_DIGITS);
      expect(cell?.kind).toBe(kind);
    });
  });

  describe('probe points', () => {
    it.each(PROBE_POINTS)('walls the %s at %o', (_label, point, height, kind) => {
      const cell = cellAt(CELLS, point);

      expect(cell).toBeDefined();
      expect(cell?.height).toBeCloseTo(height, PRECISION_DIGITS);
      expect(cell?.kind).toBe(kind);
    });

    it.each(CLEAR_POINTS)('leaves no wall %s', (_label, point) => {
      expect(cellAt(CELLS, point)).toBeUndefined();
    });
  });
});

describe('wall pieces of the typical floor', () => {
  it('returns 218 frozen blocks', () => {
    expect(PIECES).toHaveLength(PIECE_COUNT);
    expect(Object.isFrozen(PIECES)).toBe(true);
    PIECES.forEach((piece) => {
      expect(Object.isFrozen(piece)).toBe(true);
      expect(Object.isFrozen(piece.rect)).toBe(true);
    });
  });

  it('keeps the 42.52 m² footprint of brief §8', () => {
    expect(getWallFootprintArea(PIECES)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('counts a footprint once even though the blocks over it sum to more', () => {
    const summed = PIECES.reduce((sum, piece) => sum + rectArea(piece.rect), 0);

    expect(summed).toBeGreaterThan(WALL_FOOTPRINT_AREA);
    expect(new Set(PIECES.map((piece) => footprintKey(piece.rect))).size).toBe(
      DISTINCT_FOOTPRINT_COUNT,
    );
    expect(getWallFootprintArea(PIECES)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('splits the blocks into bases on the slab and heads over the openings', () => {
    const bases = PIECES.filter(
      (piece) => Math.abs(piece.bottom - SLAB_BOTTOM) <= LENGTH_TOLERANCE,
    );
    const heads = PIECES.filter((piece) => piece.bottom > SLAB_BOTTOM + LENGTH_TOLERANCE);

    expect(bases).toHaveLength(BASE_PIECE_COUNT);
    expect(heads).toHaveLength(HEAD_PIECE_COUNT);
    expect(bases.length + heads.length).toBe(PIECE_COUNT);
  });

  it('starts every block at the slab or at the head of an opening', () => {
    const openingTops = OPENINGS.map((opening) => opening.top);
    const offenders = PIECES.filter(
      (piece) => !isOneOf(piece.bottom, [SLAB_BOTTOM, ...openingTops]),
    ).map((piece) => `${footprintKey(piece.rect)} bottom ${String(piece.bottom)}`);

    expect(offenders).toEqual([]);
  });

  it('ends every block at the floor, a sill, a parapet or the wall head', () => {
    const offenders = PIECES.filter((piece) => !isOneOf(piece.top, REAL_TOPS)).map(
      (piece) => `${footprintKey(piece.rect)} top ${String(piece.top)}`,
    );

    expect(offenders).toEqual([]);
    PIECES.forEach((piece) => {
      expect(isOneOf(piece.bottom, REAL_LEVELS)).toBe(true);
    });
  });

  it('never overlaps two blocks in three dimensions', () => {
    const offenders = PIECES.flatMap((piece, position) =>
      PIECES.slice(position + 1)
        .filter((other) => boxesOverlap(piece, other))
        .map((other) => `${footprintKey(piece.rect)} ↔ ${footprintKey(other.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never puts a block inside a space', () => {
    const offenders = PIECES.filter((piece) =>
      SPACE_RECTS.some((rect) => rectsOverlap(piece.rect, rect)),
    ).map((piece) => footprintKey(piece.rect));

    expect(offenders).toEqual([]);
  });

  it('fills the same volume as the cells, less every opening', () => {
    const solid = getWallPieces(FLOOR_PLAN, []);

    expect(solid).toHaveLength(SOLID_PIECE_COUNT);
    expect(getWallFootprintArea(solid)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
    expect(solid.reduce((sum, piece) => sum + boxVolume(piece), 0)).toBeCloseTo(
      SOLID_WALL_VOLUME,
      PRECISION_DIGITS,
    );
    expect(PIECES.reduce((sum, piece) => sum + boxVolume(piece), 0)).toBeCloseTo(
      WALL_VOLUME,
      PRECISION_DIGITS,
    );
  });
});

describe('openings of the typical floor', () => {
  it('uses 19 doors and 8 windows', () => {
    expect(DOOR_FOOTPRINTS).toHaveLength(DOOR_COUNT);
    expect(WINDOW_FOOTPRINTS).toHaveLength(WINDOW_COUNT);
    expect(OPENINGS).toHaveLength(OPENING_COUNT);
  });

  it.each(OPENINGS.map((opening, index) => [index, opening] as const))(
    'punches a hole through opening %i and keeps a head over it',
    (_index, opening) => {
      const centre = centreOf(opening.rect);
      const covering = PIECES.filter(
        (piece) =>
          rectContainsPoint(piece.rect, centre) &&
          Math.min(piece.top, opening.top) - Math.max(piece.bottom, opening.bottom) >
            LENGTH_TOLERANCE,
      );
      const above = PIECES.filter(
        (piece) =>
          rectContainsPoint(piece.rect, centre) && piece.bottom >= opening.top - LENGTH_TOLERANCE,
      );
      const below = PIECES.filter(
        (piece) =>
          rectContainsPoint(piece.rect, centre) && piece.top <= opening.bottom + LENGTH_TOLERANCE,
      );

      expect(covering).toEqual([]);
      expect(above.length).toBeGreaterThan(NONE);
      expect(below.length).toBeGreaterThan(NONE);
      above.forEach((piece) => {
        expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
      });
    },
  );

  it('keeps a threshold under every door and a sill under every window', () => {
    const doors = OPENINGS.slice(0, DOOR_FOOTPRINTS.length);
    const windows = OPENINGS.slice(DOOR_FOOTPRINTS.length);
    const topsUnder = (opening: PlanBox): readonly number[] =>
      PIECES.filter(
        (piece) =>
          rectContainsPoint(piece.rect, centreOf(opening.rect)) &&
          piece.top <= opening.bottom + LENGTH_TOLERANCE,
      ).map((piece) => piece.top);

    doors.forEach((door) => {
      topsUnder(door).forEach((top) => {
        expect(top).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
      });
    });
    windows.forEach((window) => {
      topsUnder(window).forEach((top) => {
        expect(top).toBeCloseTo(FLOOR_HEIGHTS.windowSill, PRECISION_DIGITS);
      });
    });
  });
});

describe('hand-written wall strips', () => {
  it('builds the z 3.70–3.90 corridor wall piece by piece', () => {
    expect(roundedStrip(stripPieces(PIECES, CORRIDOR_TOP_BAND, 'x'))).toEqual(
      roundedStrip(CORRIDOR_TOP_WALL),
    );
  });

  it('builds the x 1.30–1.60 balcony wall piece by piece', () => {
    expect(roundedStrip(stripPieces(PIECES, BALCONY_BAND, 'z'))).toEqual(
      roundedStrip(BALCONY_WALL),
    );
  });

  it('builds the z 8.40–8.70 void wall piece by piece', () => {
    expect(roundedStrip(stripPieces(PIECES, VOID_BAND, 'x'))).toEqual(roundedStrip(VOID_WALL));
  });
});

describe('a small synthetic plan', () => {
  it('rings a room with eight cells at wall height', () => {
    const cells = getWallCells(TINY_ROOM_PLAN, []);

    expect(cells).toHaveLength(TINY_CELL_COUNT);
    expect(cellArea(cells)).toBeCloseTo(TINY_WALL_AREA, PRECISION_DIGITS);
    cells.forEach((cell) => {
      expect(cell.height).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
      expect(cell.kind).toBe('wall');
    });
  });

  it.each([
    ['openAir', TINY_BALCONY_PLAN],
    ['void', TINY_VOID_PLAN],
  ] as const)('rings a %s space with parapets only', (_kind, plan) => {
    const cells = getWallCells(plan, []);

    expect(cells).toHaveLength(TINY_CELL_COUNT);
    cells.forEach((cell) => {
      expect(cell.height).toBeCloseTo(FLOOR_HEIGHTS.railing, PRECISION_DIGITS);
      expect(cell.kind).toBe('parapet');
    });
  });

  it('merges the ring into four blocks: two bands and two jambs', () => {
    const pieces = getWallPieces(TINY_ROOM_PLAN, []);

    expect(pieces).toHaveLength(TINY_PIECE_COUNT);
    expect(getWallFootprintArea(pieces)).toBeCloseTo(TINY_WALL_AREA, PRECISION_DIGITS);
    expect(
      pieces.map((piece) => [piece.rect.minX, piece.rect.maxX, piece.rect.minZ, piece.rect.maxZ]),
    ).toEqual([
      [0, 5, 0, 0.3],
      [0, 0.3, 0.3, 3.7],
      [4.7, 5, 0.3, 3.7],
      [0, 5, 3.7, 4],
    ]);
    pieces.forEach((piece) => {
      expect(piece.bottom).toBeCloseTo(SLAB_BOTTOM, PRECISION_DIGITS);
      expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
    });
  });

  it('splits a cell into a threshold and a lintel around a door', () => {
    const pieces = getWallPieces(TINY_ROOM_PLAN, [TINY_DOOR]);
    const atDoor = pieces
      .filter((piece) => rectContainsPoint(piece.rect, centreOf(TINY_DOOR.rect)))
      .sort((a, b) => a.bottom - b.bottom);

    expect(atDoor).toHaveLength(2);
    expect(atDoor[0].bottom).toBeCloseTo(SLAB_BOTTOM, PRECISION_DIGITS);
    expect(atDoor[0].top).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
    expect(atDoor[1].bottom).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
    expect(atDoor[1].top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
    expect(getWallFootprintArea(pieces)).toBeCloseTo(TINY_WALL_AREA, PRECISION_DIGITS);
  });

  it('leaves nothing where an opening takes the whole height', () => {
    const pieces = getWallPieces(TINY_ROOM_PLAN, [TINY_FULL_HEIGHT_OPENING]);
    const centre = centreOf(TINY_FULL_HEIGHT_OPENING.rect);

    expect(pieces.filter((piece) => rectContainsPoint(piece.rect, centre))).toEqual([]);
    expect(getWallFootprintArea(pieces)).toBeLessThan(TINY_WALL_AREA);
  });

  it('refuses a plan whose walls are all junctions', () => {
    expect(() => getWallCells(ISOLATED_PLAN, [])).toThrow(RangeError);
    expect(() => getWallPieces(ISOLATED_PLAN, [])).toThrow(/touches no wall cell/u);
  });
});

describe('injected heights', () => {
  const otherOpenings = fixtureOpenings(OTHER_HEIGHTS);
  const pieces = getWallPieces(FLOOR_PLAN, otherOpenings, OTHER_HEIGHTS);
  const cells = getWallCells(FLOOR_PLAN, otherOpenings, OTHER_HEIGHTS);
  const levels = [...new Set(pieces.flatMap((piece) => [piece.bottom, piece.top]))];

  it('takes every level from the argument, never from FLOOR_HEIGHTS', () => {
    const survivors = levels.filter((level) => isOneOf(level, FORBIDDEN_LEVELS));

    expect(survivors).toEqual([]);
  });

  it('raises the walls and the parapets to the injected heights', () => {
    const heights = new Set(cells.map((cell) => cell.height));

    expect([...heights].sort((a, b) => a - b)).toEqual([OTHER_HEIGHTS.railing, OTHER_HEIGHTS.wall]);
    expect(Math.min(...levels)).toBeCloseTo(
      -(OTHER_HEIGHTS.floorToFloor - OTHER_HEIGHTS.wall),
      PRECISION_DIGITS,
    );
    expect(Math.max(...levels)).toBeCloseTo(OTHER_HEIGHTS.wall, PRECISION_DIGITS);
  });

  it('keeps the footprint, which no height can change', () => {
    expect(getWallFootprintArea(pieces)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
    expect(cellArea(cells)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });
});

describe('mutation guards', () => {
  it('gives the untouched plan the figures of brief §8', () => {
    expect(getWallFootprintArea(PIECES)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
    expect(cellArea(CELLS.filter((cell) => cell.kind === 'parapet'))).toBeCloseTo(
      PARAPET_AREA,
      PRECISION_DIGITS,
    );
  });

  it('changes the walls when the kitchen moves 0.05 m along x', () => {
    const shifted = withKitchenShifted(FLOOR_PLAN, KITCHEN_SHIFT_X);
    const pieces = getWallPieces(shifted, OPENINGS);
    const onKitchenWestWall = (candidates: readonly PlanBox[]): number =>
      candidates.filter(
        (piece) =>
          piece.rect.minX === KITCHEN_WEST_WALL[0] && piece.rect.maxX === KITCHEN_WEST_WALL[1],
      ).length;

    // Sliding a space between two walls moves solid from one to the other, so
    // the total footprint is unchanged: the wall layout is what must differ.
    expect(pieces).toHaveLength(SHIFTED_PIECE_COUNT);
    expect(pieces.length).not.toBe(PIECE_COUNT);
    expect(onKitchenWestWall(PIECES)).toBe(KITCHEN_WEST_WALL_PIECE_COUNT);
    expect(onKitchenWestWall(pieces)).toBeLessThan(KITCHEN_WEST_WALL_PIECE_COUNT);
    expect(getSpaceMinX(FLOOR_PLAN)).not.toBe(getSpaceMinX(shifted));
  });

  it('changes the footprint area when the kitchen loses 0.05 m of width', () => {
    const shrunk = withKitchenShrunk(FLOOR_PLAN, KITCHEN_SHIFT_X);

    expect(getWallFootprintArea(getWallPieces(shrunk, OPENINGS))).toBeCloseTo(
      SHRUNK_FOOTPRINT_AREA,
      PRECISION_DIGITS,
    );
    expect(getWallFootprintArea(getWallPieces(shrunk, OPENINGS))).not.toBeCloseTo(
      WALL_FOOTPRINT_AREA,
      PRECISION_DIGITS,
    );
  });

  it('leaves FLOOR_PLAN untouched after every mutation', () => {
    withKitchenShifted(FLOOR_PLAN, KITCHEN_SHIFT_X);
    withKitchenShrunk(FLOOR_PLAN, KITCHEN_SHIFT_X);

    expect(getSpaceMinX(FLOOR_PLAN)).toBe(KITCHEN_MIN_X);
    expect(getWallFootprintArea(getWallPieces(FLOOR_PLAN, OPENINGS))).toBeCloseTo(
      WALL_FOOTPRINT_AREA,
      PRECISION_DIGITS,
    );
  });
});

/**
 * Returns the west face of the kitchen of a plan.
 *
 * @param plan - The plan to read.
 * @returns The `minX` of the kitchen's first rect, in metres.
 */
function getSpaceMinX(plan: FloorPlan): number {
  const kitchen = plan.spaces.find((space) => space.id === 'kitchen');
  return kitchen?.rects[0].minX ?? Number.NaN;
}
