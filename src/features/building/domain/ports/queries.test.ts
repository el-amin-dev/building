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
  needsSwingClearance,
} from './queries.ts';
import type { Port, PortAxis, PortKind } from './types.ts';

const PRECISION_DIGITS = 9;
const FLOOR_LEVEL = 0;
const DOOR_WIDTH = 0.9;
const LIVING_OPENING_WIDTH = 3.5;
const EXPECTED_CORRIDOR_PORT_COUNT = 7;
const EXPECTED_KITCHEN_PORT_COUNT = 2;
const EXPECTED_SWING_CLEARANCE_COUNT = 14;

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
  ['balconyA ↔ masterBedroom', 'balconyA', 'masterBedroom', 1.55, 2.45],
  ['livingRoom ↔ corridor', 'livingRoom', 'corridor', 7.5, 11.0],
  ['balconyA ↔ guestRoom', 'balconyA', 'guestRoom', 6.35, 7.0],
  ['guestRoom ↔ guestSanitair', 'guestRoom', 'guestSanitair', 7.4, 8.1],
  ['mainSanitair ↔ mainShowerCubicle', 'mainSanitair', 'mainShowerCubicle', 19.6, 20.25],
];

/** One contact a port must resolve to, measured off the plan rects. */
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
 * The pairs that touch on both axes, which is why `Port.along` is stored.
 *
 * There are exactly three on this plan, and `Port.along` names them: the
 * corridor meets the kitchen across the kitchen's north wall and across the
 * corridor's east end; the control center meets the guest room across its own
 * north wall and across the guest-room strip's west end; and the guest room
 * meets the guest sanitair across that room's north wall and across the guest
 * room's east face. For each, the scheduled door fixes one axis and a probe port
 * on the other axis proves the stored axis is what resolves the ambiguity —
 * without it, either contact would match.
 *
 * The old table's first two rows covered `linkCorridor ↔ guestRoom`, the L-shape
 * ambiguity of the previous plan: the link corridor met the guest room both
 * across the guest room's north wall and across the link corridor's own end
 * wall, so a port between them was ambiguous on its own. Those rows are deleted
 * rather than adapted because the situation is now unreachable: the owner
 * deleted `linkCorridor` and absorbed it into the guest room's north strip, so
 * the two spaces that produced the ambiguity are one space and no port can be
 * drawn between them at all. The corridor ↔ kitchen and controlCenter ↔
 * guestRoom rows below are the new plan's own both-axes pairs and carry the same
 * proof.
 */
const AMBIGUOUS_CONTACTS: readonly ExpectedContact[] = [
  {
    label: 'corridor ↔ kitchen along x (the scheduled door)',
    port: findPort('corridor', 'kitchen'),
    side: 'maxZ',
    rectIndex: 0,
    neighbourRectIndex: 1,
    gap: 0.3,
  },
  {
    label: 'corridor ↔ kitchen along z (the other axis)',
    port: makePort(['corridor', 'kitchen'], 'door', 'z', 5.8, 0.2),
    side: 'maxX',
    rectIndex: 1,
    neighbourRectIndex: 1,
    gap: 0.3,
  },
  {
    label: 'controlCenter ↔ guestRoom along x (the scheduled door)',
    port: findPort('controlCenter', 'guestRoom'),
    side: 'minZ',
    rectIndex: 0,
    neighbourRectIndex: 0,
    gap: 0.15,
  },
  {
    label: 'controlCenter ↔ guestRoom along z (the other axis)',
    port: makePort(['controlCenter', 'guestRoom'], 'door', 'z', 7.2, DOOR_WIDTH),
    side: 'maxX',
    rectIndex: 0,
    neighbourRectIndex: 1,
    gap: 0.3,
  },
  {
    label: 'guestRoom ↔ guestSanitair along x (the scheduled door)',
    port: findPort('guestRoom', 'guestSanitair'),
    side: 'maxZ',
    rectIndex: 0,
    neighbourRectIndex: 0,
    gap: 0.15,
  },
  {
    label: 'guestRoom ↔ guestSanitair along z (the other axis)',
    port: makePort(['guestRoom', 'guestSanitair'], 'door', 'z', 7.2, 0.5),
    side: 'maxX',
    rectIndex: 1,
    neighbourRectIndex: 0,
    gap: 0.15,
  },
];

