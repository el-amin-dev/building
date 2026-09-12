import { describe, expect, it } from 'vitest';
import { makeRect, rectArea, rectDepth, rectWidth, toPlanLength } from '../planGeometry.ts';
import type { PlanRect } from '../planGeometry.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import { FLOOR_PLAN, INTERIOR_RECT, PLOT_RECT } from './floorPlanData.ts';
import { getSpace, getSpaceArea, hasFloor } from './queries.ts';
import { SPACE_IDS } from './types.ts';
import type { FloorPlan, SpaceId, SpaceKind } from './types.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;

const PLOT_WIDTH = 22.5;
const PLOT_DEPTH = 10.0;
const PLOT_AREA = 225.0;
const EXTERIOR_WALL = 0.3;
const INTERIOR_MAX_X = 22.2;
const INTERIOR_MAX_Z = 9.7;
const INTERIOR_WIDTH = 21.9;
const INTERIOR_DEPTH = 9.4;

/**
 * The four totals that must close on the plot, in square metres.
 *
 * Measured from the rects of the redrawn floor, not copied from the brief: the
 * v1 figures (167.38 floor, 15.10 void, 42.52 wall) belong to a superseded plan.
 * `pnpm verify:plan` prints the same numbers from the source of truth, splitting
 * the stairwell out of the floor total — the model maps `stairwell` onto
 * `circulation`, so here the stairs' 8.00 m² is part of {@link FLOOR_AREA_TOTAL}
 * (163.515 + 8.00).
 */
const FLOOR_AREA_TOTAL = 171.515;
const VOID_WEST_AREA = 5.4;
const VOID_EAST_AREA = 3.96;
const VOID_AREA_TOTAL = 9.36;
const WALL_AREA_TOTAL = 44.125;

/**
 * The side-B strip, in square metres: the two voids, the balcony slab and the
 * control-center balcony, which together tile z 8.90–9.70 from x 4.10 to 20.30.
 *
 * Three spaces in v1, four now: `ccBalcony` is new, and the strip is 0.80 deep
 * rather than 1.00, the 0.20 having gone to the kitchen, laundry and main
 * sanitair.
 */
const SIDE_B_STRIP_AREA = 12.96;
/** Start of the side-B strip along x, in metres: the west face of `ccBalcony`. */
const SIDE_B_STRIP_MIN_X = 4.1;
/** End of the side-B strip along x, in metres: the east face of `voidEast`. */
const SIDE_B_STRIP_MAX_X = 20.3;
/** Depth of the side-B strip along z, in metres. */
const SIDE_B_STRIP_DEPTH = 0.8;

const DEPTH_CHAIN_X = 15.0;
const WIDTH_CHAIN_Z = 2.0;
const TOP_ROW_START_X = 1.6;
const TOP_ROW_END_X = 22.2;
const TOP_ROW_SPAN = 20.6;

type RectTuple = readonly [minX: number, maxX: number, minZ: number, maxZ: number];
type Axis = 'x' | 'z';

/** One piece of a cross-section: a space's clear extent or the solid between spaces. */
type Segment =
  | { readonly kind: 'space'; readonly id: SpaceId; readonly length: number }
  | { readonly kind: 'gap'; readonly length: number };

/**
 * The clear rects of every space, as `[minX, maxX, minZ, maxZ]`.
 *
 * The owner's geometry, as `ROOMS` of `../sourceOfTruth/plan.ts` states it and
 * `floorPlanData.ts` derives it. Exhaustive by construction: the record is keyed
 * on `SpaceId`, so a space added to the plan fails to typecheck until it is
 * measured in here too.
 */
