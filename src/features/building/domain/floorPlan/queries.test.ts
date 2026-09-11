import { describe, expect, it } from 'vitest';
import { makeRect } from '../planGeometry.ts';
import type { PlanPoint, PlanRect } from '../planGeometry.ts';
import { FLOOR_PLAN } from './floorPlanData.ts';
import {
  findSpaceAt,
  getNeighbours,
  getSpace,
  getSpaceArea,
  getSpaceBounds,
  hasFloor,
} from './queries.ts';
import type { FloorPlan, Space, SpaceContact, SpaceId, SpaceKind } from './types.ts';

const HALF = 0.5;
const PRECISION_DIGITS = 9;
const PLOT = makeRect(0, 15, 0, 8);
const INTERIOR = makeRect(0.3, 14.7, 0.3, 7.7);

/** Centre space, surrounded by the neighbours below. */
const CENTRE_RECT = makeRect(3.9, 6.4, 2.1, 4.7);
/** At −x, 0.20 m away (3.90 − 3.70). */
const WEST_RECT = makeRect(1.0, 3.7, 1.5, 3.3);
/** At +x, 0.30 m away. */
const EAST_RECT = makeRect(6.7, 9.0, 3.2, 6.0);
/** At −z, touching (0.00 m). */
const SOUTH_RECT = makeRect(4.5, 8.0, 0.5, 2.1);
/** At +z, 0.25 m away. */
const NORTH_RECT = makeRect(3.0, 5.1, 4.95, 7.0);
/** At +x, 0.35 m away: beyond the thickest wall. */
const TOO_FAR_EAST_RECT = makeRect(6.75, 9.0, 3.2, 6.0);
/** Touches the centre only at its (maxX, maxZ) corner. */
const CORNER_RECT = makeRect(6.4, 9.0, 4.7, 6.0);
/** First rect of an L wrapping the centre's +x/+z corner: faces the centre at +z. */
const WRAP_NORTH_RECT = makeRect(5.0, 8.0, 4.9, 6.0);
/** Second rect of that L: faces the centre at +x. */
const WRAP_EAST_RECT = makeRect(6.6, 8.0, 3.0, 4.9);
/** Lower rect of an L-shaped space, 4.00 × 2.00 m. */
const L_LOWER_RECT = makeRect(10.0, 14.0, 1.0, 3.0);
/** Upper rect of the L, 2.00 × 3.00 m, sharing the edge z = 3.00 with the lower one. */
const L_UPPER_RECT = makeRect(10.0, 12.0, 3.0, 6.0);
const L_AREA = 14;
const L_BOUNDS = makeRect(10.0, 14.0, 1.0, 6.0);

const WEST_GAP = 0.2;
const EAST_GAP = 0.3;
const SOUTH_GAP = 0;
const NORTH_GAP = 0.25;
const WRAP_GAP = 0.2;
const OPEN_SOUTH_FACE_X = 4.2;
const WEST_WALL_POINT: PlanPoint = { x: 3.8, z: 2.5 };
const NEGATIVE_COORDINATE = -1;
const FAR_COORDINATE = 30;
const ALTERED_GAP = 99;

/** Probe points on FLOOR_PLAN. */
const BALCONY_B_EAST_POINT: PlanPoint = { x: 15.0, z: 9.2 };
const BALCONY_B_WEST_POINT: PlanPoint = { x: 12.7, z: 9.2 };
const CORRIDOR_WEST_EDGE_POINT: PlanPoint = { x: 5.3, z: 4.65 };
const STAIRS_EAST_EDGE_POINT: PlanPoint = { x: 5.29, z: 4.65 };
const WALL_POINT: PlanPoint = { x: 6.7, z: 2.0 };
const SANITAIR_WALL_POINT: PlanPoint = { x: 9.0, z: 7.0 };
const GUEST_ROOM_POINT: PlanPoint = { x: 9.0, z: 6.8 };

/**
 * Builds a frozen space whose name is its id.
 *
 * @param id - Identifier of the space.
 * @param kind - Kind of the space.
 * @param rects - Clear rects of the space.
 * @returns A frozen {@link Space}.
 */