/** One opening footprint, measured off the clear rects of the plan. */
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

/**
 * Openings covering every rect face the schedule actually sits in, and both wall
 * thicknesses the plan uses: 0.30 where a face is weather-exposed or insulated,
 * 0.15 where it is a plain separator.
 *
 * Three faces, not the four this comment used to claim. `getPortContact` walks
 * the contacts of `port.spaces[0]`, so which face a port sits in follows from the
 * order the source of truth names its pair in, and no scheduled port is named in
 * the order that would put it on a `minX` face. The test below pins that over the
 * whole schedule rather than over this list alone, so the shortfall is a measured
 * fact about the plan and not a gap in the list. The fourth face is reached by
 * naming a pair the other way round, which is what `SWAPPED_PORTS` is for.
 *
 * The `minZ` row rests on a single port, the control-center door, which is also
 * the only port of the floor wider than 0.90: it is 1.20 for the risers, so its
 * footprint is 1.20 long, x 1.70–2.90.
 */
const EXPECTED_OPENINGS: readonly ExpectedOpening[] = [
  {
    label: 'balconyA ↔ masterBedroom',
    first: 'balconyA',
    second: 'masterBedroom',
    rect: [1.3, 1.6, 1.55, 2.45],
  },
  {
    label: 'livingRoom ↔ corridor',
    first: 'livingRoom',
    second: 'corridor',
    rect: [7.5, 11.0, 3.85, 4.0],
  },
  {
    label: 'corridor ↔ utilityRoom',
    first: 'corridor',
    second: 'utilityRoom',
    rect: [20.2, 20.5, 4.2, 5.1],
  },
  {
    label: 'stairs ↔ guestRoom',
    first: 'stairs',
    second: 'guestRoom',
    rect: [4.65, 5.55, 6.0, 6.3],
  },
  {
    label: 'controlCenter ↔ guestRoom',
    first: 'controlCenter',
    second: 'guestRoom',
    rect: [1.7, 2.9, 7.05, 7.2],
  },
  {
    label: 'controlCenter ↔ ccBalcony',
    first: 'controlCenter',
    second: 'ccBalcony',
    rect: [3.8, 4.1, 8.95, 9.65],
  },
  {
    label: 'guestRoom ↔ guestSanitair',
    first: 'guestRoom',
    second: 'guestSanitair',
    rect: [7.4, 8.1, 7.05, 7.2],
  },
  {
    label: 'guestSanitair ↔ guestShowerCubicle',
    first: 'guestSanitair',
    second: 'guestShowerCubicle',
    rect: [9.0, 9.6, 7.75, 7.9],
  },
  {
    label: 'laundry ↔ mainSanitair',
    first: 'laundry',
    second: 'mainSanitair',
    rect: [17.55, 17.7, 5.9, 6.8],
  },
  {
    label: 'kitchen ↔ balconySlabB',
    first: 'kitchen',
    second: 'balconySlabB',
    rect: [12.7, 13.6, 8.6, 8.9],
  },
];

/** Ports the schedule swaps, to exercise the `minX` and `minZ` faces. */
const SWAPPED_PORTS: readonly (readonly [string, Port, Port])[] = [
  [
    'balconyA ↔ masterBedroom across the side-A wall',
    findPort('balconyA', 'masterBedroom'),
    makePort(['masterBedroom', 'balconyA'], 'door', 'z', 1.55, DOOR_WIDTH),
  ],
  [
    'livingRoom ↔ corridor across the top-row wall',
    findPort('livingRoom', 'corridor'),
    makePort(['corridor', 'livingRoom'], 'opening', 'x', 7.5, LIVING_OPENING_WIDTH),
  ],
  [
    'stairs ↔ guestRoom across the stair-landing wall',
    findPort('stairs', 'guestRoom'),
    makePort(['guestRoom', 'stairs'], 'door', 'x', 4.65, DOOR_WIDTH),
  ],
];

