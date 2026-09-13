/**
 * Collision foundation: where a body may stand on this floor, and how far it
 * gets when it tries to walk.
 *
 * One structure answers both questions. A {@link WalkField} is the storey
 * reduced to two lists of plan rectangles:
 *
 * - `floor`, every rectangle a body may stand on;
 * - `blockers`, every rectangle a body may not enter.
 *
 * A hole is a blocker exactly like a wall, and that is the whole of the fall
 * rule. Nothing has to look for an edge, because the two side-B voids and the
 * open stair shaft are in the same list as the masonry and stop the body the
 * same way.
 *
 * **Why the field is derived from vertical spans rather than from a list of
 * walls.** The floor is built out of boxes (`planBox.ts`), and what a body meets
 * at a box is decided by the box's vertical span against the body's own:
 *
 * 1. a box whose top is the finished floor is FLOOR — every slab, and every door
 *    threshold block, which is the part of the wall left standing under a door
 *    opening (−0.30 → 0);
 * 2. a box overlapping {@link BODY_SPAN} is SOLID — a full-height wall, a
 *    parapet, and the sill block under a window;
 * 3. a piece of the plot that is neither is a FALL.
 *
 * Rules 1 and 2 are mutually exclusive, because the body span starts on the
 * finished floor datum: a box whose top is 0 overlaps the span by exactly 0,
 * which is not more than {@link LENGTH_TOLERANCE}. That single fact is what makes
 * movement cross a wall at a door and nowhere else, with no rule naming a door
 * or a window anywhere in this module (brief §2, Part 3):
 *
 * - a door leaves a threshold below it, which is floor, so a body walks through;
 * - a window leaves a sill block below it, which is solid at body height, so a
 *   body meets masonry — every window of this floor sills at 0.60 or above;
 * - a lintel (2.10 → 2.70) is above the body and is neither, so it leaves the
 *   plan under it to be classified by whatever else covers it, which is the
 *   threshold.
 *
 * Pure geometry, in metres, with the plan conventions of `floorPlan/types.ts`
 * (ADR-005): no rendering, no scene objects, nothing mutated.
 */

import { PERSON_SPEC } from './person.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect, rectContainsPoint } from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import type { Railing } from './railings.ts';

/** Level of the finished floor of the storey: the top of every slab, in metres. */
const FINISHED_FLOOR_LEVEL = 0;

/** Factor that turns the sum of two faces into the midpoint between them. */
const HALF = 0.5;

/** Displacement with no length: an idle request, and the result of a wedged move. */
const NO_MOVEMENT = 0;

/** A displacement on the floor plan (x/z, metres): a step, or a direction. */
export interface PlanVector {
  /** Component along x, in metres. */
  readonly x: number;
  /** Component along z, in metres. */
  readonly z: number;
}

/** The vertical slice of the world a standing body occupies, in metres. */
export interface BodySpan {
  /** Level of the feet: the finished floor the body stands on. */
  readonly bottom: number;
  /** Level of the top of the head. */
  readonly top: number;
}

/**
 * The body's own vertical span: from the finished floor to the top of the head
 * of the {@link PERSON_SPEC} person. Frozen.
 *
 * The bottom is the finished floor datum rather than a hair above it, and that is
 * load-bearing: it is what makes the floor and solid rules of this module's
 * header mutually exclusive, so a door threshold can never also be a wall.
 */
export const BODY_SPAN: BodySpan = Object.freeze({
  bottom: FINISHED_FLOOR_LEVEL,
  top: PERSON_SPEC.height,
});

/** The solids of one storey a walk field is swept from. */
export interface WalkFieldSolids {
  /**
   * The wall blocks with every opening already punched out, typically
   * `BuiltFloor.walls`. A door's threshold and lintel blocks are part of this
   * list: that is how a door becomes walkable and a window does not.
   */
  readonly walls: readonly PlanBox[];
  /** The floor slabs, typically `BuiltFloor.slabs`. */
  readonly slabs: readonly PlanBox[];
  /**
   * The guard railings, typically `BuiltFloor.railings`. They are appended to the
   * blockers whole, AFTER the sweep — see {@link getWalkField}.
   */
  readonly railings: readonly Railing[];
}

