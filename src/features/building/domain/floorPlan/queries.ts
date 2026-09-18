/**
 * Read-only queries on a floor plan: looking a space up, measuring it, locating
 * a point, and finding the spaces that face each other across a wall.
 *
 * Every query takes the plan as a parameter and never mutates it. The queries
 * assume a valid plan (unique ids, rects of different spaces never overlap) and
 * do not validate it themselves.
 */
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectContainsPoint,
  toPlanLength,
} from '../planGeometry.ts';
import type { PlanPoint, PlanRect, RectSide } from '../planGeometry.ts';
import { MIN_FLOOR_COUNT } from '../storeys.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import type { FloorPlan, Space, SpaceContact, SpaceId, SpaceKind } from './types.ts';

/**
 * Widest gap between two facing rects that still counts as a contact: the
 * thickest wall of `WALL_SPEC`, in metres.
 *
 * `insulated` is listed even though it equals `exterior` today. Isolation is a
 * width now, so it is the one kind the owner may raise — and leaving it out
 * would not fail loudly: a wall built wider than this stops being seen as a
 * contact at all, so `getNeighbours` would quietly lose those two rooms, and
 * the walls, windows and railings derived from it would go with them.
 */
const MAX_CONTACT_GAP = Math.max(
  WALL_SPEC.exterior,
  WALL_SPEC.insulated,
  WALL_SPEC.partition,
  WALL_SPEC.voidFacing,
);

/** How one rect faces another: the side, the raw gap and the overlap along the face. */
interface Facing {
  /** Face of the first rect that looks at the second. */
  readonly side: RectSide;
  /** Distance between the facing faces, in metres, not rounded. */
  readonly gap: number;
  /** Start of the overlap along the face, in metres, not rounded. */
  readonly spanMin: number;
  /** End of the overlap along the face, in metres, not rounded. */
  readonly spanMax: number;
}

/**
 * Returns the space with the given id.
 *
 * @param plan - The floor plan to search.
 * @param id - Identifier of the space.
 * @returns The space object stored in `plan.spaces` (same reference).
 * @throws RangeError naming the id when the plan has no such space.
 */
export function getSpace(plan: FloorPlan, id: SpaceId): Space {
  const space = plan.spaces.find((candidate) => candidate.id === id);
  if (space === undefined) {
    throw new RangeError(`the floor plan has no space with id "${id}"`);
  }
  return space;
}

/** Separates the matricule from the name in a space label. */
export const SPACE_LABEL_SEPARATOR = '·';

/** Marks the storey in a floor-stamped matricule, as the wall matricules do: `F2-…`. */
export const FLOOR_PREFIX = 'F';

/** Separates the storey from the rest of a floor-stamped matricule: `F2-R11/KIT`. */
export const FLOOR_MATRICULE_SEPARATOR = '-';

/**
 * Stamps a storey onto a matricule.
 *
 * The plan is one plan and the storeys repeat it, so `R11/KIT` names the
 * kitchen of the typical floor and not a place: from two storeys up there are
 * two of it. The storey is therefore written into the matricule the way the
 * wall register already writes it — `F1-R11-KIT-W3` — so a room and the walls
 * around it read as belonging to the same floor.
 *
 * The prefix appears from one storey up, `F1-R11/KIT` in a single-floor
 * building: one spelling everywhere beats a room that is named differently
 * depending on how tall the building happens to be.
 *
 * @param matricule - The matricule of the typical floor, e.g. `R11/KIT`.
 * @param floor - Storey the room is on, an integer of at least
 *   {@link MIN_FLOOR_COUNT}.
 * @returns e.g. `F2-R11/KIT`.
 * @throws RangeError naming the floor when it is not an integer of at least
 *   {@link MIN_FLOOR_COUNT} — which rejects `0`, a negative storey and `1.5` alike.
 */
