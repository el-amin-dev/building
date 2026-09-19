/**
 * A stairwell read as walking surfaces: what the stair offers a body underfoot.
 *
 * `stairs.ts` describes the stair as rectangles and step boxes — what is built.
 * This module describes the same stair as a height field — what is walked. A
 * flight is a {@link StairRamp}: a footprint plus the level of the surface at
 * each end of its run, which is a height function over the footprint rather
 * than a rectangle at one level. A landing is a {@link StairLanding}: a
 * footprint at one level. Together they are a {@link Stairwell}, and
 * {@link getStairFooting} answers the only question a walker ever asks of it —
 * "what is the floor height here, and may I stand on it?".
 *
 * Nothing here knows the floor plan, the storey heights or the source of truth:
 * a stairwell arrives already built (`getStairwell`, `stairs.ts`), so this
 * module is testable against synthetic surfaces and a navigation module can
 * depend on it without pulling the whole plan in behind it.
 *
 * Two facts about a stair that repeats every storey shape the whole module:
 *
 * - a footprint carries MORE THAN ONE surface. The half-landing of the plan's
 *   half-turn is floor half a storey above this floor and half a storey below
 *   it, and the two flights of one storey stand over the two flights of the
 *   next. So a point does not have "the" floor height: it has a set of them,
 *   and which one is underfoot depends on where the body already is. That is
 *   why {@link getStairFooting} takes the rise the body is at and answers from
 *   it, rather than taking a point alone;
 * - a body may only reach a surface within {@link Stairwell.reach} of the rise
 *   it is at. That single rule does the work of a wall: the surfaces over a
 *   point in this bay are a full storey apart, so a body on one flight is never
 *   within reach of the flight above or below it, and stepping sideways off a
 *   flight onto the one beside it is refused by arithmetic rather than by a
 *   guard rail nobody modelled.
 *
 * Plan coordinates are in metres with the conventions of `planGeometry.ts`;
 * rises are levels in metres, on the scale the stairwell was built on — this
 * storey's finished floor is 0 in the layouts `stairs.ts` produces for it.
 */

import { LENGTH_TOLERANCE, makeRect } from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';

/** One of the two axes of the floor plan: `x` runs along the width, `z` along the depth. */
export type PlanAxis = 'x' | 'z';

/** A sloped walking surface: one flight, as a height function over its footprint. */
export interface StairRamp {
  /** Footprint of the flight, in plan coordinates. */
  readonly rect: PlanRect;
  /** The axis the flight runs along; it is level across the other one. */
  readonly runAxis: PlanAxis;
  /** Coordinate on `runAxis` of the face where the surface is at `lowLevel`. */
  readonly lowAt: number;
  /** Coordinate of the face where it is at `highLevel`; either side of `lowAt`. */
  readonly highAt: number;
  /** Level of the surface at `lowAt`, in metres. */
  readonly lowLevel: number;
  /** Level of the surface at `highAt`, in metres. */
  readonly highLevel: number;
}

/** A level walking surface: a landing, at one rise over its footprint. */
export interface StairLanding {
  /** Footprint of the landing, in plan coordinates. */
  readonly rect: PlanRect;
  /** Level of its walking surface, in metres. */
  readonly level: number;
}

/** Every surface one storey's stairwell offers, above and below its datum. */
export interface Stairwell {
  /** The bay the whole stair stands in: the footprint of every surface below. */
  readonly bay: PlanRect;
  /** The flights, lowest first. */
  readonly ramps: readonly StairRamp[];
  /** The landings, lowest first. */
  readonly landings: readonly StairLanding[];
  /** How far a body may step up or down to reach a surface, in metres. */
  readonly reach: number;
}

/** What the stairwell offers a body at one point. */
export interface StairFooting {
  /** Level of the walking surface, in metres. */
  readonly rise: number;
  /**
   * Rise per metre of plan travel along the run; `0` on a landing.
   *
   * Always non-negative: it is the steepness of the surface, not a direction of
   * travel, which a point alone cannot say.
   */
  readonly gradient: number;
}

