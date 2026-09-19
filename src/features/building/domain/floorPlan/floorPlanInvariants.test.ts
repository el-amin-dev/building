import { describe, expect, it } from 'vitest';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectContainsRect,
  rectsOverlap,
  toPlanLength,
} from '../planGeometry.ts';
import type { PlanRect, RectSide } from '../planGeometry.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import { deriveWalls } from '../walls.ts';
import type { WallSide } from '../walls.ts';
import { FLOOR_PLAN, INTERIOR_RECT } from './floorPlanData.ts';
import { getJoinThickness } from './joins.ts';
import { findSpaceAt, getNeighbours, getSpace } from './queries.ts';
import type { FloorPlan, SpaceContact, SpaceId } from './types.ts';
import { validateFloorPlan } from './validateFloorPlan.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const NO_WALL = 0;
const KITCHEN_SHIFT_X = 0.05;

/**
 * Number of neighbour contacts the redrawn floor has, each wall counted from
 * both of the rooms it separates.
 *
 * Pinned so that the gap checks cannot quietly start measuring fewer walls than
 * the floor has.
 */
const CONTACT_COUNT = 110;

/** Thickness of the one join the owner kept at a hand-set 0.20 m (voidEast ↔ utilityRoom). */
const KEPT_DRAWN_WALL = 0.2;

/**
 * The thickest wall of the plan: a line closer than this to a parallel face
 * may run inside that wall rather than across it.
 */
const MAX_WALL_THICKNESS = Math.max(
  WALL_SPEC.exterior,
  WALL_SPEC.insulated,
  WALL_SPEC.partition,
  WALL_SPEC.voidFacing,
);

/**
 * Every gap the redrawn floor actually draws between two spaces, in metres.
 *
 * Isolation is a width now: a wall the owner named for sound and heat is built
 * `insulated` (0.30) where a plain separator is built `partition` (0.15), so
 * these four values are the complete vocabulary of the plan. A contact gap
 * outside this set is a drawing error rather than a new kind of wall.
 */
const DRAWN_JOIN_GAPS: readonly number[] = [
  NO_WALL,
  WALL_SPEC.partition,
  KEPT_DRAWN_WALL,
  WALL_SPEC.insulated,
];

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

/**
 * The join overrides of the plan, each with the gap it states, plus one
 * kind-rule join for contrast.
 *
 * `voidEast ↔ utilityRoom` is written as a literal 0.20 and no longer as
 * `WALL_SPEC.partition`: the two were the same number in v1 and are not any
 * more, so spelling it as the partition thickness would pass for the wrong
 * reason. `kitchen ↔ balconySlabB` is not an override at all — it is the
 * weather-exposed rule giving 0.30 — and is here so that a bug making every
 * join an override would still fail something.
 */
const JOIN_EXCEPTIONS: readonly (readonly [SpaceId, SpaceId, number])[] = [
  ['stairs', 'corridor', NO_WALL],
  ['voidWest', 'ccBalcony', NO_WALL],
  ['voidWest', 'balconySlabB', NO_WALL],
  ['voidEast', 'balconySlabB', NO_WALL],
  ['voidEast', 'utilityRoom', KEPT_DRAWN_WALL],
  ['kitchen', 'balconySlabB', WALL_SPEC.voidFacing],
];

/**
 * Neighbour ids of every space, derived from the clear rects of
 * `floorPlanData.ts`: two spaces are neighbours when a face of one rect lies
 * within 0.30 m of a parallel face of the other and the two overlap along that
 * face by more than the tolerance. Several 0.30 m gaps are 0.30000000000000004
 * in floating point (for example balconyA maxX 1.30 → x 1.60), so these sets
 * also guard the tolerance of the contact gap. Symmetric: A lists B iff B lists A.
 *
 * Changed with the redrawn floor: `linkCorridor` is gone, absorbed into the
 * guest room's north strip, which is why the guest room now reaches the side-A
 * balcony and the stairs; `ccBalcony` is new; and the three bath and shower
 * cubicles are rooms, so they have neighbours of their own.
 */
