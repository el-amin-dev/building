/**
 * The stairs of the typical floor: a half-turn stair that runs THROUGH this
 * storey rather than starting or ending on it.
 *
 * This is the typical floor of a stack, so the stairwell repeats every storey
 * and this floor sees one storey's worth of a stair that continues in both
 * directions. `STAIRS` (`sourceOfTruth/plan.ts`) declares the bay and one
 * rectangle per piece, and this module enumerates whatever rectangles it finds
 * there instead of naming them. An earlier renderer kept a hand-written list of
 * three names and silently omitted the fourth piece the day the owner added it;
 * the reference verifier enumerates the spec for exactly that reason
 * (`scripts/source-of-truth/verify.mjs`, check 7), and so does this.
 *
 * What each piece means is read off the geometry, with one convention:
 *
 * - a piece whose name contains `flight` is a flight. That is the one thing the
 *   verifier reads off the names too, and it is checked rather than trusted:
 *   every flight must measure one flight run by {@link STAIRS_SPEC}'s
 *   `flightWidth`, and every landing must be long enough to turn in;
 * - which piece is floor at this storey is derived, never assumed. A landing is
 *   at this level when it runs up to a face of the bay that carries no wall at
 *   all — a zero join (brief §4.2) — and faces floored space across it. Floors
 *   that meet with no wall between them are at the same level, which is what
 *   makes the arrival landing recognisable by its join to the corridor rather
 *   than by its name;
 * - the two flights touching that landing run in OPPOSITE vertical directions,
 *   and that is derived from the repeat rather than hard-coded. A dog-leg that
 *   repeats has to hand the walker from one strip to the other at each
 *   half-landing, so the strip climbed out of this landing is necessarily the
 *   strip not arrived by: one flight rises from this floor to the half-landing
 *   above, the other rises from the half-landing below to this floor. Modelling
 *   both as descending would be a stair that arrives here and stops, showing no
 *   way up at all.
 *
 * The handover rule fixes the two flights' *relationship*; it cannot say which
 * of them is climbed, because the two strips are mirror images in plan and the
 * mirrored stair is just as buildable. That one tie is broken by the
 * declaration order — the first flight declared after the arrival landing is the
 * one climbed out of it — which is what the spec's own wording says of flight A:
 * it is written straight after `landingEast` and it rises west. The spec's order
 * is a walk rather than a list, and both this module and the reference verifier
 * read it as one ("listed in travel order", `verify.mjs` check 7).
 *
 * The walk closes into a circuit, because the stair repeats: an arrival landing
 * declared LAST is followed by the head of the list, so the tie-break wraps
 * rather than refusing. What it never does is count from the head of the list
 * regardless of where the landing sits — that would let a flight declared
 * *before* the arrival landing claim the climb, so moving one line of `STAIRS`
 * without touching a single coordinate would swap which strip rises, invert both
 * flights' surfaces and lay their treads against the direction of travel.
 *
 * Two consequences worth stating, because they are what changed when the owner
 * corrected the stair:
 *
 * - the half-landing's footprint is occupied TWICE, half a storey above this
 *   floor and half a storey below, since the stair repeats. A piece therefore
 *   carries a list of {@link StairSurface}s rather than one pair of levels;
 * - the stair solid crosses this floor's plane: part of it stands above and part
 *   below, between {@link StairsLayout.lowestLevel} and
 *   {@link StairsLayout.highestLevel}. Each step is one riser thick, a
 *   closed-riser step rather than a block filling everything under it, so the
 *   shaft stays open and the headroom over the lower flight is not filled in.
 *
 * The bay is a hole through this floor except at the arrival landing, which
 * {@link StairsLayout.blockedRects} records piece by piece. Collision does not
 * read it: `collision.ts` sweeps the plot for itself and the shaft comes out as
 * fall cells, because no slab is poured there (ADR-013).
 *
 * Two readings of the same stair live here, and they must not be confused:
 *
 * - {@link getStairsLayout} says what is BUILT on this storey — the rectangles,
 *   the step boxes and the hole through the floor — with the storey's own level
 *   handed in as a {@link StairsPlacement}, so a stack of storeys is one
 *   function called once per storey;
 * - {@link getStairwell} says what can be WALKED from this storey, which is more
 *   than one storey's worth: the climb continues onto the next storey's flights,
 *   and those are this storey's own flights lifted by a `floorToFloor`, because
 *   the stair repeats. It is a reading, not a second model: no surface it
 *   reports is anywhere the layout does not already put stair.
 *
 * Pure geometry: plan coordinates in metres with the conventions of
 * `floorPlan/types.ts`, vertical levels in metres relative to this finished
 * floor, and yaw in radians with the conventions of `thirdPersonCamera.ts`
 * (ADR-004).
 */

import {
  FLOOR_PLAN,
  getJoinThickness,
  getNeighbours,
  getSpace,
  getSpaceBounds,
  hasFloor,
} from './floorPlan/index.ts';
import type { FloorPlan, Space, SpaceContact, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectsOverlap,
  toPlanLength,
} from './planGeometry.ts';
import type { PlanRect, RectSide } from './planGeometry.ts';
import { STAIRS } from './sourceOfTruth/plan.ts';
import { STAIR_REACH_RISERS } from './stairwell.ts';
import type { PlanAxis, StairLanding, StairRamp, Stairwell } from './stairwell.ts';

/** The space of the plan the stairs fill (brief §4.2). */
const STAIRS_SPACE_ID: SpaceId = 'stairs';

/** The key of `STAIRS` that holds the bay itself rather than a piece standing in it. */
const BAY_KEY = 'bay';

/** Number of coordinates of a rectangle in the spec: `[minX, maxX, minZ, maxZ]`. */
const RECT_COORDINATE_COUNT = 4;

