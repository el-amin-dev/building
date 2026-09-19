import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, SPACE_IDS, getNeighbours, getSpace } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { LENGTH_TOLERANCE, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { PORT_SCHEDULE } from './ports/index.ts';
import type { Port, PortAxis } from './ports/index.ts';
import { getWindows, getWindowsOf, WINDOW_SPEC } from './windows.ts';
import type { FloorWindow, WindowKind, WindowSide } from './windows.ts';

const PRECISION_DIGITS = 9;

/** One expected window: where the schedule puts it and the hole it cuts. */
interface ExpectedWindow {
  /** What the window is for, which fixes its sill and head. */
  readonly kind: WindowKind;
  /** The room the window is measured from. */
  readonly spaceId: SpaceId;
  /** The space on the other side of the wall. */
  readonly neighbourId: SpaceId;
  /** Which face of the room is pierced. */
  readonly side: WindowSide;
  /** The plan axis the width runs along. */
  readonly along: PortAxis;
  /** Expected start of the window along its face, in metres. */
  readonly spanMin: number;
  /** Expected end of the window along its face, in metres. */
  readonly spanMax: number;
  /** Expected sill above the finished floor, in metres. */
  readonly sill: number;
  /** Expected head above the finished floor, in metres. */
  readonly head: number;
  /** Thickness of the wall the window pierces, in metres. */
  readonly thickness: number;
  /** Expected footprint of the opening: the span across the wall thickness. */
  readonly rect: PlanRect;
}

/**
 * Every window of the typical floor, in the order `getWindows` reports them,
 * which is the order of the declared schedule (`sourceOfTruth/plan.ts`).
 *
 * v1 derived these: one 1.20 × 1.20 opening per room per glazeable face, centred
 * in the longest run the doors left free. Nothing is derived any more — the
 * owner asked for purposeful openings, so each one carries its own width, sill
 * and head, and this table is the realised schedule measured off the plan.
 *
 * Three kinds, at three heights: `air` is a bathroom vent above eye level
 * (1.90–2.30), `pass` is the tunnel that hands food and coffee to the guests at
 * counter height (1.00–1.80), and `light` is daylight (0.90–2.10, and 0.60–2.30
 * in the laundry, which the owner wanted "completely open light" and which can
 * only be given height because its wall has no width to spare).
 */
const EXPECTED_WINDOWS: readonly ExpectedWindow[] = [
  {
    kind: 'light',
    spaceId: 'controlCenter',
    neighbourId: 'balconyA',
    side: 'minX',
    along: 'z',
    spanMin: 7.5,
    spanMax: 8.4,
    sill: 0.9,
    head: 2.1,
    thickness: 0.3,
    rect: { minX: 1.3, maxX: 1.6, minZ: 7.5, maxZ: 8.4 },
  },
  {
    kind: 'pass',
    spaceId: 'guestRoom',
    neighbourId: 'kitchen',
    side: 'maxX',
    along: 'z',
    // Narrowed from 0.65 to 0.55 when the pass became the bore of a 1.00 m
    // tunnel: the `passCounter` fixture builds the other 0.70 out from the
    // guest-room face, and 0.55 leaves 0.10 of masonry jamb at each end of the
    // 0.75 m host face for those built-out cheeks to be built against. It is
    // still centred on z 6.675, which is why the balcony door in the opposite
    // wall still overlaps it — see the opposite-walls test below.
    spanMin: 6.4,
    spanMax: 6.95,
    sill: 1.0,
    head: 1.8,
    thickness: 0.3,
    rect: { minX: 9.7, maxX: 10.0, minZ: 6.4, maxZ: 6.95 },
  },
  {
    kind: 'air',
    spaceId: 'guestBathCubicle',
    neighbourId: 'voidWest',
    side: 'maxZ',
    along: 'x',
    // Moved east with the whole guest suite when the shower was dropped: the
    // cubicle is x 8.05–9.85 now, not 7.05–8.70. The vent kept its 0.60 width.
    spanMin: 8.6,
    spanMax: 9.2,
    sill: 1.9,
    head: 2.3,
    thickness: 0.3,
    rect: { minX: 8.6, maxX: 9.2, minZ: 8.6, maxZ: 8.9 },
  },
  {
    kind: 'light',
    spaceId: 'kitchen',
    neighbourId: 'voidWest',
    side: 'maxZ',
    along: 'x',
    spanMin: 10.1,
    spanMax: 11.5,
    sill: 0.9,
    head: 2.1,
    thickness: 0.3,
    rect: { minX: 10.1, maxX: 11.5, minZ: 8.6, maxZ: 8.9 },
  },
  {
    kind: 'light',
    spaceId: 'laundry',
    neighbourId: 'voidEast',
    side: 'maxZ',
    along: 'x',
    spanMin: 15.4,
    spanMax: 17.3,
    sill: 0.6,
    head: 2.3,
    thickness: 0.3,
    rect: { minX: 15.4, maxX: 17.3, minZ: 8.6, maxZ: 8.9 },
  },
  {
    kind: 'air',
    spaceId: 'mainBathCubicle',
    neighbourId: 'voidEast',
    side: 'maxZ',
    along: 'x',
    spanMin: 18.1,
    spanMax: 18.8,
    sill: 1.9,
    head: 2.3,
    thickness: 0.3,
    rect: { minX: 18.1, maxX: 18.8, minZ: 8.6, maxZ: 8.9 },
  },
  {
    kind: 'air',
    spaceId: 'mainShowerCubicle',
    neighbourId: 'voidEast',
    side: 'maxZ',
    along: 'x',
    spanMin: 19.6,
    spanMax: 20.2,
    sill: 1.9,
    head: 2.3,
    thickness: 0.3,
    rect: { minX: 19.6, maxX: 20.2, minZ: 8.6, maxZ: 8.9 },
  },
  {
    kind: 'light',
    spaceId: 'utilityRoom',
    neighbourId: 'voidEast',
    side: 'minX',
    along: 'z',
    spanMin: 8.95,
    spanMax: 9.65,
    sill: 0.9,
    head: 2.1,
    // The one window not in a 0.30 wall: the owner kept the drawn 0.20 m wall
    // between the utility room and the east void (ADR-006, join override).
    thickness: 0.2,
    rect: { minX: 20.3, maxX: 20.5, minZ: 8.95, maxZ: 9.65 },
  },
];

/**
 * Every space the schedule gives no window of its own, exhaustively.
 *
 * Together with the eight hosts of {@link EXPECTED_WINDOWS} this covers all 21
 * spaces. The master bedroom is here on purpose and is the interesting one: it
 * has an open face onto the side-A balcony and v1 glazed it, but the owner asked
 * for no window at all, so its balcony door is its only opening.
 */
const UNGLAZED_SPACE_IDS: readonly SpaceId[] = [
  'balconyA',
  'masterBedroom',
  'livingRoom',
  'bedroomMaleKids',
  'bedroomFemaleKids',
  'stairs',
  'corridor',
  'guestSanitair',
  'mainSanitair',
  'ccBalcony',
  'balconySlabB',
  'voidWest',
  'voidEast',
];

/** The kinds of space a window may look out onto, for every window but the `pass`. */
const OPEN_AIR_KINDS: readonly string[] = ['openAir', 'void'];

/**
 * Vertical sizes that share no value with `FLOOR_HEIGHTS` and leave every head
 * under the wall, so a sill or head leaking out of the heights is visible.
 *
 * `FloorHeights` no longer has a `windowSill` or a `windowHead` to leak: every
 * window carries its own pair, declared in the WINDOW SCHEDULE. What is left to
 * check is that the schedule's levels are the ones that come out, whatever
 * heights go in.
 */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 2.8,
  wall: 2.5,
  door: 1.88,
  railing: 0.61,
});

