/**
 * Floor slabs of one storey: the plate the spaces stand on.
 *
 * Every space that has a floor rests on a slab, one per clear rect of the space
 * (`hasFloor`, `floorPlan/queries.ts`). A `'void'` space has none: the side-B
 * strip is a hole, not land, so no slab is emitted there (brief §5.2). The two
 * open-air balconies are the opposite case — they are outside, but they are
 * walkable, so they do get a slab.
 *
 * The stair bay is the third case, and the only one where a space is neither
 * wholly floored nor wholly a hole. The stair runs THROUGH this storey rather
 * than starting or ending on it (`stairs.ts`, owner): one flight rises out of
 * this floor to the half-landing above, the other arrives from the half-landing
 * below, and only the arrival landing is floor here. Paving the whole bay buries
 * the flight that comes up from below under a slab and makes the flight that
 * leaves this floor pass through one; so the bay is floored under the pieces
 * `stairs.ts` reports as `atThisLevel` and left open everywhere else — open below,
 * so the descending flight is seen from this floor, and open above, because the
 * hole is what the rising flight leaves through.
 *
 * Which piece that is, is deliberately not named here. `stairs.ts` derives it
 * from the geometry — a landing that runs up to a face of the bay carrying no
 * wall at all, which is two floors meeting at one level (brief §4.2) — and this
 * module reads the answer. Writing `landingEast` here would be a second place to
 * edit the day the plan declares another landing, and the plan has already grown
 * a piece once.
 *
 * The numbers on the typical floor: the bay is 4.00 × 2.00 = 8.00 m², the
 * arrival landing 1.00 × 2.00 = 2.00 m², so 6.00 m² of the bay is a hole. The
 * slabs therefore cover the source of truth's own FLOOR total, 163.52 m²
 * (`room`/`circulation`/`openAir`, which excludes the bay), plus that 2.00 m²
 * landing: 165.52 m².
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
import { LENGTH_TOLERANCE, rectContainsRect, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { getStairsLayout } from './stairs.ts';

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
 * This is the single source of truth for the underside of the floor, `-thickness`:
 * the walls start there too (`walls.ts`) and call this function rather than
 * subtracting the two heights again, so that both levels are bit-identical for
 * any set of heights and a section stays closed under an exact comparison.
 *
 * @param heights - Vertical sizes of the floor, in metres; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns The slab thickness, in metres, rounded to the plan grid.
 * @throws RangeError naming both heights when they leave no positive thickness,
 *   i.e. when `wall` reaches or exceeds `floorToFloor`.
 */
export function getSlabThickness(heights: FloorHeights = FLOOR_HEIGHTS): number {
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
 * Returns the parts of one clear rect that are floor at this storey.
 *
 * Everywhere but the stair bay that is the rect itself. A rect lying inside the
 * bay is floored only under the stair pieces that are at this storey's level:
 * the rest of it is the stairwell, and a stairwell is a hole with a stair
 * passing through it, not a floor with a stair standing on it.
 *
 * The test is the geometry, not the id of the space: a rect is in the bay when
 * the bay contains it. Nothing else on the plan lies inside the bay, and asking
 * the question this way means a bay split into several rects, or renamed, still
 * gets its hole.
 *
 * @param rect - One clear rect of a floored space.
 * @param bay - The stair bay, as `stairs.ts` reads it from the spec.
 * @param levelRects - Footprints of the stair pieces that are floor at this
 *   storey, in declaration order.
 * @returns The rect alone when it is outside the bay; otherwise the level pieces
 *   it contains, which is empty for a rect that is all hole.
 */
function getFlooredRects(
  rect: PlanRect,
  bay: PlanRect,
  levelRects: readonly PlanRect[],
): readonly PlanRect[] {
  if (!rectContainsRect(bay, rect)) {
    return [rect];
  }
  return levelRects.filter((levelRect) => rectContainsRect(rect, levelRect));
}

/**
 * Derives the floor slabs of a plan.
 *
 * One slab per clear rect of every space with a floor, in plan order (the order
 * of `plan.spaces`, then the order of each space's `rects`), so a space made of
 * several rects — the L-shaped guest room — yields one slab per rect and the
 * slabs of the plan tile its floor without overlapping. Spaces of kind `'void'`
 * are skipped entirely (brief §5.2), and the stair bay is floored only under the
 * pieces that are at this storey's level (see {@link getFlooredRects}), so a
 * slab of the bay carries the landing's footprint rather than the space's rect.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param heights - Vertical sizes of the floor, in metres; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns A frozen array of frozen slabs, each spanning from minus the
 *   {@link getSlabThickness} of `heights` up to the finished floor level 0.
 * @throws RangeError when `heights` leaves no positive slab thickness (see
 *   {@link getSlabThickness}), or when the plan's stair bay cannot hold the
 *   stair the spec declares, in which case nothing knows which part of the bay
 *   is floor (see `getStairsLayout`, `stairs.ts`).
 */
export function getSlabs(
  plan: FloorPlan,
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly FloorSlab[] {
  const bottom = -getSlabThickness(heights);
  const stairs = getStairsLayout(plan, heights);
  const levelRects: readonly PlanRect[] = stairs.pieces
    .filter((piece) => piece.atThisLevel)
    .map((piece) => piece.rect);
  return Object.freeze(
    plan.spaces
      .filter((space) => hasFloor(space.kind))
      .flatMap((space) =>
        space.rects.flatMap((rect) =>
          getFlooredRects(rect, stairs.bay, levelRects).map((flooredRect) =>
            Object.freeze({
              spaceId: space.id,
              ...makeBox(flooredRect, bottom, FINISHED_FLOOR_LEVEL),
            }),
          ),
        ),
      ),
  );
}
