/**
 * Groups the solids of a built floor into one bucket per material.
 *
 * `builtFloor.ts` answers *what the floor is made of* — wall blocks, slabs, steps, railings,
 * a television panel — in the order and the coordinates each domain module owns. The
 * renderer needs the same solids sorted the other way round: **by material**, because every
 * box sharing a material is baked into a single merged geometry and drawn by one mesh
 * (`mergeBoxes.ts`, `MergedBoxesMesh.tsx`). This module is that transposition and nothing
 * more: it invents no coordinate, so a geometry rule still changes only in the domain.
 *
 * Two functions, because the two groups have different sources and different lifetimes:
 *
 * - {@link getFloorLayout} buckets the solids that are always drawn. They all come from a
 *   {@link BuiltFloor}, so the function takes one.
 * - {@link getCeilingLayout} builds the solids that exist only in the interior view — a
 *   ceiling and a light panel per roofed space. They are *not* part of a `BuiltFloor`: a
 *   ceiling is the underside of the slab above, which belongs to the next storey, and a
 *   light panel is a luminaire, not structure. Both are derived from the plan and the
 *   heights alone.
 *
 * Every vertical level comes from the `heights` argument and every plan coordinate from the
 * `plan` argument or from the built floor, so injecting other sizes moves the whole layout
 * together and no building dimension is written down here (`heights.ts`, ADR-006).
 *
 * Pure data, in metres: no React, no three, nothing mutated. The results are frozen and
 * deterministic, so a caller may build them once and memoise them — which is what
 * `FloorModel.tsx` does, because `MergedBoxesMesh` rebuilds its geometry whenever the array
 * it is given changes identity.
 */

import type { BuiltFloor } from '../domain/builtFloor.ts';
import { FLOOR_PLAN, getSpace } from '../domain/floorPlan/index.ts';
import type { FloorPlan, Space, SpaceId } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import type { FloorHeights } from '../domain/heights.ts';
import { makeBox } from '../domain/planBox.ts';
import type { PlanBox } from '../domain/planBox.ts';
import {
  LENGTH_TOLERANCE,
  makeRect,
  rectArea,
  rectDepth,
  rectWidth,
} from '../domain/planGeometry.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { getSlabMaterialKey, MATERIAL_PALETTE } from './floorMaterials.ts';
import type { FloorMaterialKey } from './floorMaterials.ts';

/** Half of a span: the distance from a rectangle's centre to one of its faces. */
const HALF = 0.5;

/** Level of the finished floor of the storey, in metres: the foot of a railing. */
const FINISHED_FLOOR_LEVEL = 0;

/**
 * The circulation space the stairs occupy.
 *
 * It is the one roofed space that gets no ceiling: the dog-leg rises through the opening in
 * the slab above, so putting a ceiling over it would cap the stairwell (`stairs.ts`, brief
 * §4.2).
 */
const STAIRS_SPACE_ID: SpaceId = 'stairs';

/** Space kinds that are roofed, i.e. that have a slab above them as well as below. */
const ROOFED_SPACE_KINDS = Object.freeze(['room', 'circulation'] as const);

/**
 * Side of a light panel as a fraction of the side of the rect it lights.
 *
 * A luminaire, not a luminous ceiling: small enough to read as a fitting, large enough that
 * its emission lights the room it hangs in (`floorMaterials.ts`, `lightPanel`).
 */
const LIGHT_PANEL_RECT_FRACTION = 0.3;

/** Thickness of a light panel, in metres: a flat fitting under the ceiling. */
const LIGHT_PANEL_THICKNESS = 0.04;

/**
 * Every solid of the floor, grouped by the material it is drawn with.
 *
 * Every key of the palette is present, with an empty array where the floor has nothing of
 * that material, so a renderer can map over the palette without checking for a missing
 * bucket.
 */
export type FloorLayout = Readonly<Record<FloorMaterialKey, readonly PlanBox[]>>;

/** The two buckets that exist only while the interior is shown. */
export type CeilingLayout = Readonly<Pick<FloorLayout, 'ceiling' | 'lightPanel'>>;

/**
 * Every material key, in palette order.
 *
 * Derived from {@link MATERIAL_PALETTE} rather than written out again, so a new surface
 * family cannot be added to the palette and forgotten here.
 */
export const FLOOR_MATERIAL_KEYS: readonly FloorMaterialKey[] = Object.freeze(
  // Every key of the palette is a `FloorMaterialKey` by the palette's own type.
  Object.keys(MATERIAL_PALETTE) as readonly FloorMaterialKey[],
);

/** The buckets of a layout while it is still being filled. */
type MutableLayout = Record<FloorMaterialKey, PlanBox[]>;

