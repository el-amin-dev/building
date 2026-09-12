import { describe, expect, it } from 'vitest';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectContainsRect,
  rectsOverlap,
  toPlanLength,
} from '../planGeometry.ts';
import type { PlanRect } from '../planGeometry.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import { FLOOR_PLAN, INTERIOR_RECT } from './floorPlanData.ts';
import { getJoinThickness } from './joins.ts';
import { findSpaceAt, getNeighbours, getSpace } from './queries.ts';
import type { FloorPlan, SpaceId } from './types.ts';
import { validateFloorPlan } from './validateFloorPlan.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const NO_WALL = 0;
const KITCHEN_SHIFT_X = 0.05;

/**
 * The thickest wall of the plan: a line closer than this to a parallel face
 * may run inside that wall rather than across it.
 */
const MAX_WALL_THICKNESS = Math.max(WALL_SPEC.exterior, WALL_SPEC.partition, WALL_SPEC.voidFacing);

type Axis = 'x' | 'z';

/** One piece of a cross-section: a space's clear extent or the solid between spaces. */
type Segment =
  | { readonly kind: 'space'; readonly id: SpaceId; readonly length: number }
  | { readonly kind: 'gap'; readonly length: number };

/** A rect of the plan, tagged with its space and its index in that space's rects. */
interface TaggedRect {
  readonly id: SpaceId;
  readonly index: number;
  readonly rect: PlanRect;
}

/** The solid between two consecutive spaces on a cross-section line. */
interface SectionJoin {
  /** Space before the join, or `undefined` at the plot start. */
  readonly before: SpaceId | undefined;
  /** Space after the join, or `undefined` at the plot end. */
  readonly after: SpaceId | undefined;
  /** Start of the join along the line, in metres. */
  readonly start: number;
  /** End of the join along the line, in metres. */
  readonly end: number;
}

/** Explicit join exceptions of ADR-005 / ADR-006, plus a default void-facing join for contrast. */
const JOIN_EXCEPTIONS: readonly (readonly [SpaceId, SpaceId, number])[] = [
  ['stairs', 'corridor', NO_WALL],
  ['voidWest', 'balconySlabB', NO_WALL],
  ['voidEast', 'balconySlabB', NO_WALL],
  ['voidEast', 'utilityRoom', WALL_SPEC.partition],
  ['kitchen', 'balconySlabB', WALL_SPEC.voidFacing],
];

/**
 * Neighbour ids of every space, derived by hand from the clear rects of
 * `floorPlanData.ts`: two spaces are neighbours when a face of one rect lies
 * within 0.30 m of a parallel face of the other and the two overlap along that
 * face by more than the tolerance. Several 0.30 m gaps are 0.30000000000000004
 * in floating point (for example balconyA maxX 1.30 → x 1.60), so these sets
 * also guard the tolerance of the contact gap. Symmetric: A lists B iff B lists A.
 */
const EXPECTED_NEIGHBOURS: Readonly<Record<SpaceId, readonly SpaceId[]>> = {
  // x 1.30 → 1.60 along the whole A side.
  balconyA: ['masterBedroom', 'stairs', 'linkCorridor', 'controlCenter', 'voidWest'],
  masterBedroom: ['balconyA', 'livingRoom', 'stairs', 'corridor'],
  livingRoom: ['masterBedroom', 'bedroomMaleKids', 'corridor'],
  bedroomMaleKids: ['livingRoom', 'bedroomFemaleKids', 'corridor'],
  bedroomFemaleKids: ['bedroomMaleKids', 'corridor', 'utilityRoom'],
  stairs: ['balconyA', 'masterBedroom', 'corridor', 'linkCorridor'],
  corridor: [
    'masterBedroom',
    'livingRoom',
    'bedroomMaleKids',
    'bedroomFemaleKids',
    'stairs',
    'linkCorridor',
    'guestRoom',
    'kitchen',
    'laundry',
    'mainSanitair',
    'utilityRoom',
  ],
  linkCorridor: ['balconyA', 'stairs', 'corridor', 'controlCenter', 'guestRoom'],
  controlCenter: ['balconyA', 'linkCorridor', 'guestRoom', 'voidWest'],
  guestRoom: ['corridor', 'linkCorridor', 'controlCenter', 'guestSanitair', 'kitchen', 'voidWest'],
  guestSanitair: ['guestRoom', 'kitchen', 'voidWest'],
  kitchen: ['corridor', 'guestRoom', 'guestSanitair', 'laundry', 'balconySlabB', 'voidWest'],
  laundry: ['corridor', 'kitchen', 'mainSanitair', 'balconySlabB', 'voidEast'],
  mainSanitair: ['corridor', 'laundry', 'utilityRoom', 'voidEast'],
  utilityRoom: ['bedroomFemaleKids', 'corridor', 'mainSanitair', 'voidEast'],
  balconySlabB: ['kitchen', 'laundry', 'voidWest', 'voidEast'],
  voidWest: ['balconyA', 'controlCenter', 'guestRoom', 'guestSanitair', 'kitchen', 'balconySlabB'],
  voidEast: ['laundry', 'mainSanitair', 'utilityRoom', 'balconySlabB'],
};

