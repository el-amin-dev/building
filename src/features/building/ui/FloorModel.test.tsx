import { act, render } from '@testing-library/react';
import { isValidElement } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStore } from '../application/layerStore.ts';
import { getBuiltFloor } from '../domain/builtFloor.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { SERVICE_LAYERS } from '../domain/sourceOfTruth/plan.ts';
import type { PlanServiceLayerKey } from '../domain/sourceOfTruth/plan.ts';
import { MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { FloorModel } from './FloorModel.tsx';
import {
  BUCKET_RULES,
  FLOOR_MATERIAL_KEYS,
  getCeilingLayout,
  getFloorLayout,
} from './floorLayout.ts';
import type { FloorLayout } from './floorLayout.ts';
import { MATERIAL_PALETTE } from './floorMaterials.ts';
import type { FloorMaterialKey, FloorMaterialSpec } from './floorMaterials.ts';
import { createMergedBoxGeometry } from './mergeBoxes.ts';
import type { MergedBoxesMeshProps } from './MergedBoxesMesh.tsx';
import { getStoreyLevelsFor, getTopStoreyLevelFor } from './storeyLevels.ts';

/** One recorded `MergedBoxesMesh`: what it was asked to draw, and where. */
interface RecordedMesh {
  /** The array handed to the mesh; its identity is what the anti-thrash test watches. */
  readonly boxes: readonly PlanBox[];
  /** The storey levels handed to it: one mesh is drawn at each. */
  readonly levels: readonly number[];
  /**
   * Whether the model asked for the bucket to be drawn.
   *
   * Recorded rather than read back off the DOM because it cannot be read back off the DOM:
   * React drops a boolean prop on an unrecognised tag instead of stringifying it
   * (`MergedBoxesMesh.test.tsx`). This is where the checkbox behaviour is decided, so this
   * is where it is asserted.
   */
  readonly visible: boolean | undefined;
  /** The material element the model nested in the mesh. */
  readonly material: ReactNode;
}

const { meshes, textures } = vi.hoisted(() => ({
  meshes: [] as unknown[],
  // One stub per generator. Under jsdom the real ones return `undefined` for want of a
  // canvas, which makes "does this bucket carry a grain" unanswerable — and that is exactly
  // the question the `finishing` checkbox turns on. With a stub, a `map` prop is an object
  // that can be identified, so stripping the finish becomes observable instead of vacuous.
  textures: {
    oak: { token: 'oak-grain' },
    carpet: { token: 'carpet-weave' },
    marble: { token: 'marble-vein' },
    boucle: { token: 'boucle-loop' },
  },
}));

// jsdom has no WebGL and the merge itself is covered by `mergeBoxes.test.ts`, so the baked
// geometry is a stub. It is spied on rather than skipped because "a stepper press rebuilds no
// geometry" is a claim about this very function being called — the same reasoning as the
// `@react-three/fiber` mock in `BuildingScene.test.tsx`.
vi.mock('./mergeBoxes.ts', () => ({
  createMergedBoxGeometry: vi.fn(() => ({ dispose: vi.fn() })),
}));

// The mesh is wrapped, not replaced: the probe records the props the model handed down and
// then renders the real component, so the level arrays and the box arrays can be read while
// the real memoisation — the thing the storey count must not invalidate — still runs.
vi.mock('./MergedBoxesMesh.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./MergedBoxesMesh.tsx')>();
  return {
    MergedBoxesMesh: (props: MergedBoxesMeshProps) => {
      meshes.push({
        boxes: props.boxes,
        levels: props.levels,
        visible: props.visible,
        material: props.children,
      });
      return <actual.MergedBoxesMesh {...props} />;
    },
  };
});

// The generated textures are covered by `textures.ts`'s own suite; here they are stubbed so
// that the presence of a grain on a bucket is something an assertion can see.
vi.mock('./textures.ts', () => ({
  createOakTexture: () => textures.oak,
  createCarpetTexture: () => textures.carpet,
  createMarbleTexture: () => textures.marble,
  createBoucleTexture: () => textures.boucle,
}));

const createGeometry = vi.mocked(createMergedBoxGeometry);

const MATERIAL_ELEMENT = 'meshStandardMaterial';

/**
 * The grain each bucket is expected to carry, written out rather than imported.
 *
 * `FloorModel`'s own `FAMILY_TEXTURE` is module-private and is the thing under test, so this
 * is the second opinion: a family that lost its texture, or gained one it should not have,
 * has to be moved here too. `fabricJoinery` is on it deliberately — the pass counter is the
 * same oak as the wardrobes and must keep the same grain; the split between them is about
 * which checkbox owns the box, never about how it looks.
 */
