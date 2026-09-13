/**
 * Waypoint geometry of a walk: the points a body has to pass through to follow
 * a route of spaces.
 *
 * `findSpaceRoute` (`reachability.ts`) answers "which rooms do I cross?"; this
 * module answers "where do I put my feet?". A route is taken as a parameter, so
 * the two are independent: any sequence of spaces that are genuinely connected
 * can be walked, whether it came from the access graph, a menu pick or a test.
 *
 * The rules, and why each is the rule:
 *
 * 1. **Walkable rects come from `getSlabs`, never from `space.rects`.** The slabs
 *    already answer "what floor exists at this level": for the stair bay they
 *    yield only the arrival landing, so the two flights are excluded without
 *    being named here, and a void yields nothing at all. An L-shaped space
 *    arrives as several rects, which rules 4 and 5 need.
 * 2. **A crossing is derived from the CONTACT, never from `getPortOpening`.**
 *    That query throws for a zero-gap join — the stairs and the corridor meet
 *    that way (brief §4.2) — and carries a vertical extent a walker has no use
 *    for. What is needed is the travel axis, the clear span across the passage
 *    and the two facing faces, and a contact carries all three with the wall
 *    thickness MEASURED rather than assumed.
 * 3. **Two waypoints per crossing, one each side.** A 0.30 m wall is deeper than
 *    a 0.50 m body, so a single waypoint inside the opening would leave the
 *    walker turning while straddling the jambs. Both approach points sit on the
 *    crossing centre line, which makes every crossing leg axis-aligned by
 *    construction.
 * 4. **A destination is the largest STANDING rect, not the centre of the
 *    bounding box.** Two alternatives are provably wrong on this floor: the
 *    bounding-box centre of the stair bay lands in a flight, which is a hole,
 *    and the guest room's north strip is the larger rect by plain area while
 *    being only 0.75 m deep, so a plain-area rule would put "go to the guest
 *    room" in the circulation strip rather than in the room.
 * 5. **Intra-space connectors, so no leg cuts a notch.** Legs are walked
 *    straight, so a space entered in one rect and left from another needs a
 *    waypoint on each rect boundary between the two.
 *
 * Every waypoint lands on the half-centimetre grid: each one is either the
 * midpoint of two centimetre-grid faces or a grid face inset by a distance that
 * is itself a grid value or the half of one. {@link toWaypointLength} snaps onto
 * that grid, so waypoints of equal geometry compare exactly, the way
 * `toPlanLength` does for the plan itself.
 *
 * Pure geometry, in metres, with the plan conventions of `floorPlan/types.ts`
 * (ADR-005): no rendering, no scene objects, nothing mutated.
 */
import { EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import { getNeighbours, getSpace } from './floorPlan/index.ts';
import type { FloorPlan, SpaceContact, SpaceId } from './floorPlan/index.ts';
import { LENGTH_TOLERANCE, rectContainsPoint, toPlanLength } from './planGeometry.ts';
import type { PlanPoint, PlanRect, RectSide } from './planGeometry.ts';
import { getPortContact, getPortSpan } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { getSlabs } from './slabs.ts';
import type { FloorSlab } from './slabs.ts';

/**
 * Clearance kept between the body and a wall face when it stands at an approach
 * point, in metres: 0.05, the same jamb clearance the plan leaves at its
 * narrowest door (a 0.60 m cubicle leaf for a 0.50 m body).
 */
const APPROACH_MARGIN_METRES = 0.05;

/** Tuning of the waypoint geometry. */
export interface RoomRouteConfig {
  /** Radius of the walker's body on the plan, in metres. */
  readonly bodyRadius: number;
  /** Clearance kept between the body and a wall face at an approach point, in metres. */
  readonly approachMargin: number;
}

/**
 * Default tuning of the waypoint geometry. Frozen.
 *
 * The body radius is the navigation's own, so the body that walks the waypoints
 * is the body the walls are kept clear of (`eyeNavigation.ts`); there is no
 * second radius to disagree with it.
 */
export const ROOM_ROUTE_CONFIG: RoomRouteConfig = Object.freeze({
  bodyRadius: EYE_NAVIGATION_CONFIG.bodyRadius,
  approachMargin: APPROACH_MARGIN_METRES,
});

/** Factor giving the midpoint between the two ends of an interval. */
const HALF = 0.5;
/** Radii in a diameter: the clear width and depth a body of one radius needs. */
const RADII_PER_DIAMETER = 2;
/** Half-centimetres in a centimetre: the grid resolution every waypoint lands on. */
const HALVES_PER_CENTIMETRE = 2;

/** The empty walk, for an empty route: frozen and shared, since a walk is read, never appended to. */
const NO_WAYPOINTS: readonly PlanPoint[] = Object.freeze([]);

/** One of the two plan axes (`floorPlan/types.ts`, ADR-005). */
type PlanAxis = 'x' | 'z';

/** Which way a crossing is walked along its travel axis: `1` toward increasing coordinates. */
type TravelDirection = -1 | 1;

/**
 * Snaps a waypoint coordinate onto the half-centimetre grid.
 *
 * Plan data lies on the centimetre grid, but a waypoint is regularly the
 * midpoint of two grid values, and half of an odd number of centimetres is not
 * a whole one: the guest bathroom's open part is 0.55 m deep, so its approach
 * point sits 0.275 m from the face. Snapping such a value to the centimetre grid
 * would move the body 5 mm into the wall it was inset from, and leaving it
 * unsnapped would leave `8.6 - 0.3` as 8.299999999999999. Halving is exact in
 * binary, so rounding twice the value onto the centimetre grid and halving it
 * back keeps both cases exact.
 *
 * @param value - A waypoint coordinate, in metres.
 * @returns The value rounded to the nearest half-centimetre, in metres.
 */
function toWaypointLength(value: number): number {
  return toPlanLength(value * HALVES_PER_CENTIMETRE) / HALVES_PER_CENTIMETRE;
}

/**
 * Builds a frozen waypoint from its two plan coordinates.
 *
 * @param x - Coordinate along x, in metres.
 * @param z - Coordinate along z, in metres.
 * @returns A frozen {@link PlanPoint}, both coordinates snapped onto the
 *   half-centimetre grid by {@link toWaypointLength}.
 */
function makeWaypoint(x: number, z: number): PlanPoint {
  return Object.freeze({ x: toWaypointLength(x), z: toWaypointLength(z) });
}

/**
 * Builds a frozen waypoint from a coordinate on one axis and one on the other.
 *
 * @param axis - The axis `alongValue` is measured on.
 * @param alongValue - Coordinate on `axis`, in metres.
 * @param acrossValue - Coordinate on the other axis, in metres.
 * @returns A frozen {@link PlanPoint} on the half-centimetre grid.
 */
function makeAxialWaypoint(axis: PlanAxis, alongValue: number, acrossValue: number): PlanPoint {
  return axis === 'x'
    ? makeWaypoint(alongValue, acrossValue)
    : makeWaypoint(acrossValue, alongValue);
}

/** The other plan axis. */
function crossAxis(axis: PlanAxis): PlanAxis {
  return axis === 'x' ? 'z' : 'x';
}

/**
 * Returns the extent of a rect on one axis.
 *
 * @param rect - The rect to measure.
 * @param axis - The axis to measure along.
 * @returns `[min, max]` on that axis, in metres, as stored.
 */
function rectExtent(rect: PlanRect, axis: PlanAxis): readonly [number, number] {
  return axis === 'x' ? [rect.minX, rect.maxX] : [rect.minZ, rect.maxZ];
}

/**
 * Returns one face of a rect.
 *
 * @param rect - The rect to read.
 * @param axis - The axis the face lies across.
 * @param useMax - `true` for the `max` face on that axis, `false` for the `min` face.
 * @returns The face coordinate, in metres.
 */
function rectFace(rect: PlanRect, axis: PlanAxis, useMax: boolean): number {
  const [min, max] = rectExtent(rect, axis);
  return useMax ? max : min;
}

/** Half the size of a rect on one axis, in metres. */
function halfExtent(rect: PlanRect, axis: PlanAxis): number {
  const [min, max] = rectExtent(rect, axis);
  return (max - min) * HALF;
}

/** The centre of a rect, as a frozen waypoint. */
function rectCentre(rect: PlanRect): PlanPoint {
  return makeWaypoint((rect.minX + rect.maxX) * HALF, (rect.minZ + rect.maxZ) * HALF);
}

/**
 * Returns the floor a body can stand on, unobstructed, in a rect.
 *
 * The body is treated as a square of side `2 * bodyRadius`: its centre can reach
 * anywhere the rect is at least that wide and that deep, which is the rect shrunk
 * by one radius on every side.
 *
 * @param rect - One walkable rect.
 * @param bodyRadius - Radius of the body, in metres.
 * @returns The area the body's centre can occupy, in square metres; `0` when the
 *   rect is too narrow or too shallow for the body at all.
 */
function standingArea(rect: PlanRect, bodyRadius: number): number {
  const diameter = bodyRadius * RADII_PER_DIAMETER;
  const width = Math.max(0, rect.maxX - rect.minX - diameter);
  const depth = Math.max(0, rect.maxZ - rect.minZ - diameter);
  return width * depth;
}

/**
 * Checks a tuning before any geometry is derived from it.
 *
 * @param config - The tuning to check.
 * @throws RangeError naming the offending value when the body radius is not a
 *   finite positive length, or the approach margin not a finite non-negative one.
 */
function validateConfig(config: RoomRouteConfig): void {
  if (!Number.isFinite(config.bodyRadius) || config.bodyRadius <= 0) {
    throw new RangeError(
      `config.bodyRadius must be a finite positive length in metres, got ${String(config.bodyRadius)}`,
    );
  }
  if (!Number.isFinite(config.approachMargin) || config.approachMargin < 0) {
    throw new RangeError(
      `config.approachMargin must be a finite non-negative length in metres, got ${String(config.approachMargin)}`,
    );
  }
}

/**
 * Lists the rects of one space a body can walk on, in slab order.
 *
 * @param slabs - The slabs of the whole plan, as `getSlabs` derived them.
 * @param id - Identifier of the space.
 * @returns A frozen array of the footprints of that space's slabs; empty for a
 *   space with no floor at this level, which is what makes a void unwalkable
 *   without naming it here.
 */
function getWalkableRects(slabs: readonly FloorSlab[], id: SpaceId): readonly PlanRect[] {
  return Object.freeze(slabs.filter((slab) => slab.spaceId === id).map((slab) => slab.rect));
}

/**
 * Finds the rect of a space a body is best put down in: the one with the
 * greatest {@link standingArea}, ties broken by slab order. Its centre is where
 * a walk sent to that space ends (see {@link getRouteWaypoints}).
 *
 * The largest rect a body can stand in, rather than the centre of the space's
 * bounding box or of its largest rect by plain area. Both alternatives are wrong
 * on this floor. The stair bay's bounding centre, (3.60, 5.00), is inside a
 * flight — a hole at this level — because only the arrival landing is floor here.
 * And the guest room's north strip is the larger rect by plain area, 6.075 m²
 * against 4.34 m², while being only 0.75 m deep: a plain-area rule would put
 * "go to the guest room" in the circulation strip the room is entered through,
 * rather than in the room. Shrinking each rect by the body radius before
 * comparing puts it in the room, at (5.50, 7.825).
 *
 * @param rects - The walkable rects of the space, in slab order.
 * @param id - Identifier of the space, for the error message.
 * @param config - Tuning; its body radius decides what counts as standing room.
 * @returns The index into `rects` of the largest standing rect.
 * @throws RangeError naming the space when it has no walkable rect at all, or
 *   none with room for the body to stand in.
 */
function findDestinationRectIndex(
  rects: readonly PlanRect[],
  id: SpaceId,
  config: RoomRouteConfig,
): number {
  let best = -1;
  let bestArea = 0;
  rects.forEach((rect, index) => {
    const area = standingArea(rect, config.bodyRadius);
    if (area > bestArea) {
      best = index;
      bestArea = area;
    }
  });
  if (best < 0) {
    throw new RangeError(
      `space "${id}" has nowhere a body of radius ${String(config.bodyRadius)} m can stand: its ${String(rects.length)} walkable rect(s) leave no standing area`,
    );
  }
  return best;
}

/**
 * Finds the walkable rect a body already standing somewhere occupies.
 *
 * @param rects - The walkable rects of the space, in slab order.
 * @param id - Identifier of the space, for the error message.
 * @param from - Where the body stands, in plan coordinates.
 * @param config - Tuning.
 * @returns The index of the rect containing `from`; when `from` lies in none of
 *   them — a caller asking for a route out of a space it is not in, or a
 *   non-finite coordinate — the index of that space's destination rect, so the
 *   walk starts where a walker arriving in the space would have been put down.
 * @throws RangeError naming the space when it has no rect the body can stand in
 *   (see {@link findDestinationRectIndex}).
 */
function findStandingRectIndex(
  rects: readonly PlanRect[],
  id: SpaceId,
  from: PlanPoint,
  config: RoomRouteConfig,
): number {
  const here = rects.findIndex((rect) => rectContainsPoint(rect, from));
  return here < 0 ? findDestinationRectIndex(rects, id, config) : here;
}

/** The axis travel runs along across a contact: perpendicular to the face, so perpendicular to its span. */
function getTravelAxis(side: RectSide): PlanAxis {
  return side === 'minX' || side === 'maxX' ? 'x' : 'z';
}

/** Which way travel runs from the queried space to its neighbour across a contact. */
function getContactDirection(side: RectSide): TravelDirection {
  return side === 'maxX' || side === 'maxZ' ? 1 : -1;
}

/** The opposite direction of travel. */
function flip(direction: TravelDirection): TravelDirection {
  return direction === 1 ? -1 : 1;
}

/** A contact carrying the clear span of the passage through it, oriented from `queriedId`. */
interface ContactPassage {
  /** The space `getNeighbours` was asked about, which `contact.side` is relative to. */
  readonly queriedId: SpaceId;
  /** The contact the passage sits in. */
  readonly contact: SpaceContact;
  /** Interval the passage is open over, on the contact's span axis, in metres. */
  readonly span: readonly [number, number];
}

/** Finds the port between two spaces, whichever order it names them in. */
function findPortBetween(ports: readonly Port[], a: SpaceId, b: SpaceId): Port | undefined {
  return ports.find(
    ({ spaces: [first, second] }) => (first === a && second === b) || (first === b && second === a),
  );
}

/**
 * Finds the passage between two consecutive spaces of a route.
 *
 * A port wins over a join: `validatePorts` rejects a duplicated space pair, so
 * there is at most one port per pair, and its span is the clear width of the
 * leaf rather than the whole length the two rooms touch over. Failing that, the
 * pair may still meet with no wall between them, and among several such contacts
 * the WIDEST span wins, ties broken by `getNeighbours` order. That precedence is
 * load-bearing on this floor: the stairs and the corridor have two zero-gap
 * contacts, one 1.50 m wide and one 0.50 m, and walking through the narrow one
 * would put the crossing at the wrong end of the landing.
 *
 * @param plan - The floor plan.
 * @param ports - The port schedule placed in that plan.
 * @param fromId - The space walked from.
 * @param toId - The space walked to.
 * @returns The passage, oriented from whichever space its contact was read from.
 * @throws RangeError naming the pair when no port and no zero-gap join connects
 *   them, so there is nothing to walk through.
 */
function findContactPassage(
  plan: FloorPlan,
  ports: readonly Port[],
  fromId: SpaceId,
  toId: SpaceId,
): ContactPassage {
  const port = findPortBetween(ports, fromId, toId);
  if (port !== undefined) {
    return {
      queriedId: port.spaces[0],
      contact: getPortContact(plan, port),
      span: getPortSpan(port),
    };
  }
  const joins = getNeighbours(plan, fromId).filter(
    (contact) => contact.neighbourId === toId && contact.gap <= LENGTH_TOLERANCE,
  );
  const widest = joins.reduce<SpaceContact | undefined>(
    (best, contact) =>
      best === undefined || contact.spanMax - contact.spanMin > best.spanMax - best.spanMin
        ? contact
        : best,
    undefined,
  );
  if (widest === undefined) {
    throw new RangeError(
      `"${fromId}" and "${toId}" have no crossing: no port names the pair and they do not meet with a zero-gap join`,
    );
  }
  return { queriedId: fromId, contact: widest, span: [widest.spanMin, widest.spanMax] };
}

/** The geometry of one crossing, oriented in walking order. */
interface CrossingGeometry {
  /** The axis travel runs along, perpendicular to the wall. */
  readonly travelAxis: PlanAxis;
  /** Which way travel runs along {@link CrossingGeometry.travelAxis}. */
  readonly direction: TravelDirection;
  /** Face of the space walked from, on the travel axis, in metres. */
  readonly nearFace: number;
  /** Face of the space walked to; equal to `nearFace` on a zero-gap join. */
  readonly farFace: number;
  /** Interval the passage is open over, on the span axis, in metres. */
  readonly span: readonly [number, number];
}

/**
 * Orients a passage in walking order.
 *
 * `getNeighbours` and `getPortContact` report a contact from ONE of the two
 * spaces — its `side` is a face of that space's rect — and a route may walk it
 * either way. Reversing swaps the two faces and the direction; on a zero-gap
 * join the two faces are the same coordinate, so the reversal is visible only in
 * the direction, and the same arithmetic then yields the same two approach
 * points from either end. That is why no branch distinguishes a join from a port
 * beyond this function.
 *
 * @param plan - The floor plan holding the two spaces.
 * @param passage - The passage as its contact was read.
 * @param fromId - The space actually walked from.
 * @returns The crossing geometry in walking order.
 * @throws RangeError naming the id when the plan has no such space.
 */
function orientCrossing(
  plan: FloorPlan,
  passage: ContactPassage,
  fromId: SpaceId,
): CrossingGeometry {
  const { queriedId, contact, span } = passage;
  const { side } = contact;
  const travelAxis = getTravelAxis(side);
  const towardNeighbour = getContactDirection(side);
  const queriedRect = getSpace(plan, queriedId).rects[contact.rectIndex];
  const neighbourRect = getSpace(plan, contact.neighbourId).rects[contact.neighbourRectIndex];
  // The queried space looks at its neighbour through its `side` face; the
  // neighbour looks back through its opposite face, and the gap between the two
  // is the wall, measured rather than assumed.
  const queriedFace = rectFace(queriedRect, travelAxis, towardNeighbour === 1);
  const neighbourFace = rectFace(neighbourRect, travelAxis, towardNeighbour === -1);
  const forward = queriedId === fromId;
  return {
    travelAxis,
    direction: forward ? towardNeighbour : flip(towardNeighbour),
    nearFace: forward ? queriedFace : neighbourFace,
    farFace: forward ? neighbourFace : queriedFace,
    span,
  };
}

/**
 * Finds the walkable rect of a space that reaches one side of a crossing.
 *
 * A space's walkable rects are its slabs, not its plan rects, so a rect of the
 * plan may reach a crossing while no floor does: the stair bay touches the
 * corridor along its whole east face, but only the arrival landing is floor at
 * this level. The rect must therefore present its own face at the crossing and
 * overlap the passage.
 *
 * @param rects - The walkable rects of the space, in slab order.
 * @param crossing - The crossing, in walking order.
 * @param wantFar - `true` for the side walked to, `false` for the side walked from.
 * @returns The index of the rect with the widest overlap of the passage, ties
 *   broken by slab order, or `undefined` when no walkable rect reaches the face.
 */
function findCrossingRectIndex(
  rects: readonly PlanRect[],
  crossing: CrossingGeometry,
  wantFar: boolean,
): number | undefined {
  const { travelAxis, direction, span } = crossing;
  const face = wantFar ? crossing.farFace : crossing.nearFace;
  // Walking out of a rect in the + direction leaves through its `max` face and
  // enters the next rect through that rect's `min` face.
  const useMax = wantFar ? direction === -1 : direction === 1;
  const spanAxis = crossAxis(travelAxis);
  let best: number | undefined;
  let bestOverlap = LENGTH_TOLERANCE;
  rects.forEach((rect, index) => {
    if (Math.abs(rectFace(rect, travelAxis, useMax) - face) > LENGTH_TOLERANCE) {
      return;
    }
    const [min, max] = rectExtent(rect, spanAxis);
    const overlap = Math.min(max, span[1]) - Math.max(min, span[0]);
    if (overlap > bestOverlap) {
      best = index;
      bestOverlap = overlap;
    }
  });
  return best;
}

/** How far inside a rect an approach point stands, measured from the wall face. */
function approachDistance(rect: PlanRect, axis: PlanAxis, config: RoomRouteConfig): number {
  // A shallow rect collapses the point to its own mid-depth rather than pushing
  // it out through the far side: the guest bathroom's open part is 0.55 m deep,
  // where a flat 0.30 would leave the body tangent to the far wall.
  return Math.min(config.bodyRadius + config.approachMargin, halfExtent(rect, axis));
}

/** The two waypoints of one crossing, with the rects they stand in. */
interface Crossing {
  /** Where the body waits on the side it comes from, clear of the jambs. */
  readonly outer: PlanPoint;
  /** Where it stands once through, clear of the jambs on the other side. */
  readonly inner: PlanPoint;
  /** Index of the walkable rect of the space walked from that {@link Crossing.outer} is in. */
  readonly nearRectIndex: number;
  /** Index of the walkable rect of the space walked to that {@link Crossing.inner} is in. */
  readonly farRectIndex: number;
}

/**
 * Derives the two waypoints a body passes through to cross from one space to the
 * next.
 *
 * Both points sit on the centre line of the passage, so the leg between them
 * runs square through the wall; each stands `bodyRadius + approachMargin` back
 * from its own face, or at its rect's mid-depth when the rect is shallower than
 * that (see {@link approachDistance}).
 *
 * The clear span is the passage narrowed to what is floored on both sides. Being
 * at least a body diameter wide, its centre is by construction at least a body
 * radius from either end of it, and therefore from either end of both rects,
 * which is the clearance the body needs along the wall.
 *
 * @param plan - The floor plan.
 * @param ports - The port schedule placed in that plan.
 * @param fromId - The space walked from.
 * @param toId - The space walked to.
 * @param fromRects - Walkable rects of `fromId`, in slab order.
 * @param toRects - Walkable rects of `toId`, in slab order.
 * @param config - Tuning.
 * @returns The crossing's two waypoints and the rects they stand in.
 * @throws RangeError naming the pair when nothing connects them, when no
 *   walkable rect reaches either side of the crossing, or when what is clear on
 *   both sides is narrower than the body.
 */
function getCrossing(
  plan: FloorPlan,
  ports: readonly Port[],
  fromId: SpaceId,
  toId: SpaceId,
  fromRects: readonly PlanRect[],
  toRects: readonly PlanRect[],
  config: RoomRouteConfig,
): Crossing {
  const crossing = orientCrossing(plan, findContactPassage(plan, ports, fromId, toId), fromId);
  const nearRectIndex = findCrossingRectIndex(fromRects, crossing, false);
  const farRectIndex = findCrossingRectIndex(toRects, crossing, true);
  if (nearRectIndex === undefined || farRectIndex === undefined) {
    const missing = nearRectIndex === undefined ? fromId : toId;
    throw new RangeError(
      `the crossing between "${fromId}" and "${toId}" has no walkable floor on the "${missing}" side: no slab of it reaches the passage`,
    );
  }
  const nearRect = fromRects[nearRectIndex];
  const farRect = toRects[farRectIndex];
  const spanAxis = crossAxis(crossing.travelAxis);
  const [nearMin, nearMax] = rectExtent(nearRect, spanAxis);
  const [farMin, farMax] = rectExtent(farRect, spanAxis);
  const clearMin = Math.max(crossing.span[0], nearMin, farMin);
  const clearMax = Math.min(crossing.span[1], nearMax, farMax);
  const diameter = config.bodyRadius * RADII_PER_DIAMETER;
  if (clearMax - clearMin < diameter - LENGTH_TOLERANCE) {
    throw new RangeError(
      `the crossing between "${fromId}" and "${toId}" is ${String(Math.max(0, toPlanLength(clearMax - clearMin)))} m clear on ${spanAxis}, too narrow for a body of radius ${String(config.bodyRadius)} m, which needs ${String(diameter)} m`,
    );
  }
  const centre = (clearMin + clearMax) * HALF;
  const { travelAxis, direction, nearFace, farFace } = crossing;
  return {
    outer: makeAxialWaypoint(
      travelAxis,
      nearFace - direction * approachDistance(nearRect, travelAxis, config),
      centre,
    ),
    inner: makeAxialWaypoint(
      travelAxis,
      farFace + direction * approachDistance(farRect, travelAxis, config),
      centre,
    ),
    nearRectIndex,
    farRectIndex,
  };
}

/** Where two rects of one space meet, and how much of that face a body can use. */
interface RectJoin {
  /** The axis the shared face lies across. */
  readonly faceAxis: PlanAxis;
  /** Coordinate of the shared face on that axis, in metres. */
  readonly face: number;
  /** Start of the shared face, on the other axis, in metres. */
  readonly overlapMin: number;
  /** End of the shared face, on the other axis, in metres. */
  readonly overlapMax: number;
}

/**
 * Finds the face two rects of one space share, when a body can pass along it.
 *
 * @param a - One walkable rect.
 * @param b - Another walkable rect of the same space.
 * @param diameter - Clear width the body needs, in metres.
 * @returns The shared face, or `undefined` when the rects do not touch or touch
 *   over less than the body's width. An exact fit counts: a passage exactly one
 *   diameter wide is walkable, with no clearance to spare.
 */
function findRectJoin(a: PlanRect, b: PlanRect, diameter: number): RectJoin | undefined {
  const candidates: readonly (RectJoin & { readonly gap: number })[] = [
    {
      faceAxis: 'x',
      face: a.maxX,
      gap: b.minX - a.maxX,
      overlapMin: Math.max(a.minZ, b.minZ),
      overlapMax: Math.min(a.maxZ, b.maxZ),
    },
    {
      faceAxis: 'x',
      face: a.minX,
      gap: a.minX - b.maxX,
      overlapMin: Math.max(a.minZ, b.minZ),
      overlapMax: Math.min(a.maxZ, b.maxZ),
    },
    {
      faceAxis: 'z',
      face: a.maxZ,
      gap: b.minZ - a.maxZ,
      overlapMin: Math.max(a.minX, b.minX),
      overlapMax: Math.min(a.maxX, b.maxX),
    },
    {
      faceAxis: 'z',
      face: a.minZ,
      gap: a.minZ - b.maxZ,
      overlapMin: Math.max(a.minX, b.minX),
      overlapMax: Math.min(a.maxX, b.maxX),
    },
  ];
  return candidates.find(
    (candidate) =>
      Math.abs(candidate.gap) <= LENGTH_TOLERANCE &&
      candidate.overlapMax - candidate.overlapMin >= diameter - LENGTH_TOLERANCE,
  );
}

/**
 * Finds the rects to walk through, in order, from one rect of a space to another.
 *
 * Breadth-first over the space's own walkable rects, so the result crosses as
 * few rect boundaries as possible, and deterministic: slab order decides which
 * neighbour is discovered first.
 *
 * @param rects - The walkable rects of the space, in slab order.
 * @param fromIndex - Index of the rect the body is in.
 * @param toIndex - Index of the rect it has to reach.
 * @param diameter - Clear width the body needs at a rect boundary, in metres.
 * @returns The indices to walk through, starting with `fromIndex` and ending
 *   with `toIndex`, or `undefined` when no chain of usable faces links them.
 */
function findRectPath(
  rects: readonly PlanRect[],
  fromIndex: number,
  toIndex: number,
  diameter: number,
): readonly number[] | undefined {
  const seen = new Set<number>([fromIndex]);
  const cameFrom = new Map<number, number>();
  const queue: number[] = [fromIndex];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    rects.forEach((rect, index) => {
      if (seen.has(index) || findRectJoin(rects[current], rect, diameter) === undefined) {
        return;
      }
      seen.add(index);
      cameFrom.set(index, current);
      queue.push(index);
    });
  }
  if (!seen.has(toIndex)) {
    return undefined;
  }
  const backwards: number[] = [];
  for (let step: number | undefined = toIndex; step !== undefined; step = cameFrom.get(step)) {
    backwards.push(step);
  }
  return backwards.reverse();
}

