import { create } from 'zustand';
import { LENGTH_TOLERANCE } from '../domain/planGeometry.ts';
import type { OrbitPose } from '../domain/orbitNavigation.ts';

/**
 * Tolerance for comparing two orbit angles, in radians.
 *
 * Matched to {@link LENGTH_TOLERANCE} rather than picked on its own: at the distances the
 * exterior camera actually sits from the building — tens of metres — an angle of `1e-9`
 * radians swings the camera by less than a nanometre of arc, so the angular and the linear
 * comparison call the same physical movement negligible. It sits far below any real
 * movement (the slowest key-hold step turns the azimuth by about `0.017` radians in one
 * frame, and a pointer drag of a single pixel by more still) and far above the
 * floating-point noise of a pose read off the camera and written back, so a frame that
 * moved nothing is recognised as such and a frame that moved anything is not.
 */
const ANGLE_TOLERANCE = 1e-9;

/**
 * Tells whether two poses are the same view, within tolerance.
 *
 * The azimuths are compared as the numbers given. Every pose reaching this store comes
 * from `getOrbitPose`/`clampOrbitPose`, which wrap the azimuth into (−π, π], so two poses
 * of the same heading are also numerically close; an unwrapped azimuth would merely be
 * stored again, which loses no angle.
 */
function isSameOrbitPose(left: OrbitPose, right: OrbitPose): boolean {
  return (
    Math.abs(left.azimuth - right.azimuth) <= ANGLE_TOLERANCE &&
    Math.abs(left.polar - right.polar) <= ANGLE_TOLERANCE &&
    Math.abs(left.distance - right.distance) <= LENGTH_TOLERANCE
  );
}

/** State and actions of the remembered exterior orbit pose. */
export interface ExteriorOrbitState {
  /** The last orbit pose of the exterior view; `undefined` until the view is first framed. */
  readonly orbitPose: OrbitPose | undefined;
  /** Remembers where the exterior camera is. Remembering the same pose changes nothing. */
  readonly rememberOrbitPose: (pose: OrbitPose) => void;
  /** Forgets the remembered pose, so the next entry reframes from the exterior framing default. */
  readonly resetOrbitPose: () => void;
}

/**
 * Global store holding the orbit pose the exterior view was last left at, so that stepping
 * inside the building and coming back out returns the camera to the angle the viewer chose
 * instead of snapping to the default three-quarter frame.
 *
 * It has to be a store rather than a ref: the exterior camera controls are one side of a
 * ternary in `BuildingScene`, so they unmount on every view change and anything they held
 * dies with them. It holds a pose — a target-relative `azimuth`/`polar`/`distance` — and
 * not a camera position, because the framing target is re-derived per canvas size: an
 * angle survives a resize where a raw position would not, and the pose is already the shape
 * the per-frame stepper wants, so nothing is converted twice.
 *
 * A pose is copied in and frozen, so the camera-owned object it was read off can go on
 * being reused. Every update that changes nothing returns the previous state unchanged, so
 * a frame that moved the camera nowhere notifies no subscriber.
 *
 * @returns A React hook selecting from {@link ExteriorOrbitState}.
 */
export const useExteriorOrbitStore = create<ExteriorOrbitState>()((set) => ({
  orbitPose: undefined,
  rememberOrbitPose: (pose) =>
    set((state) =>
      state.orbitPose !== undefined && isSameOrbitPose(state.orbitPose, pose)
        ? state
        : {
            orbitPose: Object.freeze({
              azimuth: pose.azimuth,
              polar: pose.polar,
              distance: pose.distance,
            }),
          },
    ),
  resetOrbitPose: () =>
    set((state) => (state.orbitPose === undefined ? state : { orbitPose: undefined })),
}));

/**
 * Reads the remembered exterior orbit pose without subscribing to it.
 *
 * A published seam, not an internal: the frame loop reads it every frame — subscribing at
 * 60 fps would re-render the scene for its own camera movement, the same reason
 * `EyeCameraControls` reads `useRemoteControlStore.getState()` inside `useFrame` — and the
 * exterior↔interior camera transition reads it as its exterior endpoint.
 *
 * @returns The pose last remembered, or `undefined` before the exterior view is first framed.
 */
export function getRememberedOrbitPose(): OrbitPose | undefined {
  return useExteriorOrbitStore.getState().orbitPose;
}