const FAMILY_TEXTURE_TOKEN: Partial<Record<FloorMaterialKey, unknown>> = Object.freeze({
  slabRoom: textures.carpet,
  slabCirculation: textures.oak,
  slabServiced: textures.marble,
  stairs: textures.oak,
  joinery: textures.oak,
  fabricJoinery: textures.oak,
  worktop: textures.marble,
  softFurnishing: textures.boucle,
});

/**
 * Everything drawn in both views, bucketed the way `FloorModel` buckets it.
 *
 * This used to merge two layouts, because the fixtures were derived in the UI rather than
 * being part of a `BuiltFloor`, and deriving the expectation from `getFloorLayout` alone left
 * the bathroom ware out of every count while the model went on drawing it. Since Part 4 the
 * fixtures are on the built floor, so one call gives the whole answer — and the old trap is
 * gone rather than worked around.
 */
const ALWAYS_DRAWN_LAYOUT: FloorLayout = getFloorLayout(getBuiltFloor());

/** The families always drawn: every bucket of that layout which holds a box. */
const ALWAYS_DRAWN_KEYS: readonly FloorMaterialKey[] = FLOOR_MATERIAL_KEYS.filter(
  (key) => ALWAYS_DRAWN_LAYOUT[key].length > 0,
);
/** The families drawn only inside: the ceilings and their light panels. */
const CEILING_KEYS: readonly FloorMaterialKey[] = ['ceiling', 'lightPanel'];

/**
 * Walls, parapets, four kinds of slab (room, circulation, open air and serviced), railings,
 * steps, the television panel and the sanitary ware; the five families a room's contents are
 * drawn with (joinery, worktops, appliances, soft furnishings and the hung canvas); and since
 * Part 5 the millwork that is the building rather than its contents, plus the ten service
 * buckets — eight run hues, the boxing, and the two sealed chambers.
 *
 * **This number does not move when a checkbox does**, and that is the whole point of Part 5.
 * Twenty-six meshes per storey with every layer ticked, and twenty-six with none of them
 * ticked: a hidden bucket is a mesh with `visible={false}`, never an absent one, because
 * unmounting it would dispose the merged geometry and the next tick would re-merge and
 * re-upload every box of it. A mesh is per **material** and not per object, so the boxes of
 * every wardrobe on the storey are still one merged geometry (ADR-014).
 */
const ALWAYS_DRAWN_COUNT = 26;

/** Buckets the palette names that hold no box at all: the two ceiling ones and the finish. */
const EMPTY_KEYS: readonly FloorMaterialKey[] = ['ceiling', 'lightPanel', 'plainSurface'];

const ONCE = 1;
const NONE = 0;
/** The building as it was drawn before it could be stacked: the designed floor, alone. */
const ONE_STOREY_COUNT = MIN_FLOOR_COUNT;
/**
 * The stack the stacking tests use: three storeys, the smallest building in which "every
 * storey" and "the top storey" are different answers.
 */
const THREE_STOREY_COUNT = 3;
/** Meshes one non-empty bucket draws for that building: one per storey. */
const THREE_MESHES = THREE_STOREY_COUNT;
/** Levels the ceilings are drawn at, whatever the count: the top storey's, and no other. */
const ONE_CEILING_LEVEL = 1;
/** Index of the last entry of an array, for `Array.prototype.at`. */
const LAST_INDEX = -1;

/**
 * Returns what the probe recorded, typed.
 *
 * @returns The meshes rendered since the last reset, in render order.
 */
function recorded(): readonly RecordedMesh[] {
  return meshes as readonly RecordedMesh[];
}

/** The `<mesh>` elements actually rendered, across every bucket. */
function renderedMeshes(container: HTMLElement): readonly Element[] {
  return [...container.querySelectorAll('mesh')];
}

/** The levels those meshes sit at, read back off their `position-y`, in render order. */
function renderedLevels(container: HTMLElement): readonly string[] {
  return renderedMeshes(container).map((mesh) => mesh.getAttribute('position-y') ?? '');
}

/**
 * Reads the props of the material element of a mesh.
 *
 * @param mesh - The recorded mesh.
 * @returns The props of its `<meshStandardMaterial>`.
 * @throws Error when the mesh holds no material element.
 */
function materialPropsOf(mesh: RecordedMesh): Record<string, unknown> {
  const element = mesh.material;
  if (!isValidElement(element) || element.type !== MATERIAL_ELEMENT) {
    throw new Error(`A mesh was rendered without a <${MATERIAL_ELEMENT}>`);
  }
  return element.props as Record<string, unknown>;
}

