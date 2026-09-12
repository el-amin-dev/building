import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from '../domain/builtFloor.ts';
import { FLOOR_PLAN, getSpace, hasFloor, SPACE_IDS } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import type { FloorHeights } from '../domain/heights.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { rectContainsRect } from '../domain/planGeometry.ts';
import { PORT_SCHEDULE } from '../domain/ports/index.ts';
import { PARAPET_WALLS, WINDOWS } from '../domain/sourceOfTruth/plan.ts';
import {
  FLOOR_MATERIAL_KEYS,
  getCeilingLayout,
  getFixtureLayout,
  getFloorLayout,
} from './floorLayout.ts';
import { getSlabMaterialKey, MATERIAL_PALETTE } from './floorMaterials.ts';
import type { FloorMaterialKey } from './floorMaterials.ts';

const BUILT_FLOOR = getBuiltFloor();
const LAYOUT = getFloorLayout(BUILT_FLOOR);
const CEILING_LAYOUT = getCeilingLayout();

/**
 * Vertical sizes that share no value with `FLOOR_HEIGHTS`, so a test that passes with them
 * cannot be passing on a 2.70 or a 1.10 hard-coded in the layout.
 *
 * `wall` is 5 rather than the 2.70 of the real floor: the windows carry their own heads now
 * and the tallest is 2.30, so a low injected wall would be rejected outright by `windows.ts`
 * before any layout could be built.
 */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 6,
  wall: 5,
  door: 3,
  railing: 2,
});
const SYNTHETIC_FLOOR = getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, SYNTHETIC_HEIGHTS);
// The third parameter of `getFloorLayout` is the fixture list, not the heights: a layout
// takes every level from the built floor it is handed. Passing `SYNTHETIC_HEIGHTS` here
// type-checked as nothing (it was read as `readonly SpecFixture[]`) and threw
// `fixtures.filter is not a function` at module load, so this file loaded zero tests and
// every assertion below was silently unrun.
const SYNTHETIC_LAYOUT = getFloorLayout(SYNTHETIC_FLOOR, FLOOR_PLAN);

/** The real wall top: it may not appear in a layout built from other heights. */
const REAL_WALL_TOP = FLOOR_HEIGHTS.wall;
/** The real railing height, 1.10 m, which the plan now also states for the balustrade. */
const REAL_RAILING_TOP = FLOOR_HEIGHTS.railing;

/** The floor has exactly one stated parapet. */
const PARAPET_COUNT = 1;

/**
 * Height of the one parapet of the floor, in metres, read from `PARAPET_WALLS`.
 *
 * Derived, never transcribed: this number moved once already (1.00 → 1.10, ADR-011) and a
 * copy of it here would have to move again.
 *
 * It is now 1.10, the same number as `heights.railing`, because ADR-011 had the owner choose
 * 1.10 for the side-A balustrade and the plan entry carries `HEIGHTS.railing` itself rather
 * than a second literal. That equality destroyed the two guards this file used to hold — a
 * stated 1.00 against a 1.10 constant proved by itself that the split reads the stated `kind`
 * — so comparing the two is now trivially true and proves nothing at all. What the split has
 * to be proved against instead is a layout whose heights are INJECTED: see
 * {@link COINCIDENT_HEIGHTS} and the synthetic case below.
 */
const STATED_PARAPET_TOP = PARAPET_WALLS[0].height;

/**
 * Heights whose railing lands exactly on a window sill the plan declares.
 *
 * This is the rebuilt form of the guard that a 1.00 parapet used to give for free. The bug
 * it defends against is real and was shipped: a wall was called a parapet by testing whether
 * its top equalled the railing height, which found nothing once side B became an ordinary
 * exterior wall, and would have built the owner's balustrade as a full-height wall closing
 * the balcony in.
 *
 * With `railing` at 0.90 the floor really does carry ordinary wall blocks topping out at
 * exactly `heights.railing` — the blocks under the three windows the plan sills at 0.90 — so
 * a split that compared tops would sweep those into the parapet bucket, while the balustrade
 * at its stated 1.10 would drop out of it. Both halves of that failure are asserted below.
 */
