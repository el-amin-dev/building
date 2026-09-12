/**
 * The television panel of the lounge.
 *
 * Brief §4.1 asks the living room and the corridor to read as one lounge: a
 * television is mounted on the corridor's south wall, facing the living room
 * through the 3.50 m opening between the two, so someone sitting in the living
 * room looks across the corridor at the screen. Drawing Page-2 gives the panel
 * its plan extent, x 7.55–11.05 and 0.08 m thick; the owner answer of
 * 2026-09-11 gives its height, from `FloorHeights.railing` up to
 * `FloorHeights.door`.
 *
 * Only that extent and thickness are written here. Where the panel sits along z
 * is derived from the corridor itself — the panel hangs inside the corridor with
 * its screen flush against the inside of the south wall — so moving the corridor
 * moves the television with it.
 *
 * Coordinates are in metres, with the plan conventions of `floorPlan/types.ts`.
 */

import { getSpace } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect, rectDepth, toPlanLength } from './planGeometry.ts';

/** Plan extent of the television panel, in metres (drawing Page-2). */
export interface TvPanelSpec {
  /** West end of the panel along the corridor, in metres. */
  readonly minX: 7.55;
  /** East end of the panel along the corridor, in metres. */
  readonly maxX: 11.05;
  /** How far the panel stands out from the wall it is mounted on, in metres. */
  readonly thickness: 0.08;
}

/**
 * The television panel as drawn on Page-2: 3.50 m of screen, 0.08 m thick,
 * centred on the living-room opening. Frozen.
 *
 * The z placement is absent on purpose: `getTvPanel` derives it from the
 * corridor's south wall.
 */
export const TV_PANEL_SPEC: TvPanelSpec = Object.freeze({
  minX: 7.55,
  maxX: 11.05,
  thickness: 0.08,
});

/** The space the television is mounted in: it hangs on the corridor's south wall (brief §4.1). */
const TV_WALL_SPACE_ID: SpaceId = 'corridor';

/**
 * Places the television panel of the lounge.
 *
 * The panel is mounted inside the corridor, on the `maxZ` face of the rect that
 * spans it: its screen lies on that face and its body reaches back into the
 * corridor by `TV_PANEL_SPEC.thickness`. Vertically it runs from
 * `heights.railing` to `heights.door`, so it reads as a screen at eye level
 * rather than a full-height panel.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param heights - Vertical sizes of the floor; defaults to `FLOOR_HEIGHTS`.
 * @returns A frozen box: the panel in plan coordinates, between its two levels.
 * @throws RangeError naming the corridor and the drawn extent when no corridor
 *   rect can host the panel, i.e. none both covers x `minX`–`maxX` and is at
 *   least `thickness` deep, or when `heights.railing` is not below
 *   `heights.door` (see `makeBox`).
 */
export function getTvPanel(plan: FloorPlan, heights: FloorHeights = FLOOR_HEIGHTS): PlanBox {
  const space = getSpace(plan, TV_WALL_SPACE_ID);
  const host = space.rects.find(
    (rect) =>
      rect.minX <= TV_PANEL_SPEC.minX + LENGTH_TOLERANCE &&
      rect.maxX >= TV_PANEL_SPEC.maxX - LENGTH_TOLERANCE &&
      rectDepth(rect) >= TV_PANEL_SPEC.thickness - LENGTH_TOLERANCE,
  );
  if (host === undefined) {
    throw new RangeError(
      `the television panel x ${String(TV_PANEL_SPEC.minX)}–${String(TV_PANEL_SPEC.maxX)} does not fit any rect of space "${TV_WALL_SPACE_ID}"`,
    );
  }
  const rect = makeRect(
    TV_PANEL_SPEC.minX,
    TV_PANEL_SPEC.maxX,
    toPlanLength(host.maxZ - TV_PANEL_SPEC.thickness),
    host.maxZ,
  );
  return makeBox(rect, heights.railing, heights.door);
}
