import { useFrame } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { EulerOrder } from 'three';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import {
  getEyeLevel,
  getMovementIntent,
  isEyeNavigationKey,
  stepEyePose,
} from '../domain/eyeNavigation.ts';
import type { EyeAction, EyePose, WalkSurface } from '../domain/eyeNavigation.ts';
import { MIN_FLOOR_COUNT } from '../domain/storeys.ts';
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

/** Index of the lowest storey in a per-storey list: floor `MIN_FLOOR_COUNT` is the first entry. */
const FIRST_STOREY_INDEX = 0;

/** How far back from the end of a list its last entry sits. */
const LAST_INDEX_OFFSET = 1;

/** Props of {@link EyeCameraControls}. */
export interface EyeCameraControlsProps {
  /**
   * Focusable element whose key presses drive the camera. It must already be mounted
   * when this component mounts (see `usePressedKeys`).
   */
  readonly targetRef: RefObject<HTMLElement | null>;
  /**
   * The person's pose, owned by the parent. Replaced by the stepped pose every frame, so
   * the person model and a camera mode switch share one pose.
   */
  readonly poseRef: RefObject<EyePose>;
  /** Whether the camera looks through the person's eyes or follows from behind. */
  readonly cameraMode: InteriorCameraMode;
  /**
   * What each storey of the stack offers underfoot, lowest first (see
   * `getWalkSurfaces`). One entry per storey: the walker's own storey is indexed
   * out of it every frame.
   */
  readonly surfaces: readonly WalkSurface[];
  /** Where the third-person camera may go on each storey, lowest first (see `getCameraFields`). */
  readonly cameraFields: readonly CameraField[];
}

