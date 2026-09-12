/**
 * The windows of the typical floor: the declared schedule, validated and turned
 * into holes in the walls.
 *
 * v1 derived the windows: one 1.20 × 1.20 opening per room per glazeable face,
 * centred in the longest run the doors left free (ADR-006). That rule could only
 * ever produce one kind of window, and it cannot say what the owner now wants —
 * a hand-through to the guests at counter height, ventilation slots above eye
 * level in the wet cubicles, a 1.70 m tall run of glazing in the laundry, and
 * deliberately nothing at all in the master bedroom. So the schedule is declared
 * in `WINDOWS` (`sourceOfTruth/plan.ts`), each window carrying its own `kind`,
 * `sill` and `head`, and this module no longer chooses positions.
 *
 * What it does instead is check the schedule against the plan and realise it:
 *
 * - each window must sit in a real wall shared by the two spaces it names: a
 *   face-to-face contact between them, on the axis the window runs along, with
 *   solid wall between the two rooms rather than a continuous floor;
 * - it must lie inside that shared stretch with a jamb of at least
 *   {@link WINDOW_SPEC}'s `minJamb` at each end, and keep `minClearance` of wall
 *   between itself and any door or other window in the same face. Those are the
 *   0.05 and 0.10 of check 4 of the reference verifier
 *   (`scripts/source-of-truth/verify.mjs`);
 * - a window for daylight or for air must face open air — a balcony or a void.
 *   That is what is left of the old exposed-face rule: it no longer picks where
 *   glazing goes, but it still refuses a window that would look into another
 *   room. A `pass` window is the exception and is interior by nature: the
 *   owner's tunnel from the guest room to the kitchen is a hole between two
 *   rooms on purpose;
 * - the opening itself is the old geometry, unchanged: the window span across the
 *   full thickness of the wall it pierces, from its sill up to its head.
 *
 * Sill and head are per window now, not one pair of constants for the floor.
 * `FloorHeights` therefore carries no window sill or head at all: those fields
 * existed only for the old uniform windows and have been removed. The heights
 * are still taken as an argument, and still used: a window must fit under
 * `heights.wall`.
 *
 * Coordinates are in metres, with the plan conventions of `floorPlan/types.ts`.
 */

import { getNeighbours } from './floorPlan/index.ts';
import type { FloorPlan, Space, SpaceContact, SpaceId, SpaceKind } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect, toPlanLength } from './planGeometry.ts';
import type { PlanRect, RectSide } from './planGeometry.ts';
import type { Port, PortAxis } from './ports/types.ts';
import { WINDOWS } from './sourceOfTruth/plan.ts';
import type { PlanWindow, PlanWindowKind } from './sourceOfTruth/plan.ts';

/** What a window is for, which fixes its sill and its head (`sourceOfTruth/plan.ts`). */
export type WindowKind = PlanWindowKind;

/**
 * The face of a room a window sits in.
 *
 * Any of the four, unlike v1's `'minX' | 'maxZ'`: the declared schedule glazes
 * the wet cubicles toward the side-B voids, the utility room through its west
 * wall and the guest room through its east one, so the side is read off the
 * contact the window is found in rather than restricted up front.
 */
export type WindowSide = RectSide;

/** The wall a window must keep around itself, in metres. */
export interface WindowSpec {
  /**
   * Smallest solid wall between a window and the end of the stretch of wall it
   * sits in, in metres (check 4: 0.05).
   */
  readonly minJamb: 0.05;
  /**
   * Smallest solid wall between a window and another opening of the same face,
   * in metres (check 4: 0.10).
   */
  readonly minClearance: 0.1;
}

/**
 * The wall a window keeps around itself (check 4 of the reference verifier).
 * Frozen.
 *
 * No width and no height here any more: every window declares its own `width`,
 * `sill` and `head` in the schedule, because they differ by kind.
 */
export const WINDOW_SPEC: WindowSpec = Object.freeze({ minJamb: 0.05, minClearance: 0.1 });

/** The kinds of space a window may look out onto: both are open to the weather. */
const OPEN_AIR_KINDS: readonly SpaceKind[] = Object.freeze(['openAir', 'void']);

/**
 * The kind of window that is allowed to look into another room rather than at
 * open air: the owner's tunnel for food and coffee.
 */
const INTERIOR_WINDOW_KIND: WindowKind = 'pass';

