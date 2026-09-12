/**
 * The television panel of the lounge.
 *
 * Brief §4.1 asks the living room and the corridor to read as one lounge: a
 * television is mounted on the corridor's south wall, facing the living room
 * through the 3.50 m opening between the two, so someone sitting in the living
 * room looks across the corridor at the screen. The owner answer of 2026-09-11
 * gives its height, from `FloorHeights.railing` up to `FloorHeights.door`.
 *
 * Its plan extent is NOT written here: it comes from the `tv` fixture in the
 * source of truth. It used to be a pair of literals quoting drawing Page-2, but
 * that provenance inverted — the drawing is now generated from the plan, so
 * quoting the drawing meant quoting a copy. The two had already drifted apart
 * (7.55–11.05 here against 7.50–11.00 in the plan) and drawing both would have
 * put two televisions on one wall.
 *
 * Where the panel sits along z is still derived from the corridor itself — the
 * panel hangs inside the corridor with its screen flush against the inside of
 * the south wall — so moving the corridor moves the television with it. That is
 * why the fixture's own z is ignored: one of the two has to win, and a position
 * that follows the wall it hangs on cannot be left behind by a moved corridor.
 *
 * Coordinates are in metres, with the plan conventions of `floorPlan/types.ts`.
 */

import { getSpace } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FIXTURES } from './sourceOfTruth/plan.ts';
import type { PlanFixture } from './sourceOfTruth/plan.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect, rectDepth, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';

/** Plan extent of the television panel, in metres, read from the source of truth. */
export interface TvPanelSpec {
  /** West end of the panel along the corridor, in metres. */
  readonly minX: number;
  /** East end of the panel along the corridor, in metres. */
  readonly maxX: number;
  /** How far the panel stands out from the wall it is mounted on, in metres. */
  readonly thickness: number;
}

/**
 * The `tv` fixture of the plan. There is exactly one; a floor with none, or with
 * two, is a mistake in the source of truth rather than something to pick between,
 * so this fails loudly instead of choosing.
 */
function readTvFixture(): PlanFixture {
  const televisions = FIXTURES.filter((fixture) => fixture.kind === 'tv');
  if (televisions.length !== 1) {
    throw new RangeError(
      `expected exactly one tv fixture in the plan, found ${String(televisions.length)}`,
    );
  }
  return televisions[0];
}

/**
 * The television panel: its width from the plan's `tv` fixture, its depth from
 * how far that fixture stands off the wall. Frozen.
 *
 * The z placement is absent on purpose: `getTvPanel` derives it from the
 * corridor's south wall, so the screen stays flush however the corridor moves.
 */
export const TV_PANEL_SPEC: TvPanelSpec = Object.freeze(
  ((): TvPanelSpec => {
    const [minX, maxX, minZ, maxZ] = readTvFixture().rect;
    return { minX, maxX, thickness: toPlanLength(maxZ - minZ) };
  })(),
);

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
  // The SOUTHERNMOST rect that can host it, not the first that fits.
  //
  // `find` took the first, which is the hall — it spans the panel's whole width
  // and is 1.50 deep, so it always won and the rect behind it was never reached.
  // But the stair bay lies directly behind the hall across the panel's full
  // width, so the hall's `maxZ` is not a wall there at all: the television hung
  // in open corridor, 0.50 short of the south wall it is documented as being
  // flush with. Taking the greatest `maxZ` picks the face that is really the
  // corridor's south side, which is the wall the living room looks at.
  const host = space.rects
    .filter(
      (rect) =>
        rect.minX <= TV_PANEL_SPEC.minX + LENGTH_TOLERANCE &&
        rect.maxX >= TV_PANEL_SPEC.maxX - LENGTH_TOLERANCE &&
        rectDepth(rect) >= TV_PANEL_SPEC.thickness - LENGTH_TOLERANCE,
    )
    .reduce<PlanRect | undefined>(
      (deepest, rect) => (deepest === undefined || rect.maxZ > deepest.maxZ ? rect : deepest),
      undefined,
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