/** A wall too low for the 2.30 m heads of the air windows and the laundry glazing. */
const TOO_LOW_WALL = 2.2;

/**
 * The tightest wall the schedule leaves between a window and a door of the same
 * face, in metres: the laundry's glazing starts at x 15.40 and its balcony door
 * ends at 15.20.
 */
const TIGHTEST_DOOR_CLEARANCE = 0.2;

/**
 * The v1 position of the laundry's balcony door, before the owner swapped it
 * with the glazing, in metres.
 *
 * A door there would run 15.30–16.20, straight through the declared window, so
 * feeding it to `getWindows` must be rejected.
 */
const CLASHING_DOOR_SPAN_MIN = 15.3;
/** Clear width of that door, in metres. */
const CLASHING_DOOR_WIDTH = 0.9;

const WINDOWS = getWindows(FLOOR_PLAN, PORT_SCHEDULE);

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
 * Returns the extent of a window's opening along the axis its width runs on.
 *
 * @param window - The window.
 * @returns The length of the hole along `window.along`, in metres.
 */
function openingWidth(window: FloorWindow): number {
  const { minX, maxX, minZ, maxZ } = window.opening.rect;
  return window.along === 'x' ? maxX - minX : maxZ - minZ;
}

/**
 * Returns the thickness of the wall a window pierces, across its face.
 *
 * @param window - The window.
 * @returns The extent of the hole across the wall, in metres.
 */