/** A cross-section join skipped because its line runs inside a wall parallel to the line. */
interface SkippedJoin {
  /** Space before the join. */
  readonly before: SpaceId;
  /** Space after the join. */
  readonly after: SpaceId;
  /** Axis the line runs along. */
  readonly axis: Axis;
  /** Position of the line on the other axis, snapped to the plan grid, in metres. */
  readonly at: number;
}

/** The line z 7.00 through the kitchen centre, inside the guest-sanitair north wall. */
const GUEST_KITCHEN_LINE_Z = 7.0;
/** The line x 7.15 through the west void centre, inside the wall between the link corridor end and the guest room. */
const CORRIDOR_GUEST_LINE_X = 7.15;

/** Every join the cross-section check is expected to skip; any other skip fails. */
const EXPECTED_SKIPPED_JOINS: readonly SkippedJoin[] = [
  { before: 'guestRoom', after: 'kitchen', axis: 'x', at: GUEST_KITCHEN_LINE_Z },
  { before: 'corridor', after: 'guestRoom', axis: 'z', at: CORRIDOR_GUEST_LINE_X },
];

/**
 * Lists every rect of the plan with its space id and index.
 *
 * @param plan - The floor plan.
 * @returns One entry per rect, in plan order.
 */
function taggedRects(plan: FloorPlan): TaggedRect[] {
  return plan.spaces.flatMap((space) =>
    space.rects.map((rect, index) => ({ id: space.id, index, rect })),
  );
}

/**
 * Returns a rect's range along an axis.
 *
 * @param rect - The rectangle.
 * @param axis - The axis.
 * @returns `[min, max]` on that axis.
 */
function rangeOn(rect: PlanRect, axis: Axis): readonly [number, number] {
  return axis === 'x' ? [rect.minX, rect.maxX] : [rect.minZ, rect.maxZ];
}

/**
 * Returns the other plan axis.
 *
 * @param axis - An axis.
 * @returns `'z'` for `'x'` and `'x'` for `'z'`.
 */
function otherAxis(axis: Axis): Axis {
  return axis === 'x' ? 'z' : 'x';
}

/**
 * Returns the length shared by two ranges.
 *
 * @param a - First `[min, max]` range.
 * @param b - Second `[min, max]` range.
 * @returns The overlap length; zero or negative when they only touch or are disjoint.
 */
function overlapLength(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
}

/**
 * Cuts the plan along a line and lists what the line crosses, in order.
 *
 * With `axis = 'x'` the line runs along x at `z = at`; with `axis = 'z'` it
 * runs along z at `x = at`. A rect is crossed when its range on the other axis
 * satisfies `min <= at < max`. Zero-length gaps are omitted.
 *
 * @param plan - The floor plan to cut.
 * @param axis - The axis the line runs along.
 * @param at - Position of the line on the other axis, in metres.
 * @returns Segments from the plot start to the plot end, lengths snapped to the plan grid.
 */
function crossSection(plan: FloorPlan, axis: Axis, at: number): Segment[] {
  const crossed = taggedRects(plan)
    .filter(({ rect }) => {
      const [min, max] = rangeOn(rect, otherAxis(axis));
      return min <= at && at < max;
    })
    .sort((a, b) => rangeOn(a.rect, axis)[0] - rangeOn(b.rect, axis)[0]);

  const [plotStart, plotEnd] = rangeOn(plan.plot, axis);
  const segments: Segment[] = [];
  let cursor = plotStart;
  const pushGap = (end: number): void => {
    const length = toPlanLength(end - cursor);
    if (length !== 0) {
      segments.push({ kind: 'gap', length });
    }
  };
  crossed.forEach(({ id, rect }) => {
    const [start, end] = rangeOn(rect, axis);
    pushGap(start);
    segments.push({ kind: 'space', id, length: toPlanLength(end - start) });
    cursor = end;
  });
  pushGap(plotEnd);
  return segments;
}

