import { describe, expect, it, vi } from 'vitest';
import { findSpaceAt, FLOOR_PLAN, getSpace, getSpaceBounds } from './floorPlan/index.ts';
import type { FloorPlan } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import type { PlanBox } from './planBox.ts';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectContainsPoint,
  rectContainsRect,
  rectsOverlap,
} from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { STAIRS } from './sourceOfTruth/plan.ts';
import { getBlockedRects, getStairsLayout, STAIRS_SPEC } from './stairs.ts';
import type { StairPiece, StairsLayout } from './stairs.ts';

/**
 * What this file used to assert, and why those assertions are deleted rather
 * than renumbered.
 *
 * The stair of ADR-008 was a straight 17-riser flight climbing from this floor
 * to the one above inside a 3.70 × 1.50 bay, and the old tests were written
 * against a layout exposing `flightRect` and `halfLandingRect` and a single
 * blocked rect. The stair is now the plan's half-turn in a 4.00 × 2.00 bay, and —
 * the owner's correction, which landed while this file was being rewritten — it
 * RUNS THROUGH this storey rather than starting or ending on it: this is the
 * typical floor of a stack, so one flight rises out of the arrival landing to
 * half a storey above and the other arrives at it from half a storey below. So:
 *
 * - the `flightRect` / `halfLandingRect` tests are gone: those fields do not
 *   exist. The bay is tiled by the pieces the spec declares, and the tests below
 *   walk `layout.pieces`, so a fifth piece would be checked without an edit here;
 * - the `piece.highLevel` / `piece.lowLevel` tests are gone: a footprint can
 *   carry more than one walking surface now, so a piece exposes `surfaces`. The
 *   turn landing carries two, half a storey above this floor and half below,
 *   because the stair repeats every storey and both levels are real;
 * - every "climbs to `floorToFloor`" assertion is gone, and so is the
 *   "descends to −floorToFloor" assertion that briefly replaced it. Both
 *   described a stair that stops at a storey. The invariant that replaced them is
 *   `lowestLevel === -highestLevel`, tested below: the stair is symmetric about
 *   this floor because it passes through it;
 * - the 17-tread table is gone. There are 18 step boxes, nine each side of this
 *   floor, each one riser thick rather than standing on the floor below — a box
 *   filling the volume under the upper flight would block the shaft the lower one
 *   needs. They are pinned as an invariant on the riser lines rather than as a
 *   table of coordinates;
 * - the link-corridor door tests are gone outright: `linkCorridor` is not a space
 *   of the plan any more. That the stair door lands on floor at this level is
 *   proved against the port schedule by check 6 of
 *   `scripts/source-of-truth/verify.mjs`; repeating it here would copy that check;
 * - the bay-shape rejections ("a run of exactly eight goings", "a bay that ends
 *   before the landing edge") are gone because the pieces no longer come from the
 *   bay handed in: they are read from `STAIRS` at module scope. The only
 *   disagreement a caller can still create is a `stairs` space that is not the
 *   spec bay, which is rejected below. The flight- and landing-shape rejections
 *   inside `validatePieces` and `validateFlightPair` cannot be reached from a
 *   test at all without editing the source of truth, and are covered by check 7
 *   of the verifier, which asserts them against the spec directly.
 */

const PRECISION_DIGITS = 9;
/** Digits to compare a riser at: 3.00 / 18 is 0.1667, not a grid value. */
const RISER_DIGITS = 4;
const HALF = 0.5;
const NONE = 0;

/**
 * Synthetic heights, injected everywhere a vertical value is checked. A
 * floor-to-floor of 3.60 m gives a round 0.20 m riser over the spec's 18 risers,
 * unlike the 0.1667 of `FLOOR_HEIGHTS`, so a level that ignored the injected
 * heights would stand out.
 */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 3.6,
  wall: 3.0,
  door: 2.2,
  railing: 1.2,
});

/** `SYNTHETIC_HEIGHTS.floorToFloor / 18`, written out. */
const SYNTHETIC_RISER = 0.2;
/** Half a storey under {@link SYNTHETIC_HEIGHTS}: 9 risers of 0.20. */
const SYNTHETIC_HALF_STOREY = 1.8;
/** `FLOOR_HEIGHTS.floorToFloor / 18`, to {@link RISER_DIGITS}. */
const REAL_RISER = 0.1667;
/** Half a storey on the real floor: 9 risers of 3.00 / 18 = 1.50 m. */
const REAL_HALF_STOREY = 1.5;

