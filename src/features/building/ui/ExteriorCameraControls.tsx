import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { EulerOrder, EventDispatcher } from 'three';
import {
  getRememberedOrbitPose,
  useExteriorOrbitStore,
} from '../application/exteriorOrbitStore.ts';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { useOrbitControlStore } from '../application/orbitControlStore.ts';
import {
  clampOrbitPose,
  getOrbitIntent,
  getOrbitLimits,
  getOrbitPose,
  getOrbitPosition,
  isOrbitNavigationKey,
  stepOrbitPose,
} from '../domain/orbitNavigation.ts';
import type { OrbitIntent, OrbitPose } from '../domain/orbitNavigation.ts';
import { useExteriorFraming } from './useExteriorFraming.ts';
import { usePressedKeys } from './usePressedKeys.ts';

/** The three.js default order, restored after the interior eye camera used `YXZ`. */
const EXTERIOR_EULER_ORDER: EulerOrder = 'XYZ';

/**
 * Value of an {@link OrbitIntent} axis the viewer is asking for nothing along.
 *
 * An intent that is idle on all three axes is the resting state of both input paths — no
 * key held, no pad button pressed — and the frame then leaves the camera alone entirely,
 * so `OrbitControls`' own pointer drag and wheel are never fought over.
 */
const IDLE_AXIS = 0;

/**
 * Runs before default-priority (0) frame callbacks, so anything reading the camera in the
 * same frame sees the stepped pose, whatever the JSX order — the priority
 * `EyeCameraControls` uses, for the same reason. A negative priority keeps R3F's automatic
 * rendering (only a positive one takes over the render loop).
 */
const ORBIT_STEP_FRAME_PRIORITY = -1;

/**
 * The part of the default controls this component drives: `OrbitControls` re-reads the
 * camera and re-derives its internal spherical state on `update()`.
 *
 * Declared structurally rather than imported from `three-stdlib`, which is drei's own
 * dependency and not one of this app's: the camera is the authority on the pose here, and
 * all this needs of the controls is that they catch up with it.
 */
interface OrbitLike extends EventDispatcher {
  /** Re-syncs the controls with the camera as this component left it. */
  update(): void;
}

/** Props of {@link ExteriorCameraControls}. */
export interface ExteriorCameraControlsProps {
  /**
   * Focusable element whose key presses drive the orbit. It must already be mounted when
   * this component mounts (see `usePressedKeys`), and the keys act only while it has
   * focus.
   */
  readonly targetRef: RefObject<HTMLElement | null>;
}

/**
 * Orbit camera of the exterior view: pointer drag and wheel, arrow and zoom keys, and the
 * on-screen orbit pad.
 *
 * Every distance and every point it uses comes from `useExteriorFraming`, which frames the
 * whole building for the live canvas aspect and the live storey count: the orbit pivot is
 * the centre of the plot at half the height of the building, and `getOrbitLimits` turns
 * that framing into the one set of limits both clamps use — the domain stepper's and the
 * ones handed to `OrbitControls` — so the two can never fight over the same camera. This
 * component therefore holds no size and no angle of its own: a change to the plot, to the
 * heights or to the number of storeys moves the camera with it.
 *
 * **Placement contract.** On mount, and again whenever the framing changes, the camera is
 * placed from
 *
 * ```ts
 * clampOrbitPose(getRememberedOrbitPose() ?? getOrbitPose(framing.target, framing.position), limits)
 * ```
 *
 * looking at `framing.target`. `getRememberedOrbitPose() ?? framing.position` is deliberately
 * the same expression the exterior↔interior camera transition uses as its exterior endpoint,
 * so when a tween into this view finishes and this component mounts, this placement is a
 * no-op and there is no visible jump. Applying it on every framing change is correct rather
 * than something to latch off: the remembered pose *is* the viewer's own angle, so a resize
 * keeps that angle and merely re-clamps the distance into the new limits.
 *
 * **A storey change refits the distance.** A resize does not change the subject — the same
 * building, a differently shaped window onto it — so keeping the remembered distance there
 * is right. Adding storeys *does* change the subject: the building can end up eleven times
 * taller, and a distance chosen for one storey would leave most of a ten-storey stack out
 * of frame, which reads as a broken stepper rather than as a kept viewpoint. So on a count
 * change alone the viewer's `azimuth` and `polar` are kept and the `distance` is taken from
 * the newly framed pose, then clamped; the refitted pose is remembered, so the next mount
 * and the camera transition both agree with what is on screen. `rememberPose` is therefore
 * called unconditionally at the end of the placement, not only when nothing was remembered
 * yet: remembering a pose that has not moved is a no-op update in the store, so no
 * subscriber is notified for it.
 *
 * **Memory.** Besides that placement the pose is remembered at three moments, and never per
 * frame: when a pointer drag or a wheel zoom ends (`onEnd`), on the frame a key or pad hold
 * is released, and on unmount — the exterior→interior switch, which is the write that makes
 * coming back out return to the viewer's angle at all. The first mount of a session finds
 * nothing remembered and seeds the framing's own start pose, so the store is the single
 * answer to "where is the exterior camera" from then on.
 *
 * **Keys.** `usePressedKeys` listens on `targetRef` only, so the arrows act only while the
 * exterior region has focus (WCAG 2.1.4) and stop scrolling the page while it does. The held
 * keys and the pad's `activeActions` merge into one `OrbitIntent` per frame, so both input
 * paths go through the same domain rule; the pad is read with the store's non-reactive
 * `getState()` for the reason `EyeCameraControls` does it — subscribing would re-render the
 * scene sixty times a second for its own camera movement.
 *
 * @param props - {@link ExteriorCameraControlsProps}
 * @returns The orbit controls, registered as the default controls.
 */
