import { describe, expect, it } from 'vitest';
import { LENGTH_TOLERANCE, makeRect, toPlanLength } from '../planGeometry.ts';
import type { PlanRect } from '../planGeometry.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import { FLOOR_PLAN } from './floorPlanData.ts';
import type { FloorPlan, JoinOverride, Space, SpaceId } from './types.ts';
import { validateFloorPlan } from './validateFloorPlan.ts';

const PLOT_MIN = 0;
const PLOT_MAX_X = 12;
const PLOT_MAX_Z = 10;
const EXTERIOR = WALL_SPEC.exterior;
const PARTITION = WALL_SPEC.partition;
const INTERIOR_MIN = EXTERIOR;
const INTERIOR_MAX_X = PLOT_MAX_X - EXTERIOR;
const INTERIOR_MAX_Z = PLOT_MAX_Z - EXTERIOR;
const KITCHEN_MAX_X = 5;
const LAUNDRY_MIN_X = KITCHEN_MAX_X + PARTITION;
const LAUNDRY_MAX_X = 9.8;
const UTILITY_MIN_X = 10;
const OVERLAP_MIN_X = 4.8;
const OFF_GRID_X = 9.805;
const OUTSIDE_X = 11.8;
const BEYOND_PLOT_X = 12.3;
const SPLIT_Z = 5;
const OVERLAP_Z = 4.9;
const NEGATIVE_THICKNESS = -0.2;
const KITCHEN_SHIFT_X = -0.25;
const FIRST_RECT = 0;
const HALF = 0.5;
/** A width that passes the grid check but snaps to zero. */
const SUB_TOLERANCE_WIDTH = LENGTH_TOLERANCE * HALF;

const SMALL_PLOT = makeRect(PLOT_MIN, PLOT_MAX_X, PLOT_MIN, PLOT_MAX_Z);
const SMALL_INTERIOR = makeRect(INTERIOR_MIN, INTERIOR_MAX_X, INTERIOR_MIN, INTERIOR_MAX_Z);
const KITCHEN_RECT = makeRect(INTERIOR_MIN, KITCHEN_MAX_X, INTERIOR_MIN, INTERIOR_MAX_Z);
const LAUNDRY_RECT = makeRect(LAUNDRY_MIN_X, LAUNDRY_MAX_X, INTERIOR_MIN, INTERIOR_MAX_Z);
const UTILITY_RECT = makeRect(UTILITY_MIN_X, INTERIOR_MAX_X, INTERIOR_MIN, INTERIOR_MAX_Z);

/**
 * Builds a room with the given rects.
 *
 * @param id - Identifier of the space.
 * @param rects - Clear rects of the space.
 * @returns A space named after its id.
 */
function room(id: SpaceId, rects: readonly PlanRect[]): Space {
  return { id, name: id, kind: 'room', rects };
}

/**
 * Builds a join override with a short reason.
 *
 * @param first - First space of the join.
 * @param second - Second space of the join.
 * @param thickness - Wall thickness of the join.
 * @returns The override.
 */
function join(first: SpaceId, second: SpaceId, thickness: number): JoinOverride {
  return { spaces: [first, second], thickness, reason: 'test join' };
}

const KITCHEN = room('kitchen', [KITCHEN_RECT]);
const LAUNDRY = room('laundry', [LAUNDRY_RECT]);
const UTILITY = room('utilityRoom', [UTILITY_RECT]);
const KITCHEN_LAUNDRY_JOIN = join('kitchen', 'laundry', PARTITION);

/**
 * Builds a small valid plan (kitchen, laundry, utility room), with fields
 * replaced by `changes`.
 *
 * @param changes - Fields to replace.
 * @returns The plan.
 */
function smallPlan(changes: Partial<FloorPlan> = {}): FloorPlan {
  return {
    plot: SMALL_PLOT,
    interior: SMALL_INTERIOR,
    spaces: [KITCHEN, LAUNDRY, UTILITY],
    joinOverrides: [KITCHEN_LAUNDRY_JOIN],
    ...changes,
  };
}

