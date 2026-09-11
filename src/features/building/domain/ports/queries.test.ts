import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from '../heights.ts';
import type { FloorHeights } from '../heights.ts';
import { FLOOR_PLAN } from '../floorPlan/index.ts';
import type { SpaceId } from '../floorPlan/index.ts';
import { LENGTH_TOLERANCE } from '../planGeometry.ts';
import type { RectSide } from '../planGeometry.ts';
import { PORT_SCHEDULE } from './portSchedule.ts';
import {
  getPortContact,
  getPortOpening,
  getPortPartners,
  getPortSpan,
  getPortsOf,
} from './queries.ts';
import type { Port, PortAxis, PortKind } from './types.ts';

const PRECISION_DIGITS = 9;
const FLOOR_LEVEL = 0;
const DOOR_WIDTH = 0.9;
const LINK_DOOR_WIDTH = 0.8;
const LIVING_OPENING_WIDTH = 3.5;
const EXPECTED_CORRIDOR_PORT_COUNT = 8;

/** Vertical sizes with a lower door head, to prove the parameter is honoured. */
const LOW_HEIGHTS: FloorHeights = Object.freeze({ ...FLOOR_HEIGHTS, door: 1.95 });

/**
 * Builds a port for a query test.
 *
 * @param spaces - The two spaces, in the order the query walks them.
 * @param kind - Kind of the passage.
 * @param along - Axis the width runs along.
 * @param spanMin - Start of the port along `along`, in metres.
 * @param width - Clear width, in metres.
 * @returns A plain {@link Port}.
 */
function makePort(
  spaces: readonly [SpaceId, SpaceId],
  kind: PortKind,
  along: PortAxis,
  spanMin: number,
  width: number,
): Port {
  return { spaces, kind, along, spanMin, width };
}

/**
 * Looks a scheduled port up by its pair of spaces.
 *
 * @param first - One space of the port.
 * @param second - The other space.
 * @returns The scheduled port connecting them.
 * @throws RangeError naming the pair when the schedule has no such port.
 */
function findPort(first: SpaceId, second: SpaceId): Port {
  const port = PORT_SCHEDULE.find(
    ({ spaces }) => spaces.includes(first) && spaces.includes(second),
  );
  if (port === undefined) {
    throw new RangeError(`the schedule has no port between "${first}" and "${second}"`);
  }
  return port;
}

/** Hand-computed spans of a few ports, from `spanMin` and `width`. */
const EXPECTED_SPANS: readonly (readonly [string, SpaceId, SpaceId, number, number])[] = [
  ['balconyA ↔ masterBedroom', 'balconyA', 'masterBedroom', 1.85, 2.75],
  ['livingRoom ↔ corridor', 'livingRoom', 'corridor', 7.5, 11.0],
  ['balconyA ↔ linkCorridor', 'balconyA', 'linkCorridor', 5.65, 6.45],
  ['guestRoom ↔ kitchen', 'guestRoom', 'kitchen', 6.0, 6.9],
];

/** One contact a port must resolve to, hand-read off `floorPlanData.ts`. */
interface ExpectedContact {
  /** The pair and axis, for the test name. */
  readonly label: string;
  /** The port to locate. */
  readonly port: Port;
  /** Face of the first space's rect that faces the second space. */
  readonly side: RectSide;
  /** Index of the first space's rect. */
  readonly rectIndex: number;
  /** Index of the second space's rect. */
  readonly neighbourRectIndex: number;
  /** Wall thickness between the two faces, in metres. */
  readonly gap: number;
}

/**
 * The pairs that touch on both axes, which is why `Port.along` is stored: the
 * guest room meets the link corridor across its north wall (rect 0) and across
 * the link-corridor end wall (rect 1), and it meets the guest sanitair across
 * that room's west wall (rect 0) and its north wall (rect 2).
 */
const AMBIGUOUS_CONTACTS: readonly ExpectedContact[] = [
  {
    label: 'linkCorridor ↔ guestRoom along x (the scheduled door)',
    port: findPort('linkCorridor', 'guestRoom'),
    side: 'maxZ',
    rectIndex: 0,
    neighbourRectIndex: 0,
    gap: 0.2,
  },
  {
    label: 'linkCorridor ↔ guestRoom along z (the other axis)',
    port: makePort(['linkCorridor', 'guestRoom'], 'door', 'z', 5.65, LINK_DOOR_WIDTH),
    side: 'maxX',
    rectIndex: 0,
    neighbourRectIndex: 1,
    gap: 0.2,
  },
  {
    label: 'guestRoom ↔ guestSanitair along z (the scheduled door)',
    port: findPort('guestRoom', 'guestSanitair'),
    side: 'maxX',
    rectIndex: 0,
    neighbourRectIndex: 0,
    gap: 0.2,
  },
  {
    label: 'guestRoom ↔ guestSanitair along x (the other axis)',
    port: makePort(['guestRoom', 'guestSanitair'], 'door', 'x', 8.5, DOOR_WIDTH),
    side: 'maxZ',
    rectIndex: 2,
    neighbourRectIndex: 0,
    gap: 0.2,
  },
];