/**
 * Derives the waypoints that carry a body from one rect of a space to another.
 *
 * Legs are walked straight, so a space entered in one rect and left from another
 * needs a waypoint on every rect boundary between the two; without them a leg
 * across an L-shaped space would cut the notch, which is wall. Each connector
 * sits at the centre of the shared face, kept a body radius from its ends — a
 * face at least a diameter wide already puts its centre that far in, so the
 * clamp only holds the invariant where a wider tuning would move the centre.
 *
 * @param rects - The walkable rects of the space, in slab order.
 * @param fromIndex - Index of the rect the body is in.
 * @param toIndex - Index of the rect it has to reach.
 * @param id - Identifier of the space, for the error message.
 * @param config - Tuning.
 * @returns The connectors in walking order, excluding both endpoints; empty when
 *   the body is already in the rect it has to reach.
 * @throws RangeError naming the space when its walkable rects are split by a gap
 *   the body cannot pass, and (unreachably) when a join of the path just built
 *   cannot be found again — dropping that connector would cut a notch corner, so
 *   it is louder than a skip.
 */
function getConnectors(
  rects: readonly PlanRect[],
  fromIndex: number,
  toIndex: number,
  id: SpaceId,
  config: RoomRouteConfig,
): readonly PlanPoint[] {
  if (fromIndex === toIndex) {
    return NO_WAYPOINTS;
  }
  const diameter = config.bodyRadius * RADII_PER_DIAMETER;
  const path = findRectPath(rects, fromIndex, toIndex, diameter);
  if (path === undefined) {
    throw new RangeError(
      `space "${id}" cannot be walked from its walkable rect ${String(fromIndex)} to rect ${String(toIndex)}: no chain of its rects shares a face ${String(diameter)} m wide, which a body of radius ${String(config.bodyRadius)} m needs`,
    );
  }
  const connectors: PlanPoint[] = [];
  for (let step = 0; step + 1 < path.length; step += 1) {
    const join = findRectJoin(rects[path[step]], rects[path[step + 1]], diameter);
    if (join === undefined) {
      // Unreachable: `findRectPath` links two rects only when `findRectJoin`
      // finds that very face. Skipping the connector instead would drop it
      // silently and cut the corner of the notch it turns, so it throws.
      throw new RangeError(
        `space "${id}" has no join of ${String(diameter)} m between its walkable rects ${String(path[step])} and ${String(path[step + 1])}, which the path through them was built from`,
      );
    }
    const centre = (join.overlapMin + join.overlapMax) * HALF;
    const along = Math.min(
      Math.max(centre, join.overlapMin + config.bodyRadius),
      join.overlapMax - config.bodyRadius,
    );
    connectors.push(makeAxialWaypoint(join.faceAxis, join.face, along));
  }
  return connectors;
}

