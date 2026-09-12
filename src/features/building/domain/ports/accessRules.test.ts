import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, getNeighbours } from '../floorPlan/index.ts';
import type { SpaceId } from '../floorPlan/index.ts';
import { PORT_SCHEDULE } from './portSchedule.ts';
import { getPortPartners, getPortsOf } from './queries.ts';
import { validatePorts } from './validatePorts.ts';

const PRECISION_DIGITS = 9;
const EXPECTED_PORT_COUNT = 20;
const EXPECTED_DOOR_COUNT = 19;
const EXPECTED_OPENING_COUNT = 1;
const SINGLE_PORT = 1;

/** Clear width of the common door leaf of the floor, in metres. */
const DOOR_WIDTH = 0.9;
/** Clear width of the living-room opening onto the corridor (brief §4.1). */
const LIVING_OPENING_WIDTH = 3.5;
/**
 * Clear width of the control-center door, in metres.
 *
 * The only leaf of the floor wider than the common one: the control center holds
 * the water, gas and electricity risers, so a water heater or a gas bottle has to
 * pass through this door.
 */
const RISER_DOOR_WIDTH = 1.2;

/**
 * The access graph of the floor, written out by hand for every space of the
 * plan: the spaces each space opens onto through a port.
 *
 * The rules this table encodes, and which the named tests below assert one by
 * one: the laundry is reached through the main sanitair and the balcony slab,
 * never from the corridor it touches; the utility room opens only onto the
 * corridor; the master bedroom opens onto the corridor and its balcony, never
 * onto the stairs; each kids bedroom has one door, onto the corridor; the
 * control center is entered from the guest-room strip and opens onto its own
 * balcony; the guest room is reached from the stair landing, not from the
 * corridor or the kitchen it touches; the stairs open only onto the guest-room
 * strip; each bath and shower cubicle is reached only through its bathroom; and
 * nothing opens onto a void (brief §5.2). Symmetric: A lists B iff B lists A.
 *
 * Rewritten for the new plan: `linkCorridor` is gone, so the five doors that
 * used to reach the stairs, the control center and the guest room through it are
 * gone with it, and the guest room's north strip does that job instead. The four
 * bath and shower cubicles are rooms now, so they carry ports of their own, and
 * `ccBalcony` is new.
 */
const EXPECTED_PORT_PARTNERS: Readonly<Record<SpaceId, readonly SpaceId[]>> = {
  balconyA: ['masterBedroom', 'guestRoom'],
  masterBedroom: ['balconyA', 'corridor'],
  livingRoom: ['corridor'],
  bedroomMaleKids: ['corridor'],
  bedroomFemaleKids: ['corridor'],
  stairs: ['guestRoom'],
  corridor: [
    'masterBedroom',
    'livingRoom',
    'bedroomMaleKids',
    'bedroomFemaleKids',
    'utilityRoom',
    'kitchen',
    'mainSanitair',
  ],
  controlCenter: ['guestRoom', 'ccBalcony'],
  guestRoom: ['stairs', 'balconyA', 'controlCenter', 'guestSanitair'],
  guestSanitair: ['guestRoom', 'guestBathCubicle', 'guestShowerCubicle'],
  kitchen: ['corridor', 'balconySlabB'],
  laundry: ['mainSanitair', 'balconySlabB'],
  mainSanitair: ['corridor', 'laundry', 'mainBathCubicle', 'mainShowerCubicle'],
  utilityRoom: ['corridor'],
  ccBalcony: ['controlCenter'],
  balconySlabB: ['kitchen', 'laundry'],
  voidWest: [],
  voidEast: [],
  guestBathCubicle: ['guestSanitair'],
  guestShowerCubicle: ['guestSanitair'],
  mainBathCubicle: ['mainSanitair'],
  mainShowerCubicle: ['mainSanitair'],
};

