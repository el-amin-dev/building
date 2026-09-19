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
import { getClearanceRect, getSwingRect } from '../swingClearance.ts';
import type { ClearanceFace } from '../swingClearance.ts';
import type { Port, PortAxis } from './types.ts';

/**
 * Level of the bottom of every port, in metres above the finished floor: a port
 * starts at the floor and rises to `FloorHeights.door`, the door head of the
 * source of truth (`sourceOfTruth/plan.ts`, `HEIGHTS.door`).
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
 * spaces touches on both axes, as corridor ↔ kitchen, controlCenter ↔ guestRoom
 * and guestRoom ↔ guestSanitair do.
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
 * The depth is that single gap, which is only right while the wall is one
 * thickness across the port. A wall face can now be two thicknesses along its
 * length, so that is a real assumption rather than a given; `validatePorts`
 * rejects a port that crosses a change of thickness, using
 * {@link getPortThicknesses}, so nothing reaches here with an ambiguous depth.
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
 * Lists the distinct wall thicknesses a port crosses, thinnest first.
 *
 * A wall between two spaces is not one number along its length any more. The
 * owner's isolation is built as width, so a face runs 0.30 where it backs onto a
 * weather-exposed or isolated space and 0.15 where it backs onto an ordinary
 * one; `scripts/source-of-truth/walls.mjs` models that by tiling each face with
 * a `contacts` list, one stretch per thickness. This is the same idea asked of
 * one port: every contact between the two spaces that runs along the port's axis
 * and genuinely overlaps its span, reduced to the thicknesses found there.
 *
 * One value is the normal answer, and the only one an opening can be cut at —
 * see {@link getPortOpening}. Two or more means the port is drawn across a step
 * in the wall, which `validatePorts` rejects.
 *
 * @param plan - The floor plan holding the two spaces.
 * @param port - The port to measure.
 * @returns A frozen, ascending array of the distinct gaps, in metres; empty when
 *   nothing of the second space faces the port span along its axis.
 * @throws RangeError naming the id when either space is missing from the plan.
 */
export function getPortThicknesses(plan: FloorPlan, port: Port): readonly number[] {
  const [first, second] = port.spaces;
  const [spanMin, spanMax] = getPortSpan(port);
  const gaps = getNeighbours(plan, first)
    .filter(
      (contact) =>
        contact.neighbourId === second &&
        getContactAxis(contact.side) === port.along &&
        Math.min(contact.spanMax, spanMax) - Math.max(contact.spanMin, spanMin) > LENGTH_TOLERANCE,
    )
    .map((contact) => contact.gap);
  return Object.freeze([...new Set(gaps)].sort((a, b) => a - b));
}

/**
 * Tells whether a port needs clear floor for its leaf to open into.
 *
 * The single place this exemption is decided, so that no check has to re-derive
 * it and none can skip a door by accident. Two ports need no clearance:
 *
 * - an `opening` has no leaf at all — the living-room opening faces the
 *   television across the corridor on purpose, and swinging a leaf that does not
 *   exist would condemn the one arrangement the owner asked for by name;
 * - a leaf that slides needs no floor to open into, which is the whole reason
 *   the plan gives five of them a `swing` of `'slide'`: a bathroom whose open
 *   part is 0.55 m deep cannot have a leaf swing into it.
 *
 * A caller that exempts a port must say so out loud — name it and the reason —
 * rather than passing it silently, the way `verify.mjs` step 9 lists every
 * exempt door after running the swing test.
 *
 * @param port - The port to judge.
 * @returns `true` when the port is a door whose leaf swings, and so needs a
 *   clear rectangle of floor; `false` for an opening and for a sliding leaf.
 */
export function needsSwingClearance(port: Port): boolean {
  return port.kind === 'door' && port.swing !== 'slide';
}

/**
 * The face a rect turns towards the space on the other side of it.
 *
 * A {@link SpaceContact} names the face of the QUERIED space's rect; the
 * neighbour's rect faces it back across the wall, on the opposite face. Written
 * as a total record so a new {@link RectSide} cannot be added without answering
 * this question.
 */
const FACING_SIDE: Readonly<Record<RectSide, RectSide>> = Object.freeze({
  minX: 'maxX',
  maxX: 'minX',
  minZ: 'maxZ',
  maxZ: 'minZ',
});

/**
 * Describes the opening of a port as a face of one of its two spaces.
 *
 * The face is taken from the contact {@link getPortContact} resolves, which is
 * the single place the shared wall and its side are worked out: for
 * `port.spaces[0]` that is the contact's own side, on the contact's own rect;
 * for `port.spaces[1]` it is the facing side, on the neighbour rect the contact
 * names. The span is the port's, unchanged — a port covers the same interval
 * along the wall from either room.
 *
 * @param plan - The floor plan holding the two spaces.
 * @param port - The port to describe.
 * @param id - Identifier of the space to describe it from.
 * @returns The face, or `undefined` when the port does not name `id`.
 * @throws RangeError naming the pair when {@link getPortContact} does not find
 *   exactly one contact, or naming the id when a space is missing from the plan.
 */