/**
 * What marks a piece of the stair as a flight rather than a landing.
 *
 * The only thing still read off a piece's name, as in check 7 of the reference
 * verifier: nothing in the rectangles says which of two touching pieces is
 * climbed and which is stood on. The reading is then checked against the sizes
 * a flight must have, so a mis-named piece fails loudly instead of quietly
 * becoming floor.
 */
const FLIGHT_NAME_PATTERN = /flight/i;

/**
 * Flights one storey of the stair is made of: one up out of this floor, one
 * arriving at it from below.
 *
 * A half-turn stair that repeats has exactly two per storey — that is what the
 * handover at the half-landing means. A spec with another number is not this
 * shape of stair and is refused rather than guessed at.
 */
const FLIGHTS_PER_STOREY = 2;

/** Landings one storey of the stair is made of: the arrival landing and the turn. */
const LANDINGS_PER_STOREY = 2;

/** Factor that turns the sum of two opposite faces into their midpoint. */
const MIDPOINT_FACTOR = 0.5;

/** Risers a flight spends on its landing: the last riser of a flight lands on the next landing. */
const RISERS_LANDED = 1;

/** The lowest floor of a stack, the one nothing stands under: floors are counted from 1. */
const LOWEST_FLOOR = 1;

/** The four faces of a rectangle, in a stable order. Frozen. */
const ALL_SIDES: readonly RectSide[] = Object.freeze(['minX', 'maxX', 'minZ', 'maxZ']);

/** The face opposite each face of a rectangle. Frozen. */
const OPPOSITE_SIDE: Readonly<Record<RectSide, RectSide>> = Object.freeze({
  minX: 'maxX',
  maxX: 'minX',
  minZ: 'maxZ',
  maxZ: 'minZ',
});

/**
 * Yaw that looks away from each face of the bay, in radians.
 *
 * Yaw 0 looks toward −z and the forward direction is `(−sin yaw, −cos yaw)`
 * (`thirdPersonCamera.ts`, ADR-004), so a person standing on the arrival
 * landing and facing out through its open edge takes the yaw of that edge's
 * side. Frozen.
 */
const YAW_FACING_OUT: Readonly<Record<RectSide, number>> = Object.freeze({
  minX: Math.PI / 2,
  maxX: -Math.PI / 2,
  minZ: 0,
  maxZ: Math.PI,
});

/** Fixed sizes of the stair, in metres, as the spec declares them. Frozen. */
export const STAIRS_SPEC: {
  /** Number of equal risers for one full storey. */
  readonly riserCount: number;
  /** Depth of one tread. */
  readonly going: number;
  /** Width of one flight: wide enough to carry a washing machine (owner). */
  readonly flightWidth: number;
} = Object.freeze({
  riserCount: STAIRS.riserCount,
  going: STAIRS.going,
  flightWidth: STAIRS.flightWidth,
});

/**
 * Where one storey of the stair sits in the stack.
 *
 * The stair is the same stair on every storey, drawn once; what changes from
 * one storey to the next is the level its arrival landing is at. Handing that
 * level in rather than assuming zero is what lets a stack of storeys be built
 * from one layout function, each storey's stair meeting the next.
 */
export interface StairsPlacement {
  /** Level of the finished floor this storey's stair arrives at, in metres. */
  readonly level: number;
}

/**
 * This storey at level 0: the whole floor measured from its own finished floor.
 *
 * The default, and what the module said privately before a stack existed to
 * place a storey in. Every level a layout reports is relative to this.
 */
export const THIS_STOREY_PLACEMENT: StairsPlacement = Object.freeze({ level: 0 });

/**
 * Where a person arrives on the floor and which way they face: on the stairs
 * landing that is floor at this storey, looking out through its open edge.
 *
 * Entry is through the stairs only (brief §4.2, ADR-006). This is a plain plan
 * pose rather than an `EyePose`: Part 3 raises it to eye height and hands it to
 * the navigation model.
 */
export interface StairsArrival {
  /** Position along the plan width, in metres. */
  readonly x: number;
  /** Position along the plan depth, in metres. */
  readonly z: number;
  /** Heading, in radians: 0 looks toward −z, forward is `(−sin yaw, −cos yaw)`. */
  readonly yaw: number;
}

/**
 * One walking surface a piece's footprint carries.
 *
 * A landing is one level throughout, so both ends are equal; a flight rises from
 * its low end to its high end. A footprint can carry more than one surface: the
 * stair repeats every storey, so the half-landing is floor half a storey above
 * this one AND half a storey below it.
 */
export interface StairSurface {
  /** Level of the walking surface at the low end of the run, in metres. */
  readonly lowLevel: number;
  /** Level at its high end; equal to the low end on a landing. */
  readonly highLevel: number;
}

/** One rectangle of the stair bay, as the spec declares it and this module reads it. */
export interface StairPiece {
  /** The key the spec declares the rectangle under, e.g. `landingEast`. */
  readonly name: string;
  /** Footprint of the piece, in plan coordinates. */
  readonly rect: PlanRect;
  /** Whether the piece is a flight, as opposed to a landing stood on. */
  readonly isFlight: boolean;
  /**
   * Whether the footprint is floor at this storey: walkable, continuous with the
   * space across the bay's open edge. Only the arrival landing is.
   */
  readonly atThisLevel: boolean;
  /** Every walking surface the footprint carries, lowest first. */
  readonly surfaces: readonly StairSurface[];
  /**
   * For a flight, the face of its footprint its low end lies on; `undefined` on
   * a landing, which has no low end.
   *
   * Nothing in {@link StairPiece.surfaces} says which end of the rectangle is
   * low — that is exactly what makes a flight a height function rather than a
   * rectangle at two levels — so a walker reading the stair as a surface needs
   * this to know which way it climbs. The face is the one the flight is handed
   * a walker across: the arrival landing for the flight climbed out of this
   * storey, the turn below for the flight arriving at it.
   */
  readonly lowEndSide: RectSide | undefined;
}

