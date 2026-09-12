import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useLayoutEffect, useRef } from 'react';
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
 * It puts the default camera at the start position looking at the orbit target, so
 * returning from the interior view never starts orbiting from inside a room, and it does so
 * again whenever the framing changes — a resize, a rotation — for as long as the user has
 * not orbited. Otherwise the zoom limits would re-derive from the new framing while the
 * camera stayed where the old one put it, and the controls would snap it into range on the
 * next frame. The moment the user grabs the controls (`onStart`) that stops for good: from
 * then on the camera is theirs, and a resize only moves the limits and the pivot. The polar
 * angle stops just above the ground.
 *
 * @returns The orbit controls, registered as the default controls.
 */
export function ExteriorCameraControls() {
  const getState = useThree((state) => state.get);
  const { target, position, minDistance, maxDistance } = useExteriorFraming();
  /** Set by the first orbit the user starts; the camera is never moved again after that. */
  const hasOrbited = useRef(false);

  useLayoutEffect(() => {
    if (hasOrbited.current) {
      return;
    }
    const { camera } = getState();
    camera.rotation.order = EXTERIOR_EULER_ORDER;
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(target.x, target.y, target.z);
  }, [getState, position, target]);

  const handleOrbitStart = useCallback(() => {
    hasOrbited.current = true;
  }, []);

  return (
    <OrbitControls
      makeDefault
      onStart={handleOrbitStart}
      target={[target.x, target.y, target.z]}
      minDistance={minDistance}
      maxDistance={maxDistance}
      maxPolarAngle={ORBIT_MAX_POLAR_ANGLE}
    />
  );
}
