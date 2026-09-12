/**
 * Framing of the exterior orbit camera on a whole floor.
 *
 * The exterior view shows one complete floor from outside, so its camera cannot
 * be placed with hand-picked numbers: the distance at which the floor fills the
 * frame depends on the plot size, on the field of view and on the aspect ratio
 * of the canvas (a narrow phone viewport needs a much larger distance than a
 * wide desktop one). This module derives the whole framing — orbit target, start
 * position, zoom limits, fog range and ground size — from the plan and the
 * vertical sizes of the floor.
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
 * Factor applied to the fit distance for the closest orbit distance. A quarter of the
 * fit distance lets the viewer zoom in on a single room while the camera stays clear of
 * the building: at the start elevation, and at the fields of view and canvas shapes the
 * app uses, it is still well above the top of the walls, so zooming never pushes the
 * camera through them.
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

/** Everything the exterior view needs in order to frame one whole floor. */
export interface ExteriorFraming {
  /** Orbit pivot: the centre of the plot at half the wall height, in metres. */
  readonly target: Vector3Like;
  /** Where the camera starts, in metres. */
  readonly position: Vector3Like;
  /** Distance from the target at which the whole floor fits the frustum, in metres. */
  readonly fitDistance: number;
  /** Closest orbit distance, in metres. */
  readonly minDistance: number;
  /** Furthest orbit distance, in metres. */
  readonly maxDistance: number;
  /** Distance at which the fog starts, in metres: beyond the floor at any allowed zoom. */
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
 * Derives the exterior camera framing of one floor.
 *
 * The floor occupies the box that spans `plot` on the plan and, vertically, from the
 * bottom of its slab (`-getSlabThickness(heights)`, the one place that level is computed,
 * `slabs.ts`) to the top of its walls (`heights.wall`). The orbit target is the centre of
 * the plot at half the wall height.
 *
 * `fitDistance` fits that box, not the sphere around it. The floor is a long flat slab —
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
 * The fog starts past the furthest corner of the floor as seen from the furthest allowed
 * orbit distance, so no part of the building is ever fogged, however far the viewer zooms
 * out; `radius`, the distance from the target to that corner, is what the fog is offset by.
 *
 * @param plot - Outer boundary of the floor, in metres.
 * @param heights - Vertical sizes of the floor, in metres.
 * @param fovDegrees - Vertical field of view of the camera, in degrees.
 * @param aspect - Width divided by height of the canvas.
 * @returns A deeply frozen framing.
 * @throws RangeError naming the offending argument when `plot` has a non-finite or
 *   inverted coordinate, when `heights` has a non-finite size, a wall height that is not
 *   positive or one that leaves no positive slab thickness (see `getSlabThickness`), when
 *   `fovDegrees` is outside (0, 180), or when `aspect` is not a finite positive number.
 */
export function getExteriorFraming(
  plot: PlanRect,
  heights: FloorHeights,
  fovDegrees: number,
  aspect: number,
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

  const target: Vector3Like = {
    x: (plot.minX + plot.maxX) * HALF,
    y: heights.wall * HALF,
    z: (plot.minZ + plot.maxZ) * HALF,
  };
  const slabBottom = -getSlabThickness(heights);
  const verticalReach = Math.max(heights.wall - target.y, target.y - slabBottom);
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
    getCornerOffsets(plot, slabBottom, heights.wall, target),
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
 * Lists the eight corners of the floor box as offsets from the orbit target.
 *
 * @param plot - Outer boundary of the floor, in metres.
 * @param bottom - Level the box starts at, in metres: the underside of the slab.
 * @param top - Level the box ends at, in metres: the top of the walls.
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
