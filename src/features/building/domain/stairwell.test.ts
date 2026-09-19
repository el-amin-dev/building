import { describe, expect, it } from 'vitest';
import { makeRect } from './planGeometry.ts';
import type { PlanPoint } from './planGeometry.ts';
import { getRampRise, getStairFooting, isNearStairwell, STAIR_REACH_RISERS } from './stairwell.ts';
import type { StairLanding, StairRamp, Stairwell } from './stairwell.ts';

/**
 * Everything here is synthetic. The point of this module is that it knows
 * nothing about the floor plan, the source of truth or the storey heights: it
 * reads whatever surfaces it is handed. So the surfaces below are written out
 * by hand, in round numbers chosen to make a mistake visible, and nothing in
 * this file imports the plan — `stairs.test.ts` is where the real stair meets
 * this module.
 */

const PRECISION_DIGITS = 9;

/** A storey, in metres: the distance between two surfaces over one footprint. */
const STOREY = 3;
/** Half a storey: the rise of one flight. */
const HALF_STOREY = 1.5;
/** The run of one flight in plan, in metres: 1.50 up over 2.00 along is a 0.75 gradient. */
const RUN = 2;
/** The gradient that gives: `HALF_STOREY / RUN`. */
const FLIGHT_GRADIENT = 0.75;
/** The gradient of a landing, and the rise of this storey's own floor: level. */
const LEVEL = 0;
/** How far a body may step, in metres: 1.5 risers of a 3.00 m storey cut into 18. */
const REACH = 0.25;
/** A nudge past a boundary, in metres: far larger than the length tolerance. */
const EPSILON = 0.001;
/** Halving factor, for midpoints and half-radii. */
const HALF = 0.5;
/** Doubling factor, for a distance no body could be standing at. */
const TWICE = 2;

/** Quarter of the way along a run, in metres. */
const QUARTER_RUN = RUN * HALF * HALF;
/** Halfway along it. */
const MID_RUN = RUN * HALF;
/** Three quarters of the way along it. */
const THREE_QUARTER_RUN = RUN - QUARTER_RUN;

/** A body's radius, in metres (the 0.25 of `PERSON_SPEC`, restated not imported). */
const RADIUS = 0.25;

/** The bay every synthetic well stands in: 2.00 along x by 2.00 along z. */
const BAY = makeRect(0, RUN, 0, RUN);

/** A point over the north strip of the bay, halfway along the run. */
const ON_NORTH_STRIP: PlanPoint = Object.freeze({ x: MID_RUN, z: QUARTER_RUN });
/** The same place across the rail, over the south strip. */
const ON_SOUTH_STRIP: PlanPoint = Object.freeze({ x: MID_RUN, z: THREE_QUARTER_RUN });
/** Somewhere well inside every footprint below. */
const INSIDE: PlanPoint = Object.freeze({ x: QUARTER_RUN, z: QUARTER_RUN });

/**
 * A flight climbing toward +x: `lowAt` before `highAt` on the run axis.
 *
 * The north strip of the bay, rising the half storey from 0 to +1.50.
 */
const RISING_EAST: StairRamp = Object.freeze({
  rect: makeRect(0, RUN, 0, MID_RUN),
  runAxis: 'x',
  lowAt: 0,
  highAt: RUN,
  lowLevel: LEVEL,
  highLevel: HALF_STOREY,
});

/**
 * A flight climbing toward −x: `lowAt` AFTER `highAt` on the run axis.
 *
 * The mirror of the one above, and the reason it is here: the real stair has
 * one of each — `flightA` descends toward +x while `flightB` descends toward −x
 * — so an interpolation that assumed `lowAt < highAt` would be right on one
 * flight and silently upside down on the other.
 */
const RISING_WEST: StairRamp = Object.freeze({
  rect: makeRect(0, RUN, MID_RUN, RUN),
  runAxis: 'x',
  lowAt: RUN,
  highAt: 0,
  lowLevel: -HALF_STOREY,
  highLevel: LEVEL,
});

/**
 * A flight whose levels are not representable in binary: 0.1 up to 0.3.
 *
 * `lowLevel + 1 × (highLevel − lowLevel)` is 0.29999999999999993 here, not 0.3.
 * Every level a walker stands on at the top of a flight comes off that end, so
 * an end a rounding away from the landing it meets is a step the body falls
 * down and climbs again, every frame it stands there.
 */
const AWKWARD: StairRamp = Object.freeze({
  rect: BAY,
  runAxis: 'z',
  lowAt: RUN,
  highAt: 0,
  lowLevel: 0.1,
  highLevel: 0.3,
});

