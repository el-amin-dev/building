import { describe, expect, it } from 'vitest';
import { LENGTH_TOLERANCE, makeRect } from '../planGeometry.ts';
import type { PlanRect } from '../planGeometry.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import { FLOOR_PLAN } from './floorPlanData.ts';
import { getJoinThickness } from './joins.ts';
import { getNeighbours, getSpace } from './queries.ts';
import type { FloorPlan, JoinOverride, Space, SpaceId, SpaceKind } from './types.ts';

/**
 * The plain separator of the source of truth, 0.15 m.
 *
 * This file used to pin 0.20 and the module's docstring used to say 0.20. The
 * plan has said 0.15 since isolation became a width: a named wall is drawn 0.30
 * and everything else "as thin as it usefully can be".
 */
const PARTITION_THICKNESS = 0.15;
/** What a wall on the owner's isolation list is drawn at, 0.30 m. */
const INSULATED_THICKNESS = 0.3;
/** What a wall with a weather-exposed face is built at, 0.30 m. */
const VOID_FACING_THICKNESS = 0.3;
/** A thickness no rule would produce, so only an override can explain it. */
const OVERRIDE_THICKNESS = 0.1;
/** Two floors meeting with nothing between them. */
const NO_WALL = 0;
/** The one join the owner kept at the drawn 0.20 (ADR-006). */
const UTILITY_VOID_THICKNESS = 0.2;
/** Every pair of adjacent spaces of the real plan. A tripwire on the sweeps below. */
const ADJACENT_PAIR_COUNT = 49;

const PLOT = makeRect(0, 15, 0, 8);
const INTERIOR = makeRect(0.3, 14.7, 0.3, 7.7);
/** The space every synthetic join is measured from: x 0.30–5.30, z 0.30–5.30. */
const WEST = makeRect(0.3, 5.3, 0.3, 5.3);
/** Touching {@link WEST}: no gap, so nothing to measure and the kind rule decides. */
const TOUCHING = makeRect(5.3, 10.3, 0.3, 5.3);
/** 0.15 east of {@link WEST}: a plain separator, drawn. */
const THIN = makeRect(5.45, 10.45, 0.3, 5.3);
/** 0.30 east of {@link WEST}: what an insulated wall is drawn at. */
const THICK = makeRect(5.6, 10.6, 0.3, 5.3);
/** Too far east to join {@link WEST} at all. */
const DETACHED = makeRect(12, 14, 0.3, 5.3);

/**
 * Builds a frozen space whose name is its id.
 *
 * The matricule is the real one {@link FLOOR_PLAN} carries for that id, so no
 * second numbering is invented here. Nothing in `joins.ts` reads it — a join is
 * measured from the rects — but {@link Space} requires it.
 *
 * @param id - Identifier of the space.
 * @param kind - Kind of the space.
 * @param rects - Clear rects of the space; the join is measured between them.
 * @returns A frozen {@link Space}.
 */
function makeSpace(id: SpaceId, kind: SpaceKind, rects: readonly PlanRect[]): Space {
  return Object.freeze({
    id,
    matricule: getSpace(FLOOR_PLAN, id).matricule,
    name: id,
    kind,
    rects: Object.freeze([...rects]),
  });
}

/**
 * Builds a frozen plan on the test plot.
 *
 * @param spaces - Spaces of the plan.
 * @param joinOverrides - Explicit join thicknesses.
 * @returns A frozen {@link FloorPlan}.
 */
function makePlan(spaces: readonly Space[], joinOverrides: readonly JoinOverride[]): FloorPlan {
  return Object.freeze({
    plot: PLOT,
    interior: INTERIOR,
    spaces: Object.freeze([...spaces]),
    joinOverrides: Object.freeze([...joinOverrides]),
  });
}

/**
 * Returns the join thickness of a two-space plan, asserting it does not depend
 * on the argument order: a wall is one wall from either room.
 *
 * @param a - One space of the join.
 * @param b - The other.
 * @param joinOverrides - Explicit join thicknesses; none by default.
 * @returns The thickness both argument orders agree on, in metres.
 */
function joinThicknessBothWays(
  a: Space,
  b: Space,
  joinOverrides: readonly JoinOverride[] = [],
): number {
  const plan = makePlan([a, b], joinOverrides);
  const forward = getJoinThickness(plan, a, b);

  expect(getJoinThickness(plan, b, a)).toBe(forward);
  return forward;
}

const ROOM = makeSpace('livingRoom', 'room', [WEST]);
const CIRCULATION_WEST = makeSpace('corridor', 'circulation', [WEST]);
const OPEN_AIR_WEST = makeSpace('balconyA', 'openAir', [WEST]);
const TOUCHING_ROOM = makeSpace('masterBedroom', 'room', [TOUCHING]);
const TOUCHING_CIRCULATION = makeSpace('corridor', 'circulation', [TOUCHING]);
const TOUCHING_OPEN_AIR = makeSpace('balconyA', 'openAir', [TOUCHING]);
const TOUCHING_VOID = makeSpace('voidWest', 'void', [TOUCHING]);

