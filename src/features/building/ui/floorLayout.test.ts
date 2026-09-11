import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from '../domain/builtFloor.ts';
import { FLOOR_PLAN, getSpace, hasFloor, SPACE_IDS } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import type { FloorHeights } from '../domain/heights.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { rectContainsRect } from '../domain/planGeometry.ts';
import { PORT_SCHEDULE } from '../domain/ports/index.ts';
import { FLOOR_MATERIAL_KEYS, getCeilingLayout, getFloorLayout } from './floorLayout.ts';
import { getSlabMaterialKey, MATERIAL_PALETTE } from './floorMaterials.ts';
import type { FloorMaterialKey } from './floorMaterials.ts';

const BUILT_FLOOR = getBuiltFloor();
const LAYOUT = getFloorLayout(BUILT_FLOOR);
const CEILING_LAYOUT = getCeilingLayout();

/**
 * Vertical sizes that share no value with `FLOOR_HEIGHTS`, so a test that passes with them
 * cannot be passing on a 2.70 or a 1.10 hard-coded in the layout.
 */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 6,
  wall: 5,
  door: 3,
  railing: 2,
  windowSill: 1,
  windowHead: 3,
});
const SYNTHETIC_FLOOR = getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, SYNTHETIC_HEIGHTS);
const SYNTHETIC_LAYOUT = getFloorLayout(SYNTHETIC_FLOOR, FLOOR_PLAN, SYNTHETIC_HEIGHTS);

/** The real wall and parapet tops: neither may appear in a layout built from other heights. */
const REAL_WALL_TOP = FLOOR_HEIGHTS.wall;
const REAL_PARAPET_TOP = FLOOR_HEIGHTS.railing;

/** The buckets that hold slabs, one per walkable space kind. */
const SLAB_KEYS: readonly FloorMaterialKey[] = ['slabRoom', 'slabCirculation', 'slabOpenAir'];

/**
 * Every space that has a slab above it, hand-written from the plan (brief §4): the four
 * bedrooms and the living room, the corridor and the link corridor, and the service row.
 * The stairs are circulation too but rise through the slab above, so they are not here.
 */
const ROOFED_SPACE_IDS: readonly SpaceId[] = [
  'masterBedroom',
  'livingRoom',
  'bedroomMaleKids',
  'bedroomFemaleKids',
  'corridor',
  'linkCorridor',
  'controlCenter',
  'guestRoom',
  'guestSanitair',
  'kitchen',
  'laundry',
  'mainSanitair',
  'utilityRoom',
];

/** The spaces open to the sky, plus the stairwell: none of them may be roofed. */
const UNROOFED_SPACE_IDS: readonly SpaceId[] = [
  'stairs',
  'balconyA',
  'balconySlabB',
  'voidWest',
  'voidEast',
];

/** One ceiling box per clear rect of a roofed space: the guest room's L is three rects. */
const CEILING_BOX_COUNT = 15;
/** One light panel per roofed space, whatever its number of rects. */
const LIGHT_PANEL_COUNT = 13;

const ONCE = 1;
const NONE = 0;

/**
 * Counts how many times each box object appears across the buckets of a layout.
 *
 * Identity, not equality: it proves the layout moved the very boxes the built floor holds,
 * rather than copies of them, and that it moved each of them exactly once.
 *
 * @param boxes - The boxes to look for.
 * @returns How many buckets of {@link LAYOUT} hold each box, in the order given.
 */
function countsInLayout(boxes: readonly PlanBox[]): readonly number[] {
  const placed = FLOOR_MATERIAL_KEYS.flatMap((key) => [...LAYOUT[key]]);
  return boxes.map((box) => placed.filter((candidate) => candidate === box).length);
}

/**
 * Returns the slabs of one space.
 *
 * @param spaceId - The space whose slabs are wanted.
 * @returns Its slabs, in built-floor order.
 */
function slabsOf(spaceId: SpaceId): readonly PlanBox[] {
  return BUILT_FLOOR.slabs.filter((slab) => slab.spaceId === spaceId);
}

/**
 * Returns every rect the ceilings of a layout cover.
 *
 * @returns The footprint of each ceiling box, in order.
 */
function ceilingRects() {
  return CEILING_LAYOUT.ceiling.map((box) => box.rect);
}

