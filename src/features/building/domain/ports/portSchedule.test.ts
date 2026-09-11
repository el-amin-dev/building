import { describe, expect, it } from 'vitest';
import type { SpaceId } from '../floorPlan/index.ts';
import { isOnPlanGrid, toPlanLength } from '../planGeometry.ts';
import { PORT_SCHEDULE } from './portSchedule.ts';
import type { Port, PortAxis, PortKind } from './types.ts';

const PRECISION_DIGITS = 9;
const EXPECTED_PORT_COUNT = 19;
const EXPECTED_DOOR_COUNT = 18;
const EXPECTED_OPENING_COUNT = 1;
const EXPECTED_EXCEPTION_COUNT = 4;

/** Clear width of a default door leaf, in metres (brief §6). */
const DOOR_WIDTH = 0.9;
/** Clear width of the balcony-A door into the 0.90 m link corridor (ADR-006). */
const LINK_DOOR_WIDTH = 0.8;
/** Clear width of the living-room opening onto the corridor (brief §4.1). */
const LIVING_OPENING_WIDTH = 3.5;

/** One row of the hand-written door schedule of brief §6, as amended by ADR-006. */
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
  /** Whether the port deviates from the brief §6 default and carries an `exception`. */
  readonly deviates: boolean;
}

/**
 * The whole door schedule, read off the brief §6 table and the owner answers of
 * 2026-09-11: 19 ports, 18 doors and the single living-room opening. There is
 * no side-A exterior door; the floor is entered through the stairs (ADR-006).
 */
const EXPECTED_PORTS: readonly ExpectedPort[] = [
  {
    label: 'balconyA ↔ masterBedroom',
    spaces: ['balconyA', 'masterBedroom'],
    kind: 'door',
    along: 'z',
    span: [1.85, 2.75],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'masterBedroom ↔ corridor',
    spaces: ['masterBedroom', 'corridor'],
    kind: 'door',
    along: 'x',
    span: [5.65, 6.55],
    width: DOOR_WIDTH,
    deviates: true,
  },
  {
    label: 'livingRoom ↔ corridor',
    spaces: ['livingRoom', 'corridor'],
    kind: 'opening',
    along: 'x',
    span: [7.5, 11.0],
    width: LIVING_OPENING_WIDTH,
    deviates: false,
  },
  {
    label: 'bedroomMaleKids ↔ corridor',
    spaces: ['bedroomMaleKids', 'corridor'],
    kind: 'door',
    along: 'x',
    span: [14.05, 14.95],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'bedroomFemaleKids ↔ corridor',
    spaces: ['bedroomFemaleKids', 'corridor'],
    kind: 'door',
    along: 'x',
    span: [18.55, 19.45],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'corridor ↔ utilityRoom',
    spaces: ['corridor', 'utilityRoom'],
    kind: 'door',
    along: 'z',
    span: [4.2, 5.1],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'stairs ↔ linkCorridor',
    spaces: ['stairs', 'linkCorridor'],
    kind: 'door',
    along: 'x',
    span: [4.0, 4.9],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'corridor ↔ linkCorridor',
    spaces: ['corridor', 'linkCorridor'],
    kind: 'door',
    along: 'x',
    span: [5.67, 6.57],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'corridor ↔ kitchen',
    spaces: ['corridor', 'kitchen'],
    kind: 'door',
    along: 'x',
    span: [11.55, 12.45],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'corridor ↔ mainSanitair',
    spaces: ['corridor', 'mainSanitair'],
    kind: 'door',
    along: 'x',
    span: [18.45, 19.35],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'balconyA ↔ linkCorridor',
    spaces: ['balconyA', 'linkCorridor'],
    kind: 'door',
    along: 'z',
    span: [5.65, 6.45],
    width: LINK_DOOR_WIDTH,
    deviates: true,
  },
  {
    label: 'guestRoom ↔ kitchen',
    spaces: ['guestRoom', 'kitchen'],
    kind: 'door',
    along: 'z',
    span: [6.0, 6.9],
    width: DOOR_WIDTH,
    deviates: true,
  },
  {
    label: 'kitchen ↔ laundry',
    spaces: ['kitchen', 'laundry'],
    kind: 'door',
    along: 'z',
    span: [6.15, 7.05],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'laundry ↔ mainSanitair',
    spaces: ['laundry', 'mainSanitair'],
    kind: 'door',
    along: 'z',
    span: [6.15, 7.05],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'linkCorridor ↔ controlCenter',
    spaces: ['linkCorridor', 'controlCenter'],
    kind: 'door',
    along: 'x',
    span: [2.3, 3.2],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'linkCorridor ↔ guestRoom',
    spaces: ['linkCorridor', 'guestRoom'],
    kind: 'door',
    along: 'x',
    span: [4.4, 5.3],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'guestRoom ↔ guestSanitair',
    spaces: ['guestRoom', 'guestSanitair'],
    kind: 'door',
    along: 'z',
    span: [7.1, 8.0],
    width: DOOR_WIDTH,
    deviates: true,
  },
  {
    label: 'kitchen ↔ balconySlabB',
    spaces: ['kitchen', 'balconySlabB'],
    kind: 'door',
    along: 'x',
    span: [12.7, 13.6],
    width: DOOR_WIDTH,
    deviates: false,
  },
  {
    label: 'laundry ↔ balconySlabB',
    spaces: ['laundry', 'balconySlabB'],
    kind: 'door',
    along: 'x',
    span: [15.3, 16.2],
    width: DOOR_WIDTH,
    deviates: false,
  },
];

/** Every clear width the schedule is allowed to use, in metres. */
const ALLOWED_WIDTHS: readonly number[] = [DOOR_WIDTH, LINK_DOOR_WIDTH, LIVING_OPENING_WIDTH];

/** The two spaces with no floor: nothing may open onto them (brief §5.2). */
const VOID_IDS: readonly SpaceId[] = ['voidWest', 'voidEast'];

/**
 * Formats a port as a stable, comparable line.
 *
 * @param spaces - The two spaces, in schedule order.
 * @param kind - Kind of the passage.
 * @param along - Axis the width runs along.
 * @param span - The interval covered, as `[min, max]`.
 * @returns A line such as `balconyA ↔ masterBedroom door along z 1.85–2.75`.
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

    it.each(PAIRED)('gives $label a width the brief allows', ({ port }) => {
      expect(ALLOWED_WIDTHS).toContain(port.width);
    });
  });

  describe('exceptions', () => {
    it.each(PAIRED)(
      'documents why $label deviates, or does not claim it does',
      ({ expected, port }) => {
        expect(Object.hasOwn(port, 'exception')).toBe(expected.deviates);
        if (expected.deviates) {
          expect(port.exception).toEqual(expect.any(String));
          expect(port.exception?.length ?? 0).toBeGreaterThan(0);
        }
      },
    );

    it('marks exactly the four deviating ports', () => {
      const deviating = PORT_SCHEDULE.filter((port) => port.exception !== undefined).map((port) =>
        pairKey(port.spaces),
      );

      expect(deviating).toHaveLength(EXPECTED_EXCEPTION_COUNT);
      expect(deviating.sort()).toEqual(
        [
          pairKey(['masterBedroom', 'corridor']),
          pairKey(['balconyA', 'linkCorridor']),
          pairKey(['guestRoom', 'kitchen']),
          pairKey(['guestRoom', 'guestSanitair']),
        ].sort(),
      );
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

      expect(stairsPorts).toHaveLength(1);
      expect(stairsPorts[0].spaces).toEqual(['stairs', 'linkCorridor']);
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
