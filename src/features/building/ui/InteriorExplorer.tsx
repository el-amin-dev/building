import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { createRoomCentrePose } from '../domain/eyeNavigation.ts';
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
 * The explorer inside the building: the person's pose, the interior camera and the person model.
 *
 * Rendered inside the canvas only while the interior view is active. It owns the pose,
 * created with `createRoomCentrePose(bounds)` once per mount, so every entry into the
 * interior view starts in the centre of the walkable bounds, looking along their longer
 * axis: the third-person camera then has its full follow distance of free floor behind the
 * person, which a corner start denied it. Switching between first and third person
 * (`interiorCameraMode` in the view store) keeps the pose.
 *
 * It also releases every action held on the on-screen `RemoteControl` when it unmounts
 * (leaving the interior view) and whenever the camera mode changes: the pad can outlive
 * both, and a held action nobody can release any more would keep the person walking or
 * spinning forever.
 *
 * @param props - {@link InteriorExplorerProps}
 * @returns The interior camera controls and the person model.
 */
export function InteriorExplorer({ targetRef, bounds, roomBox }: InteriorExplorerProps) {
  const cameraMode = useViewStore((state) => state.interiorCameraMode);
  const releaseAllActions = useRemoteControlStore((state) => state.releaseAllActions);
  const [initialPose] = useState(() => createRoomCentrePose(bounds));
  const poseRef = useRef<EyePose>(initialPose);

  useEffect(
    () => () => {
      releaseAllActions();
    },
    [releaseAllActions, cameraMode],
  );

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
