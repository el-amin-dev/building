import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, getSpace, hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { rectArea, rectsOverlap } from './planGeometry.ts';
import { SLAB_THICKNESS, getSlabs } from './slabs.ts';
import type { FloorSlab } from './slabs.ts';

const PRECISION_DIGITS = 9;

/** One slab per clear rect of a floored space: 15 single-rect spaces + the 3-rect guest room. */
const EXPECTED_SLAB_COUNT = 18;
/** The 18 spaces of the plan minus the two voids. */
const EXPECTED_FLOORED_SPACE_COUNT = 16;
/** The guest room is the only space of the plan made of several rects (brief §4.3). */
const GUEST_ROOM_SLAB_COUNT = 3;

/** Brief §8: the floor total the slabs must add up to, in square metres. */
const FLOOR_AREA_TOTAL = 167.38;
/** Brief §8: the void has no slab, in square metres. */
const VOID_AREA_TOTAL = 15.1;

/** Slab thickness of the typical floor: 3.00 floor-to-floor − 2.70 wall, in metres. */
const REAL_SLAB_THICKNESS = 0.3;
/** Top of every slab: the finished floor level, in metres. */
const FINISHED_FLOOR_LEVEL = 0;

/** The spaces of kind `'void'`, which must never carry a slab (brief §5.2). */
const VOID_IDS: readonly SpaceId[] = ['voidWest', 'voidEast'];

/** A floor with taller storeys and a thicker slab, to prove nothing is hard-coded. */
const TALL_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 3.6,
  wall: 3.15,
  door: 2.2,
  railing: 1.2,
  windowSill: 1.0,
  windowHead: 2.2,
});
/** 3.60 floor-to-floor − 3.15 wall, in metres. */
const TALL_SLAB_THICKNESS = 0.45;

/** Walls exactly as tall as the storey: no thickness left for a slab. */
const FLAT_HEIGHTS: FloorHeights = Object.freeze({
  ...FLOOR_HEIGHTS,
  wall: FLOOR_HEIGHTS.floorToFloor,
});
/** Walls taller than the storey: a negative slab thickness. */
const OVERSIZED_WALL_HEIGHTS: FloorHeights = Object.freeze({ ...FLOOR_HEIGHTS, wall: 3.2 });

/**
 * Sums the footprints of a list of slabs.
 *
 * @param slabs - The slabs to measure.
 * @returns The total area, in square metres, not rounded.
 */
function totalArea(slabs: readonly FloorSlab[]): number {
  return slabs.reduce((sum, slab) => sum + rectArea(slab.rect), 0);
}

/**
 * Builds a copy of the plan with one space given another kind.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param id - Identifier of the space to change.
 * @param kind - The kind to give it.
 * @returns A new plan whose named space has the given kind.
 */
function withSpaceKind(plan: FloorPlan, id: SpaceId, kind: 'room' | 'void'): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) => (space.id === id ? { ...space, kind } : space)),
  };
}

const SLABS = getSlabs(FLOOR_PLAN);

