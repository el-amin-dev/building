/**
 * Shared floor-plan geometry types and helpers.
 *
 * Plan coordinates are expressed in metres: `x` runs along the width, `z`
 * along the depth, and `y` (up) is not part of the plan. Plan data is drawn on
 * a centimetre grid; {@link toPlanLength} snaps computed values back onto it so
 * that sums and differences of grid values compare exactly.
 */

/** Axis-aligned rectangle on the floor plan (x/z, metres). */
export interface PlanRect {
  /** Smallest x coordinate covered by the rectangle, in metres. */
  readonly minX: number;
  /** Largest x coordinate covered by the rectangle, in metres. */
  readonly maxX: number;
  /** Smallest z coordinate covered by the rectangle, in metres. */
  readonly minZ: number;
  /** Largest z coordinate covered by the rectangle, in metres. */
  readonly maxZ: number;
}

/** A point on the floor plan (x/z, metres). */
export interface PlanPoint {
  /** Coordinate along x, in metres. */
  readonly x: number;
  /** Coordinate along z, in metres. */
  readonly z: number;
}

/**
 * One of the four faces of a {@link PlanRect}, named after the coordinate it
 * lies on: `minX` is the face at `x = rect.minX`, and so on.
 */
export type RectSide = 'minX' | 'maxX' | 'minZ' | 'maxZ';

/** Tolerance for comparing plan lengths and coordinates, in metres. */
export const LENGTH_TOLERANCE = 1e-9;

/** Number of centimetres in a metre: the resolution of the plan data grid. */
export const CENTIMETRES_PER_METRE = 100;

/**
 * Builds a frozen plan rectangle.
 *
 * No validation is performed: the coordinates are stored as given.
 *
 * @param minX - Smallest x coordinate.
 * @param maxX - Largest x coordinate.
 * @param minZ - Smallest z coordinate.
 * @param maxZ - Largest z coordinate.
 * @returns A frozen {@link PlanRect}.
 */
export function makeRect(minX: number, maxX: number, minZ: number, maxZ: number): PlanRect {
  return Object.freeze({ minX, maxX, minZ, maxZ });
}

/**
 * Snaps a length or coordinate onto the centimetre plan grid.
 *
 * Removes floating-point noise from arithmetic on grid values, so that for
 * example `toPlanLength(3.7 - 0.3) === 3.4` exactly.
 *
 * @param value - A length or coordinate, in metres.
 * @returns The value rounded to the nearest centimetre, in metres. Non-finite
 *   input is returned as `NaN` or `±Infinity`.
 */
export function toPlanLength(value: number): number {
  return Math.round(value * CENTIMETRES_PER_METRE) / CENTIMETRES_PER_METRE;
}

/**
 * Checks whether a value lies on the centimetre plan grid.
 *
 * @param value - A length or coordinate, in metres.
 * @returns `true` when the value is finite and within {@link LENGTH_TOLERANCE}
 *   of its {@link toPlanLength} rounding.
 */
export function isOnPlanGrid(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - toPlanLength(value)) <= LENGTH_TOLERANCE;
}

/**
 * Returns the width of a rectangle along x.
 *
 * @param rect - The rectangle to measure.
 * @returns `maxX - minX`, not rounded.
 */
export function rectWidth(rect: PlanRect): number {
  return rect.maxX - rect.minX;
}

/**
 * Returns the depth of a rectangle along z.
 *
 * @param rect - The rectangle to measure.
 * @returns `maxZ - minZ`, not rounded.
 */
export function rectDepth(rect: PlanRect): number {
  return rect.maxZ - rect.minZ;
}

/**
 * Returns the area of a rectangle.
 *
 * @param rect - The rectangle to measure.
 * @returns Width times depth, in square metres, not rounded.
 */
export function rectArea(rect: PlanRect): number {
  return rectWidth(rect) * rectDepth(rect);
}

/**
 * Checks whether two rectangles share a surface.
 *
 * @param a - First rectangle.
 * @param b - Second rectangle.
 * @returns `true` only when the rectangles overlap by more than
 *   {@link LENGTH_TOLERANCE} on both axes; rectangles that merely touch along
 *   an edge or at a corner do not overlap.
 */
export function rectsOverlap(a: PlanRect, b: PlanRect): boolean {
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return overlapX > LENGTH_TOLERANCE && overlapZ > LENGTH_TOLERANCE;
}

/**
 * Checks whether a rectangle lies entirely inside another.
 *
 * @param outer - The enclosing rectangle.
 * @param inner - The rectangle that should be enclosed.
 * @returns `true` when every face of `inner` lies inside `outer` or on its
 *   boundary, within {@link LENGTH_TOLERANCE}.
 */
export function rectContainsRect(outer: PlanRect, inner: PlanRect): boolean {
  return (
    inner.minX >= outer.minX - LENGTH_TOLERANCE &&
    inner.maxX <= outer.maxX + LENGTH_TOLERANCE &&
    inner.minZ >= outer.minZ - LENGTH_TOLERANCE &&
    inner.maxZ <= outer.maxZ + LENGTH_TOLERANCE
  );
}

/**
 * Checks whether a point lies inside a rectangle.
 *
 * The test is half-open and exact (no tolerance): the `minX` and `minZ` faces
 * belong to the rectangle, the `maxX` and `maxZ` faces do not, so rectangles
 * that tile the plan never both claim a shared edge.
 *
 * @param rect - The rectangle.
 * @param point - The point to locate.
 * @returns `true` when `minX <= x < maxX` and `minZ <= z < maxZ`.
 */
export function rectContainsPoint(rect: PlanRect, point: PlanPoint): boolean {
  return point.x >= rect.minX && point.x < rect.maxX && point.z >= rect.minZ && point.z < rect.maxZ;
}

/**
 * Moves every face of a rectangle inward by the same distance.
 *
 * A negative inset grows the rectangle outward. The resulting coordinates are
 * snapped onto the plan grid with {@link toPlanLength}. A result of zero width
 * or depth is allowed.
 *
 * @param rect - The rectangle to shrink.
 * @param inset - Distance each face moves inward, in metres.
 * @returns A frozen rectangle with every coordinate rounded to the plan grid.
 * @throws RangeError when `inset` is not finite, or when the rounded result
 *   would be inverted (min greater than max on either axis).
 */
export function insetRect(rect: PlanRect, inset: number): PlanRect {
  if (!Number.isFinite(inset)) {
    throw new RangeError(`inset must be a finite number, got ${String(inset)}`);
  }
  const minX = toPlanLength(rect.minX + inset);
  const maxX = toPlanLength(rect.maxX - inset);
  const minZ = toPlanLength(rect.minZ + inset);
  const maxZ = toPlanLength(rect.maxZ - inset);
  if (minX > maxX || minZ > maxZ) {
    throw new RangeError(
      `inset ${String(inset)} inverts the rectangle: it must not exceed half its smaller dimension`,
    );
  }
  return makeRect(minX, maxX, minZ, maxZ);
}