const EXPECTED_RECTS: Record<SpaceId, readonly RectTuple[]> = {
  balconyA: [[0.3, 1.3, 0.3, 9.7]],
  masterBedroom: [[1.6, 6.6, 0.3, 3.7]],
  livingRoom: [[6.9, 11.9, 0.3, 3.85]],
  bedroomMaleKids: [[12.05, 17.05, 0.3, 3.85]],
  bedroomFemaleKids: [[17.2, 22.2, 0.3, 3.85]],
  stairs: [[1.6, 5.6, 4.0, 6.0]],
  corridor: [
    [5.6, 20.2, 4.0, 5.5],
    [5.6, 11.9, 5.5, 6.0],
  ],
  controlCenter: [[1.6, 3.8, 7.2, 9.7]],
  guestRoom: [
    [1.6, 9.7, 6.3, 7.05],
    [4.1, 6.9, 7.05, 8.6],
  ],
  guestSanitair: [[7.05, 9.85, 7.2, 7.75]],
  kitchen: [
    [10.0, 12.2, 6.3, 8.6],
    [12.2, 14.1, 5.8, 8.6],
  ],
  laundry: [[14.25, 17.55, 5.8, 8.6]],
  mainSanitair: [[17.7, 20.35, 5.8, 7.3]],
  utilityRoom: [[20.5, 22.2, 4.15, 9.7]],
  ccBalcony: [[4.1, 4.9, 8.9, 9.7]],
  balconySlabB: [[11.65, 15.35, 8.9, 9.7]],
  voidWest: [[4.9, 11.65, 8.9, 9.7]],
  voidEast: [[15.35, 20.3, 8.9, 9.7]],
  guestBathCubicle: [[7.05, 8.7, 7.9, 8.6]],
  guestShowerCubicle: [[8.85, 9.85, 7.9, 8.6]],
  mainBathCubicle: [[17.7, 19.35, 7.45, 8.6]],
  mainShowerCubicle: [[19.5, 20.35, 7.45, 8.6]],
};

/**
 * The kind of every space.
 *
 * The stairs are `circulation` here and `stairwell` in the source of truth: that
 * one mapping is the whole of the difference between the two (`floorPlanData.ts`).
 * The four bath and shower cubicles are `room`s, not fittings — that is what
 * gives them walls, doors and a window each (owner).
 */
const EXPECTED_KINDS: Record<SpaceId, SpaceKind> = {
  balconyA: 'openAir',
  masterBedroom: 'room',
  livingRoom: 'room',
  bedroomMaleKids: 'room',
  bedroomFemaleKids: 'room',
  stairs: 'circulation',
  corridor: 'circulation',
  controlCenter: 'room',
  guestRoom: 'room',
  guestSanitair: 'room',
  kitchen: 'room',
  laundry: 'room',
  mainSanitair: 'room',
  utilityRoom: 'room',
  ccBalcony: 'openAir',
  balconySlabB: 'openAir',
  voidWest: 'void',
  voidEast: 'void',
  guestBathCubicle: 'room',
  guestShowerCubicle: 'room',
  mainBathCubicle: 'room',
  mainShowerCubicle: 'room',
};

/**
 * The clear area of every space, in square metres, measured from
 * {@link EXPECTED_RECTS}.
 *
 * Every space is listed, voids included, so the four totals below are a sum of
 * numbers this table already pins rather than an independent claim.
 */
const SPACE_AREAS: Readonly<Record<SpaceId, number>> = {
  balconyA: 9.4,
  masterBedroom: 17.0,
  livingRoom: 17.75,
  bedroomMaleKids: 17.75,
  bedroomFemaleKids: 17.75,
  stairs: 8.0,
  corridor: 25.05,
  controlCenter: 5.5,
  guestRoom: 10.415,
  guestSanitair: 1.54,
  kitchen: 10.38,
  laundry: 9.24,
  mainSanitair: 3.975,
  utilityRoom: 9.435,
  ccBalcony: 0.64,
  balconySlabB: 2.96,
  voidWest: VOID_WEST_AREA,
  voidEast: VOID_EAST_AREA,
  guestBathCubicle: 1.155,
  guestShowerCubicle: 0.7,
  mainBathCubicle: 1.8975,
  mainShowerCubicle: 0.9775,
};

/**
 * Depth chain along z at x = 15.00, from side C to side B.
 *
 * Re-measured for the redrawn floor: the male kids' bedroom is 3.55 deep behind
 * a 0.15 partition (the 0.15 each thin wall frees goes into the room, which is
 * what keeps the corridor's north face straight at z 4.00), the laundry is 2.80
 * and the balcony slab 0.80 rather than 1.00.
 */
const DEPTH_CHAIN: readonly Segment[] = [
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'bedroomMaleKids', length: 3.55 },
  { kind: 'gap', length: 0.15 },
  { kind: 'space', id: 'corridor', length: 1.5 },
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'laundry', length: 2.8 },
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'balconySlabB', length: 0.8 },
  { kind: 'gap', length: 0.3 },
];

