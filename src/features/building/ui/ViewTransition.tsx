import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Vector3 } from 'three';
import type { Camera } from 'three';
import { getRememberedOrbitPose } from '../application/exteriorOrbitStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { CameraTransition } from '../application/viewStore.ts';
import type { ExteriorFraming, Vector3Like } from '../domain/exteriorFraming.ts';
import {
  clampOrbitPose,
  getOrbitLimits,
  getOrbitPose,
  getOrbitPosition,
} from '../domain/orbitNavigation.ts';
import { getThirdPersonCamera } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import {
  getEyeCameraPose,
  getTransitionPose,
  VIEW_TRANSITION_SECONDS,
} from '../domain/viewTransition.ts';
import type { CameraPose } from '../domain/viewTransition.ts';
import { CAMERA_FIELD, INTERIOR_START_POSE } from './floorInstance.ts';
import { useExteriorFraming } from './useExteriorFraming.ts';

/** A transition that is actually travelling: the phase with `'none'` taken out. */
type RunningTransition = Exclude<CameraTransition, 'none'>;

/** The travel in progress, kept in a ref so no frame of it re-renders React. */
interface CameraTween {
  /** The phase this travel belongs to; a change of phase starts a new travel. */
  readonly phase: RunningTransition;
  /** Where the camera was when the travel started, read off the camera itself. */
  readonly from: CameraPose;
  /** Where it is going. */
  readonly to: CameraPose;
  /** Seconds of travel elapsed. */
  elapsed: number;
  /** Whether the arrival has already been reported, so it is reported exactly once. */
  hasEnded: boolean;
}

/** The travel parameter at the end of the tween. */
const TWEEN_END = 1;
/** No time elapsed yet: the first frame of a travel applies the start pose unchanged. */
const NO_TIME_ELAPSED = 0;
/**
 * Shortest distance the start look-at target is put at, in metres.
 *
 * The start target lies along the camera's own view direction, so any positive
 * distance gives the orientation the camera already has; the distance only shapes
 * the path the target takes. A camera standing on its destination target would
 * otherwise be given a target at zero distance, which has no direction at all.
 */
const MIN_LOOK_AHEAD_METRES = 1;

/**
 * Animates the camera between the exterior and the interior view.
 *
 * Mounted inside the `<Canvas>` for the whole life of the scene and doing **nothing
 * whatsoever** while `cameraTransition` is `'none'`: it neither reads nor writes the
 * camera then, so the mounted control of the current view is the only thing driving
 * it. When a phase starts it captures the travel, then every frame accumulates
 * `delta`, eases the position and the look-at target from the start pose to the
 * endpoint (`domain/viewTransition.ts`) and writes them to the default camera. At
 * `t = 1` it reports the arrival once with `endCameraTransition()` and holds the
 * endpoint until the phase clears. It never sets a final orientation of its own —
 * `lookAt` from the interpolated pair is the orientation.
 *
 * **The start pose is read off the live camera**, not recomputed: whatever the
 * control that was mounted a moment ago left behind is exactly where the travel
 * begins, so there is no jump on the first frame however the previous view was left.
 *
 * **The hand-off contract, which is the whole reason this works: the tween's
 * endpoint expression and the mounting control's placement expression must be the
 * same expression.** Concretely:
 *
 * - `toExterior` ends at
 *   `getOrbitPosition(framing.target, clampOrbitPose(getRememberedOrbitPose() ??
 *   getOrbitPose(framing.target, framing.position), getOrbitLimits(framing)))`,
 *   looking at `framing.target`: the remembered orbit pose when the viewer has
 *   framed the exterior before and the framing default otherwise, clamped into
 *   the limits of the live framing. That is the exterior controls' own placement
 *   expression, character for character, so their placement is a no-op after the
 *   travel instead of a snap — including after a resize, which can leave a
 *   remembered distance outside the new limits;
 * - `toInterior` ends at `getEyeCameraPose(INTERIOR_START_POSE)` in first person or
 *   at `getThirdPersonCamera(INTERIOR_START_POSE, CAMERA_FIELD)` in third person,
 *   both derived from the *shared* start pose (`floorInstance.ts`), which is the
 *   same object the interior explorer starts from — not an equal copy of it.
 *
 * Anything that breaks that symmetry shows up as a jump at the moment the controls
 * take over, which is precisely what this component exists to remove.
 *
 * The store is read with the non-reactive `getState()` inside the frame callback,
 * following `EyeCameraControls`: subscribing to a phase that is consulted sixty
 * times a second would re-render the scene for the camera's own movement. The
 * framing comes from `useExteriorFraming()`, which must be called inside the
 * `<Canvas>` — this component is.
 *
 * The `data-camera-transition` attribute the e2e gate reads is deliberately NOT
 * rendered here: it belongs on the view region, which the scene owner stamps from
 * the store's `cameraTransition`.
 *
 * @returns Nothing; it only drives the camera.
 */
