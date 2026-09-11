import { describe, expect, it } from 'vitest';
import { WALL_SPEC } from './wallSpec.ts';

const EXTERIOR_THICKNESS = 0.3;
const PARTITION_THICKNESS = 0.2;
const VOID_FACING_THICKNESS = 0.3;
const ALTERED_THICKNESS = 1;

describe('wallSpec', () => {
  describe('WALL_SPEC', () => {
    it('matches brief §2: 0.30 m exterior, 0.20 m partition, 0.30 m void-facing', () => {
      expect(WALL_SPEC).toEqual({
        exterior: EXTERIOR_THICKNESS,
        partition: PARTITION_THICKNESS,
        voidFacing: VOID_FACING_THICKNESS,
      });
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
