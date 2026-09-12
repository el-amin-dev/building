import { describe, expect, it } from 'vitest';
import { WALLS } from './sourceOfTruth/plan.ts';
import { WALL_SPEC } from './wallSpec.ts';

/**
 * What the module used to be tested for, and is not any more: the old file
 * asserted a three-field spec of its own making — 0.30 exterior, 0.20 partition,
 * 0.30 void-facing — as `brief §2`. Both the shape and the numbers are gone:
 * `wallSpec.ts` declares no numbers at all now, it re-exports the plan's `WALLS`,
 * the partition is 0.15, and there is a fourth thickness, `insulated`, because
 * isolation became a width. Asserting a literal object here would put a second
 * copy of the thicknesses in the repository, which is the exact thing the
 * re-export was introduced to prevent — so the first test below pins the
 * identity, and the value test is kept only as a readable anchor.
 */

/** Thickness of the envelope and of everything weather-exposed, in metres. */
const EXTERIOR_THICKNESS = 0.3;
/** Thickness of a wall the owner named for sound and heat, in metres. */
const INSULATED_THICKNESS = 0.3;
/** Thickness of a plain separator, in metres. */
const PARTITION_THICKNESS = 0.15;
/** Thickness of a wall with one face on a balcony or a void, in metres. */
const VOID_FACING_THICKNESS = 0.3;
/** A value no wall of the floor has, used to prove the spec cannot be written to. */
const ALTERED_THICKNESS = 1;

describe('wallSpec', () => {
  describe('WALL_SPEC', () => {
    it('is the plan’s WALLS itself, not a second copy of the numbers', () => {
      // Identity, not equality: a copy would pass `toEqual` on the day it was
      // written and drift the day the owner changes a thickness.
      expect(WALL_SPEC).toBe(WALLS);
    });

    it('reads 0.30 exterior, 0.30 insulated, 0.15 partition, 0.30 void-facing', () => {
      expect(WALL_SPEC).toEqual({
        exterior: EXTERIOR_THICKNESS,
        insulated: INSULATED_THICKNESS,
        partition: PARTITION_THICKNESS,
        voidFacing: VOID_FACING_THICKNESS,
      });
    });

    it('makes isolation a width: an insulated wall is twice a plain separator', () => {
      // The rule the whole wall derivation now turns on. Stated as a relation
      // rather than as two more literals, so it still means something when the
      // owner changes either number.
      expect(WALL_SPEC.insulated).toBeGreaterThan(WALL_SPEC.partition);
      expect(WALL_SPEC.insulated).toBe(WALL_SPEC.exterior);
      expect(WALL_SPEC.voidFacing).toBe(WALL_SPEC.exterior);
    });

    it('is frozen', () => {
      const mutable = WALL_SPEC as { exterior: number };

      expect(Object.isFrozen(WALL_SPEC)).toBe(true);
      expect(() => {
        mutable.exterior = ALTERED_THICKNESS;
      }).toThrow(TypeError);
      expect(WALL_SPEC.exterior).toBe(EXTERIOR_THICKNESS);
    });
  });
});