export function getFloorMatricule(matricule: string, floor: number): string {
  if (!Number.isInteger(floor) || floor < MIN_FLOOR_COUNT) {
    throw new RangeError(
      `a matricule can only be stamped with a floor of at least ${String(MIN_FLOOR_COUNT)}, got ${String(floor)}`,
    );
  }
  return `${FLOOR_PREFIX}${String(floor)}${FLOOR_MATRICULE_SEPARATOR}${matricule}`;
}

/**
 * Formats a space for a readout: its floor-stamped matricule, then its name.
 *
 * The one label formatter of the model, so a readout cannot invent a second
 * format: everything that shows a space to a person comes through here.
 *
 * The floor is required and not optional on purpose. Required, the compiler
 * finds every call site the day the building gains a storey; optional, a room's
 * name would depend on whether the caller bothered to pass one, which is two
 * spellings of the same room.
 *
 * @param space - The space to label.
 * @param floor - Storey the space is on, an integer of at least
 *   {@link MIN_FLOOR_COUNT}.
 * @returns e.g. `F2-R11/KIT · Kitchen`.
 * @throws RangeError naming the floor when it is not an integer of at least
 *   {@link MIN_FLOOR_COUNT}.
 */
export function getSpaceLabel(space: Space, floor: number): string {
  return `${getFloorMatricule(space.matricule, floor)} ${SPACE_LABEL_SEPARATOR} ${space.name}`;
}

/**
 * Returns the clear floor area of a space.
 *
 * @param space - The space to measure.
 * @returns The sum of the areas of its rects, in square metres, not rounded.
 *   Rects of a space never overlap, so nothing is counted twice.
 */
export function getSpaceArea(space: Space): number {
  return space.rects.reduce((sum, rect) => sum + rectArea(rect), 0);
}

/**
 * Returns the bounding rectangle of a space.
 *
 * @param space - The space to enclose.
 * @returns A frozen rectangle: the smallest one containing every rect of the space.
 * @throws RangeError naming the space when it has no rects.
 */
export function getSpaceBounds(space: Space): PlanRect {
  if (space.rects.length === 0) {
    throw new RangeError(`space "${space.id}" has no rects to bound`);
  }
  return makeRect(
    Math.min(...space.rects.map((rect) => rect.minX)),
    Math.max(...space.rects.map((rect) => rect.maxX)),
    Math.min(...space.rects.map((rect) => rect.minZ)),
    Math.max(...space.rects.map((rect) => rect.maxZ)),
  );
}

/**
 * Tells whether a kind of space has a floor slab.
 *
 * @param kind - The kind of space.
 * @returns `false` only for `'void'`, which is open to the sky; `true` otherwise.
 */
export function hasFloor(kind: SpaceKind): boolean {
  return kind !== 'void';
}

/**
 * Finds the space covering a point of the plan.
 *
 * Uses the half-open, exact test of `rectContainsPoint`: a rect owns its `minX`
 * and `minZ` faces but not its `maxX` and `maxZ` faces, so on a zero-gap join
 * the point belongs to the space on the + side. Rects never overlap, so at most
 * one space matches and the result does not depend on the order of the spaces.
 *
 * @param plan - The floor plan to search.
 * @param point - The point to locate, in plan coordinates.
 * @returns The space whose rect contains the point (including a `'void'` space),
 *   or `undefined` when the point lies in a wall, in a gap between spaces, or
 *   outside the plot.
 * @throws RangeError when `x` or `z` is not finite.
 */
export function findSpaceAt(plan: FloorPlan, point: PlanPoint): Space | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new RangeError(
      `point coordinates must be finite numbers, got x = ${String(point.x)}, z = ${String(point.z)}`,
    );
  }
  return plan.spaces.find((space) => space.rects.some((rect) => rectContainsPoint(rect, point)));
}

/**
 * Checks whether a gap between two facing faces is narrow enough for a contact.
 *
 * @param gap - Raw distance between the faces, in metres.
 * @returns `true` when the gap lies in [−LENGTH_TOLERANCE, MAX_CONTACT_GAP + LENGTH_TOLERANCE].
 */
