import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from './builtFloor.ts';
import type { BuiltFloor } from './builtFloor.ts';
import { FLOOR_PLAN, SPACE_IDS, getSpace, getSpaceBounds } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { isServicedSpace } from './fixtures.ts';
import { makeBox } from './planBox.ts';
import { makeRect, rectArea } from './planGeometry.ts';
import { PORT_SCHEDULE } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { NO_DAYLIGHT_NOTE, getRoomInfo } from './roomInfo.ts';
import type { DaylightSource, RoomDoor } from './roomInfo.ts';
import { getServiceRuns } from './services.ts';
import type { BuiltServiceRun } from './services.ts';
import { PORTS, ROOMS, SERVICE_LAYERS } from './sourceOfTruth/plan.ts';
import type { PlanFixtureKind, PlanRoom, PlanServiceLayerKey } from './sourceOfTruth/plan.ts';
import type { FloorWindow } from './windows.ts';

const PRECISION_DIGITS = 9;

/** The storey the panel is read on; the prefix must follow it, not be hard-coded to 1. */
const FLOOR = 2;

const BUILT = getBuiltFloor();

/**
 * Returns the port schedule entry joining two spaces, for a test that needs the
 * owner's own words without transcribing them.
 *
 * @param first - One of the two spaces.
 * @param second - The other.
 * @returns The port, which must exist.
 */
function portBetween(first: SpaceId, second: SpaceId): Port {
  const port = PORT_SCHEDULE.find(
    (candidate) => candidate.spaces.includes(first) && candidate.spaces.includes(second),
  );
  if (port === undefined) {
    throw new Error(`no port joins "${first}" and "${second}"`);
  }
  return port;
}

/**
 * Returns the source-of-truth room of a space, for its `note` and `open`.
 *
 * @param id - Identifier of the space.
 * @returns The plan room, which must exist.
 */
function planRoom(id: SpaceId): PlanRoom {
  const room = ROOMS.find((candidate) => candidate.id === id);
  if (room === undefined) {
    throw new Error(`the plan has no room "${id}"`);
  }
  return room;
}

/**
 * Builds a copy of a built floor with other windows, so the daylight derivation
 * can be shown reacting to a window that is not in the schedule.
 *
 * @param built - The built floor to copy; it is not modified.
 * @param windows - The windows the copy carries.
 * @returns A new built floor, identical but for its windows.
 */