/**
 * The gap the rects leave is the thickness, so the kind rule is the last resort
 * and no longer the first answer. It is still needed: two spaces can be drawn
 * touching, and then there is no wall in the drawing to measure.
 */
describe('getJoinThickness on spaces drawn with no gap between them', () => {
  it.each([
    ['room', 'room', ROOM, TOUCHING_ROOM, PARTITION_THICKNESS],
    ['room', 'circulation', ROOM, TOUCHING_CIRCULATION, PARTITION_THICKNESS],
    ['room', 'openAir', ROOM, TOUCHING_OPEN_AIR, VOID_FACING_THICKNESS],
    ['room', 'void', ROOM, TOUCHING_VOID, VOID_FACING_THICKNESS],
    ['circulation', 'openAir', CIRCULATION_WEST, TOUCHING_OPEN_AIR, VOID_FACING_THICKNESS],
    ['openAir', 'void', OPEN_AIR_WEST, TOUCHING_VOID, VOID_FACING_THICKNESS],
  ])('joins %s and %s with %s', (_kindA, _kindB, a, b, expected) => {
    expect(joinThicknessBothWays(a, b)).toBe(expected);
  });

  it('falls back to the same kind rule when the two spaces do not join at all', () => {
    const detached = makeSpace('masterBedroom', 'room', [DETACHED]);

    expect(joinThicknessBothWays(ROOM, detached)).toBe(PARTITION_THICKNESS);
  });
});

describe('getJoinThickness on the gap the plan draws', () => {
  it('reports a drawn 0.30 between two ordinary rooms, not the partition default', () => {
    const thick = makeSpace('masterBedroom', 'room', [THICK]);

    expect(joinThicknessBothWays(ROOM, thick)).toBe(INSULATED_THICKNESS);
  });

  it('reports a drawn 0.15 as the plain separator it is', () => {
    const thin = makeSpace('masterBedroom', 'room', [THIN]);

    expect(joinThicknessBothWays(ROOM, thin)).toBe(PARTITION_THICKNESS);
  });

  it('measures a weather-exposed join too, rather than assuming 0.30 for it', () => {
    const thinBalcony = makeSpace('balconyA', 'openAir', [THIN]);

    expect(joinThicknessBothWays(ROOM, thinBalcony)).toBe(PARTITION_THICKNESS);
  });

  it('takes the thickest where one join is drawn at two widths', () => {
    // The guest suite's shape: part of the join is a plain separator and part of
    // it is an insulated wall. Thick wins, as the owner ruled for a junction.
    const varying = makeSpace('masterBedroom', 'room', [
      makeRect(5.45, 10.45, 0.3, 2.0),
      makeRect(5.6, 10.6, 2.2, 5.3),
    ]);

    expect(joinThicknessBothWays(ROOM, varying)).toBe(INSULATED_THICKNESS);
  });
});

describe('getJoinThickness on a stated override', () => {
  const thick = makeSpace('masterBedroom', 'room', [THICK]);
  const override: JoinOverride = {
    spaces: ['livingRoom', 'masterBedroom'],
    thickness: OVERRIDE_THICKNESS,
    reason: 'test override',
  };

  it('lets an override win over the gap the plan draws, in either order', () => {
    expect(joinThicknessBothWays(ROOM, thick, [override])).toBe(OVERRIDE_THICKNESS);
  });

  it('keeps the measured thickness for joins the override does not name', () => {
    const unnamed: JoinOverride = {
      spaces: ['balconyA', 'voidWest'],
      thickness: OVERRIDE_THICKNESS,
      reason: 'test override naming another pair',
    };

    expect(joinThicknessBothWays(ROOM, thick, [unnamed])).toBe(INSULATED_THICKNESS);
  });

  it('states a join with no wall at all, which no measurement could show', () => {
    const noWall: JoinOverride = {
      spaces: ['livingRoom', 'masterBedroom'],
      thickness: NO_WALL,
      reason: 'two floors meeting with nothing between them',
    };

    expect(joinThicknessBothWays(ROOM, TOUCHING_ROOM, [noWall])).toBe(NO_WALL);
  });
});

it('throws a RangeError naming a space joined with itself', () => {
  const plan = makePlan([ROOM, TOUCHING_ROOM], []);
  const copy = makeSpace('livingRoom', 'room', [WEST]);

  expect(() => getJoinThickness(plan, ROOM, ROOM)).toThrow(RangeError);
  expect(() => getJoinThickness(plan, ROOM, copy)).toThrow('livingRoom');
});

