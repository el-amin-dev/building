import { describe, expect, it } from 'vitest';
import {
  FLOOR_SPACE_KEY_SEPARATOR,
  LOWEST_FLOOR,
  getFloorSpaceKey,
  isSameFloorSpace,
  makeFloorSpaceRef,
} from './floorSpace.ts';
import { SPACE_IDS } from './floorPlan/types.ts';

const GROUND_FLOOR = 1;
const SECOND_FLOOR = 2;
const THIRD_FLOOR = 3;
const NO_FLOOR = 0;
const BASEMENT_FLOOR = -1;
const HALF_FLOOR = 1.5;
const STOREY_COUNT = 10;
const EXPECTED_SPACE_COUNT = 21;
const EXPECTED_KEY_COUNT = STOREY_COUNT * EXPECTED_SPACE_COUNT;

describe('makeFloorSpaceRef', () => {
  it('names the room and the storey it is on', () => {
    const ref = makeFloorSpaceRef(SECOND_FLOOR, 'kitchen');
    expect(ref.floor).toBe(SECOND_FLOOR);
    expect(ref.spaceId).toBe('kitchen');
  });

  it('starts the building at floor 1, the lowest storey designed', () => {
    expect(LOWEST_FLOOR).toBe(GROUND_FLOOR);
    expect(makeFloorSpaceRef(LOWEST_FLOOR, 'stairs').floor).toBe(GROUND_FLOOR);
  });

  it('freezes the result, so a ref cannot be edited in place', () => {
    const ref = makeFloorSpaceRef(GROUND_FLOOR, 'corridor');
    expect(Object.isFrozen(ref)).toBe(true);
    expect(() => {
      (ref as { floor: number }).floor = SECOND_FLOOR;
    }).toThrow(TypeError);
  });

  it.each([
    ['floor 0, which is not designed', NO_FLOOR],
    ['a storey below the ground', BASEMENT_FLOOR],
    ['a storey between two storeys', HALF_FLOOR],
    ['a floor that is not a number at all', Number.NaN],
  ])('rejects %s', (_case, floor) => {
    expect(() => makeFloorSpaceRef(floor, 'kitchen')).toThrow(RangeError);
  });

  it('names the offending floor in the error', () => {
    expect(() => makeFloorSpaceRef(NO_FLOOR, 'kitchen')).toThrow(String(NO_FLOOR));
  });
});

describe('isSameFloorSpace', () => {
  it('compares by value, not by identity', () => {
    const ref = makeFloorSpaceRef(SECOND_FLOOR, 'kitchen');
    const twin = makeFloorSpaceRef(SECOND_FLOOR, 'kitchen');
    expect(ref).not.toBe(twin);
    expect(isSameFloorSpace(ref, twin)).toBe(true);
  });

  it('tells the same room on two storeys apart', () => {
    expect(
      isSameFloorSpace(
        makeFloorSpaceRef(SECOND_FLOOR, 'kitchen'),
        makeFloorSpaceRef(THIRD_FLOOR, 'kitchen'),
      ),
    ).toBe(false);
  });

  it('tells two rooms on the same storey apart', () => {
    expect(
      isSameFloorSpace(
        makeFloorSpaceRef(SECOND_FLOOR, 'kitchen'),
        makeFloorSpaceRef(SECOND_FLOOR, 'laundry'),
      ),
    ).toBe(false);
  });

  it('holds that nowhere stayed nowhere: two absences are the same place', () => {
    expect(isSameFloorSpace(undefined, undefined)).toBe(true);
  });

  it.each([
    ['leaving a room', makeFloorSpaceRef(SECOND_FLOOR, 'kitchen'), undefined],
    ['entering a room', undefined, makeFloorSpaceRef(SECOND_FLOOR, 'kitchen')],
  ])('counts %s as a change', (_case, a, b) => {
    expect(isSameFloorSpace(a, b)).toBe(false);
  });
});

describe('getFloorSpaceKey', () => {
  it('reads as the storey, the separator, then the space id', () => {
    expect(getFloorSpaceKey(makeFloorSpaceRef(SECOND_FLOOR, 'kitchen'))).toBe(
      `F${String(SECOND_FLOOR)}${FLOOR_SPACE_KEY_SEPARATOR}kitchen`,
    );
  });

  it('gives every room of every storey a key of its own', () => {
    expect(SPACE_IDS).toHaveLength(EXPECTED_SPACE_COUNT);
    const keys = new Set<string>();
    for (let floor = LOWEST_FLOOR; floor < LOWEST_FLOOR + STOREY_COUNT; floor += 1) {
      for (const spaceId of SPACE_IDS) {
        keys.add(getFloorSpaceKey(makeFloorSpaceRef(floor, spaceId)));
      }
    }
    expect(keys.size).toBe(EXPECTED_KEY_COUNT);
  });
});
