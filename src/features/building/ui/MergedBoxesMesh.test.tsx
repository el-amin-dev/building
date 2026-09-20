import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { makeBox } from '../domain/planBox.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { makeRect } from '../domain/planGeometry.ts';
import { MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { createMergedBoxGeometry } from './mergeBoxes.ts';
import { MergedBoxesMesh } from './MergedBoxesMesh.tsx';
import { getStoreyLevelsFor } from './storeyLevels.ts';

/**
 * A stand-in for the merged geometry: jsdom has no WebGL, and only disposal and identity are
 * observed.
 *
 * It carries a token and stringifies to it, because jsdom renders `<mesh>` as an unrecognised
 * element and React therefore writes every prop as an *attribute*: an object prop would land
 * as the useless `"[object Object]"`. With the token, the attribute of a rendered mesh names
 * the stub it was handed, so {@link geometryOf} can recover the object itself and the
 * "one geometry, many storeys" rule can be asserted by identity rather than by equality.
 */
interface FakeGeometry {
  /** Unique name of this stub, written into the mesh's `geometry` attribute. */
  readonly token: string;
  /** Spy standing for `BufferGeometry.dispose`. */
  readonly dispose: Mock;
  /** Renders the stub as its token, which is how the attribute carries the identity. */
  readonly toString: () => string;
}

const built = vi.hoisted(() => ({
  geometries: [] as { token: string; dispose: Mock; toString: () => string }[],
}));

// The geometry itself is covered by `mergeBoxes.test.ts`; here it is replaced by a spy so the
// component's memoisation and its disposal can be observed without building real buffers.
vi.mock('./mergeBoxes.ts', () => ({
  createMergedBoxGeometry: vi.fn(() => {
    const token = `geometry-${String(built.geometries.length)}`;
    const geometry = { token, dispose: vi.fn(), toString: () => token };
    built.geometries.push(geometry);
    return geometry;
  }),
}));

const WALL_BOXES: readonly PlanBox[] = [makeBox(makeRect(0, 4, 0, 0.2), 0, 3)];
const CEILING_BOXES: readonly PlanBox[] = [makeBox(makeRect(0, 4, 0, 4), 2.8, 3)];
const NO_BOXES: readonly PlanBox[] = [];
const MATERIAL_COLOR = '#ffffff';
const ONE_CALL = 1;
const TWO_CALLS = 2;
const NOT_CALLED = 0;
/** Meshes one non-empty bucket draws for a one-storey building. */
const ONE_MESH = 1;
/**
 * The stack the stacking tests use: three storeys, the smallest building in which "every
 * storey" and "the top storey" are different answers.
 */
const THREE_STOREY_COUNT = 3;
/** Meshes one non-empty bucket draws for that building: one per storey. */
const THREE_MESHES = THREE_STOREY_COUNT;
/** A one-storey building: the case that must still draw exactly one mesh, at the datum. */
const ONE_STOREY: readonly number[] = getStoreyLevelsFor(MIN_FLOOR_COUNT);
/** A three-storey building: `[0, 3, 6]` at the typical floor's pitch. */
const THREE_STOREYS: readonly number[] = getStoreyLevelsFor(THREE_STOREY_COUNT);
/** Distinct geometries the whole stack may hold: one, baked once and shared. */
const ONE_GEOMETRY = 1;

const createGeometry = vi.mocked(createMergedBoxGeometry);

function geometryAt(index: number): FakeGeometry {
  const geometry = built.geometries[index];
  if (geometry === undefined) {
    throw new Error(`No geometry was built at index ${String(index)}`);
  }
  return geometry;
}

/** The meshes rendered, in order. */
function meshesIn(container: HTMLElement): readonly Element[] {
  return [...container.querySelectorAll('mesh')];
}

/**
 * Recovers the geometry stub a rendered mesh was handed.
 *
 * @param mesh - A rendered `<mesh>` element.
 * @returns The stub whose token its `geometry` attribute carries.
 * @throws Error when the attribute names no stub that was built.
 */
function geometryOf(mesh: Element): FakeGeometry {
  const token = mesh.getAttribute('geometry');
  const found = built.geometries.find((geometry) => geometry.token === token);
  if (found === undefined) {
    throw new Error(`A mesh carried the geometry ${String(token)}, which was never built`);
  }
  return found;
}

/** The levels the rendered meshes sit at, read back off their `position-y`. */
function levelsIn(container: HTMLElement): readonly string[] {
  return meshesIn(container).map((mesh) => mesh.getAttribute('position-y') ?? '');
}

describe('MergedBoxesMesh', () => {
  beforeEach(() => {
    built.geometries.length = 0;
    createGeometry.mockClear();
  });

  it('renders nothing, and builds no geometry, without a single box', () => {
    const { container } = render(<MergedBoxesMesh boxes={NO_BOXES} levels={ONE_STOREY} />);

    expect(container.querySelector('mesh')).toBeNull();
    expect(createGeometry).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('renders nothing for an empty bucket however many storeys are asked for', () => {
    const { container } = render(<MergedBoxesMesh boxes={NO_BOXES} levels={THREE_STOREYS} />);

    expect(container.querySelector('mesh')).toBeNull();
    expect(createGeometry).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('draws one mesh holding one merged geometry, with the material as its child', () => {
    const { container } = render(
      <MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY}>
        <meshStandardMaterial color={MATERIAL_COLOR} />
      </MergedBoxesMesh>,
    );

    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(createGeometry).toHaveBeenCalledWith(WALL_BOXES);
    expect(built.geometries).toHaveLength(ONE_CALL);
    expect(container.querySelectorAll('mesh')).toHaveLength(ONE_MESH);
    expect(container.querySelector('mesh > meshstandardmaterial')).not.toBeNull();
  });

  it('draws one mesh per storey level, each at that level and each with the material', () => {
    const { container } = render(
      <MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS}>
        <meshStandardMaterial color={MATERIAL_COLOR} />
      </MergedBoxesMesh>,
    );

    expect(meshesIn(container)).toHaveLength(THREE_MESHES);
    expect(levelsIn(container)).toStrictEqual(THREE_STOREYS.map((level) => String(level)));
    expect(container.querySelectorAll('mesh > meshstandardmaterial')).toHaveLength(THREE_MESHES);
  });

  it('bakes the geometry once for the whole stack and shares that one object', () => {
    const { container } = render(<MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} />);

    // One merge for three storeys, not three: the geometry holds storey-local coordinates,
    // so the same buffers are drawn at every level.
    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(built.geometries).toHaveLength(ONE_GEOMETRY);
    const drawn = meshesIn(container).map((mesh) => geometryOf(mesh));
    expect(drawn).toHaveLength(THREE_MESHES);
    for (const geometry of drawn) {
      expect(Object.is(geometry, geometryAt(0))).toBe(true);
    }
  });

  it('does not re-bake when only the identity of the levels changes', () => {
    const { rerender } = render(<MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} />);

    // An equal array with a new identity: the memo is keyed on the boxes alone, so this must
    // be free. Keying it on the levels too would re-merge every wall on each stepper press.
    rerender(<MergedBoxesMesh boxes={WALL_BOXES} levels={[...THREE_STOREYS]} />);

    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(NOT_CALLED);
  });

  /**
   * What a hidden bucket still is, and the one thing these cases do not read back.
   *
   * The flag itself is invisible from here: jsdom renders `<mesh>` as an unrecognised tag, so
   * React writes its props as attributes — and it drops a BOOLEAN one on such a tag rather
   * than stringifying it, which is why `position-y` can be read back above and `visible`
   * cannot. What is observable is everything that matters: that hiding mounts the same meshes
   * at the same levels over the same geometry, and that flipping the flag costs no merge and
   * no disposal. That the value then reaches `MergedBoxesMesh` at all is asserted where it is
   * decided, over the recorded props in `FloorModel.test.tsx`.
   */
  it('hides every mesh of the bucket, and only hides them', () => {
    const { container } = render(
      <MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} visible={false} />,
    );

    // A hidden bucket is a hidden mesh and never an absent one: the meshes are still there,
    // at their levels, holding the one geometry. Only `visible` changed.
    expect(meshesIn(container)).toHaveLength(THREE_MESHES);
    expect(levelsIn(container)).toStrictEqual(THREE_STOREYS.map((level) => String(level)));
    expect(geometryOf(meshesIn(container)[0])).toBe(geometryAt(0));
  });

  /**
   * The claim the whole `visible` prop exists to make, and the reason it is not a `&&`.
   *
   * Leaving the component out while a layer is off would unmount it, which disposes the
   * merged geometry; the next tick of the same checkbox would then re-merge and re-upload
   * every box of the bucket. With nine layer checkboxes over a floor of this many boxes,
   * that turns a toggle into a rebuild of the building on every click. Three flips here, and
   * neither the merge count nor the dispose count is allowed to move by one.
   *
   * The shape is the `levels` case above: the same props but for the one under test,
   * re-rendered, with `createGeometry` and the stub's `dispose` as the whole assertion.
   */
  it('does not re-bake and does not dispose when only the visibility flips', () => {
    const { container, rerender } = render(
      <MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} />,
    );

    rerender(<MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} visible={false} />);
    rerender(<MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} visible={true} />);
    rerender(<MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} visible={false} />);

    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(built.geometries).toHaveLength(ONE_GEOMETRY);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(NOT_CALLED);
    // ...and the meshes still hold that same geometry, so nothing was re-uploaded either.
    const drawn = meshesIn(container).map((mesh) => geometryOf(mesh));
    expect(drawn).toHaveLength(THREE_MESHES);
    for (const geometry of drawn) {
      expect(Object.is(geometry, geometryAt(0))).toBe(true);
    }
  });

  it('adds and removes meshes when the storey count changes, without re-baking', () => {
    const { container, rerender } = render(
      <MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY} />,
    );
    expect(meshesIn(container)).toHaveLength(ONE_MESH);

    rerender(<MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} />);
    expect(meshesIn(container)).toHaveLength(THREE_MESHES);

    rerender(<MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY} />);

    expect(meshesIn(container)).toHaveLength(ONE_MESH);
    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('keeps the same geometry across re-renders with the same boxes', () => {
    const { rerender } = render(<MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY} />);

    rerender(<MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY} />);

    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('disposes the geometry on unmount', () => {
    const { unmount } = render(<MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY} />);

    unmount();

    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(ONE_CALL);
  });

  it('disposes the one geometry exactly once however many storeys drew it', () => {
    const { unmount } = render(<MergedBoxesMesh boxes={WALL_BOXES} levels={THREE_STOREYS} />);

    unmount();

    // One geometry, one owner: three meshes sharing it must not dispose it three times.
    expect(built.geometries).toHaveLength(ONE_GEOMETRY);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(ONE_CALL);
  });

  it('disposes the previous geometry when the boxes change', () => {
    const { rerender } = render(<MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY} />);

    rerender(<MergedBoxesMesh boxes={CEILING_BOXES} levels={ONE_STOREY} />);

    expect(createGeometry).toHaveBeenCalledTimes(TWO_CALLS);
    expect(createGeometry).toHaveBeenLastCalledWith(CEILING_BOXES);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(ONE_CALL);
    expect(geometryAt(1).dispose).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('disposes the geometry when the last box goes away', () => {
    const { container, rerender } = render(
      <MergedBoxesMesh boxes={WALL_BOXES} levels={ONE_STOREY} />,
    );

    rerender(<MergedBoxesMesh boxes={NO_BOXES} levels={ONE_STOREY} />);

    expect(container.querySelector('mesh')).toBeNull();
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(ONE_CALL);
    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
  });
});