/**
 * Turns a space route into the points a body of `config.bodyRadius` walks through.
 *
 * The route is a parameter rather than something derived here, so this module
 * stays independent of how it was chosen (`findSpaceRoute`, `reachability.ts`,
 * chooses by fewest spaces crossed). Each consecutive pair of spaces must be
 * genuinely connected, by a port or by a zero-gap join.
 *
 * The walk starts at the first crossing's outer approach point: there is no
 * waypoint for where the body already stands. `from` is used only to decide
 * which walkable rect of the first space it starts in, which is what tells the
 * connectors of that space where to begin; a `from` outside every walkable rect
 * of the first space starts the walk from that space's destination point, so the
 * waypoints of a route ending in a space and those of a route starting from it
 * join up.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param ports - The port schedule placed in that plan. Not mutated.
 * @param route - The spaces to walk through, in order, each connected to the
 *   next. Not mutated.
 * @param from - Where the body stands now, in plan coordinates.
 * @param config - Tuning; defaults to {@link ROOM_ROUTE_CONFIG}.
 * @returns Frozen array of frozen points in walking order: per crossing an outer
 *   then an inner approach point, plus the connectors needed inside a space
 *   entered in one rect and left from another, ending at the destination point of
 *   the last space. A single-space route yields just that destination; an empty
 *   route yields no points at all.
 * @throws RangeError naming the pair when two consecutive spaces have no
 *   crossing the body fits through, and naming the space when its walkable rects
 *   hold no place the body can stand or are split by a gap it cannot pass. Also
 *   when `config` is not a usable tuning.
 */
