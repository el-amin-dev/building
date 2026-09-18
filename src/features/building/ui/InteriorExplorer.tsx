import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { placeInStack } from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { ExplorerPoseReporter } from './ExplorerPoseReporter.tsx';
import { EyeCameraControls } from './EyeCameraControls.tsx';
import {
  CAMERA_FIELD,
  getCameraFields,
  getWalkSurfaces,
  INTERIOR_START_POSE,
} from './floorInstance.ts';
import { PersonModel } from './PersonModel.tsx';

/** Props of {@link InteriorExplorer}. */
export interface InteriorExplorerProps {
  /**
   * Focusable element whose key presses drive the person. It must already be mounted
   * when this component mounts (see `usePressedKeys`).
   */
  readonly targetRef: RefObject<HTMLElement | null>;
}

/**
 * The explorer inside the building: the person's pose, the interior camera, the person model
 * and the pose reporter.
 *
 * Rendered inside the canvas only while the interior view is active. It owns the pose, which
 * starts at {@link INTERIOR_START_POSE} — the stairs arrival, because entry to the floor is
 * through the stairs (ADR-006) — so every entry into the interior view begins where the
 * viewer walked in. That pose is a frozen object shared with the exterior→interior camera
 * transition, so the two cannot land in different places; the ref is initialised from it on
 * mount, which is what makes a remount start over rather than resume. Switching between first
 * and third person (`interiorCameraMode` in the view store) keeps the pose.
 *
 * The walking surfaces and the camera fields are handed down as props rather than imported by
 * the children: the children stay unit-testable against a small synthetic surface, while the
 * live floor is derived exactly once (`floorInstance.ts`) and shared by identity. One entry per
 * storey, so the frame loop can index the storey the pose stands on without deriving anything.
 *
 * ## The storey count, and what a reduction does to the viewer
 *
 * The count is the one thing here that IS subscribed to: it changes a handful of times in a
 * session — never per frame — and it decides how tall the lists handed down are. Adding
 * storeys never moves anybody. Taking them away below the viewer does: the owner's rule is
 * that you land on the new top storey keeping your plan position, or back at the arrival if
 * you were caught mid-flight, which is exactly what `placeInStack` answers. It is applied in
 * an effect keyed on the count, so the pose is rewritten **once** per change rather than once
 * per render, and a pose already inside the stack is returned by identity and left alone.
 *
 * It owns `poseRef`, so it is also where `ExplorerPoseReporter` is mounted — the reporter
 * pushes that same pose out to the HUD once per frame, after the controls have stepped it.
 *
 * It also releases every action held on the on-screen `RemoteControl` when it unmounts
 * (leaving the interior view) and whenever the camera mode changes: the pad can outlive
 * both, and a held action nobody can release any more would keep the person walking or
 * spinning forever.
 *
 * @param props - {@link InteriorExplorerProps}
 * @returns The interior camera controls, the person model and the pose reporter.
 */
export function InteriorExplorer({ targetRef }: InteriorExplorerProps) {
  const cameraMode = useViewStore((state) => state.interiorCameraMode);
  const floorCount = useFloorCountStore((state) => state.floorCount);
  const releaseAllActions = useRemoteControlStore((state) => state.releaseAllActions);
  const poseRef = useRef<EyePose>(INTERIOR_START_POSE);

  useEffect(() => {
    poseRef.current = placeInStack(poseRef.current, floorCount, INTERIOR_START_POSE);
  }, [floorCount]);

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
        poseRef={poseRef}
        cameraMode={cameraMode}
        surfaces={getWalkSurfaces(floorCount)}
        cameraFields={getCameraFields(floorCount)}
      />
      <PersonModel poseRef={poseRef} field={CAMERA_FIELD} cameraMode={cameraMode} />
      <ExplorerPoseReporter poseRef={poseRef} />
    </>
  );
}
