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
 * Three functions, because the three groups have different sources and different lifetimes:
 *
 * - {@link getFloorLayout} buckets the solids that are always drawn. They all come from a
 *   {@link BuiltFloor}, so the function takes one.
 * - {@link getCeilingLayout} builds the solids that exist only in the interior view — a
 *   ceiling and a light panel per roofed space. They are *not* part of a `BuiltFloor`: a
 *   ceiling is the underside of the slab above, which belongs to the next storey, and a
 *   light panel is a luminaire, not structure. Both are derived from the plan and the
 *   heights alone.
 * - {@link getFixtureLayout} builds the sanitary ware: the basins, baths and shower trays
 *   the spec stands in the bathrooms. They are not part of a `BuiltFloor` either, and for
 *   the same reason a light panel is not: a bath is a thing standing in a room, not a piece
 *   of building fabric. That is exactly the precedent this module already set for the light
 *   panels, so a fitting is derived here rather than pushed into the domain's floor —
 *   until Part 4 gives fixtures a domain module of their own, at which point the levels
 *   below move there and this function takes them from a `BuiltFloor` like everything else.
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
import { makeRect, rectArea, rectDepth, rectWidth } from '../domain/planGeometry.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { FIXTURES } from '../domain/sourceOfTruth/plan.ts';
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
 *
 * This id is the one fixed identifier in this module, and it stands in for a property the
 * plan model does not carry. The redrawn plan calls the stairwell a kind of its own rather
 * than a circulation space; the day `SpaceKind` gains that kind, this constant and its use
 * in {@link isRoofed} should give way to it, which would let a second stairwell roof itself
 * correctly without being named here.
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
 * One fixture of the source-of-truth spec: an object standing in a room.
 *
 * Declared structurally rather than imported as a named type, so that this layer keeps
 * working whatever the spec module calls its own type, and reads only the three fields it
 * actually needs. `rect` is the spec's `[minX, maxX, minZ, maxZ]` tuple, in metres.
 */
export interface SpecFixture {
  /** What the fixture is: `sink`, `bath`, `shower`, `tv`, `partition`. */
  readonly kind: string;
  /** Identifier of the space the fixture stands in. */
  readonly room: string;
  /** Footprint of the fixture as `[minX, maxX, minZ, maxZ]`, in metres. */
  readonly rect: readonly number[];
}

/** Number of coordinates of a spec fixture rect: `[minX, maxX, minZ, maxZ]`. */
const FIXTURE_RECT_LENGTH = 4;

/** The vertical span of one fixture, in metres above the finished floor. */
interface FixtureLevels {
  /** Level of the underside. */
  readonly bottom: number;
  /** Level of the top. */
  readonly top: number;
}

/**
 * How tall each piece of sanitary ware stands, in metres above the finished floor.
 *
 * These are fitting sizes, not building dimensions, so they are not in `heights.ts`
 * (ADR-006 covers the building's vertical dimensions; a rail profile in `railings.ts` and
 * the panel depth in `tvPanel.ts` are the existing precedent for a fitting carrying its own
 * size). The spec gives every fixture a footprint and no height at all, so the heights are
 * ordinary domestic ones: a basin as the counter slab it sits in, a bath as its tub, a
 * shower as its tray.
 *
 * This record is also the list of what counts as sanitary ware: a kind that is absent is
 * not drawn here and does not make its room wet. `tv` is deliberately absent — the
 * television already has a domain module (`tvPanel.ts`) that derives it from the corridor
 * wall rather than from a written rect, and drawing the spec's `tv` fixture too would put
 * two televisions on the same wall. `partition` is absent because it is a screen, and the
 * spec itself says it is a fixture only so that it stays out of the wall derivation.
 */
const SANITARY_FIXTURE_LEVELS: Readonly<Record<string, FixtureLevels>> = Object.freeze({
  sink: Object.freeze({ bottom: 0.72, top: 0.88 }),
  bath: Object.freeze({ bottom: FINISHED_FLOOR_LEVEL, top: 0.55 }),
  shower: Object.freeze({ bottom: FINISHED_FLOOR_LEVEL, top: 0.1 }),
});

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

/** The one bucket the fixtures fill: the sanitary ware standing in the bathrooms. */
export type FixtureLayout = Readonly<Pick<FloorLayout, 'sanitaryWare'>>;

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
    slabWet: [],
    ceiling: [],
    lightPanel: [],
    railing: [],
    stairs: [],
    tvPanel: [],
    sanitaryWare: [],
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
 * Names the spaces that are wet rooms: the ones holding sanitary ware.
 *
 * A wet room is not a space kind. The two bathrooms and the four bath and shower cubicles
 * inside them are all ordinary `room` spaces, so `getSlabMaterialKey`, which maps a *kind*
 * to a slab material, cannot tell them from a bedroom. Nor is there a list of ids to read:
 * the plan model carries no "wet" flag.
 *
 * What does distinguish them is already in the spec — a room with a basin, a bath or a
 * shower tray in it is a wet room, and one without is not. Deriving the set that way means
 * a cubicle added to the spec is tiled without anything here being edited, and that no id
 * of the new plan is written down in this layer.
 *
 * @param fixtures - The fixtures of the spec. Not mutated.
 * @returns The ids of the spaces holding at least one piece of sanitary ware.
 */
