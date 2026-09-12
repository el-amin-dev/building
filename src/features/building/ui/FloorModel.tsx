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

/** An empty bucket: nothing of that material is on the floor, so no mesh is rendered. */
const NO_BOXES = 0;

/** Props of {@link MaterialMesh}. */
interface MaterialMeshProps {
  /** Which surface family is drawn: it picks the material out of the palette. */
  readonly materialKey: FloorMaterialKey;
  /** The boxes of that family. Must keep its identity across renders. */
  readonly boxes: readonly PlanBox[];
}

/**
 * One merged mesh for one surface family, with its palette material.
 *
 * The material props come straight from {@link MATERIAL_PALETTE}, whose specs are exactly the
 * `meshStandardMaterial` settings of the family — colour, roughness, metalness, dithering,
 * and the emission of the light panels — so no colour is written into the scene layer.
 *
 * @param props - {@link MaterialMeshProps}
 * @returns The mesh, or `null` when the family has no box to draw.
 */
function MaterialMesh({ materialKey, boxes }: MaterialMeshProps) {
  if (boxes.length === NO_BOXES) {
    return null;
  }
  return (
    <MergedBoxesMesh boxes={boxes}>
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
}

/**
 * The whole built floor, drawn as one merged mesh per material.
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
 * It adds nothing else to the scene. There is no light here — the three lights of the scene
 * live in `SceneLighting`, and a room's own light is the emissive panel of its ceiling, not a
 * point light — no camera work, and no component per space: a floor of this many boxes is
 * drawn in a handful of draw calls, not one per room.
 *
 * @param props - {@link FloorModelProps}
 * @returns The meshes of the floor, and of the ceilings when they are shown.
 */
export function FloorModel({ showCeilings }: FloorModelProps) {
  return (
    <>
      {FLOOR_MATERIAL_KEYS.map((materialKey) => (
        <MaterialMesh
          key={materialKey}
          materialKey={materialKey}
          boxes={ALWAYS_DRAWN_LAYOUT[materialKey]}
        />
      ))}
      {showCeilings &&
        CEILING_MATERIAL_KEYS.map((materialKey) => (
          <MaterialMesh
            key={materialKey}
            materialKey={materialKey}
            boxes={CEILING_LAYOUT[materialKey]}
          />
        ))}
    </>
  );
}
