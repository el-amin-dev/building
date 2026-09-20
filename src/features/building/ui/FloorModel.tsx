import { useLayerStore } from '../application/layerStore.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { BUILT_FLOOR } from './floorInstance.ts';
import {
  FLOOR_MATERIAL_KEYS,
  getCeilingLayout,
  getFloorLayout,
  isBucketPlain,
  isBucketShown,
} from './floorLayout.ts';
import type { CeilingLayout, FloorLayout } from './floorLayout.ts';
import { MATERIAL_PALETTE } from './floorMaterials.ts';
import {
  createBoucleTexture,
  createCarpetTexture,
  createMarbleTexture,
  createOakTexture,
} from './textures.ts';
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

/**
 * The families drawn with a generated texture, built once for the life of the page.
 *
 * Every family the scheme speaks to has one, since ADR-020 took the scheme whole-building: a
 * bouclé weave, an oak grain, a flat weave and a marble vein are what make a room read as
 * furnished rather than as coloured blocks. The families that carry no scheme — sanitary ware,
 * appliances, the artwork, the ceiling, the walls — stay flat colours, which is right: a matte
 * white wall is the one surface in the brief that is supposed to have nothing on it.
 *
 * **The floors take their own repeat.** The merged geometry gives every face the same 0…1 UV
 * square however wide the box really is, so one texture object cannot serve both a 0.60 m
 * wardrobe door and a 10 m corridor floor — at the furniture repeat the corridor's grain is
 * five metres from line to line, which reads as a smear. Each floor family therefore builds its
 * own instance at a floor-scale repeat rather than sharing the furniture's; they are four more
 * 256 px canvases, which is nothing, and the alternative is a floor that looks wrong.
 *
 * Built at module level for the same reason the layouts are: a texture is an upload to the GPU,
 * and rebuilding one per render would upload it again. Each generator returns `undefined` where
 * there is no canvas to draw on — jsdom, so the whole unit suite — and a material with
 * `map={undefined}` is simply the flat colour it was before.
 */
const CARPET_FLOOR_REPEAT = 16;
const OAK_FLOOR_REPEAT = 12;
const MARBLE_FLOOR_REPEAT = 3;

const FAMILY_TEXTURE: Partial<Record<FloorMaterialKey, ReturnType<typeof createOakTexture>>> =
  Object.freeze({
    slabRoom: createCarpetTexture(CARPET_FLOOR_REPEAT),
    slabCirculation: createOakTexture(OAK_FLOOR_REPEAT),
    slabServiced: createMarbleTexture(MARBLE_FLOOR_REPEAT),
    stairs: createOakTexture(),
    joinery: createOakTexture(),
    // The pass counter is the same oak as the wardrobes and must keep the same grain: it
    // is bucketed apart from them so the `furniture` checkbox cannot take a hole in the
    // kitchen wall away with the furniture (`floorLayout.ts`), not because it looks
    // different. A missing entry here would be the split leaking into the surface.
    fabricJoinery: createOakTexture(),
    worktop: createMarbleTexture(),
    softFurnishing: createBoucleTexture(),
  });

/** The ceilings and light panels, built once for the same reason. */

const CEILING_LAYOUT = getCeilingLayout();

/**
 * Everything drawn in both views.
 *
 * This used to merge two layouts, because the fixtures were derived from the spec here in
 * the UI rather than being part of a `BuiltFloor`. Since Part 4 they are on the built floor
 * like the walls, so there is one layout again and the merge is gone. What the merge existed
 * to protect is unchanged and still matters: one mesh per material over one object, with
 * every bucket keeping its identity for the life of the page, which is what
 * `MergedBoxesMesh` needs to avoid rebuilding a geometry it already holds.
 */
const ALWAYS_DRAWN_LAYOUT: FloorLayout = FLOOR_LAYOUT;

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

/** The bucket that is not a family of solids but the state `finishing` puts others into. */
const PLAIN_MATERIAL_KEY: FloorMaterialKey = 'plainSurface';