/**
 * Width chain along x at z = 2.00, from side A to side D.
 *
 * The four top-row rooms are still 5.00 wide each, but the walls between them
 * are no longer all equal: the master bedroom is on the owner's isolation list
 * on all four sides, so its wall to the living room is 0.30, while the two
 * kids' bedrooms are separated by plain 0.15 partitions.
 */
const WIDTH_CHAIN: readonly Segment[] = [
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'balconyA', length: 1.0 },
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'masterBedroom', length: 5.0 },
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'livingRoom', length: 5.0 },
  { kind: 'gap', length: 0.15 },
  { kind: 'space', id: 'bedroomMaleKids', length: 5.0 },
  { kind: 'gap', length: 0.15 },
  { kind: 'space', id: 'bedroomFemaleKids', length: 5.0 },
  { kind: 'gap', length: 0.3 },
];

/** Index of the first top-row segment (master bedroom) in {@link WIDTH_CHAIN}. */
const TOP_ROW_FIRST_SEGMENT = 3;
/** Index one past the last top-row segment (female kids bedroom) in {@link WIDTH_CHAIN}. */
const TOP_ROW_END_SEGMENT = 10;

/**
 * Converts a `[minX, maxX, minZ, maxZ]` tuple into a plan rectangle.
 *
 * @param tuple - The rectangle coordinates.
 * @returns A frozen plan rectangle.
 */
function rectFromTuple([minX, maxX, minZ, maxZ]: RectTuple): PlanRect {
  return makeRect(minX, maxX, minZ, maxZ);
}

/**
 * Sums the lengths of a list of segments, snapped to the plan grid.
 *
 * @param segments - The segments to add up.
 * @returns The total length, in metres.
 */
function totalLength(segments: readonly Segment[]): number {
  return toPlanLength(segments.reduce((sum, segment) => sum + segment.length, 0));
}

/**
 * Cuts the plan along a line and lists what the line crosses, in order.
 *
 * With `axis = 'x'` the line runs along x at `z = at`; with `axis = 'z'` it
 * runs along z at `x = at`. A rect is crossed when its range on the other axis
 * satisfies `min <= at < max`. Zero-length gaps are omitted.
 *
 * @param plan - The floor plan to cut.
 * @param axis - The axis the line runs along.
 * @param at - Position of the line on the other axis, in metres.
 * @returns Segments from the plot start to the plot end, lengths snapped to the plan grid.
 */
function crossSection(plan: FloorPlan, axis: Axis, at: number): Segment[] {
  const along = (rect: PlanRect): readonly [number, number] =>
    axis === 'x' ? [rect.minX, rect.maxX] : [rect.minZ, rect.maxZ];
  const across = (rect: PlanRect): readonly [number, number] =>
    axis === 'x' ? [rect.minZ, rect.maxZ] : [rect.minX, rect.maxX];

  const crossed = plan.spaces
    .flatMap((space) => space.rects.map((rect) => ({ id: space.id, rect })))
    .filter(({ rect }) => {
      const [min, max] = across(rect);
      return min <= at && at < max;
    })
    .sort((a, b) => along(a.rect)[0] - along(b.rect)[0]);

  const [plotStart, plotEnd] = along(plan.plot);
  const segments: Segment[] = [];
  let cursor = plotStart;
  const pushGap = (end: number): void => {
    const length = toPlanLength(end - cursor);
    if (length !== 0) {
      segments.push({ kind: 'gap', length });
    }
  };
  crossed.forEach(({ id, rect }) => {
    const [start, end] = along(rect);
    pushGap(start);
    segments.push({ kind: 'space', id, length: toPlanLength(end - start) });
    cursor = end;
  });
  pushGap(plotEnd);
  return segments;
}

