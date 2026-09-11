import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type { EulerOrder } from 'three';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';

const HALF = 0.5;
/** The three.js default order, restored after the interior eye camera used `YXZ`. */
const EXTERIOR_EULER_ORDER: EulerOrder = 'XYZ';
/**
 * Where the exterior view starts, in metres: about 10 m from the orbit target, which
 * keeps the whole chamber (about 5.4 × 3.8 × 2.7 m outside) in view with a 50° field of view.
 */
const EXTERIOR_CAMERA_POSITION: readonly [number, number, number] = [6, 5, 7];
/** Orbit pivot: the chamber centre at half the wall height. */
const ORBIT_TARGET: [number, number, number] = [0, FLOOR_HEIGHTS.wall * HALF, 0];
/** Closest orbit distance, in metres; larger than the chamber's half-diagonal so zooming never enters it. */
const ORBIT_MIN_DISTANCE = 4;
const ORBIT_MAX_DISTANCE = 25;
const ORBIT_GROUND_CLEARANCE_RADIANS = 0.05;
const ORBIT_MAX_POLAR_ANGLE = Math.PI * HALF - ORBIT_GROUND_CLEARANCE_RADIANS;

/**
 * Orbit camera of the exterior view (pointer only, see ADR-002).
 *
 * On mount it resets the default camera to the exterior start position looking at the
 * orbit target, so returning from the interior view never starts orbiting from inside
 * the chamber. Distance is limited to suit a single chamber, and the polar angle stops
 * just above the ground.
 *
 * @returns The orbit controls, registered as the default controls.
 */
export function ExteriorCameraControls() {
  const getState = useThree((state) => state.get);

  useLayoutEffect(() => {
    const { camera } = getState();
    camera.rotation.order = EXTERIOR_EULER_ORDER;
    camera.position.set(...EXTERIOR_CAMERA_POSITION);
    camera.lookAt(...ORBIT_TARGET);
  }, [getState]);

  return (
    <OrbitControls
      makeDefault
      target={ORBIT_TARGET}
      minDistance={ORBIT_MIN_DISTANCE}
      maxDistance={ORBIT_MAX_DISTANCE}
      maxPolarAngle={ORBIT_MAX_POLAR_ANGLE}
    />
  );
}