/**
 * Lists the joins on a cross-section: the solid (possibly zero) before the
 * first space, between each pair of consecutive space segments, and after the
 * last space.
 *
 * @param plan - The floor plan to cut.
 * @param axis - The axis the line runs along.
 * @param at - Position of the line on the other axis, in metres.
 * @returns The joins in order along the line, with positions snapped to the plan grid.
 */
function sectionJoins(plan: FloorPlan, axis: Axis, at: number): SectionJoin[] {
  const joins: SectionJoin[] = [];
  let before: SpaceId | undefined;
  let start = rangeOn(plan.plot, axis)[0];
  let cursor = start;
  crossSection(plan, axis, at).forEach((segment) => {
    if (segment.kind === 'gap') {
      cursor = toPlanLength(cursor + segment.length);
      return;
    }
    joins.push({ before, after: segment.id, start, end: cursor });
    cursor = toPlanLength(cursor + segment.length);
    before = segment.id;
    start = cursor;
  });
  joins.push({ before, after: undefined, start, end: cursor });
  return joins;
}

/**
 * Checks whether a join on a cross-section line may run inside a wall parallel
 * to the line instead of crossing a single wall.
 *
 * That happens when a rect the line does not cross has a face parallel to the
 * line closer than {@link MAX_WALL_THICKNESS}, alongside the join. For example
 * the line z = 7.00 through the kitchen centre runs inside the guest-sanitair
 * north wall between the guest room and the kitchen.
 *
 * @param plan - The floor plan.
 * @param axis - The axis the line runs along.
 * @param at - Position of the line on the other axis, in metres.
 * @param join - The join to inspect.
 * @returns `true` when the join lies alongside a nearby parallel face.
 */
function runsAlongWall(plan: FloorPlan, axis: Axis, at: number, join: SectionJoin): boolean {
  return taggedRects(plan).some(({ rect }) => {
    const [min, max] = rangeOn(rect, otherAxis(axis));
    if (min <= at && at < max) {
      return false;
    }
    const distance = Math.min(Math.abs(min - at), Math.abs(max - at));
    const alongside = overlapLength(rangeOn(rect, axis), [join.start, join.end]);
    return distance < MAX_WALL_THICKNESS - LENGTH_TOLERANCE && alongside > LENGTH_TOLERANCE;
  });
}

/**
 * Checks every join on a cross-section line against its expected thickness.
 *
 * Joins at the plot boundary must be exterior walls and joins between two
 * segments of the same space must be empty. A join that runs alongside a nearby
 * parallel wall (see {@link runsAlongWall}) is skipped and reported as such.
 *
 * @param plan - The floor plan to cut.
 * @param axis - The axis the line runs along.
 * @param at - Position of the line on the other axis, in metres.
 * @returns The mismatch descriptions and the skipped joins of the line.
 */
function checkSectionJoins(
  plan: FloorPlan,
  axis: Axis,
  at: number,
): { readonly mismatches: string[]; readonly skipped: SkippedJoin[] } {
  const mismatches: string[] = [];
  const skipped: SkippedJoin[] = [];
  sectionJoins(plan, axis, at).forEach((join) => {
    const gap = toPlanLength(join.end - join.start);
    const label = `${join.before ?? 'plot'} → ${join.after ?? 'plot'} at ${String(join.start)}: gap ${String(gap)}`;
    if (join.before === undefined || join.after === undefined) {
      if (gap !== WALL_SPEC.exterior) {
        mismatches.push(`${label}, exterior ${String(WALL_SPEC.exterior)}`);
      }
      return;
    }
    if (join.before === join.after) {
      if (gap !== NO_WALL) {
        mismatches.push(`${label}, same space`);
      }
      return;
    }
    if (runsAlongWall(plan, axis, at, join)) {
      skipped.push({ before: join.before, after: join.after, axis, at: toPlanLength(at) });
      return;
    }
    const expected = getJoinThickness(
      plan,
      getSpace(plan, join.before),
      getSpace(plan, join.after),
    );
    if (Math.abs(gap - expected) > LENGTH_TOLERANCE) {
      mismatches.push(`${label}, join ${String(expected)}`);
    }
  });
  return { mismatches, skipped };
}