/**
 * Every port width the schedule uses, in metres, one row per scheduled port.
 *
 * There is no single default width any more: each width is a consequence of the
 * room it serves, so each one is pinned here rather than checked against a list
 * of permitted values. Most depart from 0.90 downwards — 0.65 into the 0.75 m
 * deep guest-room strip, 0.60 into the guest cubicles, 0.70 where a cubicle or
 * the control-center balcony is too shallow for more — but the control-center
 * door departs upwards, at 1.20, because what has to pass through it is a water
 * heater or a gas bottle rather than a person. So 0.90 is the usual width here
 * and neither the smallest nor the largest, and a row that reads `DOOR_WIDTH`
 * claims only that this port is a common leaf, not that it is a default.
 */
const EXPECTED_WIDTHS: readonly (readonly [SpaceId, SpaceId, number])[] = [
  ['balconyA', 'masterBedroom', DOOR_WIDTH],
  ['masterBedroom', 'corridor', DOOR_WIDTH],
  ['livingRoom', 'corridor', LIVING_OPENING_WIDTH],
  ['bedroomMaleKids', 'corridor', DOOR_WIDTH],
  ['bedroomFemaleKids', 'corridor', DOOR_WIDTH],
  ['corridor', 'utilityRoom', DOOR_WIDTH],
  ['stairs', 'guestRoom', DOOR_WIDTH],
  ['corridor', 'kitchen', DOOR_WIDTH],
  ['corridor', 'mainSanitair', DOOR_WIDTH],
  ['balconyA', 'guestRoom', 0.65],
  ['controlCenter', 'guestRoom', RISER_DOOR_WIDTH],
  ['controlCenter', 'ccBalcony', 0.7],
  ['guestSanitair', 'guestBathCubicle', 0.6],
  ['guestSanitair', 'guestShowerCubicle', 0.6],
  ['mainSanitair', 'mainBathCubicle', 0.7],
  ['mainSanitair', 'mainShowerCubicle', 0.65],
  ['guestRoom', 'guestSanitair', 0.7],
  ['kitchen', 'balconySlabB', DOOR_WIDTH],
  ['laundry', 'mainSanitair', DOOR_WIDTH],
  ['laundry', 'balconySlabB', DOOR_WIDTH],
];

/**
 * Pairs that face each other across a wall with no port between them, and what
 * stands in the wall instead.
 *
 * The owner's movement rule is that the explorer crosses ports and only ports —
 * not walls, and not windows. A window is therefore not a way through, and the
 * two glazed pairs of this floor are the ones that could be mistaken for one:
 * the kitchen hands food to the guest room through a pass, and the control
 * center takes its daylight from the side-A balcony. Both must stay out of the
 * access graph while remaining neighbours in the plan.
 */
const GLAZED_NOT_PORTED: readonly (readonly [SpaceId, SpaceId, string])[] = [
  ['guestRoom', 'kitchen', 'the food pass replaced the door the old plan had here'],
  ['controlCenter', 'balconyA', 'a light window, not a way onto the balcony'],
];

/**
 * Returns the partners of a space, sorted for comparison.
 *
 * @param id - Identifier of the space.
 * @returns The ids the space opens onto, sorted.
 */
function partnersOf(id: SpaceId): readonly SpaceId[] {
  return [...getPortPartners(PORT_SCHEDULE, id)].sort();
}

/**
 * Returns the neighbours of a space, whether a port connects them or not.
 *
 * @param id - Identifier of the space.
 * @returns The ids of the spaces that face the space across a wall.
 */
function neighboursOf(id: SpaceId): ReadonlySet<SpaceId> {
  return new Set(getNeighbours(FLOOR_PLAN, id).map((contact) => contact.neighbourId));
}

const expectedEntries = Object.entries(EXPECTED_PORT_PARTNERS) as [SpaceId, readonly SpaceId[]][];