/** The complete geometry of the stairs of one floor, in metres. */
export interface StairsLayout {
  /** The bay the stair stands in, as the spec declares it. */
  readonly bay: PlanRect;
  /** Every piece the spec declares, in declaration order. */
  readonly pieces: readonly StairPiece[];
  /** The arrival landing: the only piece that is floor at this storey's level. */
  readonly landingRect: PlanRect;
  /** The pieces that are not floor at this storey: the hole the stair hangs in. */
  readonly blockedRects: readonly PlanRect[];
  /**
   * The steps, in ascending order: the half-landing below, the treads of the
   * flight rising to this floor, the treads of the flight rising out of it, and
   * the half-landing above. Each box is one riser thick — the tread and the
   * riser face under it — so the boxes form an open shaft rather than a solid
   * mass, and the headroom over the lower flight stays clear.
   *
   * The arrival landing carries no step: it is floor at this storey and belongs
   * to the slab, not to the stair.
   */
  readonly steps: readonly PlanBox[];
  /** Height of one riser: `heights.floorToFloor / riserCount`, in metres, not rounded. */
  readonly riser: number;
  /**
   * Level of the finished floor this stair arrives at, in metres: the placement
   * it was built with. Every other level of the layout is measured from it.
   */
  readonly level: number;
  /**
   * Rise of one flight, in metres: half a storey, the distance from this floor
   * to either turn landing. `halfStorey * 2` is `heights.floorToFloor`, which is
   * what makes one storey's stair meet the next without a step of its own.
   */
  readonly halfStorey: number;
  /**
   * Lowest walking surface of the stair, in metres: half a storey below this
   * floor. Negative, because the stair passes through this floor rather than
   * beginning on it.
   */
  readonly lowestLevel: number;
  /**
   * Highest walking surface, in metres: half a storey above this floor. The
   * flight leaving this storey rises past the ceiling plane of the room, so a
   * renderer must leave the bay open above as well as below.
   */
  readonly highestLevel: number;
  /** Where a person arrives on this floor. */
  readonly arrival: StairsArrival;
}

/** A rectangle of the bay as the spec declares it, before anything is known about it. */
interface SpecPiece {
  /** The key the spec declares it under. */
  readonly name: string;
  /** Its footprint. */
  readonly rect: PlanRect;
  /**
   * Where the spec declares it, counting only the pieces: `0` for the first.
   *
   * Carried on the piece rather than looked up again later, because the order is
   * a walk and the tie-break above reads it from the arrival landing outwards.
   */
  readonly index: number;
}

/** A piece recognised as floor at this storey, with the open edge that proves it. */
interface LevelPiece extends SpecPiece {
  /** The face of the bay the piece runs up to, which carries no wall. */
  readonly openSide: RectSide;
}

/**
 * Tells whether a value of the spec is a rectangle: four numbers.
 *
 * @param value - The value declared under a key of `STAIRS`.
 * @returns `true` when the value is an array of exactly four finite numbers.
 */
function isRectCoordinates(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length === RECT_COORDINATE_COUNT &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

/**
 * Turns the spec's `[minX, maxX, minZ, maxZ]` into a plan rectangle.
 *
 * @param coordinates - The four coordinates, in metres.
 * @returns A frozen {@link PlanRect}.
 */
function toRect(coordinates: readonly number[]): PlanRect {
  return makeRect(coordinates[0], coordinates[1], coordinates[2], coordinates[3]);
}

/**
 * Every rectangle `STAIRS` declares beside the bay, in declaration order.
 *
 * Enumerated rather than listed: a fifth piece joins the stair here, in the
 * checks below and in the renderer without a line of this module changing.
 */
const SPEC_PIECES: readonly SpecPiece[] = Object.freeze(
  Object.entries(STAIRS)
    .flatMap(([name, value]) =>
      name === BAY_KEY || !isRectCoordinates(value) ? [] : [{ name, rect: toRect(value) }],
    )
    .map((piece, index) => Object.freeze({ ...piece, index })),
);

/** The bay the pieces tile, as the spec declares it. Frozen. */
const SPEC_BAY: PlanRect = toRect(STAIRS.bay);

/** The flights of the stair, in declaration order. */
const SPEC_FLIGHTS: readonly SpecPiece[] = Object.freeze(
  SPEC_PIECES.filter((piece) => FLIGHT_NAME_PATTERN.test(piece.name)),
);

/** The landings of the stair, in declaration order. */
const SPEC_LANDINGS: readonly SpecPiece[] = Object.freeze(
  SPEC_PIECES.filter((piece) => !FLIGHT_NAME_PATTERN.test(piece.name)),
);

/**
 * Returns the coordinate of one face of a rectangle.
 *
 * @param rect - The rectangle.
 * @param side - Which face to locate.
 * @returns The x of a `minX`/`maxX` face, the z of a `minZ`/`maxZ` face, in metres.
 */
function faceCoordinate(rect: PlanRect, side: RectSide): number {
  switch (side) {
    case 'minX':
      return rect.minX;
    case 'maxX':
      return rect.maxX;
    case 'minZ':
      return rect.minZ;
    default:
      return rect.maxZ;
  }
}

/**
 * Returns the extent of a rectangle along one plan axis.
 *
 * @param rect - The rectangle.
 * @param axis - `'x'` or `'z'`.
 * @returns `[min, max]` along that axis, in metres.
 */
function extentAlong(rect: PlanRect, axis: 'x' | 'z'): readonly [number, number] {
  return axis === 'x' ? [rect.minX, rect.maxX] : [rect.minZ, rect.maxZ];
}

/**
 * Returns the axis a face runs along: the one its span is measured on.
 *
 * @param side - The face.
 * @returns `'z'` for the `minX` and `maxX` faces, `'x'` for the other two.
 */
function axisOfFace(side: RectSide): 'x' | 'z' {
  return side === 'minX' || side === 'maxX' ? 'z' : 'x';
}

/**
 * Tells whether two ranges share more than a touching point.
 *
 * @param a - First `[min, max]` range, in metres.
 * @param b - Second `[min, max]` range, in metres.
 * @returns `true` when they overlap by more than {@link LENGTH_TOLERANCE}.
 */
function rangesOverlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > LENGTH_TOLERANCE;
}