/** The floor of one storey as collision needs it: what to stand on, what to stop at. */
export interface WalkField {
  /**
   * Every rectangle a body may stand on: the slabs, plus the threshold of every
   * door. The rectangles tile the walkable floor and never overlap.
   */
  readonly floor: readonly PlanRect[];
  /**
   * Every rectangle a body may not enter: the masonry solid at body height, the
   * holes it would fall through, and the guard railings. A hole is in this list
   * for the same reason a wall is, so one test covers both.
   */
  readonly blockers: readonly PlanRect[];
}

/**
 * How far a body got, and whether something stopped it.
 *
 * Both the request and the result are reported, so a caller can tell a step that
 * was refused from a step that was merely short.
 */
export interface BodyMove {
  /** Where the body ends up, in plan coordinates. */
  readonly point: PlanPoint;
  /** The step that was asked for. */
  readonly requested: PlanVector;
  /** The step that was taken: `point` minus the point moved from. */
  readonly applied: PlanVector;
  /** Whether a blocker shortened the step on either axis. */
  readonly blocked: boolean;
}

/** The pair of faces that bound a rectangle along one plan axis. */
interface AxisFaces {
  /** Reads the low face of the rectangle on this axis. */
  readonly min: (rect: PlanRect) => number;
  /** Reads the high face of the rectangle on this axis. */
  readonly max: (rect: PlanRect) => number;
}

/** The x faces of a rectangle. Frozen. */
const X_FACES: AxisFaces = Object.freeze({
  min: (rect: PlanRect) => rect.minX,
  max: (rect: PlanRect) => rect.maxX,
});

/** The z faces of a rectangle. Frozen. */
const Z_FACES: AxisFaces = Object.freeze({
  min: (rect: PlanRect) => rect.minZ,
  max: (rect: PlanRect) => rect.maxZ,
});

/** The interval of a ray's travel that lies between one pair of parallel faces. */
interface RaySlab {
  /** Travel at which the ray enters the slab; may be negative or `-Infinity`. */
  readonly enter: number;
  /** Travel at which it leaves; may be `Infinity`. */
  readonly exit: number;
}

/** A ray running parallel to a slab, between its faces, is inside it for ever. Frozen. */
const UNBOUNDED_SLAB: RaySlab = Object.freeze({
  enter: Number.NEGATIVE_INFINITY,
  exit: Number.POSITIVE_INFINITY,
});

/**
 * Tells whether a box is floor: whether its top is the finished floor level.
 *
 * True of every slab, whose top IS the finished floor (`slabs.ts`), and of every
 * door threshold block, the −0.30 → 0 remnant a door opening leaves under
 * itself. Never true of a wall, a parapet or a window sill block, all of which
 * stand above the floor.
 *
 * @param box - The box to classify.
 * @returns `true` when `box.top` is within {@link LENGTH_TOLERANCE} of the
 *   finished floor level.
 */
function isFloorBox(box: PlanBox): boolean {
  return Math.abs(box.top - FINISHED_FLOOR_LEVEL) <= LENGTH_TOLERANCE;
}

/**
 * Tells whether a box is solid where the body is: whether it overlaps the body's
 * vertical span.
 *
 * The comparison is strict — MORE than {@link LENGTH_TOLERANCE} of overlap — and
 * that strictness is the rule of this module rather than a rounding guard. A
 * door threshold tops out exactly on `span.bottom` and so overlaps by exactly
 * zero; relaxing this to `>= 0` would make every threshold a wall and seal every
 * door on the floor.
 *
 * @param box - The box to classify.
 * @param span - The vertical slice the body occupies.
 * @returns `true` when box and span share more than {@link LENGTH_TOLERANCE} of
 *   height: a full wall, a parapet, a window sill block. `false` for a threshold
 *   (overlap exactly 0) and for a lintel, which stands above the head.
 */
function isSolidAtBodyHeight(box: PlanBox, span: BodySpan): boolean {
  return Math.min(box.top, span.top) - Math.max(box.bottom, span.bottom) > LENGTH_TOLERANCE;
}