const COINCIDENT_RAILING_TOP = 0.9;
const COINCIDENT_HEIGHTS: FloorHeights = Object.freeze({
  ...FLOOR_HEIGHTS,
  railing: COINCIDENT_RAILING_TOP,
});

/** Ordinary wall blocks topping out at exactly {@link COINCIDENT_RAILING_TOP}: the 0.90 sills. */
const WALL_BLOCKS_AT_COINCIDENT_RAILING = 3;

const COINCIDENT_LAYOUT = getFloorLayout(
  getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, COINCIDENT_HEIGHTS),
  FLOOR_PLAN,
);

/** The buckets that hold slabs, one per walkable space kind plus the wet rooms. */
const SLAB_KEYS: readonly FloorMaterialKey[] = [
  'slabRoom',
  'slabCirculation',
  'slabOpenAir',
  'slabWet',
];

/**
 * The spaces whose slab is tiled rather than screeded: the two bathrooms and the four bath
 * and shower cubicles inside them.
 *
 * A wet room is not a space kind — every one of these is an ordinary `room` — so this is the
 * one slab material a kind cannot choose. `floorLayout.ts` derives the set from the sanitary
 * ware the spec stands in each room; this list is that answer, pinned.
 */
const WET_SPACE_IDS: readonly SpaceId[] = [
  'guestSanitair',
  'guestBathCubicle',
  'guestShowerCubicle',
  'mainSanitair',
  'mainBathCubicle',
  'mainShowerCubicle',
];

/**
 * Every space that has a slab above it, in plan order: every room and circulation space
 * except the stairs, whose dog-leg rises through the slab above.
 *
 * Sixteen now rather than thirteen: `linkCorridor` is gone, and the four bath and shower
 * cubicles are rooms of their own and so are roofed and lit like any other.
 */
const ROOFED_SPACE_IDS: readonly SpaceId[] = [
  'masterBedroom',
  'livingRoom',
  'bedroomMaleKids',
  'bedroomFemaleKids',
  'corridor',
  'controlCenter',
  'guestRoom',
  'guestSanitair',
  'kitchen',
  'laundry',
  'mainSanitair',
  'utilityRoom',
  'guestBathCubicle',
  'guestShowerCubicle',
  'mainBathCubicle',
  'mainShowerCubicle',
];

/** The spaces open to the sky, plus the stairwell: none of them may be roofed. */
const UNROOFED_SPACE_IDS: readonly SpaceId[] = [
  'stairs',
  'balconyA',
  'ccBalcony',
  'balconySlabB',
  'voidWest',
  'voidEast',
];

/**
 * One ceiling box per clear rect of a roofed space: the corridor, the guest room and the
 * kitchen are two rects each, so nineteen boxes roof sixteen spaces.
 */
const CEILING_BOX_COUNT = 19;
/** One light panel per roofed space, whatever its number of rects. */
const LIGHT_PANEL_COUNT = 16;

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

/**
 * Returns the distinct tops of a bucket, ascending.
 *
 * @param boxes - The boxes to measure.
 * @returns Each distinct top, in increasing order.
 */
function topsOf(boxes: readonly PlanBox[]): readonly number[] {
  return [...new Set(boxes.map((box) => box.top))].sort((a, b) => a - b);
}

