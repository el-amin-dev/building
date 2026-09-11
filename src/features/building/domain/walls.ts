/**
 * Solid wall geometry of the floor, derived from the plan.
 *
 * The floor-plan model (ADR-005) describes every space by its clear (inner)
 * rectangles; the walls are the solid left between them, plus the exterior walls
 * between the outermost clear faces and the plot boundary (brief §2: 0.30 m
 * exterior, 0.20 m partitions, 0.30 m void-facing). This module turns that
 * negative space into boxes: it cuts the plot on the grid of every clear face,
 * keeps the cells no space covers, gives each cell its height, punches the ports
 * and windows out of it, and merges the result into as few boxes as possible.
 *
 * Two heights occur (owner answers, ADR-006): a cell that walls a room or a
 * circulation space rises to `FLOOR_HEIGHTS.wall`, while a cell whose every side
 * faces open air, the void or the outside is a parapet and rises only to
 * `FLOOR_HEIGHTS.railing`. Every wall starts at the underside of the slab,
 * `-(floorToFloor - wall)`, so that a cross-section stays closed and a doorway
 * keeps a threshold.
 *
 * The wall footprint of the typical floor is the 42.52 m² of brief §8; the tests
 * of this module check that figure against the plan rather than restating it.
 * Pure geometry: no React and no three.
 */
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import type { FloorPlan, SpaceKind } from './floorPlan/index.ts';
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
import { WALL_SPEC } from './wallSpec.ts';

/** Half of something, for midpoints. */
const HALF = 0.5;

/**
 * Widest solid that still counts as a single wall between two clear faces: the
 * thickest wall of `WALL_SPEC`, in metres. A larger distance between two facing
 * clear faces means the two faces do not share a wall.
 */
const MAX_WALL_THICKNESS = Math.max(WALL_SPEC.exterior, WALL_SPEC.partition, WALL_SPEC.voidFacing);

/** What a wall cell faces on one side when no space does: the outside of the plot. */
const OUTSIDE = 'outside';

/** What a wall cell faces on one side: the kind of the space, or the outside of the plot. */
type SideKind = SpaceKind | typeof OUTSIDE;

/**
 * The kinds of space that make a wall rise to full height; every other kind
 * (`openAir`, `void`, and the outside) only calls for a parapet (ADR-006).
 */
const FULL_HEIGHT_SIDE_KINDS: readonly SideKind[] = Object.freeze(['room', 'circulation']);

/** How tall a wall cell is: a full-height wall, or a parapet along open air. */
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

