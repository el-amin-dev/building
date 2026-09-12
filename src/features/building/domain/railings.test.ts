import { describe, expect, it } from 'vitest';
import {
  FLOOR_PLAN,
  getJoinThickness,
  getNeighbours,
  getSpace,
  hasFloor,
} from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { LENGTH_TOLERANCE, rectDepth, rectWidth } from './planGeometry.ts';
import { RAILING_THICKNESS, getRailings } from './railings.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;

/** Every open edge of the side-B strip, and nothing else (brief §5.2). */
const EXPECTED_RAILING_COUNT = 3;

/** Height of the handrail of the typical floor, in metres. */
const REAL_RAILING_TOP = 1.1;

/** The zero-wall join of the circulation, which must never become a railing (brief §4.2). */
const FLOORED_ZERO_GAP_PAIR: readonly [SpaceId, SpaceId] = ['stairs', 'corridor'];

/** A room separated from the void by a 0.30 m weather-facing wall: no fall edge. */
const WALLED_VOID_PAIR: readonly [SpaceId, SpaceId] = ['kitchen', 'voidWest'];

/** One railing of the typical floor, measured by hand from the clear rects of the plan. */
interface ExpectedRailing {
  /** The void the railing protects against. */
  readonly voidId: SpaceId;
  /** The walkable space the railing stands on. */
  readonly flooredId: SpaceId;
  /** Expected faces of the railing footprint, in metres. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * The three fall edges of the side-B strip, measured off the clear rects of the
 * redrawn floor. The strip runs west to east over z 8.90–9.70 as ccBalcony
 * 4.10–4.90 · voidWest 4.90–11.65 · balconySlabB 11.65–15.35 · voidEast
 * 15.35–20.30 · utilityRoom, and three of those four joins are zero-wall
 * overrides, so each railing is the 0.05 m strip centred on the shared edge
 * (±0.025) over the full 0.80 m depth of the strip.
 *
 * The order is the derivation's: `plan.spaces` order, then contact order. voidWest
 * comes before voidEast, so the control-center balcony's rail is index 0 — it is
 * new, and correct, because that balcony is a 0.80 × 0.80 walkable slab abutting
 * the void through a zero-wall override.
 *
 * The fourth join, voidEast ↔ utilityRoom, keeps its drawn 0.20 m wall and is
 * therefore absent. So is the side-A balcony's balustrade: that is a stated 1.10 m
 * `PARAPET_WALLS` entry rather than a railing, and `getRailings` walks `void`
 * spaces only, so an `openAir` balcony cannot pick up a second one.
 */
const EXPECTED_RAILINGS: readonly ExpectedRailing[] = [
  {
    voidId: 'voidWest',
    flooredId: 'ccBalcony',
    minX: 4.875,
    maxX: 4.925,
    minZ: 8.9,
    maxZ: 9.7,
  },
  {
    voidId: 'voidWest',
    flooredId: 'balconySlabB',
    minX: 11.625,
    maxX: 11.675,
    minZ: 8.9,
    maxZ: 9.7,
  },
  {
    voidId: 'voidEast',
    flooredId: 'balconySlabB',
    minX: 15.325,
    maxX: 15.375,
    minZ: 8.9,
    maxZ: 9.7,
  },
];

/** A floor with a taller handrail, to prove the height is not hard-coded. */
const TALL_HEIGHTS: FloorHeights = Object.freeze({ ...FLOOR_HEIGHTS, railing: 1.35 });

/**
 * Counts every join of the plan with no wall, whichever the kinds of its spaces.
 *
 * The naive rule the derivation must not use: it also catches stairs ↔ corridor,
 * so its count differs from the number of railings.
 *
 * @param plan - The floor plan to scan.
 * @returns The number of distinct space pairs whose contact gap is zero.
 */
function countZeroGapJoins(plan: FloorPlan): number {
  const pairs = new Set(
    plan.spaces.flatMap((space) =>
      getNeighbours(plan, space.id)
        .filter((contact) => contact.gap <= LENGTH_TOLERANCE)
        .map((contact) => [space.id, contact.neighbourId].sort().join(' ↔ ')),
    ),
  );
  return pairs.size;
}

/**
 * Builds a copy of the plan with one space given another kind.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param id - Identifier of the space to change.
 * @param kind - The kind to give it.
 * @returns A new plan whose named space has the given kind.
 */
function withSpaceKind(plan: FloorPlan, id: SpaceId, kind: 'openAir' | 'void'): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) => (space.id === id ? { ...space, kind } : space)),
  };
}

