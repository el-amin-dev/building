import type { PlanBox } from '../domain/planBox.ts';
import { BUILT_FLOOR } from './floorInstance.ts';
import {
  FLOOR_MATERIAL_KEYS,
  getCeilingLayout,
  getFixtureLayout,
  getFloorLayout,
} from './floorLayout.ts';
import type { CeilingLayout, FloorLayout } from './floorLayout.ts';
import { MATERIAL_PALETTE } from './floorMaterials.ts';
import type { FloorMaterialKey } from './floorMaterials.ts';
import { MergedBoxesMesh } from './MergedBoxesMesh.tsx';
import { getStoreyLevelsFor, getTopStoreyLevelFor } from './storeyLevels.ts';

/**
 * The solids of the floor, grouped by material, built once when this module is loaded.
 *
 * Built at module level on purpose. `MergedBoxesMesh` bakes its boxes into one geometry and
 * rebuilds it whenever the array it is given changes identity, so a layout rebuilt per
 * render — or per frame — would re-merge every wall, slab and step and re-upload the buffers
 * to the GPU each time. A module-level constant gives every bucket one identity for the whole
 * life of the page, which no `useMemo` dependency can accidentally invalidate. The floor is
 * pure data of the plan and the heights, so there is nothing a render could change about it.
 *
 * The floor itself is not derived here either: {@link BUILT_FLOOR} is the page's one
 * derivation of it (`floorInstance.ts`), shared by identity with the collision field and the
 * explorer's start pose. Calling `getBuiltFloor()` again here would bake the floor twice.
 */
const FLOOR_LAYOUT = getFloorLayout(BUILT_FLOOR);

/** The ceilings and light panels, built once for the same reason. */
const CEILING_LAYOUT = getCeilingLayout();

/**
 * Everything drawn in both views, in one object: the built floor plus the sanitary ware.
 *
 * The fixtures come from the spec rather than from a `BuiltFloor` (`floorLayout.ts`), so
 * they arrive as a second layout and are folded into the first here. Merging once, at module
 * level, is what keeps the rule of this component intact: one mesh per material, over one
 * object, whatever bucket a solid happened to be derived by. Every bucket keeps its identity
 * for the life of the page, which is what `MergedBoxesMesh` needs.
 */
const ALWAYS_DRAWN_LAYOUT: FloorLayout = Object.freeze({
  ...FLOOR_LAYOUT,
  ...getFixtureLayout(),
});

/** The two material families that exist only while the interior is shown. */
const CEILING_MATERIAL_KEYS: readonly (keyof CeilingLayout)[] = Object.freeze([
  'ceiling',
  'lightPanel',
] as const);

/**
 * The one family drawn at the top storey alone rather than at every storey.
 *
 * A ceiling is the underside of the slab above, which belongs to the next storey
 * (`floorLayout.ts`). Under every storey but the last, that next storey now genuinely
 * exists and its slab is already drawn there, so a ceiling box would be the same solid a
 * second time, coincident on all six faces — and two coincident faces z-fight. The
 * building is therefore given one ceiling, over its top storey, where there is no slab
 * above to be the underside of.
 *
 * **Accepted consequence:** below the top storey the overhead surface a viewer sees is the
 * screed of the slab above — the slab material of the room up there — rather than ceiling
 * white. That is one material off in the rooms of a stacked building, against a z-fighting
 * shimmer over every room of every storey but one; the shimmer is the worse of the two, and
 * a proper soffit finish belongs with the slab, not with a duplicate box drawn over it.
 *
 * The light panels are *not* on this list: a luminaire is nobody else's slab, and the panel
 * hangs just under the wall head, clear of the slab band above it, so every storey keeps
 * its rooms lit.
 */
const TOP_STOREY_ONLY_KEY: keyof CeilingLayout = 'ceiling';

/** An empty bucket: nothing of that material is on the floor, so no mesh is rendered. */
const NO_BOXES = 0;

