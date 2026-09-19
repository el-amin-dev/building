/**
 * Turns plan boxes into three.js box geometry, merged into a single buffer.
 *
 * The floor is described by hundreds of {@link PlanBox} extrusions (walls, slabs,
 * parapets, steps). Rendering one mesh per box would cost one draw call each. Every
 * box that shares a material is therefore baked into one {@link BufferGeometry}
 * here, and drawn by a single mesh (`MergedBoxesMesh.tsx`).
 *
 * The module is free of React and of the WebGL renderer: it only builds geometry,
 * so it runs and is tested under jsdom.
 */
import { BoxGeometry, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlanBox } from '../domain/planBox.ts';
import { LENGTH_TOLERANCE, rectDepth, rectWidth } from '../domain/planGeometry.ts';

/** Half of a span: the distance from a box's centre to one of its faces. */
const HALF = 0.5;

/** Props of a three.js box mesh: where its centre sits and how big it is, in metres. */
export interface BoxProps {
  /**
   * Centre of the box in storey-local coordinates: `[x, y, z]`, in metres, with y measured
   * from the finished floor of the storey it is drawn at (see
   * {@link createMergedBoxGeometry}).
   */
  readonly position: readonly [number, number, number];
  /** Sizes of the box along x, y and z, in metres: the `BoxGeometry` arguments. */
  readonly args: readonly [number, number, number];
}

/**
 * Asserts that a box can be turned into geometry.
 *
 * @param box - The box to check.
 * @throws RangeError when a plan coordinate or a vertical level is not finite, or
 *   when the box has no extent (width, depth or height no greater than
 *   {@link LENGTH_TOLERANCE}) and so would render as a degenerate, invisible
 *   surface; the message names the offending size.
 */
function assertDrawableBox(box: PlanBox): void {
  const { minX, maxX, minZ, maxZ } = box.rect;
  const levels = [minX, maxX, minZ, maxZ, box.bottom, box.top];
  if (!levels.every((level) => Number.isFinite(level))) {
    throw new RangeError(`A box must have finite coordinates, got ${JSON.stringify(box)}`);
  }
  const width = rectWidth(box.rect);
  const depth = rectDepth(box.rect);
  const height = box.top - box.bottom;
  if (width <= LENGTH_TOLERANCE || depth <= LENGTH_TOLERANCE || height <= LENGTH_TOLERANCE) {
    throw new RangeError(
      `A box must have a positive size on every axis, got width ${String(width)}, height ${String(
        height,
      )}, depth ${String(depth)}`,
    );
  }
}

/**
 * Converts a plan box into the centre and sizes a three.js box mesh needs.
 *
 * The plan gives the box by its faces (`minX`/`maxX`, `minZ`/`maxZ`, `bottom`/`top`),
 * while three.js places a `BoxGeometry` by its centre, so the vertical centre is
 * `(bottom + top) / 2`. Sizes are not snapped to the plan grid: a stair riser is not
 * a whole number of centimetres (see `planBox.ts`).
 *
 * @param box - The box to convert.
 * @returns The centre and the sizes of the box, in metres.
 * @throws RangeError when the box has a non-finite coordinate or no extent on an axis.
 */
export function toBoxProps(box: PlanBox): BoxProps {
  assertDrawableBox(box);
  const { rect } = box;
  return {
    position: [
      (rect.minX + rect.maxX) * HALF,
      (box.bottom + box.top) * HALF,
      (rect.minZ + rect.maxZ) * HALF,
    ],
    args: [rectWidth(rect), box.top - box.bottom, rectDepth(rect)],
  };
}

/**
 * Bakes a list of plan boxes into one geometry, positions included.
 *
 * One `BoxGeometry` is built per box and translated to the box's centre, then all of
 * them are merged with `mergeGeometries`; the intermediate geometries are disposed
 * straight after the merge, so only the returned geometry holds buffers.
 *
 * The result is expressed in **storey-local** coordinates: plan x and z in scene
 * coordinates, and y measured from the finished floor of the storey the geometry is drawn
 * at, not from the scene origin. That is what lets one baked geometry be drawn at every
 * storey of a stack, by one mesh each (`MergedBoxesMesh.tsx`). Floor 1's finished floor is
 * y = 0, so for a one-storey building the storey-local coordinates are the scene
 * coordinates — which is why nothing below, and nothing in `domain/`, changed to stack the
 * building.
 *
 * An empty list yields an empty geometry with no `position` attribute rather than an
 * error; the caller renders nothing for it (`MergedBoxesMesh.tsx` returns no mesh).
 *
 * @param boxes - The boxes to bake. Not mutated.
 * @returns A single geometry holding every box; the caller owns it and must call
 *   `dispose()` on it when it is replaced or dropped.
 * @throws RangeError when a box has a non-finite coordinate or no extent on an axis.
 */
export function createMergedBoxGeometry(boxes: readonly PlanBox[]): BufferGeometry {
  const parts = boxes.map((box) => {
    const { position, args } = toBoxProps(box);
    const geometry = new BoxGeometry(...args);
    geometry.translate(...position);
    return geometry;
  });
  if (parts.length === 0) {
    // `mergeGeometries` reads `geometries[0]`, so the empty case is answered here with a
    // geometry that carries no attribute at all.
    return new BufferGeometry();
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return merged;
}