/**
 * Names the BUCKET a recorded mesh draws.
 *
 * Read off the material's `name`, which the model stamps with the bucket's own key. It used
 * to be looked up by colour, roughness and metalness instead, and Part 5 killed that twice
 * over: `fabricJoinery` is `joinery`'s oak down to the last setting, so the lookup would
 * hand back whichever came first in the palette; and a bucket with the finish off wears the
 * `plainSurface` spec, so every re-surfaced mesh would come back named `plainSurface` and
 * every per-bucket assertion here would silently check the wrong thing. A bucket has to be
 * identifiable independently of what it is currently painted with — that is the whole
 * subject of `BUCKET_RULES`.
 *
 * @param mesh - The recorded mesh.
 * @returns The palette key its material is named after.
 * @throws Error when the material carries no name, or a name that is no palette key.
 */
function materialKeyOf(mesh: RecordedMesh): FloorMaterialKey {
  const { name } = materialPropsOf(mesh);
  const key = FLOOR_MATERIAL_KEYS.find((candidate) => candidate === name);
  if (key === undefined) {
    throw new Error(`A mesh's material was named ${String(name)}, which is no palette key`);
  }
  return key;
}

/**
 * Returns the grain a recorded mesh was handed, if any.
 *
 * @param mesh - The recorded mesh.
 * @returns The stub its `map` carries, or `undefined` when it was given no texture.
 */
function textureOf(mesh: RecordedMesh): unknown {
  return materialPropsOf(mesh).map;
}

/** The buckets drawn hidden, in render order: the ones a checkbox is currently suppressing. */
function hiddenKeys(): readonly FloorMaterialKey[] {
  return recorded()
    .filter((mesh) => mesh.visible === false)
    .map((mesh) => materialKeyOf(mesh));
}

/**
 * The surface of a spec, as the one string that tells two finishes apart.
 *
 * @param spec - A palette spec, or the material props a mesh was handed.
 * @returns Its colour, roughness and metalness, joined.
 */
function finishOf(spec: Record<string, unknown> | FloorMaterialSpec): string {
  const { color, roughness, metalness } = spec as Record<string, unknown>;
  return `${String(color)}/${String(roughness)}/${String(metalness)}`;
}

/** The buckets currently wearing the plain finish rather than their own. */
function plainKeys(): readonly FloorMaterialKey[] {
  const plain = finishOf(MATERIAL_PALETTE.plainSurface);
  return recorded()
    .filter((mesh) => finishOf(materialPropsOf(mesh)) === plain)
    .map((mesh) => materialKeyOf(mesh));
}

/** Every layer key the plan declares, which is every checkbox the panel offers. */
const LAYER_KEYS: readonly PlanServiceLayerKey[] = SERVICE_LAYERS.map((layer) => layer.key);

/**
 * The buckets a given checkbox owns, read off the exported table.
 *
 * @param layer - The checkbox asked about.
 * @returns Every palette key whose `hiddenBy` is that layer, in palette order.
 */
function bucketsOwnedBy(layer: PlanServiceLayerKey): readonly FloorMaterialKey[] {
  return FLOOR_MATERIAL_KEYS.filter((key) => BUCKET_RULES[key].hiddenBy === layer);
}

/** Sets every checkbox at once, the way the panel's show-all and hide-all do. */
function setEveryLayer(shown: boolean): void {
  const store = useLayerStore.getState();
  if (shown) {
    store.showAllLayers();
  } else {
    store.hideAllLayers();
  }
}

/** The families drawn, in render order. */
function drawnKeys(): readonly FloorMaterialKey[] {
  return recorded().map((mesh) => materialKeyOf(mesh));
}

/**
 * Returns the boxes each family was drawn with.
 *
 * @returns A map from palette key to the array the probe received for it.
 */
function boxesByKey(): ReadonlyMap<FloorMaterialKey, readonly PlanBox[]> {
  return new Map(recorded().map((mesh) => [materialKeyOf(mesh), mesh.boxes]));
}

/**
 * Reads one family's boxes out of a recording.
 *
 * @param boxes - The recording to read.
 * @param key - The family wanted.
 * @returns The array that family was drawn with.
 * @throws Error when the family was not drawn.
 */
function boxesOf(
  boxes: ReadonlyMap<FloorMaterialKey, readonly PlanBox[]>,
  key: FloorMaterialKey,
): readonly PlanBox[] {
  const found = boxes.get(key);
  if (found === undefined) {
    throw new Error(`No mesh was rendered for ${key}`);
  }
  return found;
}