describe('getFloorLayout', () => {
  it('carries every key of the palette, so a renderer can map over it', () => {
    expect(Object.keys(LAYOUT)).toStrictEqual([...FLOOR_MATERIAL_KEYS]);
    expect(FLOOR_MATERIAL_KEYS).toStrictEqual(Object.keys(MATERIAL_PALETTE));
    for (const key of FLOOR_MATERIAL_KEYS) {
      expect(Array.isArray(LAYOUT[key]), key).toBe(true);
    }
  });

  it('leaves the ceiling and light-panel buckets to getCeilingLayout', () => {
    expect(LAYOUT.ceiling).toHaveLength(NONE);
    expect(LAYOUT.lightPanel).toHaveLength(NONE);
  });

  it('splits every wall piece into the wall and parapet buckets', () => {
    expect(LAYOUT.wall.length + LAYOUT.parapet.length).toBe(BUILT_FLOOR.walls.length);
    expect(LAYOUT.parapet.length).toBeGreaterThan(NONE);
    expect(LAYOUT.wall.length).toBeGreaterThan(NONE);
  });

  it('calls a piece a parapet when it rises to the injected railing height', () => {
    expect(SYNTHETIC_LAYOUT.parapet.length).toBeGreaterThan(NONE);
    for (const box of SYNTHETIC_LAYOUT.parapet) {
      expect(box.top).toBe(SYNTHETIC_HEIGHTS.railing);
    }
    for (const box of SYNTHETIC_LAYOUT.wall) {
      expect(box.top).not.toBe(SYNTHETIC_HEIGHTS.railing);
    }
  });

  it('reads the split from the given heights, with no real height left in the layout', () => {
    const tops = [...SYNTHETIC_LAYOUT.wall, ...SYNTHETIC_LAYOUT.parapet].map((box) => box.top);

    expect(tops).not.toContain(REAL_WALL_TOP);
    expect(tops).not.toContain(REAL_PARAPET_TOP);
    expect(tops).toContain(SYNTHETIC_HEIGHTS.wall);
    expect(tops).toContain(SYNTHETIC_HEIGHTS.railing);
  });

  it('keeps the threshold and the sill of a full-height wall out of the parapet bucket', () => {
    const lowWallTops = SYNTHETIC_LAYOUT.wall
      .map((box) => box.top)
      .filter((top) => top < SYNTHETIC_HEIGHTS.railing);

    expect(lowWallTops.length).toBeGreaterThan(NONE);
    expect(lowWallTops).toContain(SYNTHETIC_HEIGHTS.windowSill);
  });

  it.each(SPACE_IDS)('puts the slab of %s in the bucket of its kind', (spaceId) => {
    const space = getSpace(FLOOR_PLAN, spaceId);
    const slabs = slabsOf(spaceId);

    if (!hasFloor(space.kind)) {
      expect(slabs).toHaveLength(NONE);
      return;
    }

    const expectedKey = getSlabMaterialKey(space.kind);
    expect(slabs.length).toBeGreaterThan(NONE);
    for (const slab of slabs) {
      expect(LAYOUT[expectedKey], expectedKey).toContain(slab);
      for (const otherKey of SLAB_KEYS.filter((key) => key !== expectedKey)) {
        expect(LAYOUT[otherKey], otherKey).not.toContain(slab);
      }
    }
  });

  it('puts every step of the dog-leg in the stairs bucket', () => {
    expect(LAYOUT.stairs).toStrictEqual([...BUILT_FLOOR.stairs.steps]);
  });

  it('turns each railing into a box from the finished floor to its handrail', () => {
    expect(LAYOUT.railing).toHaveLength(BUILT_FLOOR.railings.length);
    LAYOUT.railing.forEach((box, index) => {
      const railing = BUILT_FLOOR.railings[index];
      expect(box.rect).toBe(railing.rect);
      expect(box.bottom).toBe(NONE);
      expect(box.top).toBe(railing.top);
    });
  });

  it('reads the railing height from the given heights', () => {
    for (const box of SYNTHETIC_LAYOUT.railing) {
      expect(box.top).toBe(SYNTHETIC_HEIGHTS.railing);
      expect(box.top).not.toBe(REAL_PARAPET_TOP);
    }
  });

  it('puts the television panel in its own bucket', () => {
    expect(LAYOUT.tvPanel).toHaveLength(ONCE);
    expect(LAYOUT.tvPanel[0]).toBe(BUILT_FLOOR.tvPanel);
  });

  it('loses and duplicates nothing between the built floor and the layout', () => {
    const solids = [
      ...BUILT_FLOOR.walls,
      ...BUILT_FLOOR.slabs,
      ...BUILT_FLOOR.stairs.steps,
      BUILT_FLOOR.tvPanel,
    ];
    const bucketTotal = FLOOR_MATERIAL_KEYS.reduce((sum, key) => sum + LAYOUT[key].length, NONE);

    // The railings are the one group converted rather than moved, so they are counted, not
    // looked up by identity: a `Railing` is a rect and a top, not a box.
    expect(bucketTotal).toBe(solids.length + BUILT_FLOOR.railings.length);
    expect(countsInLayout(solids)).toStrictEqual(solids.map(() => ONCE));
  });

  it('freezes the layout and each of its buckets', () => {
    expect(Object.isFrozen(LAYOUT)).toBe(true);
    for (const key of FLOOR_MATERIAL_KEYS) {
      expect(Object.isFrozen(LAYOUT[key]), key).toBe(true);
    }
  });

  it('gives an equal layout on every call, so a caller can memoise it', () => {
    expect(getFloorLayout(BUILT_FLOOR)).toStrictEqual(LAYOUT);
    expect(getFloorLayout(getBuiltFloor())).toStrictEqual(LAYOUT);
  });
});