/**
 * Per-frame camera of the interior view, in first or third person.
 *
 * Every frame it collects the movement intent, advances the pose in `poseRef` once with
 * `stepEyePose` and writes the stepped pose back. Then it places the default camera:
 *
 * - first person: at `getEyeLevel(pose)` — the pose's own storey level plus the rise it
 *   stands at plus the eye height, never the eye height alone, or the viewer on the third
 *   storey would look out of the first — with Euler order `YXZ` and rotation `(pitch, yaw, 0)`;
 * - third person: at the position given by `getThirdPersonCamera(pose, cameraField)`, looking
 *   at its target (the head); the camera is pulled in when a wall, the floor or the
 *   ceiling is closer than the follow distance, and rises above the person when a wall
 *   close behind leaves too little room to see the body.
 *
 * ## One surface per storey, indexed by the pose
 *
 * The walker's storey is not a prop: it lives in the pose, which the frame loop owns, so the
 * surface and the camera field are indexed out of `surfaces` and `cameraFields` by
 * `pose.floor` every frame (see {@link atFloor}). That is also what re-indexes them the frame
 * after a step reports `storeyChanged` — the step's own pose carries the new storey, and the
 * camera is placed with that storey's field in the very same frame.
 *
 * The index is **clamped** into the list rather than trusted. The lists are handed down from a
 * store the viewer steps, and a pose is a ref: reducing the count re-renders the parent, but
 * the pose it relocates is only read on the next frame, so for one frame a pose may name a
 * storey the new stack no longer has. Clamping walks that frame on the top storey instead of
 * throwing inside the render loop.
 *
 * ## One intent, three sources, one winner
 *
 * Three inputs can ask for movement: the navigation keys held on `targetRef`, the actions held
 * on the on-screen `RemoteControl`, and the automatic walk to a room followed by
 * `useRouteFollower`. The first two are the viewer's own hands and are merged into one manual
 * intent by `getMovementIntent`; the walk is only consulted when neither of them is holding
 * anything. **Manual input wins, and cancels the walk** — the viewer taking the controls back
 * ends the trip rather than fighting it for the body.
 *
 * "Holding anything" is the held *action set* and not the intent it reduces to (see
 * {@link isAnythingHeld}): opposite actions cancel to an all-zero intent, so W and S together
 * would otherwise read as no input at all and leave the walk running under the viewer's hands.
 * Any manual input cancels, which is the whole rule — a partial one leaves it walking.
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
  poseRef,
  cameraMode,
  surfaces,
  cameraFields,
}: EyeCameraControlsProps) {
  const pressedKeys = usePressedKeys(targetRef, isEyeNavigationKey);
  const advanceWalk = useRouteFollower();

  useFrame((state, delta) => {
    const { activeActions } = useRemoteControlStore.getState();
    const manual = getMovementIntent(pressedKeys.current, activeActions);
    const auto = advanceWalk(poseRef.current, delta);
    const isManual = isAnythingHeld(pressedKeys.current, activeActions);

    const walk = useRoomWalkStore.getState();
    if (isManual && walk.status !== 'idle') {
      walk.cancelWalk();
    }

    const intent = isManual ? manual : (auto ?? manual);
    const from = poseRef.current;
    const step = stepEyePose(from, intent, delta, atFloor(surfaces, from.floor));
    poseRef.current = step.pose;

    const { camera } = state;
    if (cameraMode === 'thirdPerson') {
      // Indexed by the pose the step ENDS on, so a flight that changed storey is followed
      // in the field of the storey arrived at rather than the one left behind.
      const field = atFloor(cameraFields, step.pose.floor);
      const { position, target } = getThirdPersonCamera(step.pose, field);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target.x, target.y, target.z);
      return;
    }
    camera.position.set(step.pose.x, getEyeLevel(step.pose), step.pose.z);
    camera.rotation.set(step.pose.pitch, step.pose.yaw, NO_ROLL, EYE_EULER_ORDER);
  }, POSE_STEP_FRAME_PRIORITY);

  return null;
}

/**
 * Reads the entry of a per-storey list the pose stands on.
 *
 * @param entries - One entry per storey of the stack, lowest first.
 * @param floor - The storey the pose names, 1…N.
 * @returns The entry of that storey, or of the nearest storey the stack has: a pose can be
 *   one frame ahead of a count the viewer has just reduced, and a frame loop must place a
 *   camera rather than throw.
 * @throws RangeError when the list is empty, which would mean a stack of no storeys at all.
 */
function atFloor<T>(entries: readonly T[], floor: number): T {
  const highest = entries.length - LAST_INDEX_OFFSET;
  const index = Math.min(Math.max(floor - MIN_FLOOR_COUNT, FIRST_STOREY_INDEX), highest);
  const entry: T | undefined = entries[index];
  if (entry === undefined) {
    throw new RangeError('the interior camera was given no storey to walk on');
  }
  return entry;
}

/**
 * Whether the viewer is holding anything at all: the **actions** asked for, not the intent they
 * reduce to.
 *
 * Asked of the held set because opposite actions cancel: `moveForward` with `moveBackward` —
 * two fingers on the pad's arrows, or W and S together — reduces to an intent of all zeros
 * while plainly being the viewer's hands on the controls. Cancelling the walk on the reduced
 * intent left it running through exactly those inputs, so it is cancelled on the set instead:
 * **any** manual input ends the trip.
 *
 * Keys are counted through `isEyeNavigationKey`, so a key that steers nothing — the camera-mode
 * toggle, say — never cancels a walk even if it were tracked.
 *
 * @param pressedCodes - The `KeyboardEvent.code` values held on the view region.
 * @param activeActions - The actions held on the on-screen remote control.
 * @returns `true` when either input is holding a navigation action.
 */
function isAnythingHeld(
  pressedCodes: ReadonlySet<string>,
  activeActions: ReadonlySet<EyeAction>,
): boolean {
  if (activeActions.size > 0) {
    return true;
  }
  for (const code of pressedCodes) {
    if (isEyeNavigationKey(code)) {
      return true;
    }
  }
  return false;
}
