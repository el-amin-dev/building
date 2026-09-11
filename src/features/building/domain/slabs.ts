/**
 * Floor slabs of one storey: the plate the spaces stand on.
 *
 * Every space that has a floor rests on a slab, one per clear rect of the space
 * (`hasFloor`, `floorPlan/queries.ts`). A `'void'` space has none: the side-B
 * strip is a hole, not land, so no slab is emitted there (brief §5.2). The two
 * open-air balconies are the opposite case — they are outside, but they are
 * walkable, so they do get a slab. Summed over the plan the slab footprints are
 * therefore the 167.38 m² floor total of brief §8.
 *
 * The slab hangs below the finished floor of its own storey: its top is the
 * finished floor level (0) and its underside is one slab thickness lower, so the
 * slab occupies exactly the part of the floor-to-floor height that the walls do
 * not (`heights.ts`, ADR-006). The thickness is therefore derived,
 * `floorToFloor - wall`, and never written down as a number of its own: a change
 * to either height moves the slab with it.
 *
 * Pure geometry, in metres, with the plan conventions of `floorPlan/types.ts`
 * (ADR-005): no rendering, no scene objects, nothing mutated.
 */

import { hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, toPlanLength } from './planGeometry.ts';

/** Level of the finished floor of the storey: the top of every slab, in metres. */
const FINISHED_FLOOR_LEVEL = 0;

/** The slab under one clear rect of one space. */
export interface FloorSlab extends PlanBox {
  /** Identifier of the space the slab carries. */
  readonly spaceId: SpaceId;
}

/**
 * Returns the thickness of the slab implied by a set of vertical sizes.
 *
 * The walls of a storey rise `wall` above its finished floor and the next
 * finished floor is `floorToFloor` above it, so the slab fills the difference.
 * The result is snapped onto the centimetre plan grid: unlike a stair riser (see
 * `planBox.ts`), a slab depth is a drawn dimension of the section, so the
 * floating-point noise of `3.0 - 2.7` is removed rather than carried.
 *
 * @param heights - Vertical sizes of the floor, in metres.
 * @returns The slab thickness, in metres, rounded to the plan grid.
 * @throws RangeError naming both heights when they leave no positive thickness,
 *   i.e. when `wall` reaches or exceeds `floorToFloor`.
 */
function getSlabThickness(heights: FloorHeights): number {
  const thickness = toPlanLength(heights.floorToFloor - heights.wall);
  if (!Number.isFinite(thickness) || thickness <= LENGTH_TOLERANCE) {
    throw new RangeError(
      `the slab needs a positive thickness: heights.wall ${String(heights.wall)} must stay below heights.floorToFloor ${String(heights.floorToFloor)}, which leaves ${String(thickness)} m`,
    );
  }
  return thickness;
}

/**
 * Thickness of a slab of the typical floor, in metres: 0.30, the part of the
 * 3.00 m floor-to-floor height left over by the 2.70 m walls of
 * {@link FLOOR_HEIGHTS}.
 */
export const SLAB_THICKNESS: number = getSlabThickness(FLOOR_HEIGHTS);

/**
 * Derives the floor slabs of a plan.
 *
 * One slab per clear rect of every space with a floor, in plan order (the order
 * of `plan.spaces`, then the order of each space's `rects`), so a space made of
 * several rects — the L-shaped guest room — yields one slab per rect and the
 * slabs of the plan tile its floor without overlapping. Spaces of kind `'void'`
 * are skipped entirely (brief §5.2).
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param heights - Vertical sizes of the floor, in metres; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns A frozen array of frozen slabs, each spanning from
 *   `-(heights.floorToFloor - heights.wall)` up to the finished floor level 0.
 * @throws RangeError when `heights` leaves no positive slab thickness (see
 *   {@link getSlabThickness}).
 */
export function getSlabs(
  plan: FloorPlan,
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly FloorSlab[] {
  const bottom = -getSlabThickness(heights);
  return Object.freeze(
    plan.spaces
      .filter((space) => hasFloor(space.kind))
      .flatMap((space) =>
        space.rects.map((rect) =>
          Object.freeze({
            spaceId: space.id,
            ...makeBox(rect, bottom, FINISHED_FLOOR_LEVEL),
          }),
        ),
      ),
  );
}
