/**
 * Solid wall geometry of the floor, derived from the source of truth.
 *
 * The owner's plan (`sourceOfTruth/plan.ts`) describes every space by its clear
 * (inner) rectangles; the walls are the solid left between them, plus the
 * exterior walls between the outermost clear faces and the plot boundary. This
 * module turns that negative space into boxes: it cuts the plot on the grid of
 * every clear face, keeps the cells no space covers, gives each cell its height,
 * punches the ports and windows out of it, and merges the result into as few
 * boxes as possible.
 *
 * WHY a thickness per stretch and not per wall. A wall used to have one
 * thickness for its whole length, and it does not any more. Isolation is now a
 * width — a wall the owner named for sound and heat is built 0.30, a plain
 * separator 0.15 — so one face is commonly heavy where it faces weather or an
 * isolated room and thin where it faces an ordinary one. The utility room's west
 * face is 0.30 against the corridor, 0.15 against the main sanitair and 0.20
 * against the east void; the kitchen's west face is 0.30 where it wraps the
 * guest room and 0.15 where it only divides that room's bathroom. Both are
 * right. A single rectangle at the wall's thickness overruns the thin stretches,
 * so {@link deriveWalls} tiles every face with {@link WallContact} stretches and
 * {@link getWallSolids} gives one solid per stretch. `DerivedWall.thickness` is
 * the THICKEST contact, kept for quantities and takeoff; it must not be used to
 * draw.
 *
 * WHY the grid still reads the negative space rather than those solids: a
 * stretch belongs to the span of one room's face, and the blocks where an
 * interior wall lands on another belong to no face's span at all — the four plot
 * corners among them. Building the footprint from the stretches alone would
 * leave a notch at every junction. The two agree by construction wherever they
 * overlap, because both read the same thing: the gap the rects actually leave.
 *
 * WHY a low wall is stated and not inferred. Every wall rises to `heights.wall`
 * except the faces the spec names in `PARAPET_WALLS`, which are built to the
 * height it states for them. This module used to infer a parapet instead, by
 * testing whether a cell's every side faced open air or the void. That test
 * found nothing at all once side B became a normal exterior wall, and the
 * side-A balcony's balustrade — 1.10 m, and the thing that makes that balcony
 * the open side of the floor — would have been built full height, quietly
 * closing the balcony in. A wall you can see over and fall past is exactly the
 * wall that has to be stated rather than deduced from whatever happens to stand
 * beside it. It is the same choice already made for thickness, where measuring
 * the gap the rects leave beat inferring one from the kinds of the two rooms.
 *
 * A named face keeps its height to its own ends. Its stretches are its own
 * (`getWallSolids`), so the masonry where another wall lands beyond them is not
 * part of it: the balustrade runs 1.00 for its whole 9.40, and the two 0.30 m
 * corner blocks past its ends belong to the side-C and side-B envelope walls and
 * close them at full height. Heights are no longer inherited from a neighbour at
 * all — the junction rule that takes the greater of two still governs thickness
 * and isolation, where it belongs, and nothing there changed.
 *
 * Every wall starts at the underside of the slab, which this module takes from
 * `getSlabThickness` (`slabs.ts`) rather than deriving again, so that the two
 * modules agree on that level exactly; a cross-section therefore stays closed
 * and a doorway keeps a threshold.
 *
 * Openings are not placed here. `ports/` and `windows.ts` own the schedule and
 * hand this module the holes as boxes, so a door is one door with one set of
 * coordinates rather than a second copy derived from the spec.
 *
 * Pure geometry: no React and no three.
 */
import type { FloorPlan } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectContainsPoint,
  toPlanLength,
} from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { getSlabThickness } from './slabs.ts';
import {
  FLOOR_NUMBER,
  INSULATED_WALLS,
  JOIN_OVERRIDES,
  PARAPET_WALLS,
  ROOMS,
} from './sourceOfTruth/plan.ts';
import { WALL_SPEC } from './wallSpec.ts';
import type { WallSpec } from './wallSpec.ts';

/** Half of something, for midpoints. */
const HALF = 0.5;

/** Number of digits a room number is padded to in a matricule. */
const ROOM_NUMBER_DIGITS = 2;

/** The kinds of space whose wall is weather-exposed, and so built like the envelope. */
const WEATHER_EXPOSED_KINDS: readonly string[] = Object.freeze(['openAir', 'void']);

/* ------------------------------------------------------------------ *
 * The source of truth, as this module reads it.
 * ------------------------------------------------------------------ */

/** Clear rect coordinates of the spec, as `[minX, maxX, minZ, maxZ]`, in metres. */
type SpecRectCoordinates = readonly number[];

/** One space of the spec, with the fields the wall derivation reads. */
interface SpecRoom {
  /** Room number, which orders the matricules and settles which face owns a shared door. */
  readonly n: number;
  /** Identifier of the space. */
  readonly id: string;
  /** Human-readable name, used to say what a wall faces. */
  readonly name: string;
  /** Three-letter type of the space, which the matricule carries. */
  readonly type: string;
  /** Kind of the space: `'room'`, `'circulation'`, `'stairwell'`, `'openAir'` or `'void'`. */
  readonly kind: string;
  /** Clear rects covering the space. */
  readonly rects: readonly SpecRectCoordinates[];
}

/** A wall thickness the geometry would not predict, stated by the spec. */
interface SpecJoinOverride {
  /** The two space ids whose shared wall is overridden, in either order. */
  readonly between: readonly string[];
  /** Thickness of that wall, in metres; zero where there is no wall at all. */
  readonly thickness: number;
}

/** One face the owner named for sound and heat isolation. */
interface SpecInsulatedWall {
  /** Matricule of the named face, as {@link deriveWalls} numbers it. */
  readonly matricule: string;
}

/** One face the spec names as stopping below the ceiling. */
interface SpecParapetWall {
  /** Matricule of the named face, as {@link deriveWalls} numbers it. */
  readonly matricule: string;
  /** Height of its top above the finished floor, in metres. */
  readonly height: number;
}

/**
 * Everything the wall derivation needs from the source of truth.
 *
 * The single adapter between this module and `sourceOfTruth/plan.ts`: nothing
 * else here reaches into the spec, so the day the spec is reshaped this object
 * is the only thing that moves.
 */
interface FloorSpec {
  /** Floor number, which every matricule starts with. */
  readonly floorNumber: number;
  /** The thicknesses the kind rule falls back on. */
  readonly walls: WallSpec;
  /** Every space of the floor, in matricule order. */
  readonly rooms: readonly SpecRoom[];
  /** The thicknesses that deviate from what the geometry says. */
  readonly joinOverrides: readonly SpecJoinOverride[];
  /** The faces the owner named for isolation. */
  readonly insulatedWalls: readonly SpecInsulatedWall[];
  /** The faces that stop below the ceiling, with the height each is built to. */
  readonly parapetWalls: readonly SpecParapetWall[];
}

/** The typical floor, as declared by the owner. Frozen. */
const FLOOR_SPEC: FloorSpec = Object.freeze({
  floorNumber: FLOOR_NUMBER,
  walls: WALL_SPEC,
  rooms: ROOMS,
  joinOverrides: JOIN_OVERRIDES,
  insulatedWalls: INSULATED_WALLS,
  parapetWalls: PARAPET_WALLS,
});

/* ------------------------------------------------------------------ *
 * Derived walls: the faces of the floor and the stretches they are built from.
 * ------------------------------------------------------------------ */

/** Side of a room the wall face sits on, named after the direction it looks. */
export type WallSide = 'north' | 'south' | 'east' | 'west';

/** The plan axis a wall runs along; not the axis it faces. */
export type WallAxis = 'x' | 'z';

/** Side → the axis the wall RUNS along (not the axis it faces). */
const AXIS_OF: Readonly<Record<WallSide, WallAxis>> = Object.freeze({
  north: 'x',
  south: 'x',
  east: 'z',
  west: 'z',
});

/** Opposite face of the same physical wall. */
const OPPOSITE_SIDE: Readonly<Record<WallSide, WallSide>> = Object.freeze({
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
});

/**
 * Why a stretch of wall is built the thickness it is.
 *
 * - `'exterior'`: it is on the envelope, and the envelope is 0.30 whatever is
 *   behind it;
 * - `'join override'`: the spec states a thickness the geometry would not
 *   predict, a zero-thickness join among them;
 * - `'weather-exposed'`: one side is a balcony or a void;
 * - `'isolation'`: the owner named this wall for sound and heat;
 * - `'plain separator'`: it divides two ordinary spaces and nothing more;
 * - `'no facing space'`: nothing backs onto it — a corner, or the return where
 *   another wall lands.
 */
export type ContactReason =
  | 'exterior'
  | 'join override'
  | 'weather-exposed'
  | 'isolation'
  | 'plain separator'
  | 'no facing space';

