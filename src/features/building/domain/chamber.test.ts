import { describe, expect, it } from 'vitest';
import {
  BASE_CHAMBER_SPEC,
  getChamberWalls,
  getClearRect,
  getOuterRect,
  getWalkableBounds,
  validateChamberSpec,
} from './chamber.ts';
import type { ChamberSpec } from './chamber.ts';
import type { PlanRect } from './planGeometry.ts';

const CLEAR_WIDTH = 5.0;
const CLEAR_DEPTH = 3.4;
const WALL_THICKNESS = 0.2;
const OUTER_WIDTH = 5.4;
const OUTER_DEPTH = 3.8;
const WALL_COUNT = 4;
const BODY_RADIUS = 0.25;
const PRECISION_DIGITS = 9;
const NEGATIVE_VALUE = -1;
const ALTERED_WIDTH = 9;
const HALF = 0.5;

const SPEC_FIELDS = ['clearWidth', 'clearDepth', 'wallThickness'] as const;
const INVALID_VALUES = [0, NEGATIVE_VALUE, Number.NaN, Number.POSITIVE_INFINITY] as const;
const INVALID_CASES = SPEC_FIELDS.flatMap((field) =>
  INVALID_VALUES.map((value) => ({ field, value })),
);

/**
 * Returns the width of a rectangle along x.
 *
 * @param rect - The rectangle to measure.
 * @returns `maxX - minX`.
 */
function widthOf(rect: PlanRect): number {
  return rect.maxX - rect.minX;
}

/**
 * Returns the depth of a rectangle along z.
 *
 * @param rect - The rectangle to measure.
 * @returns `maxZ - minZ`.
 */
function depthOf(rect: PlanRect): number {
  return rect.maxZ - rect.minZ;
}

/**
 * Returns the area of a rectangle.
 *
 * @param rect - The rectangle to measure.
 * @returns Width times depth.
 */
function areaOf(rect: PlanRect): number {
  return widthOf(rect) * depthOf(rect);
}

/**
 * Returns the area of the intersection of two rectangles.
 *
 * @param a - First rectangle.
 * @param b - Second rectangle.
 * @returns The overlap area, or `0` when they only touch or are disjoint.
 */
function intersectionArea(a: PlanRect, b: PlanRect): number {
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return Math.max(0, overlapX) * Math.max(0, overlapZ);
}

/**
 * Returns the bounding box of a list of rectangles.
 *
 * @param rects - The rectangles to enclose.
 * @returns The smallest rectangle containing all of them.
 */
function boundsOf(rects: readonly PlanRect[]): PlanRect {
  return {
    minX: Math.min(...rects.map((rect) => rect.minX)),
    maxX: Math.max(...rects.map((rect) => rect.maxX)),
    minZ: Math.min(...rects.map((rect) => rect.minZ)),
    maxZ: Math.max(...rects.map((rect) => rect.maxZ)),
  };
}