function openingThickness(window: FloorWindow): number {
  const { minX, maxX, minZ, maxZ } = window.opening.rect;
  return window.along === 'x' ? maxZ - minZ : maxX - minX;
}

/**
 * Lists the ports that share a face with a window: same axis, and the port's
 * other space is a neighbour across that very face.
 *
 * The face test is what keeps the guest room's balcony door away from its
 * kitchen tunnel. Both run along z over exactly z 6.35–7.00, but the door is in
 * the room's `minX` wall and the window in its `maxX` wall, so they never meet.
 *
 * @param window - The window.
 * @param ports - The port schedule to search.
 * @returns The ports in the same face, with their spans.
 */
function portsInFaceOf(
  window: FloorWindow,
  ports: readonly Port[],
): readonly { readonly port: Port; readonly min: number; readonly max: number }[] {
  const faceNeighbours = new Set(
    getNeighbours(FLOOR_PLAN, window.spaceId)
      .filter((contact) => contact.side === window.side)
      .map((contact) => contact.neighbourId),
  );
  return ports.flatMap((port) => {
    const [first, second] = port.spaces;
    if (port.along !== window.along || !port.spaces.includes(window.spaceId)) {
      return [];
    }
    const other = first === window.spaceId ? second : first;
    if (!faceNeighbours.has(other)) {
      return [];
    }
    return [{ port, min: port.spanMin, max: toPlanLength(port.spanMin + port.width) }];
  });
}