/** One window of the floor, as the schedule declares it and the plan places it. */
export interface FloorWindow {
  /** What the window is for. */
  readonly kind: WindowKind;
  /** The space the window is measured from: the first of the schedule's pair. */
  readonly spaceId: SpaceId;
  /** The space on the other side of the wall. */
  readonly neighbourId: SpaceId;
  /** Which face of {@link FloorWindow.spaceId} the window sits in. */
  readonly side: WindowSide;
  /** The plan axis the window's width runs along. */
  readonly along: PortAxis;
  /**
   * Start of the window along its face, in metres: a z coordinate in a `minX` or
   * `maxX` face, an x coordinate in a `minZ` or `maxZ` face.
   */
  readonly spanMin: number;
  /** End of the window along its face, `spanMin + width`, in metres. */
  readonly spanMax: number;
  /** Height of the sill above the finished floor, in metres. */
  readonly sill: number;
  /** Height of the head above the finished floor, in metres. */
  readonly head: number;
  /**
   * The hole in the wall: the window span across the full thickness of the wall
   * it pierces, from its own sill up to its own head.
   */
  readonly opening: PlanBox;
}

/** A closed interval along one face of a rect, in metres. */
interface Span {
  /** Start of the interval, in metres. */
  readonly min: number;
  /** End of the interval, in metres. */
  readonly max: number;
}

/** The schedule, in the order the windows are reported. */
const DECLARED_WINDOWS: readonly PlanWindow[] = WINDOWS;

/**
 * Returns the faces a window running along an axis can sit in.
 *
 * A window whose width runs along x pierces a wall that faces z, and the other
 * way round.
 *
 * @param along - The axis the window's width runs along.
 * @returns The two faces of a rect that such a window can sit in.
 */
function facesForAxis(along: PortAxis): readonly RectSide[] {
  return along === 'x' ? ['minZ', 'maxZ'] : ['minX', 'maxX'];
}

/**
 * Returns the coordinate of one face of a rectangle.
 *
 * @param rect - The rectangle.
 * @param side - Which face to locate.
 * @returns The x of a `minX`/`maxX` face, the z of a `minZ`/`maxZ` face, in metres.
 */
function faceCoordinate(rect: PlanRect, side: RectSide): number {
  switch (side) {
    case 'minX':
      return rect.minX;
    case 'maxX':
      return rect.maxX;
    case 'minZ':
      return rect.minZ;
    default:
      return rect.maxZ;
  }
}

/**
 * Returns the space with the given id, looked up by its written id.
 *
 * The schedule's ids are the source of truth's room ids, which are the same
 * strings as the plan's `SpaceId`s but a type of their own; the lookup compares
 * the strings so neither module has to know the other's union.
 *
 * @param plan - The floor plan to search.
 * @param id - Identifier of the space, as the schedule writes it.
 * @returns The space of the plan.
 * @throws RangeError naming the id when the plan has no such space.
 */
function findSpace(plan: FloorPlan, id: string): Space {
  const space = plan.spaces.find((candidate) => candidate.id === id);
  if (space === undefined) {
    throw new RangeError(`the floor plan has no space with id "${id}" to glaze`);
  }
  return space;
}

/**
 * Finds the stretch of wall a declared window sits in.
 *
 * The window must lie inside one face-to-face contact between its two spaces,
 * with a jamb at each end, and that contact must have a wall in it: two floors
 * meeting with no wall between them (a zero join, such as the stair landing and
 * the corridor) have nothing to glaze.
 *
 * @param plan - The floor plan.
 * @param space - The space the window is measured from.
 * @param neighbour - The space on the other side.
 * @param along - The axis the window's width runs along.
 * @param span - The window span along its face, in metres.
 * @returns The contact the window sits in.
 * @throws RangeError naming the window's spaces and span when no contact holds
 *   it, when the only contact that does has no wall, or when the jambs are too
 *   small.
 */
function findHostContact(
  plan: FloorPlan,
  space: Space,
  neighbour: Space,
  along: PortAxis,
  span: Span,
): SpaceContact {
  const faces = facesForAxis(along);
  const between = `${space.id} ↔ ${neighbour.id} ${String(span.min)}–${String(span.max)}`;
  const candidates = getNeighbours(plan, space.id).filter(
    (contact) => contact.neighbourId === neighbour.id && faces.includes(contact.side),
  );
  if (candidates.length === 0) {
    throw new RangeError(
      `window ${between} names no wall: "${space.id}" and "${neighbour.id}" do not face each other along ${along}`,
    );
  }

  const holding = candidates.filter(
    (contact) =>
      span.min >= contact.spanMin + WINDOW_SPEC.minJamb - LENGTH_TOLERANCE &&
      span.max <= contact.spanMax - WINDOW_SPEC.minJamb + LENGTH_TOLERANCE,
  );
  const [host] = holding.filter((contact) => contact.gap > LENGTH_TOLERANCE);
  if (host !== undefined) {
    return host;
  }
  if (holding.length > 0) {
    throw new RangeError(
      `window ${between} sits in a join of no thickness: "${space.id}" and "${neighbour.id}" meet with no wall to glaze`,
    );
  }
  const reach = candidates
    .map((contact) => `${String(contact.spanMin)}–${String(contact.spanMax)}`)
    .join(', ');
  throw new RangeError(
    `window ${between} does not fit in the wall "${space.id}" shares with "${neighbour.id}" (${reach}) with a ${String(WINDOW_SPEC.minJamb)} jamb at each end`,
  );
}