describe('FloorModel', () => {
  beforeEach(() => {
    meshes.length = NONE;
    createGeometry.mockClear();
    // The store is global and its default is the naked building, so every case starts from
    // it and a case that ticks a box cannot leak into the next one.
    setEveryLayer(false);
  });

  it('draws one mesh per non-empty bucket, in palette order', () => {
    render(<FloorModel showCeilings={false} floorCount={ONE_STOREY_COUNT} />);

    expect(ALWAYS_DRAWN_KEYS).toHaveLength(ALWAYS_DRAWN_COUNT);
    expect(drawnKeys()).toStrictEqual([...ALWAYS_DRAWN_KEYS]);
  });

  it('renders no mesh for an empty bucket, and leaves no drawn bucket empty', () => {
    render(<FloorModel showCeilings={false} floorCount={ONE_STOREY_COUNT} />);

    // An empty bucket is the vacuous case here: a mesh drawn over an empty array would
    // still be recorded, and every per-bucket assertion below would pass over nothing.
    for (const mesh of recorded()) {
      expect(mesh.boxes.length, materialKeyOf(mesh)).toBeGreaterThan(NONE);
    }
    // ...and the buckets left empty are exactly the two the exterior view drops and the
    // plain finish, which is a material rather than a group of solids and owns no box by
    // design. A family that silently stopped producing solids cannot hide among them.
    const empty = FLOOR_MATERIAL_KEYS.filter((key) => ALWAYS_DRAWN_LAYOUT[key].length === NONE);
    expect(empty).toStrictEqual([...EMPTY_KEYS]);
    for (const key of EMPTY_KEYS) {
      expect(drawnKeys(), key).not.toContain(key);
    }
  });

  it('draws every solid of the families it is given', () => {
    /**
     * The plumbed-in ware: four sinks — the two sanitairs', the kitchen's and the
     * laundry's — two baths, one shower tray and the WC, which is two boxes because a pan
     * and its cistern are not one shape. The laundry's hand-wash sink is in that count:
     * brief §7.1 asks for it, and it is why the laundry is tiled.
     *
     * One tray and no longer two: the guest shower is gone, which is what brief §7.3's own
     * table asked for all along — "Guest Sanitair | Sink (open) + Bath — NO shower" — so the
     * only tray left on the floor is the main suite's.
     */
    const sanitaryWareCount = 9;
    /**
     * The made-of-board family: bed bases and wardrobes, nightstands and storage units, the
     * desks' pedestals and the coffee tables' bases, the library's plinth and its shelving,
     * the kitchen's two counter carcasses, the services cabinet, and the plinth, door band
     * and masonry base the white goods are drawn standing on.
     *
     * Five boxes LEFT this count in Part 5 and are now {@link fabricJoineryCount}: the
     * guest room's pass counter — carcass, two cheeks, the lintel over the bore and its
     * ledge — which is the building and not the room's contents, and must not go when the
     * furniture does. The sofas contribute none: a seat and a back are both upholstery.
     */
    const joineryCount = 27;
    /** Mattresses, and the seat and the back of each of the four sofas. */
    const softFurnishingCount = 13;
    /**
     * Counter and desk tops, the cooker's hob, and two coffee tables — the living room's,
     * and the one the guest room gained when it became a sitting room. The pass counter's
     * ledge is no longer here: it is a worktop by shape and the building by function, so
     * it went to the fabric bucket with the rest of the counter.
     */
    const worktopCount = 8;
    /** The white goods: fridge, cooker body, washing machine, barbecue bed. */
    const applianceCount = 5;
    /**
     * The building's own millwork: the food-pass counter's carcass, its two cheeks, the
     * lintel over the bore and the ledge. Five boxes that the `furniture` checkbox may not
     * touch — hiding them would not clear a room, it would open a 0.30 m slot from the
     * guest room into the kitchen (ADR-021).
     */
    const fabricJoineryCount = 5;
    /**
     * One ceiling box per clear rect of every roofed space, and the stairwell is not one:
     * the fifteen roofed spaces plus the stairwell are drawn as nineteen rects between
     * them, and the stairwell's one is left open for the dog-leg to rise through.
     *
     * "Roofed" is the set `floorLayout.test.ts` lists as `ROOFED_SPACE_IDS` — every room
     * and circulation space except the stairs — so the word names the same fifteen spaces
     * in both files, and the stairwell is counted in beside them rather than among them.
     */
    const ceilingBoxCount = 18;
    /** One light panel per roofed space; the stairwell is roofed by none. */
    const lightPanelCount = 15;
    const ceilings = getCeilingLayout();

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    const drawn = boxesByKey();
    expect(boxesOf(drawn, 'sanitaryWare')).toHaveLength(sanitaryWareCount);
    // The furniture families, so a fixture that stopped being drawn would be noticed here
    // rather than only in a screenshot: 41 fixtures, 68 boxes between them.
    expect(boxesOf(drawn, 'joinery')).toHaveLength(joineryCount);
    expect(boxesOf(drawn, 'softFurnishing')).toHaveLength(softFurnishingCount);
    expect(boxesOf(drawn, 'worktop')).toHaveLength(worktopCount);
    expect(boxesOf(drawn, 'appliance')).toHaveLength(applianceCount);
    // There is no separate scheme bucket any more: since ADR-020 the living room's library
    // is `joinery` and its sofas are `softFurnishing`, like every other room's, which is
    // exactly what taking the scheme whole-building means. The counts above absorbed them.
    expect(boxesOf(drawn, 'artwork')).toHaveLength(1);
    expect(boxesOf(drawn, 'fabricJoinery')).toHaveLength(fabricJoineryCount);
    expect(boxesOf(drawn, 'ceiling')).toHaveLength(ceilingBoxCount);
    expect(boxesOf(drawn, 'lightPanel')).toHaveLength(lightPanelCount);
    expect(ceilings.lightPanel.length).toBeLessThan(ceilings.ceiling.length);
  });

  it('gives every mesh the boxes of its own bucket', () => {
    render(<FloorModel showCeilings={false} floorCount={ONE_STOREY_COUNT} />);

    const drawn = boxesByKey();
    for (const key of ALWAYS_DRAWN_KEYS) {
      expect(boxesOf(drawn, key), key).toStrictEqual([...ALWAYS_DRAWN_LAYOUT[key]]);
    }
  });

  it('gives every mesh the palette material of its key', () => {
    // Every checkbox ticked, because that is the one state in which EVERY bucket is both
    // drawn and wearing its OWN finish — which is what this test is about. (It is not the
    // v1.0.0 view: that is `furniture` + `finishing` with every service off, and all-on is
    // v1.0.0 plus the runs drawn over it — `SERVICE_LAYERS`.) With `finishing` unticked the
    // finish-bearing buckets deliberately wear another one, and that is a separate case.
    setEveryLayer(true);

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    for (const mesh of recorded()) {
      const key = materialKeyOf(mesh);
      // `map` is passed for every family and is the family's own grain only where one
      // exists. What this test is for is that no colour or roughness is invented in the
      // scene layer, and that every bucket the scheme reaches really is handed its texture.
      const { map, name, ...props } = materialPropsOf(mesh);
      expect(map, key).toBe(FAMILY_TEXTURE_TOKEN[key]);
      // The material is named after its bucket, which is how a mesh is attributed to a
      // checkbox both here and in a debugger.
      expect(name, key).toBe(key);
      expect(props, key).toStrictEqual({ ...MATERIAL_PALETTE[key] });
    }
  });

  it('adds the ceiling and light-panel meshes, and only those, when the ceilings are shown', () => {
    render(<FloorModel showCeilings={false} floorCount={ONE_STOREY_COUNT} />);
    const withoutCeilings = boxesByKey();
    meshes.length = NONE;

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    const withCeilings = boxesByKey();
    expect(drawnKeys()).toStrictEqual([...ALWAYS_DRAWN_KEYS, ...CEILING_KEYS]);
    for (const key of ALWAYS_DRAWN_KEYS) {
      // Identity, not equality: showing the ceilings must not rebuild any other geometry.
      expect(boxesOf(withCeilings, key), key).toBe(boxesOf(withoutCeilings, key));
    }
  });

  it('draws the ceilings and light panels of the ceiling layout', () => {
    const ceilings = getCeilingLayout();

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    const drawn = boxesByKey();
    expect(boxesOf(drawn, 'ceiling')).toStrictEqual([...ceilings.ceiling]);
    expect(boxesOf(drawn, 'lightPanel')).toStrictEqual([...ceilings.lightPanel]);
  });

  it('keeps the identity of every box array across a re-render, so no geometry is rebuilt', () => {
    const { rerender } = render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);
    const first = boxesByKey();
    meshes.length = NONE;

    rerender(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    const second = boxesByKey();
    expect(second.size).toBe(first.size);
    for (const key of [...ALWAYS_DRAWN_KEYS, ...CEILING_KEYS]) {
      expect(boxesOf(second, key), key).toBe(boxesOf(first, key));
    }
  });

  it('keeps the identity of the ceiling arrays across a hide and a show', () => {
    const { rerender } = render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);
    const first = boxesByKey();

    rerender(<FloorModel showCeilings={false} floorCount={ONE_STOREY_COUNT} />);
    meshes.length = NONE;
    rerender(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    for (const key of CEILING_KEYS) {
      expect(boxesOf(boxesByKey(), key), key).toBe(boxesOf(first, key));
    }
  });

  it('adds no light and no camera of its own to the scene', () => {
    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    for (const mesh of recorded()) {
      expect(materialPropsOf(mesh)).not.toHaveProperty('intensity');
    }
    expect(recorded()).toHaveLength(ALWAYS_DRAWN_COUNT + CEILING_KEYS.length);
    expect(recorded().length).toBeGreaterThan(ONCE);
  });
});

