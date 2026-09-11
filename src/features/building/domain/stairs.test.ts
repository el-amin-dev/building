import { describe, expect, it } from 'vitest';
import { findSpaceAt, FLOOR_PLAN, getSpace, getSpaceBounds } from './floorPlan/index.ts';
import type { FloorPlan } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectContainsPoint,
  rectContainsRect,
  rectsOverlap,
  toPlanLength,
} from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { getBlockedRects, getStairsLayout, STAIRS_SPEC } from './stairs.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;

/**
 * Synthetic heights, injected everywhere a vertical value is checked: a
 * floor-to-floor of 3.40 m gives a round 0.20 m riser, unlike the 3.00 m of
 * `FLOOR_HEIGHTS`, so a level that ignores the injected heights stands out.
 */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 3.4,
  wall: 3.0,
  door: 2.2,
  railing: 1.2,
  windowSill: 1.0,
  windowHead: 2.2,
});

/** `SYNTHETIC_HEIGHTS.floorToFloor / 17`, written out. */
const SYNTHETIC_RISER = 0.2;

/** The `stairs` bay of the plan (brief §4.2), restated from the plan data. */
const EXPECTED_BAY: PlanRect = { minX: 1.6, maxX: 5.3, minZ: 3.9, maxZ: 5.4 };
/** The solid flight area: the western 2.40 m of the bay, full depth (owner answer 2026-09-11). */
const EXPECTED_FLIGHT_RECT: PlanRect = { minX: 1.6, maxX: 4.0, minZ: 3.9, maxZ: 5.4 };
/** The walkable landing: the eastern 1.30 m of the bay, full depth. */
const EXPECTED_LANDING_RECT: PlanRect = { minX: 4.0, maxX: 5.3, minZ: 3.9, maxZ: 5.4 };
/** The half-landing: the 0.40 m left of the run by 8 goings, full depth. */
const EXPECTED_HALF_LANDING_RECT: PlanRect = { minX: 1.6, maxX: 2.0, minZ: 3.9, maxZ: 5.4 };

/** Depth range of the up-flight: the northern half of the bay. */
const UP_FLIGHT_Z: readonly [number, number] = [3.9, 4.65];
/** Depth range of the return flight: the southern half of the bay. */
const RETURN_FLIGHT_Z: readonly [number, number] = [4.65, 5.4];

/** One expected step: its 1-based riser index, its x range and its top under `SYNTHETIC_HEIGHTS`. */
interface ExpectedStep {
  /** 1-based riser index, which is also the step's position in `steps`, plus one. */
  readonly riserIndex: number;
  /** Western face of the tread, in metres. */
  readonly minX: number;
  /** Eastern face of the tread, in metres. */
  readonly maxX: number;
  /** Top of the tread above the finished floor, in metres, under `SYNTHETIC_HEIGHTS`. */
  readonly top: number;
}

/**
 * The 8 treads of the up-flight, by hand: climbing westward from the landing
 * edge x 4.00 to the half-landing at x 2.00, one 0.25 m going at a time, tops
 * 1 … 8 × 0.20 m.
 */
const UP_FLIGHT_TREADS: readonly ExpectedStep[] = [
  { riserIndex: 1, minX: 3.75, maxX: 4.0, top: 0.2 },
  { riserIndex: 2, minX: 3.5, maxX: 3.75, top: 0.4 },
  { riserIndex: 3, minX: 3.25, maxX: 3.5, top: 0.6 },
  { riserIndex: 4, minX: 3.0, maxX: 3.25, top: 0.8 },
  { riserIndex: 5, minX: 2.75, maxX: 3.0, top: 1.0 },
  { riserIndex: 6, minX: 2.5, maxX: 2.75, top: 1.2 },
  { riserIndex: 7, minX: 2.25, maxX: 2.5, top: 1.4 },
  { riserIndex: 8, minX: 2.0, maxX: 2.25, top: 1.6 },
];

/** The half-landing, by hand: riser 9, the full depth of the bay. */
const HALF_LANDING_STEP: ExpectedStep = { riserIndex: 9, minX: 1.6, maxX: 2.0, top: 1.8 };