export function ExteriorCameraControls({ targetRef }: ExteriorCameraControlsProps) {
  const getState = useThree((state) => state.get);
  const controls = useThree((state) => state.controls) as OrbitLike | null;
  const framing = useExteriorFraming();
  const { target, position } = framing;
  const limits = useMemo(() => getOrbitLimits(framing), [framing]);
  const rememberPose = useExteriorOrbitStore((state) => state.rememberOrbitPose);
  const floorCount = useFloorCountStore((state) => state.floorCount);
  const pressedKeys = usePressedKeys(targetRef, isOrbitNavigationKey);
  /** The live pose, stepped in place of React state so moving never re-renders. */
  const poseRef = useRef<OrbitPose | null>(null);
  /** Whether the previous frame was moving, so a release is written exactly once. */
  const wasMovingRef = useRef(false);
  /** The count the camera was last placed for, so a storey change is told from a resize. */
  const placedForCountRef = useRef(floorCount);

  useLayoutEffect(() => {
    const framingPose = getOrbitPose(target, position);
    const remembered = getRememberedOrbitPose();
    const storeysChanged = placedForCountRef.current !== floorCount;
    placedForCountRef.current = floorCount;

    // Identical to the expression the camera flight ends on whenever the building itself is
    // unchanged; a storey change keeps the viewer's angle but refits the distance.
    const placement =
      remembered !== undefined && storeysChanged
        ? { ...remembered, distance: framingPose.distance }
        : (remembered ?? framingPose);

    const pose = clampOrbitPose(placement, limits);
    poseRef.current = pose;
    const { camera } = getState();
    const placed = getOrbitPosition(target, pose);
    camera.rotation.order = EXTERIOR_EULER_ORDER;
    camera.position.set(placed.x, placed.y, placed.z);
    camera.lookAt(target.x, target.y, target.z);
    rememberPose(pose);
  }, [floorCount, getState, limits, position, rememberPose, target]);

  useEffect(
    () => () => {
      const pose = poseRef.current;
      if (pose !== null) {
        rememberPose(pose);
      }
    },
    [rememberPose],
  );

  useFrame((state, delta) => {
    const pose = poseRef.current;
    if (pose === null) {
      return;
    }

    const { activeActions } = useOrbitControlStore.getState();
    const intent = getOrbitIntent(pressedKeys.current, activeActions);
    if (isIdle(intent)) {
      if (wasMovingRef.current) {
        wasMovingRef.current = false;
        rememberPose(pose);
      }
      return;
    }

    wasMovingRef.current = true;
    const stepped = stepOrbitPose(pose, intent, delta, limits);
    poseRef.current = stepped;
    const { camera } = state;
    const placed = getOrbitPosition(target, stepped);
    camera.position.set(placed.x, placed.y, placed.z);
    camera.lookAt(target.x, target.y, target.z);
    controls?.update();
  }, ORBIT_STEP_FRAME_PRIORITY);

  const handleOrbitEnd = useCallback(() => {
    const { camera } = getState();
    const pose = getOrbitPose(target, camera.position);
    // The pointer is the authority while it drags: the stepper has to carry on from where
    // the drag left the camera, or the next key press would jump back to the old pose.
    poseRef.current = pose;
    rememberPose(pose);
  }, [getState, rememberPose, target]);

  return (
    <OrbitControls
      makeDefault
      onEnd={handleOrbitEnd}
      target={[target.x, target.y, target.z]}
      minDistance={limits.minDistance}
      maxDistance={limits.maxDistance}
      minPolarAngle={limits.minPolar}
      maxPolarAngle={limits.maxPolar}
    />
  );
}

/** Tells whether the viewer is asking the orbit for nothing at all this frame. */
function isIdle(intent: OrbitIntent): boolean {
  return intent.orbit === IDLE_AXIS && intent.tilt === IDLE_AXIS && intent.zoom === IDLE_AXIS;
}
