import { describe, expect, it } from 'vitest';
import type { SpaceId } from '../floorPlan/index.ts';
import { isOnPlanGrid, toPlanLength } from '../planGeometry.ts';
import { PORT_SCHEDULE } from './portSchedule.ts';
import type { Port, PortAxis, PortKind, PortSwing } from './types.ts';

const PRECISION_DIGITS = 9;
const EXPECTED_PORT_COUNT = 19;
const EXPECTED_DOOR_COUNT = 18;
const EXPECTED_OPENING_COUNT = 1;
const EXPECTED_WHY_COUNT = 11;
const EXPECTED_SLIDING_COUNT = 4;
const SINGLE_PORT = 1;

/** Clear width of the common door leaf of the floor, in metres. */
const DOOR_WIDTH = 0.9;
/** Clear width of the living-room opening onto the corridor (brief §4.1). */
const LIVING_OPENING_WIDTH = 3.5;
/**
 * Clear width of the control-center door, in metres.
 *
 * The only leaf on the floor wider than the common one. The control center holds
 * the water, gas and electricity risers, so the owner widened this door from 0.90
 * to 1.20 "for any some usage" — a water heater or a gas bottle has to pass.
 */
const RISER_DOOR_WIDTH = 1.2;

/** One row of the door schedule, as the source of truth declares it. */
interface ExpectedPort {
  /** The pair, for the test name. */
  readonly label: string;
  /** The two spaces, in schedule order. */
  readonly spaces: readonly [SpaceId, SpaceId];
  /** Whether the passage has a leaf. */
  readonly kind: PortKind;
  /** Axis the width runs along. */
  readonly along: PortAxis;
  /** The interval the port covers along `along`, as `[min, max]`, in metres. */
  readonly span: readonly [number, number];
  /** Clear width of the passage, in metres. */
  readonly width: number;
  /** How the leaf opens; absent when it swings, which is the normal case. */
  readonly swing?: PortSwing;
  /** Whether the plan records a reason for this port, in `Port.why`. */
  readonly hasWhy: boolean;
}

/**
 * The whole door schedule, as the source of truth declares it: 19 ports, 18
 * doors and the single living-room opening.
 *
 * Rewritten for the new plan. What changed, and why each row moved:
 *
 * - **`linkCorridor` is gone**, and with it the five doors that used to reach the
 *   stairs, the control center, the guest room and the side-A balcony through it.
 *   The guest room's north strip does that job now, so the stairs open onto
 *   `guestRoom`, the control center is entered from `guestRoom`, and the
 *   balcony's second door is `balconyA ↔ guestRoom`.
 * - **The guest-room ↔ kitchen door is gone**, replaced by the food-pass window.
 * - **The three bath and shower cubicles are rooms**, so each carries its own
 *   door, and `ccBalcony` is new.
 * - **`exception` became `why`.** The old field meant "why this port deviates
 *   from the 0.90 m default"; there is no default any more, so a reason is
 *   ordinary rather than exceptional and eleven ports carry one.
 * - **Four leaves slide**, because the room they serve is shallower than the leaf
 *   is wide.
 * - **The guest shower is gone** (owner, 2026-09-19), and its sliding leaf with
 *   it: brief §7.3's own table asked for `Sink (open) + Bath — NO shower`. The
 *   suite slid east onto the floor the shower held, which is why the two guest
 *   spans below sit 0.65–0.70 m further along x than they used to. They face each
 *   other across the open part now — 8.10–8.80 in its north face, 8.20–8.80 in its
 *   south — which is what leaves the basin the east dead-end to itself.
 * - **The control-center door is 1.20 wide**, not the 0.90 of the common leaf,
 *   so 0.90 is the usual width of this floor and not its widest: the room behind
 *   it carries the risers and has to admit a water heater or a gas bottle. It is
 *   the one row here whose width is a constant of its own.
 */