/**
 * Finds a space of {@link FLOOR_PLAN} by id.
 *
 * @param id - Identifier of the space.
 * @returns The space.
 */
function floorSpace(id: SpaceId): Space {
  const space = FLOOR_PLAN.spaces.find((candidate) => candidate.id === id);
  if (space === undefined) {
    throw new Error(`FLOOR_PLAN has no space "${id}"`);
  }
  return space;
}

/**
 * Returns a shallow copy of {@link FLOOR_PLAN} with one space replaced by a
 * space of the same id whose first rect is `rect`.
 *
 * @param id - Identifier of the space to replace.
 * @param rect - The new first rect.
 * @returns The mutated plan copy.
 */
function floorPlanWithFirstRect(id: SpaceId, rect: PlanRect): FloorPlan {
  const original = floorSpace(id);
  const replacement: Space = {
    ...original,
    rects: original.rects.map((existing, index) => (index === FIRST_RECT ? rect : existing)),
  };
  return {
    ...FLOOR_PLAN,
    spaces: FLOOR_PLAN.spaces.map((space) => (space.id === id ? replacement : space)),
  };
}

const REJECTION_CASES: readonly { label: string; plan: FloorPlan; offender: string }[] = [
  {
    label: 'an interior outside the plot',
    plan: smallPlan({
      interior: makeRect(INTERIOR_MIN, BEYOND_PLOT_X, INTERIOR_MIN, INTERIOR_MAX_Z),
    }),
    offender: 'interior',
  },
  {
    label: 'an inverted plot',
    plan: smallPlan({ plot: makeRect(PLOT_MAX_X, PLOT_MIN, PLOT_MIN, PLOT_MAX_Z) }),
    offender: 'plot',
  },
  {
    label: 'a duplicate id',
    plan: smallPlan({ spaces: [KITCHEN, room('kitchen', [LAUNDRY_RECT])] }),
    offender: 'kitchen',
  },
  {
    label: 'a space with no rects',
    plan: smallPlan({ spaces: [KITCHEN, room('laundry', [])] }),
    offender: 'laundry',
  },
  {
    label: 'a NaN coordinate',
    plan: smallPlan({
      spaces: [
        KITCHEN,
        room('laundry', [makeRect(LAUNDRY_MIN_X, Number.NaN, INTERIOR_MIN, INTERIOR_MAX_Z)]),
      ],
    }),
    offender: 'laundry',
  },
  {
    label: 'an inverted rect',
    plan: smallPlan({
      spaces: [
        KITCHEN,
        room('laundry', [makeRect(LAUNDRY_MAX_X, LAUNDRY_MIN_X, INTERIOR_MIN, INTERIOR_MAX_Z)]),
      ],
    }),
    offender: 'laundry',
  },
  {
    label: 'a rect whose width is below the tolerance (empty once snapped to the grid)',
    plan: smallPlan({
      spaces: [
        KITCHEN,
        room('laundry', [
          makeRect(
            UTILITY_MIN_X,
            UTILITY_MIN_X + SUB_TOLERANCE_WIDTH,
            INTERIOR_MIN,
            INTERIOR_MAX_Z,
          ),
        ]),
      ],
    }),
    offender: 'laundry',
  },
  {
    label: 'a rect whose depth is below the tolerance (empty once snapped to the grid)',
    plan: smallPlan({
      spaces: [
        KITCHEN,
        room('laundry', [
          makeRect(LAUNDRY_MIN_X, LAUNDRY_MAX_X, SPLIT_Z, SPLIT_Z + SUB_TOLERANCE_WIDTH),
        ]),
      ],
    }),
    offender: 'laundry',
  },
  {
    label: 'an off-grid coordinate (9.805)',
    plan: smallPlan({
      spaces: [
        KITCHEN,
        room('laundry', [makeRect(LAUNDRY_MIN_X, OFF_GRID_X, INTERIOR_MIN, INTERIOR_MAX_Z)]),
      ],
    }),
    offender: 'laundry',
  },
  {
    label: 'a rect outside the interior',
    plan: smallPlan({
      spaces: [
        KITCHEN,
        room('laundry', [makeRect(LAUNDRY_MIN_X, OUTSIDE_X, INTERIOR_MIN, INTERIOR_MAX_Z)]),
      ],
    }),
    offender: 'laundry',
  },
  {
    label: 'an overlap between two spaces',
    plan: smallPlan({
      spaces: [
        KITCHEN,
        room('laundry', [makeRect(OVERLAP_MIN_X, LAUNDRY_MAX_X, INTERIOR_MIN, INTERIOR_MAX_Z)]),
      ],
    }),
    offender: 'laundry',
  },
  {
    label: 'an overlap within one space',
    plan: smallPlan({
      spaces: [
        room('kitchen', [
          makeRect(INTERIOR_MIN, KITCHEN_MAX_X, INTERIOR_MIN, SPLIT_Z),
          makeRect(INTERIOR_MIN, KITCHEN_MAX_X, OVERLAP_Z, INTERIOR_MAX_Z),
        ]),
        LAUNDRY,
      ],
    }),
    offender: 'kitchen',
  },
  {
    label: 'an override with an unknown id',
    plan: smallPlan({ joinOverrides: [join('kitchen', 'mainSanitair', PARTITION)] }),
    offender: 'mainSanitair',
  },
  {
    label: 'an override pairing a space with itself',
    plan: smallPlan({ joinOverrides: [join('laundry', 'laundry', PARTITION)] }),
    offender: 'laundry',
  },
  {
    label: 'a negative override thickness',
    plan: smallPlan({ joinOverrides: [join('laundry', 'utilityRoom', NEGATIVE_THICKNESS)] }),
    offender: 'utilityRoom',
  },
  {
    label: 'a duplicate override pair in reverse order',
    plan: smallPlan({
      joinOverrides: [KITCHEN_LAUNDRY_JOIN, join('laundry', 'kitchen', PARTITION)],
    }),
    offender: 'laundry',
  },
];

