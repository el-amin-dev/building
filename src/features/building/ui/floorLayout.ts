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
 * Since Part 5 the same transposition covers the service runs, which arrive on the built
 * floor exactly as the walls and the fixtures do ({@link BuiltServiceRun}): a run names a
 * FAMILY and never a palette key, and {@link SERVICE_FAMILY_MATERIAL} is the one place a
 * family becomes a hue.
 *
 * Three functions, because the three groups have different sources and different lifetimes:
 *
 * - {@link getFloorLayout} buckets the solids that are always drawn. They all come from a
 *   {@link BuiltFloor}, so the function takes one.
 * - {@link getCeilingLayout} builds the solids that exist only in the interior view — a
 *   ceiling and a light panel per roofed space. They are *not* part of a `BuiltFloor`: a
 *   ceiling is the underside of the slab above, which belongs to the next storey, and a
 *   light panel is a luminaire, not structure. Both are derived from the plan and the
 *   heights alone. That first clause is also the rule the scene stacks by: once the next
 *   storey genuinely exists, its slab already *is* the ceiling, so `FloorModel.tsx` draws
 *   the `ceiling` bucket at the top storey only — drawing it under every storey would put
 *   two solids coincident on all six faces, and they would z-fight. The `lightPanel`
 *   bucket is drawn at every storey: a luminaire is nobody else's slab.
 * The fixtures used to be a third group, built here from the spec with their heights written
 * down in this file, because nothing in the domain knew how tall a bath was. Part 4 gave them
 * `domain/fixtures.ts` and put them on the `BuiltFloor`, so they arrive like the walls do and
 * this module only sorts them: a fixture part names a {@link FixtureSurface}, and
 * {@link FIXTURE_SURFACE_MATERIAL} is the one place a surface family becomes a palette key.
 * That seam is the same one `WallPiece.kind` already uses — the domain says what a thing is
 * made of, the UI says what that is painted with.
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
import { FABRIC_FIXTURE_KINDS, isServicedSpace } from '../domain/fixtures.ts';
import type { FixtureSurface } from '../domain/fixtures.ts';
import { FLOOR_PLAN, getSpace } from '../domain/floorPlan/index.ts';
import type { FloorPlan, Space, SpaceId } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import type { FloorHeights } from '../domain/heights.ts';
import { makeBox } from '../domain/planBox.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { makeRect, rectArea, rectDepth, rectWidth } from '../domain/planGeometry.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import type { ShownLayers } from '../application/layerStore.ts';
import type { BuiltServiceRun } from '../domain/services.ts';
import type { PlanServiceFamily, PlanServiceLayerKey } from '../domain/sourceOfTruth/plan.ts';
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
 * What each surface family of a fixture is painted with.
 *
 * The domain names a family — a bath is `sanitaryWare`, a wardrobe is `joinery` — and never a
 * palette key, because a palette is a decision about how the building looks and belongs on
 * this side of the seam. Total over {@link FixtureSurface}, so a family added to the domain
 * cannot reach the renderer without a colour being chosen for it.
 */
const FIXTURE_SURFACE_MATERIAL: Readonly<Record<FixtureSurface, FloorMaterialKey>> = Object.freeze({
  sanitaryWare: 'sanitaryWare',
  appliance: 'appliance',
  joinery: 'joinery',
  worktop: 'worktop',
  softFurnishing: 'softFurnishing',
  artwork: 'artwork',
  serviceChamber: 'serviceChamber',
});

/**
 * Where a part of a BUILDING-FABRIC fitting goes instead.
 *
 * `FABRIC_FIXTURE_KINDS` names the fittings that are not a room's contents but the
 * building itself, built as a fitting because that is how they are made: the food-pass
 * counter is half a wall with a hole in it, and the control-center chambers are the
 * floor's own plant. The `furniture` checkbox exists to clear a room, and neither of
 * these would be cleared by hiding it — the pass counter would take a 0.30 m slot from
 * the guest room into the kitchen with it, and the chambers would leave the plant of the
 * floor standing in open air (`fixtures.ts`, `FABRIC_FIXTURE_KINDS`).
 *
 * So a fabric fitting's parts are bucketed apart from the furniture, and only the
 * bucket changes: `fabricJoinery` is the same oak as `joinery`, at the same roughness,
 * because it IS the same oak (`floorMaterials.ts`). A `serviceChamber` surface already
 * has a bucket of its own and keeps it — that key was split out for this very reason
 * when the meter cupboard became the two compartments of the control center (ADR-022) —
 * so only the surfaces that would otherwise land among the furniture are redirected.
 *
 * Total over {@link FixtureSurface} for the reason the map above is: a surface family
 * added to the domain cannot reach a fabric fitting without somebody deciding where it
 * goes when the furniture is hidden.
 */
