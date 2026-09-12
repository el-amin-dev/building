import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { makeBox } from '../domain/planBox.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { makeRect } from '../domain/planGeometry.ts';
import { createMergedBoxGeometry } from './mergeBoxes.ts';
import { MergedBoxesMesh } from './MergedBoxesMesh.tsx';

/** A stand-in for the merged geometry: jsdom has no WebGL, and only disposal is observed. */
interface FakeGeometry {
  /** Spy standing for `BufferGeometry.dispose`. */
  readonly dispose: Mock;
}

const built = vi.hoisted(() => ({ geometries: [] as { dispose: Mock }[] }));

// The geometry itself is covered by `mergeBoxes.test.ts`; here it is replaced by a spy so the
// component's memoisation and its disposal can be observed without building real buffers.
vi.mock('./mergeBoxes.ts', () => ({
  createMergedBoxGeometry: vi.fn(() => {
    const geometry = { dispose: vi.fn() };
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

const createGeometry = vi.mocked(createMergedBoxGeometry);

function geometryAt(index: number): FakeGeometry {
  const geometry = built.geometries[index];
  if (geometry === undefined) {
    throw new Error(`No geometry was built at index ${String(index)}`);
  }
  return geometry;
}

describe('MergedBoxesMesh', () => {
  beforeEach(() => {
    built.geometries.length = 0;
    createGeometry.mockClear();
  });

  it('renders nothing, and builds no geometry, without a single box', () => {
    const { container } = render(<MergedBoxesMesh boxes={NO_BOXES} />);

    expect(container.querySelector('mesh')).toBeNull();
    expect(createGeometry).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('draws one mesh holding one merged geometry, with the material as its child', () => {
    const { container } = render(
      <MergedBoxesMesh boxes={WALL_BOXES}>
        <meshStandardMaterial color={MATERIAL_COLOR} />
      </MergedBoxesMesh>,
    );

    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(createGeometry).toHaveBeenCalledWith(WALL_BOXES);
    expect(built.geometries).toHaveLength(ONE_CALL);
    expect(container.querySelectorAll('mesh')).toHaveLength(ONE_CALL);
    expect(container.querySelector('mesh > meshstandardmaterial')).not.toBeNull();
  });

  it('keeps the same geometry across re-renders with the same boxes', () => {
    const { rerender } = render(<MergedBoxesMesh boxes={WALL_BOXES} />);

    rerender(<MergedBoxesMesh boxes={WALL_BOXES} />);

    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('disposes the geometry on unmount', () => {
    const { unmount } = render(<MergedBoxesMesh boxes={WALL_BOXES} />);

    unmount();

    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(ONE_CALL);
  });

  it('disposes the previous geometry when the boxes change', () => {
    const { rerender } = render(<MergedBoxesMesh boxes={WALL_BOXES} />);

    rerender(<MergedBoxesMesh boxes={CEILING_BOXES} />);

    expect(createGeometry).toHaveBeenCalledTimes(TWO_CALLS);
    expect(createGeometry).toHaveBeenLastCalledWith(CEILING_BOXES);
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(ONE_CALL);
    expect(geometryAt(1).dispose).toHaveBeenCalledTimes(NOT_CALLED);
  });

  it('disposes the geometry when the last box goes away', () => {
    const { container, rerender } = render(<MergedBoxesMesh boxes={WALL_BOXES} />);

    rerender(<MergedBoxesMesh boxes={NO_BOXES} />);

    expect(container.querySelector('mesh')).toBeNull();
    expect(geometryAt(0).dispose).toHaveBeenCalledTimes(ONE_CALL);
    expect(createGeometry).toHaveBeenCalledTimes(ONE_CALL);
  });
});
