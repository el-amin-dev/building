/**
 * The exterior framing of the building at the live canvas size and storey count.
 *
 * `getExteriorFraming` needs the aspect ratio of the canvas, which only a component
 * rendered *inside* the `<Canvas>` can read (`useThree`), so the derivation lives in this
 * hook rather than in the scene component that owns the canvas. Three consumers need the
 * framing — `SceneLighting` (fog range and the scale of the sun, handed it as a prop by
 * `BuildingScene`), `ViewTransition` (the exterior endpoint of the camera flight) and
 * `ExteriorCameraControls` (orbit target, start position and zoom limits) — and each calls
 * this hook, so none restates a plot size, a height or the field of view.
 *
 * The storey count is read here, from the store, rather than taken as an argument: three
 * components call this hook independently, and a parameter would let two of them disagree
 * about how tall the building is — one lighting a ten-storey stack while another framed a
 * single floor. A zero-argument hook has one answer, and the count is part of it.
 *
 * The result is memoised on the canvas size and the count: the framing is pure data of the
 * plot, the heights, the field of view, the aspect and the number of storeys, so it is
 * recomputed only when the viewport changes shape or a storey is added or removed.
 */

import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { getExteriorFraming } from '../domain/exteriorFraming.ts';
import type { ExteriorFraming } from '../domain/exteriorFraming.ts';
import { PLOT_RECT } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';

/**
 * Vertical field of view of the scene camera, in degrees.
 *
 * The single source of truth for the field of view: the `<Canvas>` camera options are
 * built from it and the framing is derived with it, so the distance at which the floor
 * fits the frame always matches the camera that renders it.
 */
export const CAMERA_FOV_DEGREES = 50;

/**
 * Aspect used while the canvas has no measured height yet, i.e. before its first layout.
 *
 * A square frame: it is the aspect at which the vertical and the horizontal half-angles of
 * the frustum are equal, so the framing it yields is a sane middle ground rather than a
 * portrait or a landscape guess. `getExteriorFraming` rejects a non-finite aspect, so the
 * fallback also keeps a zero-height canvas from throwing.
 */
const FALLBACK_ASPECT = 1;

/**
 * Returns the exterior framing of the building for the current canvas size and storey
 * count.
 *
 * Must be called from inside a `<Canvas>`: it reads the canvas size from the three.js
 * store.
 *
 * @returns The framing of {@link PLOT_RECT} stacked to the store's storey count, at
 *   {@link CAMERA_FOV_DEGREES} and the live aspect ratio of the canvas.
 */
export function useExteriorFraming(): ExteriorFraming {
  const { width, height } = useThree((state) => state.size);
  const floorCount = useFloorCountStore((state) => state.floorCount);

  return useMemo(
    () =>
      getExteriorFraming(
        PLOT_RECT,
        FLOOR_HEIGHTS,
        CAMERA_FOV_DEGREES,
        height > 0 ? width / height : FALLBACK_ASPECT,
        floorCount,
      ),
    [width, height, floorCount],
  );
}
