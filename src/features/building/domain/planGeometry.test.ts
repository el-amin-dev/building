import { describe, expect, it } from 'vitest';
import {
  CENTIMETRES_PER_METRE,
  LENGTH_TOLERANCE,
  insetRect,
  isOnPlanGrid,
  makeRect,
  rectArea,
  rectContainsPoint,
  rectContainsRect,
  rectDepth,
  rectWidth,
  rectsOverlap,
  toPlanLength,
} from './planGeometry.ts';
import type { PlanRect, RectSide } from './planGeometry.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const DOUBLE = 2;
const EXPECTED_TOLERANCE = 1e-9;
const EXPECTED_CENTIMETRES_PER_METRE = 100;

const RECT_MIN_X = 1.6;
const RECT_MAX_X = 6.6;
const RECT_MIN_Z = 0.3;
const RECT_MAX_Z = 3.7;
const RECT_WIDTH = 5.0;
const RECT_DEPTH = 3.4;
const RECT_AREA = 17.0;

const HALF_TOLERANCE = LENGTH_TOLERANCE * HALF;
const DOUBLE_TOLERANCE = LENGTH_TOLERANCE * DOUBLE;
const MAX_FACE_OUTWARD_SIGN = 1;
const MIN_FACE_OUTWARD_SIGN = -1;

const INSIDE_X = 2.0;
const INSIDE_Z = 1.0;
const INSIDE_MAX_X = 6.0;
const INSIDE_MAX_Z = 3.0;
const BELOW_MIN_X = 1.0;
const ABOVE_MAX_Z = 5.0;
const OVERLAP_MIN_X = 5.0;
const OVERLAP_MIN_Z = 2.0;
const FAR_MIN_X = 7.0;
const FAR_MIN_Z = 4.0;
const NEIGHBOUR_MAX_X = 9.0;
const NEIGHBOUR_MAX_Z = 6.0;

const GRID_VALUE = 9.8;
const OFF_GRID_VALUE = 9.805;
const ROUNDS_UP_VALUE = 9.806;
const ROUNDED_UP_VALUE = 9.81;
const ROUNDS_DOWN_VALUE = 9.804;
const NEGATIVE_OFF_GRID_VALUE = -0.304;
const NEGATIVE_GRID_VALUE = -0.3;
const NEGATIVE_QUARTER_VALUE = -1.25;
const ALTERED_VALUE = 99;

const QUARTER_INSET = 0.25;
const WALL_INSET = 0.3;
const OFF_GRID_WALL_INSET = 0.304;
const ZERO_DEPTH_INSET = 1.7;
const INVERTING_INSET = 1.8;

const RECT = makeRect(RECT_MIN_X, RECT_MAX_X, RECT_MIN_Z, RECT_MAX_Z);

/**
 * Returns a copy of a rectangle with one face moved along its axis.
 *
 * @param rect - The rectangle to copy.
 * @param side - The face to move.
 * @param delta - Signed displacement added to the face coordinate.
 * @returns A new, unfrozen rectangle.
 */
function withSideMoved(rect: PlanRect, side: RectSide, delta: number): PlanRect {
  return { ...rect, [side]: rect[side] + delta };
}

