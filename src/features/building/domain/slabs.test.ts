/**
 * What this file used to assert, and why the figures moved.
 *
 * The floor was rebuilt from the single source of truth
 * (`sourceOfTruth/plan.ts`): 18 spaces became 21 — each bathroom grew a walled
 * bath, the main one a walled shower as well — and `linkCorridor` was deleted.
 * (The guest suite was drawn with a shower cubicle of its own for a while; the
 * owner dropped it, restoring brief §7.3's own table, which gives the guest
 * sanitair a sink and a bath and no shower. That is why the count is 21 and not
 * 22, and why the guest suite's three rooms are the shape they are: the suite
 * slid east onto the floor the cubicle held and the guest room grew into the
 * west end it left.) Two totals this file pinned came from that superseded plan
 * and are re-measured here rather than carried:
 *
 * - `FLOOR_AREA_TOTAL` was 167.38 m². The slabs now cover 165.920 m²: the
 *   source of truth's own FLOOR total of 163.920 m² (`room` / `circulation` /
 *   `openAir`, which excludes the stair bay) plus the 2.00 m² arrival landing,
 *   the only part of the bay that is floor at this storey;
 * - the "15.10 m² void" was the old side-B strip. The plan's two `'void'`
 *   spaces measure 9.36 m², and the bay contributes a second unpaved area the
 *   old plan did not have: 6.00 m² of open shaft;
 * - `EXPECTED_SLAB_COUNT` was 18 and is 22, and the guest room is no longer the
 *   only space made of several rects — the corridor and the kitchen are too, so
 *   the rect counts are read off the plan instead of being named.
 *
 * One case is not a re-measurement but a change of behaviour:
 * `getSlabs` no longer pours the stair bay. It floors only the stair pieces
 * `stairs.ts` reports as `atThisLevel`, so the bay's single 8.00 m² plan rect
 * yields one 2.00 m² landing slab and 6.00 m² of hole. The old assertion that
 * every slab rect is a plan rect of its space is therefore false for exactly
 * one slab, and is replaced below by the rule the module actually follows.
 *
 * Two assertions were also strengthened rather than repaired, because as written
 * they could no longer fail for the reason they claimed:
 *
 * - `leaves the 15.10 m² void of brief §8 unpaved` compared the unpaved
 *   remainder against `toBeGreaterThan(VOID_AREA_TOTAL)`. The remainder is
 *   mostly masonry, so that inequality held however badly the voids were paved.
 *   It is replaced by a footprint test: no slab may overlap a void rect, and
 *   none may overlap a blocked stair rect;
 * - the two mutation guards compared the mutated count and area against the
 *   unmutated ones with `toBeLessThan` / `toBeGreaterThan`. They now pin the
 *   exact delta — the area of the space whose kind was changed — so a guard that
 *   moved the wrong space, or moved it twice, fails.
 */

import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, PLOT_RECT, getSpace, getSpaceArea, hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { rectArea, rectsOverlap } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { SLAB_THICKNESS, getSlabThickness, getSlabs } from './slabs.ts';
import type { FloorSlab } from './slabs.ts';
import { getStairsLayout } from './stairs.ts';

const PRECISION_DIGITS = 9;
const NONE = 0;
const ONE = 1;

/**
 * One slab per clear rect of every floored space, except the stair bay, whose
 * one rect yields one arrival-landing slab: 19 floored spaces, of which the
 * corridor, the guest room and the kitchen carry two rects each.
 */
const EXPECTED_SLAB_COUNT = 22;
/** The 21 spaces of the plan minus its two voids. */
const EXPECTED_FLOORED_SPACE_COUNT = 19;
/** Slabs whose footprint is a plan rect copied verbatim: every one but the bay's. */
const PLAN_RECT_SLAB_COUNT = 21;
/** Slabs whose footprint comes from a stair piece instead: the arrival landing. */
const LEVEL_RECT_SLAB_COUNT = 1;

