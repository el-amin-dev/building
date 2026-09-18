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
  /**
   * Finished-floor levels to draw them at: one mesh per storey, all sharing the one baked
   * geometry. Must keep its identity across renders.
   *
   * Required, with no default. A silently defaulting level is how a building ends up drawn
   * once when it should be drawn ten times — and a building drawn once looks exactly like
   * one whose storey count never reached the scene. Callers take their arrays from
   * `storeyLevels.ts`, which hands out one shared array per count.
   */
  readonly levels: readonly number[];
  /** The material element for the mesh, e.g. a `<meshStandardMaterial />`. */
  readonly children?: ReactNode;
}

/**
 * One mesh per storey drawing many plan boxes: the render primitive of the built building.
 *
 * The boxes are baked into a single geometry by `createMergedBoxGeometry`, so a group of
 * walls, slabs or steps sharing a material costs one draw call instead of one per box.
 *
 * **The geometry holds storey-local coordinates**: plan x and z in scene coordinates, and y
 * measured from the finished floor of whichever storey the mesh is drawn at. Each level of
 * `levels` therefore gets a mesh at `position-y = level`, and the one geometry is shared by
 * all of them — a ten-storey building costs ten draw calls per material and one merge, not
 * ten merges. Floor 1's finished floor is y = 0, so for a one-storey building those
 * storey-local coordinates *are* the scene coordinates, which is why nothing in `domain/`
 * had to change to stack the building.
 *
 * That is also why the memo below is keyed on `boxes` **alone**, and must stay that way:
 * adding `levels` to it would re-merge every wall, slab and step on each press of the
 * storey stepper, to rebuild a geometry that is identical every time.
 *
 * Nothing is rendered for an empty list (for example the ceilings while they are hidden in
 * the exterior view). The geometry is memoised on `boxes` and disposed when it is replaced
 * or when the mesh unmounts, so toggling a group on and off does not leak buffers. Under
 * React's StrictMode the simulated remount runs that cleanup once on a geometry still in
 * use; only GPU buffers are freed there and three.js re-uploads them on the next frame.
 *
 * @param props - {@link MergedBoxesMeshProps}
 * @returns One mesh per level, or `null` when there is no box to draw.
 */
export function MergedBoxesMesh({ boxes, levels, children }: MergedBoxesMeshProps) {
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

  return (
    <>
      {levels.map((level) => (
        <mesh key={level} geometry={geometry} position-y={level}>
          {children}
        </mesh>
      ))}
    </>
  );
}