/** The two flights side by side, a half storey apart over every point of the bay. */
const FLIGHTS_WELL: Stairwell = Object.freeze({
  bay: BAY,
  ramps: Object.freeze([RISING_WEST, RISING_EAST]),
  landings: Object.freeze([]),
  reach: REACH,
});

/** A turn landing half a storey below this floor. */
const TURN_BELOW: StairLanding = Object.freeze({ rect: BAY, level: -HALF_STOREY });
/** The same footprint half a storey above it: the stair repeats every storey. */
const TURN_ABOVE: StairLanding = Object.freeze({ rect: BAY, level: HALF_STOREY });

/** Two surfaces a single step apart, both within reach of a body between them. */
const NEAR_PAIR: readonly StairLanding[] = Object.freeze([
  Object.freeze({ rect: BAY, level: LEVEL }),
  Object.freeze({ rect: BAY, level: 0.2 }),
]);
/** A rise between the two of {@link NEAR_PAIR}, nearer the upper one. */
const BETWEEN_NEAR_PAIR = 0.15;

/**
 * Builds a well of landings in a given order.
 *
 * Order is what several tests vary: the module must scan for the nearest
 * surface rather than take the first one within reach, and those two only
 * differ when the nearest is not the first.
 *
 * @param landings - The landings, in the order the well lists them.
 * @returns A stairwell over {@link BAY} with no flights.
 */
function landingsWell(landings: readonly StairLanding[]): Stairwell {
  return Object.freeze({ bay: BAY, ramps: Object.freeze([]), landings, reach: REACH });
}

/**
 * Builds the point on a ramp's run at a given coordinate along it.
 *
 * @param ramp - The ramp whose run axis the coordinate is on.
 * @param along - The coordinate on that axis, in metres.
 * @returns A point on the ramp, across the middle of its width.
 */
function alongRun(ramp: StairRamp, along: number): PlanPoint {
  const across =
    ramp.runAxis === 'x'
      ? (ramp.rect.minZ + ramp.rect.maxZ) * HALF
      : (ramp.rect.minX + ramp.rect.maxX) * HALF;
  return ramp.runAxis === 'x' ? { x: along, z: across } : { x: across, z: along };
}

