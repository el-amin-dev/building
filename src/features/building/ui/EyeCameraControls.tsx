import { useFrame } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { EulerOrder } from 'three';
import { getMovementIntent, isEyeNavigationKey, stepEyePose } from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { getThirdPersonCamera } from '../domain/thirdPersonCamera.ts';
import type { CameraRoomBox } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import { usePressedKeys } from './usePressedKeys.ts';

/** Yaw first, then pitch: the order `stepEyePose` angles are defined in. */
const EYE_EULER_ORDER: EulerOrder = 'YXZ';
const NO_ROLL = 0;

/** Props of {@link EyeCameraControls}. */
export interface EyeCameraControlsProps {
  /**
   * Focusable element whose key presses drive the camera. It must already be mounted
   * when this component mounts (see `usePressedKeys`).
   */
  readonly targetRef: RefObject<HTMLElement | null>;
  /** Walkable rectangle for the eye position, already shrunk by the body radius. */
  readonly bounds: PlanRect;
  /**
   * The person's pose, owned by the parent. Replaced by the stepped pose every frame, so
   * the person model and a camera mode switch share one pose.
   */
  readonly poseRef: RefObject<EyePose>;
  /** Whether the camera looks through the person's eyes or follows from behind. */
  readonly cameraMode: InteriorCameraMode;
  /** The box the third-person camera stays inside (see `createCameraRoomBox`). */
  readonly roomBox: CameraRoomBox;
}

/**
 * Per-frame camera of the interior view, in first or third person.
 *
 * Every frame it reads the navigation keys held on `targetRef`, advances the pose in
 * `poseRef` once with `stepEyePose` and writes it back. Then it places the default camera:
 *
 * - first person: at `PERSON_SPEC.eyeHeight` above the pose, with Euler order `YXZ` and
 *   rotation `(pitch, yaw, 0)`;
 * - third person: at the position given by `getThirdPersonCamera(pose, roomBox)`, looking
 *   at its target (the head); the camera is pulled in when a wall, the floor or the
 *   ceiling is closer than the follow distance.
 *
 * The pose lives in a ref owned by the parent, so moving never re-renders React and
 * switching `cameraMode` keeps the pose.
 *
 * @param props - {@link EyeCameraControlsProps}
 * @returns Nothing; it only drives the camera.
 */
export function EyeCameraControls({
  targetRef,
  bounds,
  poseRef,
  cameraMode,
  roomBox,
}: EyeCameraControlsProps) {
  const pressedKeys = usePressedKeys(targetRef, isEyeNavigationKey);

  useFrame((state, delta) => {
    const pose = stepEyePose(
      poseRef.current,
      getMovementIntent(pressedKeys.current),
      delta,
      bounds,
    );
    poseRef.current = pose;

    const { camera } = state;
    if (cameraMode === 'thirdPerson') {
      const { position, target } = getThirdPersonCamera(pose, roomBox);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target.x, target.y, target.z);
      return;
    }
    camera.position.set(pose.x, PERSON_SPEC.eyeHeight, pose.z);
    camera.rotation.set(pose.pitch, pose.yaw, NO_ROLL, EYE_EULER_ORDER);
  });

  return null;
}