/**
 * Finds the face of one rectangle that touches another.
 *
 * @param rect - The rectangle whose face is reported.
 * @param other - The rectangle it may touch.
 * @returns The face of `rect` lying against `other`, or `undefined` when the two
 *   do not share an edge.
 */
function findTouchingSide(rect: PlanRect, other: PlanRect): RectSide | undefined {
  return ALL_SIDES.find((side) => {
    const meets =
      Math.abs(faceCoordinate(rect, side) - faceCoordinate(other, OPPOSITE_SIDE[side])) <=
      LENGTH_TOLERANCE;
    const along = axisOfFace(side);
    return meets && rangesOverlap(extentAlong(rect, along), extentAlong(other, along));
  });
}

/**
 * Reads the bay out of the plan and checks the spec still describes it.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @returns The bay rectangle of the spec, which the plan agrees with.
 * @throws RangeError naming both rectangles when the `stairs` space of the plan
 *   is not the bay the spec declares; the two must move together.
 */
function getStairsBay(plan: FloorPlan): PlanRect {
  const bounds = getSpaceBounds(getSpace(plan, STAIRS_SPACE_ID));
  const agrees = ALL_SIDES.every(
    (side) =>
      Math.abs(faceCoordinate(bounds, side) - faceCoordinate(SPEC_BAY, side)) <= LENGTH_TOLERANCE,
  );
  if (!agrees) {
    throw new RangeError(
      `the "${STAIRS_SPACE_ID}" space of the plan is x ${String(bounds.minX)}–${String(bounds.maxX)}, z ${String(bounds.minZ)}–${String(bounds.maxZ)}, but the spec bay is x ${String(SPEC_BAY.minX)}–${String(SPEC_BAY.maxX)}, z ${String(SPEC_BAY.minZ)}–${String(SPEC_BAY.maxZ)}`,
    );
  }
  return SPEC_BAY;
}

/**
 * Lists the faces of the stairs bay that carry no wall and face floored space.
 *
 * A join of zero thickness is two floors meeting with nothing between them
 * (brief §4.2: the stair landing is continuous with the corridor), which is only
 * physically possible when both are at the same level. That is what makes the
 * arrival landing findable without naming it.
 *
 * @param plan - The floor plan.
 * @param space - The `stairs` space.
 * @returns The contacts across an open edge; empty when the bay is walled all round.
 */
function findOpenEdges(plan: FloorPlan, space: Space): readonly SpaceContact[] {
  return getNeighbours(plan, space.id).filter((contact) => {
    const neighbour = getSpace(plan, contact.neighbourId);
    return (
      Math.abs(contact.gap) <= LENGTH_TOLERANCE &&
      Math.abs(getJoinThickness(plan, space, neighbour)) <= LENGTH_TOLERANCE &&
      hasFloor(neighbour.kind)
    );
  });
}

/**
 * Finds the open edge a landing runs up to, if it reaches one.
 *
 * @param piece - The landing to place; a flight is never floor at this storey
 *   and is not offered here.
 * @param bay - The bay, whose faces the edges lie on.
 * @param edges - The open edges of the bay.
 * @returns The side of the bay the piece meets, or `undefined` when it meets none.
 */
function findOpenSide(
  piece: SpecPiece,
  bay: PlanRect,
  edges: readonly SpaceContact[],
): RectSide | undefined {
  return edges.find((edge) => {
    const reachesFace =
      Math.abs(faceCoordinate(piece.rect, edge.side) - faceCoordinate(bay, edge.side)) <=
      LENGTH_TOLERANCE;
    const along = axisOfFace(edge.side);
    return (
      reachesFace && rangesOverlap(extentAlong(piece.rect, along), [edge.spanMin, edge.spanMax])
    );
  })?.side;
}

/**
 * Finds the first flight the spec declares after a given piece, wrapping round.
 *
 * The tie-break of the module docstring, and the only thing declaration order is
 * allowed to decide. Reading from the arrival landing outwards rather than from
 * the head of the list is what makes the answer independent of anything declared
 * before the landing: the spec's order is a walk away from it, and the walk is a
 * circuit because the stair repeats every storey.
 *
 * @param from - Index in {@link SPEC_PIECES} of the piece to walk away from.
 * @returns The next flight declared after it, wrapping past the end of the list
 *   to its head; `undefined` only when the spec declares no flight at all.
 */
function findFlightAfter(from: number): SpecPiece | undefined {
  return Array.from(
    { length: SPEC_PIECES.length },
    (_unused, offset) => SPEC_PIECES[(from + 1 + offset) % SPEC_PIECES.length],
  ).find((piece) => FLIGHT_NAME_PATTERN.test(piece.name));
}

/**
 * Checks that the pieces really are a stair standing in the bay.
 *
 * These are the facts check 7 of the reference verifier asserts: every flight is
 * one run by one flight width, every landing is long enough to turn a 180° in,
 * the pieces stay inside the bay, none overlaps another, the two flights share
 * their run side by side, and the areas sum to the bay's — inside, disjoint and
 * summing is an exact tiling, since there is nowhere left for a gap to hide.
 *
 * @param bay - The bay the pieces tile.
 * @param treadsPerFlight - Treads one flight carries, the last riser landing on
 *   the next landing.
 * @throws RangeError naming the offending piece and the size it should have.
 */