/**
 * Reduces a list of coordinates to the sorted, distinct grid lines they name.
 *
 * Values closer together than {@link LENGTH_TOLERANCE} are one line: the faces
 * arrive from several modules and a face shared by a slab and a wall must not
 * open a cell of zero width between them.
 *
 * @param values - Face coordinates along one axis, in any order.
 * @returns The distinct values, ascending.
 */
function toGridLines(values: readonly number[]): readonly number[] {
  return [...values]
    .sort((a, b) => a - b)
    .filter((value, index, sorted) => index === 0 || value - sorted[index - 1] > LENGTH_TOLERANCE);
}

/**
 * Collects the faces of a set of rectangles along one axis, clipped to the plot.
 *
 * Clipping is what guarantees the swept cells tile the plot exactly, so that the
 * floor, solid and fall areas of the result sum to the plot area and nothing is
 * classified twice.
 *
 * @param rects - The rectangles whose faces are wanted.
 * @param axis - Which pair of faces to read.
 * @param plotMin - Low face of the plot on that axis, in metres.
 * @param plotMax - High face of the plot on that axis, in metres.
 * @returns The distinct grid lines, ascending, always including both plot faces.
 */
function getGridLines(
  rects: readonly PlanRect[],
  axis: AxisFaces,
  plotMin: number,
  plotMax: number,
): readonly number[] {
  const faces = rects.flatMap((rect) => [axis.min(rect), axis.max(rect)]);
  const inside = faces.filter(
    (face) => face > plotMin + LENGTH_TOLERANCE && face < plotMax - LENGTH_TOLERANCE,
  );
  return toGridLines([plotMin, plotMax, ...inside]);
}

/**
 * Builds a walk field from a floor and a plot.
 *
 * **Floor and solid come straight from the boxes.** Each box the two rules of
 * this module's header select contributes its own footprint, whole: one rectangle
 * per slab, one per door threshold, one per piece of masonry standing at body
 * height. Nothing is cut up and nothing is merged, so a threshold in the result
 * is exactly the footprint of the opening that made it — the rectangle
 * `getPortOpening` returns — and a wall is the block `getWallPieces` derived.
 *
 * **The sweep finds what no box covers.** A hole is the absence of a solid, so it
 * is the one part of the field that cannot be read off a box: it has to be
 * measured against the plot. The grid lines are the distinct faces of the plot,
 * the slabs and the wall blocks, clipped to the plot; each cell between two
 * consecutive lines on each axis is tested by its own centre, with the exact
 * half-open test of `rectContainsPoint`, and a cell covered by neither a floor
 * box nor a solid box is a fall. The test is exact rather than approximate
 * because every one of those faces lies on the centimetre plan grid, so the
 * narrowest possible cell is 0.01 m wide and its centre sits 0.005 m clear of
 * both faces — orders of magnitude outside floating-point noise.
 *
 * Fall cells are emitted one per cell and deliberately NOT merged. There are a
 * few dozen of them — the two side-B voids and the stair shaft — and merging them
 * would mean a second copy of the private cell merge of `walls.ts` for no
 * behavioural gain.
 *
 * **Railings do not enter the sweep.** They are appended to the blockers whole,
 * afterwards. A railing straddles the edge it guards, so its faces carry a
 * deliberate 0.025 m overhang over the void (`railings.ts`, ADR-008): feeding
 * them to the grid would put lines off the centimetre grid and break the tiling,
 * and a railing is the one blocker that genuinely overlaps the floor — its inner
 * 0.025 m stands on the balcony slab it guards.
 *
 * @param solids - The walls, slabs and railings of the storey, typically a
 *   `BuiltFloor`. Not mutated.
 * @param plot - Outer boundary of the floor; the swept cells tile exactly this.
 * @param span - The vertical slice the body occupies; defaults to
 *   {@link BODY_SPAN}. Injecting a shorter span is what would let a crawling or
 *   seated body under a higher sill.
 * @returns A deeply frozen {@link WalkField}. `floor` holds the slab footprints
 *   in slab order, then the door thresholds in wall order; `blockers` holds the
 *   masonry solid at body height in wall order, then the fall cells row by row
 *   along z, then one rectangle per railing in railing order.
 */
