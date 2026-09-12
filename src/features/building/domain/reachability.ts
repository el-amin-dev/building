/**
 * Reachability on the floor: which spaces an explorer can walk to from a point,
 * and which spaces to walk through to get to one of them.
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
 * Both answers come from one walk of that graph, `walkFromSpace`, and one
 * definition of "one step", `getStepNeighbours`. That is deliberate: a second
 * module re-deriving the edge rule would be a second derivation with a detector
 * of its own, which is exactly what ADR-012 records the cost of. A route and the
 * reachable set therefore cannot disagree about what an explorer can do.
 *
 * Geometry inside a space is not this module's concern: it answers in spaces,
 * not in metres. Turning a space sequence into waypoints a body can walk is
 * `roomRoute.ts`'s job.
 *
 * The functions are pure: they read the plan and the schedule and never mutate
 * them. They assume both are valid (`validateFloorPlan`, `validatePorts`).
 */
import { findSpaceAt, getNeighbours, getSpace, hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, Space, SpaceId } from './floorPlan/index.ts';
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
 * Walks the access graph breadth-first from one space and records, for each
 * space it reaches, the space it was first reached from.
 *
 * The single walk behind both public answers: {@link getReachableSpaceIds} reads
 * the keys, {@link findSpaceRoute} follows the values back. Both edge kinds are
 * undirected, so the keys are the whole connected component of the start space.
 *
 * A `Map` keeps insertion order, which gives the walk its two guarantees: the
 * keys come out in breadth-first discovery order, and the predecessor of a space
 * is the first one discovered for it — the tie-break between two routes of the
 * same length. `getStepNeighbours` fixes that order and nothing here sorts.
 *
 * @param plan - The floor plan.
 * @param ports - The port schedule placed in that plan.
 * @param startId - Identifier of the space the walk starts in; the callers are
 *   what guarantee it has a floor.
 * @returns A map from each reached space to the space it was first stepped into
 *   from, in discovery order. The start space is the first key and maps to
 *   `undefined`, which is what ends a walk back.
 */
function walkFromSpace(
  plan: FloorPlan,
  ports: readonly Port[],
  startId: SpaceId,
): ReadonlyMap<SpaceId, SpaceId | undefined> {
  const cameFrom = new Map<SpaceId, SpaceId | undefined>([[startId, undefined]]);
  const queue: SpaceId[] = [startId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    for (const neighbourId of getStepNeighbours(plan, ports, id)) {
      if (!cameFrom.has(neighbourId)) {
        cameFrom.set(neighbourId, id);
        queue.push(neighbourId);
      }
    }
  }
  return cameFrom;
}

/**
 * Finds the space an explorer standing at a point walks from.
 *
 * Both rejections are shared by the two public functions, so a point that is no
 * use to one is no use to the other and both say so in the same words.
 *
 * @param plan - The floor plan.
 * @param from - Where the explorer stands, in plan coordinates.
 * @returns The space of the plan containing the point.
 * @throws RangeError naming the point when it lies in no space of the plan — a
 *   wall, a gap between spaces, or outside the plot — or when the space it lies
 *   in has no floor to walk on.
 */
function getStartSpace(plan: FloorPlan, from: PlanPoint): Space {
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
  return start;
}

/**
 * The answer when there is no way to walk to the target: no spaces to cross.
 *
 * "That room cannot be reached from here" is an ordinary answer to a menu pick,
 * the way `findSpaceAt` returning `undefined` is ordinary, so it is a value and
 * not a throw. Frozen and shared: a route is read, never appended to.
 */
const NO_ROUTE: readonly SpaceId[] = Object.freeze([]);

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
  const reached = walkFromSpace(plan, ports, getStartSpace(plan, from).id);
  return Object.freeze(new Set(reached.keys()));
}

/**
 * Finds the spaces to walk through, in order, from a point to a target space.
 *
 * Follows the predecessors of the same walk {@link getReachableSpaceIds} reports,
 * so a route exists exactly when the target is in the reachable set, and every
 * step of it is one step of the access graph: a port naming both spaces, or a
 * zero-gap join, with a floor at both ends.
 *
 * The route is the one crossing the fewest spaces, not the shortest in metres: a
 * distance-weighted route would need a cost model of doorway positions and
 * walking lines that nothing on this floor asks for. Among routes of equal
 * length, the first predecessor discovered wins — see {@link walkFromSpace}.
 *
 * @param plan - The floor plan.
 * @param ports - The port schedule placed in that plan.
 * @param from - Where the explorer starts, in plan coordinates.
 * @param toId - Identifier of the space to walk to.
 * @returns A frozen space sequence, starting with the space containing `from`
 *   and ending with `toId`; a single-element route when `from` is already in
 *   `toId`; an empty array when no route exists, which includes a `toId` with no
 *   floor to stand on.
 * @throws RangeError naming the point when it lies in no space of the plan or in
 *   a floorless one, and naming the id when `toId` is not a space of the plan.
 *   `SpaceId` is a literal union, so an unknown id can only be a caller's bug
 *   and must not read as a room that cannot be reached.
 */
export function findSpaceRoute(
  plan: FloorPlan,
  ports: readonly Port[],
  from: PlanPoint,
  toId: SpaceId,
): readonly SpaceId[] {
  const startId = getStartSpace(plan, from).id;
  if (!hasFloor(getSpace(plan, toId).kind)) {
    return NO_ROUTE;
  }
  const cameFrom = walkFromSpace(plan, ports, startId);
  if (!cameFrom.has(toId)) {
    return NO_ROUTE;
  }
  const backwards: SpaceId[] = [];
  for (let step: SpaceId | undefined = toId; step !== undefined; step = cameFrom.get(step)) {
    backwards.push(step);
  }
  return Object.freeze(backwards.reverse());
}
