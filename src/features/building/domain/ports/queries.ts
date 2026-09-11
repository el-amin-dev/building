/**
 * Read-only queries on ports: the span a port covers, the wall contact it sits
 * in, the opening it cuts in that wall, and the access graph it forms.
 *
 * Every query takes the schedule (and, where geometry is involved, the plan) as
 * a parameter and never mutates them. The queries assume a valid plan; they do
 * validate the port against the plan geometry wherever an unusable answer would
 * otherwise be returned silently (see `validatePorts` for the full check).
 */
import { FLOOR_HEIGHTS } from '../heights.ts';
import type { FloorHeights } from '../heights.ts';
import { getNeighbours, getSpace } from '../floorPlan/index.ts';
import type { FloorPlan, SpaceContact, SpaceId } from '../floorPlan/index.ts';
import { makeBox } from '../planBox.ts';
import type { PlanBox } from '../planBox.ts';
import { LENGTH_TOLERANCE, makeRect, toPlanLength } from '../planGeometry.ts';
import type { PlanRect, RectSide } from '../planGeometry.ts';
import type { Port, PortAxis } from './types.ts';

/**
 * Level of the bottom of every port, in metres above the finished floor: a port
 * starts at the floor and rises to `FloorHeights.door` (ADR-006).
 */
const FLOOR_LEVEL = 0;

/**
 * Returns the plan axis a contact's span runs along.
 *
 * A contact on the `minX` or `maxX` face of a rect has its span along z, one on
 * the `minZ` or `maxZ` face along x (`SpaceContact.spanMin`).
 *
 * @param side - Face of the queried space's rect that faces the neighbour.
 * @returns `'z'` for the x faces, `'x'` for the z faces.
 */
function getContactAxis(side: RectSide): PortAxis {
  return side === 'minX' || side === 'maxX' ? 'z' : 'x';
}

/**
 * Builds the footprint of the wall a port cuts through, across the port span.
 *
 * The footprint runs from the face of the queried space's rect to the facing
 * face of the neighbour's rect, so its thickness is the contact gap, whatever
 * that gap happens to be; no coordinate is hard-coded.
 *
 * @param side - Face of the queried space's rect that faces the neighbour.
 * @param rect - Rect of the queried space named by the contact.
 * @param neighbourRect - Rect of the neighbouring space named by the contact.
 * @param spanMin - Start of the port along the face, in metres.
 * @param spanMax - End of the port along the face, in metres.
 * @returns A frozen rectangle covering the wall between the two faces.
 */
function makeWallRect(
  side: RectSide,
  rect: PlanRect,
  neighbourRect: PlanRect,
  spanMin: number,
  spanMax: number,
): PlanRect {
  switch (side) {
    case 'minX':
      return makeRect(neighbourRect.maxX, rect.minX, spanMin, spanMax);
    case 'maxX':
      return makeRect(rect.maxX, neighbourRect.minX, spanMin, spanMax);
    case 'minZ':
      return makeRect(spanMin, spanMax, neighbourRect.maxZ, rect.minZ);
    case 'maxZ':
      return makeRect(spanMin, spanMax, rect.maxZ, neighbourRect.minZ);
  }
}

/**
 * Returns the interval a port covers along its own axis.
 *
 * @param port - The port to measure.
 * @returns `[spanMin, spanMin + width]`, the end snapped to the centimetre plan
 *   grid so that sums of grid values compare exactly.
 */
export function getPortSpan(port: Port): readonly [number, number] {
  return [port.spanMin, toPlanLength(port.spanMin + port.width)];
}