/** The stair bay of the source of truth: 4.00 × 2.00 at the west end of the corridor. */
const EXPECTED_BAY: PlanRect = { minX: 1.6, maxX: 5.6, minZ: 4, maxZ: 6 };
/** The arrival landing: the eastern 1.00 m of the bay, the only floor at this level. */
const EXPECTED_LANDING: PlanRect = { minX: 4.6, maxX: 5.6, minZ: 4, maxZ: 6 };

/** The pieces the spec declares, in declaration order. */
const PIECE_NAMES: readonly string[] = ['landingEast', 'flightA', 'halfLanding', 'flightB'];
/**
 * The same four pieces with `flightB` moved to the head of the declaration.
 *
 * A pure reordering: not one coordinate moves, so the stair it describes is the
 * stair the owner drew, and flightA must still be the flight climbed out of the
 * arrival landing. Taking the flights in plain declaration order instead would
 * swap the two here.
 */
const FLIGHT_FIRST_ORDER: readonly string[] = ['flightB', 'landingEast', 'flightA', 'halfLanding'];
/** The same four pieces with the arrival landing declared last: the wrap-around. */
const LANDING_LAST_ORDER: readonly string[] = ['flightA', 'halfLanding', 'flightB', 'landingEast'];
/** Which way a flight climbs: toward −x, the half-landing at the west end of the bay. */
const WEST = -1;
/** Which way the other climbs: toward +x, back to this floor's landing. */
const EAST = 1;
/** The pieces that are not floor at this storey, in declaration order. */
const BLOCKED_NAMES: readonly string[] = ['flightA', 'halfLanding', 'flightB'];
const PIECE_COUNT = 4;
const BLOCKED_COUNT = 3;
/** Landings, and the two surfaces the turn carries. */
const TURN_SURFACE_COUNT = 2;
const ONE_SURFACE = 1;

/**
 * Step boxes: 18, nine each side of this floor. One per riser of the storey —
 * the arrival landing carries none, being slab rather than stair, and the turn
 * landing is stepped twice, once at each of its two levels.
 */
const STEP_COUNT = 18;
/** Risers between this floor and the turn, above or below: half of 18. */
const RISERS_PER_FLIGHT = 9;

/** Where a person arrives, by hand: the centre of the arrival landing. */
const EXPECTED_ARRIVAL: readonly [number, number] = [5.1, 5];
/** Forward direction expected at the arrival yaw: straight toward +x, the corridor. */
const EXPECTED_FORWARD: readonly [number, number] = [1, 0];
/**
 * A step forward from the arrival long enough to cross the bay's open east face
 * at x 5.60: 5.10 + 0.80 = 5.90, inside the corridor. The opposite heading would
 * land at 4.30, over flightA, which is a hole at this level.
 */
const STEP_TO_CORRIDOR = 0.8;

const NOT_A_NUMBER = Number.NaN;
const INFINITE = Number.POSITIVE_INFINITY;
const NON_POSITIVE_HEIGHT = 0;

const LAYOUT = getStairsLayout(FLOOR_PLAN, SYNTHETIC_HEIGHTS);
const DEFAULT_LAYOUT = getStairsLayout(FLOOR_PLAN);

/**
 * Builds a copy of the plan whose `stairs` space is a single given rect.
 *
 * @param bay - Coordinates of the replacement bay, `[minX, maxX, minZ, maxZ]`.
 * @returns A new plan; `FLOOR_PLAN` is not modified.
 */
function withStairsBay(bay: readonly [number, number, number, number]): FloorPlan {
  return {
    ...FLOOR_PLAN,
    spaces: FLOOR_PLAN.spaces.map((space) =>
      space.id === 'stairs' ? { ...space, rects: [makeRect(...bay)] } : space,
    ),
  };
}

/**
 * Builds a copy of the plan with one space removed.
 *
 * @param id - Identifier of the space to drop.
 * @returns A new plan; `FLOOR_PLAN` is not modified.
 */
function without(id: string): FloorPlan {
  return { ...FLOOR_PLAN, spaces: FLOOR_PLAN.spaces.filter((space) => space.id !== id) };
}

/**
 * Returns the piece a layout declares under a given name.
 *
 * @param layout - The layout to search.
 * @param name - The spec key of the piece.
 * @returns The piece.
 * @throws Error when the spec no longer declares it, which fails the test loudly
 *   rather than letting an `undefined` compare equal to nothing.
 */
function pieceNamed(layout: StairsLayout, name: string): StairPiece {
  const piece = layout.pieces.find((candidate) => candidate.name === name);
  if (piece === undefined) {
    throw new Error(`the spec declares no stair piece named "${name}"`);
  }
  return piece;
}

/**
 * Returns the steps that stand on one piece of the bay.
 *
 * @param layout - The layout to read.
 * @param piece - The piece whose treads are wanted.
 * @returns Its steps, in climbing order.
 */