/**
 * The 8 treads of the return flight, by hand: climbing eastward from the
 * half-landing at x 2.00 back to x 4.00, tops 10 … 17 × 0.20 m, the last one
 * being the 3.40 m level of the next floor.
 */
const RETURN_FLIGHT_TREADS: readonly ExpectedStep[] = [
  { riserIndex: 10, minX: 2.0, maxX: 2.25, top: 2.0 },
  { riserIndex: 11, minX: 2.25, maxX: 2.5, top: 2.2 },
  { riserIndex: 12, minX: 2.5, maxX: 2.75, top: 2.4 },
  { riserIndex: 13, minX: 2.75, maxX: 3.0, top: 2.6 },
  { riserIndex: 14, minX: 3.0, maxX: 3.25, top: 2.8 },
  { riserIndex: 15, minX: 3.25, maxX: 3.5, top: 3.0 },
  { riserIndex: 16, minX: 3.5, maxX: 3.75, top: 3.2 },
  { riserIndex: 17, minX: 3.75, maxX: 4.0, top: 3.4 },
];

/**
 * Clear span of the door between the stairs and the link corridor, by hand: a
 * 0.90 m leaf at x 4.00–4.90 on the southern face of the bay (owner answer
 * 2026-09-11). It must sit on the walkable landing, never on the flights.
 */
const LINK_DOOR_SPAN: readonly [number, number] = [4.0, 4.9];

/** Where a person arrives on the floor, by hand: the centre of the landing. */
const EXPECTED_ARRIVAL: readonly [number, number] = [4.65, 4.65];
/** Forward direction expected at the arrival yaw: straight toward +x, the corridor. */
const EXPECTED_FORWARD: readonly [number, number] = [1, 0];
/**
 * A step forward from the arrival long enough to leave the bay through its
 * eastern face: 4.65 + 0.80 = 5.45, inside the corridor. The opposite heading
 * would land at 3.85, inside the flight area.
 */
const STEP_TO_CORRIDOR = 0.8;

const NOT_A_NUMBER = Number.NaN;
const INFINITE = Number.POSITIVE_INFINITY;
const NON_POSITIVE_HEIGHT = 0;

const LAYOUT = getStairsLayout(FLOOR_PLAN, SYNTHETIC_HEIGHTS);
const DEFAULT_LAYOUT = getStairsLayout(FLOOR_PLAN);
const EXPECTED_STEPS: readonly ExpectedStep[] = [
  ...UP_FLIGHT_TREADS,
  HALF_LANDING_STEP,
  ...RETURN_FLIGHT_TREADS,
];

/**
 * Builds a copy of the plan whose `stairs` space is a single given rect.
 *
 * @param bay - Coordinates of the replacement bay, `[minX, maxX, minZ, maxZ]`.
 * @returns A new plan; `FLOOR_PLAN` is not modified.
 */
function withStairsBay(bay: readonly [number, number, number, number]): FloorPlan {
  return {
    ...FLOOR_PLAN,
    spaces: FLOOR_PLAN.spaces.map((space) =>
      space.id === 'stairs' ? { ...space, rects: [makeRect(...bay)] } : space,
    ),
  };
}

/** Builds a copy of the plan with no `stairs` space at all. */
function withoutStairs(): FloorPlan {
  return { ...FLOOR_PLAN, spaces: FLOOR_PLAN.spaces.filter((space) => space.id !== 'stairs') };
}

/**
 * Returns the length two ranges share.
 *
 * @param a - First `[min, max]` range.
 * @param b - Second `[min, max]` range.
 * @returns The overlap length; zero or negative when the ranges only touch or are disjoint.
 */
function overlapLength(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
}