const FABRIC_SURFACE_MATERIAL: Readonly<Record<FixtureSurface, FloorMaterialKey>> = Object.freeze({
  sanitaryWare: 'fabricJoinery',
  appliance: 'fabricJoinery',
  joinery: 'fabricJoinery',
  // The pass counter's ledge, which is a worktop by shape and fabric by function: it is
  // the sill of the food-pass bore, and hiding it would leave that bore's mouth open.
  worktop: 'fabricJoinery',
  softFurnishing: 'fabricJoinery',
  artwork: 'fabricJoinery',
  serviceChamber: 'serviceChamber',
});

/**
 * What each service family is drawn with.
 *
 * The domain names a family — a run carries soil, or cold water, or data — and the
 * palette decides the hue, the same seam `FIXTURE_SURFACE_MATERIAL` sits on. Several
 * families deliberately share a bucket, because the question a services view answers is
 * "which service is this", not "which of two pipe sizes": the four drainage families are
 * one grey, power and lighting are one orange, and the chamber vents are drawn with the
 * gas they vent.
 *
 * Total over {@link PlanServiceFamily}, so a family declared in the plan tomorrow is a
 * compile error here rather than a run that silently vanishes from every layer.
 */
const SERVICE_FAMILY_MATERIAL: Readonly<Record<PlanServiceFamily, FloorMaterialKey>> =
  Object.freeze({
    soil: 'serviceDrainage',
    waste: 'serviceDrainage',
    gully: 'serviceDrainage',
    vent: 'serviceDrainage',
    cold: 'serviceWaterCold',
    hot: 'serviceWaterHot',
    gas: 'serviceGas',
    // A chamber vent is a gas-safety duct and is read with the gas it vents: telling it
    // apart from the bottle it protects would be a distinction with nothing behind it.
    chamberVent: 'serviceGas',
    power: 'serviceElectricity',
    lighting: 'serviceElectricity',
    data: 'serviceLowVoltage',
    cooling: 'serviceClimateCool',
    heating: 'serviceClimateHeat',
  });

/** No checkbox hides this bucket: it is the building, and the building is always there. */
const ALWAYS_DRAWN = null;

/** How one bucket answers to the checkboxes. */
export interface BucketRule {
  /**
   * The layer whose checkbox hides this bucket, or {@link ALWAYS_DRAWN} for a bucket that
   * is the building itself. Exactly one layer, because a bucket a viewer cannot attribute
   * to a single checkbox is a pixel nobody can explain.
   */
  readonly hiddenBy: PlanServiceLayerKey | null;
  /**
   * Whether unticking `finishing` re-surfaces this bucket with `plainSurface`.
   *
   * Re-surfaced, never removed: `finishing` adds and takes away no box (`SERVICE_LAYERS`).
   * True exactly of the buckets the decorative scheme reaches, which are the buckets that
   * carry a texture (`FAMILY_TEXTURE`, `FloorModel.tsx`) — a surface with a grain on it is
   * a finished surface, and leaving the grain on with the finish off would be the checkbox
   * doing nothing at all.
   */
  readonly finish: boolean;
}

