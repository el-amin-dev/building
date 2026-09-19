import { describe, expect, it } from 'vitest';
import { isOnPlanGrid } from './planGeometry.ts';
import type { PlanRect, RectSide } from './planGeometry.ts';
import { getClearanceRect, getSwingRect } from './swingClearance.ts';
import type { ClearanceFace } from './swingClearance.ts';

/** Digits compared when a measurement is a difference rather than a stored edge. */
const PRECISION_DIGITS = 9;

/** Every face a room has, in the order the module's switch reads them. */
const ALL_SIDES: readonly RectSide[] = ['minZ', 'maxZ', 'minX', 'maxX'];

/**
 * The opening every table below is built on: a 0.90 m leaf, the width of every
 * door on the floor, hung 1.45 m along a face that lies on the 3.20 m line.
 *
 * The numbers are deliberately all different from one another — 1.45, 2.35, 3.20,
 * 4.10, 2.30 — so that a rect with its two axes swapped, or with the inward
 * direction mirrored, cannot come out equal to the right answer by coincidence.
 */
const AT = 3.2;
const SPAN_MIN = 1.45;
const WIDTH = 0.9;

/** A clearance depth that is NOT the leaf width, to keep the two functions apart. */
const DEEPER = 1.2;

/** One row of a hand-derived expectation table. */
interface ExpectedRect {
  /** The face the opening sits in. */
  readonly side: RectSide;
  /** Expected faces of the resulting rectangle, in metres. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Builds the base face on one side. Only `side` ever varies between the rows.
 *
 * @param side - Which face of the room's rect the leaf is hung in.
 * @returns The 0.90 m opening at 1.45 m along the face on the 3.20 m line.
 */
function faceOn(side: RectSide): ClearanceFace {
  return { side, at: AT, spanMin: SPAN_MIN, width: WIDTH };
}

/**
 * The swing rectangle on each of the four faces, worked out by hand.
 *
 * Along the face the rect always runs `spanMin` → `spanMin + width`, that is
 * 1.45 → 2.35, on x for a minZ/maxZ face and on z for a minX/maxX face. Across
 * it, the leaf needs its own width of floor, 0.90 m, measured INTO the room:
 *
 * - `minZ` (a `north` wall in `verify.mjs`): the room is at greater z, so
 *   z 3.20 → 3.20 + 0.90 = 4.10.
 * - `maxZ` (`south`): the room is at smaller z, so z 3.20 − 0.90 = 2.30 → 3.20.
 * - `minX` (`west`): the room is at greater x, so x 3.20 → 4.10.
 * - `maxX` (`east`): the room is at smaller x, so x 2.30 → 3.20.
 */
const EXPECTED_SWINGS: readonly ExpectedRect[] = [
  { side: 'minZ', minX: 1.45, maxX: 2.35, minZ: 3.2, maxZ: 4.1 },
  { side: 'maxZ', minX: 1.45, maxX: 2.35, minZ: 2.3, maxZ: 3.2 },
  { side: 'minX', minX: 3.2, maxX: 4.1, minZ: 1.45, maxZ: 2.35 },
  { side: 'maxX', minX: 2.3, maxX: 3.2, minZ: 1.45, maxZ: 2.35 },
];

/**
 * The same four faces cleared to 1.20 m instead of the 0.90 m leaf width.
 *
 * The span is untouched — depth moves only the face across the opening — so the
 * inward edge goes 3.20 ± 1.20, that is 4.40 inward of a minZ/minX face and 2.00
 * inward of a maxZ/maxX one.
 */
const EXPECTED_CLEARANCES: readonly ExpectedRect[] = [
  { side: 'minZ', minX: 1.45, maxX: 2.35, minZ: 3.2, maxZ: 4.4 },
  { side: 'maxZ', minX: 1.45, maxX: 2.35, minZ: 2.0, maxZ: 3.2 },
  { side: 'minX', minX: 3.2, maxX: 4.4, minZ: 1.45, maxZ: 2.35 },
  { side: 'maxX', minX: 2.0, maxX: 3.2, minZ: 1.45, maxZ: 2.35 },
];

/**
 * The master bedroom ↔ corridor door, transcribed from `PORTS` rather than
 * imported, so this module's test stays free of the plan's model data.
 *
 * The port is `{ kind: 'door', between: ['masterBedroom', 'corridor'], along:
 * 'x', spanMin: 5.65, width: 0.9 }` — a door along x, so it is hung in a
 * minZ/maxZ face of each of its two rooms, and it opens x 5.65 → 6.55. The
 * master bedroom is x 1.60–6.60 × z 0.30–3.70, so the door is in its `maxZ`
 * face at z 3.70 and swings back into the room, z 2.80–3.70. The corridor is
 * x 5.60–20.20 × z 4.00–5.50, so the same door is in its `minZ` face at z 4.00
 * and swings forward into it, z 4.90 at the far edge.
 *
 * The port's own note explains the 5.65: at 5.70 the leaf died on the master
 * bedroom's east wall at x 6.60, so it sits 0.05 short of the corner and its
 * far edge lands at 6.55.
 */
const MASTER_DOOR_SPAN_MIN = 5.65;
const MASTER_DOOR_WIDTH = 0.9;
const MASTER_BEDROOM_FACE: ClearanceFace = {
  side: 'maxZ',
  at: 3.7,
  spanMin: MASTER_DOOR_SPAN_MIN,
  width: MASTER_DOOR_WIDTH,
};
const CORRIDOR_FACE: ClearanceFace = {
  side: 'minZ',
  at: 4.0,
  spanMin: MASTER_DOOR_SPAN_MIN,
  width: MASTER_DOOR_WIDTH,
};

/**
 * Reads a rectangle as a plain object, so a table row compares by value.
 *
 * @param rect - The rectangle to flatten.
 * @returns Its four faces, without the frozen identity.
 */
function faces(rect: PlanRect): Record<string, number> {
  return { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ };
}

describe('door swing clearance', () => {
  describe('the four faces of a room', () => {
    it.each(EXPECTED_SWINGS)(
      'swings a $side leaf into the room over [$minX, $maxX] × [$minZ, $maxZ]',
      ({ side, minX, maxX, minZ, maxZ }) => {
        // Exact equality, not `toBeCloseTo`: every edge is snapped to the
        // centimetre grid, so a hair of float error is a defect, not noise.
        expect(faces(getSwingRect(faceOn(side)))).toEqual({ minX, maxX, minZ, maxZ });
      },
    );

    it.each(EXPECTED_CLEARANCES)(
      'clears a $side face to 1.20 m over [$minX, $maxX] × [$minZ, $maxZ]',
      ({ side, minX, maxX, minZ, maxZ }) => {
        expect(faces(getClearanceRect(faceOn(side), DEEPER))).toEqual({ minX, maxX, minZ, maxZ });
      },
    );

    it.each(ALL_SIDES)('keeps the opening 0.90 m wide along a %s face', (side) => {
      const rect = getSwingRect(faceOn(side));
      const alongX = side === 'minZ' || side === 'maxZ';
      const along = alongX ? rect.maxX - rect.minX : rect.maxZ - rect.minZ;
      const across = alongX ? rect.maxZ - rect.minZ : rect.maxX - rect.minX;

      // `toBeCloseTo` here and exact equality on the edges above, deliberately:
      // the edges are snapped to the grid, but a DIFFERENCE of two grid values is
      // not itself one — 2.35 − 1.45 is 0.9000000000000001.
      expect(along).toBeCloseTo(WIDTH, PRECISION_DIGITS);
      expect(across).toBeCloseTo(WIDTH, PRECISION_DIGITS);
    });
  });

  describe('a swing is a clearance as deep as the leaf is wide', () => {
    it.each(ALL_SIDES)('agrees with getClearanceRect(face, face.width) on a %s face', (side) => {
      const face = faceOn(side);

      expect(faces(getSwingRect(face))).toEqual(faces(getClearanceRect(face, face.width)));
    });
  });

  describe('the master bedroom ↔ corridor door', () => {
    it('swings back into the master bedroom, z 2.80–3.70', () => {
      expect(faces(getSwingRect(MASTER_BEDROOM_FACE))).toEqual({
        minX: 5.65,
        maxX: 6.55,
        minZ: 2.8,
        maxZ: 3.7,
      });
    });

    it('swings forward into the corridor, z 4.00–4.90', () => {
      expect(faces(getSwingRect(CORRIDOR_FACE))).toEqual({
        minX: 5.65,
        maxX: 6.55,
        minZ: 4.0,
        maxZ: 4.9,
      });
    });

    it('stops 0.05 short of the master bedroom east wall at x 6.60', () => {
      // The reason the port reads 5.65 rather than 5.70, in the port's own words.
      expect(getSwingRect(MASTER_BEDROOM_FACE).maxX).toBe(6.55);
      expect(6.6 - getSwingRect(MASTER_BEDROOM_FACE).maxX).toBeCloseTo(0.05, PRECISION_DIGITS);
    });

    it('lands on the grid where raw arithmetic would not', () => {
      // 5.65 + 0.9 is 6.550000000000001 in doubles, and 3.7 - 0.9 is
      // 2.8000000000000003: this door is exactly where the snapping earns itself.
      expect(MASTER_DOOR_SPAN_MIN + MASTER_DOOR_WIDTH).not.toBe(6.55);
      expect(MASTER_BEDROOM_FACE.at - MASTER_DOOR_WIDTH).not.toBe(2.8);
      expect(getSwingRect(MASTER_BEDROOM_FACE).maxX).toBe(6.55);
      expect(getSwingRect(MASTER_BEDROOM_FACE).minZ).toBe(2.8);
    });
  });

  describe('the plan grid and immutability', () => {
    it.each(ALL_SIDES)('freezes the rect it returns for a %s face', (side) => {
      expect(Object.isFrozen(getSwingRect(faceOn(side)))).toBe(true);
      expect(Object.isFrozen(getClearanceRect(faceOn(side), DEEPER))).toBe(true);
    });

    it.each(ALL_SIDES)('puts every edge of a %s face rect on the centimetre grid', (side) => {
      // The awkward door of the floor, whose sums do not land on the grid by
      // themselves, on every side rather than only its own two.
      const face: ClearanceFace = {
        side,
        at: 3.7,
        spanMin: MASTER_DOOR_SPAN_MIN,
        width: MASTER_DOOR_WIDTH,
      };

      [getSwingRect(face), getClearanceRect(face, 1.15)].forEach((rect) => {
        Object.values(faces(rect)).forEach((edge) => {
          expect(isOnPlanGrid(edge)).toBe(true);
        });
      });
    });
  });

  describe('mutation guard', () => {
    it.each(ALL_SIDES)('moves the far edge when the depth is not the width, on %s', (side) => {
      const face = faceOn(side);

      // If the two functions ever collapsed into one, or `depth` were ignored in
      // favour of `face.width`, these would be equal.
      expect(faces(getClearanceRect(face, DEEPER))).not.toEqual(faces(getSwingRect(face)));
    });

    it('leaves the span alone when only the depth changes', () => {
      const face = faceOn('minZ');
      const swing = getSwingRect(face);
      const deeper = getClearanceRect(face, DEEPER);

      expect([deeper.minX, deeper.maxX]).toEqual([swing.minX, swing.maxX]);
      expect(deeper.maxZ).not.toBe(swing.maxZ);
    });

    it('does not simply mirror the inward direction across the two z faces', () => {
      // A `maxZ` face clears backwards and a `minZ` face forwards from the same
      // line, so the two rects share only the face itself.
      const north = getSwingRect(faceOn('minZ'));
      const south = getSwingRect(faceOn('maxZ'));

      expect(north.minZ).toBe(south.maxZ);
      expect(north.maxZ).not.toBe(south.minZ);
    });
  });

  describe('rejections', () => {
    it.each([
      ['a non-finite at', { ...faceOn('minZ'), at: Number.NaN }],
      ['an infinite at', { ...faceOn('minZ'), at: Number.POSITIVE_INFINITY }],
      ['a non-finite spanMin', { ...faceOn('maxX'), spanMin: Number.NaN }],
      ['a non-finite width', { ...faceOn('minX'), width: Number.NaN }],
      ['a zero width', { ...faceOn('maxZ'), width: 0 }],
      ['a negative width', { ...faceOn('minZ'), width: -0.9 }],
    ])('rejects %s', (_label, face: ClearanceFace) => {
      expect(() => getSwingRect(face)).toThrow(RangeError);
      expect(() => getClearanceRect(face, 1)).toThrow(RangeError);
    });

    it.each([[0], [-1.2], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'rejects a clearance depth of %p',
      (depth) => {
        expect(() => getClearanceRect(faceOn('minZ'), depth)).toThrow(RangeError);
      },
    );
  });
});