/**
 * Finds the wall contact a port sits in.
 *
 * Among the contacts of the port's first space, keeps those that face its
 * second space, whose span runs along `port.along`, and whose span contains the
 * whole port span within {@link LENGTH_TOLERANCE}. Exactly one contact must
 * remain: `port.along` is what separates the two candidates when a pair of
 * spaces touches on both axes, as guestRoom ↔ linkCorridor and
 * guestRoom ↔ guestSanitair do.
 *
 * @param plan - The floor plan holding the two spaces.
 * @param port - The port to locate.
 * @returns The matching contact, as returned by `getNeighbours` for
 *   `port.spaces[0]` (same reference).
 * @throws RangeError naming the pair, the axis and the span when the number of
 *   matching contacts is not exactly one, or when either space is missing from
 *   the plan.
 */
export function getPortContact(plan: FloorPlan, port: Port): SpaceContact {
  const [first, second] = port.spaces;
  const [spanMin, spanMax] = getPortSpan(port);
  const matches = getNeighbours(plan, first).filter(
    (contact) =>
      contact.neighbourId === second &&
      getContactAxis(contact.side) === port.along &&
      contact.spanMin <= spanMin + LENGTH_TOLERANCE &&
      contact.spanMax >= spanMax - LENGTH_TOLERANCE,
  );
  if (matches.length !== 1) {
    throw new RangeError(
      `port "${first}" ↔ "${second}" along ${port.along} ${String(spanMin)}–${String(spanMax)} must match exactly one wall contact, matched ${String(matches.length)}`,
    );
  }
  return matches[0];
}

/**
 * Returns the opening a port cuts in the wall between its two spaces.
 *
 * The footprint spans the wall thickness — the gap of the contact found by
 * {@link getPortContact}, derived from the two rect faces — across the port
 * span. The opening starts at the finished floor and rises to `heights.door`,
 * with a lintel filling the wall above it (`types.ts`).
 *
 * @param plan - The floor plan holding the two spaces.
 * @param port - The port to cut.
 * @param heights - Vertical sizes to use; defaults to `FLOOR_HEIGHTS`.
 * @returns A frozen {@link PlanBox} from `0` to `heights.door`.
 * @throws RangeError naming the pair when {@link getPortContact} does not find
 *   exactly one contact, or when that contact has no wall to cut because its
 *   gap is zero (the stairs and the corridor join that way, brief §4.2).
 */
export function getPortOpening(
  plan: FloorPlan,
  port: Port,
  heights: FloorHeights = FLOOR_HEIGHTS,
): PlanBox {
  const [first, second] = port.spaces;
  const contact = getPortContact(plan, port);
  if (contact.gap <= LENGTH_TOLERANCE) {
    throw new RangeError(
      `port "${first}" ↔ "${second}" has no wall to cut: the two spaces join with a gap of ${String(contact.gap)} m`,
    );
  }
  const [spanMin, spanMax] = getPortSpan(port);
  const rect = getSpace(plan, first).rects[contact.rectIndex];
  const neighbourRect = getSpace(plan, second).rects[contact.neighbourRectIndex];
  return makeBox(
    makeWallRect(contact.side, rect, neighbourRect, spanMin, spanMax),
    FLOOR_LEVEL,
    heights.door,
  );
}

/**
 * Lists the ports of one space.
 *
 * @param ports - The port schedule to search.
 * @param id - Identifier of the space.
 * @returns A frozen array of the ports naming the space, in schedule order;
 *   empty when the space has none, as both voids do.
 */
export function getPortsOf(ports: readonly Port[], id: SpaceId): readonly Port[] {
  return Object.freeze(ports.filter((port) => port.spaces.includes(id)));
}

/**
 * Lists the spaces one space opens onto.
 *
 * @param ports - The port schedule to search.
 * @param id - Identifier of the space.
 * @returns A frozen array of the other space of each port of `id`, in schedule
 *   order. Ids are unique as long as the schedule holds no duplicated pair,
 *   which `validatePorts` rejects.
 */
export function getPortPartners(ports: readonly Port[], id: SpaceId): readonly SpaceId[] {
  return Object.freeze(
    getPortsOf(ports, id).map(({ spaces: [first, second] }) => (first === id ? second : first)),
  );
}