/** One pair of adjacent spaces of a plan, with every thickness it is drawn at. */
interface DrawnJoin {
  /** The two spaces, in id order. */
  readonly ids: readonly [SpaceId, SpaceId];
  /** `livingRoom|masterBedroom`, for a readable failure. */
  readonly key: string;
  /** Every gap the plan leaves between their rects, in metres. */
  readonly gaps: readonly number[];
  /** Whether the plan states this join's thickness rather than drawing it. */
  readonly overridden: boolean;
}

/**
 * Lists every pair of adjacent spaces of a plan and the thicknesses it draws
 * between them, measured the way the rest of the model measures.
 *
 * @param plan - The floor plan to sweep.
 * @returns One entry per adjacent pair, in id order.
 */
function drawnJoins(plan: FloorPlan): readonly DrawnJoin[] {
  const found = new Map<string, { ids: readonly [SpaceId, SpaceId]; gaps: number[] }>();
  plan.spaces.forEach((space) => {
    getNeighbours(plan, space.id).forEach((contact) => {
      const ids: readonly [SpaceId, SpaceId] =
        space.id < contact.neighbourId
          ? [space.id, contact.neighbourId]
          : [contact.neighbourId, space.id];
      const key = `${ids[0]}|${ids[1]}`;
      const entry = found.get(key) ?? { ids, gaps: [] };
      entry.gaps.push(contact.gap);
      found.set(key, entry);
    });
  });
  return [...found.entries()]
    .map(([key, entry]) => ({
      ids: entry.ids,
      key,
      gaps: entry.gaps,
      overridden: plan.joinOverrides.some(
        (override) =>
          override.spaces.includes(entry.ids[0]) && override.spaces.includes(entry.ids[1]),
      ),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The answer the old kind-based rule would have given, kept to show which joins
 * it got wrong. Not the rule any more: the plan is measured.
 *
 * @param a - One space of the join.
 * @param b - The other.
 * @returns The thickness the two kinds alone would predict, in metres.
 */
function kindRule(a: Space, b: Space): number {
  const weatherExposed = (kind: SpaceKind): boolean => kind === 'openAir' || kind === 'void';
  return weatherExposed(a.kind) || weatherExposed(b.kind)
    ? VOID_FACING_THICKNESS
    : PARTITION_THICKNESS;
}

/**
 * The owner's insulated walls, as pairs of the spaces they stand between: drawn
 * 0.30, and every one of them answered 0.15 while this module inferred a
 * thickness from the two kinds instead of measuring the plan.
 *
 * Derived by sweeping the plan, not copied from a list, and the sweep below
 * asserts the set is exactly this — a new insulated wall has to be added here
 * rather than passing unnoticed.
 */
const INSULATED_PAIRS: readonly (readonly [SpaceId, SpaceId])[] = [
  ['bedroomFemaleKids', 'utilityRoom'],
  ['corridor', 'guestRoom'],
  ['corridor', 'kitchen'],
  ['corridor', 'laundry'],
  ['corridor', 'mainSanitair'],
  ['corridor', 'masterBedroom'],
  ['corridor', 'utilityRoom'],
  ['guestRoom', 'kitchen'],
  ['guestRoom', 'stairs'],
  ['livingRoom', 'masterBedroom'],
  ['masterBedroom', 'stairs'],
];

/**
 * The join the plan draws at two widths at once: 0.15 where the guest room's
 * north strip passes over the control center, 0.30 on the control center's east
 * wall. It belongs with {@link INSULATED_PAIRS} in the sweep — the kind rule was
 * wrong about it too — but it is not a 0.30 wall end to end, so it is pinned on
 * its own below.
 */
const VARYING_PAIR: readonly [SpaceId, SpaceId] = ['controlCenter', 'guestRoom'];

describe('getJoinThickness on FLOOR_PLAN', () => {
  it('pins the thicknesses the source of truth states', () => {
    expect(WALL_SPEC.partition).toBe(PARTITION_THICKNESS);
    expect(WALL_SPEC.insulated).toBe(INSULATED_THICKNESS);
    expect(WALL_SPEC.voidFacing).toBe(VOID_FACING_THICKNESS);
  });

  it.each(INSULATED_PAIRS)('joins %s and %s at the insulated 0.30 the plan draws', (idA, idB) => {
    const a = getSpace(FLOOR_PLAN, idA);
    const b = getSpace(FLOOR_PLAN, idB);
    const gaps = getNeighbours(FLOOR_PLAN, idA)
      .filter((contact) => contact.neighbourId === idB)
      .map((contact) => contact.gap);

    expect(getJoinThickness(FLOOR_PLAN, a, b)).toBe(INSULATED_THICKNESS);
    expect(getJoinThickness(FLOOR_PLAN, b, a)).toBe(INSULATED_THICKNESS);
    // The number is the drawing's, not a constant that happens to match it.
    expect(gaps.length).toBeGreaterThan(0);
    gaps.forEach((gap) => {
      expect(gap).toBe(INSULATED_THICKNESS);
    });
  });

  it.each([
    ['corridor', 'livingRoom', PARTITION_THICKNESS],
    ['bedroomFemaleKids', 'bedroomMaleKids', PARTITION_THICKNESS],
    ['mainSanitair', 'utilityRoom', PARTITION_THICKNESS],
    ['balconySlabB', 'kitchen', VOID_FACING_THICKNESS],
    ['kitchen', 'voidWest', VOID_FACING_THICKNESS],
    // DELETED with this group: ['voidEast', 'utilityRoom', PARTITION_THICKNESS].
    // It claimed to prove the kind-based partition default on the real plan and
    // never did: this pair carries a join override, so the override branch
    // answered first, and the case only passed because the old partition
    // constant (0.20) happened to equal that override. The default is 0.15 now,
    // so the case cannot exist at all — the override is pinned below, where it
    // belongs.
    ['stairs', 'corridor', NO_WALL],
    ['voidEast', 'utilityRoom', UTILITY_VOID_THICKNESS],
    ['balconySlabB', 'voidWest', NO_WALL],
  ] as const)('joins %s and %s with %s', (idA, idB, expected) => {
    const a = getSpace(FLOOR_PLAN, idA);
    const b = getSpace(FLOOR_PLAN, idB);

    expect(getJoinThickness(FLOOR_PLAN, a, b)).toBe(expected);
    expect(getJoinThickness(FLOOR_PLAN, b, a)).toBe(expected);
  });

  it('answers the thickest width where the plan draws one join at two', () => {
    const [idA, idB] = VARYING_PAIR;
    const gaps = new Set(
      getNeighbours(FLOOR_PLAN, idA)
        .filter((contact) => contact.neighbourId === idB)
        .map((contact) => contact.gap),
    );

    // The premise of the case: this join really is two thicknesses.
    expect([...gaps].sort()).toEqual([PARTITION_THICKNESS, INSULATED_THICKNESS]);
    expect(getJoinThickness(FLOOR_PLAN, getSpace(FLOOR_PLAN, idA), getSpace(FLOOR_PLAN, idB))).toBe(
      INSULATED_THICKNESS,
    );
  });

  describe('sweeping every join of the floor', () => {
    const joins = drawnJoins(FLOOR_PLAN);

    it('finds the joins there are to check', () => {
      expect(joins).toHaveLength(ADJACENT_PAIR_COUNT);
      expect(joins.filter((join) => join.overridden)).toHaveLength(FLOOR_PLAN.joinOverrides.length);
    });

    it('never answers less than the plan draws anywhere along a join', () => {
      const understated = joins
        .filter((join) => !join.overridden)
        .filter((join) => {
          const answer = getJoinThickness(
            FLOOR_PLAN,
            getSpace(FLOOR_PLAN, join.ids[0]),
            getSpace(FLOOR_PLAN, join.ids[1]),
          );
          return join.gaps.some((gap) => gap - answer > LENGTH_TOLERANCE);
        })
        .map((join) => join.key);

      expect(understated).toEqual([]);
    });

    it('answers exactly the thickest width drawn, for every join the plan draws', () => {
      const wrong = joins
        .filter((join) => !join.overridden)
        .map((join) => ({
          key: join.key,
          answer: getJoinThickness(
            FLOOR_PLAN,
            getSpace(FLOOR_PLAN, join.ids[0]),
            getSpace(FLOOR_PLAN, join.ids[1]),
          ),
          thickest: Math.max(...join.gaps),
        }))
        .filter(({ answer, thickest }) => Math.abs(answer - thickest) > LENGTH_TOLERANCE)
        .map(
          ({ key, answer, thickest }) =>
            `${key}: answered ${String(answer)}, drawn ${String(thickest)}`,
        );

      expect(wrong).toEqual([]);
    });

    it('names every join the kind rule would have got wrong', () => {
      const wrongByKind = joins
        .filter((join) => !join.overridden)
        .filter((join) => {
          const a = getSpace(FLOOR_PLAN, join.ids[0]);
          const b = getSpace(FLOOR_PLAN, join.ids[1]);
          return Math.abs(getJoinThickness(FLOOR_PLAN, a, b) - kindRule(a, b)) > LENGTH_TOLERANCE;
        })
        .map((join) => join.key);

      expect(wrongByKind.sort()).toEqual(
        [...INSULATED_PAIRS, VARYING_PAIR].map(([idA, idB]) => `${idA}|${idB}`).sort(),
      );
    });
  });
});