/**
 * Floor total the slabs must add up to, in square metres: the source of truth's
 * FLOOR total of 163.920 (which excludes the stair bay) plus the 2.00 m²
 * arrival landing. Measured against the plan below, not merely written here.
 */
const FLOOR_AREA_TOTAL = 165.92;
/** The two `'void'` spaces of the plan, in square metres: never paved. */
const VOID_AREA_TOTAL = 9.36;
/** The stair bay, in square metres, as the plan declares the `stairs` space. */
const BAY_AREA = 8;
/** The arrival landing, in square metres: the part of the bay that is floor here. */
const LANDING_AREA = 2;
/** The open shaft, in square metres: the rest of the bay, which carries no slab. */
const SHAFT_AREA = 6;
/** The 22.50 × 10.00 m plot, in square metres. */
const PLOT_AREA = 225;

/** Slab thickness of the typical floor: 3.00 floor-to-floor − 2.70 wall, in metres. */
const REAL_SLAB_THICKNESS = 0.3;
/** Top of every slab: the finished floor level, in metres. */
const FINISHED_FLOOR_LEVEL = 0;

/** The spaces of kind `'void'`, which must never carry a slab. */
const VOID_IDS: readonly SpaceId[] = ['voidWest', 'voidEast'];

/**
 * The open-air spaces that are outside but walkable, so they do get a slab. The
 * control-centre balcony is new in the rebuilt plan and is listed for the same
 * reason the other two were: an open side is not a hole.
 */
const OPEN_AIR_IDS: readonly SpaceId[] = ['balconyA', 'ccBalcony', 'balconySlabB'];

/** The spaces the rebuilt plan makes out of more than one rect. */
const MULTI_RECT_IDS: readonly SpaceId[] = ['corridor', 'guestRoom', 'kitchen'];

/** A floor with taller storeys and a thicker slab, to prove nothing is hard-coded. */
const TALL_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 3.6,
  wall: 3.15,
  door: 2.2,
  railing: 1.2,
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
const STAIRS = getStairsLayout(FLOOR_PLAN);

/** Footprints of the stair pieces that are floor at this storey: the arrival landing. */
const LEVEL_RECTS: readonly PlanRect[] = STAIRS.pieces
  .filter((piece) => piece.atThisLevel)
  .map((piece) => piece.rect);

/** Every rect of a `'void'` space: the fall edges of the side-B strip. */
const VOID_RECTS: readonly PlanRect[] = FLOOR_PLAN.spaces
  .filter((space) => !hasFloor(space.kind))
  .flatMap((space) => space.rects);

/**
 * The plan's own floored area outside the stair bay, in square metres: every
 * space that has a floor except the bay, which is floored only under its
 * arrival landing.
 */
const PLAN_FLOORED_AREA_OUTSIDE_BAY = FLOOR_PLAN.spaces
  .filter((space) => hasFloor(space.kind) && space.id !== 'stairs')
  .reduce((sum, space) => sum + getSpaceArea(space), 0);