describe('floor slabs', () => {
  describe('coverage', () => {
    it('lays one slab per clear rect of every floored space', () => {
      const flooredRectCount = FLOOR_PLAN.spaces
        .filter((space) => hasFloor(space.kind))
        .reduce((count, space) => count + space.rects.length, 0);

      expect(SLABS).toHaveLength(EXPECTED_SLAB_COUNT);
      expect(SLABS).toHaveLength(flooredRectCount);
      expect(new Set(SLABS.map((slab) => slab.spaceId)).size).toBe(EXPECTED_FLOORED_SPACE_COUNT);
      expect(SLABS.filter((slab) => slab.spaceId === 'guestRoom')).toHaveLength(
        GUEST_ROOM_SLAB_COUNT,
      );
    });

    it.each(VOID_IDS)('leaves %s without a slab: it is a hole, not land', (id) => {
      expect(SLABS.map((slab) => slab.spaceId)).not.toContain(id);
    });

    it.each([['balconyA' as SpaceId], ['balconySlabB' as SpaceId]])(
      'gives the open-air but walkable %s a slab',
      (id) => {
        expect(SLABS.map((slab) => slab.spaceId)).toContain(id);
      },
    );

    it('covers the 167.38 m² floor total of brief §8', () => {
      expect(totalArea(SLABS)).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
    });

    it('leaves the 15.10 m² void of brief §8 unpaved', () => {
      expect(rectArea(FLOOR_PLAN.plot) - totalArea(SLABS)).toBeGreaterThan(VOID_AREA_TOTAL);
    });

    it.each(SLABS.map((slab, index) => ({ index, slab })))(
      'copies the plan rect of $slab.spaceId into slab $index',
      ({ slab }) => {
        expect(getSpace(FLOOR_PLAN, slab.spaceId).rects).toContain(slab.rect);
      },
    );

    it('keeps the rects of a space in plan order', () => {
      const guestRoomRects = SLABS.filter((slab) => slab.spaceId === 'guestRoom').map(
        (slab) => slab.rect,
      );

      expect(guestRoomRects).toEqual([...getSpace(FLOOR_PLAN, 'guestRoom').rects]);
    });

    it('never overlaps two slab footprints', () => {
      const offenders = SLABS.flatMap((slab, position) =>
        SLABS.slice(position + 1)
          .filter((other) => rectsOverlap(slab.rect, other.rect))
          .map((other) => `${slab.spaceId} ↔ ${other.spaceId}`),
      );

      expect(offenders).toEqual([]);
    });
  });

  describe('vertical span', () => {
    it('derives the 0.30 m thickness from the floor-to-floor and wall heights', () => {
      expect(SLAB_THICKNESS).toBeCloseTo(REAL_SLAB_THICKNESS, PRECISION_DIGITS);
      expect(SLAB_THICKNESS).toBeCloseTo(
        FLOOR_HEIGHTS.floorToFloor - FLOOR_HEIGHTS.wall,
        PRECISION_DIGITS,
      );
    });

    it('hangs every slab from the finished floor down by its thickness', () => {
      SLABS.forEach((slab) => {
        expect(slab.top).toBeCloseTo(FINISHED_FLOOR_LEVEL, PRECISION_DIGITS);
        expect(slab.bottom).toBeCloseTo(-REAL_SLAB_THICKNESS, PRECISION_DIGITS);
      });
    });

    it('follows injected heights, leaving no 0.30 m behind', () => {
      const tall = getSlabs(FLOOR_PLAN, TALL_HEIGHTS);

      expect(tall).toHaveLength(EXPECTED_SLAB_COUNT);
      tall.forEach((slab) => {
        expect(slab.top).toBeCloseTo(FINISHED_FLOOR_LEVEL, PRECISION_DIGITS);
        expect(slab.bottom).toBeCloseTo(-TALL_SLAB_THICKNESS, PRECISION_DIGITS);
      });
      expect(tall.map((slab) => slab.bottom)).not.toContain(-REAL_SLAB_THICKNESS);
    });

    it.each([
      ['equal to the storey height', FLAT_HEIGHTS],
      ['taller than the storey', OVERSIZED_WALL_HEIGHTS],
    ])('rejects walls %s', (_label, heights) => {
      expect(() => getSlabs(FLOOR_PLAN, heights)).toThrow(RangeError);
    });
  });

  describe('immutability', () => {
    it('freezes the list and every slab', () => {
      expect(Object.isFrozen(SLABS)).toBe(true);
      SLABS.forEach((slab) => {
        expect(Object.isFrozen(slab)).toBe(true);
        expect(Object.isFrozen(slab.rect)).toBe(true);
      });
    });
  });

  describe('mutation guard', () => {
    it('adds slabs when a void is turned into a room', () => {
      const paved = withSpaceKind(FLOOR_PLAN, 'voidWest', 'room');

      expect(getSlabs(paved).length).toBeGreaterThan(EXPECTED_SLAB_COUNT);
      expect(totalArea(getSlabs(paved))).toBeGreaterThan(FLOOR_AREA_TOTAL);
    });

    it('drops slabs when a floored space is turned into a void', () => {
      const holed = withSpaceKind(FLOOR_PLAN, 'balconySlabB', 'void');

      expect(getSlabs(holed).length).toBeLessThan(EXPECTED_SLAB_COUNT);
      expect(totalArea(getSlabs(holed))).toBeLessThan(FLOOR_AREA_TOTAL);
    });
  });
});