/**
 * Builds the empty buckets of a layout.
 *
 * Written as a full object literal on purpose: TypeScript then rejects the change that adds
 * a key to {@link FloorMaterialKey} without giving it a bucket.
 *
 * @returns One empty, mutable array per material key.
 */
function emptyLayout(): MutableLayout {
  return {
    wall: [],
    parapet: [],
    slabRoom: [],
    slabCirculation: [],
    slabOpenAir: [],
    ceiling: [],
    lightPanel: [],
    railing: [],
    stairs: [],
    tvPanel: [],
  };
}

/**
 * Freezes a filled layout, arrays included.
 *
 * @param layout - The buckets to freeze; adopted, not copied.
 * @returns The same object, deeply frozen down to each bucket.
 */
function freezeLayout(layout: MutableLayout): FloorLayout {
  for (const key of FLOOR_MATERIAL_KEYS) {
    Object.freeze(layout[key]);
  }
  return Object.freeze(layout);
}

/**
 * Tells whether a wall piece is a parapet rather than a full-height wall.
 *
 * `getWallPieces` gives a cell the height of a wall where it faces a room or a circulation
 * space, and the height of a railing where every side it faces is open air, the void or the
 * outside (`walls.ts`, ADR-006). A parapet is therefore recognised by its top standing at
 * `heights.railing`, and both heights are read from the argument so no building dimension
 * is repeated here.
 *
 * The test is equality with the railing height, not "below the wall height", because an
 * opening splits its cell: the threshold under a door and the sill under a window are
 * pieces of a full-height wall whose own top is *lower* than a parapet's. They are plaster,
 * so they stay in the `wall` bucket. The one case this cannot tell apart is a parapet that
 * an opening has cut down — the floor has none, since every wall an opening crosses faces a
 * room or a circulation space and is full height.
 *
 * @param piece - A wall block of a built floor.
 * @param heights - The vertical sizes the floor was built with.
 * @returns `true` when the piece rises exactly to `heights.railing`.
 */
function isParapet(piece: PlanBox, heights: FloorHeights): boolean {
  return Math.abs(piece.top - heights.railing) <= LENGTH_TOLERANCE;
}

/**
 * Groups every always-drawn solid of a built floor by material.
 *
 * - the wall blocks split into `wall` and `parapet` by their top (see {@link isParapet});
 * - each slab into `slabRoom`, `slabCirculation` or `slabOpenAir`, after the kind of the
 *   space it carries (`getSlabMaterialKey`);
 * - the steps of the dog-leg into `stairs`;
 * - each railing into `railing`, as a box from the finished floor up to its handrail — a
 *   `Railing` carries a rect and a top rather than a box (`railings.ts`);
 * - the television panel into `tvPanel`.
 *
 * The boxes of a bucket keep the order of the built floor, and every box that is already a
 * {@link PlanBox} is passed through by reference rather than copied. The `ceiling` and
 * `lightPanel` buckets are always empty here: those solids belong to
 * {@link getCeilingLayout}, which is what lets a renderer draw the two layouts side by side
 * without drawing anything twice.
 *
 * @param builtFloor - The floor to group. Not mutated.
 * @param plan - The plan it was built from, used to read the kind of each slab's space;
 *   defaults to `FLOOR_PLAN`. Not mutated.
 * @param heights - The vertical sizes it was built with, used to tell a parapet from a
 *   wall; defaults to `FLOOR_HEIGHTS`.
 * @returns A frozen {@link FloorLayout} carrying every material key. Equal inputs always
 *   give an equal result, so a caller may build it once and memoise it.
 * @throws RangeError when a slab names a space the plan does not hold (`getSpace`), when a
 *   slab's space is a `void` and so has no slab material (`getSlabMaterialKey`), or when a
 *   railing height leaves no box to draw (`makeBox`).
 */
export function getFloorLayout(
  builtFloor: BuiltFloor,
  plan: FloorPlan = FLOOR_PLAN,
  heights: FloorHeights = FLOOR_HEIGHTS,
): FloorLayout {
  const layout = emptyLayout();
  for (const piece of builtFloor.walls) {
    layout[isParapet(piece, heights) ? 'parapet' : 'wall'].push(piece);
  }
  for (const slab of builtFloor.slabs) {
    layout[getSlabMaterialKey(getSpace(plan, slab.spaceId).kind)].push(slab);
  }
  for (const step of builtFloor.stairs.steps) {
    layout.stairs.push(step);
  }
  for (const railing of builtFloor.railings) {
    layout.railing.push(makeBox(railing.rect, FINISHED_FLOOR_LEVEL, railing.top));
  }
  layout.tvPanel.push(builtFloor.tvPanel);
  return freezeLayout(layout);
}