/** One stretch of a wall face: what it looks at, over what span, built how thick. */
export interface WallContact {
  /** Id of the space on the far side, or `null` for the envelope and for a return. */
  readonly neighbourId: string | null;
  /** Start of the stretch along the wall axis, in metres. */
  readonly spanMin: number;
  /** End of the stretch along the wall axis, in metres. */
  readonly spanMax: number;
  /** Length of the stretch, in metres. */
  readonly length: number;
  /** Thickness of the wall over this stretch, in metres. */
  readonly thickness: number;
  /** The rule that explains {@link WallContact.thickness}. */
  readonly reason: ContactReason;
}

/**
 * One face of one room, with the stretches it is actually built from.
 *
 * A wall is reported once per room FACE, at the coordinate of that room's own
 * face — not once per pair of rooms. Two rooms sharing a partition therefore
 * yield two walls, which is what lets a room be dimensioned, built and surveyed
 * on its own.
 */
export interface DerivedWall {
  /** `F1-R11-KIT-W3`: floor, zero-padded room number, room type, wall number. */
  readonly matricule: string;
  /** Number of the room this face belongs to. */
  readonly roomN: number;
  /** Id of the room this face belongs to. */
  readonly roomId: string;
  /** Three-letter type of that room. */
  readonly type: string;
  /** Wall number within the room, clockwise from the north face. */
  readonly wallN: number;
  /** Side of the room this face sits on. */
  readonly side: WallSide;
  /** The axis the face runs along. */
  readonly axis: WallAxis;
  /** Coordinate of the face on the axis it faces, in metres. */
  readonly at: number;
  /** Start of the face along its axis, in metres. */
  readonly spanMin: number;
  /** End of the face along its axis, in metres. */
  readonly spanMax: number;
  /** Length of the face, in metres. */
  readonly length: number;
  /**
   * The THICKEST contact, in metres, for quantities and takeoff. Never for
   * drawing: a face that changes thickness along its length would be overrun.
   * Draw from {@link DerivedWall.contacts}.
   */
  readonly thickness: number;
  /** Whether the face is more than one thickness along its length. */
  readonly varies: boolean;
  /** Whether the face is on the exterior envelope. */
  readonly exterior: boolean;
  /** What the face looks at, in words, for a schedule or a tooltip. */
  readonly faces: string;
  /** Ids of the spaces the face looks at, in room order. */
  readonly neighbours: readonly string[];
  /** The stretches of the face, in order along the axis, tiling its whole span. */
  readonly contacts: readonly WallContact[];
}

/** One built solid: the stretch of wall a single {@link WallContact} stands for. */
export interface WallSolid {
  /** Footprint of the solid, in plan coordinates. */
  readonly rect: PlanRect;
  /** Matricule of the face the solid was derived from. */
  readonly matricule: string;
  /** Thickness of the solid, in metres. */
  readonly thickness: number;
  /** The rule that explains that thickness. */
  readonly reason: ContactReason;
  /** Whether the owner wants this stretch built heavy for sound and heat. */
  readonly insulated: boolean;
}

/* ------------------------------------------------------------------ *
 * Spans along one face.
 * ------------------------------------------------------------------ */

/** A run along one axis, in metres. */
interface Span {
  /** Start of the run. */
  readonly min: number;
  /** End of the run. */
  readonly max: number;
}

/**
 * Tells whether two lengths are the same on the centimetre grid.
 *
 * @param a - First length, in metres.
 * @param b - Second length, in metres.
 * @returns `true` when they differ by no more than {@link LENGTH_TOLERANCE}.
 */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= LENGTH_TOLERANCE;
}

/**
 * Unions spans, merging anything that touches.
 *
 * Touching counts as merging on purpose: that is exactly the "merged where
 * collinear and adjacent" rule, and it is what turns a room's two rects into one
 * face.
 *
 * @param spans - The spans to union, in any order.
 * @returns The merged spans, ascending and disjoint.
 */
function mergeSpans(spans: readonly Span[]): readonly Span[] {
  const merged: { min: number; max: number }[] = [];
  [...spans]
    .sort((a, b) => a.min - b.min)
    .forEach((span) => {
      const last = merged.at(-1);
      if (last !== undefined && span.min <= last.max + LENGTH_TOLERANCE) {
        last.max = Math.max(last.max, span.max);
        return;
      }
      merged.push({ min: span.min, max: span.max });
    });
  return merged;
}

/**
 * Removes holes from a span.
 *
 * @param span - The span to cut.
 * @param holes - The spans to remove, in any order.
 * @returns The pieces that survive, ascending.
 */
function subtractSpans(span: Span, holes: readonly Span[]): readonly Span[] {
  return mergeSpans(holes).reduce<readonly Span[]>(
    (pieces, hole) => {
      return pieces.flatMap((piece) => {
        if (hole.max <= piece.min + LENGTH_TOLERANCE || hole.min >= piece.max - LENGTH_TOLERANCE) {
          return [piece];
        }
        const parts: Span[] = [];
        if (hole.min > piece.min + LENGTH_TOLERANCE) {
          parts.push({ min: piece.min, max: hole.min });
        }
        if (hole.max < piece.max - LENGTH_TOLERANCE) {
          parts.push({ min: hole.max, max: piece.max });
        }
        return parts;
      });
    },
    [span],
  );
}

/**
 * Returns the overlap of two spans.
 *
 * @param a - First span.
 * @param b - Second span.
 * @returns The shared run, or `undefined` when they only touch or miss.
 */
function overlapSpan(a: Span, b: Span): Span | undefined {
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  return max - min > LENGTH_TOLERANCE ? { min, max } : undefined;
}

/* ------------------------------------------------------------------ *
 * The outline of a room, walked clockwise.
 * ------------------------------------------------------------------ */

/** One edge of a room outline: the side it is, where it sits, and what it spans. */
interface Edge {
  /** Side of the room the edge sits on. */
  readonly side: WallSide;
  /** Coordinate of the edge on the axis it faces, in metres. */
  readonly at: number;
  /** Extent of the edge along its own axis, in metres. */
  readonly span: Span;
}

/** An outline edge with the two ends of its clockwise walk. */
interface DirectedEdge extends Edge {
  /** Where the clockwise walk enters the edge. */
  readonly start: PlanPoint;
  /** Where the clockwise walk leaves it. */
  readonly end: PlanPoint;
}

/**
 * Reads one clear rect of the spec.
 *
 * @param coordinates - The rect as `[minX, maxX, minZ, maxZ]`, in metres.
 * @returns The same rect as a frozen {@link PlanRect}.
 */
function specRect(coordinates: SpecRectCoordinates): PlanRect {
  return makeRect(coordinates[0], coordinates[1], coordinates[2], coordinates[3]);
}

/**
 * Reads every clear rect of one space.
 *
 * @param room - The space to read.
 * @returns Its rects, in spec order.
 */
function roomRects(room: SpecRoom): readonly PlanRect[] {
  return room.rects.map(specRect);
}

/**
 * Returns the outline edges of a room: every rect face, minus the part of it
 * that has more of the SAME room on the outside (an internal seam is not a
 * wall), then merged per face line.
 *
 * A plain rectangle gives four edges; a room drawn as two rects gives six.
 *
 * @param rects - The clear rects of one room.
 * @returns The outline edges, unordered, snapped to the centimetre grid.
 */
function outlineEdges(rects: readonly PlanRect[]): readonly Edge[] {
  const candidates: readonly Edge[] = rects.flatMap((rect) => [
    { side: 'north', at: rect.minZ, span: { min: rect.minX, max: rect.maxX } },
    { side: 'south', at: rect.maxZ, span: { min: rect.minX, max: rect.maxX } },
    { side: 'east', at: rect.maxX, span: { min: rect.minZ, max: rect.maxZ } },
    { side: 'west', at: rect.minX, span: { min: rect.minZ, max: rect.maxZ } },
  ]);

  const kept = candidates.flatMap((edge) => {
    const seams = rects.flatMap((rect) => {
      if (edge.side === 'north' && near(rect.maxZ, edge.at)) {
        return [{ min: rect.minX, max: rect.maxX }];
      }
      if (edge.side === 'south' && near(rect.minZ, edge.at)) {
        return [{ min: rect.minX, max: rect.maxX }];
      }
      if (edge.side === 'east' && near(rect.minX, edge.at)) {
        return [{ min: rect.minZ, max: rect.maxZ }];
      }
      if (edge.side === 'west' && near(rect.maxX, edge.at)) {
        return [{ min: rect.minZ, max: rect.maxZ }];
      }
      return [];
    });
    return subtractSpans(edge.span, seams)
      .filter((span) => span.max - span.min > LENGTH_TOLERANCE)
      .map((span) => ({ side: edge.side, at: edge.at, span }));
  });

  const byFace = new Map<string, { side: WallSide; at: number; spans: Span[] }>();
  kept.forEach((edge) => {
    const key = `${edge.side}@${String(toPlanLength(edge.at))}`;
    const face = byFace.get(key) ?? { side: edge.side, at: edge.at, spans: [] };
    face.spans.push(edge.span);
    byFace.set(key, face);
  });

  return [...byFace.values()].flatMap((face) =>
    mergeSpans(face.spans).map((span) => ({
      side: face.side,
      at: toPlanLength(face.at),
      span: { min: toPlanLength(span.min), max: toPlanLength(span.max) },
    })),
  );
}

