/**
 * Traditional dog-leg stairs of the typical floor: the only way in and out.
 *
 * The bay of the `stairs` space (brief §4.2: x 1.60–5.30, z 3.90–5.40, i.e.
 * 3.70 × 1.50 m) holds stairs alone — the elevator of the first sketch is gone
 * (owner answer 2026-09-11, superseding ADR-006 on that point). A single
 * straight flight cannot rise the floor-to-floor height of `heights.ts` over
 * 2.40 m of run, so the owner chose a dog-leg entirely inside the western part
 * of the bay:
 *
 * - {@link STAIR_RISER_COUNT} equal risers, `heights.floorToFloor / 17` each,
 *   with a {@link STAIR_GOING} going and a {@link STAIR_FLIGHT_WIDTH} flight
 *   width, which is half the depth of the bay;
 * - the up-flight occupies the northern half of the bay and climbs westward
 *   from the landing edge {@link LANDING_MIN_X}, tread tops 1 · riser … 8 · riser;
 * - the half-landing fills the western remainder of the run over the full depth
 *   of the bay, at riser 9;
 * - the return flight occupies the southern half and climbs eastward back to
 *   the landing edge, tread tops 10 · riser … 17 · riser, the last one being
 *   exactly `heights.floorToFloor`, i.e. the level of the next floor.
 *
 * The flight area is solid and not walkable: {@link getBlockedRects} hands it to
 * the collision model of Part 3. The landing east of {@link LANDING_MIN_X} is
 * walkable, is continuous with the corridor (a zero-gap join, brief §4.2) and
 * carries the door to the link corridor, so it is where a person arrives on the
 * floor (see {@link StairsLayout.arrival}).
 *
 * Pure geometry: plan coordinates in metres with the conventions of
 * `floorPlan/types.ts`, vertical levels in metres above the finished floor, and
 * yaw in radians with the conventions of `thirdPersonCamera.ts` (ADR-004).
 */

import { getSpace, getSpaceBounds } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';

/** The space of the plan the stairs fill (brief §4.2). */
const STAIRS_SPACE_ID: SpaceId = 'stairs';

/** Number of equal risers from this floor to the next (owner answer 2026-09-11). */
const STAIR_RISER_COUNT = 17;

/** Depth of one tread, in metres (owner answer 2026-09-11). */
const STAIR_GOING = 0.25;

/** Width of one flight, in metres: half the depth of the bay (owner answer 2026-09-11). */
const STAIR_FLIGHT_WIDTH = 0.75;

/** Where the flight area ends and the walkable landing begins, in metres (owner answer 2026-09-11). */
const LANDING_MIN_X = 4.0;

/** Number of flights laid side by side across the depth of the bay: up and return. */
const FLIGHTS_ACROSS_BAY = 2;

/** Risers the half-landing accounts for: it is one step of the dog-leg, not a tread. */
const HALF_LANDING_RISERS = 1;

/** Treads of one flight: the risers of the dog-leg, less the half-landing, shared by both flights. */
const TREADS_PER_FLIGHT = (STAIR_RISER_COUNT - HALF_LANDING_RISERS) / FLIGHTS_ACROSS_BAY;

/** 1-based riser index of the half-landing: the step after the whole up-flight. */
const HALF_LANDING_RISER_INDEX = TREADS_PER_FLIGHT + HALF_LANDING_RISERS;

/** Level of the finished floor, in metres: the underside of every step. */
const FLOOR_LEVEL = 0;

/** Factor that turns the sum of two opposite faces into their midpoint. */
const MIDPOINT_FACTOR = 0.5;

/**
 * Yaw that looks toward +x, in radians.
 *
 * Yaw 0 looks toward −z and the forward direction is `(−sin yaw, −cos yaw)`
 * (`thirdPersonCamera.ts`, ADR-004), so −π/2 gives forward `(1, 0)`. The
 * opposite sign would face −x, into the flight.
 */
const YAW_FACING_POSITIVE_X = -Math.PI / 2;

/** Fixed sizes of the dog-leg stairs, in metres. Frozen. */
export const STAIRS_SPEC: {
  /** Number of equal risers from this floor to the next. */
  readonly riserCount: 17;
  /** Depth of one tread. */
  readonly going: 0.25;
  /** Width of one flight: half the depth of the stairs bay. */
  readonly flightWidth: 0.75;
} = Object.freeze({
  riserCount: STAIR_RISER_COUNT,
  going: STAIR_GOING,
  flightWidth: STAIR_FLIGHT_WIDTH,
});