function stepsOn(layout: StairsLayout, piece: StairPiece): readonly PlanBox[] {
  return layout.steps
    .filter((step) => rectContainsRect(piece.rect, step.rect))
    .toSorted((a, b) => a.top - b.top);
}

/**
 * Returns which way along its run a flight climbs.
 *
 * Read off the treads rather than off the piece, so it says which way a walker
 * actually goes rather than how the rectangle happens to be written.
 *
 * @param layout - The layout to read.
 * @param piece - The flight.
 * @returns `+1` when the treads climb toward +x or +z, `-1` when they climb
 *   toward the origin.
 */
function climbDirection(layout: StairsLayout, piece: StairPiece): number {
  const treads = stepsOn(layout, piece);
  const first = treads.at(0);
  const last = treads.at(-1);

  expect(treads.length).toBeGreaterThan(ONE_SURFACE);
  if (first === undefined || last === undefined) {
    throw new Error(`the flight "${piece.name}" carries no treads`);
  }
  const along = last.rect.minX - first.rect.minX;
  return Math.sign(Math.abs(along) > LENGTH_TOLERANCE ? along : last.rect.minZ - first.rect.minZ);
}

/**
 * The owner's spec with its pieces declared in a given order, nothing else changed.
 *
 * Built from `STAIRS` itself rather than from coordinates copied into this file,
 * so a reordered spec is provably the same stair: only the order of the keys
 * differs, and a test built on it cannot drift from the source of truth.
 *
 * @param order - The piece keys, in the order the spec should declare them.
 * @returns A `STAIRS`-shaped object: the sizes, then the pieces in `order`.
 * @throws Error when a key is not one the spec declares, which fails the test
 *   loudly rather than quietly dropping a piece from the bay.
 */
function withPieceOrder(order: readonly string[]): Readonly<Record<string, unknown>> {
  const declared = STAIRS as unknown as Readonly<Record<string, unknown>>;
  const { bay, riserCount, going, flightWidth } = STAIRS;

  return {
    bay,
    riserCount,
    going,
    flightWidth,
    ...Object.fromEntries(
      order.map((key) => {
        const rect = declared[key];
        if (rect === undefined) {
          throw new Error(`the spec declares no stair piece named "${key}"`);
        }
        return [key, rect];
      }),
    ),
  };
}

/**
 * Derives the layout from a spec whose pieces are declared in a given order.
 *
 * `stairs.ts` reads `STAIRS` once, at import, so declaration order can only be
 * varied by replacing that module and importing the stairs again. Everything
 * else in the source of truth is left exactly as it is, and the plan handed in
 * is the real one: the bay, the joins and the corridor do not move.
 *
 * @param order - The piece keys, in declaration order.
 * @returns The layout that spec produces under {@link SYNTHETIC_HEIGHTS}.
 */
async function layoutWithPieceOrder(order: readonly string[]): Promise<StairsLayout> {
  const spec = withPieceOrder(order);

  vi.resetModules();
  vi.doMock('./sourceOfTruth/plan.ts', async () => ({
    ...(await vi.importActual<typeof import('./sourceOfTruth/plan.ts')>('./sourceOfTruth/plan.ts')),
    STAIRS: spec,
  }));
  try {
    const { getStairsLayout: fromReorderedSpec } = await import('./stairs.ts');
    return fromReorderedSpec(FLOOR_PLAN, SYNTHETIC_HEIGHTS);
  } finally {
    vi.doUnmock('./sourceOfTruth/plan.ts');
    vi.resetModules();
  }
}