describe('chamber', () => {
  describe('BASE_CHAMBER_SPEC', () => {
    it('describes the 5.00 × 3.40 m bedroom base with 0.20 m walls', () => {
      expect(BASE_CHAMBER_SPEC).toEqual({
        clearWidth: CLEAR_WIDTH,
        clearDepth: CLEAR_DEPTH,
        wallThickness: WALL_THICKNESS,
      });
    });

    it('is frozen', () => {
      const mutable = BASE_CHAMBER_SPEC as { clearWidth: number };

      expect(Object.isFrozen(BASE_CHAMBER_SPEC)).toBe(true);
      expect(() => {
        mutable.clearWidth = ALTERED_WIDTH;
      }).toThrow(TypeError);
      expect(BASE_CHAMBER_SPEC.clearWidth).toBe(CLEAR_WIDTH);
    });
  });

  describe('validateChamberSpec', () => {
    it.each(INVALID_CASES)('rejects $field = $value', ({ field, value }) => {
      const spec: ChamberSpec = { ...BASE_CHAMBER_SPEC, [field]: value };

      expect(() => validateChamberSpec(spec)).toThrow(RangeError);
      expect(() => validateChamberSpec(spec)).toThrow(field);
    });

    it('returns a valid spec unchanged', () => {
      expect(validateChamberSpec(BASE_CHAMBER_SPEC)).toBe(BASE_CHAMBER_SPEC);
    });

    it.each([getClearRect, getOuterRect, getChamberWalls])('is applied by %o', (fn) => {
      const spec: ChamberSpec = { ...BASE_CHAMBER_SPEC, clearDepth: 0 };

      expect(() => fn(spec)).toThrow(RangeError);
    });
  });

  describe('getClearRect', () => {
    it('is centred on the origin and sized 5.00 × 3.40 m', () => {
      const clear = getClearRect(BASE_CHAMBER_SPEC);

      expect(clear.minX + clear.maxX).toBeCloseTo(0, PRECISION_DIGITS);
      expect(clear.minZ + clear.maxZ).toBeCloseTo(0, PRECISION_DIGITS);
      expect(widthOf(clear)).toBeCloseTo(CLEAR_WIDTH, PRECISION_DIGITS);
      expect(depthOf(clear)).toBeCloseTo(CLEAR_DEPTH, PRECISION_DIGITS);
    });
  });

  describe('getOuterRect', () => {
    const outer = getOuterRect(BASE_CHAMBER_SPEC);

    it('is centred on the origin and sized 5.40 × 3.80 m', () => {
      expect(outer.minX + outer.maxX).toBeCloseTo(0, PRECISION_DIGITS);
      expect(outer.minZ + outer.maxZ).toBeCloseTo(0, PRECISION_DIGITS);
      expect(widthOf(outer)).toBeCloseTo(OUTER_WIDTH, PRECISION_DIGITS);
      expect(depthOf(outer)).toBeCloseTo(OUTER_DEPTH, PRECISION_DIGITS);
    });

    it('grows the clear rectangle by the wall thickness on every side', () => {
      const clear = getClearRect(BASE_CHAMBER_SPEC);

      expect(outer.minX).toBeCloseTo(clear.minX - WALL_THICKNESS, PRECISION_DIGITS);
      expect(outer.maxX).toBeCloseTo(clear.maxX + WALL_THICKNESS, PRECISION_DIGITS);
      expect(outer.minZ).toBeCloseTo(clear.minZ - WALL_THICKNESS, PRECISION_DIGITS);
      expect(outer.maxZ).toBeCloseTo(clear.maxZ + WALL_THICKNESS, PRECISION_DIGITS);
    });

    it('equals the bounding box of the walls', () => {
      const envelope = boundsOf(getChamberWalls(BASE_CHAMBER_SPEC));

      expect(outer.minX).toBeCloseTo(envelope.minX, PRECISION_DIGITS);
      expect(outer.maxX).toBeCloseTo(envelope.maxX, PRECISION_DIGITS);
      expect(outer.minZ).toBeCloseTo(envelope.minZ, PRECISION_DIGITS);
      expect(outer.maxZ).toBeCloseTo(envelope.maxZ, PRECISION_DIGITS);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(outer)).toBe(true);
    });

    it('rejects an invalid spec', () => {
      const spec: ChamberSpec = { ...BASE_CHAMBER_SPEC, wallThickness: NEGATIVE_VALUE };

      expect(() => getOuterRect(spec)).toThrow(RangeError);
      expect(() => getOuterRect(spec)).toThrow('wallThickness');
    });
  });

  describe('getChamberWalls', () => {
    const clear = getClearRect(BASE_CHAMBER_SPEC);
    const walls = getChamberWalls(BASE_CHAMBER_SPEC);
    const [southWall, northWall, westWall, eastWall] = walls;

    it('returns four walls', () => {
      expect(walls).toHaveLength(WALL_COUNT);
    });

    it('gives every wall the wall thickness in its thin axis', () => {
      expect(depthOf(southWall)).toBeCloseTo(WALL_THICKNESS, PRECISION_DIGITS);
      expect(depthOf(northWall)).toBeCloseTo(WALL_THICKNESS, PRECISION_DIGITS);
      expect(widthOf(westWall)).toBeCloseTo(WALL_THICKNESS, PRECISION_DIGITS);
      expect(widthOf(eastWall)).toBeCloseTo(WALL_THICKNESS, PRECISION_DIGITS);
    });

    it('never overlaps two walls', () => {
      walls.forEach((wall, index) => {
        walls.slice(index + 1).forEach((other) => {
          expect(intersectionArea(wall, other)).toBeCloseTo(0, PRECISION_DIGITS);
        });
      });
    });

    it('places every inner edge on the clear rectangle boundary', () => {
      expect(southWall.maxZ).toBeCloseTo(clear.minZ, PRECISION_DIGITS);
      expect(northWall.minZ).toBeCloseTo(clear.maxZ, PRECISION_DIGITS);
      expect(westWall.maxX).toBeCloseTo(clear.minX, PRECISION_DIGITS);
      expect(eastWall.minX).toBeCloseTo(clear.maxX, PRECISION_DIGITS);
    });

    it('keeps every wall outside the clear rectangle', () => {
      walls.forEach((wall) => {
        expect(intersectionArea(wall, clear)).toBeCloseTo(0, PRECISION_DIGITS);
      });
    });

    it('spans an outer envelope of 5.40 × 3.80 m', () => {
      const envelope = boundsOf(walls);

      expect(widthOf(envelope)).toBeCloseTo(OUTER_WIDTH, PRECISION_DIGITS);
      expect(depthOf(envelope)).toBeCloseTo(OUTER_DEPTH, PRECISION_DIGITS);
    });

    it('closes the corners with the walls along x', () => {
      const envelope = boundsOf(walls);

      [southWall, northWall].forEach((wall) => {
        expect(wall.minX).toBeCloseTo(envelope.minX, PRECISION_DIGITS);
        expect(wall.maxX).toBeCloseTo(envelope.maxX, PRECISION_DIGITS);
      });
      [westWall, eastWall].forEach((wall) => {
        expect(depthOf(wall)).toBeCloseTo(CLEAR_DEPTH, PRECISION_DIGITS);
      });
    });

    it('covers exactly the outer area minus the clear area', () => {
      const totalWallArea = walls.reduce((sum, wall) => sum + areaOf(wall), 0);

      expect(totalWallArea).toBeCloseTo(
        OUTER_WIDTH * OUTER_DEPTH - CLEAR_WIDTH * CLEAR_DEPTH,
        PRECISION_DIGITS,
      );
    });
  });

  describe('getWalkableBounds', () => {
    const clear = getClearRect(BASE_CHAMBER_SPEC);
    const halfSmallerDimension = Math.min(CLEAR_WIDTH, CLEAR_DEPTH) * HALF;

    it('shrinks the clear rectangle by the body radius on every side', () => {
      const walkable = getWalkableBounds(BASE_CHAMBER_SPEC, BODY_RADIUS);

      expect(walkable.minX).toBeCloseTo(clear.minX + BODY_RADIUS, PRECISION_DIGITS);
      expect(walkable.maxX).toBeCloseTo(clear.maxX - BODY_RADIUS, PRECISION_DIGITS);
      expect(walkable.minZ).toBeCloseTo(clear.minZ + BODY_RADIUS, PRECISION_DIGITS);
      expect(walkable.maxZ).toBeCloseTo(clear.maxZ - BODY_RADIUS, PRECISION_DIGITS);
    });

    it('equals the clear rectangle for a zero radius', () => {
      expect(getWalkableBounds(BASE_CHAMBER_SPEC, 0)).toEqual(clear);
    });

    it.each([
      ['half the smaller dimension', halfSmallerDimension],
      ['larger than the chamber', CLEAR_WIDTH],
      ['negative', NEGATIVE_VALUE],
      ['NaN', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
    ])('rejects a radius that is %s', (_label, radius) => {
      expect(() => getWalkableBounds(BASE_CHAMBER_SPEC, radius)).toThrow(RangeError);
    });

    it('rejects an invalid spec', () => {
      const spec: ChamberSpec = { ...BASE_CHAMBER_SPEC, wallThickness: Number.NaN };

      expect(() => getWalkableBounds(spec, BODY_RADIUS)).toThrow(RangeError);
    });
  });
});