describe('FloorModel, stacked', () => {
  beforeEach(() => {
    meshes.length = NONE;
    createGeometry.mockClear();
    // The store is global and its default is the naked building, so every case starts from
    // it and a case that ticks a box cannot leak into the next one.
    setEveryLayer(false);
  });

  it('draws a one-storey building exactly as it was drawn before it could be stacked', () => {
    const { container } = render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // The regression guard of the whole change: one storey is the building as shipped, so
    // its mesh count and every mesh's level must be what they were — one mesh per non-empty
    // bucket, all of them at the datum, ceilings included.
    const expectedMeshCount = ALWAYS_DRAWN_COUNT + CEILING_KEYS.length;
    expect(recorded()).toHaveLength(expectedMeshCount);
    expect(renderedMeshes(container)).toHaveLength(expectedMeshCount);
    expect(drawnKeys()).toStrictEqual([...ALWAYS_DRAWN_KEYS, ...CEILING_KEYS]);
    for (const mesh of recorded()) {
      expect(mesh.levels, materialKeyOf(mesh)).toStrictEqual([0]);
    }
    expect(renderedLevels(container)).toStrictEqual(
      Array.from({ length: expectedMeshCount }, () => '0'),
    );
  });

  it('draws one mesh per storey for every always-drawn bucket', () => {
    const levels = getStoreyLevelsFor(THREE_STOREY_COUNT);

    const { container } = render(
      <FloorModel showCeilings={false} floorCount={THREE_STOREY_COUNT} />,
    );

    expect(drawnKeys()).toStrictEqual([...ALWAYS_DRAWN_KEYS]);
    for (const mesh of recorded()) {
      // Identity, not equality: the shared array of `storeyLevels.ts` reaches every bucket.
      expect(mesh.levels, materialKeyOf(mesh)).toBe(levels);
    }
    expect(renderedMeshes(container)).toHaveLength(ALWAYS_DRAWN_COUNT * THREE_MESHES);
    expect(new Set(renderedLevels(container))).toStrictEqual(
      new Set(levels.map((level) => String(level))),
    );
  });

  it('roofs the top storey only, and lights every storey', () => {
    const levels = getStoreyLevelsFor(THREE_STOREY_COUNT);
    const top = getTopStoreyLevelFor(THREE_STOREY_COUNT);

    render(<FloorModel showCeilings={true} floorCount={THREE_STOREY_COUNT} />);

    const drawn = new Map(recorded().map((mesh) => [materialKeyOf(mesh), mesh.levels]));
    // A ceiling is the underside of the slab above; below the top storey that slab is drawn
    // already, so a ceiling there would be the same solid twice and the two would z-fight.
    expect(drawn.get('ceiling')).toBe(top);
    expect(drawn.get('ceiling')).toHaveLength(ONE_CEILING_LEVEL);
    expect(drawn.get('ceiling')?.[0]).toBe(levels.at(LAST_INDEX));
    // A luminaire is nobody else's slab, and it hangs clear of the slab band, so every
    // storey keeps its rooms lit.
    expect(drawn.get('lightPanel')).toBe(levels);
  });

  it('rebuilds no geometry when the storey count changes', () => {
    const { rerender } = render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);
    const first = boxesByKey();
    const bakedOnMount = createGeometry.mock.calls.length;
    expect(bakedOnMount).toBeGreaterThan(NONE);
    meshes.length = NONE;

    rerender(<FloorModel showCeilings={true} floorCount={THREE_STOREY_COUNT} />);
    rerender(<FloorModel showCeilings={true} floorCount={MAX_FLOOR_COUNT} />);
    rerender(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // Not one further merge across three changes of count: the geometry is keyed on the
    // boxes alone, and stepping the count only changes which shared level array is handed
    // down. The alternative — keying it on the levels too — would re-merge every wall, slab
    // and step of the building on every press of the stepper.
    expect(createGeometry).toHaveBeenCalledTimes(bakedOnMount);
    const last = boxesByKey();
    for (const key of [...ALWAYS_DRAWN_KEYS, ...CEILING_KEYS]) {
      expect(boxesOf(last, key), key).toBe(boxesOf(first, key));
    }
  });

  it('draws every storey the count asks for, up to the maximum', () => {
    const { container } = render(<FloorModel showCeilings={false} floorCount={MAX_FLOOR_COUNT} />);

    expect(renderedMeshes(container)).toHaveLength(ALWAYS_DRAWN_COUNT * MAX_FLOOR_COUNT);
    expect(new Set(renderedLevels(container)).size).toBe(MAX_FLOOR_COUNT);
  });
});