export function getWalkField(
  solids: WalkFieldSolids,
  plot: PlanRect,
  span: BodySpan = BODY_SPAN,
): WalkField {
  const boxes = [...solids.slabs, ...solids.walls];
  const solidBoxes = boxes.filter((box) => isSolidAtBodyHeight(box, span));
  const floorBoxes = boxes.filter((box) => isFloorBox(box));
  const rects = boxes.map((box) => box.rect);
  const xs = getGridLines(rects, X_FACES, plot.minX, plot.maxX);
  const zs = getGridLines(rects, Z_FACES, plot.minZ, plot.maxZ);

  const fallCells: PlanRect[] = [];
  zs.slice(0, -1).forEach((minZ, indexZ) => {
    const maxZ = zs[indexZ + 1];
    xs.slice(0, -1).forEach((minX, indexX) => {
      const maxX = xs[indexX + 1];
      const centre: PlanPoint = { x: (minX + maxX) * HALF, z: (minZ + maxZ) * HALF };
      const covers = (box: PlanBox): boolean => rectContainsPoint(box.rect, centre);
      if (!solidBoxes.some(covers) && !floorBoxes.some(covers)) {
        fallCells.push(makeRect(minX, maxX, minZ, maxZ));
      }
    });
  });

  return makeWalkField(
    floorBoxes.map((box) => box.rect),
    [
      ...solidBoxes.map((box) => box.rect),
      ...fallCells,
      ...solids.railings.map((railing) => railing.rect),
    ],
  );
}

/**
 * Builds a walk field from rectangles that are already classified.
 *
 * The one place a field is frozen, so that every field in the application —
 * swept, hand-built in a test, or narrowed by a caller — is frozen the same way
 * and none can be handed out half-mutable.
 *
 * @param floor - The rectangles a body may stand on. Copied, not captured.
 * @param blockers - The rectangles a body may not enter. Copied, not captured.
 * @returns A deeply frozen {@link WalkField}: both arrays and every rectangle in
 *   them.
 */
export function makeWalkField(
  floor: readonly PlanRect[],
  blockers: readonly PlanRect[],
): WalkField {
  return Object.freeze({
    floor: Object.freeze(floor.map((rect) => Object.freeze(rect))),
    blockers: Object.freeze(blockers.map((rect) => Object.freeze(rect))),
  });
}

/**
 * Returns how far along one axis a body may move before a blocker stops it.
 *
 * The body is a circle, so each blocker is grown by the radius on both axes and
 * the body treated as the point at its centre — the standard Minkowski sum. A
 * blocker stops the body only when the body's position on the OTHER axis lies
 * within the grown blocker's band there; otherwise the body passes alongside it.
 *
 * Two details of the comparisons carry the behaviour of the whole module:
 *
 * - **the band test is strict.** After stopping flush against a face the body
 *   sits exactly at `face − radius`, which is exactly the edge of the
 *   neighbouring blocker's band. A non-strict test would then judge the body to
 *   be inside that band and refuse to let it slide along the wall it is touching,
 *   so a body that walked into a wall could never walk along it;
 * - **the near-face guard `start <= faceLow`.** A body already inside a blocker's
 *   band on this axis — standing in a doorway, whose jambs' grown bands overlap
 *   the opening — must not be clamped backwards to the face it has already
 *   passed. Only a body approaching a face from outside is stopped by it.
 *
 * @param start - Position of the body on this axis before the move, in metres.
 * @param delta - Requested displacement on this axis, in metres.
 * @param crossAt - Position of the body on the other axis, in metres. For the
 *   second axis resolved this is the ALREADY RESOLVED position on the first.
 * @param blockers - The rectangles the body may not enter.
 * @param radius - Radius of the body on the plan, in metres.
 * @param along - The faces bounding a rectangle on the axis being moved along.
 * @param across - The faces bounding it on the other axis.
 * @returns The position the body reaches on this axis: `start` for an idle
 *   request, `start + delta` when nothing is in the way, otherwise the nearest
 *   face that stops it.
 */