const EXPECTED_PORTS: readonly ExpectedPort[] = [
  {
    label: 'balconyA ↔ masterBedroom',
    spaces: ['balconyA', 'masterBedroom'],
    kind: 'door',
    along: 'z',
    span: [1.55, 2.45],
    width: DOOR_WIDTH,
    hasWhy: true,
  },
  {
    label: 'masterBedroom ↔ corridor',
    spaces: ['masterBedroom', 'corridor'],
    kind: 'door',
    along: 'x',
    span: [5.65, 6.55],
    width: DOOR_WIDTH,
    hasWhy: true,
  },
  {
    label: 'livingRoom ↔ corridor',
    spaces: ['livingRoom', 'corridor'],
    kind: 'opening',
    along: 'x',
    span: [7.5, 11.0],
    width: LIVING_OPENING_WIDTH,
    hasWhy: true,
  },
  {
    label: 'bedroomMaleKids ↔ corridor',
    spaces: ['bedroomMaleKids', 'corridor'],
    kind: 'door',
    along: 'x',
    span: [12.3, 13.2],
    width: DOOR_WIDTH,
    hasWhy: false,
  },
  {
    label: 'bedroomFemaleKids ↔ corridor',
    spaces: ['bedroomFemaleKids', 'corridor'],
    kind: 'door',
    along: 'x',
    span: [17.6, 18.5],
    width: DOOR_WIDTH,
    hasWhy: false,
  },
  {
    label: 'corridor ↔ utilityRoom',
    spaces: ['corridor', 'utilityRoom'],
    kind: 'door',
    along: 'z',
    span: [4.2, 5.1],
    width: DOOR_WIDTH,
    hasWhy: false,
  },
  {
    label: 'stairs ↔ guestRoom',
    spaces: ['stairs', 'guestRoom'],
    kind: 'door',
    along: 'x',
    span: [4.65, 5.55],
    width: DOOR_WIDTH,
    hasWhy: true,
  },
  {
    label: 'corridor ↔ kitchen',
    spaces: ['corridor', 'kitchen'],
    kind: 'door',
    along: 'x',
    span: [12.7, 13.6],
    width: DOOR_WIDTH,
    hasWhy: false,
  },
  {
    label: 'corridor ↔ mainSanitair',
    spaces: ['corridor', 'mainSanitair'],
    kind: 'door',
    along: 'x',
    span: [18.6, 19.5],
    width: DOOR_WIDTH,
    hasWhy: true,
  },
  {
    label: 'balconyA ↔ guestRoom',
    spaces: ['balconyA', 'guestRoom'],
    kind: 'door',
    along: 'z',
    span: [6.35, 7.0],
    width: 0.65,
    hasWhy: true,
  },
  {
    label: 'controlCenter ↔ guestRoom',
    spaces: ['controlCenter', 'guestRoom'],
    kind: 'door',
    along: 'x',
    span: [1.7, 2.9],
    width: RISER_DOOR_WIDTH,
    hasWhy: true,
  },
  {
    label: 'controlCenter ↔ ccBalcony',
    spaces: ['controlCenter', 'ccBalcony'],
    kind: 'door',
    along: 'z',
    span: [8.95, 9.65],
    width: 0.7,
    hasWhy: true,
  },
  {
    label: 'guestSanitair ↔ guestBathCubicle',
    spaces: ['guestSanitair', 'guestBathCubicle'],
    kind: 'door',
    along: 'x',
    span: [8.2, 8.8],
    width: 0.6,
    swing: 'slide',
    hasWhy: false,
  },
  {
    label: 'mainSanitair ↔ mainBathCubicle',
    spaces: ['mainSanitair', 'mainBathCubicle'],
    kind: 'door',
    along: 'x',
    span: [18.1, 18.8],
    width: 0.7,
    swing: 'slide',
    hasWhy: false,
  },
  {
    label: 'mainSanitair ↔ mainShowerCubicle',
    spaces: ['mainSanitair', 'mainShowerCubicle'],
    kind: 'door',
    along: 'x',
    span: [19.6, 20.25],
    width: 0.65,
    swing: 'slide',
    hasWhy: false,
  },
  {
    label: 'guestRoom ↔ guestSanitair',
    spaces: ['guestRoom', 'guestSanitair'],
    kind: 'door',
    along: 'x',
    span: [8.1, 8.8],
    width: 0.7,
    swing: 'slide',
    hasWhy: true,
  },
  {
    label: 'kitchen ↔ balconySlabB',
    spaces: ['kitchen', 'balconySlabB'],
    kind: 'door',
    along: 'x',
    span: [12.7, 13.6],
    width: DOOR_WIDTH,
    hasWhy: false,
  },
  {
    label: 'laundry ↔ mainSanitair',
    spaces: ['laundry', 'mainSanitair'],
    kind: 'door',
    along: 'z',
    span: [5.9, 6.8],
    width: DOOR_WIDTH,
    hasWhy: true,
  },
  {
    label: 'laundry ↔ balconySlabB',
    spaces: ['laundry', 'balconySlabB'],
    kind: 'door',
    along: 'x',
    span: [14.3, 15.2],
    width: DOOR_WIDTH,
    hasWhy: true,
  },
];