describe('hard access rules (brief §6)', () => {
  it('passes validatePorts against the floor plan', () => {
    expect(validatePorts(FLOOR_PLAN, PORT_SCHEDULE)).toBe(PORT_SCHEDULE);
  });

  it('schedules 20 ports: 19 doors and one opening', () => {
    expect(PORT_SCHEDULE).toHaveLength(EXPECTED_PORT_COUNT);
    expect(PORT_SCHEDULE.filter((port) => port.kind === 'door')).toHaveLength(EXPECTED_DOOR_COUNT);
    expect(PORT_SCHEDULE.filter((port) => port.kind === 'opening')).toHaveLength(
      EXPECTED_OPENING_COUNT,
    );
  });

  describe('the access graph', () => {
    it('lists an expected partner set for every space of the plan', () => {
      expect(Object.keys(EXPECTED_PORT_PARTNERS).sort()).toEqual(
        FLOOR_PLAN.spaces.map((space) => space.id).sort(),
      );
    });

    it('keeps the expected sets symmetric: A lists B iff B lists A', () => {
      const oneSided = expectedEntries.flatMap(([id, partners]) =>
        partners
          .filter((partnerId) => !EXPECTED_PORT_PARTNERS[partnerId].includes(id))
          .map((partnerId) => `${id} → ${partnerId}`),
      );

      expect(oneSided).toEqual([]);
    });

    it.each(expectedEntries)('opens %s onto exactly its expected partners', (id, expected) => {
      expect(partnersOf(id)).toEqual([...expected].sort());
    });

    it('derives a symmetric relation from the schedule itself', () => {
      const oneSided = FLOOR_PLAN.spaces.flatMap((space) =>
        getPortPartners(PORT_SCHEDULE, space.id)
          .filter((partnerId) => !getPortPartners(PORT_SCHEDULE, partnerId).includes(space.id))
          .map((partnerId) => `${space.id} → ${partnerId}`),
      );

      expect(oneSided).toEqual([]);
    });
  });

  describe('the service row', () => {
    it('reaches the laundry from the sanitair and the slab, never from the corridor', () => {
      expect(partnersOf('laundry')).toEqual(['balconySlabB', 'mainSanitair']);
      expect(partnersOf('laundry')).not.toContain('corridor');
      expect(neighboursOf('laundry')).toContain('corridor');
    });

    it('gives the utility room one door, onto the corridor', () => {
      const ports = getPortsOf(PORT_SCHEDULE, 'utilityRoom');

      expect(ports).toHaveLength(SINGLE_PORT);
      expect(partnersOf('utilityRoom')).toEqual(['corridor']);
    });

    it('reaches the kitchen from the corridor and its balcony slab only', () => {
      expect(partnersOf('kitchen')).toEqual(['balconySlabB', 'corridor']);
    });
  });

  describe('the bathrooms', () => {
    it('enters the guest sanitair from the guest room and serves its two cubicles', () => {
      expect(partnersOf('guestSanitair')).toEqual([
        'guestBathCubicle',
        'guestRoom',
        'guestShowerCubicle',
      ]);
    });

    it('enters the main sanitair from the corridor and the laundry, and serves its two cubicles', () => {
      expect(partnersOf('mainSanitair')).toEqual([
        'corridor',
        'laundry',
        'mainBathCubicle',
        'mainShowerCubicle',
      ]);
    });

    it.each([
      ['guestBathCubicle', 'guestSanitair', 'guestRoom'],
      ['guestShowerCubicle', 'guestSanitair', 'kitchen'],
      ['mainBathCubicle', 'mainSanitair', 'laundry'],
      ['mainShowerCubicle', 'mainSanitair', 'utilityRoom'],
    ] as const)(
      'reaches %s only through %s, never through the %s it touches',
      (cubicleId, bathroomId, touchedId) => {
        expect(getPortsOf(PORT_SCHEDULE, cubicleId)).toHaveLength(SINGLE_PORT);
        expect(partnersOf(cubicleId)).toEqual([bathroomId]);
        expect(neighboursOf(cubicleId)).toContain(touchedId);
      },
    );
  });

  describe('the bedrooms', () => {
    it('opens the master bedroom onto the corridor and its balcony, never onto the stairs', () => {
      expect(partnersOf('masterBedroom')).toEqual(['balconyA', 'corridor']);
      expect(partnersOf('masterBedroom')).not.toContain('stairs');
      expect(neighboursOf('masterBedroom')).toContain('stairs');
    });

    it.each(['bedroomMaleKids', 'bedroomFemaleKids'] as const)(
      'gives %s one door, onto the corridor',
      (id) => {
        expect(getPortsOf(PORT_SCHEDULE, id)).toHaveLength(SINGLE_PORT);
        expect(partnersOf(id)).toEqual(['corridor']);
      },
    );
  });

  describe('the guest-room strip', () => {
    it('enters the control center from the strip, never from the balcony it touches', () => {
      expect(partnersOf('controlCenter')).toEqual(['ccBalcony', 'guestRoom']);
      expect(partnersOf('controlCenter')).not.toContain('balconyA');
      expect(neighboursOf('controlCenter')).toContain('balconyA');
    });

    it('reaches the control-center balcony only through the control center', () => {
      expect(getPortsOf(PORT_SCHEDULE, 'ccBalcony')).toHaveLength(SINGLE_PORT);
      expect(partnersOf('ccBalcony')).toEqual(['controlCenter']);
    });

    it('reaches the guest room from the stairs, not the corridor or kitchen it touches', () => {
      expect(partnersOf('guestRoom')).toEqual([
        'balconyA',
        'controlCenter',
        'guestSanitair',
        'stairs',
      ]);
      expect(partnersOf('guestRoom')).not.toContain('corridor');
      expect(partnersOf('guestRoom')).not.toContain('kitchen');
      expect(neighboursOf('guestRoom')).toContain('corridor');
      expect(neighboursOf('guestRoom')).toContain('kitchen');
    });

    it('gives the side-A balcony its second door off the strip, not off the stairs', () => {
      expect(partnersOf('balconyA')).toEqual(['guestRoom', 'masterBedroom']);
      expect(partnersOf('balconyA')).not.toContain('stairs');
      expect(neighboursOf('balconyA')).toContain('stairs');
    });

    it('opens the stairs only onto the guest-room strip, with no side-A exterior door', () => {
      expect(getPortsOf(PORT_SCHEDULE, 'stairs')).toHaveLength(SINGLE_PORT);
      expect(partnersOf('stairs')).toEqual(['guestRoom']);
      expect(neighboursOf('stairs')).toContain('corridor');
    });
  });

  describe('movement crosses ports, not windows', () => {
    it.each(GLAZED_NOT_PORTED)('keeps %s ↔ %s out of the access graph: %s', (first, second) => {
      expect(neighboursOf(first)).toContain(second);
      expect(neighboursOf(second)).toContain(first);
      expect(partnersOf(first)).not.toContain(second);
      expect(partnersOf(second)).not.toContain(first);
    });
  });

  describe('the voids', () => {
    it.each(['voidWest', 'voidEast'] as const)('gives %s no port at all', (id) => {
      expect(getPortsOf(PORT_SCHEDULE, id)).toEqual([]);
      expect(partnersOf(id)).toEqual([]);
    });

    it('still lets the voids touch spaces that could have opened onto them', () => {
      expect(neighboursOf('voidWest').size).toBeGreaterThan(0);
      expect(neighboursOf('voidEast').size).toBeGreaterThan(0);
    });
  });

  describe('widths', () => {
    it('lists an expected width for every scheduled port', () => {
      expect(EXPECTED_WIDTHS).toHaveLength(PORT_SCHEDULE.length);
    });

    it.each(EXPECTED_WIDTHS)('makes the %s ↔ %s port %f m wide', (first, second, width) => {
      const port = PORT_SCHEDULE.find(
        ({ spaces }) => spaces.includes(first) && spaces.includes(second),
      );

      expect(port).toBeDefined();
      expect(port?.width ?? 0).toBeCloseTo(width, PRECISION_DIGITS);
    });
  });
});