/**
 * **Which checkbox is responsible for every pixel of the building.**
 *
 * One table, read by {@link isBucketShown} and {@link isBucketPlain} and by nothing else, so
 * the answer to "why is that there" is a row here rather than a condition spelled out at the
 * point it happens to be drawn. It lives beside the other bucket tables of this module
 * rather than in `FloorModel.tsx`, where it is consumed: those tables answer WHICH bucket a
 * solid goes into and this one answers what that bucket then answers to, which is the same
 * question asked twice, and a component file may export nothing but components anyway. Total over {@link FloorMaterialKey}: a palette key added
 * without a rule is a compile error, not a bucket that quietly ignores every checkbox.
 *
 * Three groups, and the whole design of Part 5 is in which group a bucket lands in:
 *
 * 1. **The building** (`hiddenBy: ALWAYS_DRAWN`). Nothing ticked is NAKED WALLS — structure,
 *    slabs, ceilings, railings, the stairs, the television panel — and naked walls are still
 *    a building. `fabricJoinery` and `serviceChamber` are here although they are built as
 *    fittings: the food-pass counter is half a wall with a hole in it and the control-center
 *    chambers are the floor's own plant, so hiding either opens a hole rather than clearing
 *    a room (`FABRIC_FIXTURE_KINDS`, ADR-022).
 * 2. **The furniture** (`hiddenBy: 'furniture'`). What a remover could carry out: the ware,
 *    the white goods, the millwork, the tops and the upholstery. Five buckets, and the two
 *    fabric ones above are deliberately not among them.
 * 3. **The services** (`hiddenBy:` a service layer). One bucket per hue, mapped back to the
 *    layer it belongs to — the two water families to `water`, the two climate families to
 *    `climate` — plus `serviceCover`, whose checkbox is `covers` and not the service it
 *    boxes in, because seeing the boxing without the pipe is the whole point of it.
 *
 * `finishing` cuts across all three and is the one checkbox that is not a set of boxes.
 * `artwork` is the single exception it makes: a canvas hung on a wall is a finish with no
 * unfinished state — plain screed over a painting is not what an unfinished flat looks like,
 * an empty wall is — so it is HIDDEN by `finishing` rather than re-surfaced by it, and it is
 * the only bucket whose `hiddenBy` is `finishing`.
 */
export const BUCKET_RULES: Readonly<Record<FloorMaterialKey, BucketRule>> = Object.freeze({
  // ── The building ────────────────────────────────────────────────────────────────────
  // Plaster and paint. Already the plain finish: a matte white wall is what the building
  // is handed over as, so `finishing` has nothing to strip off it.
  wall: { hiddenBy: ALWAYS_DRAWN, finish: false },
  parapet: { hiddenBy: ALWAYS_DRAWN, finish: false },
  // The slabs carry the scheme underfoot — carpet, oak boards, marble — so all three of
  // those go back to screed. The terrace is paved rather than decorated and stays put.
  slabRoom: { hiddenBy: ALWAYS_DRAWN, finish: true },
  slabCirculation: { hiddenBy: ALWAYS_DRAWN, finish: true },
  slabOpenAir: { hiddenBy: ALWAYS_DRAWN, finish: false },
  slabServiced: { hiddenBy: ALWAYS_DRAWN, finish: true },
  // Painted plaster, like the walls, and the luminaire that is a fitting and not a finish.
  ceiling: { hiddenBy: ALWAYS_DRAWN, finish: false },
  lightPanel: { hiddenBy: ALWAYS_DRAWN, finish: false },
  // A balustrade is there to stop a fall, at every state of the build.
  railing: { hiddenBy: ALWAYS_DRAWN, finish: false },
  // The flight is structure; its oak treads are the finish on it.
  stairs: { hiddenBy: ALWAYS_DRAWN, finish: true },
  tvPanel: { hiddenBy: ALWAYS_DRAWN, finish: false },
  // ── The furniture ───────────────────────────────────────────────────────────────────
  sanitaryWare: { hiddenBy: 'furniture', finish: false },
  appliance: { hiddenBy: 'furniture', finish: false },
  joinery: { hiddenBy: 'furniture', finish: true },
  worktop: { hiddenBy: 'furniture', finish: true },
  softFurnishing: { hiddenBy: 'furniture', finish: true },
  // The one bucket `finishing` removes instead of re-surfacing; see the note above.
  artwork: { hiddenBy: 'finishing', finish: false },
  // Millwork that is the building: the pass counter stays whatever the furniture does, and
  // is re-surfaced with the rest of the oak when the finish comes off.
  fabricJoinery: { hiddenBy: ALWAYS_DRAWN, finish: true },
  // The plain finish itself owns no box ({@link emptyLayout}), so its row can only be the
  // vacuous one: always drawn, never re-surfaced, and never actually rendered.
  plainSurface: { hiddenBy: ALWAYS_DRAWN, finish: false },
  // ── The services ────────────────────────────────────────────────────────────────────
  // Flat hues, read by colour and never by texture, so none of them is a finish.
  serviceDrainage: { hiddenBy: 'drainage', finish: false },
  serviceWaterCold: { hiddenBy: 'water', finish: false },
  serviceWaterHot: { hiddenBy: 'water', finish: false },
  serviceGas: { hiddenBy: 'gas', finish: false },
  serviceElectricity: { hiddenBy: 'electricity', finish: false },
  serviceLowVoltage: { hiddenBy: 'lowVoltage', finish: false },
  serviceClimateCool: { hiddenBy: 'climate', finish: false },
  serviceClimateHeat: { hiddenBy: 'climate', finish: false },
  serviceCover: { hiddenBy: 'covers', finish: false },
  // The sealed control-center compartments: the floor's own plant, not its contents.
  serviceChamber: { hiddenBy: ALWAYS_DRAWN, finish: false },
});