/**
 * Every clear width the schedule uses, in metres, ascending.
 *
 * Pinned as an exact set rather than as an allow-list the schedule is checked
 * against: `Port.width` is explicit that there is no fixed set of permitted
 * widths, each one being a consequence of the room it serves. Pinning the set
 * therefore catches a width that moves without pretending a rule exists that
 * would forbid a new one.
 *
 * Six values, not the five it held while every leaf was 0.90 or narrower: the
 * owner's 1.20 riser door added one rather than moving one, and this pin is what
 * noticed. Nothing here says how many there may be, only which ones there are.
 */
const WIDTHS_USED: readonly number[] = [
  0.6,
  0.65,
  0.7,
  DOOR_WIDTH,
  RISER_DOOR_WIDTH,
  LIVING_OPENING_WIDTH,
];

/** The two spaces with no floor: nothing may open onto them (brief §5.2). */
const VOID_IDS: readonly SpaceId[] = ['voidWest', 'voidEast'];

/**
 * Formats a port as a stable, comparable line.
 *
 * @param spaces - The two spaces, in schedule order.
 * @param kind - Kind of the passage.
 * @param along - Axis the width runs along.
 * @param span - The interval covered, as `[min, max]`.
 * @returns A line such as `balconyA ↔ masterBedroom door along z 1.55–2.45`.
 */
function formatLine(
  spaces: readonly [SpaceId, SpaceId],
  kind: PortKind,
  along: PortAxis,
  span: readonly [number, number],
): string {
  return `${spaces[0]} ↔ ${spaces[1]} ${kind} along ${along} ${String(span[0])}–${String(span[1])}`;
}

/**
 * Builds the order-independent key of a space pair.
 *
 * @param spaces - The two spaces.
 * @returns The two ids sorted and joined.
 */
function pairKey(spaces: readonly [SpaceId, SpaceId]): string {
  return [...spaces].sort().join('|');
}

const PAIRED = EXPECTED_PORTS.map((expected, index) => ({
  label: expected.label,
  expected,
  port: PORT_SCHEDULE[index],
}));