/** Props of {@link MaterialMesh}. */
interface MaterialMeshProps {
  /** Which surface family is drawn: it picks the material out of the palette. */
  readonly materialKey: FloorMaterialKey;
  /** The boxes of that family. Must keep its identity across renders. */
  readonly boxes: readonly PlanBox[];
  /** The storey levels to draw them at. Must keep its identity across renders. */
  readonly levels: readonly number[];
}

/**
 * One merged mesh per storey for one surface family, with its palette material.
 *
 * The material props come straight from {@link MATERIAL_PALETTE}, whose specs are exactly the
 * `meshStandardMaterial` settings of the family — colour, roughness, metalness, dithering,
 * and the emission of the light panels — so no colour is written into the scene layer.
 *
 * @param props - {@link MaterialMeshProps}
 * @returns One mesh per level, or `null` when the family has no box to draw.
 */
function MaterialMesh({ materialKey, boxes, levels }: MaterialMeshProps) {
  if (boxes.length === NO_BOXES) {
    return null;
  }
  return (
    <MergedBoxesMesh boxes={boxes} levels={levels}>
      <meshStandardMaterial {...MATERIAL_PALETTE[materialKey]} />
    </MergedBoxesMesh>
  );
}

/** Props of {@link FloorModel}. */
export interface FloorModelProps {
  /**
   * Whether the ceilings and their light panels are drawn: they are, inside the building, and
   * are left off in the exterior view so the floor can be seen from above.
   */
  readonly showCeilings: boolean;
  /**
   * How many identical storeys are stacked, 1…10 (`domain/storeys.ts`). A prop rather than
   * a store read, so this component stays a pure function of what it is handed: the one
   * subscription to the count inside the canvas lives in `BuildingScene`'s `SceneContent`.
   */
  readonly floorCount: number;
}

/**
 * The whole building, drawn as one merged mesh per material per storey.
 *
 * Everything the floor is made of is drawn: the walls and the parapets, the slab of every
 * space, the steps of the dog-leg, the railings, the television panel and the sanitary ware
 * of the bathrooms — and, inside, a ceiling and a light panel per roofed space. The
 * sanitary ware is drawn in both views on purpose: a ceiling has to go so that the floor can
 * be seen from above, and a bath is one of the things worth seeing once it has. The
 * grouping is `floorLayout.ts`'s and the
 * geometry `mergeBoxes.ts`'s, so this component only decides what is on screen: one
 * `MergedBoxesMesh` per non-empty bucket, in palette order.
 *
 * `floorCount` stacks that floor. One typical floor is designed and the building is it
 * repeated upwards (`domain/storeys.ts`), so every bucket is handed the whole list of
 * storey levels and draws its one baked geometry once per level — no bucket is rebuilt, and
 * no box is re-merged, when the count changes: only *which* shared level array is passed
 * down (`storeyLevels.ts`). The single exception is {@link TOP_STOREY_ONLY_KEY}, drawn at
 * the top storey alone for the reason given there.
 *
 * It adds nothing else to the scene. There is no light here — the three lights of the scene
 * live in `SceneLighting`, and a room's own light is the emissive panel of its ceiling, not a
 * point light — no camera work, and no component per space: a floor of this many boxes is
 * drawn in a handful of draw calls, not one per room.
 *
 * @param props - {@link FloorModelProps}
 * @returns The meshes of every storey, and of the top storey's ceilings when they are shown.
 */
export function FloorModel({ showCeilings, floorCount }: FloorModelProps) {
  const storeyLevels = getStoreyLevelsFor(floorCount);
  const topStoreyLevel = getTopStoreyLevelFor(floorCount);

  return (
    <>
      {FLOOR_MATERIAL_KEYS.map((materialKey) => (
        <MaterialMesh
          key={materialKey}
          materialKey={materialKey}
          boxes={ALWAYS_DRAWN_LAYOUT[materialKey]}
          levels={storeyLevels}
        />
      ))}
      {showCeilings &&
        CEILING_MATERIAL_KEYS.map((materialKey) => (
          <MaterialMesh
            key={materialKey}
            materialKey={materialKey}
            boxes={CEILING_LAYOUT[materialKey]}
            levels={materialKey === TOP_STOREY_ONLY_KEY ? topStoreyLevel : storeyLevels}
          />
        ))}
    </>
  );
}