function makeSpace(id: SpaceId, kind: SpaceKind, rects: readonly PlanRect[]): Space {
  return Object.freeze({ id, name: id, kind, rects: Object.freeze([...rects]) });
}

/**
 * Builds a frozen plan on the test plot, without join overrides.
 *
 * @param spaces - Spaces of the plan, in order.
 * @returns A frozen {@link FloorPlan}.
 */
function makePlan(spaces: readonly Space[]): FloorPlan {
  return Object.freeze({
    plot: PLOT,
    interior: INTERIOR,
    spaces: Object.freeze([...spaces]),
    joinOverrides: Object.freeze([]),
  });
}

/**
 * Returns the centre point of a rectangle.
 *
 * @param rect - The rectangle.
 * @returns The point halfway along both axes.
 */
function centreOf(rect: PlanRect): PlanPoint {
  return { x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF };
}

const CENTRE = makeSpace('livingRoom', 'room', [CENTRE_RECT]);
const WEST = makeSpace('masterBedroom', 'room', [WEST_RECT]);
const EAST = makeSpace('kitchen', 'room', [EAST_RECT]);
const SOUTH = makeSpace('corridor', 'circulation', [SOUTH_RECT]);
const NORTH = makeSpace('guestRoom', 'room', [NORTH_RECT]);
const VOID = makeSpace('voidEast', 'void', [EAST_RECT]);
const L_SPACE = makeSpace('utilityRoom', 'room', [L_LOWER_RECT, L_UPPER_RECT]);
const CENTRE_MID = centreOf(CENTRE_RECT);

