import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN } from './floorPlan/index.ts';
import type { FloorPlan } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { boxVolume, makeBox } from './planBox.ts';
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
import { getSlabThickness } from './slabs.ts';
import { INSULATED_WALLS, PARAPET_WALLS, PLOT, ROOMS, WALLS } from './sourceOfTruth/plan.ts';
import {
  deriveWalls,
  getWallCells,
  getWallFootprintArea,
  getWallPieces,
  getWallSolids,
} from './walls.ts';
import type { ContactReason, DerivedWall, WallCell, WallHeightKind, WallPiece } from './walls.ts';

/**
 * What this file used to assert, and why those assertions are deleted rather
 * than renumbered.
 *
 * The old file pinned the floor of ADR-008: a 42.52 m² wall footprint, 486 cells
 * over 218 blocks, and a parapet INFERRED wherever a stretch of wall had open air
 * on both sides — 82 cells and 9.57 m² of it, most of that the side-B edge. All
 * of it is gone with the floor it described:
 *
 * - the parapet counts and areas are not renumbered, they are replaced. Side B is
 *   a normal 0.30 exterior wall now, so nothing is inferred from what a wall
 *   faces; a parapet is DECLARED, in `PARAPET_WALLS`, and this floor declares
 *   exactly one — the side-A balcony's balustrade, 1.10 m over its own 9.40 m
 *   face (1.00 m until ADR-011, where the owner chose 1.10 and the plan entry
 *   was rewritten to carry `HEIGHTS.railing` itself). The six balcony-slab and
 *   void joins that are open air on both sides carry no masonry at all (they are
 *   zero-thickness overrides), so they cannot be parapets: `railings.ts` owns
 *   those edges;
 * - the hand-written strips (the z 3.70–3.90 corridor wall listed block by block,
 *   and two more like it) are gone. They were three tables of about sixty
 *   coordinates each, they broke on every plan edit, and every fact in them is
 *   covered here by an invariant: the contacts tile each face, the blocks close on
 *   the footprint, and the volume closes on the openings punched out of it;
 * - the synthetic-plan suite (a tiny 5.00 × 4.00 plot with one room, one balcony,
 *   one void) is gone, and so is `refuses a plan whose walls are all junctions`.
 *   Those tests injected spaces, and the spaces are no longer read from the
 *   argument — see the last describe block. A synthetic plot now yields the real
 *   floor's walls clipped to it, which tests nothing about walls;
 * - `DOOR_FOOTPRINTS` / `WINDOW_FOOTPRINTS` shrink from 19 + 8 hand-measured
 *   footprints to the seven of {@link OPENINGS}. They stay local fixtures on
 *   purpose (the port and window models own the real schedule, and an integration
 *   test will join them up), and seven is enough to cover what this module does
 *   with a hole: one in a 0.30 wall, one in a 0.15 partition, one in the 0.20
 *   join, a leafless 3.50 m opening, and two windows with a sill.
 */

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const NONE = 0;

/** Level of the finished floor: the datum every height is measured from. */
const FLOOR_LEVEL = 0;

/**
 * Underside of the slab, where every wall starts: −0.30 m (3.00 − 2.70). Taken
 * from `slabs.ts`, the one place that level is computed, rather than subtracting
 * the two heights again, which yields −0.2999999999999998.
 */
const SLAB_BOTTOM = -getSlabThickness();

/* ------------------------------------------------------------------ *
 * Measured figures of the typical floor.
 * ------------------------------------------------------------------ */

/** Faces the plan's 22 spaces have between them. */
const FACE_COUNT = 96;
/** Contact stretches those faces are tiled by. */
const CONTACT_COUNT = 166;
/**
 * Faces that are more than one thickness along their length.
 *
 * Six, not four: the two guest-suite corners where a 0.30 wall lands in a 0.15
 * one are now widened to 0.30 by the junction rule, so those two faces read
 * 0.15 along their neighbour and 0.30 at the corner. See the junction tests.
 */
const VARYING_FACE_COUNT = 6;
/** Faces sitting on the exterior envelope. */
const ENVELOPE_FACE_COUNT = 15;
/**
 * Contacts with no masonry: the stair landing to the corridor, and the six joins
 * between the side-B slab, the two voids and the control-center balcony, counted
 * from both faces where both faces exist.
 */
const ZERO_JOIN_COUNT = 8;
/** Built solids: one per contact bar the zero joins, which are not built. */
const SOLID_COUNT = CONTACT_COUNT - ZERO_JOIN_COUNT;
/** Solids the owner wants built heavy for sound and heat. */
const INSULATED_SOLID_COUNT = 63;

/** Wall footprint of the floor, in square metres (TASKS.md: WALLS 44.13). */
const WALL_FOOTPRINT_AREA = 44.125;
/** Clear floor of every space, in square metres: 225.00 − 44.125. */
const CLEAR_FLOOR_AREA = 180.875;
/** The 22.50 × 10.00 plot, in square metres. */
const PLOT_AREA = 225;

/** Cells of the grid cut by the plan alone that carry a wall. */
const CELL_COUNT = 296;
/** Of those, the ones at full wall height. */
const FULL_HEIGHT_CELL_COUNT = 279;
/** Of those, the ones inside the one face declared a parapet. */
const PARAPET_CELL_COUNT = 17;
/** Footprint of the balustrade, in square metres: 9.40 × 0.30. */
const PARAPET_AREA = 2.82;
/**
 * Height the spec states for it, in metres, read from `PARAPET_WALLS` rather than copied.
 *
 * 1.10 since ADR-011: the owner chose 1.10 for the side-A balustrade, and the plan
 * entry carries `HEIGHTS.railing` itself instead of a second literal, so the one
 * balustrade has one number. It was 1.00, and a transcribed copy here would have
 * had to be renumbered — which is exactly how the two numbers drifted apart the
 * first time. The footprint below does not move with it: a height cannot change
 * what a wall covers in plan.
 */