/**
 * Checks that a window of the given kind may look at what is across its wall.
 *
 * @param kind - What the window is for.
 * @param space - The space the window is measured from.
 * @param neighbour - The space on the other side.
 * @throws RangeError naming the two spaces when a window for daylight or air
 *   would look into another room instead of at open air.
 */
function validateExposure(kind: WindowKind, space: Space, neighbour: Space): void {
  if (kind === INTERIOR_WINDOW_KIND || OPEN_AIR_KINDS.includes(neighbour.kind)) {
    return;
  }
  throw new RangeError(
    `the "${kind}" window between "${space.id}" and "${neighbour.id}" faces a space of kind "${neighbour.kind}", not open air; only a "${INTERIOR_WINDOW_KIND}" window may look into another room`,
  );
}

/**
 * Checks that a window fits between the finished floor and the top of its wall.
 *
 * @param declared - The declared window.
 * @param heights - Vertical sizes of the floor.
 * @throws RangeError naming the offending level when the sill is below the floor,
 *   the head is not above the sill, or the head is above the wall.
 */
function validateLevels(declared: PlanWindow, heights: FloorHeights): void {
  const where = `${declared.between[0]} ↔ ${declared.between[1]}`;
  if (!Number.isFinite(declared.sill) || declared.sill < -LENGTH_TOLERANCE) {
    throw new RangeError(`window ${where} has a sill of ${String(declared.sill)}, below the floor`);
  }
  if (declared.head - declared.sill <= LENGTH_TOLERANCE) {
    throw new RangeError(
      `window ${where} has a head of ${String(declared.head)} that is not above its sill of ${String(declared.sill)}`,
    );
  }
  if (declared.head > heights.wall + LENGTH_TOLERANCE) {
    throw new RangeError(
      `window ${where} has a head of ${String(declared.head)}, above the ${String(heights.wall)} wall it pierces`,
    );
  }
}

/**
 * Lists the spans of one face of a space that another opening already occupies.
 *
 * Only openings in the same face count, which is what keeps the guest room's
 * balcony door out of the way of its kitchen tunnel: the two run along the same
 * axis over the very same z, but they are in opposite walls of the room. A port
 * is in the face when it runs along the same axis and its other space is a
 * neighbour across that face; a window when the schedule puts it in the same
 * space and the same face.
 *
 * @param plan - The floor plan.
 * @param space - The space whose face is inspected.
 * @param side - Which face of the space.
 * @param along - The axis openings in that face run along.
 * @param ports - The port schedule of the floor.
 * @param others - The other declared windows, with the window itself left out.
 * @returns The occupied spans, each labelled for the error message.
 */
function findFaceOpenings(
  plan: FloorPlan,
  space: Space,
  side: RectSide,
  along: PortAxis,
  ports: readonly Port[],
  others: readonly PlanWindow[],
): readonly { readonly label: string; readonly span: Span }[] {
  const faceNeighbours = new Set(
    getNeighbours(plan, space.id)
      .filter((contact) => contact.side === side)
      .map((contact) => contact.neighbourId),
  );
  const fromPorts = ports.flatMap((port) => {
    const [first, second] = port.spaces;
    const other = first === space.id ? second : first;
    if (port.along !== along || !port.spaces.includes(space.id) || !faceNeighbours.has(other)) {
      return [];
    }
    return [
      {
        label: `the ${port.kind} to ${other}`,
        span: { min: port.spanMin, max: toPlanLength(port.spanMin + port.width) },
      },
    ];
  });
  const fromWindows = others.flatMap((other) => {
    const [first, second] = other.between;
    const across = first === space.id ? second : first;
    if (other.along !== along || !other.between.includes(space.id) || !faceNeighbours.has(across)) {
      return [];
    }
    return [
      {
        label: `the ${other.kind} window to ${across}`,
        span: { min: other.spanMin, max: toPlanLength(other.spanMin + other.width) },
      },
    ];
  });
  return [...fromPorts, ...fromWindows];
}

/**
 * Checks that a window keeps its clearance from every other opening of its face.
 *
 * @param space - The space the window is measured from.
 * @param span - The window span along its face, in metres.
 * @param openings - The other openings of the same face.
 * @throws RangeError naming both openings when they overlap or come closer than
 *   {@link WINDOW_SPEC}'s `minClearance`.
 */