function withWindows(built: BuiltFloor, windows: readonly FloorWindow[]): BuiltFloor {
  return { ...built, windows };
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

/**
 * A window the schedule does not contain, standing for the day the owner cuts
 * one: the living room, through its south wall, onto a space open to the sky.
 *
 * Its geometry is not the point and is not claimed to be buildable — side C is
 * blocked, which is the whole reason the room is dark — so it is not run through
 * `getWindows`. What it proves is that the derivation reads the windows it is
 * given rather than a remembered list of three dark rooms.
 */
const LIVING_ROOM_WINDOW: FloorWindow = Object.freeze({
  kind: 'light',
  spaceId: 'livingRoom',
  neighbourId: 'voidWest',
  side: 'minZ',
  along: 'x',
  spanMin: 8.0,
  spanMax: 9.2,
  sill: 0.9,
  head: 2.1,
  opening: makeBox(makeRect(8.0, 9.2, 0.0, 0.3), 0.9, 2.1),
});

/** The same window pointed at a `room`, which is not daylight and must not count. */
const INTERIOR_LIVING_ROOM_WINDOW: FloorWindow = Object.freeze({
  ...LIVING_ROOM_WINDOW,
  neighbourId: 'kitchen',
});

/**
 * Where every space of the floor takes its daylight from, hand-derived from the
 * 8 declared windows, the 19 ports and the kinds of the plan.
 *
 * In `SPACE_IDS` order, and complete, because the table is its own mutation
 * guard: `livingRoom → none` sits two rows above `masterBedroom → door` and four
 * above `kitchen → window`, so no constant answer and no "has a window?" test
 * can pass it.
 *
 * The rows worth reading twice:
 *
 * - `masterBedroom → door`. It has no window at all, by the owner's choice, and
 *   it is not dark: the balcony leaf centred on its side-A wall is its only
 *   opening. A glazing test would call it dark and be wrong.
 * - `guestRoom → door` for the same reason. Its only window is the food pass,
 *   which looks into the kitchen, so the daylight comes from its own leaf onto
 *   the side-A balcony instead.
 * - `livingRoom`, `bedroomMaleKids`, `bedroomFemaleKids → none`: the three
 *   habitable rooms of ADR-006, which touch only the blocked side C. The living
 *   room borrows nothing through its leafless 3.50 m opening because the
 *   corridor is dark too.
 * - `corridor`, `guestSanitair`, `mainSanitair`, `stairs → none` as well. That
 *   is four more than the brief's row states, and it is correct: the brief
 *   counts habitable rooms only. The sanitairs are dark because every leaf into
 *   them is a leaf — four of the six slide, and a sliding leaf is still a leaf.
 * - `balconyA`, `voidWest`, `voidEast → borrowed`, and by a route worth naming:
 *   the control center's window lends to the side-A balcony, the kitchen's to
 *   the west void, the laundry's to the east void. They are under the open sky
 *   and ought to need no lender at all; `ccBalcony` and `balconySlabB`, which no
 *   window names, come out `none` for want of one. See the finding recorded on
 *   `DaylightSource` in `roomInfo.ts`.
 */
const DAYLIGHT_TABLE: readonly (readonly [SpaceId, DaylightSource])[] = [
  ['balconyA', 'borrowed'],
  ['masterBedroom', 'door'],
  ['livingRoom', 'none'],
  ['bedroomMaleKids', 'none'],
  ['bedroomFemaleKids', 'none'],
  ['stairs', 'none'],
  ['corridor', 'none'],
  ['controlCenter', 'window'],
  ['guestRoom', 'door'],
  ['guestSanitair', 'none'],
  ['kitchen', 'window'],
  ['laundry', 'window'],
  ['mainSanitair', 'none'],
  ['utilityRoom', 'window'],
  ['ccBalcony', 'none'],
  ['balconySlabB', 'none'],
  ['voidWest', 'borrowed'],
  ['voidEast', 'borrowed'],
  ['guestBathCubicle', 'window'],
  ['mainBathCubicle', 'window'],
  ['mainShowerCubicle', 'window'],
];

/** One room's clear size and area, measured by hand off the plan's own rects. */
interface ExpectedSize {
  /** The room. */
  readonly id: SpaceId;
  /** How many rectangles the plan draws it as. */
  readonly rectCount: number;
  /** Clear floor area, in square metres, summed by hand. */
  readonly area: number;
}

/**
 * The rooms the clear size is checked on: two single-rect rooms and the three
 * the plan draws as two rectangles each.
 *
 * The three multi-rect rooms are why the clear size is the rects and not
 * `getSpaceBounds`: the corridor's bounding box is 14.60 × 2.00 = 29.20 m²
 * against its real 25.05 m², and it would state a stair hall running the whole
 * length of the floor.
 */
const EXPECTED_SIZES: readonly ExpectedSize[] = [
  { id: 'masterBedroom', rectCount: 1, area: 17.0 },
  { id: 'livingRoom', rectCount: 1, area: 17.75 },
  { id: 'corridor', rectCount: 2, area: 25.05 },
  // 11.965, not the 10.415 it had: dropping the guest shower let the suite slide
  // east, and the lower leg grew into the metre it left — 2.80 wide to 3.80, so
  // 8.10 × 0.75 + 3.80 × 1.55 rather than 8.10 × 0.75 + 2.80 × 1.55.
  { id: 'guestRoom', rectCount: 2, area: 11.965 },
  { id: 'kitchen', rectCount: 2, area: 10.38 },
];

/** How many fixtures each room stands, as `getFixtures` builds them. */
const EXPECTED_FIXTURE_COUNTS: readonly (readonly [SpaceId, number])[] = [
  ['masterBedroom', 5],
  // Five since the gas went in: the cooker is a fixture, and it is what `F1-GAS-S4`
  // ends at, so the count moved with the plan rather than with this test.
  ['kitchen', 5],
  ['laundry', 5],
  // One `tv` row names the corridor, and `getFixtures` never builds it:
  // `tvPanel.ts` owns the television and re-derives it from the wall face.
  ['corridor', 0],
  ['stairs', 0],
];

/**
 * One row of {@link SERVICE_ROLL_CALL}: a room, and the layers reaching it with
 * the fittings each lands on.
 */
type ServiceRow = readonly [
  SpaceId,
  readonly (readonly [PlanServiceLayerKey, readonly PlanFixtureKind[]])[],
];

/**
 * What every space of the floor is served by, read off the plan once and pinned.
 *
 * The whole floor rather than the four rooms the brief names, because this table
 * is the cheapest place the model has to notice a run moving: a branch re-routed
 * into another room shows up here as one changed row, and a layer quietly lost
 * shows up as an empty one. The layer keys are keys and never names — the name is
 * asserted to be `SERVICE_LAYERS`' own, which is the rule under test.
 *
 * Only the ENDS count. Several of these rows are crossed by runs they do not list
 * (`does not serve a room a run merely crosses`), which is the point.
 */
const SERVICE_ROLL_CALL: readonly ServiceRow[] = [
  // Nothing at all, and that is the plan being right rather than the derivation
  // being empty: both chamber vents now terminate at a cap. A vent discharges
  // into the open air, it does not SERVE what it discharges into.
  ['balconyA', []],
  [
    'masterBedroom',
    [
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'livingRoom',
    [
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'bedroomMaleKids',
    [
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'bedroomFemaleKids',
    [
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    // The stairwell takes the LIGHT and nothing else (owner, 2026-09-20): it is an escape
    // route with a moving stair in it, so a pipe there is a pipe somebody services standing
    // on a flight, and a leak there runs down the one way out. The light is the exception
    // because an unlit stair is more dangerous than any of that. Electricity is the only
    // layer left, and it is here for the lighting circuit alone - there is no socket.
    'stairs',
    [['electricity', []]],
  ],
  [
    'corridor',
    [
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'controlCenter',
    [
      // The heater's relief and condensate discharge, declared from the wet chamber.
      ['drainage', []],
      ['water', []],
      ['gas', []],
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'guestRoom',
    [
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'guestSanitair',
    [
      ['drainage', ['sink']],
      ['water', ['sink']],
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'kitchen',
    [
      ['drainage', ['sink']],
      ['water', ['sink']],
      ['gas', ['cooker']],
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'laundry',
    [
      // Two fittings, and the two lists are in different orders on purpose: the
      // drainage rows are declared washing machine first, the supply rows sink
      // first. Declaration order, not an order invented here.
      ['drainage', ['washingMachine', 'sink']],
      ['water', ['sink', 'washingMachine']],
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'mainSanitair',
    [
      ['drainage', ['wc', 'sink']],
      ['water', ['sink', 'wc']],
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'utilityRoom',
    [
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'ccBalcony',
    [
      // Climate alone: the outdoor cooling unit genuinely stands here. The
      // electrical chamber's vent used to be listed too and now caps instead.
      ['climate', []],
    ],
  ],
  [
    'balconySlabB',
    [
      ['water', []],
      ['electricity', []],
      ['lowVoltage', []],
      ['climate', []],
    ],
  ],
  [
    'voidWest',
    [
      // Drainage and water only, since the dry branches were re-routed to enter
      // their rooms through clear wall rather than down the side-B strip. The
      // gas, electricity, low-voltage and climate trunks still CROSS this shaft
      // — see `does not serve a room a run merely crosses`, which pins exactly
      // that — but nothing dry terminates in it any more. The stacks and the
      // supply spine genuinely are here, so those two stay.
      ['drainage', []],
      ['water', []],
    ],
  ],
  [
    'voidEast',
    [
      // Drainage and water only, and now symmetric with `voidWest`. The dry
      // trunks used to be declared as ending HERE, which was a leftover from
      // before the branches moved onto the corridor: nothing tapped them east
      // of the kitchen link, so they ran on to x 20.30 connected to nothing.
      // Each stops at its own link now, so the shaft is crossed and not served.
      ['drainage', []],
      ['water', []],
    ],
  ],
  [
    'guestBathCubicle',
    [
      ['drainage', ['bath']],
      ['water', ['bath']],
      ['electricity', []],
      ['climate', []],
    ],
  ],
  [
    'mainBathCubicle',
    [
      ['drainage', ['bath']],
      ['water', ['bath']],
      ['electricity', []],
      ['climate', []],
    ],
  ],
  [
    'mainShowerCubicle',
    [
      ['drainage', ['shower']],
      ['water', ['shower']],
      ['electricity', []],
      ['climate', []],
    ],
  ],
];

/**
 * Returns a service layer's declared display name.
 *
 * The test asks the plan for the name for the same reason the module does: a
 * string written here would be a third spelling of `Low voltage`, and a test that
 * hard-codes the label it is checking cannot catch the label changing.
 *
 * @param key - Key of the layer.
 * @returns Its `name`, which must exist.
 */
function layerName(key: PlanServiceLayerKey): string {
  const layer = SERVICE_LAYERS.find((candidate) => candidate.key === key);
  if (layer === undefined) {
    throw new Error(`the plan has no service layer "${key}"`);
  }
  return layer.name;
}

/**
 * Returns the runs of one layer that physically cross a space without ending in it.
 *
 * Deliberately the geometric test the module refuses to use — footprint overlap,
 * ignoring the ends — so that the crossing case can be shown to be REAL on this
 * plan rather than asserted to be absent from it.
 *
 * @param runs - The built runs of the floor.
 * @param layer - Which layer to look at.
 * @param id - Identifier of the space.
 * @returns The runs whose footprint overlaps the space but whose ends are elsewhere.
 */
function getCrossings(
  runs: readonly BuiltServiceRun[],
  layer: PlanServiceLayerKey,
  id: SpaceId,
): readonly BuiltServiceRun[] {
  const rects = getSpace(FLOOR_PLAN, id).rects;
  return runs.filter((run) => {
    const ends = [run.run.from, run.run.to].flatMap((end) =>
      end.at === 'space' || end.at === 'fitting' ? [end.space] : [],
    );
    return (
      run.layer === layer &&
      !ends.includes(id) &&
      run.segments.some(({ box }) =>
        rects.some(
          (rect) =>
            box.rect.minX < rect.maxX &&
            box.rect.maxX > rect.minX &&
            box.rect.minZ < rect.maxZ &&
            box.rect.maxZ > rect.minZ,
        ),
      )
    );
  });
}

/**
 * Where the low-voltage trunk that crosses `voidWest` actually terminates.
 *
 * Named rather than inlined because two assertions depend on it being the SAME room,
 * and because it has moved twice: it was `voidEast` until the dead trunk legs east of
 * the kitchen link were cut, and the run now stops at its own link on the side-B slab.
 */
const SERVED_BY_CROSSING: SpaceId = 'balconySlabB';

/** The ports of the main sanitair, in schedule order, measured by hand. */
const MAIN_SANITAIR_DOORS: readonly RoomDoor[] = [
  { partner: 'corridor', partnerName: 'Corridor', width: 0.9, kind: 'door', sliding: false },
  {
    partner: 'mainBathCubicle',
    partnerName: 'Family bath',
    width: 0.7,
    kind: 'door',
    sliding: true,
  },
  {
    partner: 'mainShowerCubicle',
    partnerName: 'Family shower',
    width: 0.65,
    kind: 'door',
    sliding: true,
  },
  { partner: 'laundry', partnerName: 'Laundry', width: 0.9, kind: 'door', sliding: false },
];

describe('getRoomInfo', () => {
  describe('identity', () => {
    it('labels a room with the one formatter, stamped with the storey it is on', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'kitchen',
      });

      expect(info.label).toBe('F2-R11/KIT · Kitchen');
      expect(info.matricule).toBe('F2-R11/KIT');
      expect(info.name).toBe('Kitchen');
      expect(info.kind).toBe('room');
      expect(info.ref).toEqual({ floor: FLOOR, spaceId: 'kitchen' });
    });

    it('follows the storey rather than hard-coding floor 1', () => {
      const ground = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: 1,
        spaceId: 'kitchen',
      });

      expect(ground.label).toBe('F1-R11/KIT · Kitchen');
      expect(ground.matricule).toBe('F1-R11/KIT');
    });

    it.each([...SPACE_IDS])('names %s with the plan’s own name and matricule', (spaceId) => {
      const space = getSpace(FLOOR_PLAN, spaceId);
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId });

      expect(info.name).toBe(space.name);
      expect(info.matricule).toBe(`F${String(FLOOR)}-${space.matricule}`);
      expect(info.label).toBe(`${info.matricule} · ${space.name}`);
    });
  });

  describe('clear size', () => {
    it.each(EXPECTED_SIZES)(
      'gives $id its $rectCount rect(s) and $area m²',
      ({ id, area, rectCount }) => {
        const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId: id });

        expect(info.rects).toEqual(getSpace(FLOOR_PLAN, id).rects);
        expect(info.rects).toHaveLength(rectCount);
        expect(info.area).toBeCloseTo(area, PRECISION_DIGITS);
        expect(info.rects.reduce((sum, rect) => sum + rectArea(rect), 0)).toBeCloseTo(
          area,
          PRECISION_DIGITS,
        );
      },
    );

    it('states the corridor rect by rect, never as the bounding box it is not', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'corridor',
      });
      const bounds = getSpaceBounds(getSpace(FLOOR_PLAN, 'corridor'));

      expect(info.rects).not.toContainEqual(bounds);
      expect(rectArea(bounds)).toBeCloseTo(29.2, PRECISION_DIGITS);
      expect(info.area).toBeLessThan(rectArea(bounds));
    });
  });

  describe('doors', () => {
    it('lists every port of the main sanitair in schedule order', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'mainSanitair',
      });

      expect(info.doors).toEqual(MAIN_SANITAIR_DOORS);
    });

    it('lists the leafless living-room opening as an opening, not a door', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'livingRoom',
      });

      expect(info.doors).toEqual([
        {
          partner: 'corridor',
          partnerName: 'Corridor',
          width: 3.5,
          kind: 'opening',
          sliding: false,
        },
      ]);
    });

    it('names the partner from the plan and carries no matricule of its own', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'masterBedroom',
      });

      expect(info.doors.map((door) => door.partnerName)).toEqual(['Side-A balcony', 'Corridor']);
      info.doors.forEach((door) => {
        expect(door.matricule).toBeUndefined();
      });
    });

    it('counts every port of the schedule exactly twice across the floor', () => {
      const listed = SPACE_IDS.reduce(
        (sum, spaceId) =>
          sum +
          getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId }).doors.length,
        0,
      );

      expect(listed).toBe(PORTS.length * 2);
    });
  });

  describe('windows and fixtures', () => {
    it('gives the kitchen both of its windows, the food pass included', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'kitchen',
      });

      expect(
        info.windows.map((window) => [window.kind, window.spaceId, window.neighbourId]),
      ).toEqual([
        ['pass', 'guestRoom', 'kitchen'],
        ['light', 'kitchen', 'voidWest'],
      ]);
    });

    it.each(EXPECTED_FIXTURE_COUNTS.map(([id, count]) => ({ id, count })))(
      'stands $count fixture(s) in $id',
      ({ id, count }) => {
        const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId: id });

        expect(info.fixtures).toHaveLength(count);
        info.fixtures.forEach((fixture) => {
          expect(fixture.spaceId).toBe(id);
        });
      },
    );
  });

  describe('daylight', () => {
    it.each(DAYLIGHT_TABLE.map(([spaceId, daylight]) => ({ spaceId, daylight })))(
      'derives $daylight for $spaceId',
      ({ spaceId, daylight }) => {
        expect(
          getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId }).daylight,
        ).toBe(daylight);
      },
    );

    it('covers every space of the floor, so the table cannot go stale', () => {
      expect(DAYLIGHT_TABLE.map(([spaceId]) => spaceId)).toEqual([...SPACE_IDS]);
    });

    it('flips the living room to window the moment it is given one', () => {
      const glazed = withWindows(BUILT, [...BUILT.windows, LIVING_ROOM_WINDOW]);
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, glazed, {
        floor: FLOOR,
        spaceId: 'livingRoom',
      });

      expect(info.daylight).toBe('window');
      expect(info.openItems).not.toContain(NO_DAYLIGHT_NOTE);
    });

    it('lets the corridor borrow through the leafless opening once the living room is lit', () => {
      const glazed = withWindows(BUILT, [...BUILT.windows, LIVING_ROOM_WINDOW]);

      expect(
        getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, glazed, { floor: FLOOR, spaceId: 'corridor' })
          .daylight,
      ).toBe('borrowed');
    });

    it('gives the living room borrowed light only, when its new window faces the kitchen', () => {
      const interior = withWindows(BUILT, [...BUILT.windows, INTERIOR_LIVING_ROOM_WINDOW]);
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, interior, {
        floor: FLOOR,
        spaceId: 'livingRoom',
      });

      expect(info.daylight).toBe('borrowed');
      expect(info.openItems).not.toContain(NO_DAYLIGHT_NOTE);
    });

    it('reads the kinds from the plan it is handed, not from a remembered one', () => {
      // Roof the west void over and it stops being sky: the kitchen loses its
      // window and falls back on its balcony leaf, and the guest bath, two hops
      // away, is left borrowing through the void from the kitchen.
      const roofedOver = withSpaceKind(FLOOR_PLAN, 'voidWest', 'room');
      const info = getRoomInfo(roofedOver, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'kitchen',
      });

      expect(info.daylight).toBe('door');
      expect(
        getRoomInfo(roofedOver, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId: 'voidWest' })
          .daylight,
      ).toBe('borrowed');
      expect(
        getRoomInfo(roofedOver, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId: 'guestBathCubicle' })
          .daylight,
      ).toBe('borrowed');
    });
  });

  describe('open items', () => {
    it('assembles the living room: its open entry, the daylight sentence, its opening', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'livingRoom',
      });

      expect(info.openItems).toEqual([
        ...(planRoom('livingRoom').open ?? []),
        NO_DAYLIGHT_NOTE,
        portBetween('livingRoom', 'corridor').why,
      ]);
    });

    it.each(['bedroomMaleKids', 'bedroomFemaleKids'] as const)(
      'assembles %s: its open entry and the daylight sentence, and no port reason',
      (spaceId) => {
        const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId });

        expect(info.openItems).toEqual([...(planRoom(spaceId).open ?? []), NO_DAYLIGHT_NOTE]);
        expect(portBetween(spaceId, 'corridor').why).toBeUndefined();
      },
    );

    it('assembles the control center: note, open entry, then both port reasons', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'controlCenter',
      });

      expect(info.openItems).toEqual([
        planRoom('controlCenter').note,
        ...(planRoom('controlCenter').open ?? []),
        portBetween('controlCenter', 'guestRoom').why,
        portBetween('controlCenter', 'ccBalcony').why,
      ]);
      expect(info.openItems).not.toContain(NO_DAYLIGHT_NOTE);
    });

    it('assembles the guest sanitair: note, two open entries, daylight, then its sliding leaf', () => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'guestSanitair',
      });

      expect(planRoom('guestSanitair').open).toHaveLength(2);
      expect(info.openItems).toEqual([
        planRoom('guestSanitair').note,
        ...(planRoom('guestSanitair').open ?? []),
        NO_DAYLIGHT_NOTE,
        portBetween('guestRoom', 'guestSanitair').why,
      ]);
    });

    it('says nothing at all about a room the plan and the schedule are silent on', () => {
      // The family bath, which the plan gives no note and no open entry, whose one
      // sliding leaf carries no reason, and which its own air window keeps off the
      // daylight sentence. It stands in for the guest shower, which used to be the
      // silent room here and is not a room any more.
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'mainBathCubicle',
      });

      expect(info.openItems).toEqual([]);
    });

    it('deduplicates, keeping the first occurrence', () => {
      const doubled: readonly Port[] = [
        ...PORT_SCHEDULE,
        Object.freeze({ ...portBetween('controlCenter', 'ccBalcony') }),
      ];
      const info = getRoomInfo(FLOOR_PLAN, doubled, BUILT, {
        floor: FLOOR,
        spaceId: 'controlCenter',
      });

      expect(info.doors).toHaveLength(3);
      expect(new Set(info.openItems).size).toBe(info.openItems.length);
    });
  });

  describe('services', () => {
    it.each(SERVICE_ROLL_CALL.map(([spaceId, expected]) => ({ spaceId, expected })))(
      'serves $spaceId',
      ({ spaceId, expected }) => {
        const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId });

        expect(
          info.services.map((service) => [service.layer, service.name, service.fittings]),
        ).toEqual(expected.map(([layer, fittings]) => [layer, layerName(layer), fittings]));
      },
    );

    it('covers every space of the plan, so no room can be added without a row here', () => {
      expect(SERVICE_ROLL_CALL.map(([spaceId]) => spaceId).toSorted()).toEqual(
        [...SPACE_IDS].toSorted(),
      );
    });

    it.each([...SPACE_IDS])('names %s its layers in SERVICE_LAYERS order', (spaceId) => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId });
      const order = info.services.map((service) =>
        SERVICE_LAYERS.findIndex((layer) => layer.key === service.layer),
      );

      expect(order).toEqual(order.toSorted((first, second) => first - second));
      expect(new Set(order).size).toBe(order.length);
    });

    it.each([...SPACE_IDS])("spells every layer of %s with the plan's own name", (spaceId) => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId });

      info.services.forEach((service) => {
        expect(service.name).toBe(layerName(service.layer));
      });
    });

    it('does not serve a room a run merely crosses', () => {
      // The west shaft, which is the sharpest case this plan has ever offered: the
      // low-voltage trunk from the electrical chamber falls straight through it on
      // its way to the east void, and `voidWest` is not on low voltage at all. It
      // WAS listed as low voltage until the dry branches were re-routed, so this
      // room is the one that proves crossing and serving are different questions
      // rather than two names for the same answer.
      //
      // The overlap is asserted and not assumed — `getCrossings` does the geometric
      // test the module refuses to do — so the day that trunk moves out of the
      // shaft, this test fails loudly instead of passing vacuously.
      const crossings = getCrossings(getServiceRuns(), 'lowVoltage', 'voidWest');
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'voidWest',
      });

      expect(crossings.length).toBeGreaterThan(0);
      expect(info.services.map((service) => service.layer)).not.toContain('lowVoltage');
    });

    it('gives a crossed room nothing and the room the run ends in the service', () => {
      // One run, two rooms, opposite answers. The low-voltage trunk crosses the west
      // shaft and ends on the side-B slab, so feeding the derivation nothing but this
      // single run separates the two questions completely: any answer that came from
      // geometry would have to give both rooms the same thing.
      const [crossing] = getCrossings(getServiceRuns(), 'lowVoltage', 'voidWest');
      const only: readonly BuiltServiceRun[] = [crossing];
      const crossed = getRoomInfo(
        FLOOR_PLAN,
        PORT_SCHEDULE,
        BUILT,
        { floor: FLOOR, spaceId: 'voidWest' },
        only,
      );
      const served = getRoomInfo(
        FLOOR_PLAN,
        PORT_SCHEDULE,
        BUILT,
        { floor: FLOOR, spaceId: SERVED_BY_CROSSING },
        only,
      );

      // The premise, asserted rather than assumed — the same discipline that keeps the
      // `getCrossings` half of the guard above from going quietly green. If this trunk
      // is re-terminated again, this line fails and names the new room, instead of the
      // assertions below passing on a room the run no longer reaches.
      expect(crossing.run.to).toEqual({ at: 'space', space: SERVED_BY_CROSSING });
      expect(crossed.services).toEqual([]);
      expect(served.services).toEqual([
        { layer: 'lowVoltage', name: layerName('lowVoltage'), fittings: [] },
      ]);
    });

    it('leaves a space nothing terminates in with no services at all', () => {
      // Balcony A, on the real plan. Both chamber vents that used to be declared
      // INTO a balcony now cap instead, so this is the model's honest answer for a
      // slab under the sky that nothing is plumbed to — and the empty list the
      // panel has to put into words.
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'balconyA',
      });

      expect(info.services).toEqual([]);
      expect(Object.isFrozen(info.services)).toBe(true);
    });

    it('says nothing at all when no run is declared', () => {
      const info = getRoomInfo(
        FLOOR_PLAN,
        PORT_SCHEDULE,
        BUILT,
        { floor: FLOOR, spaceId: 'kitchen' },
        [],
      );

      expect(info.services).toEqual([]);
    });

    it('distinguishes reaching a room from landing on a fitting in it', () => {
      // The kitchen and the void below it are both on the same three runs. One of
      // them has taps and a cooker; the other is a shaft the pipes fall down.
      const kitchen = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'kitchen',
      });
      const shaft = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'voidWest',
      });
      const waterOf = (info: {
        readonly services: readonly {
          readonly layer: string;
          readonly fittings: readonly PlanFixtureKind[];
        }[];
      }) => info.services.find((service) => service.layer === 'water')?.fittings;

      expect(waterOf(kitchen)).toEqual(['sink']);
      expect(waterOf(shaft)).toEqual([]);
    });

    it('deduplicates a fitting two runs of one layer both land on', () => {
      // The main sanitair basin is the end of a cold branch and of a hot branch.
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'mainSanitair',
      });
      const runs = getServiceRuns().filter(
        (run) =>
          run.layer === 'water' &&
          [run.run.from, run.run.to].some(
            (end) => end.at === 'fitting' && end.space === 'mainSanitair' && end.kind === 'sink',
          ),
      );

      expect(runs.length).toBeGreaterThan(1);
      expect(info.services.find((service) => service.layer === 'water')?.fittings).toEqual([
        'sink',
        'wc',
      ]);
    });

    it('leaves what STANDS in a room alone: a serviced bedroom is still not a wet room', () => {
      // Rule the finishes depend on. The master bedroom is on electricity, low
      // voltage and climate, and `isServicedSpace` must still say no — a pipe
      // reaching a bedroom is not a reason to lay marble in it.
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
        floor: FLOOR,
        spaceId: 'masterBedroom',
      });

      expect(info.services).not.toEqual([]);
      expect(isServicedSpace(BUILT.fixtures, 'masterBedroom')).toBe(false);
      expect(isServicedSpace(BUILT.fixtures, 'mainSanitair')).toBe(true);
    });
  });

  describe('immutability', () => {
    it.each([...SPACE_IDS])('freezes the readout of %s and its arrays', (spaceId) => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId });

      expect(Object.isFrozen(info)).toBe(true);
      expect(Object.isFrozen(info.ref)).toBe(true);
      expect(Object.isFrozen(info.rects)).toBe(true);
      expect(Object.isFrozen(info.doors)).toBe(true);
      expect(Object.isFrozen(info.windows)).toBe(true);
      expect(Object.isFrozen(info.fixtures)).toBe(true);
      expect(Object.isFrozen(info.services)).toBe(true);
      expect(Object.isFrozen(info.openItems)).toBe(true);
      info.doors.forEach((door) => {
        expect(Object.isFrozen(door)).toBe(true);
      });
      info.services.forEach((service) => {
        expect(Object.isFrozen(service)).toBe(true);
        expect(Object.isFrozen(service.fittings)).toBe(true);
      });
    });
  });

  describe('rejections', () => {
    it('refuses a space the plan does not hold', () => {
      expect(() =>
        getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, {
          floor: FLOOR,
          spaceId: 'pantry' as unknown as SpaceId,
        }),
      ).toThrow(RangeError);
    });

    it.each([[0], [-1], [1.5], [Number.NaN]])('refuses floor %p', (floor) => {
      expect(() =>
        getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor, spaceId: 'kitchen' }),
      ).toThrow(RangeError);
    });
  });
});