function validatePieces(bay: PlanRect, treadsPerFlight: number): void {
  const runNeeded = toPlanLength(treadsPerFlight * STAIRS_SPEC.going);

  SPEC_PIECES.forEach((piece, index) => {
    const width = toPlanLength(piece.rect.maxX - piece.rect.minX);
    const depth = toPlanLength(piece.rect.maxZ - piece.rect.minZ);
    const isFlight = FLIGHT_NAME_PATTERN.test(piece.name);
    if (isFlight) {
      const alongX =
        Math.abs(width - runNeeded) <= LENGTH_TOLERANCE &&
        Math.abs(depth - STAIRS_SPEC.flightWidth) <= LENGTH_TOLERANCE;
      const alongZ =
        Math.abs(depth - runNeeded) <= LENGTH_TOLERANCE &&
        Math.abs(width - STAIRS_SPEC.flightWidth) <= LENGTH_TOLERANCE;
      if (!alongX && !alongZ) {
        throw new RangeError(
          `stair piece "${piece.name}" is ${String(width)} × ${String(depth)}, not a flight of ${String(treadsPerFlight)} goings of ${String(STAIRS_SPEC.going)} = ${String(runNeeded)} by ${String(STAIRS_SPEC.flightWidth)}`,
        );
      }
    } else if (Math.max(width, depth) < STAIRS_SPEC.flightWidth - LENGTH_TOLERANCE) {
      throw new RangeError(
        `stair landing "${piece.name}" is ${String(width)} × ${String(depth)}, less than the ${String(STAIRS_SPEC.flightWidth)} a 180° turn needs`,
      );
    }

    if (
      piece.rect.minX < bay.minX - LENGTH_TOLERANCE ||
      piece.rect.maxX > bay.maxX + LENGTH_TOLERANCE ||
      piece.rect.minZ < bay.minZ - LENGTH_TOLERANCE ||
      piece.rect.maxZ > bay.maxZ + LENGTH_TOLERANCE
    ) {
      throw new RangeError(`stair piece "${piece.name}" leaves the bay`);
    }

    const overlapped = SPEC_PIECES.slice(index + 1).find((other) =>
      rectsOverlap(piece.rect, other.rect),
    );
    if (overlapped !== undefined) {
      throw new RangeError(`stair piece "${piece.name}" overlaps "${overlapped.name}"`);
    }
  });

  const covered = SPEC_PIECES.reduce((sum, piece) => sum + rectArea(piece.rect), 0);
  if (Math.abs(covered - rectArea(bay)) > LENGTH_TOLERANCE) {
    throw new RangeError(
      `the ${String(SPEC_PIECES.length)} stair pieces cover ${String(toPlanLength(covered))} m² of the ${String(toPlanLength(rectArea(bay)))} m² bay: they do not tile it`,
    );
  }
}

/**
 * Checks that the two flights are the two strips of one half-turn stair.
 *
 * They must run the same length in the same direction and lie against one
 * another along their long edge. That is what makes the pair read as one stair
 * two flights wide, and it is the geometric half of the handover: a walker
 * stepping off one strip onto the landing has the other strip in front of them.
 *
 * @param first - One flight.
 * @param second - The other flight.
 * @throws RangeError naming both flights when they do not share a run or do not
 *   touch along it.
 */
function validateFlightPair(first: SpecPiece, second: SpecPiece): void {
  const touching = findTouchingSide(first.rect, second.rect);
  if (touching === undefined) {
    throw new RangeError(
      `the flights "${first.name}" and "${second.name}" are not side by side: they share no edge, so the stair cannot hand a walker from one strip to the other`,
    );
  }
  const runAxis = axisOfFace(touching);
  const [firstMin, firstMax] = extentAlong(first.rect, runAxis);
  const [secondMin, secondMax] = extentAlong(second.rect, runAxis);
  if (
    Math.abs(firstMin - secondMin) > LENGTH_TOLERANCE ||
    Math.abs(firstMax - secondMax) > LENGTH_TOLERANCE
  ) {
    throw new RangeError(
      `the flights "${first.name}" and "${second.name}" do not share a run: ${String(firstMin)}–${String(firstMax)} against ${String(secondMin)}–${String(secondMax)}`,
    );
  }
}

/**
 * Builds the treads of one flight, rising from its low end.
 *
 * Each box is one riser thick: the tread and the riser face beneath it. Nothing
 * fills the volume under the flight, because that volume is the shaft the other
 * flight and the storey below need.
 *
 * @param piece - The flight.
 * @param lowEndSide - The face of the flight its low end lies on.
 * @param lowLevel - Level of the walking surface at that end, in metres.
 * @param riser - Height of one riser, in metres.
 * @param treadsPerFlight - Treads to lay; the flight's last riser lands on the
 *   landing above and needs no tread of its own.
 * @returns The treads, in climbing order.
 */
function buildTreads(
  piece: SpecPiece,
  lowEndSide: RectSide,
  lowLevel: number,
  riser: number,
  treadsPerFlight: number,
): readonly PlanBox[] {
  const runAxis = axisOfFace(lowEndSide) === 'x' ? 'z' : 'x';
  const risesTowardMin = lowEndSide === 'maxX' || lowEndSide === 'maxZ';
  const [runMin, runMax] = extentAlong(piece.rect, runAxis);
  const lowCoordinate = risesTowardMin ? runMax : runMin;

  return Array.from({ length: treadsPerFlight }, (_unused, offset) => {
    const step = offset + 1;
    const near = toPlanLength(
      lowCoordinate + (risesTowardMin ? -offset * STAIRS_SPEC.going : offset * STAIRS_SPEC.going),
    );
    const far = toPlanLength(
      lowCoordinate + (risesTowardMin ? -step * STAIRS_SPEC.going : step * STAIRS_SPEC.going),
    );
    const rect =
      runAxis === 'x'
        ? makeRect(Math.min(near, far), Math.max(near, far), piece.rect.minZ, piece.rect.maxZ)
        : makeRect(piece.rect.minX, piece.rect.maxX, Math.min(near, far), Math.max(near, far));
    const top = lowLevel + step * riser;
    return makeBox(rect, top - riser, top);
  });
}

