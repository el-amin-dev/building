/**
 * Framing of the exterior orbit camera on a whole building.
 *
 * The exterior view shows the whole building from outside, so its camera cannot
 * be placed with hand-picked numbers: the distance at which the building fills
 * the frame depends on the plot size, on how many storeys are stacked, on the
 * field of view and on the aspect ratio of the canvas (a narrow phone viewport
 * needs a much larger distance than a wide desktop one). This module derives the
 * whole framing — orbit target, start position, zoom limits, fog range and ground
 * size — from the plan, the vertical sizes of the typical floor and the number of
 * storeys.
 *
 * Every published number is a multiple of the fit distance, and the fit distance
 * is derived from the box the building occupies, so the framing is scale-free: it
 * is as correct for a ten-storey stack as for the single designed floor, with no
 * factor re-tuned in between.
 *
 * Coordinates follow the scene conventions: metres, `y` up, the plan on `x`/`z`
 * with the origin at the outer corner of sides A and C (see `floorPlan/types.ts`).
 * Angles are given in degrees at the constants and converted to radians here.
 *
 * The framing is presentation-only: it is not a building dimension, so the
 * factors below live here rather than in `heights.ts`.
 */

import type { FloorHeights } from './heights.ts';
import type { PlanRect } from './planGeometry.ts';
import { getSlabThickness } from './slabs.ts';
import { getBuildingTop, MIN_FLOOR_COUNT } from './storeys.ts';

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;
const HALF = 0.5;

/**
 * Angle of the start position above the horizontal of the orbit target, in degrees.
 *
 * High enough to look down into the floor and read the room layout, low enough that the
 * walls are still seen from the side rather than as a flat plan.
 */
const EXTERIOR_ELEVATION_DEGREES = 40;

/**
 * Heading of the start position, in degrees, measured at the orbit target from +z
 * (straight out from side B) toward −x (toward side A).
 *
 * Side B is the open side of the floor, so the view starts on it; the offset toward
 * side A turns the far short end into view as well, so the start frame shows two sides
 * of the building instead of one flat facade.
 */
const EXTERIOR_AZIMUTH_FROM_B_DEGREES = 25;

/**
 * Factor applied to the fit distance for the start position: a little further out than
 * the exact fit, so the floor does not touch the edges of the frame on entry.
 */
const START_MARGIN = 1.1;

/**
 * Factor applied to the fit distance for the closest orbit distance.
 *
 * Scale-free on purpose, which is the whole of its justification: the fit distance
 * already carries the size of the building, so a quarter of it always frames about a
 * quarter of the building, however tall that building is. The closest zoom therefore
 * reads the same on the 2.70 m single floor and on a 29.70 m ten-storey stack — a room
 * or two filling the frame — instead of being a length that would have to be re-picked
 * every time a storey is added.
 *
 * It makes **no** claim about clearing the walls. The wording this replaced did, and that
 * claim was already false at one storey, not merely at ten: `getOrbitLimits`
 * (`orbitNavigation.ts`) lets the polar angle run to within
 * `ORBIT_GROUND_CLEARANCE_RADIANS` of level with the
 * target, so a camera tilted down to level at this distance is inside the floor plate
 * today. That is not a defect to fix here. The exterior view is a model viewer — passing
 * through the model is how a viewer looks into it — and the interior view is the one
 * where walls stop you (`eyeNavigation.ts` collides against them). The tests pin the
 * ordering `0 < minDistance < fitDistance < maxDistance` at every storey count and
 * aspect, and nothing about wall clearance, so that this reasoning and the suite agree.
 */
const MIN_DISTANCE_FACTOR = 0.25;

/**
 * Factor applied to the fit distance for the furthest orbit distance: twice the fit
 * distance shows the floor with its surroundings without shrinking it to a speck.
 */
const MAX_DISTANCE_FACTOR = 2;

/**
 * Factor from the near fog distance to the far one. The fog has to fade over a span
 * comparable to its own start distance to read as depth rather than as a wall.
 */
const FOG_FAR_FACTOR = 2;

/**
 * Factor from the far fog distance to the side of the square ground plane: the ground
 * must still reach past the fog at the corners of the frame, where it is furthest from
 * the camera, so its edge is never visible.
 */
const GROUND_SIZE_FACTOR = 2;

/** A point or direction in scene space, metres (x, z on the plan; y up). */
export interface Vector3Like {
  /** Coordinate along the plan width, in metres. */
  readonly x: number;
  /** Height above the finished floor, in metres. */
  readonly y: number;
  /** Coordinate along the plan depth, in metres. */
  readonly z: number;
}