describe('getFloorLayout', () => {
  it('carries every key of the palette, so a renderer can map over it', () => {
    expect(Object.keys(LAYOUT)).toStrictEqual([...FLOOR_MATERIAL_KEYS]);
    expect(FLOOR_MATERIAL_KEYS).toStrictEqual(Object.keys(MATERIAL_PALETTE));
    for (const key of FLOOR_MATERIAL_KEYS) {
      expect(Array.isArray(LAYOUT[key]), key).toBe(true);
    }
  });

  it('leaves the ceilings, light panels and sanitary ware to the other two builders', () => {
    expect(LAYOUT.ceiling).toHaveLength(NONE);
    expect(LAYOUT.lightPanel).toHaveLength(NONE);
    expect(LAYOUT.sanitaryWare).toHaveLength(NONE);
    // Empty here because someone else fills them, not because there is nothing to draw.
    expect(CEILING_LAYOUT.ceiling.length).toBeGreaterThan(NONE);
    expect(getFixtureLayout().sanitaryWare.length).toBeGreaterThan(NONE);
  });

  it('splits every wall piece into the wall and parapet buckets', () => {
    expect(LAYOUT.wall.length + LAYOUT.parapet.length).toBe(BUILT_FLOOR.walls.length);
    expect(LAYOUT.parapet).toHaveLength(PARAPET_COUNT);
    expect(LAYOUT.wall.length).toBeGreaterThan(NONE);
  });

  it('splits on the kind the wall generator stated, not on the height it reached', () => {
    // The witness this case used to run on is gone, and it is worth saying why rather
    // than leaving a weaker test behind. The balustrade stood at 1.00 and ordinary wall
    // blocks topped out at 1.00 too (the pass window is silled there), so both heights
    // landed in different buckets and a top-comparing split was caught outright. At 1.10
    // no wall block tops out at the parapet's height any more — the declared sills are
    // 0.60, 0.90, 1.00 and 1.90 — so that overlap cannot be asserted at production
    // heights at all, and asserting it would fail rather than prove anything.
    expect(PARAPET_WALLS).toHaveLength(PARAPET_COUNT);
    expect(LAYOUT.parapet).toHaveLength(PARAPET_COUNT);
    for (const box of LAYOUT.parapet) {
      expect(box.top).toBe(STATED_PARAPET_TOP);
    }
    expect(topsOf(LAYOUT.wall)).not.toContain(STATED_PARAPET_TOP);
  });

  it('keeps a wall block that tops out at the railing height out of the parapet bucket', () => {
    // The overlap rebuilt where it can still exist: at `heights.railing` itself, which is
    // the level the deleted heuristic compared against. The plan sills three windows at
    // 0.90, so with the railing injected at 0.90 the floor really does carry ordinary
    // wall blocks whose top equals `heights.railing` exactly.
    //
    // A split that compared tops instead of reading `kind` fails this case twice over: it
    // would move those three sill blocks INTO the parapet bucket, and it would drop the
    // balustrade OUT of it, because the balustrade stands at the height the plan states
    // (1.10) and not at the injected railing.
    expect(WINDOWS.map((window) => window.sill)).toContain(COINCIDENT_RAILING_TOP);
    expect(COINCIDENT_HEIGHTS.railing).not.toBe(STATED_PARAPET_TOP);

    const wallBlocksAtRailing = COINCIDENT_LAYOUT.wall.filter(
      (box) => box.top === COINCIDENT_HEIGHTS.railing,
    );

    expect(wallBlocksAtRailing).toHaveLength(WALL_BLOCKS_AT_COINCIDENT_RAILING);
    expect(COINCIDENT_LAYOUT.parapet).toHaveLength(PARAPET_COUNT);
    expect(topsOf(COINCIDENT_LAYOUT.parapet)).toEqual([STATED_PARAPET_TOP]);
    for (const box of wallBlocksAtRailing) {
      expect(COINCIDENT_LAYOUT.parapet).not.toContain(box);
    }
  });

  it('keeps the stated parapet at its stated height whatever the heights say', () => {
    // Not injected: `PARAPET_WALLS` states 1.10 m, so a layout built from other heights
    // must still show 1.10. Inferring it from `heights.railing` is the bug this guards,
    // and the guard only bites while the injected railing differs from the stated height
    // — so that difference is asserted here rather than assumed of the fixture.
    expect(SYNTHETIC_HEIGHTS.railing).not.toBe(STATED_PARAPET_TOP);
    expect(SYNTHETIC_LAYOUT.parapet).toHaveLength(PARAPET_COUNT);
    for (const box of SYNTHETIC_LAYOUT.parapet) {
      expect(box.top).toBe(STATED_PARAPET_TOP);
      expect(box.top).toBe(REAL_RAILING_TOP);
      expect(box.top).not.toBe(SYNTHETIC_HEIGHTS.railing);
    }
  });

  it('reads the wall height from the given heights, with no real height left in the layout', () => {
    const tops = topsOf([...SYNTHETIC_LAYOUT.wall, ...SYNTHETIC_LAYOUT.parapet]);

    expect(tops).not.toContain(REAL_WALL_TOP);
    expect(tops).toContain(SYNTHETIC_HEIGHTS.wall);
  });

  it('keeps the threshold and the window sills of a full-height wall out of the parapet bucket', () => {
    const lowWallTops = SYNTHETIC_LAYOUT.wall
      .map((box) => box.top)
      .filter((top) => top < SYNTHETIC_HEIGHTS.wall);

    expect(lowWallTops.length).toBeGreaterThan(NONE);
    // Every low top is a threshold under a door or the sill under a window, and the sills
    // are declared per window, so they are the same in both layouts: only the wall height
    // itself follows the injected heights.
    expect(topsOf(SYNTHETIC_LAYOUT.wall).filter((top) => top < SYNTHETIC_HEIGHTS.wall)).toEqual(
      topsOf(LAYOUT.wall).filter((top) => top < REAL_WALL_TOP),
    );
  });

  it.each(SPACE_IDS)('puts the slab of %s in the bucket of its kind', (spaceId) => {
    const space = getSpace(FLOOR_PLAN, spaceId);
    const slabs = slabsOf(spaceId);

    if (!hasFloor(space.kind)) {
      expect(slabs).toHaveLength(NONE);
      return;
    }

    const expectedKey = WET_SPACE_IDS.includes(spaceId)
      ? 'slabWet'
      : getSlabMaterialKey(space.kind);
    expect(slabs.length).toBeGreaterThan(NONE);
    for (const slab of slabs) {
      expect(LAYOUT[expectedKey], expectedKey).toContain(slab);
      for (const otherKey of SLAB_KEYS.filter((key) => key !== expectedKey)) {
        expect(LAYOUT[otherKey], otherKey).not.toContain(slab);
      }
    }
  });

  it('tiles the wet rooms and nothing else', () => {
    const wetSlabSpaces = new Set(
      BUILT_FLOOR.slabs
        .filter((slab) => LAYOUT.slabWet.includes(slab))
        .map((slab) => slab.spaceId as SpaceId),
    );

    expect([...wetSlabSpaces].sort()).toEqual([...WET_SPACE_IDS].sort());
  });

  it('puts every step of the dog-leg in the stairs bucket', () => {
    expect(LAYOUT.stairs).toStrictEqual([...BUILT_FLOOR.stairs.steps]);
  });

  it('turns each railing into a box from the finished floor to its handrail', () => {
    expect(LAYOUT.railing).toHaveLength(BUILT_FLOOR.railings.length);
    expect(LAYOUT.railing.length).toBeGreaterThan(NONE);
    LAYOUT.railing.forEach((box, index) => {
      const railing = BUILT_FLOOR.railings[index];
      expect(box.rect).toBe(railing.rect);
      expect(box.bottom).toBe(NONE);
      expect(box.top).toBe(railing.top);
      expect(box.top).toBe(REAL_RAILING_TOP);
    });
  });

  it('reads the railing height from the given heights', () => {
    expect(SYNTHETIC_LAYOUT.railing.length).toBeGreaterThan(NONE);
    for (const box of SYNTHETIC_LAYOUT.railing) {
      expect(box.top).toBe(SYNTHETIC_HEIGHTS.railing);
      expect(box.top).not.toBe(REAL_RAILING_TOP);
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

  it('accounts for every space: sixteen roofed, six open to the sky', () => {
    expect(ROOFED_SPACE_IDS.length + UNROOFED_SPACE_IDS.length).toBe(FLOOR_PLAN.spaces.length);
    expect(ROOFED_SPACE_IDS.filter((id) => UNROOFED_SPACE_IDS.includes(id))).toEqual([]);
  });

  it.each(UNROOFED_SPACE_IDS)('leaves %s open to the sky', (spaceId) => {
    const rects = getSpace(FLOOR_PLAN, spaceId).rects;

    expect(rects.length).toBeGreaterThan(NONE);
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

    expect(synthetic.lightPanel.length).toBeGreaterThan(NONE);
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
