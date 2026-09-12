import { useFrame } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { EulerOrder } from 'three';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import type { WalkField } from '../domain/collision.ts';
import { getMovementIntent, isEyeNavigationKey, stepEyePose } from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import { hasAnyInput } from '../domain/routeFollower.ts';
import { getThirdPersonCamera } from '../domain/thirdPersonCamera.ts';
import type { CameraField } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import { usePressedKeys } from './usePressedKeys.ts';
import { useRouteFollower } from './useRouteFollower.ts';

/** Yaw first, then pitch: the order `stepEyePose` angles are defined in. */
const EYE_EULER_ORDER: EulerOrder = 'YXZ';
const NO_ROLL = 0;
/**
 * Runs before default-priority (0) frame callbacks, so the pose is stepped before
 * `PersonModel` reads it and `ExplorerPoseReporter` reports it in the same frame, whatever the
 * JSX order. A negative priority keeps R3F's automatic rendering (only a positive one takes
 * over the render loop).
 */
const POSE_STEP_FRAME_PRIORITY = -1;

/** Props of {@link EyeCameraControls}. */
export interface EyeCameraControlsProps {
  /**
   * Focusable element whose key presses drive the camera. It must already be mounted
   * when this component mounts (see `usePressedKeys`).
   */
  readonly targetRef: RefObject<HTMLElement | null>;
  /** Where a body may stand and what stops it (see `getWalkField`). */
  readonly field: WalkField;
  /**
   * The person's pose, owned by the parent. Replaced by the stepped pose every frame, so
   * the person model and a camera mode switch share one pose.
   */
  readonly poseRef: RefObject<EyePose>;
  /** Whether the camera looks through the person's eyes or follows from behind. */
  readonly cameraMode: InteriorCameraMode;
  /** Where the third-person camera may go (see `createCameraField`). */
  readonly cameraField: CameraField;
}

/**
 * Per-frame camera of the interior view, in first or third person.
 *
 * Every frame it collects the movement intent, advances the pose in `poseRef` once with
 * `stepEyePose` and writes the stepped pose back. Then it places the default camera:
 *
 * - first person: at `PERSON_SPEC.eyeHeight` above the pose, with Euler order `YXZ` and
 *   rotation `(pitch, yaw, 0)`;
 * - third person: at the position given by `getThirdPersonCamera(pose, cameraField)`, looking
 *   at its target (the head); the camera is pulled in when a wall, the floor or the
 *   ceiling is closer than the follow distance, and rises above the person when a wall
 *   close behind leaves too little room to see the body.
 *
 * ## One intent, three sources, one winner
 *
 * Three inputs can ask for movement: the navigation keys held on `targetRef`, the actions held
 * on the on-screen `RemoteControl`, and the automatic walk to a room followed by
 * `useRouteFollower`. The first two are the viewer's own hands and are merged into one manual
 * intent by `getMovementIntent`; the walk is only consulted when that manual intent asks for
 * nothing at all. **Manual input wins, and cancels the walk** — the viewer taking the controls
 * back ends the trip rather than fighting it for the body.
 *
 * Cancelling is conditioned on the walk store being anything other than `idle`, not on a walk
 * still running, and that is deliberate: it is also what clears a finished `unreachable` or
 * `blocked` readout the moment the viewer moves again. Nothing else can clear it, because
 * nothing else knows the viewer has moved on.
 *
 * ## Why nothing here subscribes
 *
 * The pose lives in a ref owned by the parent, so moving never re-renders React and switching
 * `cameraMode` keeps the pose. The remote control and the walk store are read with their
 * non-reactive `getState()` rather than with a hook, for the same reason: state consulted sixty
 * times a second must not subscribe this component and re-render the scene sixty times a second
 * (ADR-004, ADR-007). The frame callback runs with a negative priority, before the person
 * model's and the pose reporter's, so everything in a frame uses the same stepped pose.
 *
 * @param props - {@link EyeCameraControlsProps}
 * @returns Nothing; it only drives the camera.
 */
export function EyeCameraControls({
  targetRef,
  field,
  poseRef,
  cameraMode,
  cameraField,
}: EyeCameraControlsProps) {
  const pressedKeys = usePressedKeys(targetRef, isEyeNavigationKey);
  const advanceWalk = useRouteFollower();

  useFrame((state, delta) => {
    const { activeActions } = useRemoteControlStore.getState();
    const manual = getMovementIntent(pressedKeys.current, activeActions);
    const auto = advanceWalk(poseRef.current, delta);
    const isManual = hasAnyInput(manual);

    const walk = useRoomWalkStore.getState();
    if (isManual && walk.status !== 'idle') {
      walk.cancelWalk();
    }

    const intent = isManual ? manual : (auto ?? manual);
    const step = stepEyePose(poseRef.current, intent, delta, field);
    poseRef.current = step.pose;

    const { camera } = state;
    if (cameraMode === 'thirdPerson') {
      const { position, target } = getThirdPersonCamera(step.pose, cameraField);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target.x, target.y, target.z);
      return;
    }
    camera.position.set(step.pose.x, PERSON_SPEC.eyeHeight, step.pose.z);
    camera.rotation.set(step.pose.pitch, step.pose.yaw, NO_ROLL, EYE_EULER_ORDER);
  }, POSE_STEP_FRAME_PRIORITY);

  return null;
}