function getWetSpaceIds(fixtures: readonly SpecFixture[]): ReadonlySet<string> {
  return new Set(
    fixtures
      .filter((fixture) => SANITARY_FIXTURE_LEVELS[fixture.kind] !== undefined)
      .map((fixture) => fixture.room),
  );
}

/**
 * Groups every always-drawn solid of a built floor by material.
 *
 * - the wall blocks split into `wall` and `parapet` by the `kind` the wall generator put on
 *   each of them (`WallPiece`, `walls.ts`). A parapet is *stated* in the spec's
 *   `PARAPET_WALLS` and derived there, never inferred here. Since ADR-011 the stated
 *   balustrade and `heights.railing` are the same 1.10, which is exactly why a top
 *   comparison looks right and is not: the stated height is plan data and the railing is
 *   an argument, so they coincide at the production heights and part company under any
 *   others. An opening also cuts a full-height wall into blocks lower than either, so a
 *   top cannot tell the two apart even before the heights change;
 * - each slab into `slabRoom`, `slabCirculation` or `slabOpenAir`, after the kind of the
 *   space it carries (`getSlabMaterialKey`) — or into `slabWet` when that space holds
 *   sanitary ware, which is the one slab material a space *kind* cannot choose (see
 *   {@link getWetSpaceIds});
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
 * @param fixtures - The fixtures of the spec, used only to tell which spaces are wet rooms;
 *   defaults to `FIXTURES`. Not mutated.
 * @returns A frozen {@link FloorLayout} carrying every material key. Equal inputs always
 *   give an equal result, so a caller may build it once and memoise it.
 * @throws RangeError when `fixtures` is not an array, when a slab names a space the plan does
 *   not hold (`getSpace`), when a slab's space is a `void` and so has no slab material
 *   (`getSlabMaterialKey`), or when a railing height leaves no box to draw (`makeBox`).
 */
export function getFloorLayout(
  builtFloor: BuiltFloor,
  plan: FloorPlan = FLOOR_PLAN,
  fixtures: readonly SpecFixture[] = FIXTURES,
): FloorLayout {
  // A layout takes every level from the floor it is handed, so this parameter is
  // easy to mistake for the heights — and a `FloorHeights` passed here used to
  // die as `fixtures.filter is not a function` deep inside `getWetSpaceIds`.
  // That threw at module load in one test file and silently took all 24 of its
  // assertions with it, so the file reported green while testing nothing.
  if (!Array.isArray(fixtures)) {
    throw new RangeError(`fixtures must be an array of spec fixtures, got ${typeof fixtures}`);
  }
  const layout = emptyLayout();
  const wetSpaceIds = getWetSpaceIds(fixtures);
  for (const piece of builtFloor.walls) {
    layout[piece.kind === 'parapet' ? 'parapet' : 'wall'].push(piece);
  }
  for (const slab of builtFloor.slabs) {
    const space = getSpace(plan, slab.spaceId);
    layout[wetSpaceIds.has(space.id) ? 'slabWet' : getSlabMaterialKey(space.kind)].push(slab);
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

/**
 * Builds the sanitary ware of the floor: one box per basin, bath and shower tray.
 *
 * The spec gives each fixture a footprint and the room it stands in, and nothing vertical;
 * the levels come from {@link SANITARY_FIXTURE_LEVELS}, which is also what decides that a
 * fixture is sanitary ware at all. A fixture of any other kind is skipped rather than
 * rejected, so the spec may carry a television and a screen — as it does — without this
 * layer having to know what to do with them.
 *
 * These boxes are always drawn, not interior-only. A ceiling is hidden from outside so that
 * the floor can be seen from above at all; a bath is one of the things worth seeing when it
 * is, so hiding it would defeat the roof-off view. They are also one bucket, not one per
 * kind: a basin, a bath and a tray are the same glazed white ceramic, so they merge into a
 * single mesh and cost one draw call between them.
 *
 * @param fixtures - The fixtures of the spec; defaults to `FIXTURES`. Not mutated.
 * @returns A frozen {@link FixtureLayout} with its one frozen bucket, in spec order.
 * @throws RangeError naming the fixture when its rect does not carry exactly the four
 *   coordinates `[minX, maxX, minZ, maxZ]`, or when its footprint or levels leave no box to
 *   draw (`makeRect`, `makeBox`).
 */
export function getFixtureLayout(fixtures: readonly SpecFixture[] = FIXTURES): FixtureLayout {
  const sanitaryWare: readonly PlanBox[] = Object.freeze(
    fixtures.flatMap((fixture) => {
      const levels = SANITARY_FIXTURE_LEVELS[fixture.kind];
      if (levels === undefined) {
        return [];
      }
      if (fixture.rect.length !== FIXTURE_RECT_LENGTH) {
        throw new RangeError(
          `the ${fixture.kind} of space "${fixture.room}" needs ${String(FIXTURE_RECT_LENGTH)} rect coordinates, got ${String(fixture.rect.length)}`,
        );
      }
      const [minX, maxX, minZ, maxZ] = fixture.rect;
      return [makeBox(makeRect(minX, maxX, minZ, maxZ), levels.bottom, levels.top)];
    }),
  );
  return Object.freeze({ sanitaryWare });
}