function limitAlongAxis(
  start: number,
  delta: number,
  crossAt: number,
  blockers: readonly PlanRect[],
  radius: number,
  along: AxisFaces,
  across: AxisFaces,
): number {
  if (Math.abs(delta) <= LENGTH_TOLERANCE) {
    return start;
  }
  let limit = start + delta;
  blockers.forEach((rect) => {
    const bandLow = across.min(rect) - radius;
    const bandHigh = across.max(rect) + radius;
    if (!(crossAt > bandLow + LENGTH_TOLERANCE && crossAt < bandHigh - LENGTH_TOLERANCE)) {
      return;
    }
    const faceLow = along.min(rect) - radius;
    const faceHigh = along.max(rect) + radius;
    if (delta > 0 && start <= faceLow + LENGTH_TOLERANCE && limit > faceLow) {
      limit = faceLow;
    }
    if (delta < 0 && start >= faceHigh - LENGTH_TOLERANCE && limit < faceHigh) {
      limit = faceHigh;
    }
  });
  return limit;
}

/**
 * Moves a body by one step, stopping it at whatever it runs into.
 *
 * The step is resolved **per axis, x first, then z on the already resolved x**.
 * That order is what produces sliding: a body walking diagonally into a wall
 * keeps all of the component along the wall and loses only the component into it,
 * instead of stopping dead. It also means the two axes are not symmetric in a
 * corner — the x resolution cannot see where z will end up — which is correct for
 * a single step and is why a body wedged into an inside corner simply stays put.
 *
 * **Corners are Minkowski-squared, not rounded.** Each blocker is grown by the
 * body radius on both axes, which replaces the true swept circle with a
 * rectangle: around an OUTSIDE corner the body is held off by up to
 * `radius × (√2 − 1)` ≈ 0.10 m further than a real circle of that radius would
 * be. The body therefore rounds outside corners a little wide. That is accepted
 * deliberately: it is never permissive — the body is held further out, never let
 * closer in — and it costs a tenth of a metre of clearance at a jamb in exchange
 * for keeping the whole resolution exact and allocation-free.
 *
 * Pure: neither `from`, `delta` nor `field` is read after the call or mutated.
 *
 * @param from - Where the body stands, in plan coordinates.
 * @param delta - The step to attempt, in metres. A component no larger than
 *   {@link LENGTH_TOLERANCE} is idle and leaves that axis alone.
 * @param field - The walk field to move in; only its blockers are consulted.
 * @param radius - Radius of the body on the plan, in metres. Expected finite and
 *   not negative; a zero radius moves a point.
 * @returns A {@link BodyMove}. `blocked` is `true` when a blocker shortened the
 *   step by more than {@link LENGTH_TOLERANCE} on either axis, and so is always
 *   `false` for an idle request, for an unobstructed step, and for a body sliding
 *   flush along a face it is already touching.
 */
export function moveBody(
  from: PlanPoint,
  delta: PlanVector,
  field: WalkField,
  radius: number,
): BodyMove {
  const x = limitAlongAxis(from.x, delta.x, from.z, field.blockers, radius, X_FACES, Z_FACES);
  const z = limitAlongAxis(from.z, delta.z, x, field.blockers, radius, Z_FACES, X_FACES);
  const applied: PlanVector = { x: x - from.x, z: z - from.z };
  return {
    point: { x, z },
    requested: { x: delta.x, z: delta.z },
    applied,
    blocked:
      Math.abs(delta.x - applied.x) > LENGTH_TOLERANCE ||
      Math.abs(delta.z - applied.z) > LENGTH_TOLERANCE,
  };
}

/**
 * Returns the interval of a ray's travel that lies between one pair of faces.
 *
 * @param start - Where the ray starts on this axis, in metres.
 * @param direction - Component of the direction on this axis.
 * @param low - Low face of the slab, in metres.
 * @param high - High face of the slab, in metres.
 * @returns The travel interval, or `undefined` when the ray runs parallel to the
 *   slab and outside it — which includes running exactly along either face, so
 *   that a body sliding flush along a wall is not judged to be hitting it.
 */
function getRaySlab(
  start: number,
  direction: number,
  low: number,
  high: number,
): RaySlab | undefined {
  if (Math.abs(direction) <= LENGTH_TOLERANCE) {
    return start <= low + LENGTH_TOLERANCE || start >= high - LENGTH_TOLERANCE
      ? undefined
      : UNBOUNDED_SLAB;
  }
  const atLow = (low - start) / direction;
  const atHigh = (high - start) / direction;
  return atLow <= atHigh ? { enter: atLow, exit: atHigh } : { enter: atHigh, exit: atLow };
}

