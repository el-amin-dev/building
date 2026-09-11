/**
 * Shared floor-plan geometry types.
 *
 * Plan coordinates are expressed in metres: `x` runs along the width, `z`
 * along the depth, and `y` (up) is not part of the plan.
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
