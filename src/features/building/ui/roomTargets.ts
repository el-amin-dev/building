/**
 * The rooms a "go to room" control may offer, and the order it offers them in.
 *
 * Two answers, one rule. {@link getRoomTargets} asks the reachability model which spaces
 * can be walked to from a point and puts them in matricule order; {@link ROOM_TARGETS}
 * resolves that once, from the stairs arrival, for every control that needs a list of rooms.
 *
 * Nothing here decides how to get to a room: a route is `reachability.ts`'s answer and
 * walking it is the frame loop's job. This module only says which rooms are worth offering,
 * and it invents no label — `getSpaceLabel` is the one formatter (`floorPlan/queries.ts`).
 *
 * The two voids are absent from the list rather than offered and refused. A control that is
 * permanently unusable is noise in the Tab order and in a screen reader's list of buttons,
 * and a void is not a place a person can be: it has no floor (brief §5.2), which is exactly
 * why `getReachableSpaceIds` never returns one.
 */

import { FLOOR_PLAN, SPACE_IDS, getSpace } from '../domain/floorPlan/index.ts';
import type { FloorPlan, Space } from '../domain/floorPlan/index.ts';
import type { PlanPoint } from '../domain/planGeometry.ts';
import { PORT_SCHEDULE } from '../domain/ports/index.ts';
import type { Port } from '../domain/ports/index.ts';
import { getReachableSpaceIds } from '../domain/reachability.ts';
import { BUILT_FLOOR } from './floorInstance.ts';

/**
 * Where the stairs deliver a viewer onto this floor: the middle of the arrival landing.
 *
 * Entry is through the stairs only (brief §4.2, ADR-006), so this is where every visit to the
 * floor begins and the natural point to resolve {@link ROOM_TARGETS} from.
 *
 * Read off `BUILT_FLOOR`, the floor of the page, rather than derived again here: that module
 * exists precisely to forbid a second derivation of anything about the live floor, and the
 * arrival is already one of the things it owns (`floorInstance.ts`). The landing's `yaw` is
 * dropped, because reachability asks where a viewer stands and not which way they face.
 */
const STAIRS_ARRIVAL_POINT: PlanPoint = Object.freeze({
  x: BUILT_FLOOR.stairs.arrival.x,
  z: BUILT_FLOOR.stairs.arrival.z,
});

/**
 * Lists the spaces a viewer standing at a point can walk to.
 *
 * @param plan - The floor plan.
 * @param ports - The port schedule placed in that plan.
 * @param from - Where the viewer stands, in plan coordinates.
 * @returns The reachable spaces, frozen, in {@link SPACE_IDS} order — which is the source of
 *   truth's matricule order R01…R21. A reachable set comes out in breadth-first discovery
 *   order, so a walk of the floor would reshuffle it; ordering here by the plan's own order
 *   is what makes the answer independent of where the viewer happens to be.
 * @throws RangeError naming the point when it lies in no space of the plan or in one with no
 *   floor to walk on; see `getReachableSpaceIds`.
 */
export function getRoomTargets(
  plan: FloorPlan,
  ports: readonly Port[],
  from: PlanPoint,
): readonly Space[] {
  const reachable = getReachableSpaceIds(plan, ports, from);
  return Object.freeze(SPACE_IDS.filter((id) => reachable.has(id)).map((id) => getSpace(plan, id)));
}

/**
 * The walkable rooms of this floor, resolved once at module level.
 *
 * The access graph's edges are undirected and the floored plan is one connected component
 * (`reachability.test.ts` asserts both), so this is the same list wherever the viewer stands
 * — and that stability is the point. A menu whose items appeared and vanished as the viewer
 * walked would move focus out from under the keyboard and change what a screen reader has
 * just finished reading; recomputing it per pose would also re-render every subscriber for
 * an answer that never changes.
 */
export const ROOM_TARGETS: readonly Space[] = getRoomTargets(
  FLOOR_PLAN,
  PORT_SCHEDULE,
  STAIRS_ARRIVAL_POINT,
);
