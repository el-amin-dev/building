import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import {
  clampFloorCount,
  getStoreyLevels,
  MAX_FLOOR_COUNT,
  MIN_FLOOR_COUNT,
} from '../domain/storeys.ts';
import {
  getStoreyLevelsFor,
  getTopStoreyLevelFor,
  STOREY_LEVELS_BY_COUNT,
  TOP_STOREY_LEVELS_BY_COUNT,
} from './storeyLevels.ts';

/** One entry per legal count: `MIN_FLOOR_COUNT`…`MAX_FLOOR_COUNT`. */
const TABLE_LENGTH = 10;
/** Levels in the whole table: 1 + 2 + … + 10. */
const TABLE_TOTAL_LEVELS = 55;
/** The top storey of a ten-storey building, at the typical floor's 3.00 m pitch. */
const TEN_STOREY_TOP = 27;
/** A top-storey level list holds exactly one level. */
const ONE_LEVEL = 1;
/** Index of the last entry of an array, for `Array.prototype.at`. */
const LAST_INDEX = -1;
/** Both ends of the count range are legal, so the range is one longer than the difference. */
const RANGE_ENDPOINTS_INCLUSIVE = 1;
/** Decimal digits two levels must share to count as equal (sub-nanometre). */
const PRECISION_DIGITS = 9;
/** A count below the range and a count above it, to check the clamp at both ends. */
const BELOW_RANGE = 0;
const ABOVE_RANGE = 99;

/** Every legal storey count, lowest first. */
const COUNTS: readonly number[] = Array.from(
  { length: TABLE_LENGTH },
  (_unused, index) => index + MIN_FLOOR_COUNT,
);

describe('STOREY_LEVELS_BY_COUNT', () => {
  it('tabulates every count the stepper can ask for, indexed by count − MIN_FLOOR_COUNT', () => {
    expect(STOREY_LEVELS_BY_COUNT).toHaveLength(TABLE_LENGTH);
    expect(TABLE_LENGTH).toBe(MAX_FLOOR_COUNT - MIN_FLOOR_COUNT + RANGE_ENDPOINTS_INCLUSIVE);
    for (const count of COUNTS) {
      expect(STOREY_LEVELS_BY_COUNT[count - MIN_FLOOR_COUNT], String(count)).toHaveLength(count);
    }
    const total = STOREY_LEVELS_BY_COUNT.reduce((sum, levels) => sum + levels.length, 0);
    expect(total).toBe(TABLE_TOTAL_LEVELS);
  });

  it('holds exactly what the domain says, storey by storey', () => {
    for (const count of COUNTS) {
      expect(getStoreyLevelsFor(count), String(count)).toStrictEqual([...getStoreyLevels(count)]);
    }
  });

  it('starts a one-storey building at the datum and ends a ten-storey one at 27 m', () => {
    expect(getStoreyLevelsFor(MIN_FLOOR_COUNT)).toStrictEqual([0]);

    const tallest = getStoreyLevelsFor(MAX_FLOOR_COUNT);

    expect(tallest).toHaveLength(MAX_FLOOR_COUNT);
    expect(tallest.at(LAST_INDEX)).toBeCloseTo(TEN_STOREY_TOP, PRECISION_DIGITS);
    // Derived, not transcribed: the top is the pitch of `heights.ts` repeated under the
    // last storey, so a change to the section moves the whole stack.
    expect(TEN_STOREY_TOP).toBeCloseTo(
      (MAX_FLOOR_COUNT - MIN_FLOOR_COUNT) * FLOOR_HEIGHTS.floorToFloor,
      PRECISION_DIGITS,
    );
  });

  it('freezes every array, so no consumer can stack a storey by mutation', () => {
    for (const levels of STOREY_LEVELS_BY_COUNT) {
      expect(Object.isFrozen(levels)).toBe(true);
    }
    expect(Object.isFrozen(STOREY_LEVELS_BY_COUNT)).toBe(true);
  });

  it('returns the identical array on every call, which is what the geometry memo rests on', () => {
    for (const count of COUNTS) {
      // Identity, not equality: `MergedBoxesMesh` is handed this array, and a fresh object
      // per render is what would re-merge every wall, slab and step of the building.
      expect(getStoreyLevelsFor(count), String(count)).toBe(getStoreyLevelsFor(count));
      expect(getStoreyLevelsFor(count)).toBe(STOREY_LEVELS_BY_COUNT[count - MIN_FLOOR_COUNT]);
      expect(getTopStoreyLevelFor(count), String(count)).toBe(getTopStoreyLevelFor(count));
    }
  });

  it('clamps a count outside the shown range instead of falling off the table', () => {
    expect(getStoreyLevelsFor(BELOW_RANGE)).toBe(getStoreyLevelsFor(MIN_FLOOR_COUNT));
    expect(getStoreyLevelsFor(ABOVE_RANGE)).toBe(getStoreyLevelsFor(MAX_FLOOR_COUNT));
    expect(getTopStoreyLevelFor(BELOW_RANGE)).toBe(getTopStoreyLevelFor(MIN_FLOOR_COUNT));
    expect(getTopStoreyLevelFor(ABOVE_RANGE)).toBe(getTopStoreyLevelFor(MAX_FLOOR_COUNT));
    expect(clampFloorCount(BELOW_RANGE)).toBe(MIN_FLOOR_COUNT);
    expect(clampFloorCount(ABOVE_RANGE)).toBe(MAX_FLOOR_COUNT);
  });

  it('refuses a count that is not a number at all, as the domain does', () => {
    expect(() => getStoreyLevelsFor(Number.NaN)).toThrow(RangeError);
    expect(() => getTopStoreyLevelFor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('TOP_STOREY_LEVELS_BY_COUNT', () => {
  it('holds one level per count: the last level of that stack', () => {
    expect(TOP_STOREY_LEVELS_BY_COUNT).toHaveLength(TABLE_LENGTH);
    for (const count of COUNTS) {
      const top = getTopStoreyLevelFor(count);
      expect(top, String(count)).toHaveLength(ONE_LEVEL);
      expect(top[0], String(count)).toBe(getStoreyLevelsFor(count).at(LAST_INDEX));
    }
  });

  it('is the datum for a one-storey building and 27 m for a ten-storey one', () => {
    expect(getTopStoreyLevelFor(MIN_FLOOR_COUNT)).toStrictEqual([0]);
    expect(getTopStoreyLevelFor(MAX_FLOOR_COUNT)[0]).toBeCloseTo(TEN_STOREY_TOP, PRECISION_DIGITS);
  });

  it('freezes every array', () => {
    expect(Object.isFrozen(TOP_STOREY_LEVELS_BY_COUNT)).toBe(true);
    for (const levels of TOP_STOREY_LEVELS_BY_COUNT) {
      expect(Object.isFrozen(levels)).toBe(true);
    }
  });
});