/** Props of {@link MaterialMesh}. */
interface MaterialMeshProps {
  /** Which surface family is drawn: it picks the material out of the palette. */
  readonly materialKey: FloorMaterialKey;
  /** The boxes of that family. Must keep its identity across renders. */
  readonly boxes: readonly PlanBox[];
  /** The storey levels to draw them at. Must keep its identity across renders. */
  readonly levels: readonly number[];
  /**
   * Whether the family is on screen. Passed down as a flag and never used to decide
   * whether to render the component: unmounting it would dispose the merged geometry, so a
   * checkbox flipped twice would re-merge and re-upload the whole bucket
   * (`MergedBoxesMesh.tsx`).
   */
  readonly visible: boolean;
  /**
   * Whether it is drawn in the plain finish instead of its own: the same geometry, the
   * `plainSurface` spec, and no texture looked up for it.
   */
  readonly plain: boolean;
}

/**
 * One merged mesh per storey for one surface family, with its palette material.
 *
 * The material props come straight from {@link MATERIAL_PALETTE}, whose specs are exactly the
 * `meshStandardMaterial` settings of the family — colour, roughness, metalness, dithering,
 * and the emission of the light panels — so no colour is written into the scene layer. With
 * `plain` set it is the `plainSurface` spec instead, and {@link FAMILY_TEXTURE} is not
 * consulted at all: the grain is part of the finish, not of the geometry under it.
 *
 * The material carries the bucket's key as its `name`, which is what a debugger — and the
 * test suite — reads to say which checkbox a given mesh answers to. It has to be the key and
 * not the settings, because two buckets may share a finish on purpose (`fabricJoinery` is the
 * same oak as `joinery`) and because a re-surfaced bucket wears a spec that is not its own.
 *
 * @param props - {@link MaterialMeshProps}
 * @returns One mesh per level, drawn or hidden, or `null` when the family has no box at all.
 */
function MaterialMesh({ materialKey, boxes, levels, visible, plain }: MaterialMeshProps) {
  if (boxes.length === NO_BOXES) {
    return null;
  }
  return (
    <MergedBoxesMesh boxes={boxes} levels={levels} visible={visible}>
      <meshStandardMaterial
        name={materialKey}
        {...MATERIAL_PALETTE[plain ? PLAIN_MATERIAL_KEY : materialKey]}
        map={plain ? undefined : FAMILY_TEXTURE[materialKey]}
      />
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
 * **The checkboxes of Part 5 are applied here, and only through `BUCKET_RULES`.** Which
 * layers are ticked is read from `layerStore.ts` with one selector subscription to the whole
 * `shown` record — the shape `BuildingScene`'s `SceneContent` already uses for the storey
 * count, and one subscription rather than nine because the store replaces that record whole
 * and compares it by identity. The count stays a prop because it is the subject of what this
 * component draws and a test has to be able to hand it one; the layer record is not: it is
 * consumed entirely by the table above, which lives here.
 *
 * Nothing is unmounted by a checkbox. A hidden bucket is a mesh with `visible={false}`, so
 * its baked geometry survives the tick — see `MergedBoxesMesh.tsx` for what unmounting it
 * would cost with nine checkboxes being flipped. The one thing that is still mounted
 * conditionally is the pair of ceiling buckets, and that is the VIEW and not a layer: outside
 * the building there is genuinely no ceiling to hold.
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
  const shown = useLayerStore((state) => state.shown);
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
          visible={isBucketShown(materialKey, shown)}
          plain={isBucketPlain(materialKey, shown)}
        />
      ))}
      {showCeilings &&
        CEILING_MATERIAL_KEYS.map((materialKey) => (
          <MaterialMesh
            key={materialKey}
            materialKey={materialKey}
            boxes={CEILING_LAYOUT[materialKey]}
            levels={materialKey === TOP_STOREY_ONLY_KEY ? topStoreyLevel : storeyLevels}
            visible={isBucketShown(materialKey, shown)}
            plain={isBucketPlain(materialKey, shown)}
          />
        ))}
    </>
  );
}
