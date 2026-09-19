import { render } from '@testing-library/react';
import { isValidElement } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBuiltFloor } from '../domain/builtFloor.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { FloorModel } from './FloorModel.tsx';
import {
  FLOOR_MATERIAL_KEYS,
  getCeilingLayout,
  getFixtureLayout,
  getFloorLayout,
} from './floorLayout.ts';
import type { FloorLayout } from './floorLayout.ts';
import { MATERIAL_PALETTE } from './floorMaterials.ts';
import type { FloorMaterialKey } from './floorMaterials.ts';
import { createMergedBoxGeometry } from './mergeBoxes.ts';
import type { MergedBoxesMeshProps } from './MergedBoxesMesh.tsx';
import { getStoreyLevelsFor, getTopStoreyLevelFor } from './storeyLevels.ts';

/** One recorded `MergedBoxesMesh`: what it was asked to draw, and where. */
interface RecordedMesh {
  /** The array handed to the mesh; its identity is what the anti-thrash test watches. */
  readonly boxes: readonly PlanBox[];
  /** The storey levels handed to it: one mesh is drawn at each. */
  readonly levels: readonly number[];
  /** The material element the model nested in the mesh. */
  readonly material: ReactNode;
}

const { meshes } = vi.hoisted(() => ({ meshes: [] as unknown[] }));

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
      meshes.push({ boxes: props.boxes, levels: props.levels, material: props.children });
      return <actual.MergedBoxesMesh {...props} />;
    },
  };
});

const createGeometry = vi.mocked(createMergedBoxGeometry);

const MATERIAL_ELEMENT = 'meshStandardMaterial';

/**
 * Everything drawn in both views, bucketed the way `FloorModel` buckets it: the built floor
 * MERGED WITH the sanitary ware.
 *
 * The fixtures are not part of a `BuiltFloor` — a bath is a thing standing in a room, not
 * building fabric — so `getFloorLayout` leaves `sanitaryWare` empty and `getFixtureLayout`
 * fills it, and the component folds the two together (`floorLayout.ts`, `FloorModel.tsx`).
 * Deriving the expectation from `getFloorLayout` alone, as this file did, therefore left the
 * bathroom ware out of every count while the model went on drawing it.
 */
const ALWAYS_DRAWN_LAYOUT: FloorLayout = {
  ...getFloorLayout(getBuiltFloor()),
  ...getFixtureLayout(),
};

/** The families always drawn: every bucket of that layout which holds a box. */
const ALWAYS_DRAWN_KEYS: readonly FloorMaterialKey[] = FLOOR_MATERIAL_KEYS.filter(
  (key) => ALWAYS_DRAWN_LAYOUT[key].length > 0,
);
/** The families drawn only inside: the ceilings and their light panels. */
const CEILING_KEYS: readonly FloorMaterialKey[] = ['ceiling', 'lightPanel'];

/**
 * Walls, parapets, four kinds of slab (room, circulation, open air and wet), railings, steps,
 * the television panel and the sanitary ware.
 */
const ALWAYS_DRAWN_COUNT = 10;

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
 * Names the surface family a recorded mesh draws.
 *
 * The palette gives every family its own colour, so the colour of the material identifies the
 * bucket without the model having to label its meshes.
 *
 * @param mesh - The recorded mesh.
 * @returns The palette key whose colour the mesh's material carries.
 * @throws Error when no palette entry matches.
 */
function materialKeyOf(mesh: RecordedMesh): FloorMaterialKey {
  const { color } = materialPropsOf(mesh);
  const key = FLOOR_MATERIAL_KEYS.find((candidate) => MATERIAL_PALETTE[candidate].color === color);
  if (key === undefined) {
    throw new Error(`A mesh used the colour ${String(color)}, which is in no palette entry`);
  }
  return key;
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
    // ...and the buckets left empty are exactly the two the exterior view drops, so a
    // family that silently stopped producing solids cannot hide among them.
    const empty = FLOOR_MATERIAL_KEYS.filter((key) => ALWAYS_DRAWN_LAYOUT[key].length === NONE);
    expect(empty).toStrictEqual([...CEILING_KEYS]);
    for (const key of CEILING_KEYS) {
      expect(drawnKeys(), key).not.toContain(key);
    }
  });

  it('draws every solid of the families it is given', () => {
    /** Two basins, two baths and two shower trays, one per sanitary fixture of the plan. */
    const sanitaryWareCount = 6;
    /** One ceiling box per clear rect of every roofed space. */
    const ceilingBoxCount = 19;
    /** One light panel per roofed space; the stairwell is roofed by none. */
    const lightPanelCount = 16;
    const ceilings = getCeilingLayout();

    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    const drawn = boxesByKey();
    expect(boxesOf(drawn, 'sanitaryWare')).toHaveLength(sanitaryWareCount);
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
    render(<FloorModel showCeilings={true} floorCount={ONE_STOREY_COUNT} />);

    for (const mesh of recorded()) {
      const key = materialKeyOf(mesh);
      expect(materialPropsOf(mesh), key).toStrictEqual({ ...MATERIAL_PALETTE[key] });
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