/**
 * Returns the two ends of an edge walked CLOCKWISE seen from above, with x to
 * the east and z to the south: north runs +x, east +z, south −x, west −z.
 *
 * @param edge - The outline edge.
 * @returns Where the walk enters and leaves it.
 */
function directedEnds(edge: Edge): { readonly start: PlanPoint; readonly end: PlanPoint } {
  const { side, at, span } = edge;
  if (side === 'north') {
    return { start: { x: span.min, z: at }, end: { x: span.max, z: at } };
  }
  if (side === 'east') {
    return { start: { x: at, z: span.min }, end: { x: at, z: span.max } };
  }
  if (side === 'south') {
    return { start: { x: span.max, z: at }, end: { x: span.min, z: at } };
  }
  return { start: { x: at, z: span.max }, end: { x: at, z: span.min } };
}

/**
 * Formats a plan point as a map key.
 *
 * @param point - The point.
 * @returns A key unique to that position on the centimetre grid.
 */
function pointKey(point: PlanPoint): string {
  return `${String(toPlanLength(point.x))},${String(toPlanLength(point.z))}`;
}

/**
 * Walks a room outline clockwise from its northernmost north edge, so that W1 is
 * a north face and the numbering is stable across edits.
 *
 * WHY it throws rather than returns what it has: the assumption this module
 * makes about the spec is that the rects of one room form a single
 * simply-connected rectilinear outline. Emitting a plausible-looking wrong
 * outline would put a wall somewhere no wall is.
 *
 * @param edges - The outline edges of one room.
 * @param roomId - Id of that room, for the error message.
 * @returns The edges in clockwise order.
 * @throws RangeError naming the room when its rects overlap or pinch, when it
 *   has no north edge, or when the outline is not one closed loop.
 */
function orderClockwise(edges: readonly Edge[], roomId: string): readonly DirectedEdge[] {
  const directed: readonly DirectedEdge[] = edges.map((edge) => ({
    ...edge,
    ...directedEnds(edge),
  }));
  const byStart = new Map<string, DirectedEdge>();
  directed.forEach((edge) => {
    const key = pointKey(edge.start);
    if (byStart.has(key)) {
      throw new RangeError(
        `room "${roomId}": two outline edges leave ${key} — its rects overlap or pinch`,
      );
    }
    byStart.set(key, edge);
  });

  const norths = directed
    .filter((edge) => edge.side === 'north')
    .sort((a, b) => a.at - b.at || a.span.min - b.span.min);
  const first = norths[0];
  if (first === undefined) {
    throw new RangeError(`room "${roomId}": its outline has no north edge to start the walk from`);
  }

  const ordered: DirectedEdge[] = [];
  const seen = new Set<DirectedEdge>();
  let current: DirectedEdge | undefined = first;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    ordered.push(current);
    current = byStart.get(pointKey(current.end));
  }
  if (ordered.length !== directed.length) {
    throw new RangeError(
      `room "${roomId}": its outline is not one closed loop (walked ${String(ordered.length)} of ${String(directed.length)} edges)`,
    );
  }
  return ordered;
}

/* ------------------------------------------------------------------ *
 * What a face looks at.
 * ------------------------------------------------------------------ */

/** One face of a room, before its stretches are known. */
interface Face {
  /** Number of the room the face belongs to. */
  readonly roomN: number;
  /** Side of the room the face sits on. */
  readonly side: WallSide;
  /** Coordinate of the face on the axis it faces. */
  readonly at: number;
  /** Start of the face along its axis. */
  readonly spanMin: number;
  /** End of the face along its axis. */
  readonly spanMax: number;
}

/** A space on the far side of a face, and where it is. */
interface Neighbour {
  /** The space itself. */
  readonly room: SpecRoom;
  /** Distance from the face to that space, in metres: the gap the rects leave. */
  readonly gap: number;
  /** The stretches of the face that look at it, ascending and disjoint. */
  readonly spans: readonly Span[];
}

/**
 * Returns the spaces on the far side of a face, worked out geometrically: a rect
 * whose own opposite face is on the outward side, no further than one exterior
 * wall away, and whose span genuinely overlaps (touching at a point is not
 * "facing").
 *
 * Geometric, because the spec never names wall pairs — only the ports and the
 * windows do, and those are placed against the walls this derivation produces.
 *
 * @param face - The face to look out from.
 * @param rooms - Every space of the floor.
 * @param maxGap - Widest gap that still counts as one wall, in metres.
 * @returns The neighbours, in room order.
 */
function facingSpaces(
  face: Face,
  rooms: readonly SpecRoom[],
  maxGap: number,
): readonly Neighbour[] {
  const hits = new Map<number, { room: SpecRoom; gap: number; spans: Span[] }>();
  rooms.forEach((other) => {
    if (other.n === face.roomN) {
      return;
    }
    roomRects(other).forEach((rect) => {
      const alongX = face.side === 'north' || face.side === 'south';
      const gap =
        face.side === 'north'
          ? face.at - rect.maxZ
          : face.side === 'south'
            ? rect.minZ - face.at
            : face.side === 'east'
              ? rect.minX - face.at
              : face.at - rect.maxX;
      if (gap < -LENGTH_TOLERANCE || gap > maxGap + LENGTH_TOLERANCE) {
        return;
      }
      const theirSpan: Span = alongX
        ? { min: rect.minX, max: rect.maxX }
        : { min: rect.minZ, max: rect.maxZ };
      const shared = overlapSpan(theirSpan, { min: face.spanMin, max: face.spanMax });
      if (shared === undefined) {
        return;
      }
      const entry = hits.get(other.n) ?? { room: other, gap: toPlanLength(gap), spans: [] };
      entry.gap = Math.min(entry.gap, toPlanLength(gap));
      entry.spans.push(shared);
      hits.set(other.n, entry);
    });
  });
  return [...hits.values()]
    .sort((a, b) => a.room.n - b.room.n)
    .map((hit) => ({
      room: hit.room,
      gap: hit.gap,
      spans: mergeSpans(hit.spans).map((span) => ({
        min: toPlanLength(span.min),
        max: toPlanLength(span.max),
      })),
    }));
}

/* ------------------------------------------------------------------ *
 * The stretches of one face.
 * ------------------------------------------------------------------ */

/** A contact under construction: its reason and thickness are still being settled. */
interface MutableContact {
  /** Id of the space on the far side, or `null`. */
  neighbourId: string | null;
  /** Start of the stretch along the wall axis. */
  spanMin: number;
  /** End of the stretch along the wall axis. */
  spanMax: number;
  /** Length of the stretch. */
  length: number;
  /** Thickness of the stretch, `null` until a return has taken one from its neighbours. */
  thickness: number | null;
  /** The rule that explains that thickness. */
  reason: ContactReason;
}

/** A face under construction, with the stretches derived so far. */
interface MutableWall extends Face {
  /** Matricule of the face. */
  readonly matricule: string;
  /** Id of the room the face belongs to. */
  readonly roomId: string;
  /** Type of that room. */
  readonly type: string;
  /** Wall number within the room. */
  readonly wallN: number;
  /** The axis the face runs along. */
  readonly axis: WallAxis;
  /** Length of the face. */
  readonly length: number;
  /** Whether the face is on the envelope. */
  readonly exterior: boolean;
  /** What the face looks at, in words. */
  readonly faces: string;
  /** Ids of the spaces the face looks at. */
  readonly neighbours: readonly string[];
  /** The stretches of the face. */
  readonly contacts: MutableContact[];
}

/** One piece of a face claimed by one neighbour, before the sweep resolves overlaps. */
interface ContactPiece {
  /** Id of the claiming space. */
  readonly neighbourId: string;
  /** The run it claims. */
  readonly span: Span;
  /** How far away it is, which settles who wins where two spaces both claim a run. */
  readonly gap: number;
  /** Thickness of the wall over that run. */
  readonly thickness: number;
  /** The rule that explains it. */
  readonly reason: ContactReason;
}

/**
 * Tells whether a kind of space exposes the wall facing it to the weather.
 *
 * @param kind - Kind of the space, or {@link OUTSIDE}.
 * @returns `true` for `'openAir'` and `'void'`.
 */
function isWeatherExposed(kind: string): boolean {
  return WEATHER_EXPOSED_KINDS.includes(kind);
}

/**
 * Returns the stretches of one face, in order, tiling its whole span.
 *
 * WHY a sweep rather than one entry per neighbour: the stretches have to tile
 * the face for a renderer to draw it by walking the list, which means the bits
 * that back onto nothing must appear too, and two spaces that both claim a
 * stretch must be resolved rather than both emitted. Cutting the span at every
 * boundary and asking each cell which space is NEAREST does both, and cannot
 * leave a hole or an overlap however the rooms are drawn.
 *
 * @param wall - The face, with its span.
 * @param neighbours - What that face looks at.
 * @param walls - The fallback thicknesses of the spec.
 * @param roomKind - Kind of the room the face belongs to.
 * @param overrideFor - Looks a stated thickness up by the id of the space on the
 *   far side; the face's own room is already bound by the caller.
 * @returns The stretches, ascending, covering the whole face.
 */
