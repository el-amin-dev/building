import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { PlanBox } from '../domain/planBox.ts';
import { createMergedBoxGeometry } from './mergeBoxes.ts';

/** Props of {@link MergedBoxesMesh}. */
export interface MergedBoxesMeshProps {
  /**
   * The boxes to draw, all with the same material. The geometry is rebuilt whenever this
   * array's identity changes, so callers pass a memoised or module-level array.
   */
  readonly boxes: readonly PlanBox[];
  /** The material element for the mesh, e.g. a `<meshStandardMaterial />`. */
  readonly children?: ReactNode;
}

/**
 * One mesh drawing many plan boxes: the render primitive of the built floor.
 *
 * The boxes are baked into a single geometry by `createMergedBoxGeometry`, so a group of
 * walls, slabs or steps sharing a material costs one draw call instead of one per box. The
 * geometry already holds scene coordinates, so the mesh itself stays at the origin.
 *
 * Nothing is rendered for an empty list (for example the ceilings while they are hidden in
 * the exterior view). The geometry is memoised on `boxes` and disposed when it is replaced
 * or when the mesh unmounts, so toggling a group on and off does not leak buffers. Under
 * React's StrictMode the simulated remount runs that cleanup once on a geometry still in
 * use; only GPU buffers are freed there and three.js re-uploads them on the next frame.
 *
 * @param props - {@link MergedBoxesMeshProps}
 * @returns The merged mesh, or `null` when there is no box to draw.
 */
export function MergedBoxesMesh({ boxes, children }: MergedBoxesMeshProps) {
  const geometry = useMemo(
    () => (boxes.length === 0 ? null : createMergedBoxGeometry(boxes)),
    [boxes],
  );

  useEffect(
    () => () => {
      geometry?.dispose();
    },
    [geometry],
  );

  if (geometry === null) {
    return null;
  }

  return <mesh geometry={geometry}>{children}</mesh>;
}
