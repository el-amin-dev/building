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
import { FLOOR_MATERIAL_KEYS, getCeilingLayout, getFloorLayout } from './floorLayout.ts';
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
// A layout takes every level from the built floor it is handed, never from an argument of
// its own. That used to be easy to get wrong, because a third parameter carried the fixture
// list and a `FloorHeights` passed there type-checked as nothing and threw at module load,
// taking every assertion in this file with it silently. The parameter is gone: fixtures
// arrive on the built floor, so there is nothing left here to mistake for the heights.
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

/** The buckets that hold slabs, one per walkable space kind plus the serviced rooms. */
const SLAB_KEYS: readonly FloorMaterialKey[] = [
  'slabRoom',
  'slabCirculation',
  'slabOpenAir',
  'slabServiced',
];

/**
 * The spaces floored in marble rather than carpeted: the two bathrooms, the three bath and
 * shower cubicles inside them, the laundry, the kitchen and the control center.
 *
 * Being serviced is not a space kind — every one of these is an ordinary `room` — so this is
 * the one slab material a kind cannot choose. The set is derived from what a room holds
 * (`isServicedSpace`, `domain/fixtures.ts`); this list is that answer, pinned, and the point
 * of pinning it is that three entries could not be guessed from the word "bathroom":
 *
 * - the **laundry**, because brief §7.1 requires the hand-wash sink the owner's mother
 *   prefers to the machine, and a room with a plumbed-in basin is not carpeted;
 * - the **kitchen**, which on this floor has NO basin at all and would have stayed carpeted
 *   under the wet-room rule this replaced — its counter is dry joinery, so what makes it
 *   marble is the cooker and the fridge;
 * - the **control center**, whose one services cabinet is the gas, water and electricity
 *   risers, and a carpet in front of a riser is nobody's idea.
 *
 * Two rooms left this list on 2026-09-19 and neither left quietly:
 *
 * - `guestShowerCubicle` went with the room, which the owner dropped;
 * - the **guest room** was in here for a day and is the reason the rule was rewritten. It
 *   is a sitting room with a sofa and a coffee table, and it landed in this list only
 *   because the `passCounter` built out from the kitchen wall was classed a `fitting` and
 *   `isServicedSpace` asked "is anything here not furniture?". That question laid a
 *   bathroom floor under a sofa. `FIXTURE_ROLES` now has a fifth role, `joinery` — built
 *   in, but nothing runs to it — the pass counter and the kitchen counter are both in it,
 *   and the question is asked positively against `SERVICING_ROLES` instead. The kitchen
 *   did not move with its counter because it still has appliances; the guest room, which
 *   had nothing but carpentry and furniture, did. `fixtures.test.ts` pins the role set.
 */
const SERVICED_SPACE_IDS: readonly SpaceId[] = [
  'controlCenter',
  'guestSanitair',
  'guestBathCubicle',
  'kitchen',
  'laundry',
  'mainSanitair',
  'mainBathCubicle',
  'mainShowerCubicle',
];

/**
 * Every space that has a slab above it, in plan order: every room and circulation space
 * except the stairs, whose dog-leg rises through the slab above.
 *
 * Fifteen now. It was thirteen before `linkCorridor` went and the bath and shower cubicles
 * became rooms of their own — which is what gives them walls, doors, a ceiling and a light
 * like any other room — and sixteen until the guest shower was dropped (owner, 2026-09-19),
 * which took one room, one ceiling and one light panel off the floor with it.
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
 * kitchen are two rects each, so eighteen boxes roof fifteen spaces.
 */