/** Everything the exterior view needs in order to frame the whole building. */
export interface ExteriorFraming {
  /** Orbit pivot: the centre of the plot at half the height of the building, in metres. */
  readonly target: Vector3Like;
  /** Where the camera starts, in metres. */
  readonly position: Vector3Like;
  /** Distance from the target at which the whole building fits the frustum, in metres. */
  readonly fitDistance: number;
  /** Closest orbit distance, in metres. */
  readonly minDistance: number;
  /** Furthest orbit distance, in metres. */
  readonly maxDistance: number;
  /** Distance at which the fog starts, in metres: beyond the building at any allowed zoom. */
  readonly fogNear: number;
  /** Distance at which the fog is opaque, in metres. */
  readonly fogFar: number;
  /** Side of the square ground plane, in metres. */
  readonly groundSize: number;
}

/** The orthonormal frame of the camera: where it looks, and the two axes of the frame. */
interface CameraBasis {
  /** Unit vector from the camera toward the orbit target. */
  readonly forward: Vector3Like;
  /** Unit vector along the width of the frame, toward its right edge; horizontal. */
  readonly right: Vector3Like;
  /** Unit vector along the height of the frame, toward its top edge. */
  readonly up: Vector3Like;
}

/**
 * Derives the exterior camera framing of a building of `storeyCount` storeys.
 *
 * The building occupies the box that spans `plot` on the plan and, vertically, from the
 * bottom of the lowest slab (`-getSlabThickness(heights)`, the one place that level is
 * computed, `slabs.ts` — storey 1's slab is still the lowest thing whatever is stacked on
 * top of it) to the top of the topmost storey's walls (`getBuildingTop(heights,
 * storeyCount)`, `storeys.ts`). The orbit target is the centre of the plot at half that
 * top, which is `heights.wall / 2` at one storey and rises with the stack.
 *
 * Those two levels are the *only* things the storey count changes. `fitDistance` is
 * derived from the box, and `minDistance`, `maxDistance`, `fogNear`, `fogFar` and
 * `groundSize` are all multiples of `fitDistance`, so a taller building carries the whole
 * framing up with it and no factor below is storey-dependent.
 *
 * `fitDistance` fits that box, not the sphere around it. The single floor is a long flat slab —
 * 22.50 × 10.00 m against 3.00 m of height — so its bounding sphere is more than twice as
 * tall as the building is, and backing off far enough to fit the sphere leaves the floor
 * filling under half the frame. Instead every corner of the box is expressed in the frame
 * of the camera (see {@link getCameraBasis}): `depth` along `forward`, and the offsets
 * along `right` and `up`. A corner is inside the frustum at distance `d` from the target
 * when `|offset·right| <= tanHalfHorizontal * (d + depth)` and likewise for `up` with
 * `tanHalfVertical`, so each corner requires `|offset·right| / tanHalfHorizontal - depth`
 * and `|offset·up| / tanHalfVertical - depth`, and the fit distance is the largest of
 * those sixteen requirements: the smallest distance at which the whole box is in frame.
 * The half-angles come from the camera itself — the vertical one is half of `fovDegrees`,
 * the horizontal one widens it by `aspect` — so a viewport narrower than it is tall pulls
 * the camera back rather than cropping the building. The start position sits a
 * {@link START_MARGIN} beyond the fit distance, above and off to one side of the open side B.
 *
 * The fog starts past the furthest corner of the building as seen from the furthest
 * allowed orbit distance, so no part of the building is ever fogged, however far the
 * viewer zooms out; `radius`, the distance from the target to that corner, is what the fog
 * is offset by.
 *
 * @param plot - Outer boundary of the floor, in metres.
 * @param heights - Vertical sizes of the typical floor, in metres.
 * @param fovDegrees - Vertical field of view of the camera, in degrees.
 * @param aspect - Width divided by height of the canvas.
 * @param storeyCount - How many storeys are stacked; at least 1. Required rather than
 *   defaulted, so the one production call site (`useExteriorFraming`) has to say which
 *   building it is framing instead of silently framing a one-storey one. Deliberately
 *   *not* bounded above by `MAX_FLOOR_COUNT`: bounding what the stepper may ask for is
 *   the store's business, and this framing must stay right for whatever count it is given.
 * @returns A deeply frozen framing.
 * @throws RangeError naming the offending argument when `plot` has a non-finite or
 *   inverted coordinate, when `heights` has a non-finite size, a wall height that is not
 *   positive or one that leaves no positive slab thickness (see `getSlabThickness`), when
 *   `fovDegrees` is outside (0, 180), when `aspect` is not a finite positive number, or
 *   when `storeyCount` is not an integer of at least 1.
 */