const RAILINGS = getRailings(FLOOR_PLAN);

describe('void railings', () => {
  describe('the fall edges of the typical floor', () => {
    it('guards exactly the three open edges of the side-B strip', () => {
      expect(RAILINGS).toHaveLength(EXPECTED_RAILING_COUNT);
      expect(RAILINGS.map((railing) => [...railing.spaces])).toEqual(
        EXPECTED_RAILINGS.map((expected) => [expected.voidId, expected.flooredId]),
      );
    });

    it.each(EXPECTED_RAILINGS.map((expected, index) => ({ ...expected, index })))(
      'rails $voidId ↔ $flooredId at index $index',
      ({ index, voidId, flooredId, minX, maxX, minZ, maxZ }) => {
        const railing = RAILINGS[index];

        expect(railing.spaces).toEqual([voidId, flooredId]);
        expect(railing.rect.minX).toBeCloseTo(minX, PRECISION_DIGITS);
        expect(railing.rect.maxX).toBeCloseTo(maxX, PRECISION_DIGITS);
        expect(railing.rect.minZ).toBeCloseTo(minZ, PRECISION_DIGITS);
        expect(railing.rect.maxZ).toBeCloseTo(maxZ, PRECISION_DIGITS);
        expect(railing.top).toBeCloseTo(REAL_RAILING_TOP, PRECISION_DIGITS);
      },
    );

    it.each(RAILINGS.map((railing, index) => ({ index, railing })))(
      'straddles the shared edge symmetrically at railing $index',
      ({ railing }) => {
        const [voidId, flooredId] = railing.spaces;
        const voidRect = getSpace(FLOOR_PLAN, voidId).rects[0];
        const flooredRect = getSpace(FLOOR_PLAN, flooredId).rects[0];
        const sharedEdgeX =
          Math.abs(voidRect.maxX - flooredRect.minX) <= LENGTH_TOLERANCE
            ? voidRect.maxX
            : voidRect.minX;

        expect(rectWidth(railing.rect)).toBeCloseTo(RAILING_THICKNESS, PRECISION_DIGITS);
        expect((railing.rect.minX + railing.rect.maxX) * HALF).toBeCloseTo(
          sharedEdgeX,
          PRECISION_DIGITS,
        );
        expect(rectDepth(railing.rect)).toBeCloseTo(
          flooredRect.maxZ - flooredRect.minZ,
          PRECISION_DIGITS,
        );
      },
    );

    it('keeps the railing thickness thinner than any wall', () => {
      expect(RAILING_THICKNESS).toBeGreaterThan(0);
      expect(RAILING_THICKNESS).toBeLessThan(
        getJoinThickness(
          FLOOR_PLAN,
          getSpace(FLOOR_PLAN, 'kitchen'),
          getSpace(FLOOR_PLAN, 'voidWest'),
        ),
      );
    });
  });

  describe('joins that are not fall edges', () => {
    it('ignores the zero-wall stairs ↔ corridor join: both sides have a floor', () => {
      const [first, second] = FLOORED_ZERO_GAP_PAIR;
      const thickness = getJoinThickness(
        FLOOR_PLAN,
        getSpace(FLOOR_PLAN, first),
        getSpace(FLOOR_PLAN, second),
      );

      expect(thickness).toBeCloseTo(0, PRECISION_DIGITS);
      expect(hasFloor(getSpace(FLOOR_PLAN, first).kind)).toBe(true);
      expect(hasFloor(getSpace(FLOOR_PLAN, second).kind)).toBe(true);
      RAILINGS.forEach((railing) => {
        expect(railing.spaces).not.toContain(first);
        expect(railing.spaces).not.toContain(second);
      });
    });

    it('ignores a void edge that already has a wall in front of it', () => {
      const [roomId, voidId] = WALLED_VOID_PAIR;
      const contacts = getNeighbours(FLOOR_PLAN, roomId).filter(
        (contact) => contact.neighbourId === voidId,
      );

      expect(contacts.length).toBeGreaterThan(0);
      contacts.forEach((contact) => {
        expect(contact.gap).toBeGreaterThan(LENGTH_TOLERANCE);
      });
      RAILINGS.forEach((railing) => {
        expect(railing.spaces).not.toContain(roomId);
      });
    });

    it('rails only pairs with exactly one void side', () => {
      RAILINGS.forEach((railing) => {
        const [voidId, flooredId] = railing.spaces;

        expect(hasFloor(getSpace(FLOOR_PLAN, voidId).kind)).toBe(false);
        expect(hasFloor(getSpace(FLOOR_PLAN, flooredId).kind)).toBe(true);
      });
    });
  });

  describe('height', () => {
    it('takes the handrail height of the floor', () => {
      RAILINGS.forEach((railing) => {
        expect(railing.top).toBeCloseTo(FLOOR_HEIGHTS.railing, PRECISION_DIGITS);
      });
    });

    it('follows an injected handrail height', () => {
      const tall = getRailings(FLOOR_PLAN, TALL_HEIGHTS);

      expect(tall).toHaveLength(EXPECTED_RAILING_COUNT);
      tall.forEach((railing) => {
        expect(railing.top).toBeCloseTo(TALL_HEIGHTS.railing, PRECISION_DIGITS);
      });
      expect(tall.map((railing) => railing.top)).not.toContain(REAL_RAILING_TOP);
    });

    it.each([[0], [-1.1], [Number.NaN]])('rejects a handrail height of %p', (railing) => {
      expect(() => getRailings(FLOOR_PLAN, { ...FLOOR_HEIGHTS, railing })).toThrow(RangeError);
    });
  });

  describe('immutability', () => {
    it('freezes the list, every railing, its rect and its space pair', () => {
      expect(Object.isFrozen(RAILINGS)).toBe(true);
      RAILINGS.forEach((railing) => {
        expect(Object.isFrozen(railing)).toBe(true);
        expect(Object.isFrozen(railing.rect)).toBe(true);
        expect(Object.isFrozen(railing.spaces)).toBe(true);
      });
    });
  });

  describe('mutation guard', () => {
    it('differs from the naive rule that rails every zero-wall join', () => {
      expect(countZeroGapJoins(FLOOR_PLAN)).toBeGreaterThan(EXPECTED_RAILING_COUNT);
    });

    it('drops both railings of the west void when it gains a floor', () => {
      const paved = withSpaceKind(FLOOR_PLAN, 'voidWest', 'openAir');
      const railings = getRailings(paved);

      // Two of the three rails are the west void's — to the control-center
      // balcony and to the slab — so paving it leaves only the east one. Spelled
      // out rather than as EXPECTED_RAILING_COUNT − 1, which was the same number
      // by coincidence while the plan had two railings and stopped being so.
      expect(railings.map((railing) => [...railing.spaces])).toEqual([
        ['voidEast', 'balconySlabB'],
      ]);
    });

    it('drops the slab railings when the slab itself becomes a void, keeping the balcony rail', () => {
      const holed = withSpaceKind(FLOOR_PLAN, 'balconySlabB', 'void');
      const railings = getRailings(holed);

      // A void↔void contact has no floored side, so both of the slab's rails go.
      // The control-center balcony is still a floor beside the west void, so its
      // rail must survive: the old name said "both" and expected none, which was
      // true of a two-railing floor and would now hide a rail going missing.
      expect(railings.map((railing) => [...railing.spaces])).toEqual([['voidWest', 'ccBalcony']]);
    });
  });
});
