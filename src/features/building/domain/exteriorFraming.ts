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
 * fit distance lets the viewer zoom in on a single room while staying outside the
 * bounding sphere of the floor, so zooming never pushes the camera through the walls.
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

/**
 * Derives the exterior camera framing of one floor.
 *
 * The floor occupies the box that spans `plot` on the plan and, vertically, from the
 * bottom of its slab (`-(heights.floorToFloor - heights.wall)`) to the top of its walls
 * (`heights.wall`). The orbit target is the centre of the plot at half the wall height,
 * and `radius` is the distance from that target to the furthest corner of the box.
 *
 * The floor fits the frame at `radius / sin(halfFov)`, taking the narrower of the two
 * half-angles of the frustum: the vertical one is half of `fovDegrees`, and the
 * horizontal one is `atan(tan(halfFovVertical) * aspect)`, so a viewport narrower than
 * it is tall pulls the camera back rather than cropping the building. The start position
 * sits a little beyond that distance, above and off to one side of the open side B.
 *
 * The fog starts past the furthest corner of the floor as seen from the furthest allowed
 * orbit distance, so no part of the building is ever fogged, however far the viewer zooms
 * out.
 *
 * @param plot - Outer boundary of the floor, in metres.
 * @param heights - Vertical sizes of the floor, in metres.
 * @param fovDegrees - Vertical field of view of the camera, in degrees.
 * @param aspect - Width divided by height of the canvas.
 * @returns A deeply frozen framing.
 * @throws RangeError naming the offending argument when `plot` has a non-finite or
 *   inverted coordinate, when `heights` has a non-finite size or a wall height that is
 *   not positive, when `fovDegrees` is outside (0, 180), or when `aspect` is not a finite
 *   positive number.
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
  const slabBottom = -(heights.floorToFloor - heights.wall);
  const verticalReach = Math.max(heights.wall - target.y, target.y - slabBottom);
  const radius = Math.hypot(
    (plot.maxX - plot.minX) * HALF,
    verticalReach,
    (plot.maxZ - plot.minZ) * HALF,
  );

  const halfFovVertical = fovDegrees * HALF * RADIANS_PER_DEGREE;
  const halfFovHorizontal = Math.atan(Math.tan(halfFovVertical) * aspect);
  const fitDistance = radius / Math.sin(Math.min(halfFovVertical, halfFovHorizontal));

  const elevation = EXTERIOR_ELEVATION_DEGREES * RADIANS_PER_DEGREE;
  const azimuth = EXTERIOR_AZIMUTH_FROM_B_DEGREES * RADIANS_PER_DEGREE;
  const startDistance = fitDistance * START_MARGIN;
  const horizontalDistance = Math.cos(elevation) * startDistance;

  const minDistance = fitDistance * MIN_DISTANCE_FACTOR;
  const maxDistance = fitDistance * MAX_DISTANCE_FACTOR;
  const fogNear = maxDistance + radius;
  const fogFar = fogNear * FOG_FAR_FACTOR;

  return Object.freeze({
    target: Object.freeze(target),
    position: Object.freeze({
      x: target.x - Math.sin(azimuth) * horizontalDistance,
      y: target.y + Math.sin(elevation) * startDistance,
      z: target.z + Math.cos(azimuth) * horizontalDistance,
    }),
    fitDistance,
    minDistance,
    maxDistance,
    fogNear,
    fogFar,
    groundSize: fogFar * GROUND_SIZE_FACTOR,
  });
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