const PARAPET_HEIGHT = PARAPET_WALLS[0].height;
/** The balustrade's footprint: the side-A face, x 0–0.30 over z 0.30–9.70. */
const PARAPET_STRIP: PlanRect = makeRect(0, 0.3, 0.3, 9.7);

/** Blocks the plan alone merges to, before any opening is punched. */
const PIECE_COUNT = 93;
/** Of those, the single parapet block: the whole balustrade in one box. */
const PARAPET_PIECE_COUNT = 1;

/** Cells once the seven fixture openings cut the grid too. */
const FINE_CELL_COUNT = 374;
/** Blocks once those openings are punched out. */
const FINE_PIECE_COUNT = 131;

/* ------------------------------------------------------------------ *
 * Openings of the typical floor: local fixtures.
 * ------------------------------------------------------------------ */

/** One fixture opening: what it is, its footprint, and the wall it pierces. */
interface OpeningFixture {
  /** What the opening is, for the test name. */
  readonly label: string;
  /** Footprint of the hole, as `[minX, maxX, minZ, maxZ]`, in metres. */
  readonly rect: readonly [number, number, number, number];
  /** Whether the hole starts at the floor (a door) or at a sill (a window). */
  readonly kind: 'door' | 'window';
}

/**
 * Seven openings of the floor, measured off the plan's `PORTS` and `WINDOWS` and
 * the walls they sit in. Local fixtures, chosen to cover every way this module
 * has to treat a hole rather than to be the whole schedule: the 0.30 balcony
 * spine, a 0.30 corridor wall, a 0.15 partition, the leafless 3.50 m living-room
 * opening, the 0.30 void-facing wall, and the 0.20 utility join.
 */
const OPENINGS: readonly OpeningFixture[] = [
  { label: 'balcony door into the master bedroom', rect: [1.3, 1.6, 1.55, 2.45], kind: 'door' },
  { label: 'master bedroom door to the corridor', rect: [5.65, 6.55, 3.7, 4], kind: 'door' },
  { label: 'male kids door in the 0.15 corridor wall', rect: [12.3, 13.2, 3.85, 4], kind: 'door' },
  { label: 'leafless living-room opening', rect: [7.5, 11, 3.85, 4], kind: 'door' },
  { label: 'laundry door onto the side-B slab', rect: [14.3, 15.2, 8.6, 8.9], kind: 'door' },
  { label: 'kitchen window over the sink', rect: [10.1, 11.5, 8.6, 8.9], kind: 'window' },
  { label: 'utility window in the 0.20 join', rect: [20.3, 20.5, 8.95, 9.65], kind: 'window' },
];

/**
 * Vertical sizes with every value changed, to prove no height is hard-coded. No
 * value is a real one, and no sum or difference of two of them is either.
 */
const OTHER_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 4.44,
  wall: 3.33,
  door: 2.22,
  railing: 1.55,
});

/**
 * Sill and head of the two fixture windows at production heights, in metres.
 *
 * These are fixture data of this file, not building dimensions: a window carries
 * its own sill and head in the WINDOW SCHEDULE, and `FloorHeights` has no window
 * fields to read them from. They keep the values the floor-wide constants used to
 * hold (0.90 and 2.10) so that the block and cell counts below still describe the
 * same seven holes.
 */
const FIXTURE_WINDOW_SILL = 0.9;
const FIXTURE_WINDOW_HEAD = 2.1;

/**
 * Sill and head of the fixture windows for the injected-heights run, in metres.
 *
 * Deliberately different from {@link FIXTURE_WINDOW_SILL} and
 * {@link FIXTURE_WINDOW_HEAD}, and sharing no value with `FLOOR_HEIGHTS`, so that
 * a level leaked out of the production heights stays visible: no sum or
 * difference of the injected values lands on a real level either.
 */
const OTHER_WINDOW_SILL = 1.11;
const OTHER_WINDOW_HEAD = 2.22;

/**
 * Levels that must never appear when {@link OTHER_HEIGHTS} and the injected
 * window levels are used.
 *
 * {@link FIXTURE_WINDOW_SILL} is here for the reason the floor-wide window sill
 * used to be: 0.90 is a level of the production run only, so seeing it in the
 * injected run means a window level was taken from somewhere it should not be.
 * `FLOOR_HEIGHTS.door` (2.10) covers {@link FIXTURE_WINDOW_HEAD}, which is the
 * same number.
 */
const WITNESSED_FORBIDDEN_LEVELS: readonly number[] = [
  FLOOR_HEIGHTS.wall,
  FLOOR_HEIGHTS.door,
  FIXTURE_WINDOW_SILL,
  SLAB_BOTTOM,
];

/**
 * Forbidden levels that no block of the real floor stands at, kept as tripwires.
 *
 * They cannot fail today, and that is stated rather than hidden. `-SLAB_BOTTOM`
 * would catch a sign flip in the slab arithmetic, which the exact-equality case
 * below already covers. `FLOOR_HEIGHTS.railing` is the level the deleted parapet
 * heuristic compared against: no ORDINARY wall block is built at it — that was
 * already true when the balustrade stood at 1.00 — and since ADR-011 the stated
 * balustrade stands at exactly 1.10, so the one thing on the floor that reaches
 * this level is the parapet, whose top is plan data. It is therefore checked
 * against the blocks that are NOT parapets, where a 1.10 can only mean a railing
 * height leaked into the wall generator.
 */
const TRIPWIRE_FORBIDDEN_LEVELS: readonly number[] = [FLOOR_HEIGHTS.railing, -SLAB_BOTTOM];

const FORBIDDEN_LEVELS: readonly number[] = [
  ...WITNESSED_FORBIDDEN_LEVELS,
  ...TRIPWIRE_FORBIDDEN_LEVELS,
];