describe('stairs', () => {
  describe('STAIRS_SPEC', () => {
    it('holds the sizes of the half-turn stair: 18 risers, 0.25 going, 1.00 flight', () => {
      // Was 17 risers of 0.25 by 0.75 wide: the straight flight of ADR-008.
      expect(STAIRS_SPEC).toEqual({ riserCount: 18, going: 0.25, flightWidth: 1 });
      expect(Object.isFrozen(STAIRS_SPEC)).toBe(true);
    });

    it('divides its risers equally between the two flights', () => {
      const flights = DEFAULT_LAYOUT.pieces.filter((piece) => piece.isFlight);

      expect(flights).toHaveLength(TURN_SURFACE_COUNT);
      expect(STAIRS_SPEC.riserCount / flights.length).toBe(RISERS_PER_FLIGHT);
    });
  });

  describe('the bay and the pieces that tile it', () => {
    it('takes the bay from the stairs space of the plan', () => {
      expect(getSpaceBounds(getSpace(FLOOR_PLAN, 'stairs'))).toEqual(EXPECTED_BAY);
      expect(DEFAULT_LAYOUT.bay).toEqual(EXPECTED_BAY);
    });

    it('enumerates the spec’s four pieces in declaration order', () => {
      expect(LAYOUT.pieces.map((piece) => piece.name)).toEqual(PIECE_NAMES);
      expect(LAYOUT.pieces).toHaveLength(PIECE_COUNT);
    });

    it('tiles the bay exactly: inside it, no overlap, areas summing to it', () => {
      const covered = LAYOUT.pieces.reduce((sum, piece) => sum + rectArea(piece.rect), 0);
      const overlaps = LAYOUT.pieces.flatMap((piece, index) =>
        LAYOUT.pieces
          .slice(index + 1)
          .filter((other) => rectsOverlap(piece.rect, other.rect))
          .map((other) => `${piece.name} ↔ ${other.name}`),
      );

      expect(overlaps).toEqual([]);
      LAYOUT.pieces.forEach((piece) => {
        expect(rectContainsRect(LAYOUT.bay, piece.rect)).toBe(true);
      });
      expect(covered).toBeCloseTo(rectArea(LAYOUT.bay), PRECISION_DIGITS);
    });

    it('gives each flight one flight width and the run its treads need', () => {
      // The last riser of a flight lands on the landing above, so the treads
      // needing floor are one fewer than the risers.
      const run = (RISERS_PER_FLIGHT - 1) * STAIRS_SPEC.going;

      LAYOUT.pieces
        .filter((piece) => piece.isFlight)
        .forEach((flight) => {
          const width = flight.rect.maxX - flight.rect.minX;
          const depth = flight.rect.maxZ - flight.rect.minZ;

          expect(Math.min(width, depth)).toBeCloseTo(STAIRS_SPEC.flightWidth, PRECISION_DIGITS);
          expect(Math.max(width, depth)).toBeCloseTo(run, PRECISION_DIGITS);
        });
    });

    it('gives every landing room to turn a 180° in', () => {
      LAYOUT.pieces
        .filter((piece) => !piece.isFlight)
        .forEach((landing) => {
          const width = landing.rect.maxX - landing.rect.minX;
          const depth = landing.rect.maxZ - landing.rect.minZ;

          expect(Math.max(width, depth)).toBeGreaterThanOrEqual(
            STAIRS_SPEC.flightWidth - LENGTH_TOLERANCE,
          );
        });
    });

    it('hands the walker over at the arrival landing: both flights meet it', () => {
      // What makes the pair one stair rather than two. Both flights touching the
      // landing is also what lets the module tell which one is climbed out of it:
      // the one that was not arrived by.
      LAYOUT.pieces
        .filter((piece) => piece.isFlight)
        .forEach((flight) => {
          expect(flight.rect.maxX).toBeCloseTo(LAYOUT.landingRect.minX, PRECISION_DIGITS);
          expect(rectsOverlap(flight.rect, LAYOUT.landingRect)).toBe(false);
        });
    });
  });

  describe('the stair runs through this floor', () => {
    it('reaches half a storey above as far as it reaches below', () => {
      // The assertion that replaced "descends to the storey below". A stair that
      // stopped here would have a zero on one side of this floor.
      expect(LAYOUT.highestLevel).toBeCloseTo(SYNTHETIC_HALF_STOREY, PRECISION_DIGITS);
      expect(LAYOUT.lowestLevel).toBeCloseTo(-SYNTHETIC_HALF_STOREY, PRECISION_DIGITS);
      expect(LAYOUT.lowestLevel).toBeCloseTo(-LAYOUT.highestLevel, PRECISION_DIGITS);
      expect(LAYOUT.highestLevel).toBeCloseTo(RISERS_PER_FLIGHT * LAYOUT.riser, PRECISION_DIGITS);
      expect(DEFAULT_LAYOUT.highestLevel).toBeCloseTo(REAL_HALF_STOREY, PRECISION_DIGITS);
      expect(DEFAULT_LAYOUT.lowestLevel).toBeCloseTo(-REAL_HALF_STOREY, PRECISION_DIGITS);
    });

    it('is floor at this storey on the arrival landing and nowhere else', () => {
      const here = LAYOUT.pieces.filter((piece) => piece.atThisLevel);

      expect(here.map((piece) => piece.name)).toEqual(['landingEast']);
      expect(LAYOUT.landingRect).toEqual(EXPECTED_LANDING);
      expect(here[0].surfaces).toEqual([{ lowLevel: 0, highLevel: 0 }]);
    });

    it('occupies the turn landing twice, once at each of its levels', () => {
      // The stair repeats every storey, so the footprint of the turn is floor
      // half a storey up AND half a storey down. This is the fact that a single
      // level per piece could not express.
      const turn = pieceNamed(LAYOUT, 'halfLanding');

      expect(turn.surfaces).toHaveLength(TURN_SURFACE_COUNT);
      expect(turn.surfaces.map((surface) => surface.lowLevel)).toEqual([
        LAYOUT.lowestLevel,
        LAYOUT.highestLevel,
      ]);
      turn.surfaces.forEach((surface) => {
        expect(surface.highLevel).toBe(surface.lowLevel);
      });
    });

    it('sends one flight up out of this floor and brings the other up to it', () => {
      const flights = LAYOUT.pieces.filter((piece) => piece.isFlight);
      const rising = flights.filter((flight) => flight.surfaces[0].lowLevel === 0);
      const arriving = flights.filter((flight) => flight.surfaces[0].highLevel === 0);

      expect(rising).toHaveLength(ONE_SURFACE);
      expect(arriving).toHaveLength(ONE_SURFACE);
      expect(rising[0].surfaces[0].highLevel).toBeCloseTo(LAYOUT.highestLevel, PRECISION_DIGITS);
      expect(arriving[0].surfaces[0].lowLevel).toBeCloseTo(LAYOUT.lowestLevel, PRECISION_DIGITS);
      flights.forEach((flight) => {
        expect(flight.surfaces).toHaveLength(ONE_SURFACE);
        expect(flight.surfaces[0].highLevel - flight.surfaces[0].lowLevel).toBeCloseTo(
          SYNTHETIC_HALF_STOREY,
          PRECISION_DIGITS,
        );
      });
    });

    it('runs its two flights in opposite directions, flightA west out of this floor', () => {
      // A half-turn that repeats hands the walker from one strip to the other at
      // every landing, so the strip climbed out of this floor is the one not
      // arrived by. The relation is stated first, because it survives the stair
      // being mirrored — which the rectangles alone allow. WHICH strip rises is
      // not left to the mirror, though: the spec breaks that tie, and the last
      // two lines pin its answer, so a layout that merely got the two opposite
      // no longer passes.
      const [first, second] = LAYOUT.pieces.filter((piece) => piece.isFlight);
      const directions = [climbDirection(LAYOUT, first), climbDirection(LAYOUT, second)];

      expect(directions[0]).not.toBe(NONE);
      expect(directions[0]).toBe(-directions[1]);
      expect(climbDirection(LAYOUT, pieceNamed(LAYOUT, 'flightA'))).toBe(WEST);
      expect(climbDirection(LAYOUT, pieceNamed(LAYOUT, 'flightB'))).toBe(EAST);
    });
  });

  describe('which flight is climbed out of the arrival landing', () => {
    it('climbs the flight declared after the landing: flightA, up and west', () => {
      const up = pieceNamed(LAYOUT, 'flightA');
      const arriving = pieceNamed(LAYOUT, 'flightB');

      expect(up.surfaces[0].lowLevel).toBe(NONE);
      expect(up.surfaces[0].highLevel).toBeCloseTo(LAYOUT.highestLevel, PRECISION_DIGITS);
      expect(arriving.surfaces[0].lowLevel).toBeCloseTo(LAYOUT.lowestLevel, PRECISION_DIGITS);
      expect(arriving.surfaces[0].highLevel).toBe(NONE);
    });

    it('reads the tie-break from the landing, not from the head of the list', async () => {
      // The regression this pins. `flightB` is declared first and not one
      // coordinate moves; taking the flights in plain declaration order would
      // make flightB the flight climbed out of this floor, invert both flights'
      // surfaces and lay every tread against the direction of travel. Nothing
      // else in the module would notice: the tiling, the pairing and the step
      // geometry are all direction-blind, which is why this test exists.
      const layout = await layoutWithPieceOrder(FLIGHT_FIRST_ORDER);
      const up = pieceNamed(layout, 'flightA');
      const arriving = pieceNamed(layout, 'flightB');

      expect(layout.pieces.map((piece) => piece.name)).toEqual(FLIGHT_FIRST_ORDER);
      expect(up.surfaces[0].lowLevel).toBe(NONE);
      expect(up.surfaces[0].highLevel).toBeCloseTo(layout.highestLevel, PRECISION_DIGITS);
      expect(arriving.surfaces[0].lowLevel).toBeCloseTo(layout.lowestLevel, PRECISION_DIGITS);
      expect(arriving.surfaces[0].highLevel).toBe(NONE);
      expect(climbDirection(layout, up)).toBe(WEST);
      expect(climbDirection(layout, arriving)).toBe(EAST);
    });

    it('wraps to the head of the list when the arrival landing is declared last', async () => {
      // The order is a walk away from the arrival landing, and the walk is a
      // circuit because the stair repeats every storey: a landing declared last
      // is followed by the piece declared first. Refusing such a spec would
      // reject a stair that is perfectly well described.
      const layout = await layoutWithPieceOrder(LANDING_LAST_ORDER);

      expect(layout.pieces.map((piece) => piece.name)).toEqual(LANDING_LAST_ORDER);
      expect(pieceNamed(layout, 'flightA').surfaces[0].lowLevel).toBe(NONE);
      expect(climbDirection(layout, pieceNamed(layout, 'flightA'))).toBe(WEST);
      expect(climbDirection(layout, pieceNamed(layout, 'flightB'))).toBe(EAST);
    });

    it('derives the owner’s own layout again through the same harness', async () => {
      // Guards the two tests above: were replacing the spec module to change
      // anything by itself, this would drift from the layout built at import.
      const layout = await layoutWithPieceOrder(PIECE_NAMES);

      expect(layout.pieces).toEqual(LAYOUT.pieces);
      expect(layout.steps).toEqual(LAYOUT.steps);
      expect(layout.arrival).toEqual(LAYOUT.arrival);
    });
  });

  describe('the steps', () => {
    it('lays one box per riser of the storey, 18 in all', () => {
      expect(LAYOUT.steps).toHaveLength(STEP_COUNT);
      expect(LAYOUT.steps).toHaveLength(STAIRS_SPEC.riserCount);
    });

    it('makes every box exactly one riser thick', () => {
      // Not a solid mass standing on the floor below: a box filling the volume
      // under the upper flight would take the headroom over the lower one and
      // block the shaft the storey below needs.
      LAYOUT.steps.forEach((step) => {
        expect(step.top - step.bottom).toBeCloseTo(LAYOUT.riser, PRECISION_DIGITS);
      });
    });

    it('puts every tread on a riser line, nine each side of this floor', () => {
      // The whole vertical layout as one statement: the tops are the riser lines
      // from −9 to +9 with zero left out, because this floor's own level is the
      // arrival landing, which is slab and carries no step.
      const risersUp = LAYOUT.steps.map((step) => Math.round(step.top / LAYOUT.riser));

      LAYOUT.steps.forEach((step, index) => {
        expect(step.top).toBeCloseTo(risersUp[index] * LAYOUT.riser, PRECISION_DIGITS);
      });
      expect(risersUp.toSorted((a, b) => a - b)).toEqual([
        -9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    it('lists the steps in climbing order', () => {
      expect(LAYOUT.steps.map((step) => step.top)).toEqual(
        LAYOUT.steps.map((step) => step.top).toSorted((a, b) => a - b),
      );
    });

    it('anchors the real floor at a 0.1667 riser, tops −1.50 … +1.50', () => {
      expect(DEFAULT_LAYOUT.riser).toBeCloseTo(REAL_RISER, RISER_DIGITS);
      expect(DEFAULT_LAYOUT.steps[0].top).toBeCloseTo(-REAL_HALF_STOREY, PRECISION_DIGITS);
      expect(DEFAULT_LAYOUT.steps.at(-1)?.top).toBeCloseTo(REAL_HALF_STOREY, PRECISION_DIGITS);
    });

    it('never overlaps two steps in 3D', () => {
      const offenders = LAYOUT.steps.flatMap((step, index) =>
        LAYOUT.steps
          .slice(index + 1)
          .filter(
            (other) =>
              rectsOverlap(step.rect, other.rect) &&
              Math.min(step.top, other.top) - Math.max(step.bottom, other.bottom) >
                LENGTH_TOLERANCE,
          )
          .map((_other, offset) => `${String(index)} ↔ ${String(index + 1 + offset)}`),
      );

      expect(offenders).toEqual([]);
    });

    it('stays inside the bay and leaves the arrival landing to the slab', () => {
      LAYOUT.steps.forEach((step) => {
        expect(rectContainsRect(LAYOUT.bay, step.rect)).toBe(true);
        expect(rectsOverlap(step.rect, LAYOUT.landingRect)).toBe(false);
      });
      expect(stepsOn(LAYOUT, pieceNamed(LAYOUT, 'landingEast'))).toEqual([]);
    });

    it('covers the bay’s own area, the turn counted at both its levels', () => {
      // The footprints sum to the whole bay even though the arrival landing
      // carries nothing: the turn is stepped twice, and its 2.00 m² makes up for
      // the landing's.
      const covered = LAYOUT.steps.reduce((sum, step) => sum + rectArea(step.rect), 0);
      const turn = pieceNamed(LAYOUT, 'halfLanding');

      expect(covered).toBeCloseTo(rectArea(LAYOUT.bay), PRECISION_DIGITS);
      expect(stepsOn(LAYOUT, turn)).toHaveLength(TURN_SURFACE_COUNT);
    });
  });

  describe('getBlockedRects', () => {
    it('blocks the two flights and the turn: three rects, not one', () => {
      // Was a single rect, the flight area of the straight stair. Everything but
      // the arrival landing is a hole at this level now.
      const blocked = getBlockedRects(FLOOR_PLAN);

      expect(blocked).toHaveLength(BLOCKED_COUNT);
      expect(blocked).toEqual(BLOCKED_NAMES.map((name) => pieceNamed(DEFAULT_LAYOUT, name).rect));
    });

    it('blocks exactly the bay less the arrival landing', () => {
      const blocked = getBlockedRects(FLOOR_PLAN);
      const area = blocked.reduce((sum, rect) => sum + rectArea(rect), 0);

      expect(area).toBeCloseTo(
        rectArea(DEFAULT_LAYOUT.bay) - rectArea(DEFAULT_LAYOUT.landingRect),
        PRECISION_DIGITS,
      );
    });

    it('never blocks the landing or the arrival', () => {
      const blocked = getBlockedRects(FLOOR_PLAN);

      expect(blocked).not.toContainEqual(EXPECTED_LANDING);
      blocked.forEach((rect) => {
        expect(rectsOverlap(rect, EXPECTED_LANDING)).toBe(false);
        expect(rectContainsPoint(rect, DEFAULT_LAYOUT.arrival)).toBe(false);
      });
    });
  });

  describe('the arrival', () => {
    it('stands at the centre of the arrival landing, (5.10, 5.00)', () => {
      expect(LAYOUT.arrival.x).toBeCloseTo(EXPECTED_ARRIVAL[0], PRECISION_DIGITS);
      expect(LAYOUT.arrival.z).toBeCloseTo(EXPECTED_ARRIVAL[1], PRECISION_DIGITS);
      expect(LAYOUT.arrival.x).toBeCloseTo(
        (LAYOUT.landingRect.minX + LAYOUT.landingRect.maxX) * HALF,
        PRECISION_DIGITS,
      );
      expect(rectContainsPoint(LAYOUT.landingRect, LAYOUT.arrival)).toBe(true);
    });

    it('stands in the stairs space of the plan', () => {
      expect(findSpaceAt(FLOOR_PLAN, LAYOUT.arrival)?.id).toBe('stairs');
    });

    it('faces the corridor, toward +x', () => {
      const forward = [-Math.sin(LAYOUT.arrival.yaw), -Math.cos(LAYOUT.arrival.yaw)] as const;

      expect(forward[0]).toBeCloseTo(EXPECTED_FORWARD[0], PRECISION_DIGITS);
      expect(forward[1]).toBeCloseTo(EXPECTED_FORWARD[1], PRECISION_DIGITS);
      expect(LAYOUT.arrival.yaw).toBeLessThan(NONE);
    });

    it('walks into the corridor, not over a flight, when it steps forward', () => {
      const forward = { x: -Math.sin(LAYOUT.arrival.yaw), z: -Math.cos(LAYOUT.arrival.yaw) };
      const ahead = {
        x: LAYOUT.arrival.x + forward.x * STEP_TO_CORRIDOR,
        z: LAYOUT.arrival.z + forward.z * STEP_TO_CORRIDOR,
      };

      expect(findSpaceAt(FLOOR_PLAN, ahead)?.id).toBe('corridor');
      getBlockedRects(FLOOR_PLAN).forEach((rect) => {
        expect(rectContainsPoint(rect, ahead)).toBe(false);
      });
    });
  });

  describe('injected heights', () => {
    it('takes every vertical value from the injected heights, not from FLOOR_HEIGHTS', () => {
      expect(LAYOUT.riser).toBeCloseTo(SYNTHETIC_RISER, PRECISION_DIGITS);
      expect(LAYOUT.riser).not.toBeCloseTo(DEFAULT_LAYOUT.riser, PRECISION_DIGITS);
      expect(LAYOUT.highestLevel).not.toBeCloseTo(DEFAULT_LAYOUT.highestLevel, PRECISION_DIGITS);
      LAYOUT.steps.forEach((step, index) => {
        expect(step.top).not.toBeCloseTo(DEFAULT_LAYOUT.steps[index].top, PRECISION_DIGITS);
      });
    });

    it('divides the injected storey into exactly its own risers', () => {
      expect(LAYOUT.riser * STAIRS_SPEC.riserCount).toBeCloseTo(
        SYNTHETIC_HEIGHTS.floorToFloor,
        PRECISION_DIGITS,
      );
      expect(DEFAULT_LAYOUT.riser * STAIRS_SPEC.riserCount).toBeCloseTo(
        FLOOR_HEIGHTS.floorToFloor,
        PRECISION_DIGITS,
      );
    });

    it('keeps the plan geometry independent of the heights', () => {
      expect(LAYOUT.bay).toEqual(DEFAULT_LAYOUT.bay);
      expect(LAYOUT.landingRect).toEqual(DEFAULT_LAYOUT.landingRect);
      expect(LAYOUT.blockedRects).toEqual(DEFAULT_LAYOUT.blockedRects);
      expect(LAYOUT.arrival).toEqual(DEFAULT_LAYOUT.arrival);
      expect(LAYOUT.steps.map((step) => step.rect)).toEqual(
        DEFAULT_LAYOUT.steps.map((step) => step.rect),
      );
    });
  });

  describe('frozen results', () => {
    it('freezes the layout, its pieces, their surfaces, its steps and its arrival', () => {
      expect(Object.isFrozen(LAYOUT)).toBe(true);
      expect(Object.isFrozen(LAYOUT.bay)).toBe(true);
      expect(Object.isFrozen(LAYOUT.landingRect)).toBe(true);
      expect(Object.isFrozen(LAYOUT.arrival)).toBe(true);
      expect(Object.isFrozen(LAYOUT.pieces)).toBe(true);
      expect(Object.isFrozen(LAYOUT.steps)).toBe(true);
      LAYOUT.pieces.forEach((piece) => {
        expect(Object.isFrozen(piece)).toBe(true);
        expect(Object.isFrozen(piece.rect)).toBe(true);
        expect(Object.isFrozen(piece.surfaces)).toBe(true);
        piece.surfaces.forEach((surface) => {
          expect(Object.isFrozen(surface)).toBe(true);
        });
      });
      LAYOUT.steps.forEach((step) => {
        expect(Object.isFrozen(step)).toBe(true);
        expect(Object.isFrozen(step.rect)).toBe(true);
      });
    });

    it('freezes the blocked rects', () => {
      const blocked = getBlockedRects(FLOOR_PLAN);

      expect(Object.isFrozen(blocked)).toBe(true);
      blocked.forEach((rect) => {
        expect(Object.isFrozen(rect)).toBe(true);
      });
    });
  });

  describe('rejections', () => {
    it.each([
      ['a bay 0.30 m short of the spec', [1.6, 5.3, 4, 6] as const],
      ['a bay shallower than the spec', [1.6, 5.6, 4, 5.5] as const],
      ['a bay moved east', [2, 6, 4, 6] as const],
    ])('rejects %s: the plan and the spec must move together', (_label, bay) => {
      const call = (): unknown => getStairsLayout(withStairsBay(bay), SYNTHETIC_HEIGHTS);

      expect(call).toThrow(RangeError);
      expect(call).toThrow(/spec bay/u);
      expect(() => getBlockedRects(withStairsBay(bay))).toThrow(RangeError);
    });

    it('rejects a plan with no stairs space', () => {
      const call = (): unknown => getStairsLayout(without('stairs'), SYNTHETIC_HEIGHTS);

      expect(call).toThrow(RangeError);
      expect(call).toThrow('no space with id "stairs"');
    });

    it.each([
      ['the zero join to the corridor is gone', { ...FLOOR_PLAN, joinOverrides: [] }],
      ['the corridor itself is gone', without('corridor')],
    ])('rejects a plan where %s: nothing is floor at this storey', (_label, plan) => {
      // What makes `landingEast` the arrival is the wall-less join to the
      // corridor, never its name: two floors meeting with nothing between them
      // are at the same level. Take the join away and the stair has no landing on
      // this floor at all, which must fail rather than pick a piece at random.
      const call = (): unknown => getStairsLayout(plan, SYNTHETIC_HEIGHTS);

      expect(call).toThrow(RangeError);
      expect(call).toThrow(/floor at this storey/u);
    });

    it.each([
      ['a non-finite floor-to-floor', NOT_A_NUMBER],
      ['an infinite floor-to-floor', INFINITE],
      ['a floor-to-floor of zero', NON_POSITIVE_HEIGHT],
      ['a negative floor-to-floor', -SYNTHETIC_HEIGHTS.floorToFloor],
    ])('rejects %s', (_label, floorToFloor) => {
      const call = (): unknown =>
        getStairsLayout(FLOOR_PLAN, { ...SYNTHETIC_HEIGHTS, floorToFloor });

      expect(call).toThrow(RangeError);
      expect(call).toThrow('floorToFloor');
    });

    it('accepts the real plan and heights unchanged', () => {
      expect(() => getStairsLayout(FLOOR_PLAN)).not.toThrow();
      expect(() => getBlockedRects(FLOOR_PLAN)).not.toThrow();
    });
  });
});