describe('floor slabs', () => {
  describe('coverage', () => {
    it('lays one slab per clear rect of every floored space, the bay excepted', () => {
      const flooredRectCount = FLOOR_PLAN.spaces
        .filter((space) => hasFloor(space.kind))
        .reduce((count, space) => count + space.rects.length, 0);

      expect(SLABS).toHaveLength(EXPECTED_SLAB_COUNT);
      // The bay's one rect yields exactly one landing slab, so the totals agree.
      expect(SLABS).toHaveLength(flooredRectCount);
      expect(new Set(SLABS.map((slab) => slab.spaceId)).size).toBe(EXPECTED_FLOORED_SPACE_COUNT);
    });

    it.each(MULTI_RECT_IDS)('lays one slab per rect of the several-rect %s', (id) => {
      expect(SLABS.filter((slab) => slab.spaceId === id)).toHaveLength(
        getSpace(FLOOR_PLAN, id).rects.length,
      );
    });

    it.each(VOID_IDS)('leaves %s without a slab: it is a hole, not land', (id) => {
      expect(SLABS.map((slab) => slab.spaceId)).not.toContain(id);
    });

    it.each(OPEN_AIR_IDS)('gives the open-air but walkable %s a slab', (id) => {
      expect(SLABS.map((slab) => slab.spaceId)).toContain(id);
    });

    it('covers the 165.920 m² the plan floors outside the bay, plus the landing', () => {
      expect(PLAN_FLOORED_AREA_OUTSIDE_BAY + LANDING_AREA).toBeCloseTo(
        FLOOR_AREA_TOTAL,
        PRECISION_DIGITS,
      );
      expect(totalArea(SLABS)).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
      expect(totalArea(SLABS)).toBeCloseTo(
        PLAN_FLOORED_AREA_OUTSIDE_BAY + LANDING_AREA,
        PRECISION_DIGITS,
      );
    });

    it('never lays a slab over a void: the 9.36 m² of hole stays unpaved', () => {
      const paved = SLABS.flatMap((slab) =>
        VOID_RECTS.filter((rect) => rectsOverlap(slab.rect, rect)).map(
          (rect) => `${slab.spaceId} over x ${String(rect.minX)}–${String(rect.maxX)}`,
        ),
      );

      expect(paved).toEqual([]);
      expect(VOID_RECTS.reduce((sum, rect) => sum + rectArea(rect), NONE)).toBeCloseTo(
        VOID_AREA_TOTAL,
        PRECISION_DIGITS,
      );
    });

    it('never lays a slab over the stair shaft: 6.00 of the 8.00 m² bay is open', () => {
      const paved = SLABS.flatMap((slab) =>
        STAIRS.blockedRects
          .filter((rect) => rectsOverlap(slab.rect, rect))
          .map((rect) => `${slab.spaceId} over x ${String(rect.minX)}–${String(rect.maxX)}`),
      );
      const bayArea = rectArea(STAIRS.bay);
      const flooredInBay = totalArea(SLABS.filter((slab) => slab.spaceId === 'stairs'));

      expect(paved).toEqual([]);
      expect(bayArea).toBeCloseTo(BAY_AREA, PRECISION_DIGITS);
      expect(flooredInBay).toBeCloseTo(LANDING_AREA, PRECISION_DIGITS);
      expect(bayArea - flooredInBay).toBeCloseTo(SHAFT_AREA, PRECISION_DIGITS);
    });

    it('floors the bay under the stair pieces at this level, not under its plan rect', () => {
      const bayslabs = SLABS.filter((slab) => slab.spaceId === 'stairs');

      expect(bayslabs).toHaveLength(LEVEL_RECT_SLAB_COUNT);
      bayslabs.forEach((slab) => {
        expect(LEVEL_RECTS).toContain(slab.rect);
        expect(getSpace(FLOOR_PLAN, 'stairs').rects).not.toContain(slab.rect);
      });
      expect(rectArea(STAIRS.bay)).toBeGreaterThan(rectArea(bayslabs[0].rect));
    });

    it.each(SLABS.map((slab, index) => ({ index, slab })))(
      'gives slab $index of $slab.spaceId a plan rect or a stair-piece rect',
      ({ slab }) => {
        const fromPlan = getSpace(FLOOR_PLAN, slab.spaceId).rects.includes(slab.rect);
        const fromStairs = LEVEL_RECTS.includes(slab.rect);

        expect(fromPlan || fromStairs).toBe(true);
      },
    );

    it('copies the plan rect for every slab but the bay-s, which copies a stair piece', () => {
      const fromPlan = SLABS.filter((slab) =>
        getSpace(FLOOR_PLAN, slab.spaceId).rects.includes(slab.rect),
      );
      const fromStairs = SLABS.filter((slab) => LEVEL_RECTS.includes(slab.rect));

      expect(fromPlan).toHaveLength(PLAN_RECT_SLAB_COUNT);
      expect(fromStairs).toHaveLength(LEVEL_RECT_SLAB_COUNT);
      expect(fromPlan.length + fromStairs.length).toBe(EXPECTED_SLAB_COUNT);
    });

    it.each(MULTI_RECT_IDS)('keeps the rects of %s in plan order', (id) => {
      const rects = SLABS.filter((slab) => slab.spaceId === id).map((slab) => slab.rect);

      expect(rects).toEqual([...getSpace(FLOOR_PLAN, id).rects]);
    });

    it('never overlaps two slab footprints', () => {
      const offenders = SLABS.flatMap((slab, position) =>
        SLABS.slice(position + ONE)
          .filter((other) => rectsOverlap(slab.rect, other.rect))
          .map((other) => `${slab.spaceId} ↔ ${other.spaceId}`),
      );

      expect(offenders).toEqual([]);
    });

    it('leaves the rest of the plot to the masonry, the voids and the shaft', () => {
      // The four parts of the plot, so that the floor total is checked against
      // the whole 225.00 m² rather than against itself. What is left once the
      // slabs, the voids and the shaft are taken out is the wall footprint,
      // which `builtFloor.test.ts` measures from the walls themselves.
      const masonry = PLOT_AREA - totalArea(SLABS) - VOID_AREA_TOTAL - SHAFT_AREA;

      expect(rectArea(PLOT_RECT)).toBeCloseTo(PLOT_AREA, PRECISION_DIGITS);
      expect(totalArea(SLABS) + VOID_AREA_TOTAL + SHAFT_AREA + masonry).toBeCloseTo(
        PLOT_AREA,
        PRECISION_DIGITS,
      );
      expect(masonry).toBeGreaterThan(NONE);
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

    it('snaps the thickness onto the plan grid, exactly', () => {
      // Exact equality, not toBeCloseTo: the raw subtraction is
      // 0.2999999999999998, and the walls start at minus this very value
      // (`walls.ts`), so any drift here would open a gap in the section.
      expect(SLAB_THICKNESS).toBe(REAL_SLAB_THICKNESS);
      expect(getSlabThickness()).toBe(SLAB_THICKNESS);
      expect(getSlabThickness(FLOOR_HEIGHTS)).toBe(SLAB_THICKNESS);
      expect(getSlabThickness(TALL_HEIGHTS)).toBe(TALL_SLAB_THICKNESS);
      SLABS.forEach((slab) => {
        expect(slab.bottom).toBe(-SLAB_THICKNESS);
      });
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
      expect(totalArea(tall)).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
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
    it('adds the west void-s own 5.40 m² when it is turned into a room', () => {
      const paved = getSlabs(withSpaceKind(FLOOR_PLAN, 'voidWest', 'room'));
      const added = getSpaceArea(getSpace(FLOOR_PLAN, 'voidWest'));

      expect(paved).toHaveLength(
        EXPECTED_SLAB_COUNT + getSpace(FLOOR_PLAN, 'voidWest').rects.length,
      );
      expect(added).toBeGreaterThan(NONE);
      expect(totalArea(paved)).toBeCloseTo(FLOOR_AREA_TOTAL + added, PRECISION_DIGITS);
    });

    it('drops the balcony slab-s own 2.96 m² when it is turned into a void', () => {
      const holed = getSlabs(withSpaceKind(FLOOR_PLAN, 'balconySlabB', 'void'));
      const dropped = getSpaceArea(getSpace(FLOOR_PLAN, 'balconySlabB'));

      // Pinned as an exact delta, not as `toBeLessThan`: the space really is
      // floored to begin with (so the guard can fail), and exactly its own area
      // leaves the total.
      expect(SLABS.map((slab) => slab.spaceId)).toContain('balconySlabB');
      expect(dropped).toBeGreaterThan(NONE);
      expect(holed).toHaveLength(
        EXPECTED_SLAB_COUNT - getSpace(FLOOR_PLAN, 'balconySlabB').rects.length,
      );
      expect(holed.map((slab) => slab.spaceId)).not.toContain('balconySlabB');
      expect(totalArea(holed)).toBeCloseTo(FLOOR_AREA_TOTAL - dropped, PRECISION_DIGITS);
    });
  });
});