/**
 * Tells whether a space has a slab above it.
 *
 * @param space - The space to test.
 * @returns `true` for a room or a circulation space other than the stairs; `false` for the
 *   stairs, whose flight rises through the slab above, and for an `openAir` or `void` space,
 *   which is open to the sky (brief §5.1, §5.2).
 */
function isRoofed(space: Space): boolean {
  return ROOFED_SPACE_KINDS.some((kind) => kind === space.kind) && space.id !== STAIRS_SPACE_ID;
}

/**
 * Returns the largest clear rect of a space.
 *
 * A space made of several rects — the L-shaped guest room — has no single centre, and the
 * centre of its bounding rect can fall outside the space altogether. The light panel is
 * therefore hung in the space's widest part, which is inside the space by construction.
 *
 * @param space - The space to measure. Must have at least one rect, which every space of a
 *   valid plan has (`validateFloorPlan`).
 * @returns The rect of the space with the greatest area; the first one on a tie.
 * @throws RangeError naming the space when it has no rect at all.
 */
function getLargestRect(space: Space): PlanRect {
  const largest = space.rects.reduce<PlanRect | undefined>(
    (best, rect) => (best === undefined || rectArea(rect) > rectArea(best) ? rect : best),
    undefined,
  );
  if (largest === undefined) {
    throw new RangeError(`space "${space.id}" has no rect to light`);
  }
  return largest;
}

/**
 * Builds the footprint of the light panel of one rect.
 *
 * A {@link LIGHT_PANEL_RECT_FRACTION} of the rect on both axes, centred on it. The faces
 * are left unrounded: a fraction of a grid length is not itself a whole number of
 * centimetres, and snapping it would push the panel off centre (the same reasoning as the
 * rail profile in `railings.ts`).
 *
 * @param rect - The rect the panel lights.
 * @returns A frozen rectangle centred on `rect`.
 */
function getLightPanelRect(rect: PlanRect): PlanRect {
  const centreX = (rect.minX + rect.maxX) * HALF;
  const centreZ = (rect.minZ + rect.maxZ) * HALF;
  const halfWidth = rectWidth(rect) * LIGHT_PANEL_RECT_FRACTION * HALF;
  const halfDepth = rectDepth(rect) * LIGHT_PANEL_RECT_FRACTION * HALF;
  return makeRect(
    centreX - halfWidth,
    centreX + halfWidth,
    centreZ - halfDepth,
    centreZ + halfDepth,
  );
}

/**
 * Builds the ceilings and the light panels of a plan.
 *
 * One ceiling box per clear rect of every roofed space (see {@link isRoofed}), spanning from
 * `heights.wall` up to `heights.floorToFloor`: the ceiling *is* the slab of the storey above,
 * seen from below, so it fills exactly the part of the floor-to-floor height the walls do not
 * (`slabs.ts`). Per rect rather than per space, because the bounding rect of an L-shaped
 * space would roof its neighbours too.
 *
 * Then one light panel per roofed space, hung under the ceiling in the space's largest rect.
 * This is the room's light: the palette makes it emissive and there is deliberately no point
 * light per room, so that the number of lights three.js compiles into every material's
 * shader stays the three of `SceneLighting` (`lightingSpec.ts`).
 *
 * Both buckets are listed in plan order — the order of `plan.spaces`, then the order of each
 * space's `rects` — so the *n*-th light panel belongs to the *n*-th roofed space.
 *
 * @param plan - The plan to roof; defaults to `FLOOR_PLAN`. Not mutated.
 * @param heights - Vertical sizes of the floor, in metres; defaults to `FLOOR_HEIGHTS`.
 *   Every level of the result comes from this argument alone.
 * @returns A frozen {@link CeilingLayout} with its two frozen buckets.
 * @throws RangeError when `heights` leaves no room for a ceiling, i.e. when `wall` reaches
 *   `floorToFloor`, or no room for a panel below it (`makeBox`).
 */
export function getCeilingLayout(
  plan: FloorPlan = FLOOR_PLAN,
  heights: FloorHeights = FLOOR_HEIGHTS,
): CeilingLayout {
  const roofed = plan.spaces.filter((space) => isRoofed(space));
  const ceiling: readonly PlanBox[] = Object.freeze(
    roofed.flatMap((space) =>
      space.rects.map((rect) => makeBox(rect, heights.wall, heights.floorToFloor)),
    ),
  );
  const lightPanel: readonly PlanBox[] = Object.freeze(
    roofed.map((space) =>
      makeBox(
        getLightPanelRect(getLargestRect(space)),
        heights.wall - LIGHT_PANEL_THICKNESS,
        heights.wall,
      ),
    ),
  );
  return Object.freeze({ ceiling, lightPanel });
}
