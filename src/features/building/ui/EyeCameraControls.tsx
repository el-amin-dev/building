import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EulerOrder } from 'three';
import {
  createInitialEyePose,
  getMovementIntent,
  isEyeNavigationKey,
  stepEyePose,
} from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
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
}

/**
 * Per-frame eye-level camera of the interior view.
 *
 * Every frame it reads the navigation keys held on `targetRef`, advances the eye pose
 * with `stepEyePose` and places the default camera at `FLOOR_HEIGHTS.eye` with Euler
 * order `YXZ` and rotation `(pitch, yaw, 0)`. The pose lives in a ref, so moving never
 * re-renders React.
 *
 * The pose starts from `createInitialEyePose(bounds)` each time this component mounts.
 * Every entry into the interior view therefore starts in the (maxX, maxZ) corner of the
 * walkable bounds, looking toward the opposite corner. The starting pose is computed
 * once per mount, not on every render.
 *
 * @param props - {@link EyeCameraControlsProps}
 * @returns Nothing; it only drives the camera.
 */
export function EyeCameraControls({ targetRef, bounds }: EyeCameraControlsProps) {
  const pressedKeys = usePressedKeys(targetRef, isEyeNavigationKey);
  const [initialPose] = useState(() => createInitialEyePose(bounds));
  const poseRef = useRef<EyePose>(initialPose);

  useFrame((state, delta) => {
    const pose = stepEyePose(
      poseRef.current,
      getMovementIntent(pressedKeys.current),
      delta,
      bounds,
    );
    poseRef.current = pose;
    state.camera.position.set(pose.x, FLOOR_HEIGHTS.eye, pose.z);
    state.camera.rotation.set(pose.pitch, pose.yaw, NO_ROLL, EYE_EULER_ORDER);
  });

  return null;
}
