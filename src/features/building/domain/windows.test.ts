import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, getSpace, INTERIOR_RECT } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { LENGTH_TOLERANCE, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import type { Port, PortAxis } from './ports/types.ts';
import { getWindows, WINDOW_SPEC } from './windows.ts';
import type { FloorWindow, WindowSide } from './windows.ts';

const PRECISION_DIGITS = 9;

/** Clear width of a default door leaf, in metres (brief §6). */
const DOOR_WIDTH = 0.9;
/** Clear width of the balcony-A door into the link corridor, in metres (ADR-006). */
const LINK_DOOR_WIDTH = 0.8;

/**
 * Builds a frozen door for the fixture below.
 *
 * @param first - First space of the door.
 * @param second - Second space of the door.
 * @param along - Plan axis the width runs along.
 * @param spanMin - Start of the door along `along`, in metres.
 * @param width - Clear width of the door, in metres.
 * @returns A frozen {@link Port} of kind `'door'`.
 */
function defineDoor(
  first: SpaceId,
  second: SpaceId,
  along: PortAxis,
  spanMin: number,
  width: number,
): Port {
  return Object.freeze({
    spaces: Object.freeze([first, second] as const),
    kind: 'door',
    along,
    spanMin,
    width,
  });
}

/**
 * The doors that fall on a side-A or side-B face, hand-written from brief §6 as
 * amended by ADR-006: the only ports a window can collide with.
 *
 * Only these four matter here, so the fixture stays readable and the expected
 * window table can be checked by hand. A later integration test passes the real
 * `PORT_SCHEDULE` of `ports/portSchedule.ts` to `getWindows` and must find the
 * same windows.
 *
 * - balconyA ↔ masterBedroom: z 1.85–2.75, in the side-A wall x 1.30–1.60;
 * - balconyA ↔ linkCorridor: z 5.65–6.45, in the same wall;
 * - kitchen ↔ balconySlabB: x 12.70–13.60, in the side-B wall z 8.40–8.70;
 * - laundry ↔ balconySlabB: x 15.30–16.20, in the same wall.
 */
const A_B_FACE_DOORS: readonly Port[] = Object.freeze([
  defineDoor('balconyA', 'masterBedroom', 'z', 1.85, DOOR_WIDTH),
  defineDoor('balconyA', 'linkCorridor', 'z', 5.65, LINK_DOOR_WIDTH),
  defineDoor('kitchen', 'balconySlabB', 'x', 12.7, DOOR_WIDTH),
  defineDoor('laundry', 'balconySlabB', 'x', 15.3, DOOR_WIDTH),
]);

/** One expected window: its face, its span along the face and the hole in the wall. */
interface ExpectedWindow {
  /** The room the window belongs to. */
  readonly spaceId: SpaceId;
  /** Which face of the room is glazed. */
  readonly side: WindowSide;
  /** Expected start of the window along its face, in metres. */
  readonly spanMin: number;
  /** Expected end of the window along its face, in metres. */
  readonly spanMax: number;
  /** Expected footprint of the opening: the span across the wall thickness. */
  readonly rect: PlanRect;
}

/**
 * Every window of the typical floor, worked out by hand from the plan data, the
 * wall thicknesses and {@link A_B_FACE_DOORS}, in the order `getWindows` reports
 * them.
 *
 * The side-A walls are 0.30 m (balconyA is open air), the side-B walls 0.30 m
 * (the void and the balcony slab are open air) and the utility room's side-B
 * wall is the 0.30 m exterior wall at z 9.70.
 *
 * Rooms deliberately absent:
 * - livingRoom, bedroomMaleKids, bedroomFemaleKids: their only open face is
 *   side C, which is never glazed (ADR-006: electric light);
 * - laundry: its side-B face is 3.20 m, but the balcony-slab door plus its jambs
 *   leave only 1.00 m and 1.10 m, both under the 1.20 m window;
 * - utilityRoom's `minX` face: it fronts the east void over 1.00 m only.
 */
const EXPECTED_WINDOWS: readonly ExpectedWindow[] = [
  {
    spaceId: 'masterBedroom',
    side: 'minX',
    spanMin: 0.43,
    spanMax: 1.63,
    rect: { minX: 1.3, maxX: 1.6, minZ: 0.43, maxZ: 1.63 },
  },
  {
    spaceId: 'controlCenter',
    side: 'minX',
    spanMin: 6.95,
    spanMax: 8.15,
    rect: { minX: 1.3, maxX: 1.6, minZ: 6.95, maxZ: 8.15 },
  },
  {
    spaceId: 'controlCenter',
    side: 'maxZ',
    spanMin: 2.1,
    spanMax: 3.3,
    rect: { minX: 2.1, maxX: 3.3, minZ: 8.4, maxZ: 8.7 },
  },
  {
    spaceId: 'guestRoom',
    side: 'maxZ',
    spanMin: 5.4,
    spanMax: 6.6,
    rect: { minX: 5.4, maxX: 6.6, minZ: 8.4, maxZ: 8.7 },
  },
  {
    spaceId: 'guestSanitair',
    side: 'maxZ',
    spanMin: 8.4,
    spanMax: 9.6,
    rect: { minX: 8.4, maxX: 9.6, minZ: 8.4, maxZ: 8.7 },
  },
  {
    spaceId: 'kitchen',
    side: 'maxZ',
    spanMin: 10.7,
    spanMax: 11.9,
    rect: { minX: 10.7, maxX: 11.9, minZ: 8.4, maxZ: 8.7 },
  },
  {
    spaceId: 'mainSanitair',
    side: 'maxZ',
    spanMin: 18.3,
    spanMax: 19.5,
    rect: { minX: 18.3, maxX: 19.5, minZ: 8.4, maxZ: 8.7 },
  },
  {
    spaceId: 'utilityRoom',
    side: 'maxZ',
    spanMin: 20.7,
    spanMax: 21.9,
    rect: { minX: 20.7, maxX: 21.9, minZ: 9.7, maxZ: 10 },
  },
];

/** The glazeable faces: sides C (`minZ`) and D (`maxX`) are never among them. */
const GLAZEABLE_SIDES: readonly WindowSide[] = ['minX', 'maxZ'];

/** Spaces that front open air but are not rooms, so they are never glazed. */
const UNGLAZED_SPACE_IDS: readonly SpaceId[] = [
  'balconyA',
  'balconySlabB',
  'voidWest',
  'voidEast',
  'stairs',
  'corridor',
  'linkCorridor',
];

/** Rooms whose only open face is side C, lit electrically instead (ADR-006). */
const SIDE_C_ONLY_ROOM_IDS: readonly SpaceId[] = [
  'livingRoom',
  'bedroomMaleKids',
  'bedroomFemaleKids',
];

/**
 * Vertical sizes that share no value with `FLOOR_HEIGHTS`, so a real 0.90 m sill
 * or 2.10 m head surviving injection is visible.
 */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 2.55,
  wall: 2.22,
  door: 1.88,
  railing: 0.61,
  windowSill: 0.42,
  windowHead: 1.73,
});