export function getExteriorFraming(
  plot: PlanRect,
  heights: FloorHeights,
  fovDegrees: number,
  aspect: number,
  storeyCount: number,
): ExteriorFraming {
  assertPlot(plot);
  assertHeights(heights);
  if (!Number.isFinite(fovDegrees) || fovDegrees <= 0 || fovDegrees >= DEGREES_PER_HALF_TURN) {
    throw new RangeError(
      `fovDegrees must be in (0, ${String(DEGREES_PER_HALF_TURN)}), got ${String(fovDegrees)}`,
    );
  }
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError(`aspect must be a finite positive number, got ${String(aspect)}`);
  }
  assertStoreyCount(storeyCount);

  const buildingTop = getBuildingTop(heights, storeyCount);
  const target: Vector3Like = {
    x: (plot.minX + plot.maxX) * HALF,
    y: buildingTop * HALF,
    z: (plot.minZ + plot.maxZ) * HALF,
  };
  const slabBottom = -getSlabThickness(heights);
  const verticalReach = Math.max(buildingTop - target.y, target.y - slabBottom);
  const radius = Math.hypot(
    (plot.maxX - plot.minX) * HALF,
    verticalReach,
    (plot.maxZ - plot.minZ) * HALF,
  );

  const elevation = EXTERIOR_ELEVATION_DEGREES * RADIANS_PER_DEGREE;
  const azimuth = EXTERIOR_AZIMUTH_FROM_B_DEGREES * RADIANS_PER_DEGREE;
  const basis = getCameraBasis(elevation, azimuth);

  const tanHalfVertical = Math.tan(fovDegrees * HALF * RADIANS_PER_DEGREE);
  const tanHalfHorizontal = tanHalfVertical * aspect;
  const fitDistance = getBoxFitDistance(
    getCornerOffsets(plot, slabBottom, buildingTop, target),
    basis,
    tanHalfHorizontal,
    tanHalfVertical,
  );

  const startDistance = fitDistance * START_MARGIN;
  const minDistance = fitDistance * MIN_DISTANCE_FACTOR;
  const maxDistance = fitDistance * MAX_DISTANCE_FACTOR;
  const fogNear = maxDistance + radius;
  const fogFar = fogNear * FOG_FAR_FACTOR;

  return Object.freeze({
    target: Object.freeze(target),
    // The camera is back along its own view direction from the target.
    position: Object.freeze({
      x: target.x - basis.forward.x * startDistance,
      y: target.y - basis.forward.y * startDistance,
      z: target.z - basis.forward.z * startDistance,
    }),
    fitDistance,
    minDistance,
    maxDistance,
    fogNear,
    fogFar,
    groundSize: fogFar * GROUND_SIZE_FACTOR,
  });
}

/**
 * Builds the frame of a camera that orbits at an elevation and a heading, with `y` up.
 *
 * `forward` points from the camera down to the target, so the camera itself is at
 * `target - forward * distance`: up at `elevation` above the target, at `azimuth` around
 * from +z toward −x. `right` is the horizontal axis of the frame and `up` completes it,
 * exactly as a `lookAt` with a `y`-up camera would orient them (`right` is `forward × y`
 * normalised, `up` is `right × forward`), written out in closed form.
 *
 * @param elevation - Angle of the camera above the horizontal of the target, in radians.
 *   Must be in (−π/2, π/2), so that `right` is well defined.
 * @param azimuth - Heading of the camera at the target, from +z toward −x, in radians.
 * @returns The three unit vectors of the frame.
 */
function getCameraBasis(elevation: number, azimuth: number): CameraBasis {
  const sinElevation = Math.sin(elevation);
  const cosElevation = Math.cos(elevation);
  const sinAzimuth = Math.sin(azimuth);
  const cosAzimuth = Math.cos(azimuth);
  return {
    forward: { x: sinAzimuth * cosElevation, y: -sinElevation, z: -cosAzimuth * cosElevation },
    right: { x: cosAzimuth, y: 0, z: sinAzimuth },
    up: { x: sinAzimuth * sinElevation, y: cosElevation, z: -cosAzimuth * sinElevation },
  };
}

