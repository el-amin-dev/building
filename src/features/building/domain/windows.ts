/**
 * The windows of the typical floor: where the floor plan is glazed, and how big
 * each opening is.
 *
 * Windows are not drawn one by one in the brief: ADR-006 and the owner answer of
 * 2026-09-11 give a rule instead. Every window is 1.20 m wide and 1.20 m tall,
 * from `FloorHeights.windowSill` (0.90 m) to `FloorHeights.windowHead` (2.10 m),
 * and glazing is allowed only where a room looks at open air on side A (the
 * `minX` faces, brief §5.1) or side B (the `maxZ` faces, brief §5.2). Sides C
 * and D are the neighbouring plots: the rooms that face only those sides — the
 * living room and the two kids bedrooms — get electric light instead of a window
 * (ADR-006).
 *
 * This module derives the whole window list from the plan, the wall thicknesses
 * and the port schedule, so a room that moves, a wall that changes thickness or
 * a door that slides along a facade moves or drops its window with no edit here.
 * Nothing is hard-coded per room.
 *
 * Coordinates are in metres, with the plan conventions of `floorPlan/types.ts`.
 */

import { getJoinThickness, getNeighbours, getSpace } from './floorPlan/index.ts';
import type { FloorPlan, Space, SpaceId, SpaceKind } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { CENTIMETRES_PER_METRE, LENGTH_TOLERANCE, makeRect, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import type { Port } from './ports/types.ts';
import { WALL_SPEC } from './wallSpec.ts';

const HALF = 0.5;

/** Plan size of every window opening, in metres (ADR-006, owner answer 2026-09-11). */
export interface WindowSpec {
  /** Clear width of a window along its wall, in metres. */
  readonly width: 1.2;
  /**
   * Smallest solid wall a window keeps between itself and a door in the same
   * face, in metres: a door span is widened by this much on both sides before
   * the remaining wall is offered to a window.
   */
  readonly minJamb: 0.1;
}

/**
 * The one window size of the floor: 1.20 m wide, with a 0.10 m jamb against any
 * door in the same wall (ADR-006, owner answer 2026-09-11). Frozen.
 *
 * The height is not repeated here: it is `FloorHeights.windowSill` to
 * `FloorHeights.windowHead`, read from `heights.ts` like every other vertical
 * building size.
 */
export const WINDOW_SPEC: WindowSpec = Object.freeze({ width: 1.2, minJamb: 0.1 });

/**
 * A face of a room that may be glazed: `minX` looks toward side A, `maxZ` toward
 * side B (brief §5.1, §5.2).
 *
 * The `minZ` and `maxX` faces — sides C and D — are deliberately absent: they
 * look at the neighbouring plots and are never glazed (ADR-006).
 */
export type WindowSide = 'minX' | 'maxZ';

/** The glazeable faces, in the order `getWindows` reports them. Frozen. */
const WINDOW_SIDES: readonly WindowSide[] = Object.freeze(['minX', 'maxZ']);

/** The kinds of space a wall may be glazed against: both are open to the weather. */
const OPEN_AIR_KINDS: readonly SpaceKind[] = Object.freeze(['openAir', 'void']);

/** One window of the floor. */
export interface FloorWindow {
  /** The room the window belongs to; always a space of kind `'room'`. */
  readonly spaceId: SpaceId;
  /** Which face of the room is glazed. */
  readonly side: WindowSide;
  /**
   * Start of the window along its face, in metres: a z coordinate on a `minX`
   * face, an x coordinate on a `maxZ` face.
   */
  readonly spanMin: number;
  /** End of the window along its face, `spanMin + WINDOW_SPEC.width`, in metres. */
  readonly spanMax: number;
  /**
   * The hole in the wall: the window span across the full thickness of the wall
   * it pierces, from `heights.windowSill` up to `heights.windowHead`.
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

/** A stretch of one face that fronts open air, with the wall it would pierce. */
interface ExposedRun extends Span {
  /** Coordinate of the face itself: an x for a `minX` face, a z for a `maxZ` face. */
  readonly faceAt: number;
  /** Thickness of the wall across that face, in metres. */
  readonly thickness: number;
}

/**
 * Returns the coordinate of one face of a rect.
 *
 * @param rect - The rectangle.
 * @param side - Which face to locate.
 * @returns `rect.minX` for a `minX` face, `rect.maxZ` for a `maxZ` face, in metres.
 */
function faceCoordinate(rect: PlanRect, side: WindowSide): number {
  return side === 'minX' ? rect.minX : rect.maxZ;
}

/**
 * Returns the extent of one face of a rect, along the face.
 *
 * @param rect - The rectangle.
 * @param side - Which face to measure.
 * @returns The z extent of a `minX` face, the x extent of a `maxZ` face, in metres.
 */
function faceExtent(rect: PlanRect, side: WindowSide): Span {
  return side === 'minX' ? { min: rect.minZ, max: rect.maxZ } : { min: rect.minX, max: rect.maxX };
}

/**
 * Tells whether a face of a rect lies on the exterior envelope of the floor.
 *
 * A `minX` face is on side A when nothing of the plan lies west of it, i.e. it
 * sits at the west edge of the clear interior; a `maxZ` face is on side B when
 * it sits at the south edge. Both are read from `plan.interior`, never from a
 * coordinate written here.
 *
 * @param plan - The floor plan, for its clear interior.
 * @param faceAt - Coordinate of the face, in metres.
 * @param side - Which face it is.
 * @returns `true` when the face is the inside of an exterior wall on side A or B.
 */
function isExteriorFace(plan: FloorPlan, faceAt: number, side: WindowSide): boolean {
  return side === 'minX'
    ? faceAt <= plan.interior.minX + LENGTH_TOLERANCE
    : faceAt >= plan.interior.maxZ - LENGTH_TOLERANCE;
}

/**
 * Lists the stretches of one face of a room that front open air or the exterior.
 *
 * A stretch is exposed when what lies across the wall is a space of kind
 * `'openAir'` or `'void'` (a balcony or the void over the side-B strip), or the
 * exterior wall of side A or B. Everything else — another room, a corridor, the
 * blind corner between two spaces — is not glazeable.
 *
 * @param plan - The floor plan.
 * @param space - The room whose face is inspected.
 * @param side - Which face of the room to inspect.
 * @returns One run per exposed stretch, in no particular order; empty when the
 *   face never fronts open air.
 */
function findExposedRuns(plan: FloorPlan, space: Space, side: WindowSide): ExposedRun[] {
  const contacts = getNeighbours(plan, space.id);
  return space.rects.flatMap((rect, rectIndex) => {
    const faceAt = faceCoordinate(rect, side);
    if (isExteriorFace(plan, faceAt, side)) {
      const extent = faceExtent(rect, side);
      return [{ ...extent, faceAt, thickness: WALL_SPEC.exterior }];
    }
    return contacts
      .filter(
        (contact) =>
          contact.side === side &&
          contact.rectIndex === rectIndex &&
          OPEN_AIR_KINDS.includes(getSpace(plan, contact.neighbourId).kind),
      )
      .map((contact) => ({
        min: contact.spanMin,
        max: contact.spanMax,
        faceAt,
        thickness: getJoinThickness(plan, space, getSpace(plan, contact.neighbourId)),
      }));
  });
}

/**
 * Joins the exposed runs that continue one another into single runs.
 *
 * Two runs merge when they lie in the same wall — the same face coordinate and
 * the same thickness — and touch or overlap. The kitchen's side-B face, for
 * example, fronts the west void up to x 12.70 and the balcony slab beyond it,
 * which is one 4.00 m stretch of wall rather than two.
 *
 * @param runs - The exposed runs of one face.
 * @returns The merged runs, sorted within each wall by `min`.
 */
function mergeRuns(runs: readonly ExposedRun[]): ExposedRun[] {
  const merged: ExposedRun[] = [];
  [...runs]
    .sort((a, b) => a.faceAt - b.faceAt || a.thickness - b.thickness || a.min - b.min)
    .forEach((run) => {
      const last = merged.at(-1);
      const sameWall =
        last !== undefined &&
        Math.abs(last.faceAt - run.faceAt) <= LENGTH_TOLERANCE &&
        Math.abs(last.thickness - run.thickness) <= LENGTH_TOLERANCE;
      if (sameWall && run.min <= last.max + LENGTH_TOLERANCE) {
        merged[merged.length - 1] = { ...last, max: Math.max(last.max, run.max) };
        return;
      }
      merged.push(run);
    });
  return merged;
}

/**
 * Lists the spans of one face of a room that a passage already occupies.
 *
 * A port lies in the inspected face when it connects the room to a space that
 * touches that very face, and its width runs along the face. Openings with no
 * leaf count as well as doors: both interrupt the wall the window would need.
 * Each span is widened by `WINDOW_SPEC.minJamb` on both sides, so the wall a
 * window is offered already includes its jambs.
 *
 * @param plan - The floor plan.
 * @param space - The room whose face is inspected.
 * @param side - Which face of the room to inspect.
 * @param ports - The port schedule of the floor.
 * @returns The blocked spans along the face, jambs included, in schedule order.
 */
function findBlockedSpans(
  plan: FloorPlan,
  space: Space,
  side: WindowSide,
  ports: readonly Port[],
): Span[] {
  const faceAxis = side === 'minX' ? 'z' : 'x';
  const faceNeighbours = new Set(
    getNeighbours(plan, space.id)
      .filter((contact) => contact.side === side)
      .map((contact) => contact.neighbourId),
  );
  return ports
    .filter((port) => {
      if (port.along !== faceAxis || !port.spaces.includes(space.id)) {
        return false;
      }
      const [first, second] = port.spaces;
      return faceNeighbours.has(first === space.id ? second : first);
    })
    .map((port) => ({
      min: port.spanMin - WINDOW_SPEC.minJamb,
      max: port.spanMin + port.width + WINDOW_SPEC.minJamb,
    }));
}

/**
 * Removes the blocked spans from a run, leaving the free stretches of wall.
 *
 * @param run - The exposed run to cut.
 * @param blocked - The spans a passage occupies, jambs included.
 * @returns The remaining stretches, in order along the face; empty when the
 *   passages cover the whole run.
 */
function subtractBlocked(run: Span, blocked: readonly Span[]): Span[] {
  let free: Span[] = [{ min: run.min, max: run.max }];
  blocked.forEach((block) => {
    free = free.flatMap((span) => {
      if (block.max <= span.min + LENGTH_TOLERANCE || block.min >= span.max - LENGTH_TOLERANCE) {
        return [span];
      }
      const parts: Span[] = [];
      if (block.min - span.min > LENGTH_TOLERANCE) {
        parts.push({ min: span.min, max: block.min });
      }
      if (span.max - block.max > LENGTH_TOLERANCE) {
        parts.push({ min: block.max, max: span.max });
      }
      return parts;
    });
  });
  return free;
}

/**
 * Centres a span of a given width in a run, on the centimetre plan grid.
 *
 * The arithmetic is done in whole centimetres rather than in metres because the
 * centre of a run often falls on a half-centimetre — the master bedroom's free
 * run z 0.30–1.75 centres a 1.20 m window at exactly 0.425 — and in metres the
 * floating-point noise of that sum decides the rounding instead of the
 * documented rule of `toPlanLength`. Every input lies on the centimetre grid
 * (plan data, port spans and `WINDOW_SPEC` all do), so scaling by
 * `CENTIMETRES_PER_METRE` and rounding recovers the exact grid value. The half
 * is then rounded up, which for the non-negative slack of a run that fits is the
 * same "halves away from zero" rule `toPlanLength` follows.
 *
 * @param run - The free stretch of wall, in metres.
 * @param width - Width of the span to place, in metres.
 * @returns The centred span, on the centimetre grid, in metres.
 */
function centreSpan(run: Span, width: number): Span {
  const startCm = Math.round(run.min * CENTIMETRES_PER_METRE);
  const runCm = Math.round(run.max * CENTIMETRES_PER_METRE) - startCm;
  const widthCm = Math.round(width * CENTIMETRES_PER_METRE);
  const minCm = startCm + Math.round((runCm - widthCm) * HALF);
  return {
    min: minCm / CENTIMETRES_PER_METRE,
    max: (minCm + widthCm) / CENTIMETRES_PER_METRE,
  };
}

/**
 * Builds the hole a window makes in its wall.
 *
 * @param side - Which face the window is in.
 * @param faceAt - Coordinate of that face, in metres.
 * @param thickness - Thickness of the wall the window pierces, in metres.
 * @param span - The window span along the face, in metres.
 * @param heights - Vertical sizes of the floor.
 * @returns A frozen box: the span across the whole wall thickness, from the sill
 *   to the head.
 */
function makeOpening(
  side: WindowSide,
  faceAt: number,
  thickness: number,
  span: Span,
  heights: FloorHeights,
): PlanBox {
  const rect =
    side === 'minX'
      ? makeRect(toPlanLength(faceAt - thickness), faceAt, span.min, span.max)
      : makeRect(span.min, span.max, faceAt, toPlanLength(faceAt + thickness));
  return makeBox(rect, heights.windowSill, heights.windowHead);
}

/**
 * Places the window of one face of a room, if the face can take one.
 *
 * The longest free stretch of the face wins; a tie keeps the first one found,
 * walking the rects of the room in plan order. The window is centred in that
 * stretch and snapped onto the centimetre plan grid, so its span stays
 * comparable with the drawn plan data.
 *
 * @param plan - The floor plan.
 * @param space - The room to glaze.
 * @param side - Which face of the room to glaze.
 * @param ports - The port schedule of the floor.
 * @param heights - Vertical sizes of the floor.
 * @returns The window, or `undefined` when no free stretch of the face is at
 *   least `WINDOW_SPEC.width` long.
 */
function placeWindow(
  plan: FloorPlan,
  space: Space,
  side: WindowSide,
  ports: readonly Port[],
  heights: FloorHeights,
): FloorWindow | undefined {
  const blocked = findBlockedSpans(plan, space, side, ports);
  let best: ExposedRun | undefined;
  mergeRuns(findExposedRuns(plan, space, side)).forEach((run) => {
    subtractBlocked(run, blocked).forEach((free) => {
      if (best === undefined || free.max - free.min > best.max - best.min + LENGTH_TOLERANCE) {
        best = { ...run, min: free.min, max: free.max };
      }
    });
  });
  if (best === undefined || best.max - best.min < WINDOW_SPEC.width - LENGTH_TOLERANCE) {
    return undefined;
  }
  const span = centreSpan(best, WINDOW_SPEC.width);
  return Object.freeze({
    spaceId: space.id,
    side,
    spanMin: span.min,
    spanMax: span.max,
    opening: makeOpening(side, best.faceAt, best.thickness, span, heights),
  });
}

/**
 * Derives every window of a floor.
 *
 * Only spaces of kind `'room'` are glazed: a balcony, the void and the
 * circulation spaces never carry a window, however much open air they front.
 * Each room is offered its `minX` face (toward side A) and its `maxZ` face
 * (toward side B), and gets at most one window per face — a room facing both
 * gets two.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param ports - The port schedule of the floor, whose doors and openings the
 *   windows keep clear of. Not mutated.
 * @param heights - Vertical sizes of the floor; defaults to `FLOOR_HEIGHTS`.
 * @returns A frozen array of frozen windows, in the plan order of the spaces and
 *   with the `minX` window of a room before its `maxZ` one.
 */
export function getWindows(
  plan: FloorPlan,
  ports: readonly Port[],
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly FloorWindow[] {
  const windows = plan.spaces
    .filter((space) => space.kind === 'room')
    .flatMap((space) =>
      WINDOW_SIDES.flatMap((side) => placeWindow(plan, space, side, ports, heights) ?? []),
    );
  return Object.freeze(windows);
}