/**
 * The tightest wall the rule leaves between a window and a door, in metres: the
 * master-bedroom window ends at z 1.63 and its balcony door starts at z 1.85.
 *
 * Larger than `WINDOW_SPEC.minJamb` because centring the window in the 1.45 m
 * free run pushes it away from the door.
 */
const TIGHTEST_DOOR_CLEARANCE = 0.22;

/** What the kitchen window would become if the door span were not widened at all. */
const KITCHEN_SPAN_MIN_WITHOUT_JAMB = 10.75;
/** What it would become if the jamb widened the wall instead of the door. */
const KITCHEN_SPAN_MIN_WITH_SWAPPED_JAMB = 10.8;

/** The two free stretches of the laundry's side-B face, in metres, both too short. */
const LAUNDRY_FREE_RUNS: readonly number[] = [1, 1.1];

const WINDOWS = getWindows(FLOOR_PLAN, A_B_FACE_DOORS);

/**
 * Returns the window of one face of a room.
 *
 * @param spaceId - The room.
 * @param side - Which face.
 * @returns The window, or `undefined` when that face has none.
 */
function windowOf(spaceId: SpaceId, side: WindowSide): FloorWindow | undefined {
  return WINDOWS.find((window) => window.spaceId === spaceId && window.side === side);
}

/**
 * Returns the span of a window along the axis a door of the same face runs on.
 *
 * @param window - The window.
 * @returns `[min, max]` along the face, in metres.
 */
function windowSpan(window: FloorWindow): readonly [number, number] {
  return [window.spanMin, window.spanMax];
}