/**
 * Lists the eight corners of the building box as offsets from the orbit target.
 *
 * @param plot - Outer boundary of the floor, in metres.
 * @param bottom - Level the box starts at, in metres: the underside of storey 1's slab.
 * @param top - Level the box ends at, in metres: the top of the topmost storey's walls.
 * @param target - The orbit target the offsets are measured from, in metres.
 * @returns The eight corner offsets, in no particular order.
 */
function getCornerOffsets(
  plot: PlanRect,
  bottom: number,
  top: number,
  target: Vector3Like,
): readonly Vector3Like[] {
  const offsets: Vector3Like[] = [];
  for (const x of [plot.minX, plot.maxX]) {
    for (const y of [bottom, top]) {
      for (const z of [plot.minZ, plot.maxZ]) {
        offsets.push({ x: x - target.x, y: y - target.y, z: z - target.z });
      }
    }
  }
  return offsets;
}

/**
 * Smallest distance from the orbit target at which every corner is inside the frustum.
 *
 * Each corner constrains the distance twice, once per axis of the frame, and the distance
 * that satisfies all of them is the largest of those requirements (see
 * {@link getExteriorFraming}). A corner that is behind the target requires less distance
 * than one in front of it, which is what makes this fit tighter than the sphere fit on a
 * flat building.
 *
 * @param offsets - Corner offsets from the target, in metres.
 * @param basis - The frame of the camera.
 * @param tanHalfHorizontal - Tangent of the horizontal half-angle of the frustum.
 * @param tanHalfVertical - Tangent of the vertical half-angle of the frustum.
 * @returns The fit distance, in metres; positive for a box of positive size.
 */
function getBoxFitDistance(
  offsets: readonly Vector3Like[],
  basis: CameraBasis,
  tanHalfHorizontal: number,
  tanHalfVertical: number,
): number {
  let fitDistance = 0;
  for (const offset of offsets) {
    const depth = dot(offset, basis.forward);
    fitDistance = Math.max(
      fitDistance,
      Math.abs(dot(offset, basis.right)) / tanHalfHorizontal - depth,
      Math.abs(dot(offset, basis.up)) / tanHalfVertical - depth,
    );
  }
  return fitDistance;
}

/**
 * Scalar product of two vectors.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Their dot product.
 */
function dot(a: Vector3Like, b: Vector3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Rejects a plot whose coordinates are not finite, or that is inverted on either axis. */
function assertPlot(plot: PlanRect): void {
  const coordinates = [plot.minX, plot.maxX, plot.minZ, plot.maxZ];
  if (!coordinates.every(Number.isFinite)) {
    throw new RangeError(
      `plot coordinates must be finite, got (${coordinates.map(String).join(', ')})`,
    );
  }
  if (plot.minX >= plot.maxX || plot.minZ >= plot.maxZ) {
    throw new RangeError(
      `plot must have a positive width and depth, got x ${String(plot.minX)}–${String(plot.maxX)}, z ${String(plot.minZ)}–${String(plot.maxZ)}`,
    );
  }
}

/**
 * Rejects anything that is not a whole number of storeys to frame.
 *
 * Only the lower bound is checked, and it is `MIN_FLOOR_COUNT` rather than a number
 * written out again here. There is deliberately no upper bound: how many storeys the
 * owner may *ask* for is `clampFloorCount`'s business, while a building of any height has
 * a perfectly well defined framing, and the one below it — a building of no storeys — has
 * no box to fit and so no framing at all.
 *
 * @param storeyCount - The number of storeys to check.
 * @throws RangeError naming the value when it is not an integer, or is below
 *   `MIN_FLOOR_COUNT`.
 */
function assertStoreyCount(storeyCount: number): void {
  if (!Number.isInteger(storeyCount) || storeyCount < MIN_FLOOR_COUNT) {
    throw new RangeError(
      `storeyCount must be an integer of at least ${String(MIN_FLOOR_COUNT)}, got ${String(storeyCount)}`,
    );
  }
}

/** Rejects heights that are not finite, or a wall height that is not positive. */
function assertHeights(heights: FloorHeights): void {
  if (!Number.isFinite(heights.floorToFloor) || !Number.isFinite(heights.wall)) {
    throw new RangeError(
      `heights must be finite, got floorToFloor ${String(heights.floorToFloor)}, wall ${String(heights.wall)}`,
    );
  }
  if (heights.wall <= 0) {
    throw new RangeError(`heights.wall must be positive, got ${String(heights.wall)}`);
  }
}