/**
 * Formats a skipped join as a stable, comparable key.
 *
 * @param skip - The skipped join.
 * @returns A label such as `guestRoom → kitchen along x at 7`.
 */
function skippedJoinKey(skip: SkippedJoin): string {
  return `${skip.before} → ${skip.after} along ${skip.axis} at ${String(skip.at)}`;
}

/**
 * Checks whether two rects touch along an edge with a shared length.
 *
 * @param a - First rectangle.
 * @param b - Second rectangle.
 * @returns `true` when a face of one lies on a face of the other and they
 *   overlap by more than {@link LENGTH_TOLERANCE} along it.
 */
function touchAlongEdge(a: PlanRect, b: PlanRect): boolean {
  const facesMeetX =
    Math.abs(a.maxX - b.minX) <= LENGTH_TOLERANCE || Math.abs(b.maxX - a.minX) <= LENGTH_TOLERANCE;
  const facesMeetZ =
    Math.abs(a.maxZ - b.minZ) <= LENGTH_TOLERANCE || Math.abs(b.maxZ - a.minZ) <= LENGTH_TOLERANCE;
  const overlapX = overlapLength(rangeOn(a, 'x'), rangeOn(b, 'x'));
  const overlapZ = overlapLength(rangeOn(a, 'z'), rangeOn(b, 'z'));
  return (facesMeetX && overlapZ > LENGTH_TOLERANCE) || (facesMeetZ && overlapX > LENGTH_TOLERANCE);
}

/**
 * Lists every contact whose gap differs from the join thickness of its two spaces.
 *
 * @param plan - The floor plan to check.
 * @returns One description per mismatching contact; empty when every contact agrees.
 */
function findJoinMismatches(plan: FloorPlan): string[] {
  return plan.spaces.flatMap((space) =>
    getNeighbours(plan, space.id).flatMap((contact) => {
      const neighbour = getSpace(plan, contact.neighbourId);
      const expected = getJoinThickness(plan, space, neighbour);
      return Math.abs(contact.gap - expected) > LENGTH_TOLERANCE
        ? [
            `${space.id}[${String(contact.rectIndex)}] ${contact.side} → ${neighbour.id}[${String(contact.neighbourRectIndex)}]: gap ${String(contact.gap)}, join ${String(expected)}`,
          ]
        : [];
    }),
  );
}

/**
 * Builds a copy of the plan with every kitchen rect moved along x.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param shift - Distance to move along x, in metres.
 * @returns A new plan whose kitchen is shifted.
 */
function withKitchenShifted(plan: FloorPlan, shift: number): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) =>
      space.id === 'kitchen'
        ? {
            ...space,
            rects: space.rects.map((rect) =>
              makeRect(
                toPlanLength(rect.minX + shift),
                toPlanLength(rect.maxX + shift),
                rect.minZ,
                rect.maxZ,
              ),
            ),
          }
        : space,
    ),
  };
}

const RECTS = taggedRects(FLOOR_PLAN);
const CENTRE_LINES = RECTS.flatMap(({ id, index, rect }) => [
  { id, index, axis: 'x' as const, at: (rect.minZ + rect.maxZ) * HALF },
  { id, index, axis: 'z' as const, at: (rect.minX + rect.maxX) * HALF },
]);

