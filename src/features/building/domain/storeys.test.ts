import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import {
  clampFloorCount,
  FLOOR_COUNT_DIGITS,
  FLOOR_COUNT_STEP,
  formatFloorCount,
  getBuildingTop,
  getFloorLabel,
  getFloorsLabel,
  getStoreyAt,
  getStoreyLevel,
  getStoreyLevels,
  INITIAL_FLOOR_COUNT,
  MAX_FLOOR_COUNT,
  MIN_FLOOR_COUNT,
} from './storeys.ts';

/**
 * A section that is nothing like the typical floor's, so an assertion can only
 * pass if the arithmetic reads the injected heights instead of the constants.
 */
const TALL_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 4,
  wall: 3.5,
  door: 2.1,
  railing: 1.1,
});

/** A pitch whose multiples do not land on exact floating-point values. */
const AWKWARD_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 2.7,
  wall: 2.4,
  door: 2.1,
  railing: 1.1,
});

describe('the storey count bounds', () => {
  it('starts at one designed floor, inside the range', () => {
    expect(INITIAL_FLOOR_COUNT).toBeGreaterThanOrEqual(MIN_FLOOR_COUNT);
    expect(INITIAL_FLOOR_COUNT).toBeLessThanOrEqual(MAX_FLOOR_COUNT);
  });

  it('numbers floors from 1, since floor 0 is not designed', () => {
    expect(MIN_FLOOR_COUNT).toBe(1);
  });

  it('caps the stack at ten storeys, stepped one at a time', () => {
    expect(MAX_FLOOR_COUNT).toBe(10);
    expect(FLOOR_COUNT_STEP).toBe(1);
  });

  it('shows enough digits for the largest count', () => {
    expect(String(MAX_FLOOR_COUNT).length).toBeLessThanOrEqual(FLOOR_COUNT_DIGITS);
  });
});