describe('validateFloorPlan', () => {
  it('accepts FLOOR_PLAN and returns the same reference', () => {
    expect(validateFloorPlan(FLOOR_PLAN)).toBe(FLOOR_PLAN);
  });

  it('accepts a small valid plan that lists only some spaces', () => {
    const plan = smallPlan();

    expect(validateFloorPlan(plan)).toBe(plan);
  });

  it.each(REJECTION_CASES)('rejects $label', ({ plan, offender }) => {
    expect(() => validateFloorPlan(plan)).toThrow(RangeError);
    expect(() => validateFloorPlan(plan)).toThrow(offender);
  });

  describe('guards FLOOR_PLAN against mutations', () => {
    const kitchen = floorSpace('kitchen').rects[FIRST_RECT];

    it('rejects the kitchen shifted 0.25 m towards the guest room', () => {
      const shifted = makeRect(
        toPlanLength(kitchen.minX + KITCHEN_SHIFT_X),
        toPlanLength(kitchen.maxX + KITCHEN_SHIFT_X),
        kitchen.minZ,
        kitchen.maxZ,
      );
      const plan = floorPlanWithFirstRect('kitchen', shifted);

      expect(() => validateFloorPlan(plan)).toThrow(RangeError);
      expect(() => validateFloorPlan(plan)).toThrow('kitchen');
    });

    it('rejects the kitchen rect with minX and maxX swapped', () => {
      const swapped = makeRect(kitchen.maxX, kitchen.minX, kitchen.minZ, kitchen.maxZ);
      const plan = floorPlanWithFirstRect('kitchen', swapped);

      expect(() => validateFloorPlan(plan)).toThrow(RangeError);
      expect(() => validateFloorPlan(plan)).toThrow('kitchen');
    });

    it('rejects the guest sanitair with maxX 9.805', () => {
      const sanitair = floorSpace('guestSanitair').rects[FIRST_RECT];
      const offGrid = makeRect(sanitair.minX, OFF_GRID_X, sanitair.minZ, sanitair.maxZ);
      const plan = floorPlanWithFirstRect('guestSanitair', offGrid);

      expect(() => validateFloorPlan(plan)).toThrow(RangeError);
      expect(() => validateFloorPlan(plan)).toThrow('guestSanitair');
    });
  });
});