describe('floorPlan queries', () => {
  describe('getSpace', () => {
    const plan = makePlan([CENTRE, WEST]);

    it('returns the stored space by reference', () => {
      expect(getSpace(plan, 'masterBedroom')).toBe(WEST);
    });

    it('throws a RangeError naming an absent id', () => {
      expect(() => getSpace(plan, 'laundry')).toThrow(RangeError);
      expect(() => getSpace(plan, 'laundry')).toThrow('laundry');
    });
  });

  describe('getSpaceArea', () => {
    it('sums the areas of the rects of an L-shaped space', () => {
      expect(getSpaceArea(L_SPACE)).toBeCloseTo(L_AREA, PRECISION_DIGITS);
    });
  });

  describe('getSpaceBounds', () => {
    it('encloses every rect of an L-shaped space', () => {
      expect(getSpaceBounds(L_SPACE)).toEqual(L_BOUNDS);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(getSpaceBounds(L_SPACE))).toBe(true);
    });

    it('throws a RangeError for a space without rects', () => {
      const empty = makeSpace('laundry', 'room', []);

      expect(() => getSpaceBounds(empty)).toThrow(RangeError);
      expect(() => getSpaceBounds(empty)).toThrow('laundry');
    });
  });

  describe('hasFloor', () => {
    it.each([
      ['room', true],
      ['circulation', true],
      ['openAir', true],
      ['void', false],
    ] as const)('returns %s → %s', (kind, expected) => {
      expect(hasFloor(kind)).toBe(expected);
    });
  });

  describe('findSpaceAt', () => {
    const spaces = [CENTRE, WEST, SOUTH, VOID, L_SPACE];
    const plan = makePlan(spaces);
    const reversedPlan = makePlan([...spaces].reverse());

    const PROBES: readonly (readonly [string, PlanPoint, SpaceId | undefined])[] = [
      ['an interior point', CENTRE_MID, 'livingRoom'],
      ['a point on the minX face', { x: CENTRE_RECT.minX, z: CENTRE_MID.z }, 'livingRoom'],
      ['a point on the maxX face', { x: CENTRE_RECT.maxX, z: CENTRE_MID.z }, undefined],
      ['a point on the minZ face', { x: OPEN_SOUTH_FACE_X, z: CENTRE_RECT.minZ }, 'livingRoom'],
      ['a point on the maxZ face', { x: CENTRE_MID.x, z: CENTRE_RECT.maxZ }, undefined],
      ['a point in a wall gap', WEST_WALL_POINT, undefined],
      ['a point at negative x', { x: NEGATIVE_COORDINATE, z: CENTRE_MID.z }, undefined],
      ['a point at negative z', { x: CENTRE_MID.x, z: NEGATIVE_COORDINATE }, undefined],
      ['a point beyond the plot on x', { x: FAR_COORDINATE, z: CENTRE_MID.z }, undefined],
      ['a point beyond the plot on z', { x: CENTRE_MID.x, z: FAR_COORDINATE }, undefined],
      ['a void point', centreOf(EAST_RECT), 'voidEast'],
      [
        'a point on the edge shared by two rects of the same space',
        { x: centreOf(L_UPPER_RECT).x, z: L_LOWER_RECT.maxZ },
        'utilityRoom',
      ],
      [
        'a point on a zero-gap join (the + side wins)',
        { x: CENTRE_MID.x, z: SOUTH_RECT.maxZ },
        'livingRoom',
      ],
    ];

    it.each(PROBES)('resolves %s', (_label, point, expectedId) => {
      expect(findSpaceAt(plan, point)?.id).toBe(expectedId);
    });

    it.each(PROBES)('resolves %s the same with the spaces reversed', (_label, point) => {
      expect(findSpaceAt(reversedPlan, point)).toBe(findSpaceAt(plan, point));
    });

    it('returns the stored space by reference', () => {
      expect(findSpaceAt(plan, CENTRE_MID)).toBe(CENTRE);
    });

    it.each([
      ['x is NaN', { x: Number.NaN, z: CENTRE_MID.z }],
      ['z is NaN', { x: CENTRE_MID.x, z: Number.NaN }],
      ['x is Infinity', { x: Number.POSITIVE_INFINITY, z: CENTRE_MID.z }],
      ['z is -Infinity', { x: CENTRE_MID.x, z: Number.NEGATIVE_INFINITY }],
    ])('throws a RangeError when %s', (_label, point) => {
      expect(() => findSpaceAt(plan, point)).toThrow(RangeError);
    });
  });

  describe('getNeighbours', () => {
    describe('sign guard on a centre surrounded at different gaps', () => {
      const plan = makePlan([CENTRE, NORTH, EAST, WEST, SOUTH]);
      const contacts = getNeighbours(plan, 'livingRoom');

      it('reports side, gap and span of each neighbour, in plan.spaces order', () => {
        const expected: readonly SpaceContact[] = [
          {
            neighbourId: 'guestRoom',
            side: 'maxZ',
            rectIndex: 0,
            neighbourRectIndex: 0,
            gap: NORTH_GAP,
            spanMin: CENTRE_RECT.minX,
            spanMax: NORTH_RECT.maxX,
          },
          {
            neighbourId: 'kitchen',
            side: 'maxX',
            rectIndex: 0,
            neighbourRectIndex: 0,
            gap: EAST_GAP,
            spanMin: EAST_RECT.minZ,
            spanMax: CENTRE_RECT.maxZ,
          },
          {
            neighbourId: 'masterBedroom',
            side: 'minX',
            rectIndex: 0,
            neighbourRectIndex: 0,
            gap: WEST_GAP,
            spanMin: CENTRE_RECT.minZ,
            spanMax: WEST_RECT.maxZ,
          },
          {
            neighbourId: 'corridor',
            side: 'minZ',
            rectIndex: 0,
            neighbourRectIndex: 0,
            gap: SOUTH_GAP,
            spanMin: SOUTH_RECT.minX,
            spanMax: CENTRE_RECT.maxX,
          },
        ];

        expect(contacts).toEqual(expected);
      });

      it('rounds the gap onto the plan grid', () => {
        const west = contacts.find((contact) => contact.neighbourId === 'masterBedroom');

        expect(CENTRE_RECT.minX - WEST_RECT.maxX).not.toBe(WEST_GAP);
        expect(west?.gap).toBe(WEST_GAP);
      });

      it('freezes the result and every contact', () => {
        expect(Object.isFrozen(contacts)).toBe(true);
        contacts.forEach((contact) => {
          expect(Object.isFrozen(contact)).toBe(true);
        });
        expect(() => {
          (contacts[0] as { gap: number }).gap = ALTERED_GAP;
        }).toThrow(TypeError);
      });

      it('sees the centre from a neighbour on the opposite side', () => {
        expect(getNeighbours(plan, 'masterBedroom')).toEqual([
          {
            neighbourId: 'livingRoom',
            side: 'maxX',
            rectIndex: 0,
            neighbourRectIndex: 0,
            gap: WEST_GAP,
            spanMin: CENTRE_RECT.minZ,
            spanMax: WEST_RECT.maxZ,
          },
        ]);
      });
    });

    it('excludes a neighbour 0.35 m away', () => {
      const tooFar = makeSpace('kitchen', 'room', [TOO_FAR_EAST_RECT]);

      expect(getNeighbours(makePlan([CENTRE, tooFar]), 'livingRoom')).toEqual([]);
    });

    it('excludes a corner-only touch', () => {
      const corner = makeSpace('kitchen', 'room', [CORNER_RECT]);

      expect(getNeighbours(makePlan([CENTRE, corner]), 'livingRoom')).toEqual([]);
    });

    describe('with a two-rect neighbour', () => {
      const wrap = makeSpace('utilityRoom', 'room', [WRAP_NORTH_RECT, WRAP_EAST_RECT]);
      const plan = makePlan([CENTRE, wrap]);

      it('gives one contact per rect, ordered by neighbourRectIndex', () => {
        expect(getNeighbours(plan, 'livingRoom')).toEqual([
          {
            neighbourId: 'utilityRoom',
            side: 'maxZ',
            rectIndex: 0,
            neighbourRectIndex: 0,
            gap: WRAP_GAP,
            spanMin: WRAP_NORTH_RECT.minX,
            spanMax: CENTRE_RECT.maxX,
          },
          {
            neighbourId: 'utilityRoom',
            side: 'maxX',
            rectIndex: 0,
            neighbourRectIndex: 1,
            gap: WRAP_GAP,
            spanMin: WRAP_EAST_RECT.minZ,
            spanMax: CENTRE_RECT.maxZ,
          },
        ]);
      });

      it('reports the rect index of the queried space', () => {
        expect(getNeighbours(plan, 'utilityRoom')).toEqual([
          {
            neighbourId: 'livingRoom',
            side: 'minZ',
            rectIndex: 0,
            neighbourRectIndex: 0,
            gap: WRAP_GAP,
            spanMin: WRAP_NORTH_RECT.minX,
            spanMax: CENTRE_RECT.maxX,
          },
          {
            neighbourId: 'livingRoom',
            side: 'minX',
            rectIndex: 1,
            neighbourRectIndex: 0,
            gap: WRAP_GAP,
            spanMin: WRAP_EAST_RECT.minZ,
            spanMax: CENTRE_RECT.maxZ,
          },
        ]);
      });
    });

    it('throws a RangeError naming an absent id', () => {
      const plan = makePlan([CENTRE]);

      expect(() => getNeighbours(plan, 'laundry')).toThrow(RangeError);
      expect(() => getNeighbours(plan, 'laundry')).toThrow('laundry');
    });
  });

  describe('on FLOOR_PLAN', () => {
    it.each([
      [BALCONY_B_EAST_POINT, 'balconySlabB'],
      [CORRIDOR_WEST_EDGE_POINT, 'corridor'],
      [STAIRS_EAST_EDGE_POINT, 'stairsElevator'],
      [WALL_POINT, undefined],
      [BALCONY_B_WEST_POINT, 'balconySlabB'],
      [SANITAIR_WALL_POINT, undefined],
      [GUEST_ROOM_POINT, 'guestRoom'],
    ] as const)('findSpaceAt(%o) is %s', (point, expectedId) => {
      expect(findSpaceAt(FLOOR_PLAN, point)?.id).toBe(expectedId);
    });

    it('lists the neighbours of the laundry', () => {
      const ids = new Set(getNeighbours(FLOOR_PLAN, 'laundry').map((c) => c.neighbourId));

      expect(ids).toEqual(
        new Set<SpaceId>(['corridor', 'kitchen', 'mainSanitair', 'balconySlabB', 'voidEast']),
      );
    });
  });
});
