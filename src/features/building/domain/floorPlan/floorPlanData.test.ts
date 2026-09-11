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

const FLOOR_AREA_TOTAL = 167.38;
const VOID_WEST_AREA = 11.1;
const VOID_EAST_AREA = 4.0;
const VOID_AREA_TOTAL = 15.1;
const WALL_AREA_TOTAL = 42.52;
const SIDE_B_STRIP_AREA = 18.6;

const GUEST_ROOM_NET_AREA = 10.02;
const GUEST_ROOM_GROSS_AREA = 12.72;
const GUEST_SANITAIR_BLOCK_WIDTH = 1.8;
const GUEST_SANITAIR_BLOCK_DEPTH = 1.5;

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

/** The clear rects of every space, brief + drawing Page-2, as `[minX, maxX, minZ, maxZ]`. */
const EXPECTED_RECTS: Record<SpaceId, readonly RectTuple[]> = {
  balconyA: [[0.3, 1.3, 0.3, 9.7]],
  masterBedroom: [[1.6, 6.6, 0.3, 3.7]],
  livingRoom: [[6.8, 11.8, 0.3, 3.7]],
  bedroomMaleKids: [[12.0, 17.0, 0.3, 3.7]],
  bedroomFemaleKids: [[17.2, 22.2, 0.3, 3.7]],
  stairsElevator: [[1.6, 5.3, 3.9, 5.4]],
  corridor: [[5.3, 20.2, 3.9, 5.4]],
  linkCorridor: [[1.6, 7.0, 5.6, 6.5]],
  controlCenter: [[1.6, 3.8, 6.7, 8.4]],
  guestRoom: [
    [4.0, 8.0, 6.7, 8.4],
    [7.2, 8.0, 5.6, 6.7],
    [8.0, 9.8, 5.6, 6.9],
  ],
  guestSanitair: [[8.2, 9.8, 7.1, 8.4]],
  kitchen: [[10.0, 14.0, 5.6, 8.4]],
  laundry: [[14.2, 17.4, 5.6, 8.4]],
  mainSanitair: [[17.6, 20.2, 5.6, 8.4]],
  utilityRoom: [[20.4, 22.2, 3.9, 9.7]],
  balconySlabB: [[12.7, 16.2, 8.7, 9.7]],
  voidWest: [[1.6, 12.7, 8.7, 9.7]],
  voidEast: [[16.2, 20.2, 8.7, 9.7]],
};

/** The kind of every space. */
const EXPECTED_KINDS: Record<SpaceId, SpaceKind> = {
  balconyA: 'openAir',
  masterBedroom: 'room',
  livingRoom: 'room',
  bedroomMaleKids: 'room',
  bedroomFemaleKids: 'room',
  stairsElevator: 'circulation',
  corridor: 'circulation',
  linkCorridor: 'circulation',
  controlCenter: 'room',
  guestRoom: 'room',
  guestSanitair: 'room',
  kitchen: 'room',
  laundry: 'room',
  mainSanitair: 'room',
  utilityRoom: 'room',
  balconySlabB: 'openAir',
  voidWest: 'void',
  voidEast: 'void',
};

/** Brief §8 clear areas, square metres. */
const BRIEF_AREAS: readonly (readonly [SpaceId, number])[] = [
  ['masterBedroom', 17.0],
  ['livingRoom', 17.0],
  ['bedroomMaleKids', 17.0],
  ['bedroomFemaleKids', 17.0],
  ['stairsElevator', 5.55],
  ['corridor', 22.35],
  ['linkCorridor', 4.86],
  ['controlCenter', 3.74],
  ['guestRoom', GUEST_ROOM_NET_AREA],
  ['guestSanitair', 2.08],
  ['kitchen', 11.2],
  ['laundry', 8.96],
  ['mainSanitair', 7.28],
  ['utilityRoom', 10.44],
  ['balconyA', 9.4],
  ['balconySlabB', 3.5],
];

/** Brief §8 depth chain along z at x = 15.00, from side C to side B. */
const DEPTH_CHAIN: readonly Segment[] = [
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'bedroomMaleKids', length: 3.4 },
  { kind: 'gap', length: 0.2 },
  { kind: 'space', id: 'corridor', length: 1.5 },
  { kind: 'gap', length: 0.2 },
  { kind: 'space', id: 'laundry', length: 2.8 },
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'balconySlabB', length: 1.0 },
  { kind: 'gap', length: 0.3 },
];

/** Brief §8 width chain along x at z = 2.00, from side A to side D. */
const WIDTH_CHAIN: readonly Segment[] = [
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'balconyA', length: 1.0 },
  { kind: 'gap', length: 0.3 },
  { kind: 'space', id: 'masterBedroom', length: 5.0 },
  { kind: 'gap', length: 0.2 },
  { kind: 'space', id: 'livingRoom', length: 5.0 },
  { kind: 'gap', length: 0.2 },
  { kind: 'space', id: 'bedroomMaleKids', length: 5.0 },
  { kind: 'gap', length: 0.2 },
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

  describe('brief §8 areas', () => {
    it.each(BRIEF_AREAS)('gives %s a clear area of %f m²', (id, area) => {
      expect(getSpaceArea(getSpace(FLOOR_PLAN, id))).toBeCloseTo(area, PRECISION_DIGITS);
    });

    it('gives the guest room a §4.3 gross area of net + the 1.80 × 1.50 m sanitair block', () => {
      const sanitair = getSpace(FLOOR_PLAN, 'guestSanitair').rects[0];
      const blockWidth = rectWidth(sanitair) + WALL_SPEC.partition;
      const blockDepth = rectDepth(sanitair) + WALL_SPEC.partition;
      const net = getSpaceArea(getSpace(FLOOR_PLAN, 'guestRoom'));

      expect(blockWidth).toBeCloseTo(GUEST_SANITAIR_BLOCK_WIDTH, PRECISION_DIGITS);
      expect(blockDepth).toBeCloseTo(GUEST_SANITAIR_BLOCK_DEPTH, PRECISION_DIGITS);
      expect(net).toBeCloseTo(GUEST_ROOM_NET_AREA, PRECISION_DIGITS);
      expect(net + blockWidth * blockDepth).toBeCloseTo(GUEST_ROOM_GROSS_AREA, PRECISION_DIGITS);
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

    it('has 167.38 m² of floor', () => {
      expect(floorArea).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
    });

    it('has 15.10 m² of void: 11.10 west + 4.00 east', () => {
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

    it('leaves 42.52 m² of walls', () => {
      expect(rectArea(PLOT_RECT) - floorArea - voidArea).toBeCloseTo(
        WALL_AREA_TOTAL,
        PRECISION_DIGITS,
      );
    });

    it('has an 18.60 m² side-B strip: void + balcony slab', () => {
      const slabArea = getSpaceArea(getSpace(FLOOR_PLAN, 'balconySlabB'));

      expect(voidArea + slabArea).toBeCloseTo(SIDE_B_STRIP_AREA, PRECISION_DIGITS);
    });
  });

  describe('chains', () => {
    it('matches the brief §8 depth chain at x = 15.00', () => {
      const section = crossSection(FLOOR_PLAN, 'z', DEPTH_CHAIN_X);

      expect(section).toEqual(DEPTH_CHAIN);
      expect(totalLength(section)).toBe(PLOT_DEPTH);
    });

    it('matches the brief §8 width chain at z = 2.00', () => {
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