describe('stairs', () => {
  describe('STAIRS_SPEC', () => {
    it('holds the sizes of the owner answer of 2026-09-11', () => {
      expect(STAIRS_SPEC).toEqual({ riserCount: 17, going: 0.25, flightWidth: 0.75 });
      expect(Object.isFrozen(STAIRS_SPEC)).toBe(true);
    });

    it('makes a flight exactly half the depth of the stairs bay', () => {
      const bay = getSpaceBounds(getSpace(FLOOR_PLAN, 'stairs'));

      expect(STAIRS_SPEC.flightWidth).toBeCloseTo((bay.maxZ - bay.minZ) * HALF, PRECISION_DIGITS);
    });
  });

  describe('bay subdivision', () => {
    it('takes the bay from the stairs space of the plan', () => {
      expect(getSpaceBounds(getSpace(FLOOR_PLAN, 'stairs'))).toEqual(EXPECTED_BAY);
    });

    it('puts the flights west of x 4.00 over the full depth', () => {
      expect(LAYOUT.flightRect).toEqual(EXPECTED_FLIGHT_RECT);
    });

    it('puts the walkable landing east of x 4.00 over the full depth', () => {
      expect(LAYOUT.landingRect).toEqual(EXPECTED_LANDING_RECT);
    });

    it('puts the half-landing at the western end over the full depth', () => {
      expect(LAYOUT.halfLandingRect).toEqual(EXPECTED_HALF_LANDING_RECT);
      expect(rectContainsRect(LAYOUT.flightRect, LAYOUT.halfLandingRect)).toBe(true);
    });

    it('tiles the whole bay with the flight area and the landing, with no gap or overlap', () => {
      const bay = getSpaceBounds(getSpace(FLOOR_PLAN, 'stairs'));

      expect(LAYOUT.flightRect.maxX).toBe(LAYOUT.landingRect.minX);
      expect(LAYOUT.flightRect.minX).toBe(bay.minX);
      expect(LAYOUT.landingRect.maxX).toBe(bay.maxX);
      expect(rectsOverlap(LAYOUT.flightRect, LAYOUT.landingRect)).toBe(false);
      expect(rectArea(LAYOUT.flightRect) + rectArea(LAYOUT.landingRect)).toBeCloseTo(
        rectArea(bay),
        PRECISION_DIGITS,
      );
      [LAYOUT.flightRect, LAYOUT.landingRect].forEach((part) => {
        expect(part.minZ).toBe(bay.minZ);
        expect(part.maxZ).toBe(bay.maxZ);
      });
    });
  });

  describe('risers', () => {
    it.each([
      ['the injected heights', SYNTHETIC_HEIGHTS, LAYOUT],
      ['the floor heights', FLOOR_HEIGHTS, DEFAULT_LAYOUT],
    ] as const)(
      'divides the floor-to-floor of %s into 17 equal risers',
      (_label, heights, layout) => {
        expect(layout.steps).toHaveLength(STAIRS_SPEC.riserCount);
        expect(layout.riser * STAIRS_SPEC.riserCount).toBeCloseTo(
          heights.floorToFloor,
          PRECISION_DIGITS,
        );
        expect(layout.steps[layout.steps.length - 1].top).toBeCloseTo(
          heights.floorToFloor,
          PRECISION_DIGITS,
        );
      },
    );

    it('reaches the next floor level exactly on the last tread', () => {
      expect(DEFAULT_LAYOUT.steps[DEFAULT_LAYOUT.steps.length - 1].top).toBe(
        FLOOR_HEIGHTS.floorToFloor,
      );
      expect(LAYOUT.steps[LAYOUT.steps.length - 1].top).toBe(SYNTHETIC_HEIGHTS.floorToFloor);
    });

    it('starts one full riser above the floor, never at floor level', () => {
      const [first] = LAYOUT.steps;

      expect(first.bottom).toBe(0);
      expect(first.top).toBeCloseTo(LAYOUT.riser, PRECISION_DIGITS);
      expect(first.top).toBeGreaterThan(LENGTH_TOLERANCE);
    });

    it('raises every step by exactly one riser over its predecessor', () => {
      LAYOUT.steps.forEach((step, index) => {
        expect(step.bottom).toBe(0);
        expect(step.top).toBeCloseTo((index + 1) * LAYOUT.riser, PRECISION_DIGITS);
      });
    });

    it('never overshoots the floor-to-floor height', () => {
      LAYOUT.steps.forEach((step) => {
        expect(step.top).toBeLessThanOrEqual(SYNTHETIC_HEIGHTS.floorToFloor + LENGTH_TOLERANCE);
      });
    });
  });

  describe('injected heights', () => {
    it('takes every vertical value from the injected heights, not from FLOOR_HEIGHTS', () => {
      expect(LAYOUT.riser).toBeCloseTo(SYNTHETIC_RISER, PRECISION_DIGITS);
      expect(LAYOUT.riser).not.toBeCloseTo(DEFAULT_LAYOUT.riser, PRECISION_DIGITS);
      LAYOUT.steps.forEach((step, index) => {
        expect(step.top).not.toBeCloseTo(DEFAULT_LAYOUT.steps[index].top, PRECISION_DIGITS);
      });
      expect(LAYOUT.steps[LAYOUT.steps.length - 1].top).not.toBeCloseTo(
        FLOOR_HEIGHTS.floorToFloor,
        PRECISION_DIGITS,
      );
    });

    it('keeps the plan geometry independent of the heights', () => {
      expect(LAYOUT.flightRect).toEqual(DEFAULT_LAYOUT.flightRect);
      expect(LAYOUT.landingRect).toEqual(DEFAULT_LAYOUT.landingRect);
      expect(LAYOUT.halfLandingRect).toEqual(DEFAULT_LAYOUT.halfLandingRect);
      expect(LAYOUT.arrival).toEqual(DEFAULT_LAYOUT.arrival);
      expect(LAYOUT.steps.map((step) => step.rect)).toEqual(
        DEFAULT_LAYOUT.steps.map((step) => step.rect),
      );
    });
  });

  describe('the up-flight', () => {
    it.each(UP_FLIGHT_TREADS)('places tread $riserIndex at x $minX–$maxX, top $top', (expected) => {
      const step = LAYOUT.steps[expected.riserIndex - 1];

      expect(step.rect.minX).toBe(expected.minX);
      expect(step.rect.maxX).toBe(expected.maxX);
      expect(step.rect.minZ).toBe(UP_FLIGHT_Z[0]);
      expect(step.rect.maxZ).toBe(UP_FLIGHT_Z[1]);
      expect(step.bottom).toBe(0);
      expect(step.top).toBeCloseTo(expected.top, PRECISION_DIGITS);
    });

    it('climbs westward, away from the landing', () => {
      const western = UP_FLIGHT_TREADS.map((tread) => LAYOUT.steps[tread.riserIndex - 1].rect.minX);

      expect(western).toEqual([...western].sort((a, b) => b - a));
    });
  });

  describe('the half-landing', () => {
    it('fills the western remainder of the run at riser 9', () => {
      const step = LAYOUT.steps[HALF_LANDING_STEP.riserIndex - 1];

      expect(step.rect).toEqual(LAYOUT.halfLandingRect);
      expect(step.rect.minX).toBe(HALF_LANDING_STEP.minX);
      expect(step.rect.maxX).toBe(HALF_LANDING_STEP.maxX);
      expect(step.top).toBeCloseTo(HALF_LANDING_STEP.top, PRECISION_DIGITS);
    });

    it('is one going longer than nothing and shorter than the run', () => {
      const length = LAYOUT.halfLandingRect.maxX - LAYOUT.halfLandingRect.minX;

      expect(length).toBeCloseTo(
        toPlanLength(
          LAYOUT.flightRect.maxX -
            LAYOUT.flightRect.minX -
            UP_FLIGHT_TREADS.length * STAIRS_SPEC.going,
        ),
        PRECISION_DIGITS,
      );
      expect(length).toBeGreaterThanOrEqual(STAIRS_SPEC.going);
    });
  });

  describe('the return flight', () => {
    it.each(RETURN_FLIGHT_TREADS)(
      'places tread $riserIndex at x $minX–$maxX, top $top',
      (expected) => {
        const step = LAYOUT.steps[expected.riserIndex - 1];

        expect(step.rect.minX).toBe(expected.minX);
        expect(step.rect.maxX).toBe(expected.maxX);
        expect(step.rect.minZ).toBe(RETURN_FLIGHT_Z[0]);
        expect(step.rect.maxZ).toBe(RETURN_FLIGHT_Z[1]);
        expect(step.bottom).toBe(0);
        expect(step.top).toBeCloseTo(expected.top, PRECISION_DIGITS);
      },
    );

    it('climbs eastward, back toward the landing', () => {
      const western = RETURN_FLIGHT_TREADS.map(
        (tread) => LAYOUT.steps[tread.riserIndex - 1].rect.minX,
      );

      expect(western).toEqual([...western].sort((a, b) => a - b));
    });

    it('lies south of the up-flight, sharing the mid-depth line', () => {
      expect(RETURN_FLIGHT_Z[0]).toBe(UP_FLIGHT_Z[1]);
      expect(UP_FLIGHT_Z[1] - UP_FLIGHT_Z[0]).toBeCloseTo(
        STAIRS_SPEC.flightWidth,
        PRECISION_DIGITS,
      );
      expect(RETURN_FLIGHT_Z[1] - RETURN_FLIGHT_Z[0]).toBeCloseTo(
        STAIRS_SPEC.flightWidth,
        PRECISION_DIGITS,
      );
    });
  });

  describe('the stair solid', () => {
    it('never overlaps two steps in 3D', () => {
      const offenders = LAYOUT.steps.flatMap((step, index) =>
        LAYOUT.steps
          .slice(index + 1)
          .filter(
            (other) =>
              rectsOverlap(step.rect, other.rect) &&
              Math.min(step.top, other.top) - Math.max(step.bottom, other.bottom) >
                LENGTH_TOLERANCE,
          )
          .map((_other, offset) => `${String(index)} ↔ ${String(index + 1 + offset)}`),
      );

      expect(offenders).toEqual([]);
    });

    it('tiles the flight area with the step footprints', () => {
      const footprint = LAYOUT.steps.reduce((sum, step) => sum + rectArea(step.rect), 0);

      expect(footprint).toBeCloseTo(rectArea(EXPECTED_FLIGHT_RECT), PRECISION_DIGITS);
      expect(footprint).toBeCloseTo(2.4 * 1.5, PRECISION_DIGITS);
      LAYOUT.steps.forEach((step) => {
        expect(rectContainsRect(LAYOUT.flightRect, step.rect)).toBe(true);
      });
    });

    it('lists the steps in climbing order, one per riser', () => {
      expect(LAYOUT.steps).toHaveLength(EXPECTED_STEPS.length);
      expect(LAYOUT.steps.map((step) => step.top)).toEqual(
        [...LAYOUT.steps.map((step) => step.top)].sort((a, b) => a - b),
      );
    });
  });

  describe('the door to the link corridor', () => {
    it('opens onto the walkable landing', () => {
      expect(LAYOUT.landingRect.minX).toBeLessThanOrEqual(LINK_DOOR_SPAN[0] + LENGTH_TOLERANCE);
      expect(LAYOUT.landingRect.maxX).toBeGreaterThanOrEqual(LINK_DOOR_SPAN[1] - LENGTH_TOLERANCE);
    });

    it('never opens onto the flight area', () => {
      expect(
        overlapLength([LAYOUT.flightRect.minX, LAYOUT.flightRect.maxX], LINK_DOOR_SPAN),
      ).toBeLessThanOrEqual(LENGTH_TOLERANCE);
    });
  });

  describe('the arrival', () => {
    it('stands at the centre of the landing', () => {
      expect(LAYOUT.arrival.x).toBeCloseTo(EXPECTED_ARRIVAL[0], PRECISION_DIGITS);
      expect(LAYOUT.arrival.z).toBeCloseTo(EXPECTED_ARRIVAL[1], PRECISION_DIGITS);
      expect(rectContainsPoint(LAYOUT.landingRect, LAYOUT.arrival)).toBe(true);
      expect(rectContainsPoint(LAYOUT.flightRect, LAYOUT.arrival)).toBe(false);
    });

    it('stands in the stairs space of the plan', () => {
      expect(findSpaceAt(FLOOR_PLAN, LAYOUT.arrival)?.id).toBe('stairs');
    });

    it('faces the corridor, toward +x', () => {
      const forward = [-Math.sin(LAYOUT.arrival.yaw), -Math.cos(LAYOUT.arrival.yaw)] as const;

      expect(forward[0]).toBeCloseTo(EXPECTED_FORWARD[0], PRECISION_DIGITS);
      expect(forward[1]).toBeCloseTo(EXPECTED_FORWARD[1], PRECISION_DIGITS);
      expect(LAYOUT.arrival.yaw).toBeLessThan(0);
    });

    it('walks into the corridor, not into the flight, when it steps forward', () => {
      const forward = { x: -Math.sin(LAYOUT.arrival.yaw), z: -Math.cos(LAYOUT.arrival.yaw) };
      const ahead = {
        x: LAYOUT.arrival.x + forward.x * STEP_TO_CORRIDOR,
        z: LAYOUT.arrival.z + forward.z * STEP_TO_CORRIDOR,
      };

      expect(findSpaceAt(FLOOR_PLAN, ahead)?.id).toBe('corridor');
      expect(rectContainsPoint(LAYOUT.flightRect, ahead)).toBe(false);
    });
  });

  describe('frozen results', () => {
    it('freezes the layout, its rects, its steps and its arrival', () => {
      expect(Object.isFrozen(LAYOUT)).toBe(true);
      expect(Object.isFrozen(LAYOUT.flightRect)).toBe(true);
      expect(Object.isFrozen(LAYOUT.landingRect)).toBe(true);
      expect(Object.isFrozen(LAYOUT.halfLandingRect)).toBe(true);
      expect(Object.isFrozen(LAYOUT.arrival)).toBe(true);
      expect(Object.isFrozen(LAYOUT.steps)).toBe(true);
      LAYOUT.steps.forEach((step) => {
        expect(Object.isFrozen(step)).toBe(true);
        expect(Object.isFrozen(step.rect)).toBe(true);
      });
    });

    it('freezes the blocked rects', () => {
      const blocked = getBlockedRects(FLOOR_PLAN);

      expect(Object.isFrozen(blocked)).toBe(true);
      blocked.forEach((rect) => {
        expect(Object.isFrozen(rect)).toBe(true);
      });
    });
  });

  describe('getBlockedRects', () => {
    it('blocks the flight area alone', () => {
      expect(getBlockedRects(FLOOR_PLAN)).toEqual([EXPECTED_FLIGHT_RECT]);
    });

    it('never blocks the landing or the arrival', () => {
      const blocked = getBlockedRects(FLOOR_PLAN);

      expect(blocked).not.toContainEqual(EXPECTED_LANDING_RECT);
      blocked.forEach((rect) => {
        expect(rectsOverlap(rect, EXPECTED_LANDING_RECT)).toBe(false);
        expect(rectContainsPoint(rect, LAYOUT.arrival)).toBe(false);
      });
    });
  });

  describe('rejections', () => {
    it.each([
      ['a bay shallower than two flights', [1.6, 5.3, 3.9, 5.3] as const, 'flight width'],
      ['a bay that ends before the landing edge', [1.6, 3.9, 3.9, 5.4] as const, 'landing edge'],
      ['a bay that starts east of the landing edge', [4.1, 5.3, 3.9, 5.4] as const, 'landing edge'],
      ['a run of exactly eight goings', [2.0, 5.3, 3.9, 5.4] as const, 'goings'],
      ['a run just over eight goings', [1.95, 5.3, 3.9, 5.4] as const, 'goings'],
    ])('rejects %s', (_label, bay, message) => {
      const call = (): unknown => getStairsLayout(withStairsBay(bay), SYNTHETIC_HEIGHTS);

      expect(call).toThrow(RangeError);
      expect(call).toThrow(message);
      expect(() => getBlockedRects(withStairsBay(bay))).toThrow(RangeError);
    });

    it('rejects a plan with no stairs space', () => {
      const call = (): unknown => getStairsLayout(withoutStairs(), SYNTHETIC_HEIGHTS);

      expect(call).toThrow(RangeError);
      expect(call).toThrow('no space with id "stairs"');
    });

    it.each([
      ['a non-finite floor-to-floor', NOT_A_NUMBER],
      ['an infinite floor-to-floor', INFINITE],
      ['a floor-to-floor of zero', NON_POSITIVE_HEIGHT],
      ['a negative floor-to-floor', -SYNTHETIC_HEIGHTS.floorToFloor],
    ])('rejects %s', (_label, floorToFloor) => {
      const call = (): unknown =>
        getStairsLayout(FLOOR_PLAN, { ...SYNTHETIC_HEIGHTS, floorToFloor });

      expect(call).toThrow(RangeError);
      expect(call).toThrow('floorToFloor');
    });

    it('accepts the real plan and heights unchanged', () => {
      expect(() => getStairsLayout(FLOOR_PLAN)).not.toThrow();
      expect(() => getBlockedRects(FLOOR_PLAN)).not.toThrow();
    });
  });
});
