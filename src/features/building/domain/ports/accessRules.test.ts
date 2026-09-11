import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, getNeighbours } from '../floorPlan/index.ts';
import type { SpaceId } from '../floorPlan/index.ts';
import { PORT_SCHEDULE } from './portSchedule.ts';
import { getPortPartners, getPortsOf } from './queries.ts';
import { validatePorts } from './validatePorts.ts';

const PRECISION_DIGITS = 9;
const EXPECTED_PORT_COUNT = 19;
const EXPECTED_DOOR_COUNT = 18;
const EXPECTED_OPENING_COUNT = 1;
const SINGLE_PORT = 1;

/** Clear width of a default door leaf, in metres (brief §6). */
const DOOR_WIDTH = 0.9;
/** Clear width of the balcony-A door into the 0.90 m link corridor (ADR-006). */
const LINK_DOOR_WIDTH = 0.8;
/** Clear width of the living-room opening onto the corridor (brief §4.1). */
const LIVING_OPENING_WIDTH = 3.5;

/**
 * The access graph of brief §6 "Hard access rules", written out by hand for
 * every space of the plan: the spaces each space opens onto through a port.
 *
 * The rules this table encodes, and which the named tests below assert one by
 * one: the laundry is reached through the kitchen, never from the corridor; the
 * utility room opens only onto the corridor; the master bedroom opens onto the
 * corridor and its balcony, never onto the stairs; each kids bedroom has one
 * door, onto the corridor; the control center is reached only through the link
 * corridor; the guest room is reached through the link corridor, not through the
 * corridor it touches; the stairs open only onto the link corridor; and nothing
 * opens onto a void (brief §5.2). Symmetric: A lists B iff B lists A.
 */
const EXPECTED_PORT_PARTNERS: Readonly<Record<SpaceId, readonly SpaceId[]>> = {
  balconyA: ['masterBedroom', 'linkCorridor'],
  masterBedroom: ['balconyA', 'corridor'],
  livingRoom: ['corridor'],
  bedroomMaleKids: ['corridor'],
  bedroomFemaleKids: ['corridor'],
  stairs: ['linkCorridor'],
  corridor: [
    'masterBedroom',
    'livingRoom',
    'bedroomMaleKids',
    'bedroomFemaleKids',
    'utilityRoom',
    'linkCorridor',
    'kitchen',
    'mainSanitair',
  ],
  linkCorridor: ['stairs', 'corridor', 'balconyA', 'controlCenter', 'guestRoom'],
  controlCenter: ['linkCorridor'],
  guestRoom: ['kitchen', 'linkCorridor', 'guestSanitair'],
  guestSanitair: ['guestRoom'],
  kitchen: ['corridor', 'guestRoom', 'laundry', 'balconySlabB'],
  laundry: ['kitchen', 'mainSanitair', 'balconySlabB'],
  mainSanitair: ['corridor', 'laundry'],
  utilityRoom: ['corridor'],
  balconySlabB: ['kitchen', 'laundry'],
  voidWest: [],
  voidEast: [],
};

/** Every port width the schedule uses, hand-read off brief §6 and ADR-006. */
const EXPECTED_WIDTHS: readonly (readonly [SpaceId, SpaceId, number])[] = [
  ['balconyA', 'masterBedroom', DOOR_WIDTH],
  ['masterBedroom', 'corridor', DOOR_WIDTH],
  ['livingRoom', 'corridor', LIVING_OPENING_WIDTH],
  ['bedroomMaleKids', 'corridor', DOOR_WIDTH],
  ['bedroomFemaleKids', 'corridor', DOOR_WIDTH],
  ['corridor', 'utilityRoom', DOOR_WIDTH],
  ['stairs', 'linkCorridor', DOOR_WIDTH],
  ['corridor', 'linkCorridor', DOOR_WIDTH],
  ['corridor', 'kitchen', DOOR_WIDTH],
  ['corridor', 'mainSanitair', DOOR_WIDTH],
  ['balconyA', 'linkCorridor', LINK_DOOR_WIDTH],
  ['guestRoom', 'kitchen', DOOR_WIDTH],
  ['kitchen', 'laundry', DOOR_WIDTH],
  ['laundry', 'mainSanitair', DOOR_WIDTH],
  ['linkCorridor', 'controlCenter', DOOR_WIDTH],
  ['linkCorridor', 'guestRoom', DOOR_WIDTH],
  ['guestRoom', 'guestSanitair', DOOR_WIDTH],
  ['kitchen', 'balconySlabB', DOOR_WIDTH],
  ['laundry', 'balconySlabB', DOOR_WIDTH],
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

  it('schedules 19 ports: 18 doors and one opening', () => {
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
    it('reaches the laundry through the kitchen, never from the corridor', () => {
      expect(partnersOf('laundry')).toEqual(['balconySlabB', 'kitchen', 'mainSanitair']);
      expect(partnersOf('laundry')).not.toContain('corridor');
      expect(neighboursOf('laundry')).toContain('corridor');
    });

    it('gives the utility room one door, onto the corridor', () => {
      const ports = getPortsOf(PORT_SCHEDULE, 'utilityRoom');

      expect(ports).toHaveLength(SINGLE_PORT);
      expect(partnersOf('utilityRoom')).toEqual(['corridor']);
    });

    it('reaches the guest sanitair only through the guest room', () => {
      expect(partnersOf('guestSanitair')).toEqual(['guestRoom']);
    });
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

  describe('the link corridor side', () => {
    it('reaches the control center only through the link corridor', () => {
      expect(partnersOf('controlCenter')).toEqual(['linkCorridor']);
    });

    it('reaches the guest room through the link corridor, not the corridor it touches', () => {
      expect(partnersOf('guestRoom')).toEqual(['guestSanitair', 'kitchen', 'linkCorridor']);
      expect(partnersOf('guestRoom')).not.toContain('corridor');
      expect(neighboursOf('guestRoom')).toContain('corridor');
    });

    it('opens the stairs only onto the link corridor, with no side-A exterior door', () => {
      expect(getPortsOf(PORT_SCHEDULE, 'stairs')).toHaveLength(SINGLE_PORT);
      expect(partnersOf('stairs')).toEqual(['linkCorridor']);
      expect(partnersOf('balconyA')).not.toContain('stairs');
    });
  });

  describe('the voids', () => {
    it.each(['voidWest', 'voidEast'] as const)('gives %s no port at all', (id) => {
      expect(getPortsOf(PORT_SCHEDULE, id)).toEqual([]);
      expect(partnersOf(id)).toEqual([]);
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