describe('windows', () => {
  describe('WINDOW_SPEC', () => {
    it('is the frozen jamb and clearance rule, with no width or height of its own', () => {
      // v1 also carried `width: 1.2`, because every window was the same window. The
      // schedule gives each one its own width, sill and head now, so a width here
      // would be a second opinion: `toEqual` fails if one comes back.
      expect(WINDOW_SPEC).toEqual({ minJamb: 0.05, minClearance: 0.1 });
      expect(Object.isFrozen(WINDOW_SPEC)).toBe(true);
    });
  });

  describe('the windows of the typical floor', () => {
    it('realises exactly the eight declared windows, in schedule order', () => {
      expect(WINDOWS.map((window) => `${window.spaceId} → ${window.neighbourId}`)).toEqual(
        EXPECTED_WINDOWS.map((expected) => `${expected.spaceId} → ${expected.neighbourId}`),
      );
      expect(WINDOWS).toHaveLength(EXPECTED_WINDOWS.length);
    });

    it.each(EXPECTED_WINDOWS)(
      'places the $kind window of $spaceId at $spanMin–$spanMax, $sill–$head high',
      (expected) => {
        const window = windowOf(expected.spaceId, expected.side);

        expect(window).toBeDefined();
        expect(window?.kind).toBe(expected.kind);
        expect(window?.neighbourId).toBe(expected.neighbourId);
        expect(window?.along).toBe(expected.along);
        expect(window?.spanMin).toBe(expected.spanMin);
        expect(window?.spanMax).toBe(expected.spanMax);
        expect(window?.sill).toBe(expected.sill);
        expect(window?.head).toBe(expected.head);
        expect(window?.opening.rect).toEqual(expected.rect);
        expect(window?.opening.bottom).toBe(expected.sill);
        expect(window?.opening.top).toBe(expected.head);
      },
    );

    it.each(EXPECTED_WINDOWS)(
      'cuts the $kind window of $spaceId through the whole $thickness m wall',
      (expected) => {
        const window = windowOf(expected.spaceId, expected.side);
        const contacts = getNeighbours(FLOOR_PLAN, expected.spaceId).filter(
          (contact) =>
            contact.neighbourId === expected.neighbourId && contact.side === expected.side,
        );

        expect(window).toBeDefined();
        expect(openingThickness(window as FloorWindow)).toBeCloseTo(
          expected.thickness,
          PRECISION_DIGITS,
        );
        // The thickness is the gap the plan actually draws between the two spaces,
        // not a constant: the utility room's window pierces the kept 0.20 m wall.
        expect(contacts.length).toBeGreaterThan(0);
        expect(
          contacts.some(
            (contact) => Math.abs(contact.gap - expected.thickness) <= LENGTH_TOLERANCE,
          ),
        ).toBe(true);
      },
    );

    it.each(EXPECTED_WINDOWS)(
      'makes the $kind window of $spaceId as wide as its declared span',
      (expected) => {
        const window = windowOf(expected.spaceId, expected.side);
        const width = expected.spanMax - expected.spanMin;

        expect(window).toBeDefined();
        expect((window as FloorWindow).spanMax - (window as FloorWindow).spanMin).toBeCloseTo(
          width,
          PRECISION_DIGITS,
        );
        expect(openingWidth(window as FloorWindow)).toBeCloseTo(width, PRECISION_DIGITS);
        expect(width).toBeGreaterThan(0);
      },
    );

    it('gives the floor windows of several different widths and heights', () => {
      // The one assertion v1 could not have made: it produced 1.20 × 1.20 everywhere,
      // and a test that passed on a single size would still pass if the schedule were
      // ignored and one size derived again.
      const widths = new Set(
        WINDOWS.map((window) => toPlanLength(window.spanMax - window.spanMin)),
      );
      const sills = new Set(WINDOWS.map((window) => window.sill));
      const heads = new Set(WINDOWS.map((window) => window.head));

      expect(widths.size).toBeGreaterThan(1);
      expect(sills.size).toBeGreaterThan(1);
      expect(heads.size).toBeGreaterThan(1);
    });
  });

  describe('the glazing rules that are left', () => {
    it('glazes rooms only', () => {
      WINDOWS.forEach((window) => {
        expect(getSpace(FLOOR_PLAN, window.spaceId).kind).toBe('room');
      });
    });

    it.each(UNGLAZED_SPACE_IDS)('gives %s no window of its own', (spaceId) => {
      expect(WINDOWS.filter((window) => window.spaceId === spaceId)).toEqual([]);
    });

    it('accounts for every space: eight glazed, thirteen not', () => {
      const glazed = new Set(WINDOWS.map((window) => window.spaceId));

      expect([...glazed].sort()).toEqual(
        [...new Set(EXPECTED_WINDOWS.map((expected) => expected.spaceId))].sort(),
      );
      expect(glazed.size + UNGLAZED_SPACE_IDS.length).toBe(FLOOR_PLAN.spaces.length);
      expect(UNGLAZED_SPACE_IDS.filter((id) => glazed.has(id))).toEqual([]);
    });

    it('gives the master bedroom no window, though its balcony face could take one', () => {
      // Not a vacuous negative: the master bedroom has a 3.40 m face onto the side-A
      // balcony and v1 glazed it at z 0.43–1.63. The owner asked for none.
      expect(WINDOWS.filter((window) => window.spaceId === 'masterBedroom')).toEqual([]);
      expect(
        getNeighbours(FLOOR_PLAN, 'masterBedroom').some(
          (contact) => contact.neighbourId === 'balconyA',
        ),
      ).toBe(true);
    });

    it('lets only the pass window look into another room', () => {
      WINDOWS.forEach((window) => {
        const neighbourKind = getSpace(FLOOR_PLAN, window.neighbourId).kind;
        if (window.kind === 'pass') {
          expect(OPEN_AIR_KINDS).not.toContain(neighbourKind);
        } else {
          expect(OPEN_AIR_KINDS).toContain(neighbourKind);
        }
      });
    });

    it('has exactly one pass window: the guest room tunnel to the kitchen', () => {
      const passes = WINDOWS.filter((window) => window.kind === 'pass');

      expect(passes).toHaveLength(1);
      expect(passes[0].spaceId).toBe('guestRoom');
      expect(passes[0].neighbourId).toBe('kitchen');
      expect(getSpace(FLOOR_PLAN, 'kitchen').kind).toBe('room');
    });

    it('puts every window under the wall it pierces', () => {
      WINDOWS.forEach((window) => {
        expect(window.head).toBeGreaterThan(window.sill);
        expect(window.sill).toBeGreaterThanOrEqual(0);
        expect(window.head).toBeLessThanOrEqual(FLOOR_HEIGHTS.wall);
      });
    });
  });

  describe('clearance from the doors', () => {
    const clearances = WINDOWS.flatMap((window) =>
      portsInFaceOf(window, PORT_SCHEDULE).map(({ port, min, max }) => ({
        window,
        port,
        clearance: toPlanLength(Math.max(min - window.spanMax, window.spanMin - max)),
      })),
    );

    it('finds windows that really do share a face with a door', () => {
      expect(clearances.length).toBeGreaterThan(0);
    });

    it('never lets a window overlap a door of the same face', () => {
      clearances.forEach(({ clearance }) => {
        expect(clearance).toBeGreaterThan(0);
      });
    });

    it('keeps at least the clearance of solid wall, the tightest being 0.20 m', () => {
      clearances.forEach(({ clearance }) => {
        expect(clearance).toBeGreaterThanOrEqual(WINDOW_SPEC.minClearance - LENGTH_TOLERANCE);
      });

      expect(Math.min(...clearances.map(({ clearance }) => clearance))).toBe(
        TIGHTEST_DOOR_CLEARANCE,
      );
    });

    it('lets a door and a window share a span when they are in opposite walls', () => {
      const tunnel = windowOf('guestRoom', 'maxX');
      const balconyDoor = PORT_SCHEDULE.find(
        (port) => port.spaces.includes('guestRoom') && port.spaces.includes('balconyA'),
      );

      expect(tunnel).toBeDefined();
      expect(balconyDoor).toBeDefined();
      // Same axis, overlapping z, and no clash: the door is in the room's minX wall
      // and the tunnel in its maxX wall, which is exactly the case a span-only check
      // breaks on. The two used to run over exactly the same 6.35–7.00; narrowing the
      // pass to 0.55 for the tunnel cheeks left it CONCENTRIC inside the door's span
      // instead — 6.40–6.95 against 6.35–7.00, both centred on 6.675 — so the overlap
      // a span-only check would trip on is total rather than merely equal.
      const doorMax = toPlanLength((balconyDoor?.spanMin ?? 0) + (balconyDoor?.width ?? 0));

      expect(balconyDoor?.along).toBe(tunnel?.along);
      expect(balconyDoor?.spanMin).toBeLessThan(tunnel?.spanMin ?? 0);
      expect(doorMax).toBeGreaterThan(tunnel?.spanMax ?? 0);
      expect(toPlanLength(((balconyDoor?.spanMin ?? 0) + doorMax) / 2)).toBeCloseTo(
        toPlanLength(((tunnel?.spanMin ?? 0) + (tunnel?.spanMax ?? 0)) / 2),
        PRECISION_DIGITS,
      );
      expect(portsInFaceOf(tunnel as FloorWindow, PORT_SCHEDULE)).toEqual([]);
    });

    it('rejects a door drawn through a declared window', () => {
      // The laundry's balcony door before the owner swapped it with the glazing: it
      // would run 15.30–16.20, through the window at 15.40–17.30.
      const clashing: Port = Object.freeze({
        spaces: Object.freeze(['laundry', 'balconySlabB'] as const),
        kind: 'door',
        along: 'x',
        spanMin: CLASHING_DOOR_SPAN_MIN,
        width: CLASHING_DOOR_WIDTH,
      });

      expect(() => getWindows(FLOOR_PLAN, [...PORT_SCHEDULE, clashing])).toThrow(RangeError);
    });
  });

  describe('heights', () => {
    it('takes every sill and head from the schedule, never from the floor heights', () => {
      const injected = getWindows(FLOOR_PLAN, PORT_SCHEDULE, SYNTHETIC_HEIGHTS);

      expect(injected).toHaveLength(EXPECTED_WINDOWS.length);
      injected.forEach((window, index) => {
        expect(window.sill).toBe(EXPECTED_WINDOWS[index].sill);
        expect(window.head).toBe(EXPECTED_WINDOWS[index].head);
        // Two assertions deleted here. They pinned the opening away from
        // `SYNTHETIC_HEIGHTS.windowSill` / `.windowHead`, which no longer exist:
        // there is no floor-wide sill or head for an opening to pick up by
        // mistake. The two assertions above are the positive form and are
        // stronger — they name the level each window must have.
        expect(window.opening.bottom).toBe(EXPECTED_WINDOWS[index].sill);
        expect(window.opening.top).toBe(EXPECTED_WINDOWS[index].head);
      });
    });

    it('moves no window when the heights change', () => {
      const injected = getWindows(FLOOR_PLAN, PORT_SCHEDULE, SYNTHETIC_HEIGHTS);

      expect(injected.map((window) => window.opening.rect)).toEqual(
        WINDOWS.map((window) => window.opening.rect),
      );
    });

    it('refuses a wall too low for the windows it must carry', () => {
      const lowWall: FloorHeights = Object.freeze({ ...FLOOR_HEIGHTS, wall: TOO_LOW_WALL });

      expect(TOO_LOW_WALL).toBeLessThan(Math.max(...EXPECTED_WINDOWS.map(({ head }) => head)));
      expect(() => getWindows(FLOOR_PLAN, PORT_SCHEDULE, lowWall)).toThrow(RangeError);
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

/**
 * Every space of the floor and the windows that look into or out of it, by
 * their index in the schedule above, hand-derived from `EXPECTED_WINDOWS`.
 *
 * A window belongs to BOTH of its spaces, so the 8 windows make 16 entries. The
 * two cases that a `spaceId`-only filter would get wrong are written next to
 * each other on purpose: the kitchen owns two windows — the food pass declared
 * from the guest room, and its own one over the sink — and the guest room owns
 * that same pass, which is the only window it has. The two voids own the six
 * openings declared at them, none of which names a void first.
 */
const WINDOWS_BY_SPACE: readonly (readonly [SpaceId, readonly number[]])[] = [
  ['balconyA', [0]],
  ['masterBedroom', []],
  ['livingRoom', []],
  ['bedroomMaleKids', []],
  ['bedroomFemaleKids', []],
  ['stairs', []],
  ['corridor', []],
  ['controlCenter', [0]],
  ['guestRoom', [1]],
  ['guestSanitair', []],
  ['kitchen', [1, 3]],
  ['laundry', [4]],
  ['mainSanitair', []],
  ['utilityRoom', [7]],
  ['ccBalcony', []],
  ['balconySlabB', []],
  ['voidWest', [2, 3]],
  ['voidEast', [4, 5, 6, 7]],
  ['guestBathCubicle', [2]],
  ['mainBathCubicle', [5]],
  ['mainShowerCubicle', [6]],
];

/** The food pass, which is the guest room's window and the kitchen's alike. */
const PASS_INDEX = 1;

describe('getWindowsOf', () => {
  it.each(WINDOWS_BY_SPACE.map(([id, indices]) => ({ id, indices })))(
    'gives $id the windows at $indices',
    ({ id, indices }) => {
      expect(getWindowsOf(WINDOWS, id)).toEqual(indices.map((index) => WINDOWS[index]));
    },
  );

  it('names every window exactly twice, once per side', () => {
    const memberships = WINDOWS_BY_SPACE.reduce((sum, [, indices]) => sum + indices.length, 0);

    expect(memberships).toBe(WINDOWS.length * 2);
    expect(WINDOWS_BY_SPACE.map(([id]) => id)).toEqual([...SPACE_IDS]);
  });

  it('reports the food pass from both sides, and the same object each time', () => {
    const pass = WINDOWS[PASS_INDEX];

    expect(pass.spaceId).toBe('guestRoom');
    expect(pass.neighbourId).toBe('kitchen');
    expect(getWindowsOf(WINDOWS, 'guestRoom')).toContain(pass);
    expect(getWindowsOf(WINDOWS, 'kitchen')).toContain(pass);
  });

  it('keeps the schedule order, not the order the spaces are asked in', () => {
    const eastern = getWindowsOf(WINDOWS, 'voidEast');

    expect(eastern.map((window) => window.spaceId)).toEqual([
      'laundry',
      'mainBathCubicle',
      'mainShowerCubicle',
      'utilityRoom',
    ]);
  });

  it('returns a frozen list, empty for a space nothing glazes', () => {
    expect(Object.isFrozen(getWindowsOf(WINDOWS, 'kitchen'))).toBe(true);

    const dark = getWindowsOf(WINDOWS, 'livingRoom');

    expect(dark).toEqual([]);
    expect(Object.isFrozen(dark)).toBe(true);
  });
});