const EXPECTED_NEIGHBOURS: Readonly<Record<SpaceId, readonly SpaceId[]>> = {
  // x 1.30 → 1.60 along the whole A side.
  balconyA: ['controlCenter', 'guestRoom', 'masterBedroom', 'stairs'],
  masterBedroom: ['balconyA', 'corridor', 'livingRoom', 'stairs'],
  livingRoom: ['bedroomMaleKids', 'corridor', 'masterBedroom'],
  bedroomMaleKids: ['bedroomFemaleKids', 'corridor', 'livingRoom'],
  bedroomFemaleKids: ['bedroomMaleKids', 'corridor', 'utilityRoom'],
  stairs: ['balconyA', 'corridor', 'guestRoom', 'masterBedroom'],
  corridor: [
    'bedroomFemaleKids',
    'bedroomMaleKids',
    'guestRoom',
    'kitchen',
    'laundry',
    'livingRoom',
    'mainSanitair',
    'masterBedroom',
    'stairs',
    'utilityRoom',
  ],
  controlCenter: ['balconyA', 'ccBalcony', 'guestRoom'],
  guestRoom: [
    'balconyA',
    'ccBalcony',
    'controlCenter',
    'corridor',
    'guestBathCubicle',
    'guestSanitair',
    'kitchen',
    'stairs',
    'voidWest',
  ],
  guestSanitair: ['guestBathCubicle', 'guestRoom', 'kitchen'],
  kitchen: [
    'balconySlabB',
    'corridor',
    'guestBathCubicle',
    'guestRoom',
    'guestSanitair',
    'laundry',
    'voidWest',
  ],
  laundry: ['balconySlabB', 'corridor', 'kitchen', 'mainBathCubicle', 'mainSanitair', 'voidEast'],
  mainSanitair: ['corridor', 'laundry', 'mainBathCubicle', 'mainShowerCubicle', 'utilityRoom'],
  utilityRoom: ['bedroomFemaleKids', 'corridor', 'mainSanitair', 'mainShowerCubicle', 'voidEast'],
  ccBalcony: ['controlCenter', 'guestRoom', 'voidWest'],
  balconySlabB: ['kitchen', 'laundry', 'voidEast', 'voidWest'],
  voidWest: ['balconySlabB', 'ccBalcony', 'guestBathCubicle', 'guestRoom', 'kitchen'],
  voidEast: ['balconySlabB', 'laundry', 'mainBathCubicle', 'mainShowerCubicle', 'utilityRoom'],
  guestBathCubicle: ['guestRoom', 'guestSanitair', 'kitchen', 'voidWest'],
  mainBathCubicle: ['laundry', 'mainSanitair', 'mainShowerCubicle', 'voidEast'],
  mainShowerCubicle: ['mainBathCubicle', 'mainSanitair', 'utilityRoom', 'voidEast'],
};

/**
 * The contacts where the per-PAIR summary of {@link getJoinThickness} is not the
 * wall the plan draws there — and the only ones on this floor.
 *
 * **Not a bug, and not a list of tolerated failures.** The plan genuinely draws
 * this one wall at BOTH widths: 0.15 under the guest room's north strip and 0.30
 * on the control center's east wall, which `pnpm verify:plan` reports as
 * "F1-R08-CTR-W2 … is insulated 1.70 of 2.50". `getJoinThickness` answers per
 * pair, so it has a single number to give for two walls, and it gives the
 * THICKEST — the owner's junction rule, "in thick wall when X wall meet Y wall …
 * thick win". A per-pair comparison therefore cannot be exact for a wall that
 * varies, which is why the gap checks below measure per STRETCH against
 * `walls.ts` instead and stay exact everywhere, this wall included.
 *
 * Pinned exhaustively, both halves of the one wall, so that a NEW varying wall —
 * a second pair whose summary stops matching what is drawn — fails here instead
 * of being absorbed silently.
 *
 * This replaces a 28-entry list that tracked `joins.ts` inferring a 0.15
 * partition from the two room kinds where the floor is built 0.30. That module
 * now measures the gap the rects leave, so those twenty-eight disagreements no
 * longer exist.
 */
const VARYING_JOIN_CONTACTS: readonly string[] = [
  'controlCenter[0] minZ → guestRoom[0]',
  'guestRoom[0] maxZ → controlCenter[0]',
];

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

