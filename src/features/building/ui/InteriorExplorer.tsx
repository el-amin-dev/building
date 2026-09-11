import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useViewStore } from '../application/viewStore.ts';
import { createInitialEyePose } from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import type { CameraRoomBox } from '../domain/thirdPersonCamera.ts';
import { EyeCameraControls } from './EyeCameraControls.tsx';
import { PersonModel } from './PersonModel.tsx';

/** Props of {@link InteriorExplorer}. */
export interface InteriorExplorerProps {
  /**
   * Focusable element whose key presses drive the person. It must already be mounted
   * when this component mounts (see `usePressedKeys`).
   */
  readonly targetRef: RefObject<HTMLElement | null>;
  /** Walkable rectangle for the person's position, already shrunk by the body radius. */
  readonly bounds: PlanRect;
  /** The box the third-person camera stays inside (see `createCameraRoomBox`). */
  readonly roomBox: CameraRoomBox;
}

/**
 * The explorer inside the chamber: the person's pose, the interior camera and the person model.
 *
 * Rendered inside the canvas only while the interior view is active. It owns the pose,
 * created with `createInitialEyePose(bounds)` once per mount, so every entry into the
 * interior view starts in the (maxX, maxZ) corner of the walkable bounds, looking toward
 * the opposite corner. Switching between first and third person (`interiorCameraMode` in
 * the view store) keeps the pose.
 *
 * @param props - {@link InteriorExplorerProps}
 * @returns The interior camera controls and the person model.
 */
export function InteriorExplorer({ targetRef, bounds, roomBox }: InteriorExplorerProps) {
  const cameraMode = useViewStore((state) => state.interiorCameraMode);
  const [initialPose] = useState(() => createInitialEyePose(bounds));
  const poseRef = useRef<EyePose>(initialPose);

  return (
    <>
      <EyeCameraControls
        targetRef={targetRef}
        bounds={bounds}
        poseRef={poseRef}
        cameraMode={cameraMode}
        roomBox={roomBox}
      />
      <PersonModel poseRef={poseRef} roomBox={roomBox} cameraMode={cameraMode} />
    </>
  );
}