function contactsAlong(
  wall: Face,
  neighbours: readonly Neighbour[],
  walls: WallSpec,
  roomKind: string,
  overrideFor: (neighbourId: string) => SpecJoinOverride | undefined,
): MutableContact[] {
  const pieces: ContactPiece[] = neighbours.flatMap((neighbour) => {
    const override = overrideFor(neighbour.room.id);
    // The gap the rects leave IS the thickness — the spec draws every wall at
    // its real width, so measuring beats inferring. Inferring the thickness from
    // the kinds of the two rooms was wrong for fourteen walls. An override wins
    // because it states a gap the geometry would not predict, and the kind rule
    // is only reached when two spaces touch with no gap at all.
    const thickness =
      override !== undefined
        ? override.thickness
        : neighbour.gap > LENGTH_TOLERANCE
          ? neighbour.gap
          : isWeatherExposed(neighbour.room.kind) || isWeatherExposed(roomKind)
            ? walls.voidFacing
            : walls.partition;
    const reason: ContactReason =
      override !== undefined
        ? 'join override'
        : isWeatherExposed(neighbour.room.kind) || isWeatherExposed(roomKind)
          ? 'weather-exposed'
          : 'plain separator';
    return neighbour.spans.map((span) => ({
      neighbourId: neighbour.room.id,
      span,
      gap: neighbour.gap,
      thickness: toPlanLength(thickness),
      reason,
    }));
  });

  const bounds = new Set<number>([wall.spanMin, wall.spanMax]);
  pieces.forEach((piece) => {
    if (piece.span.min > wall.spanMin + LENGTH_TOLERANCE) {
      bounds.add(toPlanLength(piece.span.min));
    }
    if (piece.span.max < wall.spanMax - LENGTH_TOLERANCE) {
      bounds.add(toPlanLength(piece.span.max));
    }
  });
  const cuts = [...bounds].sort((a, b) => a - b);

  const cells = cuts.slice(0, -1).flatMap((min, index) => {
    const max = cuts[index + 1];
    if (max - min <= LENGTH_TOLERANCE) {
      return [];
    }
    const mid = (min + max) * HALF;
    const covering = pieces
      .filter(
        (piece) =>
          piece.span.min <= mid + LENGTH_TOLERANCE && piece.span.max >= mid - LENGTH_TOLERANCE,
      )
      .sort((a, b) => a.gap - b.gap);
    return [{ min, max, piece: covering[0] }];
  });

  const merged: { min: number; max: number; piece: ContactPiece | undefined }[] = [];
  cells.forEach((cell) => {
    const last = merged.at(-1);
    const same =
      last !== undefined &&
      (last.piece?.neighbourId ?? null) === (cell.piece?.neighbourId ?? null) &&
      near(last.piece?.thickness ?? -1, cell.piece?.thickness ?? -1) &&
      near(last.max, cell.min);
    if (same && last !== undefined) {
      last.max = cell.max;
      return;
    }
    merged.push({ ...cell });
  });

  const contacts: MutableContact[] = merged.map((cell) => ({
    neighbourId: cell.piece?.neighbourId ?? null,
    spanMin: toPlanLength(cell.min),
    spanMax: toPlanLength(cell.max),
    length: toPlanLength(cell.max - cell.min),
    thickness: cell.piece === undefined ? null : cell.piece.thickness,
    reason: cell.piece === undefined ? 'no facing space' : cell.piece.reason,
  }));

  // A stretch backing onto nothing is a corner or a return. Build it as thick as
  // the thicker stretch it runs into, so the wall never thins at a junction; if
  // no stretch of this face faces anything, the plain default is all there is.
  //
  // Only the stretches ALONG this face are visible from here, because the other
  // faces of the floor do not exist yet. The wall that LANDS in a corner is the
  // other half of "thick win", and {@link assignJunctionReasons} adds it once
  // every face is built — the same pass that settles the corner's reason, so the
  // two halves can no longer be read off different neighbourhoods.
  [0, 1].forEach((pass) => {
    contacts.forEach((contact, index) => {
      if (contact.thickness !== null) {
        return;
      }
      const around = [contacts[index - 1], contacts[index + 1]]
        .filter((other) => other !== undefined && other.thickness !== null)
        .map((other) => other.thickness ?? 0);
      if (around.length > 0) {
        contact.thickness = Math.max(...around);
        return;
      }
      if (pass === 1) {
        contact.thickness = walls.partition;
      }
    });
  });
  return contacts;
}

/* ------------------------------------------------------------------ *
 * Isolation, and what it does to a junction.
 * ------------------------------------------------------------------ */

/**
 * Tells whether two faces are the two sides of one built wall: same axis,
 * opposite sides, the second on the outward side of the first and no further
 * than one exterior wall away, spans overlapping.
 *
 * @param a - First face.
 * @param b - Second face.
 * @param maxGap - Widest gap that still counts as one wall, in metres.
 * @returns `true` when they are two faces of one wall.
 */
function backToBack(a: MutableWall, b: MutableWall, maxGap: number): boolean {
  if (a.axis !== b.axis || b.side !== OPPOSITE_SIDE[a.side]) {
    return false;
  }
  const gap =
    a.side === 'north'
      ? a.at - b.at
      : a.side === 'south'
        ? b.at - a.at
        : a.side === 'east'
          ? b.at - a.at
          : a.at - b.at;
  if (gap < -LENGTH_TOLERANCE || gap > maxGap + LENGTH_TOLERANCE) {
    return false;
  }
  return Math.min(a.spanMax, b.spanMax) - Math.max(a.spanMin, b.spanMin) > LENGTH_TOLERANCE;
}

/**
 * Labels the stretches the owner built heavy.
 *
 * Isolation is a width now, and it is declared per FACE, so what it means for a
 * stretch is only knowable once every face exists — a named face makes whatever
 * backs onto it heavy too. It only ever upgrades a plain separator or a
 * weather-exposed stretch: an override or the envelope already has a stronger
 * reason for its number.
 *
 * @param walls - Every face of the floor. Mutated in place.
 * @param spec - The source of truth, for the owner's list.
 */
function assignIsolationReasons(walls: readonly MutableWall[], spec: FloorSpec): void {
  if (spec.insulatedWalls.length === 0) {
    return;
  }
  const maxGap = spec.walls.exterior;
  const byMatricule = new Map(walls.map((wall) => [wall.matricule, wall]));
  const spans = new Map<string, Span[]>(walls.map((wall) => [wall.matricule, []]));

  spec.insulatedWalls.forEach((entry) => {
    const wall = byMatricule.get(entry.matricule);
    if (wall === undefined) {
      return;
    }
    spans.get(wall.matricule)?.push({ min: wall.spanMin, max: wall.spanMax });
    walls.forEach((other) => {
      if (other.matricule === wall.matricule || !backToBack(wall, other, maxGap)) {
        return;
      }
      const min = Math.max(wall.spanMin, other.spanMin);
      const max = Math.min(wall.spanMax, other.spanMax);
      if (max - min > LENGTH_TOLERANCE) {
        spans.get(other.matricule)?.push({ min: toPlanLength(min), max: toPlanLength(max) });
      }
    });
  });

  walls.forEach((wall) => {
    const heavy = mergeSpans(spans.get(wall.matricule) ?? []);
    if (heavy.length === 0) {
      return;
    }
    wall.contacts.forEach((contact) => {
      // 'plain separator' and 'weather-exposed' both give way to isolation;
      // 'exterior' and 'join override' do not.
      //
      // WHY weather-exposed has to give way: naming a face insulates the wall,
      // and a wall has two faces. The master bedroom's west face is named, so
      // that wall is built heavy — but its other face is the side-A balcony
      // spine, which is weather-exposed and unnamed, so refusing the upgrade
      // left one face of one wall reading heavy and the other plain, and the
      // drawing painted them different colours. Nothing is lost by the upgrade:
      // weather-exposed and isolation are both 0.30, so the depth is the same
      // number either way and only the explanation changes.
      //
      // WHY exterior does not: an envelope face has no far side to carry
      // anything onto, and the renderer relies on it still reading 'exterior'.
      // WHY a join override does not: its depth is forced and often not 0.30 —
      // calling the 0.20 utility join an isolation wall would be a lie.
      if (contact.reason !== 'plain separator' && contact.reason !== 'weather-exposed') {
        return;
      }
      const inside = heavy.some(
        (span) =>
          contact.spanMin >= span.min - LENGTH_TOLERANCE &&
          contact.spanMax <= span.max + LENGTH_TOLERANCE,
      );
      if (inside) {
        contact.reason = 'isolation';
      }
    });
  });
}

/**
 * Returns how far a coordinate lies outside a span.
 *
 * @param at - The coordinate.
 * @param span - The span.
 * @returns Zero when the coordinate is inside, otherwise the distance to the
 *   nearer end.
 */