/**
 * Where a person arrives on the floor and which way they face: on the stairs
 * landing, looking toward the corridor.
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

/** The complete geometry of the stairs of one floor, in metres. */
export interface StairsLayout {
  /** The solid, non-walkable part of the bay: both flights and the half-landing. */
  readonly flightRect: PlanRect;
  /** The walkable part of the bay, east of the flights, continuous with the corridor. */
  readonly landingRect: PlanRect;
  /** The half-landing at the western end of the run, over the full depth of the bay. */
  readonly halfLandingRect: PlanRect;
  /**
   * The steps, in climbing order: the 8 treads of the up-flight, the
   * half-landing block, then the 8 treads of the return flight. Each box rises
   * from the finished floor to its own tread top, so the boxes stack into a
   * solid stair and their footprints tile {@link StairsLayout.flightRect}.
   */
  readonly steps: readonly PlanBox[];
  /** Height of one riser: `heights.floorToFloor / 17`, in metres, not rounded. */
  readonly riser: number;
  /** Where a person arrives on this floor. */
  readonly arrival: StairsArrival;
}

/** The parts the stairs bay is cut into, before any vertical size is known. */
interface StairsBay {
  /** Bounding rect of the `stairs` space. */
  readonly bay: PlanRect;
  /** The solid flight area, west of {@link LANDING_MIN_X}. */
  readonly flightRect: PlanRect;
  /** The walkable landing, east of {@link LANDING_MIN_X}. */
  readonly landingRect: PlanRect;
  /** The half-landing, at the western end of the flight area. */
  readonly halfLandingRect: PlanRect;
}

/**
 * Cuts the stairs bay of a plan into the flight area, the landing and the
 * half-landing.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @returns The frozen parts of the bay, with frozen rects.
 * @throws RangeError naming the offending value when the plan has no `stairs`
 *   space, when the flight width exceeds half the depth of the bay, when the
 *   landing edge does not lie inside the bay, or when the run west of that edge
 *   cannot hold the treads of one flight plus a half-landing of at least one
 *   going.
 */
function getStairsBay(plan: FloorPlan): StairsBay {
  const bay = getSpaceBounds(getSpace(plan, STAIRS_SPACE_ID));
  const depth = toPlanLength(bay.maxZ - bay.minZ);
  if (STAIR_FLIGHT_WIDTH * FLIGHTS_ACROSS_BAY > depth + LENGTH_TOLERANCE) {
    throw new RangeError(
      `flight width ${String(STAIR_FLIGHT_WIDTH)} exceeds half the depth ${String(depth)} of the "${STAIRS_SPACE_ID}" bay`,
    );
  }
  if (
    LANDING_MIN_X <= bay.minX + LENGTH_TOLERANCE ||
    LANDING_MIN_X >= bay.maxX - LENGTH_TOLERANCE
  ) {
    throw new RangeError(
      `landing edge x ${String(LANDING_MIN_X)} must lie inside the "${STAIRS_SPACE_ID}" bay x ${String(bay.minX)}–${String(bay.maxX)}`,
    );
  }

  const run = toPlanLength(LANDING_MIN_X - bay.minX);
  // Whole goings the run holds; the tolerance keeps an exact fit off a rounding edge.
  const wholeGoings = Math.floor((run + LENGTH_TOLERANCE) / STAIR_GOING);
  if (wholeGoings <= TREADS_PER_FLIGHT) {
    throw new RangeError(
      `flight run ${String(run)} holds ${String(wholeGoings)} goings of ${String(STAIR_GOING)}, it must hold more than the ${String(TREADS_PER_FLIGHT)} treads of a flight so that a half-landing fits`,
    );
  }

  const halfLandingMaxX = toPlanLength(bay.minX + run - TREADS_PER_FLIGHT * STAIR_GOING);
  return Object.freeze({
    bay,
    flightRect: makeRect(bay.minX, LANDING_MIN_X, bay.minZ, bay.maxZ),
    landingRect: makeRect(LANDING_MIN_X, bay.maxX, bay.minZ, bay.maxZ),
    halfLandingRect: makeRect(bay.minX, halfLandingMaxX, bay.minZ, bay.maxZ),
  });
}