/**
 * Whether a bucket's meshes are drawn at all.
 *
 * @param materialKey - The bucket asked about.
 * @param shown - Which layers are currently ticked.
 * @returns `true` unless the bucket's own checkbox is unticked.
 */
export function isBucketShown(materialKey: FloorMaterialKey, shown: ShownLayers): boolean {
  const { hiddenBy } = BUCKET_RULES[materialKey];
  return hiddenBy === ALWAYS_DRAWN || shown[hiddenBy];
}

/**
 * Whether a bucket is drawn in the building's plain finish rather than its own.
 *
 * @param materialKey - The bucket asked about.
 * @param shown - Which layers are currently ticked.
 * @returns `true` when the bucket carries a finish and `finishing` is unticked.
 */
export function isBucketPlain(materialKey: FloorMaterialKey, shown: ShownLayers): boolean {
  return BUCKET_RULES[materialKey].finish && !shown.finishing;
}

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
    slabServiced: [],
    ceiling: [],
    lightPanel: [],
    railing: [],
    stairs: [],
    tvPanel: [],
    sanitaryWare: [],
    appliance: [],
    joinery: [],
    worktop: [],
    softFurnishing: [],
    artwork: [],
    // The parts of a fitting that are the building rather than its contents.
    fabricJoinery: [],
    // Always empty, and deliberately so: `plainSurface` is a MATERIAL the `finishing`
    // checkbox re-surfaces other buckets with, not a group of solids of its own
    // (`floorMaterials.ts`). It is listed because every palette key needs a bucket, and
    // an empty one is the honest answer for a key that owns no box.
    plainSurface: [],
    // The service layers of Part 5, one bucket per run, its boxing and the chambers.
    serviceDrainage: [],
    serviceWaterCold: [],
    serviceWaterHot: [],
    serviceGas: [],
    serviceElectricity: [],
    serviceLowVoltage: [],
    serviceClimateCool: [],
    serviceClimateHeat: [],
    serviceCover: [],
    serviceChamber: [],
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
 * Buckets one service run: its legs, its boxing and its stop-ends.
 *
 * Three destinations, and they are not the same one:
 *
 * - the **segments** and the **caps** go to the run's own family bucket. A cap is the
 *   plug on the end of a pipe, so it is that pipe — drawn in the gas yellow when it
 *   stops a gas riser and the drainage grey when it stops a stack — and putting the
 *   caps somewhere else would leave every stack on the floor ending in a bead of a
 *   colour that belongs to no service;
 * - the **cover** goes to `serviceCover`, whatever it covers. That is the whole point
 *   of it having its own checkbox: with the covers on and the runs off a viewer sees
 *   the finished room, and with both on they see what is inside the boxing
 *   (`SERVICE_LAYERS`, `covers`). Boxing drawn in the colour of what it hides would
 *   answer neither question.
 *
 * @param layout - The buckets being filled; mutated.
 * @param run - The built run to place. Not mutated; its boxes are pushed by reference.
 */