describe('planGeometry', () => {
  describe('constants', () => {
    it('compares lengths to 1e-9 m on a centimetre grid', () => {
      expect(LENGTH_TOLERANCE).toBe(EXPECTED_TOLERANCE);
      expect(CENTIMETRES_PER_METRE).toBe(EXPECTED_CENTIMETRES_PER_METRE);
    });
  });

  describe('makeRect', () => {
    it('stores the coordinates in minX, maxX, minZ, maxZ order', () => {
      expect(RECT).toEqual({
        minX: RECT_MIN_X,
        maxX: RECT_MAX_X,
        minZ: RECT_MIN_Z,
        maxZ: RECT_MAX_Z,
      });
    });

    it('is frozen', () => {
      const mutable = RECT as { minX: number };

      expect(Object.isFrozen(RECT)).toBe(true);
      expect(() => {
        mutable.minX = ALTERED_VALUE;
      }).toThrow(TypeError);
      expect(RECT.minX).toBe(RECT_MIN_X);
    });
  });

  describe('toPlanLength', () => {
    it('removes floating-point noise: 3.7 − 0.3 is exactly 3.4', () => {
      expect(RECT_MAX_Z - RECT_MIN_Z).not.toBe(RECT_DEPTH);
      expect(toPlanLength(RECT_MAX_Z - RECT_MIN_Z)).toBe(RECT_DEPTH);
    });

    it('rounds to the nearest centimetre', () => {
      expect(toPlanLength(ROUNDS_UP_VALUE)).toBe(ROUNDED_UP_VALUE);
      expect(toPlanLength(ROUNDS_DOWN_VALUE)).toBe(GRID_VALUE);
      expect(toPlanLength(NEGATIVE_OFF_GRID_VALUE)).toBe(NEGATIVE_GRID_VALUE);
    });

    it('keeps grid values unchanged', () => {
      expect(toPlanLength(GRID_VALUE)).toBe(GRID_VALUE);
    });

    it('returns NaN for NaN', () => {
      expect(toPlanLength(Number.NaN)).toBeNaN();
    });
  });

  describe('isOnPlanGrid', () => {
    it.each([
      ['a centimetre value', GRID_VALUE],
      ['a negative centimetre value', NEGATIVE_QUARTER_VALUE],
      ['a noisy grid value', RECT_MAX_Z - RECT_MIN_Z],
      ['a grid value off by half the tolerance', GRID_VALUE + HALF_TOLERANCE],
    ])('accepts %s', (_label, value) => {
      expect(isOnPlanGrid(value)).toBe(true);
    });

    it.each([
      ['a half-centimetre value', OFF_GRID_VALUE],
      ['a grid value off by twice the tolerance', GRID_VALUE + DOUBLE_TOLERANCE],
      ['NaN', Number.NaN],
      ['infinity', Number.POSITIVE_INFINITY],
      ['negative infinity', Number.NEGATIVE_INFINITY],
    ])('rejects %s', (_label, value) => {
      expect(isOnPlanGrid(value)).toBe(false);
    });
  });

  describe('rectWidth, rectDepth, rectArea', () => {
    it('measures the width along x', () => {
      expect(rectWidth(RECT)).toBeCloseTo(RECT_WIDTH, PRECISION_DIGITS);
    });

    it('measures the depth along z', () => {
      expect(rectDepth(RECT)).toBeCloseTo(RECT_DEPTH, PRECISION_DIGITS);
    });

    it('returns raw, unrounded values', () => {
      expect(rectDepth(RECT)).toBe(RECT_MAX_Z - RECT_MIN_Z);
    });

    it('multiplies width by depth', () => {
      expect(rectArea(RECT)).toBeCloseTo(RECT_AREA, PRECISION_DIGITS);
    });
  });

  describe('rectsOverlap', () => {
    it.each([
      ['the same rectangle', RECT],
      ['a rectangle inside it', makeRect(INSIDE_X, INSIDE_MAX_X, INSIDE_Z, INSIDE_MAX_Z)],
      [
        'a rectangle crossing its maxX and maxZ faces',
        makeRect(OVERLAP_MIN_X, NEIGHBOUR_MAX_X, OVERLAP_MIN_Z, NEIGHBOUR_MAX_Z),
      ],
      [
        'a rectangle overlapping by twice the tolerance',
        makeRect(RECT_MAX_X - DOUBLE_TOLERANCE, NEIGHBOUR_MAX_X, RECT_MIN_Z, RECT_MAX_Z),
      ],
    ])('is true for %s, in both orders', (_label, other) => {
      expect(rectsOverlap(RECT, other)).toBe(true);
      expect(rectsOverlap(other, RECT)).toBe(true);
    });

    it.each([
      [
        'a rectangle touching its maxX face',
        makeRect(RECT_MAX_X, NEIGHBOUR_MAX_X, RECT_MIN_Z, RECT_MAX_Z),
      ],
      [
        'a rectangle touching its maxZ face',
        makeRect(RECT_MIN_X, RECT_MAX_X, RECT_MAX_Z, NEIGHBOUR_MAX_Z),
      ],
      [
        'a rectangle touching a corner',
        makeRect(RECT_MAX_X, NEIGHBOUR_MAX_X, RECT_MAX_Z, NEIGHBOUR_MAX_Z),
      ],
      [
        'a rectangle overlapping by half the tolerance on x',
        makeRect(RECT_MAX_X - HALF_TOLERANCE, NEIGHBOUR_MAX_X, RECT_MIN_Z, RECT_MAX_Z),
      ],
      [
        'a rectangle overlapping by half the tolerance on z',
        makeRect(RECT_MIN_X, RECT_MAX_X, RECT_MAX_Z - HALF_TOLERANCE, NEIGHBOUR_MAX_Z),
      ],
      [
        'a rectangle overlapping on x only',
        makeRect(OVERLAP_MIN_X, NEIGHBOUR_MAX_X, FAR_MIN_Z, NEIGHBOUR_MAX_Z),
      ],
      [
        'a rectangle overlapping on z only',
        makeRect(FAR_MIN_X, NEIGHBOUR_MAX_X, INSIDE_Z, OVERLAP_MIN_Z),
      ],
    ])('is false for %s, in both orders', (_label, other) => {
      expect(rectsOverlap(RECT, other)).toBe(false);
      expect(rectsOverlap(other, RECT)).toBe(false);
    });
  });

  describe('rectContainsRect', () => {
    const inner = makeRect(INSIDE_X, INSIDE_MAX_X, INSIDE_Z, INSIDE_MAX_Z);

    it('contains a rectangle strictly inside it, but not the other way round', () => {
      expect(rectContainsRect(RECT, inner)).toBe(true);
      expect(rectContainsRect(inner, RECT)).toBe(false);
    });

    it('contains itself (inclusive boundary)', () => {
      expect(rectContainsRect(RECT, RECT)).toBe(true);
    });

    it('contains a rectangle exceeding it by half the tolerance on every side', () => {
      const slightlyLarger = makeRect(
        RECT_MIN_X - HALF_TOLERANCE,
        RECT_MAX_X + HALF_TOLERANCE,
        RECT_MIN_Z - HALF_TOLERANCE,
        RECT_MAX_Z + HALF_TOLERANCE,
      );

      expect(rectContainsRect(RECT, slightlyLarger)).toBe(true);
    });

    it.each([
      ['minX', MIN_FACE_OUTWARD_SIGN],
      ['maxX', MAX_FACE_OUTWARD_SIGN],
      ['minZ', MIN_FACE_OUTWARD_SIGN],
      ['maxZ', MAX_FACE_OUTWARD_SIGN],
    ] as const)(
      'rejects a rectangle whose %s face exceeds it by twice the tolerance',
      (side, sign) => {
        const larger = withSideMoved(RECT, side, sign * DOUBLE_TOLERANCE);

        expect(rectContainsRect(RECT, larger)).toBe(false);
      },
    );
  });

  describe('rectContainsPoint', () => {
    it('contains an interior point', () => {
      expect(rectContainsPoint(RECT, { x: INSIDE_X, z: INSIDE_Z })).toBe(true);
    });

    it('includes the min faces on both axes', () => {
      expect(rectContainsPoint(RECT, { x: RECT_MIN_X, z: INSIDE_Z })).toBe(true);
      expect(rectContainsPoint(RECT, { x: INSIDE_X, z: RECT_MIN_Z })).toBe(true);
      expect(rectContainsPoint(RECT, { x: RECT_MIN_X, z: RECT_MIN_Z })).toBe(true);
    });

    it('excludes the max faces on both axes', () => {
      expect(rectContainsPoint(RECT, { x: RECT_MAX_X, z: INSIDE_Z })).toBe(false);
      expect(rectContainsPoint(RECT, { x: INSIDE_X, z: RECT_MAX_Z })).toBe(false);
    });

    it('applies no tolerance below the min faces', () => {
      expect(rectContainsPoint(RECT, { x: RECT_MIN_X - HALF_TOLERANCE, z: INSIDE_Z })).toBe(false);
      expect(rectContainsPoint(RECT, { x: INSIDE_X, z: RECT_MIN_Z - HALF_TOLERANCE })).toBe(false);
    });

    it('checks x against the x range and z against the z range', () => {
      expect(rectContainsPoint(RECT, { x: BELOW_MIN_X, z: OVERLAP_MIN_Z })).toBe(false);
      expect(rectContainsPoint(RECT, { x: INSIDE_X, z: ABOVE_MAX_Z })).toBe(false);
    });
  });

  describe('insetRect', () => {
    it('moves every face inward by the inset', () => {
      const QUARTER_MIN_X = 1.85;
      const QUARTER_MAX_X = 6.35;
      const QUARTER_MIN_Z = 0.55;
      const QUARTER_MAX_Z = 3.45;

      expect(insetRect(RECT, QUARTER_INSET)).toEqual(
        makeRect(QUARTER_MIN_X, QUARTER_MAX_X, QUARTER_MIN_Z, QUARTER_MAX_Z),
      );
    });

    it('rounds every coordinate onto the plan grid', () => {
      const WALL_MIN_X = 1.9;
      const WALL_MAX_X = 6.3;
      const WALL_MIN_Z = 0.6;
      const expected = makeRect(WALL_MIN_X, WALL_MAX_X, WALL_MIN_Z, RECT_DEPTH);

      expect(RECT_MAX_Z - WALL_INSET).not.toBe(RECT_DEPTH);
      expect(insetRect(RECT, WALL_INSET)).toEqual(expected);
      expect(insetRect(RECT, OFF_GRID_WALL_INSET)).toEqual(expected);
    });

    it('grows the rectangle for a negative inset', () => {
      const OUTSET_MIN_X = 1.3;
      const OUTSET_MAX_X = 6.9;
      const OUTSET_MIN_Z = 0;
      const OUTSET_MAX_Z = 4.0;

      expect(insetRect(RECT, -WALL_INSET)).toEqual(
        makeRect(OUTSET_MIN_X, OUTSET_MAX_X, OUTSET_MIN_Z, OUTSET_MAX_Z),
      );
    });

    it('returns an equal rectangle for a zero inset', () => {
      expect(insetRect(RECT, 0)).toEqual(RECT);
    });

    it('allows a zero-depth result', () => {
      expect(rectDepth(insetRect(RECT, ZERO_DEPTH_INSET))).toBe(0);
    });

    it('returns a frozen rectangle', () => {
      expect(Object.isFrozen(insetRect(RECT, QUARTER_INSET))).toBe(true);
    });

    it.each([
      ['inverts the rectangle', INVERTING_INSET],
      ['is larger than the rectangle', RECT_WIDTH],
      ['is NaN', Number.NaN],
      ['is infinite', Number.POSITIVE_INFINITY],
      ['is negative infinity', Number.NEGATIVE_INFINITY],
    ])('rejects an inset that %s', (_label, inset) => {
      expect(() => insetRect(RECT, inset)).toThrow(RangeError);
      expect(() => insetRect(RECT, inset)).toThrow('inset');
    });
  });
});