/**
 * Derives the whole geometry of the stairs from a floor plan and its heights.
 *
 * Every plan coordinate comes from the `stairs` space of the plan plus
 * {@link STAIRS_SPEC} and {@link LANDING_MIN_X}; every vertical level comes from
 * `heights.floorToFloor` divided into {@link STAIR_RISER_COUNT} risers. The top
 * of the highest tread is `heights.floorToFloor` exactly: the level of the next
 * floor.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param heights - Vertical sizes of the floor; defaults to `FLOOR_HEIGHTS`.
 * @returns A deeply frozen {@link StairsLayout}.
 * @throws RangeError naming the offending value when the bay cannot hold the
 *   stairs (see the rejections of `getStairsBay`) or when
 *   `heights.floorToFloor` is not a finite positive number.
 */
export function getStairsLayout(
  plan: FloorPlan,
  heights: FloorHeights = FLOOR_HEIGHTS,
): StairsLayout {
  const { bay, flightRect, landingRect, halfLandingRect } = getStairsBay(plan);
  const { floorToFloor } = heights;
  if (!Number.isFinite(floorToFloor) || floorToFloor <= 0) {
    throw new RangeError(
      `floorToFloor must be a finite positive number, got ${String(floorToFloor)}`,
    );
  }

  /** Top of the tread of a 1-based riser index; index 17 lands on the next floor exactly. */
  const treadTop = (riserIndex: number): number => (riserIndex * floorToFloor) / STAIR_RISER_COUNT;
  const upFlightMaxZ = toPlanLength(bay.minZ + STAIR_FLIGHT_WIDTH);
  const returnFlightMinZ = toPlanLength(bay.maxZ - STAIR_FLIGHT_WIDTH);

  // Up-flight: tread 1 sits against the landing edge, each next tread one going west.
  const upFlight = Array.from({ length: TREADS_PER_FLIGHT }, (_unused, offset) => {
    const riserIndex = offset + 1;
    return makeBox(
      makeRect(
        toPlanLength(LANDING_MIN_X - riserIndex * STAIR_GOING),
        toPlanLength(LANDING_MIN_X - offset * STAIR_GOING),
        bay.minZ,
        upFlightMaxZ,
      ),
      FLOOR_LEVEL,
      treadTop(riserIndex),
    );
  });

  // Half-landing: the western remainder of the run, over the full depth of the bay.
  const halfLanding = makeBox(halfLandingRect, FLOOR_LEVEL, treadTop(HALF_LANDING_RISER_INDEX));

  // Return flight: tread 1 sits against the half-landing, each next tread one going east.
  const returnFlight = Array.from({ length: TREADS_PER_FLIGHT }, (_unused, offset) => {
    const riserIndex = HALF_LANDING_RISER_INDEX + offset + 1;
    return makeBox(
      makeRect(
        toPlanLength(halfLandingRect.maxX + offset * STAIR_GOING),
        toPlanLength(halfLandingRect.maxX + (offset + 1) * STAIR_GOING),
        returnFlightMinZ,
        bay.maxZ,
      ),
      FLOOR_LEVEL,
      treadTop(riserIndex),
    );
  });

  return Object.freeze({
    flightRect,
    landingRect,
    halfLandingRect,
    steps: Object.freeze([...upFlight, halfLanding, ...returnFlight]),
    riser: floorToFloor / STAIR_RISER_COUNT,
    arrival: Object.freeze({
      x: toPlanLength((landingRect.minX + landingRect.maxX) * MIDPOINT_FACTOR),
      z: toPlanLength((landingRect.minZ + landingRect.maxZ) * MIDPOINT_FACTOR),
      yaw: YAW_FACING_POSITIVE_X,
    }),
  });
}

/**
 * Lists the rects of the stairs bay a person cannot walk into.
 *
 * Only the flight area is blocked: the landing is walkable and continuous with
 * the corridor. Part 3 feeds these rects to wall collision.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @returns A frozen array holding the flight rect alone.
 * @throws RangeError naming the offending value when the bay cannot hold the
 *   stairs (see the rejections of `getStairsBay`).
 */
export function getBlockedRects(plan: FloorPlan): readonly PlanRect[] {
  return Object.freeze([getStairsBay(plan).flightRect]);
}
