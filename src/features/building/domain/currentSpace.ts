/**
 * Which space of the floor the explorer is standing in.
 *
 * `findSpaceAt` answers "what rect covers this exact point", which is not the
 * same question. It returns a `'void'` space, which has no floor and which a
 * body walking the floor is never in; and it returns `undefined` for every
 * point inside a wall (0.15 m or 0.30 m thick) and inside a doorway gap, which
 * a 0.25 m body straddles constantly. A readout driven straight off it would
 * blank every time the eye crossed a jamb — wrong, and chatty with it.
 *
 * This module adds the one rule that makes the answer stable: a hit with a
 * floor wins, and anything else means "still in the room you were in". Walls,
 * doorway gaps and voids therefore all keep the previous answer, which is the
 * honest one — the viewer has not arrived anywhere else yet.
 */
import { findSpaceAt, hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, Space } from './floorPlan/index.ts';
import type { PlanPoint } from './planGeometry.ts';

/**
 * Resolves the space the explorer is in, keeping the previous one across walls,
 * doorways and voids.
 *
 * `EyePose` is structurally assignable to {@link PlanPoint}, so a caller holding
 * a pose passes it directly rather than copying its `x` and `z` out.
 *
 * @param plan - The floor plan to locate the point on.
 * @param point - Where the body stands, in plan coordinates.
 * @param previous - The space resolved last time, if any.
 * @returns The space under the point when it has a floor; otherwise `previous`,
 *   which is itself `undefined` only before the first resolution ("unknown").
 * @throws RangeError when `x` or `z` is not finite — `findSpaceAt`'s own error,
 *   propagated unchanged, because a non-finite pose is a bug upstream and not a
 *   position to be smoothed over.
 */
export function getCurrentSpace(
  plan: FloorPlan,
  point: PlanPoint,
  previous?: Space,
): Space | undefined {
  const hit = findSpaceAt(plan, point);
  return hit !== undefined && hasFloor(hit.kind) ? hit : previous;
}