function distanceTo(at: number, span: Span): number {
  if (at < span.min) {
    return span.min - at;
  }
  return at > span.max ? at - span.max : 0;
}

/**
 * Returns the stretch of a face that reaches nearest to a coordinate along it.
 *
 * A long wall can be isolated at one end and plain at the other, so a corner
 * takes the stretch of the landing face that actually reaches it rather than the
 * face as a whole: the kitchen's west face is isolation where it wraps the guest
 * room and plain 0.15 at the end that turns into the void, and it is the end
 * that turns which matters.
 *
 * @param face - The face that lands in the corner.
 * @param at - Coordinate of the corner on the axis that face runs along.
 * @returns Index of the nearest stretch, or `-1` when the face has none.
 */
function nearestContactIndex(face: MutableWall, at: number): number {
  let nearest = -1;
  let nearestDistance = Infinity;
  face.contacts.forEach((candidate, index) => {
    const distance = distanceTo(at, { min: candidate.spanMin, max: candidate.spanMax });
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  });
  return nearest;
}

/**
 * Applies the junction rule: a junction belongs to the stronger wall. The
 * owner's words were "in thick wall when X wall meet Y wall and both this the XY
 * point is RED thick win".
 *
 * A stretch that backs onto nothing is a corner — the block of masonry where a
 * perpendicular wall lands. This pass settles BOTH halves of "thick win" for it,
 * off one set of adjoining stretches: the corner takes the stronger REASON and
 * the thicker WIDTH together. Without the reason, an isolated run reads as plain
 * exactly where it turns a corner, which is the one place a sound or heat
 * barrier cannot afford a gap: the drawing would say the isolation stops at the
 * corner when it does not.
 *
 * WHY the width is settled here too, and not left to {@link contactsAlong}. The
 * two halves used to be read off different neighbourhoods and they disagreed.
 * `contactsAlong` gave a corner the thicker of the two stretches BESIDE it along
 * its own face — all it can see, since the other faces do not exist yet — while
 * this pass took the reason from a wider neighbourhood that also includes the
 * face LANDING in the corner. Where the wall that lands is heavy and the
 * stretches alongside are thin, the corner came out `reason: 'isolation'` at
 * `thickness: 0.15`; and isolation IS a width on this floor — 0.30 heavy, 0.15
 * plain — so that stretch claimed a sound and heat barrier while being built as
 * a thin partition, and a renderer painting the isolated runs red painted a thin
 * wall red.
 *
 * It happened at exactly two corners, both in the guest suite and both for the
 * same reason: one of the guest room's own 0.30 walls lands in a 0.15 wall to a
 * space the owner deliberately left OUT of the thick wrap. `F1-R09-GST-W7` is
 * where the room's west wall (0.30, named) meets the 0.15 wall to the control
 * center, "a technical room [that] does not need the sound isolation the
 * bedrooms do"; `F1-R10-BTH-W1` is where its east wall to the kitchen (0.30,
 * named) meets the 0.15 wall to the guest bathroom, which the owner excluded by
 * name. The asymmetry is the whole of it — thick wall meets thin wall, and the
 * owner ruled on precisely that case: "in thick wall when X wall meet Y wall and
 * both this the XY point is RED thick win". So the corner is widened, not merely
 * coloured.
 *
 * Reading both off the same stretches makes the contradiction unreachable rather
 * than fixed twice: a corner that reads isolation is built at least
 * `walls.insulated`, because the stretch it took the reason from is.
 *
 * Widening a corner can only ever grow it into masonry. A corner is the block
 * where a perpendicular wall lands, so the run it grows along is that wall's own
 * footprint — never a clear rect.
 *
 * Isolated here means what the drawing means by red: the face is named, or the
 * backing pass labelled that stretch 'isolation'. Both halves are needed. Ten
 * named faces carry no 'isolation' contact at all, because an exterior or
 * weather-exposed stretch keeps the reason that explains its depth — so reading
 * `reason` alone would miss every junction with the side-C envelope or the
 * balcony spine.
 *
 * Two ways to adjoin, because a corner is where two faces turn:
 *   - the contact beside it along the same face, so an isolated run carries
 *     through the corner instead of stopping at it; and
 *   - the face that lands in it, taking that face's NEAREST contact, since a
 *     long wall can be isolated at one end and plain at the other — the
 *     kitchen's west face is isolation where it wraps the guest room and plain
 *     0.15 at the end that turns into the void, and it is the end that turns
 *     which matters.
 *
 * Read off a snapshot taken before anything changes, so isolation crosses one
 * junction rather than travelling down a chain of them.
 *
 * @param walls - Every face of the floor. Mutated in place.
 * @param spec - The source of truth, for the owner's list.
 */
function assignJunctionReasons(walls: readonly MutableWall[], spec: FloorSpec): void {
  const named = new Set(spec.insulatedWalls.map((entry) => entry.matricule));
  const maxGap = spec.walls.exterior;
  const before = new Map<string, readonly boolean[]>(
    walls.map((wall) => [
      wall.matricule,
      wall.contacts.map((contact) => named.has(wall.matricule) || contact.reason === 'isolation'),
    ]),
  );

  walls.forEach((wall) => {
    wall.contacts.forEach((contact, index) => {
      if (contact.reason !== 'no facing space') {
        return;
      }
      const flags = before.get(wall.matricule) ?? [];
      // The stretches this corner adjoins, as widths, counting only the ones the
      // drawing would paint red. Along wins outright when it is there, so
      // isolation crosses one junction rather than travelling down a chain.
      const along = [index - 1, index + 1]
        .filter((other) => wall.contacts[other] !== undefined && flags[other] === true)
        .map((other) => wall.contacts[other].thickness ?? 0);
      const landing =
        along.length > 0
          ? []
          : walls.flatMap((other) => {
              if (
                other.axis === wall.axis ||
                other.at < contact.spanMin - LENGTH_TOLERANCE ||
                other.at > contact.spanMax + LENGTH_TOLERANCE ||
                distanceTo(wall.at, { min: other.spanMin, max: other.spanMax }) >
                  maxGap + LENGTH_TOLERANCE
              ) {
                return [];
              }
              const nearest = nearestContactIndex(other, wall.at);
              if (nearest < 0 || (before.get(other.matricule) ?? [])[nearest] !== true) {
                return [];
              }
              return [other.contacts[nearest].thickness ?? 0];
            });

      const adjoining = [...along, ...landing];
      if (adjoining.length === 0) {
        return;
      }
      // Thick wins, both halves off the same stretches: the corner reads
      // isolation because a heavy stretch adjoins it, and is built at least as
      // thick as that stretch — never below `walls.insulated`, which is what
      // isolation MEANS once it is a width rather than a material.
      contact.reason = 'isolation';
      contact.thickness = toPlanLength(
        Math.max(contact.thickness ?? 0, spec.walls.insulated, ...adjoining),
      );
    });
  });
}

/* ------------------------------------------------------------------ *
 * The derivation itself.
 * ------------------------------------------------------------------ */

/**
 * Formats a wall matricule.
 *
 * @param floor - Floor number.
 * @param room - The room the face belongs to.
 * @param wallN - Wall number within that room.
 * @returns `F1-R11-KIT-W3`.
 */
function wallMatricule(floor: number, room: SpecRoom, wallN: number): string {
  return `F${String(floor)}-R${String(room.n).padStart(ROOM_NUMBER_DIGITS, '0')}-${room.type}-W${String(wallN)}`;
}

/**
 * Freezes a face once its stretches are settled.
 *
 * @param wall - The face under construction.
 * @returns The frozen {@link DerivedWall}.
 * @throws RangeError naming the face when a stretch never took a thickness,
 *   which would leave part of a wall with no width to build.
 */
function freezeWall(wall: MutableWall): DerivedWall {
  const contacts: readonly WallContact[] = Object.freeze(
    wall.contacts.map((contact) => {
      if (contact.thickness === null) {
        throw new RangeError(
          `wall ${wall.matricule} has a stretch at ${String(contact.spanMin)}–${String(contact.spanMax)} with no thickness`,
        );
      }
      return Object.freeze({
        neighbourId: contact.neighbourId,
        spanMin: contact.spanMin,
        spanMax: contact.spanMax,
        length: contact.length,
        thickness: toPlanLength(contact.thickness),
        reason: contact.reason,
      });
    }),
  );
  const thicknesses = contacts.map((contact) => contact.thickness);
  return Object.freeze({
    matricule: wall.matricule,
    roomN: wall.roomN,
    roomId: wall.roomId,
    type: wall.type,
    wallN: wall.wallN,
    side: wall.side,
    axis: wall.axis,
    at: wall.at,
    spanMin: wall.spanMin,
    spanMax: wall.spanMax,
    length: wall.length,
    // The thickest stretch, for quantities. Never for drawing — see the header.
    thickness: toPlanLength(Math.max(...thicknesses)),
    varies: new Set(thicknesses).size > 1,
    exterior: wall.exterior,
    faces: wall.faces,
    neighbours: Object.freeze([...wall.neighbours]),
    contacts,
  });
}