/**
 * Derives the whole geometry of the stairs from a floor plan and its heights.
 *
 * Every plan coordinate comes from `STAIRS`, checked against the `stairs` space
 * of the plan; every vertical level comes from `heights.floorToFloor` divided
 * into `STAIRS_SPEC.riserCount` risers, measured from `placement.level`. The
 * arrival landing is at that level, the flight climbed out of it reaches
 * exactly half a storey above, and the flight arriving at it starts exactly
 * half a storey below. The plan geometry does not depend on the placement at
 * all: the same stair is drawn on every storey of the stack, higher up.
 *
 * @param plan - The floor plan to read; defaults to `FLOOR_PLAN`. Not mutated.
 * @param heights - Vertical sizes of the floor; defaults to `FLOOR_HEIGHTS`.
 * @param placement - Where this storey sits in the stack; defaults to
 *   {@link THIS_STOREY_PLACEMENT}, the floor measured from itself.
 * @returns A deeply frozen {@link StairsLayout}.
 * @throws RangeError naming the offending value when the plan and the spec
 *   disagree about the bay, when the pieces are not a stair tiling it (see
 *   `validatePieces` and `validateFlightPair`), when the stair is not the two
 *   flights and two landings of a repeating half-turn, when no landing is floor
 *   at this storey, when no flight is declared after that landing for a walker
 *   to climb out of it, when both flights do not meet it, when
 *   `heights.floorToFloor` is not a finite positive number, or when
 *   `placement.level` is not finite.
 */
export function getStairsLayout(
  plan: FloorPlan = FLOOR_PLAN,
  heights: FloorHeights = FLOOR_HEIGHTS,
  placement: StairsPlacement = THIS_STOREY_PLACEMENT,
): StairsLayout {
  const { floorToFloor } = heights;
  const { level } = placement;
  if (!Number.isFinite(floorToFloor) || floorToFloor <= 0) {
    throw new RangeError(
      `floorToFloor must be a finite positive number, got ${String(floorToFloor)}`,
    );
  }
  if (!Number.isFinite(level)) {
    throw new RangeError(`placement level must be a finite number, got ${String(level)}`);
  }
  if (SPEC_FLIGHTS.length !== FLIGHTS_PER_STOREY || SPEC_LANDINGS.length !== LANDINGS_PER_STOREY) {
    throw new RangeError(
      `a half-turn stair that repeats has ${String(FLIGHTS_PER_STOREY)} flights and ${String(LANDINGS_PER_STOREY)} landings per storey, but the spec declares ${String(SPEC_FLIGHTS.length)} and ${String(SPEC_LANDINGS.length)}`,
    );
  }
  if (STAIRS_SPEC.riserCount % FLIGHTS_PER_STOREY !== 0) {
    throw new RangeError(
      `${String(STAIRS_SPEC.riserCount)} risers do not divide equally between ${String(FLIGHTS_PER_STOREY)} flights`,
    );
  }

  const risersPerFlight = STAIRS_SPEC.riserCount / FLIGHTS_PER_STOREY;
  const bay = getStairsBay(plan);
  validatePieces(bay, risersPerFlight - RISERS_LANDED);

  const edges = findOpenEdges(plan, getSpace(plan, STAIRS_SPACE_ID));
  const landed: LevelPiece[] = SPEC_LANDINGS.flatMap((piece) => {
    const openSide = findOpenSide(piece, bay, edges);
    return openSide === undefined ? [] : [{ ...piece, openSide }];
  });
  const [arrivalLanding] = landed;
  if (arrivalLanding === undefined) {
    throw new RangeError(
      `no landing of the "${STAIRS_SPACE_ID}" bay reaches a face with no wall, so nothing in it is floor at this storey`,
    );
  }
  const turnLanding = SPEC_LANDINGS.find((piece) => piece.name !== arrivalLanding.name);
  if (turnLanding === undefined) {
    throw new RangeError(
      `the "${STAIRS_SPACE_ID}" bay has no landing to turn on besides the arrival landing "${arrivalLanding.name}"`,
    );
  }

  // The handover: both flights meet the arrival landing, so the one climbed out
  // of it is the one not arrived by. Which of the two is climbed cannot be read
  // off the rectangles — the mirrored stair is just as buildable — so it is the
  // first flight declared AFTER the arrival landing, as the spec's own wording
  // says of flight A. Counted from the landing, never from the head of the list:
  // a flight declared before the landing must not be able to claim the climb.
  const upFlight = findFlightAfter(arrivalLanding.index);
  if (upFlight === undefined) {
    throw new RangeError(
      `no flight is declared after the arrival landing "${arrivalLanding.name}", so nothing in the "${STAIRS_SPACE_ID}" bay is climbed out of it`,
    );
  }
  const inFlight = SPEC_FLIGHTS.find((flight) => flight.index !== upFlight.index);
  if (inFlight === undefined) {
    throw new RangeError(
      `the "${STAIRS_SPACE_ID}" bay holds only the flight "${upFlight.name}", so no second flight arrives at the landing "${arrivalLanding.name}"`,
    );
  }
  validateFlightPair(upFlight, inFlight);
  const upFromLanding = findTouchingSide(upFlight.rect, arrivalLanding.rect);
  const inToLanding = findTouchingSide(inFlight.rect, arrivalLanding.rect);
  if (upFromLanding === undefined || inToLanding === undefined) {
    throw new RangeError(
      `both flights must meet the arrival landing "${arrivalLanding.name}" for the stair to hand a walker over at it, but "${(upFromLanding === undefined ? upFlight : inFlight).name}" does not touch it`,
    );
  }
  const inFromTurn = findTouchingSide(inFlight.rect, turnLanding.rect);
  if (inFromTurn === undefined) {
    throw new RangeError(
      `the flight "${inFlight.name}" does not meet the turn "${turnLanding.name}" it rises from`,
    );
  }

  const riser = floorToFloor / STAIRS_SPEC.riserCount;
  const halfStorey = risersPerFlight * riser;
  const treadsPerFlight = risersPerFlight - RISERS_LANDED;
  const turnAbove = level + halfStorey;
  const turnBelow = level - halfStorey;

  const steps: readonly PlanBox[] = Object.freeze([
    // The turn below, then the flight rising out of it to this floor.
    makeBox(turnLanding.rect, turnBelow - riser, turnBelow),
    ...buildTreads(inFlight, inFromTurn, turnBelow, riser, treadsPerFlight),
    // Then the flight climbed out of this floor, and the turn it reaches.
    ...buildTreads(upFlight, upFromLanding, level, riser, treadsPerFlight),
    makeBox(turnLanding.rect, turnAbove - riser, turnAbove),
  ]);

  const surfacesOf = (piece: SpecPiece): readonly StairSurface[] => {
    if (piece.name === arrivalLanding.name) {
      return [{ lowLevel: level, highLevel: level }];
    }
    if (piece.name === turnLanding.name) {
      // Occupied twice over: the stair repeats, so every half-landing level exists.
      return [
        { lowLevel: turnBelow, highLevel: turnBelow },
        { lowLevel: turnAbove, highLevel: turnAbove },
      ];
    }
    return piece.name === upFlight.name
      ? [{ lowLevel: level, highLevel: turnAbove }]
      : [{ lowLevel: turnBelow, highLevel: level }];
  };

  // The low end of each flight, which the surfaces cannot say: the flight
  // climbed out of this storey starts on the arrival landing, the flight
  // arriving at it starts on the turn below.
  const lowEndSideOf = (piece: SpecPiece): RectSide | undefined => {
    if (piece.name === upFlight.name) {
      return upFromLanding;
    }
    return piece.name === inFlight.name ? inFromTurn : undefined;
  };

  const pieces: readonly StairPiece[] = Object.freeze(
    SPEC_PIECES.map((piece) =>
      Object.freeze({
        name: piece.name,
        rect: piece.rect,
        isFlight: FLIGHT_NAME_PATTERN.test(piece.name),
        atThisLevel: piece.name === arrivalLanding.name,
        surfaces: Object.freeze(surfacesOf(piece).map((surface) => Object.freeze(surface))),
        lowEndSide: lowEndSideOf(piece),
      }),
    ),
  );

  return Object.freeze({
    bay,
    pieces,
    landingRect: arrivalLanding.rect,
    blockedRects: Object.freeze(
      pieces.filter((piece) => !piece.atThisLevel).map((piece) => piece.rect),
    ),
    steps,
    riser,
    level,
    halfStorey,
    lowestLevel: turnBelow,
    highestLevel: turnAbove,
    arrival: Object.freeze({
      x: toPlanLength((arrivalLanding.rect.minX + arrivalLanding.rect.maxX) * MIDPOINT_FACTOR),
      z: toPlanLength((arrivalLanding.rect.minZ + arrivalLanding.rect.maxZ) * MIDPOINT_FACTOR),
      yaw: YAW_FACING_OUT[arrivalLanding.openSide],
    }),
  });
}

