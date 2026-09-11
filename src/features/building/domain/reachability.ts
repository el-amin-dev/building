/**
 * Reachability on the floor: which spaces an explorer can walk to from a point.
 *
 * The access graph has two kinds of edge (brief §6, ADR-006):
 * - a **port**, the door or opening of the schedule, between two spaces that
 *   both have a floor;
 * - a **zero-gap join**, where two spaces that both have a floor meet with no
 *   wall between them, as the stairs and the corridor do (brief §4.2).
 *
 * Requiring a floor on both ends of every edge is what keeps the side-B balcony
 * slab from leaking into the two voids: the slab and the voids are one open-air
 * strip with no wall between them (brief §5.2), but a void has no floor to
 * stand on.
 *
 * The functions are pure: they read the plan and the schedule and never mutate
 * them. They assume both are valid (`validateFloorPlan`, `validatePorts`).
 */
import { findSpaceAt, getNeighbours, getSpace, hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { LENGTH_TOLERANCE } from './planGeometry.ts';
import type { PlanPoint } from './planGeometry.ts';
import { getPortPartners } from './ports/index.ts';
import type { Port } from './ports/index.ts';

/**
 * Lists the spaces an explorer standing in one space can step into.
 *
 * @param plan - The floor plan.
 * @param ports - The port schedule.
 * @param id - Identifier of the space the explorer stands in.
 * @returns The ids reachable in one step, ports first then zero-gap joins,
 *   keeping only spaces that have a floor. Ids may repeat.
 */
function getStepNeighbours(
  plan: FloorPlan,
  ports: readonly Port[],
  id: SpaceId,
): readonly SpaceId[] {
  const throughJoins = getNeighbours(plan, id)
    .filter((contact) => contact.gap <= LENGTH_TOLERANCE)
    .map((contact) => contact.neighbourId);
  return [...getPortPartners(ports, id), ...throughJoins].filter((neighbourId) =>
    hasFloor(getSpace(plan, neighbourId).kind),
  );
}

/**
 * Lists every space reachable on foot from a point of the plan.
 *
 * Walks the access graph breadth-first from the space containing `from`, so the
 * start space is always in the result. Both edge kinds are undirected, which
 * makes the result the whole connected component of the start space.
 *
 * @param plan - The floor plan.
 * @param ports - The port schedule placed in that plan.
 * @param from - Where the explorer starts, in plan coordinates.
 * @returns A frozen set of the reachable ids, in breadth-first order from the
 *   start space. The `ReadonlySet` type is what forbids mutation: freezing a
 *   `Set` only blocks added properties, not `add`.
 * @throws RangeError naming the point when it lies in no space of the plan — a
 *   wall, a gap between spaces, or outside the plot — or when the space it lies
 *   in has no floor to walk on.
 */
export function getReachableSpaceIds(
  plan: FloorPlan,
  ports: readonly Port[],
  from: PlanPoint,
): ReadonlySet<SpaceId> {
  const where = `(x ${String(from.x)}, z ${String(from.z)})`;
  const start = findSpaceAt(plan, from);
  if (start === undefined) {
    throw new RangeError(
      `the point ${where} lies in no space of the plan: it is inside a wall, in a gap between spaces, or outside the plot`,
    );
  }
  if (!hasFloor(start.kind)) {
    throw new RangeError(
      `the point ${where} lies in "${start.id}", which is a "${start.kind}" with no floor to walk on`,
    );
  }
  const reached = new Set<SpaceId>([start.id]);
  const queue: SpaceId[] = [start.id];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbourId of getStepNeighbours(plan, ports, queue[cursor])) {
      if (!reached.has(neighbourId)) {
        reached.add(neighbourId);
        queue.push(neighbourId);
      }
    }
  }
  return Object.freeze(reached);
}
