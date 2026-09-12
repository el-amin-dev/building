import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';

/** Runs at default priority, after the pose step at −1, so it reports the pose of this frame. */
const POSE_REPORT_PRIORITY = 0;

/** What the reporter needs: the ref the camera controls write the stepped pose into. */
export interface ExplorerPoseReporterProps {
  /** The pose of the current frame, written by the camera controls before this runs. */
  readonly poseRef: RefObject<EyePose>;
}

/**
 * Feeds the per-frame eye pose into the explorer pose store, and renders nothing.
 *
 * A component rather than a few lines inside the camera controls: the controls own the
 * pose and the camera, and pushing the pose out to the rest of the app is a separate
 * concern that can be mounted, unmounted and tested on its own. It reports at the default
 * `useFrame` priority, so it always sees the pose the controls stepped at priority −1 in
 * the same frame rather than the previous one. Leaving the interior unmounts it, and its
 * cleanup clears the store, so the HUD does not keep announcing a room nobody is in.
 *
 * @param props - See {@link ExplorerPoseReporterProps}.
 * @returns `null`: the component is a frame-loop subscription, not markup.
 */
export function ExplorerPoseReporter({ poseRef }: ExplorerPoseReporterProps) {
  const reportPose = useExplorerPoseStore((state) => state.reportPose);
  const clearPose = useExplorerPoseStore((state) => state.clearPose);

  useFrame(() => {
    reportPose(poseRef.current);
  }, POSE_REPORT_PRIORITY);

  useEffect(
    () => () => {
      clearPose();
    },
    [clearPose],
  );

  return null;
}