export function getRouteWaypoints(
  plan: FloorPlan,
  ports: readonly Port[],
  route: readonly SpaceId[],
  from: PlanPoint,
  config: RoomRouteConfig = ROOM_ROUTE_CONFIG,
): readonly PlanPoint[] {
  validateConfig(config);
  if (route.length === 0) {
    return NO_WAYPOINTS;
  }
  const slabs = getSlabs(plan);
  const walkable = route.map((id) => getWalkableRects(slabs, id));
  const waypoints: PlanPoint[] = [];
  let rectIndex = findStandingRectIndex(walkable[0], route[0], from, config);
  for (let step = 0; step + 1 < route.length; step += 1) {
    const crossing = getCrossing(
      plan,
      ports,
      route[step],
      route[step + 1],
      walkable[step],
      walkable[step + 1],
      config,
    );
    waypoints.push(
      ...getConnectors(walkable[step], rectIndex, crossing.nearRectIndex, route[step], config),
      crossing.outer,
      crossing.inner,
    );
    rectIndex = crossing.farRectIndex;
  }
  const last = route.length - 1;
  const destinationIndex = findDestinationRectIndex(walkable[last], route[last], config);
  waypoints.push(
    ...getConnectors(walkable[last], rectIndex, destinationIndex, route[last], config),
    rectCentre(walkable[last][destinationIndex]),
  );
  return Object.freeze(waypoints);
}