describe('stairwell', () => {
  describe('STAIR_REACH_RISERS', () => {
    it('lets a body step one riser and a half', () => {
      expect(STAIR_REACH_RISERS).toBe(HALF_STOREY);
    });
  });

  describe('getRampRise', () => {
    it.each([
      ['a run toward +x', RISING_EAST],
      ['a run toward −x', RISING_WEST],
      ['a run whose levels do not divide in binary', AWKWARD],
    ])('is exactly the low and the high level at the ends of %s', (_label, ramp) => {
      // `toBe`, not `toBeCloseTo`: the ends of a flight are where it hands a
      // walker to a landing, and everything else rests on the two agreeing
      // exactly rather than to nine digits.
      expect(getRampRise(ramp, alongRun(ramp, ramp.lowAt))).toBe(ramp.lowLevel);
      expect(getRampRise(ramp, alongRun(ramp, ramp.highAt))).toBe(ramp.highLevel);
    });

    it('interpolates linearly along a run toward +x', () => {
      expect(getRampRise(RISING_EAST, alongRun(RISING_EAST, MID_RUN))).toBeCloseTo(
        HALF_STOREY * HALF,
        PRECISION_DIGITS,
      );
      expect(getRampRise(RISING_EAST, alongRun(RISING_EAST, QUARTER_RUN))).toBeCloseTo(
        HALF_STOREY * HALF * HALF,
        PRECISION_DIGITS,
      );
    });

    it('interpolates the other way along a run toward −x', () => {
      // The sign-error catcher, and it is the quarter point that catches it: a
      // ramp read as if it rose toward +x gives the same −0.75 at the midpoint,
      // but −1.125 here, which is the rise three quarters of the way along —
      // the flight upside down, its treads laid against the direction of travel.
      expect(getRampRise(RISING_WEST, alongRun(RISING_WEST, MID_RUN))).toBeCloseTo(
        -HALF_STOREY * HALF,
        PRECISION_DIGITS,
      );
      expect(getRampRise(RISING_WEST, alongRun(RISING_WEST, QUARTER_RUN))).toBeCloseTo(
        -HALF_STOREY * HALF * HALF,
        PRECISION_DIGITS,
      );
      expect(getRampRise(RISING_WEST, alongRun(RISING_WEST, THREE_QUARTER_RUN))).toBeCloseTo(
        -HALF_STOREY + HALF_STOREY * HALF * HALF,
        PRECISION_DIGITS,
      );
    });

    it('offers nothing outside the footprint, on either axis', () => {
      expect(getRampRise(RISING_EAST, ON_SOUTH_STRIP)).toBeUndefined();
      expect(getRampRise(RISING_EAST, { x: -QUARTER_RUN, z: QUARTER_RUN })).toBeUndefined();
      expect(getRampRise(RISING_WEST, ON_NORTH_STRIP)).toBeUndefined();
      expect(
        getRampRise(RISING_WEST, { x: RUN + QUARTER_RUN, z: THREE_QUARTER_RUN }),
      ).toBeUndefined();
    });
  });

  describe('getStairFooting', () => {
    it('stands a body on the flight it is walking, at that flight’s gradient', () => {
      const footing = getStairFooting(FLIGHTS_WELL, ON_NORTH_STRIP, HALF_STOREY * HALF);

      expect(footing?.rise).toBeCloseTo(HALF_STOREY * HALF, PRECISION_DIGITS);
      expect(footing?.gradient).toBeCloseTo(FLIGHT_GRADIENT, PRECISION_DIGITS);
    });

    it('reports no gradient on a landing', () => {
      const footing = getStairFooting(landingsWell([TURN_ABOVE]), INSIDE, HALF_STOREY);

      expect(footing?.rise).toBe(TURN_ABOVE.level);
      expect(footing?.gradient).toBe(LEVEL);
    });

    it('offers nothing where no surface covers the point', () => {
      expect(
        getStairFooting(FLIGHTS_WELL, { x: RUN + QUARTER_RUN, z: QUARTER_RUN }, LEVEL),
      ).toBeUndefined();
    });

    it.each([
      ['takes a surface exactly a reach away', REACH, true],
      ['leaves one a hair further', REACH + EPSILON, false],
    ])('%s', (_label, distance, reachable) => {
      const footing = getStairFooting(
        landingsWell([TURN_ABOVE]),
        INSIDE,
        TURN_ABOVE.level - distance,
      );

      expect(footing !== undefined).toBe(reachable);
    });

    it('never picks the wrong surface of a footprint occupied twice', () => {
      // The half-landing of the real stair: floor half a storey up AND half a
      // storey down, the two exactly a storey apart. Every rise a body can be at
      // while standing on one of them must read back that one, never the other.
      const well = landingsWell([TURN_BELOW, TURN_ABOVE]);
      const offsets = [-REACH, -REACH * HALF, LEVEL, REACH * HALF, REACH];

      [TURN_BELOW, TURN_ABOVE].forEach((landing) => {
        offsets.forEach((offset) => {
          expect(getStairFooting(well, INSIDE, landing.level + offset)?.rise).toBe(landing.level);
        });
      });
      expect(TURN_ABOVE.level - TURN_BELOW.level).toBeCloseTo(STOREY, PRECISION_DIGITS);
    });

    it.each([
      ['the nearer surface first', NEAR_PAIR.toReversed()],
      ['the further surface first', NEAR_PAIR],
    ])('takes the nearest of two surfaces in reach, listed with %s', (_label, landings) => {
      // A scan for the nearest, not a search for the first: both surfaces are
      // within reach here, so a `find` would answer with whichever the list
      // happens to start with, and be right half the time.
      const footing = getStairFooting(landingsWell(landings), INSIDE, BETWEEN_NEAR_PAIR);

      expect(footing?.rise).toBe(NEAR_PAIR[1].level);
    });

    it('refuses the flight beside the one the body is on', () => {
      // The refusal that does the work of a guard rail: over these points the
      // two flights are a half storey apart, so a body on one is nowhere near
      // the other and there is nothing to step sideways onto.
      const onNorth = getStairFooting(FLIGHTS_WELL, ON_NORTH_STRIP, HALF_STOREY * HALF);
      const acrossTheRail = getStairFooting(
        FLIGHTS_WELL,
        ON_SOUTH_STRIP,
        onNorth?.rise ?? Number.NaN,
      );

      expect(onNorth).toBeDefined();
      expect(acrossTheRail).toBeUndefined();
    });
  });

  describe('isNearStairwell', () => {
    it('admits a body half a radius outside the bay, and one inside it', () => {
      expect(isNearStairwell(FLIGHTS_WELL, { x: -RADIUS * HALF, z: QUARTER_RUN }, RADIUS)).toBe(
        true,
      );
      expect(isNearStairwell(FLIGHTS_WELL, INSIDE, RADIUS)).toBe(true);
    });

    it('rejects a body two radii outside it', () => {
      expect(isNearStairwell(FLIGHTS_WELL, { x: -RADIUS * TWICE, z: QUARTER_RUN }, RADIUS)).toBe(
        false,
      );
      expect(
        isNearStairwell(FLIGHTS_WELL, { x: QUARTER_RUN, z: RUN + RADIUS * TWICE }, RADIUS),
      ).toBe(false);
    });
  });
});