/**
 * How far a body may step up or down to reach a surface, in risers.
 *
 * One riser and a half — "a body may step up or down one riser and a half" —
 * which on the 3.00 m storey of `heights.ts`, cut into the 18 risers of
 * `STAIRS_SPEC`, is exactly 0.25 m. It has to sit between two bounds, and it
 * has room to spare at both ends:
 *
 * - ABOVE the rise a body gains in one worst-case frame, or a walker climbing
 *   fast would find the tread ahead out of reach and stop dead on the stair.
 *   The steepest run here is a gradient of 0.75 (a 1.50 m rise over a 2.00 m
 *   run), the walking speed is 1.4 m/s (`WALK_SPEED_METRES_PER_SECOND`,
 *   `eyeNavigation.ts`) and a slow frame is 0.1 s: 0.75 × 1.4 × 0.1 = 0.105 m,
 *   well under 0.25 m;
 * - FAR BELOW the distance to the next surface over the same point, or a body
 *   would be able to reach through a floor. In this bay that distance is a full
 *   storey, 3.00 m, everywhere: the half-landing carries its two surfaces half
 *   a storey either side of this floor, and each flight stands exactly one
 *   storey over the flight below it.
 */
export const STAIR_REACH_RISERS = 1.5;

/** The gradient of a level surface: a landing climbs nothing along its run. */
const LEVEL_GRADIENT = 0;

/**
 * Tells whether a point lies on a walking surface's footprint, edges included.
 *
 * Inclusive, unlike the half-open `rectContainsPoint` of `planGeometry.ts`: a
 * tiling of the plan must not let two rectangles claim a shared edge, but a
 * walking surface has to carry its own edges — a body standing exactly on a
 * flight's top riser line is on that flight, and must not fall through it
 * because the footprint was written `max` first.
 *
 * @param rect - The footprint.
 * @param point - The point to locate.
 * @returns `true` when the point is inside the rectangle or on one of its
 *   faces, within {@link LENGTH_TOLERANCE}.
 */
function containsPoint(rect: PlanRect, point: PlanPoint): boolean {
  return (
    point.x >= rect.minX - LENGTH_TOLERANCE &&
    point.x <= rect.maxX + LENGTH_TOLERANCE &&
    point.z >= rect.minZ - LENGTH_TOLERANCE &&
    point.z <= rect.maxZ + LENGTH_TOLERANCE
  );
}

/**
 * Returns a point's coordinate on one plan axis.
 *
 * @param point - The point.
 * @param axis - Which axis to read.
 * @returns The `x` or the `z` of the point, in metres.
 */
function coordinateOn(point: PlanPoint, axis: PlanAxis): number {
  return axis === 'x' ? point.x : point.z;
}

/**
 * Grows a rectangle outward by the same distance on every face.
 *
 * @param rect - The rectangle to grow.
 * @param by - Distance each face moves outward, in metres.
 * @returns A frozen rectangle, not snapped to the plan grid: the distance is a
 *   body radius rather than a drawn dimension.
 */
function growRect(rect: PlanRect, by: number): PlanRect {
  return makeRect(rect.minX - by, rect.maxX + by, rect.minZ - by, rect.maxZ + by);
}

/**
 * Returns how steeply a ramp climbs, as a rise per metre of plan travel.
 *
 * @param ramp - The ramp to measure.
 * @returns The absolute rise over the absolute run; {@link LEVEL_GRADIENT} for
 *   a ramp of no run, which is a landing written as a ramp.
 */
function getRampGradient(ramp: StairRamp): number {
  const run = Math.abs(ramp.highAt - ramp.lowAt);
  return run <= LENGTH_TOLERANCE ? LEVEL_GRADIENT : Math.abs(ramp.highLevel - ramp.lowLevel) / run;
}