/** One opening footprint, hand-read off the clear rects of `floorPlanData.ts`. */
interface ExpectedOpening {
  /** The pair, for the test name. */
  readonly label: string;
  /** One space of the scheduled port. */
  readonly first: SpaceId;
  /** The other space. */
  readonly second: SpaceId;
  /** Expected footprint as `[minX, maxX, minZ, maxZ]`, in metres. */
  readonly rect: readonly [number, number, number, number];
}

const EXPECTED_OPENINGS: readonly ExpectedOpening[] = [
  {
    label: 'balconyA ↔ masterBedroom',
    first: 'balconyA',
    second: 'masterBedroom',
    rect: [1.3, 1.6, 1.85, 2.75],
  },
  {
    label: 'livingRoom ↔ corridor',
    first: 'livingRoom',
    second: 'corridor',
    rect: [7.5, 11.0, 3.7, 3.9],
  },
  {
    label: 'corridor ↔ utilityRoom',
    first: 'corridor',
    second: 'utilityRoom',
    rect: [20.2, 20.4, 4.2, 5.1],
  },
  {
    label: 'guestRoom ↔ kitchen',
    first: 'guestRoom',
    second: 'kitchen',
    rect: [9.8, 10.0, 6.0, 6.9],
  },
  {
    label: 'guestRoom ↔ guestSanitair',
    first: 'guestRoom',
    second: 'guestSanitair',
    rect: [8.0, 8.2, 7.1, 8.0],
  },
  {
    label: 'kitchen ↔ balconySlabB',
    first: 'kitchen',
    second: 'balconySlabB',
    rect: [12.7, 13.6, 8.4, 8.7],
  },
];

/** Ports the schedule swaps, to exercise the `minX` and `minZ` faces. */
const SWAPPED_PORTS: readonly (readonly [string, Port, Port])[] = [
  [
    'balconyA ↔ masterBedroom across the side-A wall',
    findPort('balconyA', 'masterBedroom'),
    makePort(['masterBedroom', 'balconyA'], 'door', 'z', 1.85, DOOR_WIDTH),
  ],
  [
    'livingRoom ↔ corridor across the top-row wall',
    findPort('livingRoom', 'corridor'),
    makePort(['corridor', 'livingRoom'], 'opening', 'x', 7.5, LIVING_OPENING_WIDTH),
  ],
];

describe('getPortSpan', () => {
  it.each(EXPECTED_SPANS)('spans %s from %s to %s', (_label, first, second, spanMin, spanMax) => {
    const [actualMin, actualMax] = getPortSpan(findPort(first, second));

    expect(actualMin).toBeCloseTo(spanMin, PRECISION_DIGITS);
    expect(actualMax).toBeCloseTo(spanMax, PRECISION_DIGITS);
  });

  it('ends every scheduled port exactly its width after its start', () => {
    const offenders = PORT_SCHEDULE.filter((port) => {
      const [spanMin, spanMax] = getPortSpan(port);
      return Math.abs(spanMax - spanMin - port.width) > LENGTH_TOLERANCE;
    });

    expect(offenders).toEqual([]);
  });
});

describe('getPortContact', () => {
  it.each(PORT_SCHEDULE.map((port) => ({ label: port.spaces.join(' ↔ '), port })))(
    'finds the wall of $label',
    ({ port }) => {
      const contact = getPortContact(FLOOR_PLAN, port);
      const [spanMin, spanMax] = getPortSpan(port);
      const contactAxis: PortAxis = contact.side === 'minX' || contact.side === 'maxX' ? 'z' : 'x';

      expect(contact.neighbourId).toBe(port.spaces[1]);
      expect(contactAxis).toBe(port.along);
      expect(contact.gap).toBeGreaterThan(0);
      expect(contact.spanMin).toBeLessThanOrEqual(spanMin);
      expect(contact.spanMax).toBeGreaterThanOrEqual(spanMax);
    },
  );

  it.each(AMBIGUOUS_CONTACTS)(
    'uses the stored axis to resolve $label',
    ({ port, side, rectIndex, neighbourRectIndex, gap }) => {
      const contact = getPortContact(FLOOR_PLAN, port);

      expect(contact.side).toBe(side);
      expect(contact.rectIndex).toBe(rectIndex);
      expect(contact.neighbourRectIndex).toBe(neighbourRectIndex);
      expect(contact.gap).toBeCloseTo(gap, PRECISION_DIGITS);
    },
  );

  it('throws when the two spaces do not share a wall', () => {
    const port = makePort(['livingRoom', 'kitchen'], 'door', 'x', 10.5, DOOR_WIDTH);

    expect(() => getPortContact(FLOOR_PLAN, port)).toThrow(RangeError);
    expect(() => getPortContact(FLOOR_PLAN, port)).toThrow(/"livingRoom" ↔ "kitchen"/);
  });

  it('throws when the span runs past the end of the wall', () => {
    const tooWide = makePort(['masterBedroom', 'corridor'], 'door', 'x', 5.65, 1.5);

    expect(() => getPortContact(FLOOR_PLAN, tooWide)).toThrow(/matched 0/);
  });

  it('throws when the stored axis matches no contact', () => {
    const wrongAxis = makePort(['masterBedroom', 'corridor'], 'door', 'z', 1.0, DOOR_WIDTH);

    expect(() => getPortContact(FLOOR_PLAN, wrongAxis)).toThrow(/matched 0/);
  });
});