/** Which neighbouring storeys a stairwell's flights continue into. */
export interface StairwellEnds {
  /** Whether there is a storey above for the flight climbed out of this one to reach. */
  readonly hasAbove: boolean;
  /** Whether there is a storey below for the flight arriving here to come up from. */
  readonly hasBelow: boolean;
}

/**
 * Tells which ends of the stack a storey's stairwell continues into.
 *
 * The owner's decision, and the only place the stack's ends are stated: the
 * stair is DRAWN through every storey, top and bottom included — it is one
 * repeated bay and cutting its geometry short would leave a hole in the
 * building — but it is not WALKED past the ends. A walker on the top floor
 * finds nothing above the arrival landing to climb to, and one on the ground
 * floor finds nothing below it.
 *
 * @param floor - Which storey the walker is on, counted from
 *   {@link LOWEST_FLOOR} at the bottom.
 * @param floorCount - How many storeys the stack has.
 * @returns A frozen {@link StairwellEnds}.
 */
export function getStairwellEnds(floor: number, floorCount: number): StairwellEnds {
  return Object.freeze({ hasAbove: floor < floorCount, hasBelow: floor > LOWEST_FLOOR });
}

/**
 * Tells whether a surface is level: a landing rather than a flight.
 *
 * The classification the whole stairwell is built on, and it reads the geometry
 * rather than the names: a flight is a piece whose surface stands at different
 * levels at its two ends, whatever the spec calls it.
 *
 * @param surface - The surface to classify.
 * @returns `true` when both ends are at the same level.
 */
function isLevelSurface(surface: StairSurface): boolean {
  return Math.abs(surface.highLevel - surface.lowLevel) <= LENGTH_TOLERANCE;
}

/**
 * Tells whether two levels are the same level.
 *
 * @param level - One level, in metres.
 * @param other - The other, in metres.
 * @returns `true` when they agree within {@link LENGTH_TOLERANCE}.
 */
function atLevel(level: number, other: number): boolean {
  return Math.abs(level - other) <= LENGTH_TOLERANCE;
}

/**
 * Reads one flight as a ramp: a height function over its footprint.
 *
 * @param rect - Footprint of the flight.
 * @param lowEndSide - The face its low end lies on.
 * @param surface - The walking surface it carries.
 * @returns A frozen {@link StairRamp} running from `lowEndSide` to the face
 *   opposite it.
 */