describe('getCeilingLayout', () => {
  it('roofs every roofed space, once per clear rect', () => {
    const expected = ROOFED_SPACE_IDS.flatMap((spaceId) => [
      ...getSpace(FLOOR_PLAN, spaceId).rects,
    ]);

    expect(ceilingRects()).toStrictEqual(expected);
    expect(CEILING_LAYOUT.ceiling).toHaveLength(CEILING_BOX_COUNT);
    expect(ROOFED_SPACE_IDS).toHaveLength(LIGHT_PANEL_COUNT);
  });

  it.each(UNROOFED_SPACE_IDS)('leaves %s open to the sky', (spaceId) => {
    const rects = getSpace(FLOOR_PLAN, spaceId).rects;

    for (const rect of rects) {
      expect(ceilingRects()).not.toContain(rect);
    }
  });

  it('spans every ceiling from the wall height up to the floor-to-floor height', () => {
    const synthetic = getCeilingLayout(FLOOR_PLAN, SYNTHETIC_HEIGHTS);

    for (const box of CEILING_LAYOUT.ceiling) {
      expect(box.bottom).toBe(FLOOR_HEIGHTS.wall);
      expect(box.top).toBe(FLOOR_HEIGHTS.floorToFloor);
    }
    for (const box of synthetic.ceiling) {
      expect(box.bottom).toBe(SYNTHETIC_HEIGHTS.wall);
      expect(box.top).toBe(SYNTHETIC_HEIGHTS.floorToFloor);
    }
  });

  it('hangs one light panel per roofed space, inside it and below its ceiling', () => {
    expect(CEILING_LAYOUT.lightPanel).toHaveLength(LIGHT_PANEL_COUNT);

    CEILING_LAYOUT.lightPanel.forEach((panel, index) => {
      const space = getSpace(FLOOR_PLAN, ROOFED_SPACE_IDS[index]);
      const inside = space.rects.some((rect) => rectContainsRect(rect, panel.rect));

      expect(inside, space.id).toBe(true);
      expect(panel.top).toBeLessThanOrEqual(FLOOR_HEIGHTS.wall);
      expect(panel.bottom).toBeLessThan(panel.top);
      expect(panel.bottom).toBeGreaterThan(NONE);
    });
  });

  it('reads the panel height from the given heights', () => {
    const synthetic = getCeilingLayout(FLOOR_PLAN, SYNTHETIC_HEIGHTS);

    for (const panel of synthetic.lightPanel) {
      expect(panel.top).toBe(SYNTHETIC_HEIGHTS.wall);
      expect(panel.top).not.toBe(REAL_WALL_TOP);
    }
  });

  it('freezes the ceiling layout and both of its buckets', () => {
    expect(Object.isFrozen(CEILING_LAYOUT)).toBe(true);
    expect(Object.isFrozen(CEILING_LAYOUT.ceiling)).toBe(true);
    expect(Object.isFrozen(CEILING_LAYOUT.lightPanel)).toBe(true);
  });

  it('gives an equal layout on every call', () => {
    expect(getCeilingLayout()).toStrictEqual(CEILING_LAYOUT);
  });

  it('rejects heights that leave no room for a ceiling', () => {
    const noCeiling: FloorHeights = Object.freeze({
      ...FLOOR_HEIGHTS,
      wall: FLOOR_HEIGHTS.floorToFloor,
    });

    expect(() => getCeilingLayout(FLOOR_PLAN, noCeiling)).toThrow(RangeError);
  });
});
