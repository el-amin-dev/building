/**
 * The plan data of the typical floor: plot, interior, every space and the join
 * overrides.
 *
 * DERIVED, never hand-written. Every number comes from the source of truth,
 * `../sourceOfTruth/plan.ts`, which is the single copy of the geometry: the
 * owner edits rectangles there, the drawing is regenerated from it, and this
 * module is the same rectangles wearing the shapes the 3D app already consumes.
 * This file used to hold a second copy of the floor, and a second copy is a
 * second building — it was still describing rooms the owner had redrawn.
 *
 * What the derivation actually does, and nothing more:
 * - the plot is the source of truth's `PLOT`, and the interior is that plot
 *   inset by its own exterior wall thickness, so the two can never disagree;
 * - every room becomes a {@link Space}, in matricule order R01…R22;
 * - the plan's `stairwell` kind maps to `circulation` (see below);
 * - each join override keeps its thickness and the owner's reason for it.
 *
 * Every rect is a clear (inner) rectangle in plan coordinates (see `types.ts`).
 * The whole structure is deeply frozen. It is not validated at module load;
 * tests run `validateFloorPlan` on it.
 */
import { insetRect, makeRect } from '../planGeometry.ts';
import type { PlanRect } from '../planGeometry.ts';
import {
  JOIN_OVERRIDES as PLAN_JOIN_OVERRIDES,
  PLOT,
  ROOMS,
  WALLS,
} from '../sourceOfTruth/plan.ts';
import type { PlanRectCoordinates, PlanRoomKind } from '../sourceOfTruth/plan.ts';
import type { FloorPlan, JoinOverride, Space, SpaceId, SpaceKind } from './types.ts';

/**
 * The kind each kind of the source of truth becomes in the model.
 *
 * Only `stairwell` is not an identity: the plan gives the stair bay a kind of
 * its own because only part of it is floor at this level, while the model has
 * carried the stairs as `circulation` since ADR-005 and its consumers are
 * written against those four kinds. The mapping is the whole of the difference
 * — the rects, the name and the id are the plan's, untouched.
 */
const SPACE_KIND_OF: Readonly<Record<PlanRoomKind, SpaceKind>> = Object.freeze({
  room: 'room',
  circulation: 'circulation',
  stairwell: 'circulation',
  openAir: 'openAir',
  void: 'void',
});

/**
 * Builds a frozen space whose rects are frozen through `makeRect`.
 *
 * @param id - Identifier of the space.
 * @param name - Human-readable name.
 * @param kind - Kind of the space.
 * @param rects - Clear rect coordinates, in order.
 * @returns A deeply frozen {@link Space}.
 */
function defineSpace(
  id: SpaceId,
  name: string,
  kind: SpaceKind,
  rects: readonly PlanRectCoordinates[],
): Space {
  const frozenRects: readonly PlanRect[] = Object.freeze(
    rects.map(([minX, maxX, minZ, maxZ]) => makeRect(minX, maxX, minZ, maxZ)),
  );
  return Object.freeze({ id, name, kind, rects: frozenRects });
}

/**
 * Builds a frozen join override with a frozen space pair.
 *
 * @param first - First space of the join.
 * @param second - Second space of the join.
 * @param thickness - Wall thickness of the join, in metres; `0` means no wall.
 * @param reason - Why the default thickness does not apply.
 * @returns A deeply frozen {@link JoinOverride}.
 */
function defineJoinOverride(
  first: SpaceId,
  second: SpaceId,
  thickness: number,
  reason: string,
): JoinOverride {
  const spaces: readonly [SpaceId, SpaceId] = Object.freeze([first, second] as const);
  return Object.freeze({ spaces, thickness, reason });
}

/** Outer boundary of the floor: the 22.50 × 10.00 m plot (brief §1, §8). Frozen. */
export const PLOT_RECT: PlanRect = makeRect(PLOT[0], PLOT[1], PLOT[2], PLOT[3]);

/**
 * Clear interior of the floor: the plot inset by the 0.30 m exterior walls,
 * x 0.30–22.20 and z 0.30–9.70 (brief §2). Frozen.
 */
export const INTERIOR_RECT: PlanRect = insetRect(PLOT_RECT, WALLS.exterior);

/** The spaces of the floor, in `SPACE_IDS` order. */
const SPACES: readonly Space[] = Object.freeze(
  ROOMS.map((room) => defineSpace(room.id, room.name, SPACE_KIND_OF[room.kind], room.rects)),
);

/** Joins whose wall thickness deviates from the kind-based default. */
const JOIN_OVERRIDES: readonly JoinOverride[] = Object.freeze(
  PLAN_JOIN_OVERRIDES.map((override) =>
    defineJoinOverride(override.between[0], override.between[1], override.thickness, override.why),
  ),
);

/**
 * The complete plan of the typical floor. Deeply frozen: the plan, its spaces
 * array, every space, every rects array and rect, the overrides array, every
 * override and its `spaces` pair.
 */
export const FLOOR_PLAN: FloorPlan = Object.freeze({
  plot: PLOT_RECT,
  interior: INTERIOR_RECT,
  spaces: SPACES,
  joinOverrides: JOIN_OVERRIDES,
});