const CEILING_BOX_COUNT = 18;
/** One light panel per roofed space, whatever its number of rects. */
const LIGHT_PANEL_COUNT = 15;

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

  it('leaves the ceilings and light panels to the other builder, and draws the fixtures itself', () => {
    expect(LAYOUT.ceiling).toHaveLength(NONE);
    expect(LAYOUT.lightPanel).toHaveLength(NONE);
    // Empty here because someone else fills them, not because there is nothing to draw.
    expect(CEILING_LAYOUT.ceiling.length).toBeGreaterThan(NONE);
    // The fixtures are the other way round now: they are on the built floor, so this
    // builder buckets them rather than leaving them to a second layout.
    expect(LAYOUT.sanitaryWare.length).toBeGreaterThan(NONE);
    expect(LAYOUT.joinery.length).toBeGreaterThan(NONE);
    expect(LAYOUT.appliance.length).toBeGreaterThan(NONE);
    expect(LAYOUT.worktop.length).toBeGreaterThan(NONE);
    expect(LAYOUT.softFurnishing.length).toBeGreaterThan(NONE);
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

    // A room is marble when something in it is plumbed, powered or a riser, and carpeted
    // otherwise — which no space KIND can ask for, every one of them being an ordinary
    // `room` (`isServicedSpace`, `floorLayout.ts`). Circulation and open air are decided
    // by kind above that question.
    const kindKey = getSlabMaterialKey(space.kind);
    const expectedKey =
      kindKey === 'slabRoom' && SERVICED_SPACE_IDS.includes(spaceId) ? 'slabServiced' : kindKey;
    expect(slabs.length).toBeGreaterThan(NONE);
    for (const slab of slabs) {
      expect(LAYOUT[expectedKey], expectedKey).toContain(slab);
      for (const otherKey of SLAB_KEYS.filter((key) => key !== expectedKey)) {
        expect(LAYOUT[otherKey], otherKey).not.toContain(slab);
      }
    }
  });

  it('floors the serviced rooms in marble and nothing else', () => {
    const servicedSlabSpaces = new Set(
      BUILT_FLOOR.slabs
        .filter((slab) => LAYOUT.slabServiced.includes(slab))
        .map((slab) => slab.spaceId as SpaceId),
    );

    expect([...servicedSlabSpaces].sort()).toEqual([...SERVICED_SPACE_IDS].sort());
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
    // A fixture is one to three boxes, so it contributes its parts rather than itself.
    const fixtureParts = BUILT_FLOOR.fixtures.reduce(
      (sum, fixture) => sum + fixture.parts.length,
      NONE,
    );

    // The railings are the one group converted rather than moved, so they are counted, not
    // looked up by identity: a `Railing` is a rect and a top, not a box. The fixture parts
    // are counted for the same reason, and their boxes are identity-checked below with the
    // rest, so nothing here is taken on trust twice.
    expect(bucketTotal).toBe(solids.length + BUILT_FLOOR.railings.length + fixtureParts);
    expect(countsInLayout(solids)).toStrictEqual(solids.map(() => ONCE));
    const partBoxes = BUILT_FLOOR.fixtures.flatMap((fixture) =>
      fixture.parts.map((part) => part.box),
    );
    expect(countsInLayout(partBoxes)).toStrictEqual(partBoxes.map(() => ONCE));
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

  it('accounts for every space: fifteen roofed, six open to the sky', () => {
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

/**
 * The spaces that have no slab at all: a `void` is a hole in the floor, and asking for its
 * slab material throws rather than returning a key (`getSlabMaterialKey`).
 */
const NO_SLAB = null;

/** How many spaces the plan holds, so the map below is checked against a stated number too. */
const PINNED_SPACE_COUNT = 21;

/**
 * The floor finish of the whole flat, space by space — a negative control for Part 5.
 *
 * Part 5 runs water, gas, electricity, ethernet and climate across the floor, and a run
 * crosses rooms it has no business re-flooring: a pipe in the ceiling void of a bedroom must
 * leave that bedroom carpeted. The question "is this room serviced?" is asked of what STANDS
 * in a room — `SERVICING_ROLES` is `fitting` · `appliance` · `services` (`isServicedSpace`,
 * `domain/fixtures.ts`) — and it is deliberately NOT taught about runs. This map is the cheap
 * guard on that: it pins the bucket every slab lands in today, so the wave that lets a run
 * reach the finish fails here in one line instead of the owner finding marble in a bedroom.
 *
 * ADR-021 is the precedent, and it is the reason this is worth a whole map rather than a spot
 * check. The rule was once asked negatively — "is anything in here not furniture?" — and the
 * guest room's dry pass counter answered yes, which laid a bathroom floor under a sofa. The
 * defect was one space wide and invisible from any aggregate; only reading the finish of
 * every space catches the next one of that shape.
 *
 * Written out longhand on purpose: derived from the plan it would just restate the code it is
 * meant to watch, and a reviewer should be able to read the floor of the flat in one screen.
 * `null` is not "unknown" but "no slab": the two voids are holes.
 */
const SPACE_SLAB_MATERIAL: Readonly<Record<SpaceId, FloorMaterialKey | typeof NO_SLAB>> =
  Object.freeze({
    // Open to the sky: decided by kind, above the serviced question.
    balconyA: 'slabOpenAir',
    ccBalcony: 'slabOpenAir',
    balconySlabB: 'slabOpenAir',
    // Circulation: boarded whatever stands in it. The stair bay is `stairwell` in the source
    // of truth and `circulation` in the model, so it is boarded like the corridor.
    stairs: 'slabCirculation',
    corridor: 'slabCirculation',
    // Carpeted rooms: nothing in them is plumbed, powered or a riser.
    masterBedroom: 'slabRoom',
    livingRoom: 'slabRoom',
    bedroomMaleKids: 'slabRoom',
    bedroomFemaleKids: 'slabRoom',
    guestRoom: 'slabRoom',
    utilityRoom: 'slabRoom',
    // Marble rooms: every one an ordinary `room`, told apart only by what stands in it.
    controlCenter: 'slabServiced',
    guestSanitair: 'slabServiced',
    guestBathCubicle: 'slabServiced',
    kitchen: 'slabServiced',
    laundry: 'slabServiced',
    mainSanitair: 'slabServiced',
    mainBathCubicle: 'slabServiced',
    mainShowerCubicle: 'slabServiced',
    // Holes in the floor.
    voidWest: NO_SLAB,
    voidEast: NO_SLAB,
  });

/**
 * Returns the spaces whose slabs a bucket holds.
 *
 * Read off the built floor rather than the bucket, because a bucket holds bare boxes: only a
 * slab carries the id of the space it floors.
 *
 * @param key - The slab bucket to look in.
 * @returns Each space with a slab in that bucket, once, sorted.
 */
function spacesFlooredIn(key: FloorMaterialKey): readonly SpaceId[] {
  const spaceIds = BUILT_FLOOR.slabs
    .filter((slab) => LAYOUT[key].includes(slab))
    .map((slab) => slab.spaceId as SpaceId);
  return [...new Set(spaceIds)].sort();
}

describe('the floor finish of every space (negative control for Part 5)', () => {
  it.each(SPACE_IDS)('floors %s in the material pinned for it', (spaceId) => {
    const expectedKey = SPACE_SLAB_MATERIAL[spaceId];
    const slabs = slabsOf(spaceId);

    if (expectedKey === NO_SLAB) {
      expect(slabs).toHaveLength(NONE);
      return;
    }

    expect(slabs.length).toBeGreaterThan(NONE);
    for (const slab of slabs) {
      expect(LAYOUT[expectedKey], expectedKey).toContain(slab);
      for (const otherKey of SLAB_KEYS.filter((key) => key !== expectedKey)) {
        expect(LAYOUT[otherKey], `${spaceId} in ${otherKey}`).not.toContain(slab);
      }
    }
  });

  it('pins every space of the plan, so a twenty-second space cannot slip through', () => {
    expect(Object.keys(SPACE_SLAB_MATERIAL).sort()).toEqual([...SPACE_IDS].sort());
    expect(FLOOR_PLAN.spaces.map((space) => space.id).sort()).toEqual([...SPACE_IDS].sort());
    expect(SPACE_IDS).toHaveLength(PINNED_SPACE_COUNT);
    // And no slab of the floor floors a space the map calls a hole.
    for (const slab of BUILT_FLOOR.slabs) {
      expect(SPACE_SLAB_MATERIAL[slab.spaceId as SpaceId], slab.spaceId).not.toBe(NO_SLAB);
    }
  });

  it('gives every bucket exactly the spaces the map names, and no space two buckets', () => {
    for (const key of SLAB_KEYS) {
      const expectedSpaces = SPACE_IDS.filter((id) => SPACE_SLAB_MATERIAL[id] === key);

      expect(spacesFlooredIn(key), key).toEqual([...expectedSpaces].sort());
    }
    // The same statement from the slab's side, and over EVERY key rather than the slab ones:
    // a slab that also turned up in a Part 5 service bucket would be drawn twice and would
    // take that run's material with it. One bucket each, never two.
    for (const slab of BUILT_FLOOR.slabs) {
      const buckets = FLOOR_MATERIAL_KEYS.filter((key) => LAYOUT[key].includes(slab));

      expect(buckets, slab.spaceId).toEqual([SPACE_SLAB_MATERIAL[slab.spaceId as SpaceId]]);
    }
  });

  it('keeps the marble on the serviced rooms and the carpet everywhere else', () => {
    // The map and the serviced list are two readings of the same rule, so they have to agree:
    // if a Part 5 run ever reaches the finish, one of them moves and this fails.
    const marble = SPACE_IDS.filter((id) => SPACE_SLAB_MATERIAL[id] === 'slabServiced');

    expect([...marble].sort()).toEqual([...SERVICED_SPACE_IDS].sort());
    for (const spaceId of SPACE_IDS.filter((id) => SPACE_SLAB_MATERIAL[id] === 'slabRoom')) {
      expect(SERVICED_SPACE_IDS, spaceId).not.toContain(spaceId);
    }
  });
});