function getPortFace(plan: FloorPlan, port: Port, id: SpaceId): ClearanceFace | undefined {
  const [first, second] = port.spaces;
  if (id !== first && id !== second) {
    return undefined;
  }
  const contact = getPortContact(plan, port);
  const side = id === first ? contact.side : FACING_SIDE[contact.side];
  const rectIndex = id === first ? contact.rectIndex : contact.neighbourRectIndex;
  const rect = getSpace(plan, id).rects[rectIndex];
  return { side, at: rect[side], spanMin: port.spanMin, width: port.width };
}

/**
 * Returns the floor a door's leaf needs inside one space, or `undefined` where
 * it needs none.
 *
 * The rectangle is the leaf's own width square, measured inward from the face
 * the leaf is hung in — {@link getSwingRect}, the same derivation
 * `scripts/source-of-truth/verify.mjs` check 9 runs off the derived walls.
 *
 * Which ports need floor at all is not decided here: that is
 * {@link needsSwingClearance}, the single place the exemption lives, so an
 * `opening` (the leafless living-room one) and a sliding leaf both return
 * `undefined` rather than a rectangle nothing will ever sweep.
 *
 * **Both faces, for a leaf whose `swing` is absent.** Absent means the leaf
 * swings, and nothing in the schedule says WHICH room it swings into — "'out' of
 * WHICH room? `between` is a pair, not a direction", as check 9 puts it. So the
 * conservative reading of the verifier is matched exactly: the leaf is treated
 * as swinging inward on both faces, and this query answers with a rectangle for
 * each of the port's two spaces. A caller that knows better must say which room
 * it means; it cannot learn it from here.
 *
 * @param plan - The floor plan holding the two spaces.
 * @param port - The port whose leaf is asked about.
 * @param id - Identifier of the space the leaf would swing into.
 * @returns A frozen {@link PlanRect} `port.width` wide and `port.width` deep, or
 *   `undefined` when the port does not name `id`, when its leaf slides, or when
 *   it is a leafless `opening`.
 * @throws RangeError naming the pair when {@link getPortContact} does not find
 *   exactly one contact, or naming the id when a space is missing from the plan.
 */
export function getSwingClearance(plan: FloorPlan, port: Port, id: SpaceId): PlanRect | undefined {
  if (!needsSwingClearance(port)) {
    return undefined;
  }
  const face = getPortFace(plan, port, id);
  return face === undefined ? undefined : getSwingRect(face);
}

/**
 * Lists every swing rectangle inside one space, in schedule order.
 *
 * The ports of the space that need no floor — its sliding leaves and the
 * living-room opening — are absent rather than present and empty, so the length
 * of the result is the number of leaves that can actually sweep this floor.
 *
 * @param plan - The floor plan holding the space.
 * @param ports - The port schedule to search.
 * @param id - Identifier of the space.
 * @returns A frozen array of the rectangles {@link getSwingClearance} returns
 *   for the ports of `id`, in schedule order; empty when the space has no
 *   swinging leaf.
 * @throws RangeError under the same conditions as {@link getSwingClearance}.
 */
export function getSwingClearances(
  plan: FloorPlan,
  ports: readonly Port[],
  id: SpaceId,
): readonly PlanRect[] {
  const rects = getPortsOf(ports, id)
    .map((port) => getSwingClearance(plan, port, id))
    .filter((rect): rect is PlanRect => rect !== undefined);
  return Object.freeze(rects);
}

/**
 * Lists the floor a leafless opening needs kept clear inside one space, to a
 * stated depth.
 *
 * An opening sweeps nothing, so it has no swing rectangle and no width to use as
 * a depth; what it needs is a band of floor a person can walk through, and how
 * deep that band is belongs to the caller — Part 4 furnishes the floor with
 * 0.60 m. The living-room opening is the only one of the floor, and the
 * television across the corridor stands clear of its corridor-side band on
 * purpose (`sourceOfTruth/plan.ts`, `FIXTURES`), which is why this is a query
 * and not a rule.
 *
 * @param plan - The floor plan holding the space.
 * @param ports - The port schedule to search.
 * @param id - Identifier of the space.
 * @param depth - How far into the space the floor must stay clear, in metres.
 * @returns A frozen array of the bands of the leafless openings of `id`, in
 *   schedule order; empty when the space has none, in which case `depth` is
 *   never read.
 * @throws RangeError when `depth` is not a finite positive number
 *   ({@link getClearanceRect}), when {@link getPortContact} does not find
 *   exactly one contact, or when a space is missing from the plan.
 */
export function getOpeningClearances(
  plan: FloorPlan,
  ports: readonly Port[],
  id: SpaceId,
  depth: number,
): readonly PlanRect[] {
  const rects = getPortsOf(ports, id)
    .filter((port) => port.kind === 'opening')
    .map((port) => getPortFace(plan, port, id))
    .filter((face): face is ClearanceFace => face !== undefined)
    .map((face) => getClearanceRect(face, depth));
  return Object.freeze(rects);
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