/** Shift and shrink used by the plan-argument guards, in metres. */
const KITCHEN_SHIFT_X = 0.05;
/** How much the plot grows by in the guard below, in metres. */
const PLOT_GROWTH = 0.1;
/** Depth of the plot, in metres: what a change of width multiplies by. */
const PLOT_DEPTH = 10;
/** West face of the kitchen in the untouched plan, in metres. */
const KITCHEN_MIN_X = 10;

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

/**
 * Builds the opening boxes of the fixtures: a door runs from the finished floor
 * to the door head, a window from its own sill to its own head.
 *
 * A door still takes its head from the heights, because that is where a door
 * height comes from. A window does not: sill and head are passed in, since they
 * belong to the window and no longer to `FloorHeights`.
 *
 * @param heights - Vertical sizes to use.
 * @param windowSill - Sill of the fixture windows, in metres.
 * @param windowHead - Head of the fixture windows, in metres.
 * @returns The holes, as boxes, in fixture order.
 */
function openingBoxes(
  heights: FloorHeights,
  windowSill: number,
  windowHead: number,
): readonly PlanBox[] {
  return OPENINGS.map(({ rect: [minX, maxX, minZ, maxZ], kind }) =>
    kind === 'door'
      ? makeBox(makeRect(minX, maxX, minZ, maxZ), FLOOR_LEVEL, heights.door)
      : makeBox(makeRect(minX, maxX, minZ, maxZ), windowSill, windowHead),
  );
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
 * Formats a footprint as a comparable key.
 *
 * @param rect - The footprint.
 * @returns A key unique to its four coordinates.
 */
function footprintKey(rect: PlanRect): string {
  return [rect.minX, rect.maxX, rect.minZ, rect.maxZ].map(String).join(',');
}

/**
 * Formats a block as a comparable key: footprint, vertical span and kind.
 *
 * @param piece - The block.
 * @returns A key unique to the whole block.
 */
function pieceKey(piece: WallPiece): string {
  return `${footprintKey(piece.rect)}|${String(piece.bottom)}|${String(piece.top)}|${piece.kind}`;
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

/**
 * Checks whether two boxes share a volume.
 *
 * @param a - First box.
 * @param b - Second box.
 * @returns `true` when their footprints overlap and their vertical spans do too.
 */
function boxesOverlap(a: PlanBox, b: PlanBox): boolean {
  return (
    Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > LENGTH_TOLERANCE &&
    rectsOverlap(a.rect, b.rect)
  );
}

/**
 * Returns the face with the given matricule.
 *
 * @param walls - The derived faces.
 * @param matricule - The matricule to find.
 * @returns That face.
 * @throws Error when no face carries it, so a moved matricule fails loudly.
 */
function faceOf(walls: readonly DerivedWall[], matricule: string): DerivedWall {
  const wall = walls.find((candidate) => candidate.matricule === matricule);
  if (wall === undefined) {
    throw new Error(`no derived wall with matricule ${matricule}`);
  }
  return wall;
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
 * Returns the west face of the kitchen of a plan.
 *
 * @param plan - The plan to read.
 * @returns The `minX` of the kitchen's first rect, in metres.
 */
function kitchenMinX(plan: FloorPlan): number {
  const kitchen = plan.spaces.find((space) => space.id === 'kitchen');
  return kitchen?.rects[0].minX ?? Number.NaN;
}

/* ------------------------------------------------------------------ *
 * Probes on the real plan.
 * ------------------------------------------------------------------ */

/** A point of the real plan, and the wall that must stand there. */
type ProbePoint = readonly [label: string, point: PlanPoint, kind: WallHeightKind];

/** One probe per kind of wall the floor has, including the three thicknesses. */
const PROBE_POINTS: readonly ProbePoint[] = [
  ['outer corner of sides A and C', { x: 0.15, z: 0.15 }, 'wall'],
  ['outer corner of sides A and B', { x: 0.15, z: 9.85 }, 'wall'],
  ['side-B envelope behind the west void', { x: 6, z: 9.85 }, 'wall'],
  ['side-C envelope at the master bedroom', { x: 4.1, z: 0.15 }, 'wall'],
  ['balcony spine behind the master bedroom', { x: 1.45, z: 2 }, 'wall'],
  ['corridor north wall at the master bedroom (0.30)', { x: 6, z: 3.8 }, 'wall'],
  ['corridor north wall at the living room (0.15)', { x: 9, z: 3.92 }, 'wall'],
  ['utility west wall at the east void (0.20)', { x: 20.4, z: 9.2 }, 'wall'],
  ['the side-A balustrade', { x: 0.15, z: 5 }, 'parapet'],
];

/** Points inside a space, where there must be no wall at all. */
const CLEAR_POINTS: readonly (readonly [string, PlanPoint])[] = [
  ['inside the corridor', { x: 9.9, z: 4.65 }],
  ['inside the kitchen', { x: 12, z: 7 }],
  ['inside the west void', { x: 6, z: 9.2 }],
  ['inside the stair bay', { x: 3, z: 5 }],
  ['on the zero join between the stairs and the corridor', { x: 5.6, z: 5 }],
  ['inside the side-A balcony', { x: 0.8, z: 5 }],
];

const WALLS_DERIVED = deriveWalls();
const SOLIDS = getWallSolids();
const CELLS = getWallCells(FLOOR_PLAN, []);
const PIECES = getWallPieces(FLOOR_PLAN, []);
const FIXTURE_OPENINGS = openingBoxes(FLOOR_HEIGHTS, FIXTURE_WINDOW_SILL, FIXTURE_WINDOW_HEAD);
const FINE_CELLS = getWallCells(FLOOR_PLAN, FIXTURE_OPENINGS);
const FINE_PIECES = getWallPieces(FLOOR_PLAN, FIXTURE_OPENINGS);
const SPACE_RECTS: readonly PlanRect[] = ROOMS.flatMap((room) =>
  room.rects.map(([minX, maxX, minZ, maxZ]) => makeRect(minX, maxX, minZ, maxZ)),
);

describe('derived wall faces', () => {
  it('derives 96 frozen faces with unique matricules', () => {
    expect(WALLS_DERIVED).toHaveLength(FACE_COUNT);
    expect(Object.isFrozen(WALLS_DERIVED)).toBe(true);
    WALLS_DERIVED.forEach((wall) => {
      expect(Object.isFrozen(wall)).toBe(true);
      expect(wall.matricule).toMatch(/^F1-R\d{2}-[A-Z]+-W\d+$/u);
    });
    expect(new Set(WALLS_DERIVED.map((wall) => wall.matricule)).size).toBe(FACE_COUNT);
  });

  it('tiles every face with its contacts, end to end and with no gap', () => {
    // The invariant both renderers draw from, and the one check 8 of
    // `scripts/source-of-truth/verify.mjs` asserts independently.
    WALLS_DERIVED.forEach((wall) => {
      const covered = wall.contacts.reduce((sum, contact) => sum + contact.length, 0);

      expect(wall.contacts.length).toBeGreaterThan(NONE);
      expect(covered).toBeCloseTo(wall.length, PRECISION_DIGITS);
      expect(wall.contacts[0].spanMin).toBeCloseTo(wall.spanMin, PRECISION_DIGITS);
      expect(wall.contacts.at(-1)?.spanMax).toBeCloseTo(wall.spanMax, PRECISION_DIGITS);
      wall.contacts.slice(1).forEach((contact, index) => {
        expect(contact.spanMin).toBeCloseTo(wall.contacts[index].spanMax, PRECISION_DIGITS);
      });
    });
    expect(WALLS_DERIVED.reduce((sum, wall) => sum + wall.contacts.length, 0)).toBe(CONTACT_COUNT);
  });

  it('reports the thickest contact as the face thickness, for quantities only', () => {
    WALLS_DERIVED.forEach((wall) => {
      const thicknesses = wall.contacts.map((contact) => contact.thickness);

      expect(wall.thickness).toBeCloseTo(Math.max(...thicknesses), PRECISION_DIGITS);
      expect(wall.varies).toBe(new Set(thicknesses).size > 1);
    });
  });

  it('has exactly six faces that change thickness along their length', () => {
    const varying = WALLS_DERIVED.filter((wall) => wall.varies);

    expect(varying).toHaveLength(VARYING_FACE_COUNT);
    expect(varying.map((wall) => wall.matricule)).toEqual([
      'F1-R05-BED-W3',
      'F1-R07-COR-W1',
      'F1-R09-GST-W7',
      'F1-R10-BTH-W1',
      'F1-R11-KIT-W4',
      'F1-R14-UTL-W4',
    ]);
  });

  it('builds the utility room’s west face 0.30, 0.15 and 0.20 along its length', () => {
    // Three thicknesses against three neighbours, and all three are right: heavy
    // to the corridor, thin to the sanitair, and the 0.20 the owner kept where it
    // passes the east void.
    const face = faceOf(WALLS_DERIVED, 'F1-R14-UTL-W4');

    expect(face.thickness).toBe(WALLS.insulated);
    expect(
      face.contacts.map((contact) => [contact.neighbourId, contact.thickness, contact.reason]),
    ).toEqual([
      ['corridor', WALLS.insulated, 'isolation'],
      [null, WALLS.insulated, 'isolation'],
      ['mainSanitair', WALLS.partition, 'plain separator'],
      [null, WALLS.partition, 'no facing space'],
      ['mainShowerCubicle', WALLS.partition, 'plain separator'],
      [null, 0.2, 'no facing space'],
      ['voidEast', 0.2, 'join override'],
    ]);
  });

  it('builds the kitchen’s west face 0.30 where it wraps the guest room, 0.15 after', () => {
    const face = faceOf(WALLS_DERIVED, 'F1-R11-KIT-W4');

    expect(face.contacts.map((contact) => [contact.neighbourId, contact.thickness])).toEqual([
      ['guestRoom', WALLS.insulated],
      [null, WALLS.insulated],
      ['guestSanitair', WALLS.partition],
      [null, WALLS.partition],
      ['guestShowerCubicle', WALLS.partition],
    ]);
  });

  it.each([
    ['exterior', [WALLS.exterior]],
    ['plain separator', [WALLS.partition]],
    ['weather-exposed', [WALLS.voidFacing]],
    ['join override', [0, 0.2]],
  ] as readonly (readonly [ContactReason, readonly number[]])[])(
    'builds every %s stretch one of the thicknesses that rule allows',
    (reason, allowed) => {
      const offenders = WALLS_DERIVED.flatMap((wall) =>
        wall.contacts
          .filter((contact) => contact.reason === reason && !isOneOf(contact.thickness, allowed))
          .map((contact) => `${wall.matricule} ${String(contact.thickness)}`),
      );

      expect(offenders).toEqual([]);
    },
  );

  it('builds every wall the owner named 0.30 over its whole length', () => {
    // Isolation is a width now. The owner's quoted length is kept beside each
    // matricule as a tripwire: if the numbering ever shifts under his list, this
    // fails instead of silently insulating a different wall.
    INSULATED_WALLS.forEach((entry) => {
      const wall = faceOf(WALLS_DERIVED, entry.matricule);

      expect(wall.length).toBeCloseTo(entry.length, PRECISION_DIGITS);
      wall.contacts.forEach((contact) => {
        expect(contact.thickness).toBeCloseTo(WALLS.insulated, PRECISION_DIGITS);
      });
    });
  });

  it('never thins a wall at a junction: a return takes the thicker side', () => {
    const offenders = WALLS_DERIVED.flatMap((wall) =>
      wall.contacts
        .filter((contact, index) => {
          if (contact.reason !== 'no facing space') {
            return false;
          }
          const around = [wall.contacts[index - 1], wall.contacts[index + 1]]
            .filter((other) => other !== undefined)
            .map((other) => other.thickness);
          return around.length > 0 && contact.thickness < Math.max(...around) - LENGTH_TOLERANCE;
        })
        .map((contact) => `${wall.matricule} at ${String(contact.spanMin)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('carries isolation through a junction: the stronger wall wins the corner', () => {
    // The owner's words: "when X wall meet Y wall and both this the XY point is
    // RED thick win". The return at 5.50–5.80 sits between an isolated stretch
    // and a plain one, and takes the isolated one's width and reason.
    const face = faceOf(WALLS_DERIVED, 'F1-R14-UTL-W4');
    const [toCorridor, corner, toSanitair] = face.contacts;

    expect(toCorridor.reason).toBe('isolation');
    expect(corner.neighbourId).toBeNull();
    expect(corner.reason).toBe('isolation');
    expect(corner.thickness).toBe(WALLS.insulated);
    expect(toSanitair.reason).toBe('plain separator');
    expect(toSanitair.thickness).toBe(WALLS.partition);
  });

  it('never reads isolation at less than the insulated width, anywhere', () => {
    // Isolation IS a width here — 0.30 heavy, 0.15 plain — so `reason:
    // 'isolation'` at 0.15 is a contradiction in terms: a stretch claiming a
    // sound and heat barrier while being built as a thin partition, which a
    // renderer painting the isolated runs red would paint as a thin red wall.
    //
    // This used to be breachable, and was breached at two corners, because the
    // junction rule read its two halves off different neighbourhoods: the WIDTH
    // came from the stretches beside a corner along its own face, the REASON
    // also from the face landing in it. They are read off the same stretches
    // now, so the contradiction is unreachable rather than merely absent — a
    // corner that takes the reason from a heavy stretch takes its width too.
    const thin = WALLS_DERIVED.flatMap((wall) =>
      wall.contacts
        .filter(
          (contact) =>
            contact.reason === 'isolation' &&
            contact.thickness < WALLS.insulated - LENGTH_TOLERANCE,
        )
        .map(
          (contact) => `${wall.matricule} ${String(contact.spanMin)}–${String(contact.spanMax)}`,
        ),
    );
    const thinAndRed = SOLIDS.filter(
      (solid) => solid.insulated && solid.thickness < WALLS.insulated - LENGTH_TOLERANCE,
    ).map((solid) => solid.matricule);

    expect(thin).toEqual([]);
    expect(thinAndRed).toEqual([]);
  });

  it('widens the two guest-suite corners where a 0.30 wall lands in a 0.15 one', () => {
    // The owner's rule for exactly this case: "in thick wall when X wall meet Y
    // wall and both this the XY point is RED thick win". Both corners are one of
    // the guest room's own 0.30 walls landing in a 0.15 wall to a space he
    // deliberately kept OUT of the thick wrap — the control center, "a technical
    // room", and the guest bathroom, excluded by name — so thick wins and the
    // corner is widened, not merely coloured.
    const guestSouth = faceOf(WALLS_DERIVED, 'F1-R09-GST-W7');
    const bathNorth = faceOf(WALLS_DERIVED, 'F1-R10-BTH-W1');
    const shape = (wall: DerivedWall): readonly unknown[] =>
      wall.contacts.map((contact) => [contact.neighbourId, contact.thickness, contact.reason]);

    // The 0.30 wall landing in the guest room's south face is its own west face,
    // which the owner named; the wall landing in the bathroom's north face is the
    // room's east face to the kitchen, which he named too.
    expect(shape(guestSouth)).toEqual([
      ['controlCenter', WALLS.partition, 'plain separator'],
      [null, WALLS.insulated, 'isolation'],
    ]);
    expect(shape(bathNorth)).toEqual([
      ['guestRoom', WALLS.partition, 'plain separator'],
      [null, WALLS.insulated, 'isolation'],
    ]);
    // Widening a corner can only grow it into the landing wall's own footprint,
    // never into a room: the general guard is `never stands a solid in a clear
    // space`, and this is the pair that moved.
    SOLIDS.filter((solid) => solid.matricule === guestSouth.matricule).forEach((solid) => {
      expect(SPACE_RECTS.some((rect) => rectsOverlap(solid.rect, rect))).toBe(false);
    });
  });

  it('sits 15 faces on the envelope and gives each one exterior contact', () => {
    const envelope = WALLS_DERIVED.filter((wall) => wall.exterior);

    expect(envelope).toHaveLength(ENVELOPE_FACE_COUNT);
    envelope.forEach((wall) => {
      expect(wall.contacts).toHaveLength(1);
      expect(wall.contacts[0].reason).toBe('exterior');
      expect(wall.contacts[0].thickness).toBe(WALLS.exterior);
      expect(wall.faces).toBe('outside');
      expect(wall.neighbours).toEqual([]);
    });
  });
});

describe('wall solids', () => {
  it('builds one solid per contact, skipping the eight joins with no masonry', () => {
    const zeroJoins = WALLS_DERIVED.flatMap((wall) =>
      wall.contacts.filter((contact) => contact.thickness <= LENGTH_TOLERANCE),
    );

    expect(zeroJoins).toHaveLength(ZERO_JOIN_COUNT);
    expect(SOLIDS).toHaveLength(SOLID_COUNT);
    expect(Object.isFrozen(SOLIDS)).toBe(true);
    SOLIDS.forEach((solid) => {
      expect(solid.thickness).toBeGreaterThan(LENGTH_TOLERANCE);
    });
  });

  it('never stands a solid in a clear space', () => {
    const offenders = SOLIDS.filter((solid) =>
      SPACE_RECTS.some((rect) => rectsOverlap(solid.rect, rect)),
    ).map((solid) => solid.matricule);

    expect(offenders).toEqual([]);
  });

  it('marks every stretch the owner wants heavy, named face or backing face', () => {
    // Typed as strings: `INSULATED_WALLS` gives a literal union, and a derived
    // matricule is a plain string, so the set has to be widened to compare them.
    const named = new Set<string>(INSULATED_WALLS.map((entry) => entry.matricule));
    const insulated = SOLIDS.filter((solid) => solid.insulated);

    expect(insulated).toHaveLength(INSULATED_SOLID_COUNT);
    SOLIDS.filter((solid) => named.has(solid.matricule)).forEach((solid) => {
      expect(solid.insulated).toBe(true);
    });
  });
});

describe('wall cells of the typical floor', () => {
  it('covers the 44.125 m² wall footprint with 296 frozen cells', () => {
    expect(CELLS).toHaveLength(CELL_COUNT);
    expect(cellArea(CELLS)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
    expect(Object.isFrozen(CELLS)).toBe(true);
    CELLS.forEach((cell) => {
      expect(Object.isFrozen(cell)).toBe(true);
    });
  });

  it('closes on the plot: clear floor plus walls is the whole 225.00 m²', () => {
    // The strongest single statement about the layout, and the one that catches a
    // room moved 5 cm: nothing is double-counted and nothing is missing.
    const clear = SPACE_RECTS.reduce((sum, rect) => sum + rectArea(rect), 0);

    expect(clear).toBeCloseTo(CLEAR_FLOOR_AREA, PRECISION_DIGITS);
    expect(clear + cellArea(CELLS)).toBeCloseTo(PLOT_AREA, PRECISION_DIGITS);
    expect(rectArea(makeRect(PLOT[0], PLOT[1], PLOT[2], PLOT[3]))).toBe(PLOT_AREA);
  });

  it('never overlaps two cells and never puts one inside a space', () => {
    const overlaps = CELLS.flatMap((cell, index) =>
      CELLS.slice(index + 1)
        .filter((other) => rectsOverlap(cell.rect, other.rect))
        .map((other) => `${footprintKey(cell.rect)} ↔ ${footprintKey(other.rect)}`),
    );
    const inside = CELLS.filter((cell) =>
      SPACE_RECTS.some((rect) => rectsOverlap(cell.rect, rect)),
    ).map((cell) => footprintKey(cell.rect));

    expect(overlaps).toEqual([]);
    expect(inside).toEqual([]);
  });

  it('stands full height everywhere except the one declared balustrade', () => {
    // Side B is a normal exterior wall now, so nothing is inferred from what a
    // cell faces and no parapet arises by accident. The only low wall is the one
    // `PARAPET_WALLS` names.
    const full = CELLS.filter((cell) => cell.kind === 'wall');
    const parapet = CELLS.filter((cell) => cell.kind === 'parapet');

    expect(full).toHaveLength(FULL_HEIGHT_CELL_COUNT);
    expect(parapet).toHaveLength(PARAPET_CELL_COUNT);
    expect(new Set(full.map((cell) => cell.height))).toEqual(new Set([FLOOR_HEIGHTS.wall]));
    expect(new Set(parapet.map((cell) => cell.height))).toEqual(new Set([PARAPET_HEIGHT]));
  });

  it('puts the balustrade on the side-A face the spec names, 1.10 m over 9.40', () => {
    const parapet = CELLS.filter((cell) => cell.kind === 'parapet');

    expect(PARAPET_WALLS).toHaveLength(PARAPET_PIECE_COUNT);
    expect(PARAPET_WALLS[0].matricule).toBe('F1-R01-BAL-W4');
    // Pinned against the railing constant, not against PARAPET_HEIGHT, which is read
    // from this very entry and so could only agree with itself. ADR-011: the owner
    // chose 1.10 and the entry states it AS the constant, so a plan that went back to
    // a literal — 1.00, or a 1.10 written out again — fails here.
    expect(PARAPET_WALLS[0].height).toBe(FLOOR_HEIGHTS.railing);
    expect(PARAPET_HEIGHT).toBeLessThan(FLOOR_HEIGHTS.wall);
    expect(cellArea(parapet)).toBeCloseTo(PARAPET_AREA, PRECISION_DIGITS);
    expect(cellArea(parapet)).toBeCloseTo(
      faceOf(WALLS_DERIVED, 'F1-R01-BAL-W4').length * WALLS.exterior,
      PRECISION_DIGITS,
    );
    parapet.forEach((cell) => {
      expect(rectContainsRect(PARAPET_STRIP, cell.rect)).toBe(true);
    });
  });

  it('keeps the balustrade to its own ends, so the corners still close', () => {
    // The blocks where sides C and B land on the balcony face lie beyond the
    // named face's span, so they stay full height: a stated parapet must not eat
    // the corner of the wall that crosses it.
    const corners = [
      { x: 0.15, z: 0.15 },
      { x: 0.15, z: 9.85 },
    ];

    corners.forEach((point) => {
      const cell = cellAt(CELLS, point);

      expect(cell?.kind).toBe('wall');
      expect(cell?.height).toBe(FLOOR_HEIGHTS.wall);
    });
  });

  it.each(PROBE_POINTS)('walls the %s', (_label, point, kind) => {
    const cell = cellAt(CELLS, point);

    expect(cell).toBeDefined();
    expect(cell?.kind).toBe(kind);
  });

  it.each(CLEAR_POINTS)('leaves no wall %s', (_label, point) => {
    expect(cellAt(CELLS, point)).toBeUndefined();
  });

  it('classifies the cells identically however finely the grid is cut', () => {
    const mismatches = CELLS.filter((cell) => {
      const fine = cellAt(FINE_CELLS, centreOf(cell.rect));
      return fine === undefined || fine.height !== cell.height || fine.kind !== cell.kind;
    }).map((cell) => footprintKey(cell.rect));

    expect(FINE_CELLS).toHaveLength(FINE_CELL_COUNT);
    expect(mismatches).toEqual([]);
  });
});

describe('wall blocks of the typical floor', () => {
  it('merges the plan’s walls into 93 frozen blocks', () => {
    expect(PIECES).toHaveLength(PIECE_COUNT);
    expect(Object.isFrozen(PIECES)).toBe(true);
    PIECES.forEach((piece) => {
      expect(Object.isFrozen(piece)).toBe(true);
      expect(Object.isFrozen(piece.rect)).toBe(true);
      expect(piece.bottom).toBe(SLAB_BOTTOM);
    });
    expect(getWallFootprintArea(PIECES)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('carries the kind on every block, and keeps the parapet in one box', () => {
    // The renderer is told rather than left to guess. Guessing by height was the
    // old defect and it is no more workable now than it was: the stated parapet
    // and the railing constant read 1.10 alike since ADR-011, so a top of 1.10
    // says nothing about which of the two a block is, and an opening cuts a
    // full-height wall into blocks that top out at a sill or a threshold anyway.
    // What the height comparison would really do is answer a different question:
    // `heights.railing` is an argument, and the stated height is plan data, so the
    // two coincide at production heights and part company at any other — see the
    // injected-heights block below.
    const parapets = PIECES.filter((piece) => piece.kind === 'parapet');

    expect(parapets).toHaveLength(PARAPET_PIECE_COUNT);
    expect(parapets[0].rect).toEqual(PARAPET_STRIP);
    expect(parapets[0].top).toBe(PARAPET_HEIGHT);
    expect(parapets[0].bottom).toBe(SLAB_BOTTOM);
    expect(PIECES.filter((piece) => piece.kind === 'wall')).toHaveLength(
      PIECE_COUNT - PARAPET_PIECE_COUNT,
    );
  });

  it('closes on its own volume: the footprint less the balustrade’s missing height', () => {
    const fullHeight = WALL_FOOTPRINT_AREA * (FLOOR_HEIGHTS.wall - SLAB_BOTTOM);
    const parapetSaving = PARAPET_AREA * (FLOOR_HEIGHTS.wall - PARAPET_HEIGHT);

    expect(PIECES.reduce((sum, piece) => sum + boxVolume(piece), 0)).toBeCloseTo(
      fullHeight - parapetSaving,
      PRECISION_DIGITS,
    );
  });

  it('never overlaps two blocks in three dimensions', () => {
    const offenders = PIECES.flatMap((piece, index) =>
      PIECES.slice(index + 1)
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
});

describe('openings punched out of the walls', () => {
  it('keeps the footprint: a hole changes the blocks, never the plan area', () => {
    expect(FINE_PIECES).toHaveLength(FINE_PIECE_COUNT);
    expect(getWallFootprintArea(FINE_PIECES)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('removes exactly the volume of the holes, no more and no less', () => {
    // Every fixture opening lies wholly inside masonry, so the arithmetic is
    // exact: this catches a hole that missed its wall as well as one punched twice.
    const solid = PIECES.reduce((sum, piece) => sum + boxVolume(piece), 0);
    const holes = FIXTURE_OPENINGS.reduce((sum, opening) => sum + boxVolume(opening), 0);

    expect(FINE_PIECES.reduce((sum, piece) => sum + boxVolume(piece), 0)).toBeCloseTo(
      solid - holes,
      PRECISION_DIGITS,
    );
  });

  it.each(OPENINGS.map((opening, index) => [opening.label, index] as const))(
    'leaves a threshold and a lintel at the %s',
    (_label, index) => {
      const opening = FIXTURE_OPENINGS[index];
      const centre = centreOf(opening.rect);
      const through = FINE_PIECES.filter(
        (piece) =>
          rectContainsPoint(piece.rect, centre) &&
          Math.min(piece.top, opening.top) - Math.max(piece.bottom, opening.bottom) >
            LENGTH_TOLERANCE,
      );
      const below = FINE_PIECES.filter(
        (piece) =>
          rectContainsPoint(piece.rect, centre) && piece.top <= opening.bottom + LENGTH_TOLERANCE,
      );
      const above = FINE_PIECES.filter(
        (piece) =>
          rectContainsPoint(piece.rect, centre) && piece.bottom >= opening.top - LENGTH_TOLERANCE,
      );

      expect(through).toEqual([]);
      expect(below.length).toBeGreaterThan(NONE);
      expect(above.length).toBeGreaterThan(NONE);
      below.forEach((piece) => {
        expect(piece.bottom).toBe(SLAB_BOTTOM);
        expect(piece.top).toBeCloseTo(opening.bottom, PRECISION_DIGITS);
      });
      above.forEach((piece) => {
        expect(piece.bottom).toBeCloseTo(opening.top, PRECISION_DIGITS);
        expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
      });
    },
  );
});

describe('injected heights', () => {
  const otherOpenings = openingBoxes(OTHER_HEIGHTS, OTHER_WINDOW_SILL, OTHER_WINDOW_HEAD);
  const pieces = getWallPieces(FLOOR_PLAN, otherOpenings, OTHER_HEIGHTS);
  const cells = getWallCells(FLOOR_PLAN, otherOpenings, OTHER_HEIGHTS);
  const levels = [...new Set(pieces.flatMap((piece) => [piece.bottom, piece.top]))];
  /**
   * The levels that must come from the argument: every block that is not a stated
   * parapet. A parapet's top is plan data — 1.10 m, which no height may move — so
   * sweeping it up here would forbid the plan from stating the number it states.
   * It is pinned on its own in the case below instead.
   */
  const heightLevels = [
    ...new Set(
      pieces
        .filter((piece) => piece.kind !== 'parapet')
        .flatMap((piece) => [piece.bottom, piece.top]),
    ),
  ];

  it('forbids levels the real floor really stands at, and says which are only tripwires', () => {
    // Without this the guard below could pass by forbidding levels nothing is ever
    // built at. Each witnessed level is checked to be on the real floor's own
    // blocks; each tripwire is checked NOT to be, so neither list can rot quietly
    // into the other.
    const realLevels = FINE_PIECES.filter((piece) => piece.kind !== 'parapet').flatMap((piece) => [
      piece.bottom,
      piece.top,
    ]);

    expect(WITNESSED_FORBIDDEN_LEVELS.length).toBeGreaterThan(NONE);
    WITNESSED_FORBIDDEN_LEVELS.forEach((level) => {
      expect(isOneOf(level, realLevels), String(level)).toBe(true);
    });
    TRIPWIRE_FORBIDDEN_LEVELS.forEach((level) => {
      expect(isOneOf(level, realLevels), String(level)).toBe(false);
    });
  });

  it('takes every level from the argument, never from FLOOR_HEIGHTS', () => {
    expect(heightLevels.filter((level) => isOneOf(level, FORBIDDEN_LEVELS))).toEqual([]);
    expect(Math.max(...levels)).toBeCloseTo(OTHER_HEIGHTS.wall, PRECISION_DIGITS);
  });

  it('starts the walls at exactly the underside the injected slab implies', () => {
    // Exact equality: the shared `slabs.ts` helper is what keeps the walls and
    // the slabs on one level, whatever heights come in.
    expect(Math.min(...levels)).toBe(-getSlabThickness(OTHER_HEIGHTS));
  });

  it('keeps the stated parapet at its own height, which no argument can move', () => {
    // The one level that does not come from `heights`: the spec states 1.10 m for
    // the balustrade, so it stays 1.10 while every other level changes.
    //
    // This is where the stated height and the railing height part company, and so
    // it is where a module that read `heights.railing` for the balustrade would be
    // caught: at production heights the two are both 1.10 and nothing could tell
    // them apart, but the injected railing is 1.55 and the balustrade must ignore
    // it. The difference is asserted rather than trusted, because the day someone
    // sets OTHER_HEIGHTS.railing to 1.10 this case would go quietly vacuous.
    expect(OTHER_HEIGHTS.railing).not.toBe(PARAPET_HEIGHT);
    expect(
      new Set(cells.filter((cell) => cell.kind === 'parapet').map((cell) => cell.height)),
    ).toEqual(new Set([PARAPET_HEIGHT]));
    expect(
      new Set(cells.filter((cell) => cell.kind === 'wall').map((cell) => cell.height)),
    ).toEqual(new Set([OTHER_HEIGHTS.wall]));
  });

  it('keeps the footprint, which no height can change', () => {
    expect(getWallFootprintArea(pieces)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
    expect(cellArea(cells)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });
});

describe('the plan argument contributes only its plot', () => {
  /*
   * WHY the old mutation guards are gone. They moved the kitchen inside an
   * injected `FloorPlan` and expected the walls around it to move, and they were
   * right to, because the spaces used to come from that argument. They do not any
   * more: `getWallCells` and `getWallPieces` keep their signature but read the
   * spaces from `sourceOfTruth/plan.ts`, and take only `plan.plot` from what is
   * handed in. That is deliberate — the matricules, the isolation list and the
   * stated parapet all name faces of one floor, and deriving those faces from an
   * argument meant a caller could hand in a floor where `F1-R11-KIT-W4` was a
   * different wall, or no wall. One source, so a matricule means one thing.
   *
   * So what a guard can prove has changed with it: injecting geometry through
   * the spaces must now be INERT, and the plot must still be live. Both are
   * tested below — an inert argument is only safe if it is inert on purpose, and
   * the day someone re-reads `plan.spaces` in this module, the first test fails.
   */

  it('ignores the spaces of the plan: a shifted kitchen moves no wall', () => {
    const shifted = withKitchenShifted(FLOOR_PLAN, KITCHEN_SHIFT_X);
    const pieces = getWallPieces(shifted, FIXTURE_OPENINGS);

    expect(kitchenMinX(shifted)).not.toBe(kitchenMinX(FLOOR_PLAN));
    expect(pieces.map(pieceKey)).toEqual(FINE_PIECES.map(pieceKey));
    expect(getWallCells(shifted, []).map((cell) => footprintKey(cell.rect))).toEqual(
      CELLS.map((cell) => footprintKey(cell.rect)),
    );
  });

  it('ignores them even when there are none at all', () => {
    const empty: FloorPlan = { ...FLOOR_PLAN, spaces: [] };

    expect(getWallPieces(empty, []).map(pieceKey)).toEqual(PIECES.map(pieceKey));
  });

  it('reads the plot, which frames the grid: a wider plot is a wider envelope', () => {
    const wider: FloorPlan = {
      ...FLOOR_PLAN,
      plot: makeRect(PLOT[0], PLOT[1] + PLOT_GROWTH, PLOT[2], PLOT[3]),
    };
    const narrower: FloorPlan = {
      ...FLOOR_PLAN,
      plot: makeRect(PLOT[0], PLOT[1] - WALLS.exterior, PLOT[2], PLOT[3]),
    };

    expect(getWallFootprintArea(getWallPieces(wider, []))).toBeCloseTo(
      WALL_FOOTPRINT_AREA + PLOT_GROWTH * PLOT_DEPTH,
      PRECISION_DIGITS,
    );
    expect(getWallFootprintArea(getWallPieces(narrower, []))).toBeCloseTo(
      WALL_FOOTPRINT_AREA - WALLS.exterior * PLOT_DEPTH,
      PRECISION_DIGITS,
    );
  });

  it('leaves FLOOR_PLAN untouched after every mutation', () => {
    withKitchenShifted(FLOOR_PLAN, KITCHEN_SHIFT_X);

    expect(kitchenMinX(FLOOR_PLAN)).toBe(KITCHEN_MIN_X);
    expect(getWallFootprintArea(getWallPieces(FLOOR_PLAN, FIXTURE_OPENINGS))).toBeCloseTo(
      WALL_FOOTPRINT_AREA,
      PRECISION_DIGITS,
    );
  });
});