describe('getPortOpening', () => {
  it.each(EXPECTED_OPENINGS)('cuts the wall of $label', ({ first, second, rect }) => {
    const [minX, maxX, minZ, maxZ] = rect;
    const opening = getPortOpening(FLOOR_PLAN, findPort(first, second));

    expect(opening.rect.minX).toBeCloseTo(minX, PRECISION_DIGITS);
    expect(opening.rect.maxX).toBeCloseTo(maxX, PRECISION_DIGITS);
    expect(opening.rect.minZ).toBeCloseTo(minZ, PRECISION_DIGITS);
    expect(opening.rect.maxZ).toBeCloseTo(maxZ, PRECISION_DIGITS);
    expect(opening.bottom).toBe(FLOOR_LEVEL);
    expect(opening.top).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
  });

  it('runs every scheduled opening from the floor to the door head', () => {
    const offenders = PORT_SCHEDULE.filter((port) => {
      const opening = getPortOpening(FLOOR_PLAN, port);
      return opening.bottom !== FLOOR_LEVEL || opening.top !== FLOOR_HEIGHTS.door;
    });

    expect(offenders).toEqual([]);
  });

  it('honours the heights it is given', () => {
    const opening = getPortOpening(FLOOR_PLAN, findPort('corridor', 'kitchen'), LOW_HEIGHTS);

    expect(opening.top).toBeCloseTo(LOW_HEIGHTS.door, PRECISION_DIGITS);
  });

  it.each(SWAPPED_PORTS)('cuts the same wall for %s in either order', (_label, port, swapped) => {
    expect(getPortOpening(FLOOR_PLAN, swapped).rect).toEqual(getPortOpening(FLOOR_PLAN, port).rect);
  });

  it('freezes the opening and its footprint', () => {
    const opening = getPortOpening(FLOOR_PLAN, findPort('corridor', 'kitchen'));

    expect(Object.isFrozen(opening)).toBe(true);
    expect(Object.isFrozen(opening.rect)).toBe(true);
  });

  it('throws when the two spaces join with no wall', () => {
    const noWall = makePort(['stairs', 'corridor'], 'opening', 'z', 4.2, DOOR_WIDTH);

    expect(() => getPortOpening(FLOOR_PLAN, noWall)).toThrow(RangeError);
    expect(() => getPortOpening(FLOOR_PLAN, noWall)).toThrow(/no wall to cut/);
  });
});

describe('getPortsOf', () => {
  it('lists the eight corridor ports', () => {
    expect(getPortsOf(PORT_SCHEDULE, 'corridor')).toHaveLength(EXPECTED_CORRIDOR_PORT_COUNT);
  });

  it('lists nothing for a space with no port', () => {
    expect(getPortsOf(PORT_SCHEDULE, 'voidWest')).toEqual([]);
  });

  it('only returns ports that name the space, in schedule order', () => {
    const ports = getPortsOf(PORT_SCHEDULE, 'kitchen');

    expect(ports.every((port) => port.spaces.includes('kitchen'))).toBe(true);
    expect(ports).toEqual(PORT_SCHEDULE.filter((port) => port.spaces.includes('kitchen')));
  });

  it('freezes the returned list', () => {
    expect(Object.isFrozen(getPortsOf(PORT_SCHEDULE, 'corridor'))).toBe(true);
  });
});

describe('getPortPartners', () => {
  it('names the other space of every port, whichever side it is scheduled on', () => {
    expect([...getPortPartners(PORT_SCHEDULE, 'laundry')].sort()).toEqual([
      'balconySlabB',
      'kitchen',
      'mainSanitair',
    ]);
  });

  it('names nothing for a space with no port', () => {
    expect(getPortPartners(PORT_SCHEDULE, 'voidEast')).toEqual([]);
  });

  it('never names the space itself', () => {
    const offenders = FLOOR_PLAN.spaces.filter((space) =>
      getPortPartners(PORT_SCHEDULE, space.id).includes(space.id),
    );

    expect(offenders).toEqual([]);
  });

  it('freezes the returned list', () => {
    expect(Object.isFrozen(getPortPartners(PORT_SCHEDULE, 'corridor'))).toBe(true);
  });
});