describe('floor plan invariants', () => {
  it('passes validateFloorPlan unchanged', () => {
    expect(validateFloorPlan(FLOOR_PLAN)).toBe(FLOOR_PLAN);
  });

  it('never overlaps two rects, within or across spaces', () => {
    const offenders = RECTS.flatMap((a, position) =>
      RECTS.slice(position + 1)
        .filter((b) => rectsOverlap(a.rect, b.rect))
        .map((b) => `${a.id}[${String(a.index)}] ↔ ${b.id}[${String(b.index)}]`),
    );

    expect(offenders).toEqual([]);
  });

  it('keeps every rect inside the interior envelope', () => {
    const outside = RECTS.filter(({ rect }) => !rectContainsRect(INTERIOR_RECT, rect)).map(
      ({ id, index }) => `${id}[${String(index)}]`,
    );

    expect(outside).toEqual([]);
  });

  it.each(FLOOR_PLAN.spaces.map((space) => [space.id, space] as const))(
    'makes the rects of %s one edge-connected group',
    (_id, space) => {
      const reached = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const current = queue.shift() ?? 0;
        space.rects.forEach((rect, index) => {
          if (!reached.has(index) && touchAlongEdge(space.rects[current], rect)) {
            reached.add(index);
            queue.push(index);
          }
        });
      }

      expect(reached.size).toBe(space.rects.length);
    },
  );

  describe('contact gaps', () => {
    it('gives every neighbour contact the join thickness of its two spaces', () => {
      expect(findJoinMismatches(FLOOR_PLAN)).toEqual([]);
    });

    it.each(CENTRE_LINES)(
      'gives every join along $axis through the centre of $id rect $index its thickness',
      ({ axis, at }) => {
        expect(checkSectionJoins(FLOOR_PLAN, axis, at).mismatches).toEqual([]);
      },
    );

    it('skips exactly the expected joins that run inside a parallel wall', () => {
      const skippedKeys = new Set(
        CENTRE_LINES.flatMap(({ axis, at }) =>
          checkSectionJoins(FLOOR_PLAN, axis, at).skipped.map(skippedJoinKey),
        ),
      );

      expect([...skippedKeys].sort()).toEqual(EXPECTED_SKIPPED_JOINS.map(skippedJoinKey).sort());
    });
  });

  describe('join exceptions', () => {
    it.each(JOIN_EXCEPTIONS)('joins %s and %s with a %f m gap', (id, neighbourId, thickness) => {
      const space = getSpace(FLOOR_PLAN, id);
      const neighbour = getSpace(FLOOR_PLAN, neighbourId);
      const contacts = getNeighbours(FLOOR_PLAN, id).filter(
        (contact) => contact.neighbourId === neighbourId,
      );

      expect(getJoinThickness(FLOOR_PLAN, space, neighbour)).toBeCloseTo(
        thickness,
        PRECISION_DIGITS,
      );
      expect(getJoinThickness(FLOOR_PLAN, neighbour, space)).toBeCloseTo(
        thickness,
        PRECISION_DIGITS,
      );
      expect(contacts.length).toBeGreaterThan(0);
      contacts.forEach((contact) => {
        expect(contact.gap).toBeCloseTo(thickness, PRECISION_DIGITS);
      });
    });

    it.each(FLOOR_PLAN.joinOverrides.map((override) => override.spaces))(
      'overrides %s ↔ %s only on a pair that has a contact',
      (id, neighbourId) => {
        const contacts = getNeighbours(FLOOR_PLAN, id).filter(
          (contact) => contact.neighbourId === neighbourId,
        );

        expect(contacts.length).toBeGreaterThan(0);
      },
    );
  });

  describe('neighbour sets', () => {
    const expectedEntries = Object.entries(EXPECTED_NEIGHBOURS) as [SpaceId, readonly SpaceId[]][];

    it('lists an expected neighbour set for every space of the plan', () => {
      expect(Object.keys(EXPECTED_NEIGHBOURS).sort()).toEqual(
        FLOOR_PLAN.spaces.map((space) => space.id).sort(),
      );
    });

    it('keeps the expected sets symmetric: A lists B iff B lists A', () => {
      const oneSided = expectedEntries.flatMap(([id, neighbours]) =>
        neighbours
          .filter((neighbourId) => !EXPECTED_NEIGHBOURS[neighbourId].includes(id))
          .map((neighbourId) => `${id} → ${neighbourId}`),
      );

      expect(oneSided).toEqual([]);
    });

    it.each(expectedEntries)('lists the neighbours of %s', (id, expected) => {
      const actual = new Set(getNeighbours(FLOOR_PLAN, id).map((contact) => contact.neighbourId));

      expect([...actual].sort()).toEqual([...expected].sort());
    });
  });

  describe('mutation guard', () => {
    it('finds no join mismatch in FLOOR_PLAN', () => {
      expect(findJoinMismatches(FLOOR_PLAN)).toEqual([]);
    });

    it('finds join mismatches when the kitchen moves 0.05 m along x', () => {
      const shifted = withKitchenShifted(FLOOR_PLAN, KITCHEN_SHIFT_X);

      expect(findJoinMismatches(shifted).length).toBeGreaterThan(0);
      expect(getSpace(FLOOR_PLAN, 'kitchen').rects[0].minX).not.toBe(
        getSpace(shifted, 'kitchen').rects[0].minX,
      );
    });
  });

  describe('point lookup', () => {
    it.each(RECTS)('finds $id at the centre of its rect $index', ({ id, rect }) => {
      const centre = { x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF };

      expect(findSpaceAt(FLOOR_PLAN, centre)?.id).toBe(id);
    });
  });
});