/** The five sliding leaves, which need no floor to open into. */
const SLIDING_PAIRS: readonly (readonly [SpaceId, SpaceId])[] = [
  ['guestRoom', 'guestSanitair'],
  ['guestSanitair', 'guestBathCubicle'],
  ['guestSanitair', 'guestShowerCubicle'],
  ['mainSanitair', 'mainBathCubicle'],
  ['mainSanitair', 'mainShowerCubicle'],
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

  it('has a both-axes pair for every ambiguity the table claims to resolve', () => {
    const pairs = AMBIGUOUS_CONTACTS.map(({ port }) => [...port.spaces].sort().join('|'));

    expect(new Set(pairs).size).toBe(AMBIGUOUS_CONTACTS.length / 2);
  });

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

  it('cuts a wall for every scheduled port, from the floor to the door head', () => {
    const openings = PORT_SCHEDULE.map((port) => getPortOpening(FLOOR_PLAN, port));
    const offenders = openings.filter(
      (opening) => opening.bottom !== FLOOR_LEVEL || opening.top !== FLOOR_HEIGHTS.door,
    );

    expect(openings).toHaveLength(PORT_SCHEDULE.length);
    expect(offenders).toEqual([]);
  });

  it('covers every face the schedule sits in across the pinned openings', () => {
    const sides = EXPECTED_OPENINGS.map(
      ({ first, second }) => getPortContact(FLOOR_PLAN, findPort(first, second)).side,
    );
    const scheduled = PORT_SCHEDULE.map((port) => getPortContact(FLOOR_PLAN, port).side);

    expect([...new Set(sides)].sort()).toEqual(['maxX', 'maxZ', 'minZ']);
    // The pinned list leaves no face of the schedule out: the whole schedule sits
    // in these same three. "All four faces" was never true of it.
    expect([...new Set(scheduled)].sort()).toEqual(['maxX', 'maxZ', 'minZ']);
  });

  it('reaches the fourth face, minX, only by naming a pair the other way round', () => {
    const [, scheduled, swapped] = SWAPPED_PORTS[0];

    expect(swapped.spaces).toEqual(['masterBedroom', 'balconyA']);
    expect(getPortContact(FLOOR_PLAN, swapped).side).toBe('minX');
    expect(getPortContact(FLOOR_PLAN, scheduled).side).toBe('maxX');
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

describe('needsSwingClearance', () => {
  it('needs clear floor for every swinging leaf, and there are fourteen', () => {
    const swinging = PORT_SCHEDULE.filter((port) => needsSwingClearance(port));

    expect(swinging).toHaveLength(EXPECTED_SWING_CLEARANCE_COUNT);
    expect(swinging.every((port) => port.kind === 'door' && port.swing === undefined)).toBe(true);
  });

  it('exempts the living-room opening, which has no leaf', () => {
    expect(needsSwingClearance(findPort('livingRoom', 'corridor'))).toBe(false);
  });

  it.each(SLIDING_PAIRS)('exempts the sliding leaf %s ↔ %s', (first, second) => {
    const port = findPort(first, second);

    expect(port.swing).toBe('slide');
    expect(needsSwingClearance(port)).toBe(false);
  });

  it('exempts exactly the opening and the five sliding leaves, and nothing else', () => {
    const exempt = PORT_SCHEDULE.filter((port) => !needsSwingClearance(port));

    expect(exempt).toHaveLength(PORT_SCHEDULE.length - EXPECTED_SWING_CLEARANCE_COUNT);
    expect(exempt.filter((port) => port.kind === 'opening')).toHaveLength(1);
    expect(exempt.filter((port) => port.swing === 'slide')).toHaveLength(SLIDING_PAIRS.length);
  });
});

describe('getPortsOf', () => {
  it('lists the seven corridor ports', () => {
    expect(getPortsOf(PORT_SCHEDULE, 'corridor')).toHaveLength(EXPECTED_CORRIDOR_PORT_COUNT);
  });

  it('lists nothing for a space with no port', () => {
    expect(getPortsOf(PORT_SCHEDULE, 'voidWest')).toEqual([]);
  });

  it('only returns ports that name the space, in schedule order', () => {
    const ports = getPortsOf(PORT_SCHEDULE, 'kitchen');

    expect(ports).toHaveLength(EXPECTED_KITCHEN_PORT_COUNT);
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
