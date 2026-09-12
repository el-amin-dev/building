/**
 * Wall thicknesses of the floor, read from the source of truth.
 *
 * The numbers are not written here any more. The owner's plan
 * (`sourceOfTruth/plan.ts`) states them, the drawing is generated from it and
 * the wall derivation measures against it, so a second copy in this file could
 * only ever be a chance to disagree with the building. This module is the typed
 * view of that one declaration, kept so that the rest of the model can keep
 * importing `WALL_SPEC` without knowing where the numbers come from.
 *
 * Isolation is now a width. A wall the owner named for sound and heat is built
 * `insulated` (0.30) where an ordinary separator is built `partition` (0.15),
 * which is why a single face can be two or three thicknesses along its length
 * and why `walls.ts` derives a thickness per contact stretch rather than one per
 * wall. `voidFacing` is still not a duplicate of `exterior`: a wall between a
 * room and a balcony or a void is weather-exposed on one face, so it is built
 * like the envelope even though it stands inside the plot.
 */
import { WALLS } from './sourceOfTruth/plan.ts';

/** Wall thicknesses of the floor, in metres. */
export interface WallSpec {
  /** Thickness of the exterior walls on sides A, B, C and D. */
  readonly exterior: number;
  /** Thickness of a wall the owner named for sound and heat isolation. */
  readonly insulated: number;
  /** Thickness of a plain separator between two indoor spaces. */
  readonly partition: number;
  /** Thickness of walls facing open air or the void (weather-exposed face). */
  readonly voidFacing: number;
}

/**
 * The wall thicknesses of the source of truth: 0.30 m exterior, 0.30 m
 * insulated, 0.15 m plain separators and 0.30 m void-facing walls. Frozen where
 * the spec froze it.
 */
export const WALL_SPEC: WallSpec = WALLS;
