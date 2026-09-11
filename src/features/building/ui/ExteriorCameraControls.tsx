import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import type { EulerOrder } from 'three';
import { useExteriorFraming } from './useExteriorFraming.ts';

const HALF = 0.5;
/** The three.js default order, restored after the interior eye camera used `YXZ`. */
const EXTERIOR_EULER_ORDER: EulerOrder = 'XYZ';
/** How far above the ground the orbit stops, in radians, so the camera never goes under it. */
const ORBIT_GROUND_CLEARANCE_RADIANS = 0.05;
const ORBIT_MAX_POLAR_ANGLE = Math.PI * HALF - ORBIT_GROUND_CLEARANCE_RADIANS;

/**
 * Orbit camera of the exterior view (pointer only, see ADR-002).
 *
 * Every distance and every point it uses comes from `useExteriorFraming`, which frames the
 * whole floor for the live canvas aspect: the orbit pivot is the centre of the plot at half
 * the wall height, the zoom limits are the framing's `minDistance` and `maxDistance` — the
 * closest one still outside the bounding sphere of the floor, so zooming never enters the
 * building — and the start position is the framing's, above and off to one side of the open
 * side B. This component therefore holds no size of its own: a change to the plot or to the
 * heights moves the camera with it.
 *
 * On mount it resets the default camera to the start position looking at the orbit target,
 * so returning from the interior view never starts orbiting from inside a room. That reset
 * is deliberately mount-only: a later resize re-derives the zoom limits and the pivot, but
 * must not throw away the view the user has orbited to. The polar angle stops just above
 * the ground.
 *
 * @returns The orbit controls, registered as the default controls.
 */
export function ExteriorCameraControls() {
  const getState = useThree((state) => state.get);
  const { target, position, minDistance, maxDistance } = useExteriorFraming();
  /** The framing of the first render: where the camera is put when the view opens. */
  const startPose = useRef({ position, target });

  useLayoutEffect(() => {
    const { position: start, target: lookAt } = startPose.current;
    const { camera } = getState();
    camera.rotation.order = EXTERIOR_EULER_ORDER;
    camera.position.set(start.x, start.y, start.z);
    camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
  }, [getState]);

  return (
    <OrbitControls
      makeDefault
      target={[target.x, target.y, target.z]}
      minDistance={minDistance}
      maxDistance={maxDistance}
      maxPolarAngle={ORBIT_MAX_POLAR_ANGLE}
    />
  );
}
