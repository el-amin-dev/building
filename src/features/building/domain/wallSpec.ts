/**
 * Wall thicknesses of the floor, as specified in brief §2.
 *
 * Plan geometry is expressed as clear (inner) rectangles; these thicknesses
 * give the solid between them.
 */

/** Wall thicknesses of the floor, brief §2, metres. */
export interface WallSpec {
  /** Thickness of the exterior walls on sides A, B, C and D. */
  readonly exterior: number;
  /** Thickness of the interior partitions between two indoor spaces. */
  readonly partition: number;
  /** Thickness of walls facing open air or the void (weather-exposed face). */
  readonly voidFacing: number;
}

/**
 * The wall thicknesses of brief §2: 0.30 m exterior, 0.20 m partitions and
 * 0.30 m void-facing walls. Frozen.
 */
export const WALL_SPEC: WallSpec = Object.freeze({
  exterior: 0.3,
  partition: 0.2,
  voidFacing: 0.3,
});