describe('floorPlanData', () => {
  describe('plan structure', () => {
    it('lists the spaces in SPACE_IDS order', () => {
      expect(FLOOR_PLAN.spaces.map((space) => space.id)).toEqual(SPACE_IDS);
    });

    it('holds the 22 spaces of the redrawn floor, with no link corridor', () => {
      expect(FLOOR_PLAN.spaces).toHaveLength(Object.keys(EXPECTED_RECTS).length);
      expect(FLOOR_PLAN.spaces.map((space) => space.id)).not.toContain('linkCorridor');
    });

    it('is deeply frozen', () => {
      expect(Object.isFrozen(FLOOR_PLAN)).toBe(true);
      expect(Object.isFrozen(FLOOR_PLAN.plot)).toBe(true);
      expect(Object.isFrozen(FLOOR_PLAN.interior)).toBe(true);
      expect(Object.isFrozen(FLOOR_PLAN.spaces)).toBe(true);
      FLOOR_PLAN.spaces.forEach((space) => {
        expect(Object.isFrozen(space)).toBe(true);
        expect(Object.isFrozen(space.rects)).toBe(true);
        space.rects.forEach((rect) => {
          expect(Object.isFrozen(rect)).toBe(true);
        });
      });
      expect(Object.isFrozen(FLOOR_PLAN.joinOverrides)).toBe(true);
      FLOOR_PLAN.joinOverrides.forEach((override) => {
        expect(Object.isFrozen(override)).toBe(true);
        expect(Object.isFrozen(override.spaces)).toBe(true);
      });
    });

    it('has a 22.50 × 10.00 m plot at the origin', () => {
      expect(PLOT_RECT).toEqual(makeRect(0, PLOT_WIDTH, 0, PLOT_DEPTH));
      expect(FLOOR_PLAN.plot).toEqual(PLOT_RECT);
    });

    it('has a 21.90 × 9.40 m interior inside the 0.30 m exterior walls', () => {
      expect(INTERIOR_RECT).toEqual(
        makeRect(EXTERIOR_WALL, INTERIOR_MAX_X, EXTERIOR_WALL, INTERIOR_MAX_Z),
      );
      expect(EXTERIOR_WALL).toBe(WALL_SPEC.exterior);
      expect(rectWidth(INTERIOR_RECT)).toBeCloseTo(INTERIOR_WIDTH, PRECISION_DIGITS);
      expect(rectDepth(INTERIOR_RECT)).toBeCloseTo(INTERIOR_DEPTH, PRECISION_DIGITS);
      expect(FLOOR_PLAN.interior).toEqual(INTERIOR_RECT);
    });
  });

  describe('exact rects', () => {
    it.each(SPACE_IDS)('gives %s its drawn clear rects', (id) => {
      expect(getSpace(FLOOR_PLAN, id).rects).toEqual(EXPECTED_RECTS[id].map(rectFromTuple));
    });

    it.each(SPACE_IDS)('gives %s its kind', (id) => {
      expect(getSpace(FLOOR_PLAN, id).kind).toBe(EXPECTED_KINDS[id]);
    });
  });

  describe('clear areas', () => {
    it.each(SPACE_IDS)('gives %s its measured clear area', (id) => {
      expect(getSpaceArea(getSpace(FLOOR_PLAN, id))).toBeCloseTo(SPACE_AREAS[id], PRECISION_DIGITS);
    });

    it('gives the guest suite four rooms rather than one sanitair block', () => {
      // v1 measured a 1.80 × 1.50 m sanitair block carved out of the guest room and
      // checked the room's gross area as net + block. The owner has since made the
      // bath and the shower rooms of their own, each with a door and a window, so the
      // suite is four rooms (sanitair + two cubicles) and there is no single block to
      // add back. What is worth pinning instead is that the three wet rooms of the
      // suite tile one footprint with the partitions between them.
      const sanitair = getSpace(FLOOR_PLAN, 'guestSanitair').rects[0];
      const bath = getSpace(FLOOR_PLAN, 'guestBathCubicle').rects[0];
      const shower = getSpace(FLOOR_PLAN, 'guestShowerCubicle').rects[0];

      expect(sanitair.minX).toBe(bath.minX);
      expect(sanitair.maxX).toBe(shower.maxX);
      expect(toPlanLength(bath.minZ - sanitair.maxZ)).toBe(WALL_SPEC.partition);
      expect(toPlanLength(shower.minX - bath.maxX)).toBe(WALL_SPEC.partition);
      expect(bath.minZ).toBe(shower.minZ);
      expect(bath.maxZ).toBe(shower.maxZ);
    });
  });

  describe('totals', () => {
    const areaWhere = (predicate: (kind: SpaceKind) => boolean): number =>
      FLOOR_PLAN.spaces
        .filter((space) => predicate(space.kind))
        .reduce((sum, space) => sum + getSpaceArea(space), 0);
    const floorArea = areaWhere(hasFloor);
    const voidArea = areaWhere((kind) => kind === 'void');

    it('has a 225.00 m² plot', () => {
      expect(rectArea(PLOT_RECT)).toBeCloseTo(PLOT_AREA, PRECISION_DIGITS);
    });

    it('has 171.515 m² of floor, the 8.00 m² stairwell included', () => {
      expect(floorArea).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
      expect(floorArea).toBeCloseTo(
        SPACE_IDS.filter((id) => EXPECTED_KINDS[id] !== 'void').reduce(
          (sum, id) => sum + SPACE_AREAS[id],
          0,
        ),
        PRECISION_DIGITS,
      );
    });

    it('has 9.36 m² of void: 5.40 west + 3.96 east', () => {
      expect(getSpaceArea(getSpace(FLOOR_PLAN, 'voidWest'))).toBeCloseTo(
        VOID_WEST_AREA,
        PRECISION_DIGITS,
      );
      expect(getSpaceArea(getSpace(FLOOR_PLAN, 'voidEast'))).toBeCloseTo(
        VOID_EAST_AREA,
        PRECISION_DIGITS,
      );
      expect(voidArea).toBeCloseTo(VOID_AREA_TOTAL, PRECISION_DIGITS);
    });

    it('leaves 44.125 m² of walls', () => {
      expect(rectArea(PLOT_RECT) - floorArea - voidArea).toBeCloseTo(
        WALL_AREA_TOTAL,
        PRECISION_DIGITS,
      );
    });

    it('has a 12.96 m² side-B strip: the voids, the slab and the cc balcony', () => {
      const strip =
        voidArea +
        getSpaceArea(getSpace(FLOOR_PLAN, 'balconySlabB')) +
        getSpaceArea(getSpace(FLOOR_PLAN, 'ccBalcony'));

      expect(strip).toBeCloseTo(SIDE_B_STRIP_AREA, PRECISION_DIGITS);
      // The four spaces tile one 0.80 m deep strip with no wall between them, so its
      // area is also its bounding rectangle.
      expect((SIDE_B_STRIP_MAX_X - SIDE_B_STRIP_MIN_X) * SIDE_B_STRIP_DEPTH).toBeCloseTo(
        SIDE_B_STRIP_AREA,
        PRECISION_DIGITS,
      );
    });
  });

  describe('chains', () => {
    it('matches the depth chain at x = 15.00', () => {
      const section = crossSection(FLOOR_PLAN, 'z', DEPTH_CHAIN_X);

      expect(section).toEqual(DEPTH_CHAIN);
      expect(totalLength(section)).toBe(PLOT_DEPTH);
    });

    it('matches the width chain at z = 2.00', () => {
      const section = crossSection(FLOOR_PLAN, 'x', WIDTH_CHAIN_Z);
      const topRow = section.slice(TOP_ROW_FIRST_SEGMENT, TOP_ROW_END_SEGMENT);

      expect(section).toEqual(WIDTH_CHAIN);
      expect(totalLength(topRow)).toBe(TOP_ROW_SPAN);
      expect(toPlanLength(TOP_ROW_END_X - TOP_ROW_START_X)).toBe(TOP_ROW_SPAN);
      expect(totalLength(section)).toBe(PLOT_WIDTH);
    });

    const centreLines = FLOOR_PLAN.spaces.flatMap((space) =>
      space.rects.flatMap((rect, index) => [
        { id: space.id, index, axis: 'x' as const, at: (rect.minZ + rect.maxZ) * HALF },
        { id: space.id, index, axis: 'z' as const, at: (rect.minX + rect.maxX) * HALF },
      ]),
    );

    it.each(centreLines)(
      'sums to the plot size along $axis through the centre of $id rect $index',
      ({ axis, at }) => {
        const plotSize = axis === 'x' ? PLOT_WIDTH : PLOT_DEPTH;

        expect(totalLength(crossSection(FLOOR_PLAN, axis, at))).toBe(plotSize);
      },
    );
  });
});