/** A clear rect of the plan together with the kind of space it belongs to. */
interface KindedRect {
  /** The clear rect. */
  readonly rect: PlanRect;
  /** Kind of the space the rect belongs to. */
  readonly kind: SpaceKind;
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

/** How to read one plan axis: the wall axis, and the cross axis that must overlap. */
interface AxisView {
  /** Smaller coordinate of a rect on the wall axis. */
  readonly rectMin: (rect: PlanRect) => number;
  /** Larger coordinate of a rect on the wall axis. */
  readonly rectMax: (rect: PlanRect) => number;
  /** Coordinate of a point on the wall axis. */
  readonly pointAt: (point: PlanPoint) => number;
  /** Whether a rect spans the point on the cross axis (half-open, as `rectContainsPoint`). */
  readonly crosses: (rect: PlanRect, point: PlanPoint) => boolean;
  /** Coordinate of the plot boundary at the low end of the wall axis. */
  readonly plotMin: number;
  /** Coordinate of the plot boundary at the high end of the wall axis. */
  readonly plotMax: number;
}

/**
 * Lists every clear rect of the plan with the kind of its space.
 *
 * @param plan - The floor plan.
 * @returns One entry per rect, in plan order.
 */
function kindedRects(plan: FloorPlan): readonly KindedRect[] {
  return plan.spaces.flatMap((space) => space.rects.map((rect) => ({ rect, kind: space.kind })));
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
 * @param plan - The floor plan.
 * @param xs - Grid lines along x, ascending.
 * @param zs - Grid lines along z, ascending.
 * @returns The wall cells, row by row.
 */
function wallCellsOfGrid(
  plan: FloorPlan,
  xs: readonly number[],
  zs: readonly number[],
): readonly GridCell[] {
  const rects = kindedRects(plan);
  const cells: GridCell[] = [];
  zs.slice(0, -1).forEach((minZ, iz) => {
    const maxZ = zs[iz + 1];
    xs.slice(0, -1).forEach((minX, ix) => {
      const maxX = xs[ix + 1];
      const centre: PlanPoint = { x: (minX + maxX) * HALF, z: (minZ + maxZ) * HALF };
      if (rects.some(({ rect }) => rectContainsPoint(rect, centre))) {
        return;
      }
      cells.push({ ix, iz, rect: makeRect(minX, maxX, minZ, maxZ), centre });
    });
  });
  return cells;
}

/**
 * Builds the two axis views of a plot.
 *
 * @param plot - Outer boundary of the floor.
 * @returns The view along x first, then the view along z.
 */
function axisViews(plot: PlanRect): readonly AxisView[] {
  return [
    {
      rectMin: (rect) => rect.minX,
      rectMax: (rect) => rect.maxX,
      pointAt: (point) => point.x,
      crosses: (rect, point) => point.z >= rect.minZ && point.z < rect.maxZ,
      plotMin: plot.minX,
      plotMax: plot.maxX,
    },
    {
      rectMin: (rect) => rect.minZ,
      rectMax: (rect) => rect.maxZ,
      pointAt: (point) => point.z,
      crosses: (rect, point) => point.x >= rect.minX && point.x < rect.maxX,
      plotMin: plot.minZ,
      plotMax: plot.maxZ,
    },
  ];
}

/**
 * Lists what a wall cell faces on one axis, when the two nearest clear faces on
 * that axis are close enough to share a wall.
 *
 * The nearest face on each side is taken from the clear rects that span the cell
 * centre on the cross axis: the largest `max` at or below the centre and the
 * smallest `min` at or above it. A side with no such rect is the plot boundary
 * and faces the {@link OUTSIDE}. The axis qualifies when the two faces are no
 * further apart than {@link MAX_WALL_THICKNESS}; the tolerance is required
 * because a drawn 0.30 m gap such as 1.60 − 1.30 is 0.30000000000000004 in
 * floating point.
 *
 * Deriving the sides from the clear rects rather than from the neighbouring
 * cells keeps the classification independent of how finely the grid happens to
 * be cut by the ports and windows.
 *
 * @param rects - Every clear rect of the plan, with its kind.
 * @param view - The axis to look along.
 * @param centre - Centre of the cell.
 * @returns The kinds faced on both sides, or `undefined` when the axis does not
 *   qualify, i.e. the cell is not part of a wall running across this axis.
 */
function facedKinds(
  rects: readonly KindedRect[],
  view: AxisView,
  centre: PlanPoint,
): readonly SideKind[] | undefined {
  const at = view.pointAt(centre);
  const crossing = rects.filter(({ rect }) => view.crosses(rect, centre));
  const before = crossing.filter(({ rect }) => view.rectMax(rect) < at);
  const after = crossing.filter(({ rect }) => view.rectMin(rect) > at);
  const low =
    before.length === 0 ? view.plotMin : Math.max(...before.map(({ rect }) => view.rectMax(rect)));
  const high =
    after.length === 0 ? view.plotMax : Math.min(...after.map(({ rect }) => view.rectMin(rect)));
  if (high - low > MAX_WALL_THICKNESS + LENGTH_TOLERANCE) {
    return undefined;
  }
  const lowKinds: readonly SideKind[] =
    before.length === 0
      ? [OUTSIDE]
      : before
          .filter(({ rect }) => view.rectMax(rect) >= low - LENGTH_TOLERANCE)
          .map(({ kind }) => kind);
  const highKinds: readonly SideKind[] =
    after.length === 0
      ? [OUTSIDE]
      : after
          .filter(({ rect }) => view.rectMin(rect) <= high + LENGTH_TOLERANCE)
          .map(({ kind }) => kind);
  return [...lowKinds, ...highKinds];
}

/**
 * Determines how tall the wall is in one cell.
 *
 * @param rects - Every clear rect of the plan, with its kind.
 * @param views - The two axis views of the plot.
 * @param centre - Centre of the cell.
 * @param heights - Vertical sizes to use.
 * @returns The height class, or `undefined` for a junction cell: one where no
 *   axis qualifies, such as the solid where two walls cross, whose height only
 *   its neighbours can tell.
 */
function classifyCell(
  rects: readonly KindedRect[],
  views: readonly AxisView[],
  centre: PlanPoint,
  heights: FloorHeights,
): HeightClass | undefined {
  const perAxis = views.map((view) => facedKinds(rects, view, centre));
  if (perAxis.every((kinds) => kinds === undefined)) {
    return undefined;
  }
  const faced = perAxis.flatMap((kinds) => kinds ?? []);
  return faced.some((kind) => FULL_HEIGHT_SIDE_KINDS.includes(kind))
    ? { height: heights.wall, kind: 'wall' }
    : { height: heights.railing, kind: 'parapet' };
}

/**
 * Formats a cell position as a map key.
 *
 * @param ix - Column index.
 * @param iz - Row index.
 * @returns A key unique to the position.
 */
function cellKey(ix: number, iz: number): string {
  return `${String(ix)}:${String(iz)}`;
}

/** The four edge-adjacent offsets of a cell, as `[dix, diz]`. */
const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

/**
 * Gives every junction cell the tallest height of the classified wall cells
 * touching its junction.
 *
 * Junction cells that touch each other form one component, and the whole
 * component takes the maximum height found on the classified cells edge-adjacent
 * to it, so the result does not depend on the order the cells are visited. A
 * junction is the solid where walls meet, for example a wall end or an outer
 * corner: taking the maximum keeps a wall that dies into a corner at its own
 * height instead of letting a parapet cut it down.
 *
 * @param cells - Every wall cell, classified ones and junctions alike.
 * @param junctions - The unclassified cells, in grid order.
 * @returns The resolved height class of each junction, keyed by cell position.
 * @throws RangeError naming the cell when a junction component touches no
 *   classified wall cell at all, which would leave its height unknown.
 */
function resolveJunctions(
  cells: readonly (GridCell & { readonly heightClass: HeightClass | undefined })[],
  junctions: readonly GridCell[],
): ReadonlyMap<string, HeightClass> {
  const byPosition = new Map(cells.map((cell) => [cellKey(cell.ix, cell.iz), cell]));
  const resolved = new Map<string, HeightClass>();
  const visited = new Set<string>();
  junctions.forEach((start) => {
    const startKey = cellKey(start.ix, start.iz);
    if (visited.has(startKey)) {
      return;
    }
    const component: GridCell[] = [];
    const queue: GridCell[] = [start];
    visited.add(startKey);
    let tallest: HeightClass | undefined;
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      component.push(current);
      NEIGHBOUR_OFFSETS.forEach(([dix, diz]) => {
        const key = cellKey(current.ix + dix, current.iz + diz);
        const neighbour = byPosition.get(key);
        if (neighbour === undefined) {
          return;
        }
        if (neighbour.heightClass === undefined) {
          if (!visited.has(key)) {
            visited.add(key);
            queue.push(neighbour);
          }
          return;
        }
        if (tallest === undefined || neighbour.heightClass.height > tallest.height) {
          tallest = neighbour.heightClass;
        }
      });
    }
    if (tallest === undefined) {
      throw new RangeError(
        `the wall junction at x ${String(start.rect.minX)}, z ${String(start.rect.minZ)} touches no wall cell whose height is known`,
      );
    }
    const height = tallest;
    component.forEach((cell) => {
      resolved.set(cellKey(cell.ix, cell.iz), height);
    });
  });
  return resolved;
}

/**
 * Builds the grid of wall cells of a plan, each with its height.
 *
 * @param plan - The floor plan.
 * @param openings - Ports and windows; only their footprints matter here, as
 *   extra grid lines, so that a later cut along an opening never splits a cell.
 * @param heights - Vertical sizes to use; defaults to `FLOOR_HEIGHTS`.
 * @returns The grid lines and the classified wall cells.
 * @throws RangeError when a junction component has no classified neighbour.
 */
function buildWallGrid(
  plan: FloorPlan,
  openings: readonly PlanBox[],
  heights: FloorHeights,
): WallGrid {
  const rects = kindedRects(plan);
  const footprints = [...rects.map(({ rect }) => rect), ...openings.map((opening) => opening.rect)];
  const xs = gridLines(
    footprints.flatMap((rect) => [rect.minX, rect.maxX]),
    plan.plot.minX,
    plan.plot.maxX,
  );
  const zs = gridLines(
    footprints.flatMap((rect) => [rect.minZ, rect.maxZ]),
    plan.plot.minZ,
    plan.plot.maxZ,
  );
  const views = axisViews(plan.plot);
  const classified = wallCellsOfGrid(plan, xs, zs).map((cell) => ({
    ...cell,
    heightClass: classifyCell(rects, views, cell.centre, heights),
  }));
  const junctions = classified.filter((cell) => cell.heightClass === undefined);
  const resolved = resolveJunctions(classified, junctions);
  const cells = classified.map(({ ix, iz, rect, centre, heightClass }) => {
    const known = heightClass ?? resolved.get(cellKey(ix, iz));
    if (known === undefined) {
      throw new RangeError(
        `the wall cell at x ${String(rect.minX)}, z ${String(rect.minZ)} has no height`,
      );
    }
    return { ix, iz, rect, centre, height: known.height, kind: known.kind };
  });
  return { xs, zs, cells };
}

/**
 * Returns the wall cells of a plan: the cells of the plan grid that no space
 * covers, each with the height of the wall there.
 *
 * The cells tile the whole wall footprint without overlapping, so their areas
 * sum to it — 42.52 m² for the typical floor (brief §8).
 *
 * @param plan - The floor plan.
 * @param openings - Ports and windows whose footprints also cut the grid; pass
 *   an empty array for the coarsest grid, which classifies the walls identically.
 * @param heights - Vertical sizes to use; defaults to `FLOOR_HEIGHTS`.
 * @returns A frozen array of frozen cells, row by row along z then column by
 *   column along x.
 * @throws RangeError when a junction of walls touches no cell whose height is
 *   known, so that its own height cannot be derived.
 */
export function getWallCells(
  plan: FloorPlan,
  openings: readonly PlanBox[],
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly WallCell[] {
  return Object.freeze(
    buildWallGrid(plan, openings, heights).cells.map(({ rect, height, kind }) =>
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
 */
function cellIntervals(
  cell: ClassifiedCell,
  openings: readonly PlanBox[],
  heights: FloorHeights,
): readonly Interval[] {
  const slabBottom = -(heights.floorToFloor - heights.wall);
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
 * The plot is cut on every clear face of the plan and every face of the
 * openings; the cells no space covers are the walls (brief §2). Each cell runs
 * from the underside of the slab, `-(floorToFloor - wall)`, up to its own height
 * — `heights.wall` where it walls a room or a circulation space, `heights.railing`
 * where every side it faces is open air, the void or the outside (ADR-006) —
 * minus the vertical span of every opening that covers it, which leaves a
 * threshold below a door and a sill and a lintel around a window. Cells that end
 * up with the same span are merged into maximal boxes.
 *
 * @param plan - The floor plan (ADR-005).
 * @param openings - Ports and windows to punch out, as boxes: the footprint of
 *   the hole and the vertical span it removes.
 * @param heights - Vertical sizes to use; defaults to `FLOOR_HEIGHTS`. Every
 *   level of the result comes from this argument alone.
 * @returns A frozen array of frozen boxes that never overlap, ordered by
 *   vertical span, then row, then column.
 * @throws RangeError when a junction of walls touches no cell whose height is
 *   known, so that its own height cannot be derived.
 */
export function getWallPieces(
  plan: FloorPlan,
  openings: readonly PlanBox[],
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly PlanBox[] {
  const { xs, zs, cells } = buildWallGrid(plan, openings, heights);
  const groups = new Map<
    string,
    { readonly interval: Interval; readonly cells: ClassifiedCell[] }
  >();
  cells.forEach((cell) => {
    cellIntervals(cell, openings, heights).forEach((interval) => {
      const key = intervalKey(interval);
      const group = groups.get(key) ?? { interval, cells: [] };
      group.cells.push(cell);
      groups.set(key, group);
    });
  });
  const ordered = [...groups.values()].sort(
    (a, b) => a.interval.bottom - b.interval.bottom || a.interval.top - b.interval.top,
  );
  return Object.freeze(
    ordered.flatMap(({ interval, cells: grouped }) =>
      mergeCells(grouped, xs, zs).map((rect) => makeBox(rect, interval.bottom, interval.top)),
    ),
  );
}

/**
 * Returns the plan area the walls occupy.
 *
 * The footprint is counted once however the walls are cut up vertically: a
 * footprint that carries a base block below a window and a head block above it
 * contributes its area a single time, and so does any footprint two blocks share
 * only partly. For the typical floor and its real openings the result is the
 * 42.52 m² of brief §8.
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