/**
 * Every join the cross-section check is expected to skip; any other skip fails.
 *
 * Eight now rather than two, and all for the one reason the check was given the
 * rule for: the redrawn floor has far more rooms whose faces are not aligned, so
 * many more centre lines graze a wall that runs parallel to them. The clearest
 * are the guest suite's — a line along x at any depth of the wet rooms runs
 * inside the partition that separates them or the one below the guest room's
 * north strip, so the guest room and the kitchen appear to meet across three
 * different walls.
 *
 * Two entries went with the guest shower (owner, 2026-09-19). The cubicle pair
 * `guestBathCubicle → guestShowerCubicle` at z 8.03 is gone with the second
 * cubicle. And `guestSanitair → voidWest` at x 8.75 — the centre line of the
 * corridor's south rect — is gone because the bath now spans the whole 8.05–9.85
 * bay: the line CROSSES it instead of grazing the old shower's west face at
 * x 8.85, so the sanitair and the void are no longer consecutive on it.
 */
const EXPECTED_SKIPPED_JOINS: readonly SkippedJoin[] = [
  { before: 'balconyA', after: 'guestRoom', axis: 'x', at: 7.2 },
  { before: 'corridor', after: 'utilityRoom', axis: 'x', at: 5.75 },
  { before: 'guestRoom', after: 'kitchen', axis: 'x', at: 6.93 },
  { before: 'guestRoom', after: 'kitchen', axis: 'x', at: 7.2 },
  { before: 'guestRoom', after: 'kitchen', axis: 'x', at: 7.82 },
  { before: 'laundry', after: 'utilityRoom', axis: 'x', at: 7.45 },
  { before: 'mainBathCubicle', after: 'mainShowerCubicle', axis: 'x', at: 7.48 },
  { before: 'mainSanitair', after: 'mainBathCubicle', axis: 'z', at: 17.83 },
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
 * Names a contact the way {@link INSULATED_CONTACTS} spells it.
 *
 * @param id - The queried space.
 * @param contact - One of its contacts.
 * @returns A label such as `kitchen[0] minX → guestRoom[0]`.
 */
function contactKey(id: SpaceId, contact: SpaceContact): string {
  return `${id}[${String(contact.rectIndex)}] ${contact.side} → ${contact.neighbourId}[${String(contact.neighbourRectIndex)}]`;
}

/**
 * Every wall face of the floor, with the stretches it is actually built from.
 *
 * The second opinion this file measures against. `walls.ts` tiles each face with
 * `contacts`, one per stretch, each carrying its own span, thickness and reason —
 * the migrated rule in full: a stated override wins, else the gap the rects leave
 * IS the thickness, else the kind rule. Comparing per stretch rather than per
 * pair is what makes the check exact on a wall built two widths along its length,
 * and it is a genuinely independent derivation: `walls.ts` sweeps the source of
 * truth's rooms itself rather than going through `getNeighbours`.
 */
const DERIVED_WALLS = deriveWalls();

/** The face of a rect a contact sits on → the room side `walls.ts` calls it. */
const FACE_OF_SIDE: Readonly<Record<RectSide, WallSide>> = Object.freeze({
  minZ: 'north',
  maxZ: 'south',
  maxX: 'east',
  minX: 'west',
});

/**
 * Returns the coordinate of the face of a rect that a contact sits on.
 *
 * @param rect - The rect carrying the contact.
 * @param side - The face of it that looks at the neighbour.
 * @returns That face's coordinate on the axis it faces, in metres.
 */
function faceAt(rect: PlanRect, side: RectSide): number {
  if (side === 'minX') {
    return rect.minX;
  }
  if (side === 'maxX') {
    return rect.maxX;
  }
  return side === 'minZ' ? rect.minZ : rect.maxZ;
}

/**
 * Returns the thicknesses `walls.ts` builds along one neighbour contact.
 *
 * @param plan - The floor plan the contact was measured on.
 * @param id - The queried space.
 * @param contact - One of its contacts.
 * @returns One thickness per stretch of that space's matching face which looks at
 *   the same neighbour across the contact, in metres; empty when no stretch
 *   covers it at all.
 */
function drawnThicknesses(plan: FloorPlan, id: SpaceId, contact: SpaceContact): readonly number[] {
  const rect = getSpace(plan, id).rects[contact.rectIndex];
  const at = faceAt(rect, contact.side);
  return DERIVED_WALLS.filter(
    (wall) =>
      wall.roomId === id &&
      wall.side === FACE_OF_SIDE[contact.side] &&
      Math.abs(wall.at - at) <= LENGTH_TOLERANCE,
  ).flatMap((wall) =>
    wall.contacts
      .filter(
        (stretch) =>
          stretch.neighbourId === contact.neighbourId &&
          Math.min(stretch.spanMax, contact.spanMax) - Math.max(stretch.spanMin, contact.spanMin) >
            LENGTH_TOLERANCE,
      )
      .map((stretch) => stretch.thickness),
  );
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
 * a line along x through the guest bathroom's depth runs inside the cubicle
 * partitions, so the guest room and the kitchen seem to meet across them.
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
 * Returns the thicknesses `walls.ts` draws between the two spaces of a
 * cross-section join, where the line crosses that wall.
 *
 * The wall between two spaces a line crosses runs along the OTHER axis, and its
 * face sits at the start of the join, so the stretch of that face spanning the
 * line's own position is the one number the section should measure — per stretch
 * again, so a wall that changes width along its length is read at the point the
 * line actually cuts it.
 *
 * @param axis - The axis the line runs along.
 * @param at - Position of the line on the other axis, in metres.
 * @param join - The join the line crosses.
 * @returns The distinct thicknesses found there, in metres; normally exactly one.
 */
function drawnSectionThicknesses(axis: Axis, at: number, join: SectionJoin): readonly number[] {
  const faceAxis = otherAxis(axis);
  return [
    ...new Set(
      DERIVED_WALLS.filter(
        (wall) =>
          wall.roomId === join.before &&
          wall.axis === faceAxis &&
          Math.abs(wall.at - join.start) <= LENGTH_TOLERANCE,
      ).flatMap((wall) =>
        wall.contacts
          .filter(
            (stretch) =>
              stretch.neighbourId === join.after &&
              stretch.spanMin <= at + LENGTH_TOLERANCE &&
              stretch.spanMax >= at - LENGTH_TOLERANCE,
          )
          .map((stretch) => stretch.thickness),
      ),
    ),
  ];
}

/**
 * Checks every join on a cross-section line against its expected thickness.
 *
 * Joins at the plot boundary must be exterior walls and joins between two
 * segments of the same space must be empty. A join that runs alongside a nearby
 * parallel wall (see {@link runsAlongWall}) is skipped and reported as such, and
 * every other join must measure exactly the stretch of wall the plan draws where
 * the line cuts it (see {@link drawnSectionThicknesses}).
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
    const drawn = drawnSectionThicknesses(axis, at, join);
    if (drawn.length !== 1) {
      mismatches.push(`${label}, ${String(drawn.length)} drawn stretches cross the line`);
      return;
    }
    if (Math.abs(gap - drawn[0]) > LENGTH_TOLERANCE) {
      mismatches.push(`${label}, built ${String(drawn[0])}`);
    }
  });
  return { mismatches, skipped };
}

/**
 * Formats a skipped join as a stable, comparable key.
 *
 * @param skip - The skipped join.
 * @returns A label such as `guestRoom → kitchen along x at 7.2`.
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
 * Lists every contact whose gap differs from the wall the plan actually draws there.
 *
 * Measured per stretch against `walls.ts`: the gap must equal the thickness of
 * every stretch of that face which looks at the neighbour across the contact. A
 * contact no stretch covers counts as a mismatch too, so the check can never come
 * back empty by comparing nothing.
 *
 * @param plan - The floor plan to check.
 * @returns One description per mismatching contact; empty when every contact agrees.
 */
function findJoinMismatches(plan: FloorPlan): string[] {
  return plan.spaces.flatMap((space) =>
    getNeighbours(plan, space.id).flatMap((contact) => {
      const label = `${contactKey(space.id, contact)}: gap ${String(contact.gap)}`;
      const drawn = drawnThicknesses(plan, space.id, contact);
      if (drawn.length === 0) {
        return [`${label}, no stretch of the drawn wall covers it`];
      }
      return drawn
        .filter((thickness) => Math.abs(contact.gap - thickness) > LENGTH_TOLERANCE)
        .map((thickness) => `${label}, built ${String(thickness)}`);
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
    it('gives every neighbour contact the gap the plan draws there', () => {
      expect(findJoinMismatches(FLOOR_PLAN)).toEqual([]);
    });

    it('measures every contact of the plan against a drawn stretch', () => {
      const contacts = FLOOR_PLAN.spaces.flatMap((space) =>
        getNeighbours(FLOOR_PLAN, space.id).map((contact) => ({ id: space.id, contact })),
      );
      const uncovered = contacts
        .filter(({ id, contact }) => drawnThicknesses(FLOOR_PLAN, id, contact).length === 0)
        .map(({ id, contact }) => contactKey(id, contact));

      // The gap checks are worth exactly as much as their coverage: a lookup that
      // matched nothing would let every one of them pass while comparing nothing.
      expect(contacts).toHaveLength(CONTACT_COUNT);
      expect(uncovered).toEqual([]);
    });

    it('draws every contact at one of the four thicknesses the plan uses', () => {
      const strange = FLOOR_PLAN.spaces.flatMap((space) =>
        getNeighbours(FLOOR_PLAN, space.id)
          .filter(
            (contact) =>
              !DRAWN_JOIN_GAPS.some((gap) => Math.abs(contact.gap - gap) <= LENGTH_TOLERANCE),
          )
          .map((contact) => `${contactKey(space.id, contact)}: gap ${String(contact.gap)}`),
      );

      expect(strange).toEqual([]);
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

  describe('a wall drawn at two widths along its length', () => {
    it('names every contact where the per-pair summary and the drawn wall disagree', () => {
      const disagreeing = FLOOR_PLAN.spaces.flatMap((space) =>
        getNeighbours(FLOOR_PLAN, space.id)
          .filter((contact) => {
            const summary = getJoinThickness(
              FLOOR_PLAN,
              getSpace(FLOOR_PLAN, space.id),
              getSpace(FLOOR_PLAN, contact.neighbourId),
            );
            return Math.abs(contact.gap - summary) > LENGTH_TOLERANCE;
          })
          .map((contact) => contactKey(space.id, contact)),
      );

      expect(disagreeing.sort()).toEqual([...VARYING_JOIN_CONTACTS].sort());
    });

    it.each(VARYING_JOIN_CONTACTS)(
      'draws %s thin where the same pair is also drawn thick',
      (key) => {
        const found = FLOOR_PLAN.spaces.flatMap((space) =>
          getNeighbours(FLOOR_PLAN, space.id)
            .filter((contact) => contactKey(space.id, contact) === key)
            .map((contact) => ({ space, contact })),
        );

        expect(found).toHaveLength(1);
        const [{ space, contact }] = found;
        const gaps = getNeighbours(FLOOR_PLAN, space.id)
          .filter((other) => other.neighbourId === contact.neighbourId)
          .map((other) => other.gap);

        // This stretch is the thin one, and `walls.ts` builds it thin...
        expect(contact.gap).toBeCloseTo(WALL_SPEC.partition, PRECISION_DIGITS);
        expect(drawnThicknesses(FLOOR_PLAN, space.id, contact)).toEqual([WALL_SPEC.partition]);
        // ...while the same pair also meets across a 0.30 stretch elsewhere, which
        // is what makes the wall vary and the per-pair summary inexact...
        expect([...new Set(gaps)].sort((a, b) => a - b)).toEqual([
          WALL_SPEC.partition,
          WALL_SPEC.insulated,
        ]);
        // ...and the summary answers the thicker of the two: thick wins.
        expect(
          getJoinThickness(FLOOR_PLAN, space, getSpace(FLOOR_PLAN, contact.neighbourId)),
        ).toBeCloseTo(WALL_SPEC.insulated, PRECISION_DIGITS);
      },
    );

    it('keeps the list symmetric: both sides of the varying wall are named', () => {
      // A wall is one wall. If the per-pair summary overstates it seen from one of
      // its two rooms it overstates it seen from the other, so the list must hold
      // both halves of every wall it names.
      const oneSided = FLOOR_PLAN.spaces.flatMap((space) =>
        getNeighbours(FLOOR_PLAN, space.id)
          .filter((contact) => VARYING_JOIN_CONTACTS.includes(contactKey(space.id, contact)))
          .filter(
            (contact) =>
              !getNeighbours(FLOOR_PLAN, contact.neighbourId).some(
                (back) =>
                  back.neighbourId === space.id &&
                  back.rectIndex === contact.neighbourRectIndex &&
                  back.neighbourRectIndex === contact.rectIndex &&
                  VARYING_JOIN_CONTACTS.includes(contactKey(contact.neighbourId, back)),
              ),
          )
          .map((contact) => contactKey(space.id, contact)),
      );

      expect(oneSided).toEqual([]);
      expect(VARYING_JOIN_CONTACTS.length % 2).toBe(0);
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