export function ViewTransition() {
  const framing = useExteriorFraming();
  const tweenRef = useRef<CameraTween | null>(null);

  useFrame((state, delta) => {
    const { cameraTransition, interiorCameraMode, endCameraTransition } = useViewStore.getState();
    if (cameraTransition === 'none') {
      tweenRef.current = null;
      return;
    }

    const { camera } = state;
    const tween = getTween(tweenRef, cameraTransition, camera, interiorCameraMode, framing, delta);
    const progress = Math.min(TWEEN_END, tween.elapsed / VIEW_TRANSITION_SECONDS);
    const { position, target } = getTransitionPose(tween.from, tween.to, progress);

    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(target.x, target.y, target.z);

    if (progress === TWEEN_END && !tween.hasEnded) {
      tween.hasEnded = true;
      endCameraTransition();
    }
  });

  return null;
}

/**
 * The travel of this frame: the one in progress, advanced, or a fresh one.
 *
 * A fresh travel is started whenever there is none or the phase has changed, and it
 * starts with no elapsed time, so the frame that starts it applies the start pose
 * unchanged and the camera cannot jump. Time stops accumulating once the arrival has
 * been reported, so the endpoint is simply held until the phase clears.
 *
 * @param tweenRef - Where the travel is kept between frames; replaced on a new one.
 * @param phase - The phase the store reports this frame.
 * @param camera - The default camera, read for the start pose.
 * @param cameraMode - Interior camera mode, which picks the interior endpoint.
 * @param framing - The exterior framing at the live canvas size.
 * @param delta - Seconds since the previous frame.
 * @returns The travel to apply this frame.
 */
function getTween(
  tweenRef: { current: CameraTween | null },
  phase: RunningTransition,
  camera: Camera,
  cameraMode: InteriorCameraMode,
  framing: ExteriorFraming,
  delta: number,
): CameraTween {
  const running = tweenRef.current;
  if (running !== null && running.phase === phase) {
    if (!running.hasEnded) {
      running.elapsed += delta;
    }
    return running;
  }

  const to = phase === 'toInterior' ? getInteriorEndPose(cameraMode) : getExteriorEndPose(framing);
  const started: CameraTween = {
    phase,
    from: readCameraPose(camera, to.target),
    to,
    elapsed: NO_TIME_ELAPSED,
    hasEnded: false,
  };
  tweenRef.current = started;
  return started;
}

/**
 * Where the camera is now, as a transition endpoint.
 *
 * The position is the camera's own. The look-at target is put along the camera's
 * current view direction at the distance the destination target sits at, so the
 * target swings toward the destination rather than rushing in or out; any positive
 * distance would reproduce the current orientation (see {@link MIN_LOOK_AHEAD_METRES}).
 *
 * @param camera - The camera to read. Not mutated.
 * @param endTarget - The target the travel ends at, which sets the look distance.
 * @returns A fresh pose matching the camera's current position and orientation.
 */
function readCameraPose(camera: Camera, endTarget: Vector3Like): CameraPose {
  const position: Vector3Like = {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
  };
  const forward = camera.getWorldDirection(new Vector3());
  const distance = Math.max(
    MIN_LOOK_AHEAD_METRES,
    Math.hypot(endTarget.x - position.x, endTarget.y - position.y, endTarget.z - position.z),
  );

  return {
    position,
    target: {
      x: position.x + forward.x * distance,
      y: position.y + forward.y * distance,
      z: position.z + forward.z * distance,
    },
  };
}

/**
 * The interior endpoint: the camera as the interior controls will place it.
 *
 * @param cameraMode - Whether the interior camera looks through the eyes or follows.
 * @returns The first-person eye pose, or the follow camera behind the person.
 */
function getInteriorEndPose(cameraMode: InteriorCameraMode): CameraPose {
  if (cameraMode === 'thirdPerson') {
    return getThirdPersonCamera(INTERIOR_START_POSE, CAMERA_FIELD);
  }
  return getEyeCameraPose(INTERIOR_START_POSE);
}

/**
 * The exterior endpoint: the remembered orbit pose when there is one, else the
 * framing default, brought inside the limits of the live framing. This expression
 * is the hand-off contract (see {@link ViewTransition}) and must stay identical to
 * the exterior controls'.
 *
 * The clamp is the reason the whole expression is written out rather than
 * shortcut to `framing.position` when nothing is remembered: a pose remembered at
 * one canvas size can be illegal at another — resize the window while inside and
 * `maxDistance` shrinks — and the mounting controls place the camera at the
 * *clamped* pose. Landing at the unclamped one would be a visible snap at the
 * very moment the controls take over.
 *
 * @param framing - The exterior framing at the live canvas size.
 * @returns The camera pose the exterior view will be framed at.
 */
function getExteriorEndPose(framing: ExteriorFraming): CameraPose {
  const framingPose = getOrbitPose(framing.target, framing.position);
  const remembered = getRememberedOrbitPose();
  const pose = clampOrbitPose(remembered ?? framingPose, getOrbitLimits(framing));

  return { position: getOrbitPosition(framing.target, pose), target: framing.target };
}