/**
 * Returns how far a body travels along a direction before it touches one blocker.
 *
 * The blocker is grown by the body radius and the body treated as a point, so
 * this is a ray against an axis-aligned box.
 *
 * @param from - Where the body stands.
 * @param direction - Direction of travel; expected to be a unit vector.
 * @param rect - The blocker.
 * @param radius - Radius of the body on the plan, in metres.
 * @returns The travel at which the body touches the blocker, `0` when it already
 *   overlaps it, or `undefined` when the blocker is behind it, beside it, or
 *   touched only at the instant of leaving.
 */
function getBoxEntry(
  from: PlanPoint,
  direction: PlanVector,
  rect: PlanRect,
  radius: number,
): number | undefined {
  const slabX = getRaySlab(from.x, direction.x, rect.minX - radius, rect.maxX + radius);
  if (slabX === undefined) {
    return undefined;
  }
  const slabZ = getRaySlab(from.z, direction.z, rect.minZ - radius, rect.maxZ + radius);
  if (slabZ === undefined) {
    return undefined;
  }
  const enter = Math.max(slabX.enter, slabZ.enter);
  const exit = Math.min(slabX.exit, slabZ.exit);
  if (enter > exit + LENGTH_TOLERANCE || exit <= LENGTH_TOLERANCE) {
    return undefined;
  }
  return Math.max(enter, NO_MOVEMENT);
}

/**
 * Returns how far a body may travel along a direction before it touches a blocker.
 *
 * This is the question a camera and a route follower ask, as opposed to the step
 * {@link moveBody} takes: the third-person camera pulls itself in to the
 * clearance behind the person so it never sits inside a wall, and a follower
 * checks the clearance ahead before committing to a leg of a route.
 *
 * Unlike {@link moveBody} this is a true swept test along the given direction
 * rather than two axis passes, so it does not slide: it reports the first touch.
 * Corners are still Minkowski-squared (see {@link moveBody}).
 *
 * @param from - Where the body stands.
 * @param direction - Direction of travel. Expected to be a unit vector on the
 *   plan: the result is measured in multiples of its length, so a non-unit
 *   direction returns a distance in those units rather than in metres.
 * @param field - The walk field; only its blockers are consulted.
 * @param radius - Radius of the body on the plan, in metres.
 * @returns The distance to the first blocker; `0` when the body already overlaps
 *   one; `Infinity` when nothing lies in the way. A direction of zero length has
 *   no way for anything to lie in, and returns `Infinity`.
 */
export function getClearance(
  from: PlanPoint,
  direction: PlanVector,
  field: WalkField,
  radius: number,
): number {
  if (Math.hypot(direction.x, direction.z) <= LENGTH_TOLERANCE) {
    return Number.POSITIVE_INFINITY;
  }
  return field.blockers.reduce((least, rect) => {
    const entry = getBoxEntry(from, direction, rect, radius);
    return entry === undefined ? least : Math.min(least, entry);
  }, Number.POSITIVE_INFINITY);
}

/**
 * Tells whether a body standing at a point overlaps no blocker.
 *
 * The test is strict, for the reason {@link limitAlongAxis} gives: a body left
 * flush against a face by a move, at exactly `face − radius`, is clear there, or
 * the very position collision put it in would be illegal.
 *
 * @param point - Where the body stands.
 * @param field - The walk field; only its blockers are consulted.
 * @param radius - Radius of the body on the plan, in metres.
 * @returns `true` when no blocker, grown by the radius, strictly contains the
 *   point. Says nothing about there being floor underneath: that is
 *   {@link WalkField.floor}, and a fall cell is clear of every blocker.
 */
export function isClear(point: PlanPoint, field: WalkField, radius: number): boolean {
  return !field.blockers.some(
    (rect) =>
      point.x > rect.minX - radius + LENGTH_TOLERANCE &&
      point.x < rect.maxX + radius - LENGTH_TOLERANCE &&
      point.z > rect.minZ - radius + LENGTH_TOLERANCE &&
      point.z < rect.maxZ + radius - LENGTH_TOLERANCE,
  );
}
