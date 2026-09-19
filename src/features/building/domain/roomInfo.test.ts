import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from './builtFloor.ts';
import type { BuiltFloor } from './builtFloor.ts';
import { FLOOR_PLAN, SPACE_IDS, getSpace, getSpaceBounds } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { makeBox } from './planBox.ts';
import { makeRect, rectArea } from './planGeometry.ts';
import { PORT_SCHEDULE } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { NO_DAYLIGHT_NOTE, getRoomInfo } from './roomInfo.ts';
import type { DaylightSource, RoomDoor } from './roomInfo.ts';
import { PORTS, ROOMS } from './sourceOfTruth/plan.ts';
import type { PlanRoom } from './sourceOfTruth/plan.ts';
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
  ['kitchen', 4],
  ['laundry', 5],
  // One `tv` row names the corridor, and `getFixtures` never builds it:
  // `tvPanel.ts` owns the television and re-derives it from the wall face.
  ['corridor', 0],
  ['stairs', 0],
];

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

  describe('immutability', () => {
    it.each([...SPACE_IDS])('freezes the readout of %s and its arrays', (spaceId) => {
      const info = getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT, { floor: FLOOR, spaceId });

      expect(Object.isFrozen(info)).toBe(true);
      expect(Object.isFrozen(info.ref)).toBe(true);
      expect(Object.isFrozen(info.rects)).toBe(true);
      expect(Object.isFrozen(info.doors)).toBe(true);
      expect(Object.isFrozen(info.windows)).toBe(true);
      expect(Object.isFrozen(info.fixtures)).toBe(true);
      expect(Object.isFrozen(info.openItems)).toBe(true);
      info.doors.forEach((door) => {
        expect(Object.isFrozen(door)).toBe(true);
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