function validateClearance(
  space: Space,
  span: Span,
  openings: readonly { readonly label: string; readonly span: Span }[],
): void {
  openings.forEach((opening) => {
    const gap = Math.max(opening.span.min - span.max, span.min - opening.span.max);
    if (gap < WINDOW_SPEC.minClearance - LENGTH_TOLERANCE) {
      throw new RangeError(
        `the window at ${String(span.min)}–${String(span.max)} in the "${space.id}" wall leaves ${String(toPlanLength(gap))} to ${opening.label} at ${String(opening.span.min)}–${String(opening.span.max)}, less than the ${String(WINDOW_SPEC.minClearance)} needed`,
      );
    }
  });
}

/**
 * Builds the hole a window makes in its wall.
 *
 * @param side - Which face the window is in.
 * @param faceAt - Coordinate of that face, in metres.
 * @param thickness - Thickness of the wall the window pierces, in metres.
 * @param span - The window span along the face, in metres.
 * @param sill - Level of the bottom of the opening, in metres.
 * @param head - Level of its top, in metres.
 * @returns A frozen box: the span across the whole wall thickness, from the sill
 *   to the head.
 */
function makeOpening(
  side: RectSide,
  faceAt: number,
  thickness: number,
  span: Span,
  sill: number,
  head: number,
): PlanBox {
  const near = toPlanLength(faceAt - thickness);
  const far = toPlanLength(faceAt + thickness);
  const rect =
    side === 'minX'
      ? makeRect(near, faceAt, span.min, span.max)
      : side === 'maxX'
        ? makeRect(faceAt, far, span.min, span.max)
        : side === 'minZ'
          ? makeRect(span.min, span.max, near, faceAt)
          : makeRect(span.min, span.max, faceAt, far);
  return makeBox(rect, sill, head);
}

/**
 * Places one declared window in the plan.
 *
 * @param plan - The floor plan.
 * @param declared - The window as the schedule declares it.
 * @param ports - The port schedule of the floor.
 * @param others - The other declared windows.
 * @param heights - Vertical sizes of the floor.
 * @returns The frozen window, with the hole it cuts.
 * @throws RangeError naming the window when the plan cannot host it (see
 *   `findHostContact`, `validateExposure`, `validateLevels` and
 *   `validateClearance`).
 */
function placeWindow(
  plan: FloorPlan,
  declared: PlanWindow,
  ports: readonly Port[],
  others: readonly PlanWindow[],
  heights: FloorHeights,
): FloorWindow {
  const [spaceId, neighbourId] = declared.between;
  const space = findSpace(plan, spaceId);
  const neighbour = findSpace(plan, neighbourId);
  const span: Span = {
    min: declared.spanMin,
    max: toPlanLength(declared.spanMin + declared.width),
  };

  validateLevels(declared, heights);
  validateExposure(declared.kind, space, neighbour);
  const host = findHostContact(plan, space, neighbour, declared.along, span);
  validateClearance(
    space,
    span,
    findFaceOpenings(plan, space, host.side, declared.along, ports, others),
  );

  const rect = space.rects[host.rectIndex];
  if (rect === undefined) {
    throw new RangeError(
      `the "${space.id}" space has no rect ${String(host.rectIndex)} to carry its window`,
    );
  }
  return Object.freeze({
    kind: declared.kind,
    spaceId: space.id,
    neighbourId: neighbour.id,
    side: host.side,
    along: declared.along,
    spanMin: span.min,
    spanMax: span.max,
    sill: declared.sill,
    head: declared.head,
    opening: makeOpening(
      host.side,
      faceCoordinate(rect, host.side),
      host.gap,
      span,
      declared.sill,
      declared.head,
    ),
  });
}

/**
 * Realises every window of the floor from the declared schedule.
 *
 * Nothing is derived and nothing is skipped: every window of `WINDOWS` is placed
 * or the call fails. A room has as many windows as the owner asked for — two in
 * the kitchen, one in each wet cubicle, none at all in the master bedroom
 * (owner) — and the result follows the schedule's order.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param ports - The port schedule of the floor, whose doors the windows keep
 *   their clearance from. Not mutated.
 * @param heights - Vertical sizes of the floor; defaults to `FLOOR_HEIGHTS`.
 *   Only `wall` is read: each window carries its own sill and head.
 * @returns A frozen array of frozen windows, in schedule order.
 * @throws RangeError naming the offending window when the plan cannot host it:
 *   an unknown space, no shared wall on the declared axis, a wall too short for
 *   the window and its jambs, a join with no wall in it, a daylight or air
 *   window facing another room, an opening too close to a door or another
 *   window, or a sill and head that do not fit under the wall.
 */
export function getWindows(
  plan: FloorPlan,
  ports: readonly Port[],
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly FloorWindow[] {
  return Object.freeze(
    DECLARED_WINDOWS.map((declared, index) =>
      placeWindow(
        plan,
        declared,
        ports,
        DECLARED_WINDOWS.filter((_other, otherIndex) => otherIndex !== index),
        heights,
      ),
    ),
  );
}