describe('PORT_SCHEDULE', () => {
  it('schedules exactly the expected ports, in schedule order', () => {
    expect(
      PORT_SCHEDULE.map((port) =>
        formatLine(port.spaces, port.kind, port.along, [
          port.spanMin,
          toPlanLength(port.spanMin + port.width),
        ]),
      ),
    ).toEqual(
      EXPECTED_PORTS.map((expected) =>
        formatLine(expected.spaces, expected.kind, expected.along, expected.span),
      ),
    );
  });

  it('holds 19 ports: 18 doors and the single living-room opening', () => {
    const doors = PORT_SCHEDULE.filter((port) => port.kind === 'door');
    const openings = PORT_SCHEDULE.filter((port) => port.kind === 'opening');

    expect(PORT_SCHEDULE).toHaveLength(EXPECTED_PORT_COUNT);
    expect(doors).toHaveLength(EXPECTED_DOOR_COUNT);
    expect(openings).toHaveLength(EXPECTED_OPENING_COUNT);
    expect(openings[0].spaces).toEqual(['livingRoom', 'corridor']);
  });

  describe('each scheduled port', () => {
    it.each(PAIRED)('places $label', ({ expected, port }) => {
      expect(port.spaces).toEqual(expected.spaces);
      expect(port.kind).toBe(expected.kind);
      expect(port.along).toBe(expected.along);
      expect(port.spanMin).toBeCloseTo(expected.span[0], PRECISION_DIGITS);
      expect(port.width).toBeCloseTo(expected.width, PRECISION_DIGITS);
      expect(toPlanLength(port.spanMin + port.width)).toBeCloseTo(
        expected.span[1],
        PRECISION_DIGITS,
      );
    });

    it.each(PAIRED)('keeps $label on the centimetre grid', ({ port }) => {
      expect(isOnPlanGrid(port.spanMin)).toBe(true);
      expect(isOnPlanGrid(port.width)).toBe(true);
    });
  });

  describe('widths', () => {
    it('uses exactly the six widths of the floor and no others', () => {
      const used = [...new Set(PORT_SCHEDULE.map((port) => port.width))].sort((a, b) => a - b);

      expect(used).toEqual([...WIDTHS_USED]);
    });

    it('gives the widest leaf of the floor to the riser door alone', () => {
      // 0.90 is the usual leaf, not the widest one. While it was both, a check of
      // "the widest door" could not tell the two apart and would have passed on
      // either reading; naming the port that holds the maximum keeps it honest.
      const doors = PORT_SCHEDULE.filter((port) => port.kind === 'door');
      const widestWidth = Math.max(...doors.map((port) => port.width));
      const widest = doors.filter((port) => port.width === widestWidth);

      expect(widestWidth).toBeCloseTo(RISER_DOOR_WIDTH, PRECISION_DIGITS);
      expect(widestWidth).toBeGreaterThan(DOOR_WIDTH);
      expect(widest).toHaveLength(SINGLE_PORT);
      expect(widest[0].spaces).toEqual(['controlCenter', 'guestRoom']);
    });

    it('gives every port a width greater than zero', () => {
      const nonPositive = PORT_SCHEDULE.filter((port) => port.width <= 0);

      expect(nonPositive).toEqual([]);
    });
  });

  describe('how the leaves open', () => {
    it.each(PAIRED)('opens $label the way the plan says', ({ expected, port }) => {
      expect(Object.hasOwn(port, 'swing')).toBe(expected.swing !== undefined);
      expect(port.swing).toBe(expected.swing);
    });

    it('slides exactly the four leaves that have no floor to swing into', () => {
      const sliding = PORT_SCHEDULE.filter((port) => port.swing === 'slide').map((port) =>
        pairKey(port.spaces),
      );

      expect(sliding).toHaveLength(EXPECTED_SLIDING_COUNT);
      expect(sliding.sort()).toEqual(
        [
          pairKey(['guestRoom', 'guestSanitair']),
          pairKey(['guestSanitair', 'guestBathCubicle']),
          pairKey(['mainSanitair', 'mainBathCubicle']),
          pairKey(['mainSanitair', 'mainShowerCubicle']),
        ].sort(),
      );
    });

    it('never gives a swing to the opening, which has no leaf to open', () => {
      const openings = PORT_SCHEDULE.filter((port) => port.kind === 'opening');

      expect(openings).toHaveLength(EXPECTED_OPENING_COUNT);
      expect(openings.filter((port) => port.swing !== undefined)).toEqual([]);
    });
  });

  describe('reasons', () => {
    it.each(PAIRED)('records why $label is as it is, or records nothing', ({ expected, port }) => {
      expect(Object.hasOwn(port, 'why')).toBe(expected.hasWhy);
      if (expected.hasWhy) {
        expect(port.why).toEqual(expect.any(String));
        expect(port.why?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('marks exactly the eleven ports the plan gives a reason for', () => {
      const explained = PORT_SCHEDULE.filter((port) => port.why !== undefined).map((port) =>
        pairKey(port.spaces),
      );

      expect(explained).toHaveLength(EXPECTED_WHY_COUNT);
      expect(explained.sort()).toEqual(
        [
          pairKey(['balconyA', 'masterBedroom']),
          pairKey(['masterBedroom', 'corridor']),
          pairKey(['livingRoom', 'corridor']),
          pairKey(['stairs', 'guestRoom']),
          pairKey(['corridor', 'mainSanitair']),
          pairKey(['balconyA', 'guestRoom']),
          pairKey(['controlCenter', 'guestRoom']),
          pairKey(['controlCenter', 'ccBalcony']),
          pairKey(['guestRoom', 'guestSanitair']),
          pairKey(['laundry', 'mainSanitair']),
          pairKey(['laundry', 'balconySlabB']),
        ].sort(),
      );
    });

    it('leaves the other eight ports with no reason at all', () => {
      const silent = PORT_SCHEDULE.filter((port) => !Object.hasOwn(port, 'why'));

      expect(silent).toHaveLength(EXPECTED_PORT_COUNT - EXPECTED_WHY_COUNT);
    });
  });

  describe('schedule shape', () => {
    it('never schedules two ports between the same pair of spaces', () => {
      const keys = PORT_SCHEDULE.map((port) => pairKey(port.spaces));

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('never connects a space to itself', () => {
      const selfJoined = PORT_SCHEDULE.filter(({ spaces: [first, second] }) => first === second);

      expect(selfJoined).toEqual([]);
    });

    it('never opens onto a void', () => {
      const onVoids = PORT_SCHEDULE.filter((port) =>
        port.spaces.some((id) => VOID_IDS.includes(id)),
      ).map((port) => pairKey(port.spaces));

      expect(onVoids).toEqual([]);
    });

    it('has no side-A exterior door: the floor is entered through the stairs', () => {
      const stairsPorts = PORT_SCHEDULE.filter((port) => port.spaces.includes('stairs'));

      expect(stairsPorts).toHaveLength(SINGLE_PORT);
      expect(stairsPorts[0].spaces).toEqual(['stairs', 'guestRoom']);
    });
  });

  describe('deep freeze', () => {
    it('freezes the array, every port and every space pair', () => {
      expect(Object.isFrozen(PORT_SCHEDULE)).toBe(true);
      PORT_SCHEDULE.forEach((port) => {
        expect(Object.isFrozen(port)).toBe(true);
        expect(Object.isFrozen(port.spaces)).toBe(true);
      });
    });

    it('refuses to grow the schedule', () => {
      const extra: Port = {
        spaces: ['corridor', 'guestRoom'],
        kind: 'door',
        along: 'x',
        spanMin: 7.3,
        width: DOOR_WIDTH,
      };

      expect(() => (PORT_SCHEDULE as Port[]).push(extra)).toThrow(TypeError);
      expect(PORT_SCHEDULE).toHaveLength(EXPECTED_PORT_COUNT);
    });

    it('refuses to move a scheduled port', () => {
      const [first] = PORT_SCHEDULE;
      const before = first.spanMin;

      expect(() => {
        (first as { spanMin: number }).spanMin = 0;
      }).toThrow(TypeError);
      expect(first.spanMin).toBe(before);
    });
  });
});