/**
 * The checkboxes of Part 5, applied to the building.
 *
 * Every case here is about {@link BUCKET_RULES} being obeyed, not about what is in it: the
 * table itself is the design decision and is read out of the module, so that a bucket moved
 * from one checkbox to another shows up as a deliberate edit there rather than as a test
 * quietly agreeing with whatever the code does. What is asserted is the three things the
 * table exists to guarantee — that a checkbox hides exactly what it owns, that hiding
 * NEVER changes which meshes exist, and that `finishing` re-surfaces rather than removes.
 */
describe('FloorModel, the build layers', () => {
  beforeEach(() => {
    meshes.length = NONE;
    createGeometry.mockClear();
    setEveryLayer(false);
  });

  it('draws the naked building, and only the building, with no checkbox ticked', () => {
    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // Nothing ticked is NAKED WALLS: structure, slabs, ceilings, the stairs, the railings,
    // the television panel — plus the millwork and the chambers that ARE the building, and
    // no service, no furniture and no finish.
    const building = [...ALWAYS_DRAWN_KEYS, ...CEILING_KEYS].filter(
      (key) => BUCKET_RULES[key].hiddenBy === null,
    );
    const shownKeys = recorded()
      .filter((mesh) => mesh.visible === true)
      .map((mesh) => materialKeyOf(mesh));

    expect(shownKeys).toStrictEqual(building);
    expect(shownKeys).toContain('wall');
    expect(shownKeys).toContain('fabricJoinery');
    expect(shownKeys).toContain('serviceChamber');
    expect(shownKeys).not.toContain('joinery');
    expect(shownKeys).not.toContain('serviceDrainage');
  });

  it('hides nothing at all once every checkbox is ticked', () => {
    setEveryLayer(true);

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // Everything ticked reproduces the finished, furnished, fully serviced floor.
    expect(hiddenKeys()).toStrictEqual([]);
    expect(plainKeys()).toStrictEqual([]);
    expect(drawnKeys()).toStrictEqual([...ALWAYS_DRAWN_KEYS, ...CEILING_KEYS]);
  });

  it.each(LAYER_KEYS)('hides exactly the buckets the table gives to %s', (layer) => {
    setEveryLayer(true);
    act(() => {
      useLayerStore.getState().setLayer(layer, false);
    });

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // Every bucket that checkbox owns and has a box to draw, and not one bucket more: this
    // is what lets a viewer name the checkbox responsible for a missing pixel.
    const owned = bucketsOwnedBy(layer).filter(
      (key) => ALWAYS_DRAWN_LAYOUT[key].length > NONE || CEILING_KEYS.includes(key),
    );
    expect(hiddenKeys()).toStrictEqual(owned);
  });

  it('gives every checkbox something to do', () => {
    // Guards the table against a row nobody can see the effect of: a checkbox that hides
    // nothing is a control that lies about what it does. `finishing` earns its place twice
    // over — it hides the artwork AND re-surfaces the scheme — and is asserted below.
    for (const layer of LAYER_KEYS) {
      const owned = bucketsOwnedBy(layer).filter((key) => ALWAYS_DRAWN_LAYOUT[key].length > NONE);
      const resurfaced = FLOOR_MATERIAL_KEYS.filter((key) => BUCKET_RULES[key].finish);
      const effect = layer === 'finishing' ? [...owned, ...resurfaced] : owned;

      expect(effect, layer).not.toHaveLength(NONE);
    }
  });

  it('draws exactly the same meshes whether the layers are on or off', () => {
    const { container, rerender } = render(
      <FloorModel showCeilings={true} floorCount={THREE_STOREY_COUNT} />,
    );
    const naked = renderedMeshes(container).length;
    const nakedLevels = renderedLevels(container);
    const nakedBoxes = boxesByKey();

    act(() => {
      setEveryLayer(true);
    });
    rerender(<FloorModel showCeilings={true} floorCount={THREE_STOREY_COUNT} />);

    // The claim of the whole part: a checkbox changes `visible`, never the tree. Same mesh
    // count, same levels, and the very same box arrays — so the same baked geometry.
    expect(renderedMeshes(container)).toHaveLength(naked);
    expect(renderedLevels(container)).toStrictEqual(nakedLevels);
    const lit = boxesByKey();
    for (const key of [...ALWAYS_DRAWN_KEYS, ...CEILING_KEYS]) {
      expect(boxesOf(lit, key), key).toBe(boxesOf(nakedBoxes, key));
    }
  });

  it('bakes no geometry however often the checkboxes are flipped', () => {
    const { rerender } = render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);
    const bakedOnMount = createGeometry.mock.calls.length;
    expect(bakedOnMount).toBeGreaterThan(NONE);

    for (const layer of LAYER_KEYS) {
      act(() => {
        useLayerStore.getState().toggleLayer(layer);
      });
      rerender(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);
      act(() => {
        useLayerStore.getState().toggleLayer(layer);
      });
      rerender(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);
    }

    // Eighteen flips over nine checkboxes and not one further merge. Had the buckets been
    // mounted conditionally instead, each of those flips would have disposed and re-merged
    // every box of the bucket — a rebuild of the floor per click.
    expect(createGeometry).toHaveBeenCalledTimes(bakedOnMount);
  });
});