function bucketServiceRun(layout: MutableLayout, run: BuiltServiceRun): void {
  const familyKey = SERVICE_FAMILY_MATERIAL[run.family];
  for (const segment of run.segments) {
    layout[familyKey].push(segment.box);
  }
  for (const box of run.cover) {
    layout.serviceCover.push(box);
  }
  for (const box of run.caps) {
    layout[familyKey].push(box);
  }
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
 *   space it carries (`getSlabMaterialKey`) — or into `slabServiced` when the room is
 *   plumbed, powered or holds a riser, which is the one slab material a space *kind* cannot
 *   choose: the bathrooms, the cubicles, the kitchen, the laundry and the control center are
 *   every one of them ordinary `room` spaces, and only what stands in them tells them apart
 *   from a bedroom (`isServicedSpace`);
 * - the steps of the dog-leg into `stairs`;
 * - each railing into `railing`, as a box from the finished floor up to its handrail — a
 *   `Railing` carries a rect and a top rather than a box (`railings.ts`);
 * - the television panel into `tvPanel`;
 * - and every part of every fixture into the bucket its surface family names. A fixture is
 *   one to three boxes, so a furnished room costs no more draw calls than an empty one: the
 *   parts merge into the same geometry per material as everything else. A fitting that is
 *   the BUILDING rather than a room's contents is bucketed through
 *   {@link FABRIC_SURFACE_MATERIAL} instead, so that hiding the furniture clears a room
 *   without opening a hole in the floor;
 * - and every service run into the bucket its family names, its boxing into `serviceCover`
 *   and its stop-ends in with its own legs ({@link bucketServiceRun}). Eight families share
 *   the eight run buckets, because a services view is read by hue and a hue per family
 *   would be thirteen colours nobody can hold in their head.
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
 * @returns A frozen {@link FloorLayout} carrying every material key. Equal inputs always
 *   give an equal result, so a caller may build it once and memoise it.
 * @throws RangeError when a slab names a space the plan does not hold (`getSpace`), when a
 *   slab's space is a `void` and so has no slab material (`getSlabMaterialKey`), or when a
 *   railing height leaves no box to draw (`makeBox`).
 */
export function getFloorLayout(builtFloor: BuiltFloor, plan: FloorPlan = FLOOR_PLAN): FloorLayout {
  const layout = emptyLayout();
  for (const piece of builtFloor.walls) {
    layout[piece.kind === 'parapet' ? 'parapet' : 'wall'].push(piece);
  }
  for (const slab of builtFloor.slabs) {
    const space = getSpace(plan, slab.spaceId);
    // A room is carpeted unless something in it is plumbed, powered or a riser, in which
    // case it is marble. No space KIND can ask for either: a bathroom, a kitchen and a
    // bedroom are all `room`, and only what stands in them tells them apart. Circulation
    // and open air are still decided by kind, above this question, because a corridor is
    // boarded whatever happens to stand in it.
    const kindKey = getSlabMaterialKey(space.kind);
    const slabKey: FloorMaterialKey =
      kindKey === 'slabRoom' && isServicedSpace(builtFloor.fixtures, space.id)
        ? 'slabServiced'
        : kindKey;
    layout[slabKey].push(slab);
  }
  for (const fixture of builtFloor.fixtures) {
    // The building's own fabric, or a room's contents: one table or the other, chosen per
    // FIXTURE and applied to every part of it, so a fitting is never half hidden.
    const surfaceMaterial = FABRIC_FIXTURE_KINDS.includes(fixture.kind)
      ? FABRIC_SURFACE_MATERIAL
      : FIXTURE_SURFACE_MATERIAL;
    for (const part of fixture.parts) {
      layout[surfaceMaterial[part.surface]].push(part.box);
    }
  }
  for (const step of builtFloor.stairs.steps) {
    layout.stairs.push(step);
  }
  for (const railing of builtFloor.railings) {
    layout.railing.push(makeBox(railing.rect, FINISHED_FLOOR_LEVEL, railing.top));
  }
  layout.tvPanel.push(builtFloor.tvPanel);
  for (const run of builtFloor.services) {
    bucketServiceRun(layout, run);
  }
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