function toRamp(rect: PlanRect, lowEndSide: RectSide, surface: StairSurface): StairRamp {
  const runAxis: PlanAxis = axisOfFace(lowEndSide) === 'x' ? 'z' : 'x';
  return Object.freeze({
    rect,
    runAxis,
    lowAt: faceCoordinate(rect, lowEndSide),
    highAt: faceCoordinate(rect, OPPOSITE_SIDE[lowEndSide]),
    lowLevel: surface.lowLevel,
    highLevel: surface.highLevel,
  });
}

/**
 * Moves a ramp up or down without moving it in plan.
 *
 * @param ramp - The ramp to repeat.
 * @param by - How far to move it, in metres; negative moves it down.
 * @returns A frozen copy at the new levels.
 */
function liftRamp(ramp: StairRamp, by: number): StairRamp {
  return Object.freeze({ ...ramp, lowLevel: ramp.lowLevel + by, highLevel: ramp.highLevel + by });
}

/**
 * Moves a landing up or down without moving it in plan.
 *
 * @param landing - The landing to repeat.
 * @param by - How far to move it, in metres; negative moves it down.
 * @returns A frozen copy at the new level.
 */
function liftLanding(landing: StairLanding, by: number): StairLanding {
  return Object.freeze({ ...landing, level: landing.level + by });
}

/**
 * Reads a storey's stairs as the walkable surfaces of a stairwell.
 *
 * The layout says what is built on this storey; a walker needs what can be
 * stood on, and that is more than one storey's worth. From the turn landing
 * half a storey up, the climb continues onto the ARRIVING flight of the storey
 * above — a flight this storey's layout does not contain and never will, since
 * it belongs to the next storey. What makes that flight knowable without
 * building the storey above is the repeat: the stair is the same stair every
 * storey, so the flight above is this storey's own flight lifted by one
 * `floorToFloor`, and the flight below is the same one dropped by it. A middle
 * storey therefore offers FOUR flights and FIVE landings, tiling a full storey
 * either side of this floor without a gap.
 *
 * Which flight is which is read off the surfaces, never off a name: the flight
 * whose low end is at this storey's level is the one climbed out of it, and the
 * flight whose high end is at that level is the one arriving at it. Lifting the
 * first down a storey gives the run into the storey below; lifting the second
 * up a storey gives the run out of this one into the storey above.
 *
 * ADR-010 is untouched: nothing here re-models the stair as arriving at this
 * floor, and nothing paves the bay. This is a reading of the same geometry.
 *
 * @param layout - The stairs of this storey, from {@link getStairsLayout}.
 * @param heights - Vertical sizes of the floor; its `floorToFloor` is the
 *   repeat, and must be the one the layout was built with.
 * @param ends - Which neighbouring storeys the flights continue into. An end of
 *   the stack is blocked: the surfaces beyond it are left out, so a walker
 *   simply finds no floor to step onto.
 * @returns A deeply frozen {@link Stairwell}, its ramps and landings lowest
 *   first.
 * @throws RangeError when `heights.floorToFloor` is not a finite positive
 *   number, or when it is not the storey height the layout was built on.
 */
export function getStairwell(
  layout: StairsLayout,
  heights: FloorHeights,
  ends: StairwellEnds,
): Stairwell {
  const { floorToFloor } = heights;
  if (!Number.isFinite(floorToFloor) || floorToFloor <= 0) {
    throw new RangeError(
      `floorToFloor must be a finite positive number, got ${String(floorToFloor)}`,
    );
  }
  if (Math.abs(layout.halfStorey * FLIGHTS_PER_STOREY - floorToFloor) > LENGTH_TOLERANCE) {
    throw new RangeError(
      `the layout rises ${String(layout.halfStorey * FLIGHTS_PER_STOREY)} m per storey but the heights say ${String(floorToFloor)} m: the stair would not meet itself between storeys`,
    );
  }

  const surfacesOf = <T>(
    read: (piece: StairPiece, surface: StairSurface) => readonly T[],
  ): readonly T[] =>
    layout.pieces.flatMap((piece) => piece.surfaces.flatMap((surface) => read(piece, surface)));

  const flights = surfacesOf<StairRamp>((piece, surface) =>
    piece.lowEndSide === undefined || isLevelSurface(surface)
      ? []
      : [toRamp(piece.rect, piece.lowEndSide, surface)],
  );
  const landings = surfacesOf<StairLanding>((piece, surface) =>
    isLevelSurface(surface) ? [Object.freeze({ rect: piece.rect, level: surface.lowLevel })] : [],
  );

  // Out of this storey and into it: the two halves of the storey's own climb.
  const climbing = flights.filter((ramp) => atLevel(ramp.lowLevel, layout.level));
  const arriving = flights.filter((ramp) => atLevel(ramp.highLevel, layout.level));
  const here = landings.filter((landing) => atLevel(landing.level, layout.level));
  const turnsBelow = landings.filter((landing) => landing.level < layout.level - LENGTH_TOLERANCE);
  const turnsAbove = landings.filter((landing) => landing.level > layout.level + LENGTH_TOLERANCE);

  const below: readonly StairRamp[] = ends.hasBelow
    ? [...climbing.map((ramp) => liftRamp(ramp, -floorToFloor)), ...arriving]
    : [];
  const above: readonly StairRamp[] = ends.hasAbove
    ? [...climbing, ...arriving.map((ramp) => liftRamp(ramp, floorToFloor))]
    : [];

  return Object.freeze({
    bay: layout.bay,
    ramps: Object.freeze([...below, ...above].toSorted((a, b) => a.lowLevel - b.lowLevel)),
    landings: Object.freeze(
      [
        ...(ends.hasBelow
          ? [...here.map((landing) => liftLanding(landing, -floorToFloor)), ...turnsBelow]
          : []),
        ...here,
        ...(ends.hasAbove
          ? [...turnsAbove, ...here.map((landing) => liftLanding(landing, floorToFloor))]
          : []),
      ].toSorted((a, b) => a.level - b.level),
    ),
    reach: STAIR_REACH_RISERS * layout.riser,
  });
}