/**
 * Measures the solid wall between a window and a door of the same room, if they
 * share a face.
 *
 * @param window - The window.
 * @param door - The door.
 * @returns The clearance in metres, negative when the two overlap, or
 *   `undefined` when they do not share a face.
 */
function doorClearance(window: FloorWindow, door: Port): number | undefined {
  const faceAxis: PortAxis = window.side === 'minX' ? 'z' : 'x';
  if (door.along !== faceAxis || !door.spaces.includes(window.spaceId)) {
    return undefined;
  }
  const [windowMin, windowMax] = windowSpan(window);
  return toPlanLength(Math.max(door.spanMin - windowMax, windowMin - (door.spanMin + door.width)));
}

describe('windows', () => {
  describe('WINDOW_SPEC', () => {
    it('is the frozen 1.20 m window with a 0.10 m jamb (ADR-006)', () => {
      expect(WINDOW_SPEC).toEqual({ width: 1.2, minJamb: 0.1 });
      expect(Object.isFrozen(WINDOW_SPEC)).toBe(true);
    });
  });

  describe('the windows of the typical floor', () => {
    it('glazes exactly the eight expected faces, in plan order', () => {
      expect(WINDOWS.map((window) => `${window.spaceId} ${window.side}`)).toEqual(
        EXPECTED_WINDOWS.map((expected) => `${expected.spaceId} ${expected.side}`),
      );
      expect(WINDOWS).toHaveLength(EXPECTED_WINDOWS.length);
    });

    it.each(EXPECTED_WINDOWS)(
      'places the $side window of $spaceId at $spanMin–$spanMax',
      ({ spaceId, side, spanMin, spanMax, rect }) => {
        const window = windowOf(spaceId, side);

        expect(window).toBeDefined();
        expect(window?.spanMin).toBe(spanMin);
        expect(window?.spanMax).toBe(spanMax);
        expect(window?.opening.rect).toEqual(rect);
      },
    );

    it('makes every window exactly one window width wide', () => {
      WINDOWS.forEach((window) => {
        expect(window.spanMax - window.spanMin).toBeCloseTo(WINDOW_SPEC.width, PRECISION_DIGITS);
      });
    });

    it('spans the whole thickness of the wall it pierces', () => {
      WINDOWS.forEach((window) => {
        const { minX, maxX, minZ, maxZ } = window.opening.rect;
        const thickness = window.side === 'minX' ? maxX - minX : maxZ - minZ;

        expect(thickness).toBeGreaterThan(0);
        expect(window.side === 'minX' ? maxZ - minZ : maxX - minX).toBeCloseTo(
          WINDOW_SPEC.width,
          PRECISION_DIGITS,
        );
      });
    });
  });

  describe('the glazing rule', () => {
    it('never glazes side C or side D', () => {
      WINDOWS.forEach((window) => {
        expect(GLAZEABLE_SIDES).toContain(window.side);
        // Side C is the inside of the north exterior wall, side D the east one.
        expect(window.opening.rect.minZ).toBeGreaterThan(INTERIOR_RECT.minZ);
        expect(window.opening.rect.maxX).toBeLessThan(INTERIOR_RECT.maxX);
      });
    });

    it('glazes rooms only', () => {
      WINDOWS.forEach((window) => {
        expect(getSpace(FLOOR_PLAN, window.spaceId).kind).toBe('room');
      });
    });

    it.each(UNGLAZED_SPACE_IDS)('gives %s no window, whatever it fronts', (spaceId) => {
      expect(WINDOWS.filter((window) => window.spaceId === spaceId)).toEqual([]);
    });

    it.each(SIDE_C_ONLY_ROOM_IDS)('gives %s no window: it faces side C only', (spaceId) => {
      expect(WINDOWS.filter((window) => window.spaceId === spaceId)).toEqual([]);
    });

    it('gives the laundry no window: both free runs of its side-B face are too short', () => {
      expect(WINDOWS.filter((window) => window.spaceId === 'laundry')).toEqual([]);
      LAUNDRY_FREE_RUNS.forEach((run) => {
        expect(run).toBeLessThan(WINDOW_SPEC.width);
      });
    });

    it('gives the utility room a side-B window but none on its 1.00 m void face', () => {
      expect(windowOf('utilityRoom', 'maxZ')).toBeDefined();
      expect(windowOf('utilityRoom', 'minX')).toBeUndefined();
    });

    it('gives the control center one window on each of its two open faces', () => {
      expect(WINDOWS.filter((window) => window.spaceId === 'controlCenter')).toHaveLength(
        GLAZEABLE_SIDES.length,
      );
    });
  });

  describe('door clearance', () => {
    const clearances = WINDOWS.flatMap((window) =>
      A_B_FACE_DOORS.flatMap((door) => {
        const clearance = doorClearance(window, door);
        return clearance === undefined ? [] : [{ window, door, clearance }];
      }),
    );

    it('measures a clearance for the windows that share a face with a door', () => {
      expect(clearances.length).toBeGreaterThan(0);
    });

    it('never lets a window span overlap a door span', () => {
      clearances.forEach(({ clearance }) => {
        expect(clearance).toBeGreaterThan(0);
      });
    });

    it('keeps at least the jamb of solid wall, the tightest being 0.22 m', () => {
      clearances.forEach(({ clearance }) => {
        expect(clearance).toBeGreaterThanOrEqual(WINDOW_SPEC.minJamb - LENGTH_TOLERANCE);
      });

      expect(Math.min(...clearances.map(({ clearance }) => clearance))).toBe(
        TIGHTEST_DOOR_CLEARANCE,
      );
    });
  });

  describe('injected heights', () => {
    it('takes the sill and the head from the heights it is given', () => {
      const injected = getWindows(FLOOR_PLAN, A_B_FACE_DOORS, SYNTHETIC_HEIGHTS);

      expect(injected).toHaveLength(EXPECTED_WINDOWS.length);
      injected.forEach((window) => {
        expect(window.opening.bottom).toBe(SYNTHETIC_HEIGHTS.windowSill);
        expect(window.opening.top).toBe(SYNTHETIC_HEIGHTS.windowHead);
        expect(window.opening.bottom).not.toBe(FLOOR_HEIGHTS.windowSill);
        expect(window.opening.top).not.toBe(FLOOR_HEIGHTS.windowHead);
      });
    });

    it('falls back to the floor heights, a 1.20 m tall window from 0.90 m', () => {
      WINDOWS.forEach((window) => {
        expect(window.opening.bottom).toBe(FLOOR_HEIGHTS.windowSill);
        expect(window.opening.top).toBe(FLOOR_HEIGHTS.windowHead);
        expect(window.opening.top - window.opening.bottom).toBeCloseTo(
          WINDOW_SPEC.width,
          PRECISION_DIGITS,
        );
      });
    });

    it('moves no window when the heights change', () => {
      const injected = getWindows(FLOOR_PLAN, A_B_FACE_DOORS, SYNTHETIC_HEIGHTS);

      expect(injected.map((window) => window.opening.rect)).toEqual(
        WINDOWS.map((window) => window.opening.rect),
      );
    });
  });

  describe('the door table drives the result', () => {
    it('places no window at all when every port is ignored', () => {
      const withoutDoors = getWindows(FLOOR_PLAN, []);

      // The laundry's whole 3.20 m face is then free, so it gains a window.
      expect(withoutDoors.length).toBeGreaterThan(EXPECTED_WINDOWS.length);
      expect(withoutDoors.filter((window) => window.spaceId === 'laundry')).toHaveLength(1);
    });

    it('centres the kitchen window in the run the jamb-widened door leaves', () => {
      // Without the jamb the free run would be x 10.00–12.70 and the window
      // would start at 10.75; widening the wall instead of the door would give
      // 10.80. Only widening the door by the jamb on both sides gives 10.70.
      expect(windowOf('kitchen', 'maxZ')?.spanMin).toBe(EXPECTED_WINDOWS[5].spanMin);
      expect([KITCHEN_SPAN_MIN_WITHOUT_JAMB, KITCHEN_SPAN_MIN_WITH_SWAPPED_JAMB]).not.toContain(
        windowOf('kitchen', 'maxZ')?.spanMin,
      );
    });
  });

  describe('immutability', () => {
    it('returns a frozen list of frozen windows', () => {
      expect(Object.isFrozen(WINDOWS)).toBe(true);
      WINDOWS.forEach((window) => {
        expect(Object.isFrozen(window)).toBe(true);
        expect(Object.isFrozen(window.opening)).toBe(true);
        expect(Object.isFrozen(window.opening.rect)).toBe(true);
      });
    });
  });
});