function isContactGap(gap: number): boolean {
  return gap >= -LENGTH_TOLERANCE && gap <= MAX_CONTACT_GAP + LENGTH_TOLERANCE;
}

/**
 * Determines how a rect faces another one across a wall, if it does.
 *
 * The rects face each other on an axis when their projections on the other
 * axis overlap by more than `LENGTH_TOLERANCE` (a corner-only touch does not
 * count) and the gap between them on that axis is a contact gap. Rects that do
 * not overlap can face each other on one axis only; for degenerate rects the
 * first match in the order minX, maxX, minZ, maxZ wins.
 *
 * @param rect - The rect whose side is reported.
 * @param other - The rect it may face.
 * @returns The facing, with raw values, or `undefined` when the rects do not face.
 */
function findFacing(rect: PlanRect, other: PlanRect): Facing | undefined {
  const spanMinX = Math.max(rect.minX, other.minX);
  const spanMaxX = Math.min(rect.maxX, other.maxX);
  const spanMinZ = Math.max(rect.minZ, other.minZ);
  const spanMaxZ = Math.min(rect.maxZ, other.maxZ);
  const candidates: readonly Facing[] = [
    { side: 'minX', gap: rect.minX - other.maxX, spanMin: spanMinZ, spanMax: spanMaxZ },
    { side: 'maxX', gap: other.minX - rect.maxX, spanMin: spanMinZ, spanMax: spanMaxZ },
    { side: 'minZ', gap: rect.minZ - other.maxZ, spanMin: spanMinX, spanMax: spanMaxX },
    { side: 'maxZ', gap: other.minZ - rect.maxZ, spanMin: spanMinX, spanMax: spanMaxX },
  ];
  return candidates.find(
    (candidate) =>
      candidate.spanMax - candidate.spanMin > LENGTH_TOLERANCE && isContactGap(candidate.gap),
  );
}

/**
 * Lists every face-to-face contact between a space and the other spaces.
 *
 * For each rect of the space and each rect of every other space, a contact
 * exists when the rects face each other: the gap between the facing faces is
 * between −LENGTH_TOLERANCE and the thickest `WALL_SPEC` wall (plus
 * LENGTH_TOLERANCE), and their extents along the face overlap by more than
 * LENGTH_TOLERANCE. There is at most one contact per rect pair.
 *
 * Contacts are sorted by the neighbour's index in `plan.spaces`, then
 * `rectIndex`, then `neighbourRectIndex` (then side in the order minX, maxX,
 * minZ, maxZ, then `spanMin`, which never tie since a rect pair yields one
 * contact). `gap`, `spanMin` and `spanMax` are rounded with `toPlanLength`.
 *
 * @param plan - The floor plan.
 * @param id - Identifier of the queried space.
 * @returns A frozen array of frozen contacts, empty when nothing faces the space.
 * @throws RangeError naming the id when the plan has no such space.
 */
export function getNeighbours(plan: FloorPlan, id: SpaceId): readonly SpaceContact[] {
  const space = getSpace(plan, id);
  const contacts: SpaceContact[] = [];
  plan.spaces.forEach((neighbour) => {
    if (neighbour.id === space.id) {
      return;
    }
    space.rects.forEach((rect, rectIndex) => {
      neighbour.rects.forEach((neighbourRect, neighbourRectIndex) => {
        const facing = findFacing(rect, neighbourRect);
        if (facing === undefined) {
          return;
        }
        contacts.push(
          Object.freeze({
            neighbourId: neighbour.id,
            side: facing.side,
            rectIndex,
            neighbourRectIndex,
            // A gap just below zero (within tolerance) rounds to -0; report it as 0.
            gap: Math.max(0, toPlanLength(facing.gap)),
            spanMin: toPlanLength(facing.spanMin),
            spanMax: toPlanLength(facing.spanMax),
          }),
        );
      });
    });
  });
  return Object.freeze(contacts);
}