describe('clampFloorCount', () => {
  it('lifts a count below the minimum to one storey', () => {
    expect(clampFloorCount(0)).toBe(1);
    expect(clampFloorCount(-5)).toBe(1);
  });

  it('holds a count above the maximum at ten storeys', () => {
    expect(clampFloorCount(11)).toBe(10);
    expect(clampFloorCount(99)).toBe(10);
  });

  it('keeps a count already in range', () => {
    expect(clampFloorCount(4)).toBe(4);
  });

  it('rounds a fractional count to the nearest whole storey, halves up', () => {
    expect(clampFloorCount(3.4)).toBe(3);
    expect(clampFloorCount(3.5)).toBe(4);
  });

  it('rejects a count that is not finite', () => {
    expect(() => clampFloorCount(Number.NaN)).toThrow(RangeError);
    expect(() => clampFloorCount(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => clampFloorCount(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatFloorCount', () => {
  it('pads a single digit so the stepper reads 01', () => {
    expect(formatFloorCount(1)).toBe('01');
    expect(formatFloorCount(9)).toBe('09');
  });

  it('leaves two digits alone', () => {
    expect(formatFloorCount(10)).toBe('10');
  });

  it('formats the clamped count, never the requested one', () => {
    expect(formatFloorCount(0)).toBe('01');
    expect(formatFloorCount(99)).toBe('10');
  });
});

describe('getStoreyLevel', () => {
  it('puts the first storey on the datum', () => {
    expect(getStoreyLevel(1)).toBe(0);
  });

  it('lifts each further storey by one floor-to-floor height', () => {
    expect(getStoreyLevel(2)).toBe(3);
    expect(getStoreyLevel(10)).toBe(27);
  });

  it('derives the pitch from the injected heights rather than the constants', () => {
    expect(getStoreyLevel(1, TALL_HEIGHTS)).toBe(0);
    expect(getStoreyLevel(3, TALL_HEIGHTS)).toBe(8);
    expect(getStoreyLevel(10, TALL_HEIGHTS)).toBe(36);
  });

  it('agrees with the source of truth when the heights are left out', () => {
    expect(getStoreyLevel(5)).toBe(getStoreyLevel(5, FLOOR_HEIGHTS));
  });

  it('rejects a floor below the first', () => {
    expect(() => getStoreyLevel(0)).toThrow(RangeError);
    expect(() => getStoreyLevel(-1)).toThrow(RangeError);
  });

  it('rejects a floor that is not a whole number', () => {
    expect(() => getStoreyLevel(1.5)).toThrow(RangeError);
    expect(() => getStoreyLevel(Number.NaN)).toThrow(RangeError);
  });

  it('rejects a pitch that cannot space a stack', () => {
    expect(() => getStoreyLevel(2, { ...FLOOR_HEIGHTS, floorToFloor: 0 })).toThrow(RangeError);
    expect(() => getStoreyLevel(2, { ...FLOOR_HEIGHTS, floorToFloor: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('getStoreyLevels', () => {
  it('gives the lone storey the datum', () => {
    expect(getStoreyLevels(1)).toEqual([0]);
  });

  it('lists a full stack lowest first', () => {
    const levels = getStoreyLevels(MAX_FLOOR_COUNT);

    expect(levels).toHaveLength(MAX_FLOOR_COUNT);
    expect(levels[0]).toBe(0);
    expect(levels.at(-1)).toBe(27);
  });

  it('spaces every storey at the pitch', () => {
    for (const level of getStoreyLevels(MAX_FLOOR_COUNT)) {
      expect(level % FLOOR_HEIGHTS.floorToFloor).toBe(0);
    }
  });

  it('rises in order', () => {
    const levels = getStoreyLevels(MAX_FLOOR_COUNT);

    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]).toBeGreaterThan(levels[index - 1]);
    }
  });

  it('derives the levels from the injected heights', () => {
    expect(getStoreyLevels(3, TALL_HEIGHTS)).toEqual([0, 4, 8]);
  });

  it('lists the levels of the clamped count', () => {
    expect(getStoreyLevels(99)).toHaveLength(MAX_FLOOR_COUNT);
    expect(getStoreyLevels(0)).toHaveLength(MIN_FLOOR_COUNT);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(getStoreyLevels(MAX_FLOOR_COUNT))).toBe(true);
  });

  it('rejects a count that is not finite', () => {
    expect(() => getStoreyLevels(Number.NaN)).toThrow(RangeError);
  });
});

describe('getStoreyAt', () => {
  it('puts the datum on the first storey', () => {
    expect(getStoreyAt(0)).toBe(1);
  });

  it('keeps a level between two floors on the floor below', () => {
    expect(getStoreyAt(2.99)).toBe(1);
    expect(getStoreyAt(3.01)).toBe(2);
  });

  it('puts a finished floor on the storey it belongs to', () => {
    expect(getStoreyAt(3)).toBe(2);
    expect(getStoreyAt(27)).toBe(10);
  });

  it('clamps below the first storey, which is as low as the design goes', () => {
    expect(getStoreyAt(-0.1)).toBe(1);
    expect(getStoreyAt(-100)).toBe(1);
  });

  it('inverts getStoreyLevel for every storey of a full stack', () => {
    for (let floor = MIN_FLOOR_COUNT; floor <= MAX_FLOOR_COUNT; floor += 1) {
      expect(getStoreyAt(getStoreyLevel(floor))).toBe(floor);
    }
  });

  it('inverts getStoreyLevel on a pitch whose multiples carry float noise', () => {
    for (let floor = MIN_FLOOR_COUNT; floor <= MAX_FLOOR_COUNT; floor += 1) {
      const level = (floor - MIN_FLOOR_COUNT) * AWKWARD_HEIGHTS.floorToFloor;

      expect(getStoreyAt(level, AWKWARD_HEIGHTS)).toBe(floor);
    }
  });

  it('derives the storey from the injected heights', () => {
    expect(getStoreyAt(3, TALL_HEIGHTS)).toBe(1);
    expect(getStoreyAt(4, TALL_HEIGHTS)).toBe(2);
  });

  it('rejects a level that is not finite', () => {
    expect(() => getStoreyAt(Number.NaN)).toThrow(RangeError);
    expect(() => getStoreyAt(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a pitch that cannot space a stack', () => {
    expect(() => getStoreyAt(3, { ...FLOOR_HEIGHTS, floorToFloor: 0 })).toThrow(RangeError);
  });
});

describe('getBuildingTop', () => {
  it('is one wall height above the datum for a single storey', () => {
    expect(getBuildingTop(FLOOR_HEIGHTS, 1)).toBe(2.7);
  });

  it('adds the pitch for every storey above the first', () => {
    expect(getBuildingTop(FLOOR_HEIGHTS, 10)).toBe(29.7);
  });

  it('stops at the top of the last walls, not at a slab that is not poured', () => {
    expect(getBuildingTop(FLOOR_HEIGHTS, 2)).toBe(5.7);
    expect(getBuildingTop(FLOOR_HEIGHTS, 2)).toBeLessThan(2 * FLOOR_HEIGHTS.floorToFloor);
  });

  it('derives the top from the injected heights', () => {
    expect(getBuildingTop(TALL_HEIGHTS, 1)).toBe(3.5);
    expect(getBuildingTop(TALL_HEIGHTS, 3)).toBe(11.5);
  });

  it('measures the count it is given, above the shown cap as well', () => {
    // `getExteriorFraming` promises a correct framing for any integer count of at least
    // one, so a count past `MAX_FLOOR_COUNT` must reach the true top rather than the cap's.
    const beyondCap = MAX_FLOOR_COUNT + 2;

    expect(getBuildingTop(FLOOR_HEIGHTS, beyondCap)).toBe(
      (beyondCap - MIN_FLOOR_COUNT) * FLOOR_HEIGHTS.floorToFloor + FLOOR_HEIGHTS.wall,
    );
    expect(getBuildingTop(FLOOR_HEIGHTS, beyondCap)).toBeGreaterThan(
      getBuildingTop(FLOOR_HEIGHTS, MAX_FLOOR_COUNT),
    );
  });

  it('rejects heights that cannot build a storey', () => {
    expect(() => getBuildingTop({ ...FLOOR_HEIGHTS, wall: 0 }, 1)).toThrow(RangeError);
    expect(() => getBuildingTop({ ...FLOOR_HEIGHTS, wall: Number.NaN }, 1)).toThrow(RangeError);
    expect(() => getBuildingTop({ ...FLOOR_HEIGHTS, floorToFloor: 0 }, 1)).toThrow(RangeError);
  });

  it('rejects a count that is not a whole storey of the 1…N numbering', () => {
    expect(() => getBuildingTop(FLOOR_HEIGHTS, Number.NaN)).toThrow(RangeError);
    expect(() => getBuildingTop(FLOOR_HEIGHTS, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => getBuildingTop(FLOOR_HEIGHTS, 0)).toThrow(RangeError);
    expect(() => getBuildingTop(FLOOR_HEIGHTS, -1)).toThrow(RangeError);
    expect(() => getBuildingTop(FLOOR_HEIGHTS, 2.5)).toThrow(RangeError);
  });
});

describe('getFloorLabel', () => {
  it('names a floor by its number', () => {
    expect(getFloorLabel(1)).toBe('Floor 1');
    expect(getFloorLabel(3)).toBe('Floor 3');
  });

  it('rejects a floor below the first, or one that is not whole', () => {
    expect(() => getFloorLabel(0)).toThrow(RangeError);
    expect(() => getFloorLabel(2.5)).toThrow(RangeError);
  });
});

describe('getFloorsLabel', () => {
  it('places a floor within its stack', () => {
    expect(getFloorsLabel(3, 7)).toBe('Floor 3 of 7');
  });

  it('reads the same for a stack of one', () => {
    expect(getFloorsLabel(1, 1)).toBe('Floor 1 of 1');
  });

  it('counts the clamped stack', () => {
    expect(getFloorsLabel(1, 99)).toBe('Floor 1 of 10');
  });

  it('rejects a floor below the first', () => {
    expect(() => getFloorsLabel(0, 7)).toThrow(RangeError);
  });
});