/**
 * Returns the rise of a ramp's surface at a point.
 *
 * Linear between the two ends of the run, and EXACT at both of them: a point on
 * the low face reads back `lowLevel` itself and a point on the high face reads
 * back `highLevel` itself, rather than a value a rounding away from it. The
 * ends are where a flight hands a walker to a landing, so a body arriving at
 * one must land on exactly the level the landing is at.
 *
 * The run may point either way along its axis: `highAt` is less than `lowAt`
 * for a flight that climbs toward the origin, and the interpolation reads the
 * direction off the two rather than assuming one.
 *
 * @param ramp - The ramp.
 * @param point - The point to read, in plan coordinates.
 * @returns The level of the ramp's surface over the point, in metres, or
 *   `undefined` when the point lies outside the ramp's footprint.
 */
export function getRampRise(ramp: StairRamp, point: PlanPoint): number | undefined {
  if (!containsPoint(ramp.rect, point)) {
    return undefined;
  }
  const along = coordinateOn(point, ramp.runAxis);
  const run = ramp.highAt - ramp.lowAt;
  if (Math.abs(along - ramp.lowAt) <= LENGTH_TOLERANCE || Math.abs(run) <= LENGTH_TOLERANCE) {
    return ramp.lowLevel;
  }
  if (Math.abs(along - ramp.highAt) <= LENGTH_TOLERANCE) {
    return ramp.highLevel;
  }
  return ramp.lowLevel + ((along - ramp.lowAt) / run) * (ramp.highLevel - ramp.lowLevel);
}

/**
 * Returns the surface under a point, nearest a rise.
 *
 * The whole of "what is the floor height here, and may the body stand here".
 * Every surface over the point is a candidate, whether it belongs to a flight
 * or to a landing; the one nearest the rise the body is already at wins, and
 * every surface further than {@link Stairwell.reach} from that rise is refused.
 *
 * That refusal is not an error case: it IS the floor of the stairwell. A body
 * on one flight is a full storey from the flight over it and half a storey from
 * the one beside it, so both are out of reach and the body stays on the surface
 * it is walking. A caller that gets `undefined` must leave the body where it
 * was, exactly as it would at a wall.
 *
 * @param well - The stairwell to read.
 * @param point - Where the body is, in plan coordinates.
 * @param fromRise - The level the body is at now, in metres.
 * @returns The surface within `well.reach` of `fromRise` whose rise is nearest
 *   it, or `undefined` when the point lies on no footprint or every surface
 *   over it is out of reach. A surface exactly `reach` away is still reachable.
 *   Ties — two surfaces at the same rise, where two footprints meet — go to the
 *   ramp, and to the earlier of two ramps or two landings.
 */
export function getStairFooting(
  well: Stairwell,
  point: PlanPoint,
  fromRise: number,
): StairFooting | undefined {
  const underfoot: readonly StairFooting[] = [
    ...well.ramps.flatMap((ramp) => {
      const rise = getRampRise(ramp, point);
      return rise === undefined ? [] : [Object.freeze({ rise, gradient: getRampGradient(ramp) })];
    }),
    ...well.landings.flatMap((landing) =>
      containsPoint(landing.rect, point)
        ? [Object.freeze({ rise: landing.level, gradient: LEVEL_GRADIENT })]
        : [],
    ),
  ];

  // A scan for the nearest, never a search for the first: the surfaces are
  // ordered by level, not by how near the body is to them, so the first one
  // within reach is routinely the wrong one.
  return underfoot.reduce<StairFooting | undefined>((nearest, candidate) => {
    const distance = Math.abs(candidate.rise - fromRise);
    if (distance > well.reach) {
      return nearest;
    }
    return nearest === undefined || distance < Math.abs(nearest.rise - fromRise)
      ? candidate
      : nearest;
  }, undefined);
}

/**
 * Tells whether a point lies in the stairwell's bay, grown by a body radius.
 *
 * The field-selection test: it says whether the stair is what a body at this
 * point is standing on, so a caller can leave the flat-floor model behind
 * before the body's edge reaches the shaft rather than after it.
 *
 * @param well - The stairwell.
 * @param point - The point to locate, in plan coordinates.
 * @param radius - Radius of the body, in metres.
 * @returns `true` when the point is within `radius` of the bay.
 */
export function isNearStairwell(well: Stairwell, point: PlanPoint, radius: number): boolean {
  return containsPoint(growRect(well.bay, radius), point);
}