/**
 * Derives every wall face of the floor from the source of truth.
 *
 * One face per side of every room, numbered clockwise from the north face, each
 * tiled by the stretches it is actually built from. Nothing here is declared:
 * the owner edits rectangles, because a rectangle is what he can measure on the
 * drawing, and everything else is a consequence of them — so there is nothing to
 * keep in sync.
 *
 * @param spec - The source of truth; defaults to the typical floor.
 * @returns A frozen array of frozen faces, in room then wall order.
 * @throws RangeError naming a room whose rects do not form one simply-connected
 *   rectilinear outline, or a face left with a stretch of no thickness.
 */
export function deriveWalls(spec: FloorSpec = FLOOR_SPEC): readonly DerivedWall[] {
  const exteriorThickness = spec.walls.exterior;
  const plot = spec.rooms.flatMap(roomRects);
  /**
   * The interior boundary: a face sitting on it is on the exterior envelope and
   * is 0.30 thick whatever is behind it. Taken from the rects themselves so that
   * the envelope moves when the plan does.
   */
  const envelope: Readonly<Record<WallSide, number>> = Object.freeze({
    west: toPlanLength(Math.min(...plot.map((rect) => rect.minX))),
    east: toPlanLength(Math.max(...plot.map((rect) => rect.maxX))),
    north: toPlanLength(Math.min(...plot.map((rect) => rect.minZ))),
    south: toPlanLength(Math.max(...plot.map((rect) => rect.maxZ))),
  });

  const walls: MutableWall[] = spec.rooms.flatMap((room) =>
    orderClockwise(outlineEdges(roomRects(room)), room.id).map((edge, index) => {
      const wallN = index + 1;
      const face: Face = {
        roomN: room.n,
        side: edge.side,
        at: toPlanLength(edge.at),
        spanMin: toPlanLength(edge.span.min),
        spanMax: toPlanLength(edge.span.max),
      };
      const neighbours = facingSpaces(face, spec.rooms, exteriorThickness);
      const onEnvelope = near(envelope[edge.side], face.at);
      const overrideFor = (neighbourId: string): SpecJoinOverride | undefined =>
        spec.joinOverrides.find(
          (override) =>
            override.between.includes(room.id) && override.between.includes(neighbourId),
        );
      const length = toPlanLength(face.spanMax - face.spanMin);

      return {
        ...face,
        matricule: wallMatricule(spec.floorNumber, room, wallN),
        roomId: room.id,
        type: room.type,
        wallN,
        axis: AXIS_OF[edge.side],
        length,
        exterior: onEnvelope,
        faces: onEnvelope
          ? 'outside'
          : neighbours.length > 0
            ? neighbours.map((neighbour) => neighbour.room.name).join(' / ')
            : 'nothing (no facing space found)',
        neighbours: onEnvelope ? [] : neighbours.map((neighbour) => neighbour.room.id),
        contacts: onEnvelope
          ? // One contact, so a renderer iterating `contacts` needs no special
            // case for the envelope.
            [
              {
                neighbourId: null,
                spanMin: face.spanMin,
                spanMax: face.spanMax,
                length,
                thickness: exteriorThickness,
                reason: 'exterior' as ContactReason,
              },
            ]
          : contactsAlong(face, neighbours, spec.walls, room.kind, overrideFor),
      };
    }),
  );

  assignIsolationReasons(walls, spec);
  assignJunctionReasons(walls, spec);
  return Object.freeze(walls.map(freezeWall));
}

/**
 * Returns the built solids of the floor: one per contact stretch.
 *
 * A stretch stands on the outward side of the face it belongs to — the side away
 * from the room whose face it is — and is as deep as that stretch is thick. Both
 * faces of an interior wall therefore produce the same solid, which is what
 * makes the two halves meet on one centreline instead of standing 0.15 apart.
 *
 * These solids tile every FACE, not the whole wall footprint: the block where an
 * interior wall lands on another belongs to no face's span, so
 * {@link getWallPieces} reads the negative space instead and picks those
 * junctions up as well. Use these where the stretch's own thickness or its
 * reason matters — quantities, a schedule, or drawing the isolated runs apart
 * from the plain ones.
 *
 * @param walls - The derived faces; defaults to {@link deriveWalls}.
 * @param spec - The source of truth, for the owner's isolation list; defaults to
 *   the typical floor.
 * @returns A frozen array of frozen solids, in face then stretch order, skipping
 *   the zero-thickness joins, which are not built at all.
 */