describe('FloorModel, the finish', () => {
  beforeEach(() => {
    meshes.length = NONE;
    createGeometry.mockClear();
    setEveryLayer(true);
  });

  it('re-surfaces the finish-bearing buckets, and adds or removes no box', () => {
    const { rerender } = render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);
    const finished = boxesByKey();
    const finishedKeys = drawnKeys();

    act(() => {
      useLayerStore.getState().setLayer('finishing', false);
    });
    meshes.length = NONE;
    rerender(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // Same buckets, same boxes, one material swapped: `finishing` is the one checkbox that
    // is not a set of solids at all.
    expect(drawnKeys()).toStrictEqual(finishedKeys);
    const plain = boxesByKey();
    for (const key of finishedKeys) {
      expect(boxesOf(plain, key), key).toBe(boxesOf(finished, key));
    }
    const expected = FLOOR_MATERIAL_KEYS.filter(
      (key) => BUCKET_RULES[key].finish && ALWAYS_DRAWN_LAYOUT[key].length > NONE,
    );
    expect(plainKeys()).toStrictEqual(expected);
    expect(expected).toContain('slabRoom');
    expect(expected).toContain('joinery');
    expect(expected).toContain('fabricJoinery');
  });

  it('never looks a texture up for a re-surfaced bucket', () => {
    act(() => {
      useLayerStore.getState().setLayer('finishing', false);
    });

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // A screed has no grain, and lending it the oak's would be a finish by another name.
    // Every one of these buckets HAS a texture to be handed, and none of them is handed it.
    const stripped = recorded().filter((mesh) => BUCKET_RULES[materialKeyOf(mesh)].finish);

    expect(stripped.length).toBeGreaterThan(NONE);
    for (const mesh of stripped) {
      const key = materialKeyOf(mesh);
      expect(FAMILY_TEXTURE_TOKEN[key], key).toBeDefined();
      expect(textureOf(mesh), key).toBeUndefined();
    }
  });

  it('hides the artwork rather than re-surfacing it', () => {
    act(() => {
      useLayerStore.getState().setLayer('finishing', false);
    });

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // A canvas hung on a wall has no unfinished state: plain screed over a painting is not
    // what an unfinished flat looks like, an empty wall is.
    expect(hiddenKeys()).toStrictEqual(['artwork']);
    expect(plainKeys()).not.toContain('artwork');
  });

  it('leaves the walls and the ceilings alone, which are already plain', () => {
    act(() => {
      useLayerStore.getState().setLayer('finishing', false);
    });

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // Matte white plaster is what the building is handed over as, so there is nothing for
    // this checkbox to strip off it and re-surfacing it would be a change with no meaning.
    for (const key of ['wall', 'parapet', 'ceiling'] as const) {
      expect(plainKeys(), key).not.toContain(key);
    }
  });

  it('keeps the building standing when the furniture goes', () => {
    act(() => {
      useLayerStore.getState().setLayer('furniture', false);
    });

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // The two fittings that are the building: the food-pass counter, whose going would open
    // a 0.30 m slot from the guest room into the kitchen, and the sealed control-center
    // chambers, whose going would leave the plant of the floor standing in open air.
    expect(hiddenKeys()).toStrictEqual([
      'sanitaryWare',
      'appliance',
      'joinery',
      'worktop',
      'softFurnishing',
    ]);
    expect(hiddenKeys()).not.toContain('fabricJoinery');
    expect(hiddenKeys()).not.toContain('serviceChamber');
  });

  it('gives the boxing its own checkbox, separate from what it boxes in', () => {
    act(() => {
      useLayerStore.getState().setLayer('covers', false);
    });

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    // Covers on with the runs off is the finished room; both on is what is inside the
    // boxing. Neither question is answerable if the boxing hides with the pipe.
    expect(hiddenKeys()).toStrictEqual(['serviceCover']);
  });
});
