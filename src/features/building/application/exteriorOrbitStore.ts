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
  /**
   * How many storeys the stack had when {@link ExteriorOrbitState.orbitPose} was framed;
   * `undefined` while no pose is remembered.
   *
   * Kept beside the pose rather than in the controls, because it is the controls that
   * unmount: see {@link getPlacementOrbitPose} for what it is compared against.
   */
  readonly framedStoreyCount: number | undefined;
  /**
   * Remembers where the exterior camera is, and how many storeys it was framed for.
   * Remembering the same pose at the same count changes nothing.
   */
  readonly rememberOrbitPose: (pose: OrbitPose, storeyCount: number) => void;
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
 * It remembers the storey count beside the pose for the same reason it is a store at all:
 * a distance is only a framing of the building it was chosen for, and the count can change
 * from the *interior* view, with the exterior controls unmounted. Anything they held about
 * the count — a `useRef`, which re-seeds at the next mount — therefore comes back already
 * agreeing with a count it never framed anything for. See {@link getPlacementOrbitPose}.
 *
 * A pose is copied in and frozen, so the camera-owned object it was read off can go on
 * being reused. Every update that changes nothing returns the previous state unchanged, so
 * a frame that moved the camera nowhere notifies no subscriber.
 *
 * @returns A React hook selecting from {@link ExteriorOrbitState}.
 */
export const useExteriorOrbitStore = create<ExteriorOrbitState>()((set) => ({
  orbitPose: undefined,
  framedStoreyCount: undefined,
  rememberOrbitPose: (pose, storeyCount) =>
    set((state) =>
      state.orbitPose !== undefined &&
      state.framedStoreyCount === storeyCount &&
      isSameOrbitPose(state.orbitPose, pose)
        ? state
        : {
            orbitPose: Object.freeze({
              azimuth: pose.azimuth,
              polar: pose.polar,
              distance: pose.distance,
            }),
            framedStoreyCount: storeyCount,
          },
    ),
}));

/**
 * The orbit pose the exterior camera is to be placed at, for a freshly derived framing.
 *
 * The one place the placement rule lives, read without subscribing: the frame loop and the
 * camera transition consult it outside React's render, and subscribing at 60 fps would
 * re-render the scene for the camera's own movement — the same reason `EyeCameraControls`
 * reads `useRemoteControlStore.getState()` inside `useFrame`.
 *
 * The rule, in order:
 *
 * - nothing remembered yet — the first mount of a session — gives `framingPose`, so the
 *   view opens on the framing's own three-quarter frame;
 * - a pose remembered for this same storey count gives that pose unchanged: it *is* the
 *   viewer's own angle, and a resize must not take it away (the same building, a
 *   differently shaped window onto it);
 * - a pose remembered for a *different* count keeps its `azimuth` and `polar` and takes
 *   the `distance` from `framingPose`. Adding storeys changes the subject: the building
 *   can end up eleven times taller, and a distance chosen for one storey leaves most of a
 *   ten-storey stack out of frame — near enough to the middle of the clamp range that
 *   `clampOrbitPose` does not rescue it either.
 *
 * The result is *not* clamped: the caller holds the limits of its own framing and clamps
 * with them, which is also what brings a distance remembered at another canvas size back
 * inside the live one.
 *
 * @param framingPose - The pose the live framing would place the camera at on its own.
 * @param storeyCount - How many storeys the stack shows now.
 * @returns The pose to place the camera at, before clamping.
 */
export function getPlacementOrbitPose(framingPose: OrbitPose, storeyCount: number): OrbitPose {
  const { orbitPose, framedStoreyCount } = useExteriorOrbitStore.getState();
  if (orbitPose === undefined) {
    return framingPose;
  }
  if (framedStoreyCount !== storeyCount) {
    return { azimuth: orbitPose.azimuth, polar: orbitPose.polar, distance: framingPose.distance };
  }
  return orbitPose;
}