export function getWallSolids(
  walls: readonly DerivedWall[] = deriveWalls(),
  spec: FloorSpec = FLOOR_SPEC,
): readonly WallSolid[] {
  const named = new Set(spec.insulatedWalls.map((entry) => entry.matricule));
  return Object.freeze(
    walls.flatMap((wall) =>
      wall.contacts
        .filter((contact) => contact.thickness > LENGTH_TOLERANCE)
        .map((contact) => {
          const far = toPlanLength(
            wall.side === 'north' || wall.side === 'west'
              ? wall.at - contact.thickness
              : wall.at + contact.thickness,
          );
          const rect =
            wall.axis === 'x'
              ? makeRect(
                  contact.spanMin,
                  contact.spanMax,
                  Math.min(wall.at, far),
                  Math.max(wall.at, far),
                )
              : makeRect(
                  Math.min(wall.at, far),
                  Math.max(wall.at, far),
                  contact.spanMin,
                  contact.spanMax,
                );
          return Object.freeze({
            rect,
            matricule: wall.matricule,
            thickness: contact.thickness,
            reason: contact.reason,
            // Heavy is `reason === 'isolation'` OR the face being named. Both
            // halves are needed: an exterior or weather-exposed stretch keeps
            // the reason that explains its depth, so the named list is the only
            // record that the owner wants it isolated; and the reason is the
            // only thing that carries isolation onto the far face of an interior
            // wall, and onto part of a face rather than all of it.
            insulated: contact.reason === 'isolation' || named.has(wall.matricule),
          });
        }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * The wall footprint, as solids the renderer can draw.
 * ------------------------------------------------------------------ */

/**
 * How tall a wall is: full height, or a parapet the spec named — a low wall you
 * look over, such as the side-A balcony's balustrade.
 */
export type WallHeightKind = 'wall' | 'parapet';

/** One cell of the wall grid: its footprint and how tall the wall there is. */
export interface WallCell {
  /** Footprint of the cell, in plan coordinates. */
  readonly rect: PlanRect;
  /** Level of the top of the wall in this cell, in metres above the finished floor. */
  readonly height: number;
  /** Whether the cell is a full-height wall or a parapet. */
  readonly kind: WallHeightKind;
}

/**
 * One solid wall block, with what kind of wall it is.
 *
 * A {@link PlanBox} with the classification carried on it, so that a renderer is
 * told whether a block is a parapet instead of guessing from its top.
 *
 * Guessing cannot work, and the reason is not that the two numbers differ — since
 * ADR-011 the stated parapet IS `heights.railing`, 1.10. It is that one of them is
 * plan data and the other is an argument: they coincide at the production heights,
 * which is precisely what makes a top comparison look right, and part company the
 * moment any other heights are injected, because a stated height does not move
 * with them. An opening also cuts full-height walls into blocks lower than either,
 * so a top is ambiguous even before the heights change.
 */
export interface WallPiece extends PlanBox {
  /** Whether the block is part of a full-height wall or of a stated parapet. */
  readonly kind: WallHeightKind;
}

/** How tall a wall is and what that height means. */
interface HeightClass {
  /** Level of the top of the wall, in metres above the finished floor. */
  readonly height: number;
  /** Whether that height is a full-height wall or a parapet. */
  readonly kind: WallHeightKind;
}

/** One cell of the wall grid, with its position in the grid. */
interface GridCell {
  /** Index of the cell's own column: it spans `xs[ix]` to `xs[ix + 1]`. */
  readonly ix: number;
  /** Index of the cell's own row: it spans `zs[iz]` to `zs[iz + 1]`. */
  readonly iz: number;
  /** Footprint of the cell. */
  readonly rect: PlanRect;
  /** Centre of the cell, which never lies on a grid line. */
  readonly centre: PlanPoint;
}

/** A cell of the wall grid whose height is known. */
interface ClassifiedCell extends GridCell, HeightClass {}

/** The wall cells of a plan, with the grid lines they are cut on. */
interface WallGrid {
  /** Grid lines along x, ascending, in metres. */
  readonly xs: readonly number[];
  /** Grid lines along z, ascending, in metres. */
  readonly zs: readonly number[];
  /** Every cell no space covers, with its height. */
  readonly cells: readonly ClassifiedCell[];
}

/** A vertical span of solid wall, in metres above the finished floor. */
interface Interval {
  /** Level of the underside. */
  readonly bottom: number;
  /** Level of the top. */
  readonly top: number;
}

/** One maximal run of cells of a single row, as inclusive column indices. */
interface Run {
  /** Column index of the first cell of the run. */
  readonly ixStart: number;
  /** Column index of the last cell of the run. */
  readonly ixEnd: number;
}

/** A face the spec states a height for, as the footprint that stands at it. */
interface StatedParapet {
  /** Footprint of one stretch of the named face. */
  readonly rect: PlanRect;
  /** Level of its top above the finished floor, in metres. */
  readonly height: number;
  /** Matricule of the named face, for the error message when two of them clash. */
  readonly matricule: string;
}

/**
 * Lists every clear rect of the floor.
 *
 * @param spec - The source of truth.
 * @returns One rect per clear rect of every space, in spec order.
 */
function allRects(spec: FloorSpec): readonly PlanRect[] {
  return spec.rooms.flatMap(roomRects);
}

/**
 * Collects the grid lines of one axis: every distinct coordinate at which the
 * wall layout can change.
 *
 * @param coordinates - Every coordinate to consider, in any order.
 * @param plotMin - Coordinate of the plot boundary at the low end.
 * @param plotMax - Coordinate of the plot boundary at the high end.
 * @returns The distinct coordinates inside the plot, snapped to the plan grid
 *   with `toPlanLength` and sorted ascending; the two plot boundaries included.
 */
function gridLines(
  coordinates: readonly number[],
  plotMin: number,
  plotMax: number,
): readonly number[] {
  const inside = coordinates
    .map(toPlanLength)
    .filter((value) => value > plotMin + LENGTH_TOLERANCE && value < plotMax - LENGTH_TOLERANCE);
  return Object.freeze(
    [...new Set([toPlanLength(plotMin), ...inside, toPlanLength(plotMax)])].sort((a, b) => a - b),
  );
}

/**
 * Cuts the plot into cells and keeps the ones no space covers.
 *
 * A cell belongs to a wall when its centre lies in no clear rect. The test is
 * the half-open `rectContainsPoint`, and a cell centre never falls on a grid
 * line, so every clear face is a grid line and no cell ever straddles one.
 *
 * The negative space and the contact stretches agree by construction, because
 * both read the same thing: the gap the rects leave. What the negative space
 * adds is the junction blocks — the four plot corners, and every block where one
 * wall lands on another — which belong to no face's span and would otherwise be
 * left as notches in the envelope.
 *
 * @param rects - Every clear rect of the floor.
 * @param xs - Grid lines along x, ascending.
 * @param zs - Grid lines along z, ascending.
 * @returns The wall cells, row by row.
 */
function wallCellsOfGrid(
  rects: readonly PlanRect[],
  xs: readonly number[],
  zs: readonly number[],
): readonly GridCell[] {
  const cells: GridCell[] = [];
  zs.slice(0, -1).forEach((minZ, iz) => {
    const maxZ = zs[iz + 1];
    xs.slice(0, -1).forEach((minX, ix) => {
      const maxX = xs[ix + 1];
      const centre: PlanPoint = { x: (minX + maxX) * HALF, z: (minZ + maxZ) * HALF };
      if (rects.some((rect) => rectContainsPoint(rect, centre))) {
        return;
      }
      cells.push({ ix, iz, rect: makeRect(minX, maxX, minZ, maxZ), centre });
    });
  });
  return cells;
}

/**
 * Returns the footprints the spec states a height for, one per stretch of every
 * named face.
 *
 * The stretches come from {@link getWallSolids}, so a named face covers exactly
 * the masonry it is built from and no more. That is what keeps a parapet to its
 * own ends: the block where another wall lands beyond the end of the named face
 * is not one of its stretches, so it is left at full height and the wall it
 * really belongs to closes properly.
 *
 * @param spec - The source of truth.
 * @returns One entry per stretch of every named face, in spec order.
 * @throws RangeError naming the matricule when the list points at a face this
 *   floor does not have, which would otherwise leave a balustrade silently built
 *   full height.
 */
function statedParapets(spec: FloorSpec): readonly StatedParapet[] {
  if (spec.parapetWalls.length === 0) {
    return [];
  }
  const byMatricule = new Map(deriveWalls(spec).map((wall) => [wall.matricule, wall]));
  return spec.parapetWalls.flatMap((entry) => {
    const wall = byMatricule.get(entry.matricule);
    if (wall === undefined) {
      throw new RangeError(
        `PARAPET_WALLS names ${entry.matricule}, which is not a wall of this floor — a stated height has to point at a wall that exists`,
      );
    }
    return getWallSolids([wall], spec).map((solid) => ({
      rect: solid.rect,
      height: entry.height,
      matricule: entry.matricule,
    }));
  });
}

/**
 * Determines how tall the wall is in one cell.
 *
 * Stated beats inferred: a cell inside a face the spec named is built to the
 * height stated for it, and every other cell runs to `heights.wall`. Nothing is
 * deduced from what the cell happens to face, and no height is inherited from a
 * neighbouring cell.
 *
 * @param centre - Centre of the cell.
 * @param parapets - The stated footprints, from {@link statedParapets}.
 * @param heights - Vertical sizes to use.
 * @returns The height of the wall there and what that height means.
 * @throws RangeError naming both faces when two of them state different heights
 *   over the same masonry, which is not a wall that can be built.
 */
function heightAt(
  centre: PlanPoint,
  parapets: readonly StatedParapet[],
  heights: FloorHeights,
): HeightClass {
  const covering = parapets.filter((parapet) => rectContainsPoint(parapet.rect, centre));
  const stated = covering[0];
  if (stated === undefined) {
    return { height: heights.wall, kind: 'wall' };
  }
  const clash = covering.find((parapet) => !near(parapet.height, stated.height));
  if (clash !== undefined) {
    throw new RangeError(
      `${stated.matricule} states ${String(stated.height)} m and ${clash.matricule} states ${String(clash.height)} m over the same wall at x ${String(centre.x)}, z ${String(centre.z)}`,
    );
  }
  return { height: stated.height, kind: 'parapet' };
}

/**
 * Builds the grid of wall cells of a floor, each with its height.
 *
 * The grid is cut on every clear face, every opening face and every face of a
 * stated parapet, so no cell ever straddles the end of a low wall.
 *
 * @param plot - Outer boundary of the floor.
 * @param openings - Ports and windows; only their footprints matter here, as
 *   extra grid lines, so that a later cut along an opening never splits a cell.
 * @param heights - Vertical sizes to use.
 * @returns The grid lines and the classified wall cells.
 * @throws RangeError when `PARAPET_WALLS` names a face this floor does not have,
 *   or when two named faces state different heights over the same masonry.
 */
function buildWallGrid(
  plot: PlanRect,
  openings: readonly PlanBox[],
  heights: FloorHeights,
): WallGrid {
  const rects = allRects(FLOOR_SPEC);
  const parapets = statedParapets(FLOOR_SPEC);
  const footprints = [
    ...rects,
    ...openings.map((opening) => opening.rect),
    ...parapets.map((parapet) => parapet.rect),
  ];
  const xs = gridLines(
    footprints.flatMap((rect) => [rect.minX, rect.maxX]),
    plot.minX,
    plot.maxX,
  );
  const zs = gridLines(
    footprints.flatMap((rect) => [rect.minZ, rect.maxZ]),
    plot.minZ,
    plot.maxZ,
  );
  const cells = wallCellsOfGrid(rects, xs, zs).map((cell) => ({
    ...cell,
    ...heightAt(cell.centre, parapets, heights),
  }));
  return { xs, zs, cells };
}

/**
 * Returns the wall cells of a floor: the cells of the plan grid that no space
 * covers, each with the height of the wall there.
 *
 * The cells tile the whole wall footprint without overlapping, so their areas
 * sum to it.
 *
 * @param plan - The floor plan; its `plot` bounds the grid. The spaces
 *   themselves come from the source of truth (`sourceOfTruth/plan.ts`), which is
 *   the one place the geometry of this floor is stated.
 * @param openings - Ports and windows whose footprints also cut the grid; pass
 *   an empty array for the coarsest grid, which classifies the walls identically.
 * @param heights - Vertical sizes to use; defaults to `FLOOR_HEIGHTS`.
 * @returns A frozen array of frozen cells, row by row along z then column by
 *   column along x.
 * @throws RangeError when `PARAPET_WALLS` names a face this floor does not have,
 *   or when two named faces state different heights over the same masonry.
 */
export function getWallCells(
  plan: FloorPlan,
  openings: readonly PlanBox[],
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly WallCell[] {
  return Object.freeze(
    buildWallGrid(plan.plot, openings, heights).cells.map(({ rect, height, kind }) =>
      Object.freeze({ rect, height, kind }),
    ),
  );
}

/**
 * Removes a vertical span from a set of spans.
 *
 * @param intervals - The spans to cut, disjoint and ascending.
 * @param hole - The span to remove.
 * @returns The remaining spans; a span shorter than `LENGTH_TOLERANCE` is dropped.
 */
function subtractInterval(intervals: readonly Interval[], hole: Interval): readonly Interval[] {
  return intervals.flatMap((interval) => {
    if (
      hole.top <= interval.bottom + LENGTH_TOLERANCE ||
      hole.bottom >= interval.top - LENGTH_TOLERANCE
    ) {
      return [interval];
    }
    const parts: Interval[] = [];
    if (hole.bottom - interval.bottom > LENGTH_TOLERANCE) {
      parts.push({ bottom: interval.bottom, top: hole.bottom });
    }
    if (interval.top - hole.top > LENGTH_TOLERANCE) {
      parts.push({ bottom: hole.top, top: interval.top });
    }
    return parts;
  });
}

/**
 * Returns the solid spans of one wall cell: the wall from the underside of the
 * slab to its height, minus every opening that covers the cell.
 *
 * An opening covers the cell when the cell centre lies in the opening footprint,
 * which is exact because every opening face is a grid line. The vertical span
 * removed is the one the opening carries, so a door and a window differ only in
 * the box handed in.
 *
 * @param cell - The wall cell.
 * @param openings - Ports and windows.
 * @param heights - Vertical sizes to use.
 * @returns The remaining spans, ascending; empty when an opening takes the whole
 *   height of the cell.
 * @throws RangeError when `heights` leaves no positive slab thickness, so that
 *   the wall has no underside to start from (see `getSlabThickness`).
 */
function cellIntervals(
  cell: ClassifiedCell,
  openings: readonly PlanBox[],
  heights: FloorHeights,
): readonly Interval[] {
  const slabBottom = -getSlabThickness(heights);
  return openings
    .filter((opening) => rectContainsPoint(opening.rect, cell.centre))
    .reduce<readonly Interval[]>(
      (intervals, opening) =>
        subtractInterval(intervals, { bottom: opening.bottom, top: opening.top }),
      [{ bottom: slabBottom, top: cell.height }],
    );
}

/**
 * Formats a vertical span as a map key.
 *
 * @param interval - The span.
 * @returns A key unique to the pair of levels.
 */
function intervalKey(interval: Interval): string {
  return `${String(interval.bottom)}|${String(interval.top)}`;
}

/**
 * Splits the sorted columns of one row into maximal runs of adjacent cells.
 *
 * @param columns - Column indices present in the row, ascending.
 * @returns The runs, in ascending order.
 */
function rowRuns(columns: readonly number[]): readonly Run[] {
  const runs: Run[] = [];
  columns.forEach((ix) => {
    const last = runs.at(-1);
    if (last !== undefined && last.ixEnd === ix - 1) {
      runs[runs.length - 1] = { ixStart: last.ixStart, ixEnd: ix };
      return;
    }
    runs.push({ ixStart: ix, ixEnd: ix });
  });
  return runs;
}

/**
 * Formats the runs of a row as a map key.
 *
 * @param runs - The runs of one row.
 * @returns A key unique to that set of runs.
 */
function runsKey(runs: readonly Run[]): string {
  return runs.map((run) => `${String(run.ixStart)}-${String(run.ixEnd)}`).join(',');
}

/**
 * Merges the cells that share one vertical span into as few rectangles as
 * possible: maximal runs along x, then stacks of consecutive rows whose runs
 * match exactly.
 *
 * @param cells - The cells sharing the span.
 * @param xs - Grid lines along x, ascending.
 * @param zs - Grid lines along z, ascending.
 * @returns The merged footprints, in row then column order.
 */
function mergeCells(
  cells: readonly ClassifiedCell[],
  xs: readonly number[],
  zs: readonly number[],
): readonly PlanRect[] {
  const columnsByRow = new Map<number, number[]>();
  cells.forEach((cell) => {
    const columns = columnsByRow.get(cell.iz) ?? [];
    columns.push(cell.ix);
    columnsByRow.set(cell.iz, columns);
  });
  const rows = [...columnsByRow.keys()].sort((a, b) => a - b);
  const rects: PlanRect[] = [];
  let pending:
    { readonly runs: readonly Run[]; readonly key: string; readonly izStart: number } | undefined;
  const flush = (izEnd: number): void => {
    const current = pending;
    if (current === undefined) {
      return;
    }
    current.runs.forEach((run) => {
      rects.push(makeRect(xs[run.ixStart], xs[run.ixEnd + 1], zs[current.izStart], zs[izEnd + 1]));
    });
    pending = undefined;
  };
  rows.forEach((iz, position) => {
    const runs = rowRuns((columnsByRow.get(iz) ?? []).sort((a, b) => a - b));
    const key = runsKey(runs);
    const previous = position === 0 ? undefined : rows[position - 1];
    if (pending !== undefined && (pending.key !== key || previous !== iz - 1)) {
      flush(previous ?? iz);
    }
    pending ??= { runs, key, izStart: iz };
  });
  flush(rows.at(-1) ?? 0);
  return rects;
}

/**
 * Returns the solid wall blocks of a floor.
 *
 * The plot is cut on every clear face of the source of truth and every face of
 * the openings; the cells no space covers are the walls. Each cell is therefore
 * as thick as the gap the rects leave there, which is what lets one wall be
 * 0.30 along one stretch and 0.15 along the next — see {@link getWallSolids} for
 * the same footprint carrying the reason for each thickness. Each cell runs from
 * the underside of the slab, minus the `getSlabThickness` of `heights`
 * (`slabs.ts`), which is the same level the slabs end at, up to its own height —
 * `heights.wall`, unless the spec names that face in `PARAPET_WALLS` and states
 * a lower one — minus the vertical span of every opening that covers it, which
 * leaves a threshold below a door and a sill and a lintel around a window. Cells
 * that end up with the same span are merged into maximal boxes.
 *
 * Each block says whether it is a wall or a parapet, so that a renderer never
 * has to recover that from the geometry. It could not: the stated parapet height
 * and `heights.railing` are the same 1.10 at the production heights (ADR-011) but
 * a stated height does not follow an injected one, and the base under a door is
 * lower than both.
 *
 * @param plan - The floor plan; its `plot` bounds the grid. The spaces
 *   themselves come from the source of truth (`sourceOfTruth/plan.ts`).
 * @param openings - Ports and windows to punch out, as boxes: the footprint of
 *   the hole and the vertical span it removes.
 * @param heights - Vertical sizes to use; defaults to `FLOOR_HEIGHTS`. Every
 *   level of the result comes from this argument alone, except a height the spec
 *   states for a named parapet.
 * @returns A frozen array of frozen blocks that never overlap, ordered by
 *   vertical span, then row, then column.
 * @throws RangeError when `PARAPET_WALLS` names a face this floor does not have,
 *   when two named faces state different heights over the same masonry, or when
 *   `heights` leaves no positive slab thickness for the walls to start under.
 */
export function getWallPieces(
  plan: FloorPlan,
  openings: readonly PlanBox[],
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly WallPiece[] {
  const { xs, zs, cells } = buildWallGrid(plan.plot, openings, heights);
  const groups = new Map<
    string,
    { readonly interval: Interval; readonly kind: WallHeightKind; readonly cells: ClassifiedCell[] }
  >();
  cells.forEach((cell) => {
    cellIntervals(cell, openings, heights).forEach((interval) => {
      // The kind is part of the key, not just the span: two blocks of the same
      // height are still a wall and a parapet, and merging them would lose the
      // one fact the renderer is being handed.
      const key = `${intervalKey(interval)}|${cell.kind}`;
      const group = groups.get(key) ?? { interval, kind: cell.kind, cells: [] };
      group.cells.push(cell);
      groups.set(key, group);
    });
  });
  const ordered = [...groups.values()].sort(
    (a, b) => a.interval.bottom - b.interval.bottom || a.interval.top - b.interval.top,
  );
  return Object.freeze(
    ordered.flatMap(({ interval, kind, cells: grouped }) =>
      mergeCells(grouped, xs, zs).map((rect) =>
        Object.freeze({ ...makeBox(rect, interval.bottom, interval.top), kind }),
      ),
    ),
  );
}

/**
 * Returns the plan area the walls occupy.
 *
 * The footprint is counted once however the walls are cut up vertically: a
 * footprint that carries a base block below a window and a head block above it
 * contributes its area a single time, and so does any footprint two blocks share
 * only partly.
 *
 * @param pieces - The wall blocks, typically from {@link getWallPieces}.
 * @returns The area of the union of their footprints, in square metres.
 */
export function getWallFootprintArea(pieces: readonly PlanBox[]): number {
  const rects = pieces.map((piece) => piece.rect);
  const xs = [...new Set(rects.flatMap((rect) => [rect.minX, rect.maxX]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap((rect) => [rect.minZ, rect.maxZ]))].sort((a, b) => a - b);
  let area = 0;
  zs.slice(0, -1).forEach((minZ, iz) => {
    const maxZ = zs[iz + 1];
    xs.slice(0, -1).forEach((minX, ix) => {
      const maxX = xs[ix + 1];
      const centre: PlanPoint = { x: (minX + maxX) * HALF, z: (minZ + maxZ) * HALF };
      if (rects.some((rect) => rectContainsPoint(rect, centre))) {
        area += rectArea(makeRect(minX, maxX, minZ, maxZ));
      }
    });
  });
  return area;
}
