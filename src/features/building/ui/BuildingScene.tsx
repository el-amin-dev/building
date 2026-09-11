import { Canvas } from '@react-three/fiber';
import { useControls } from 'leva';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useViewStore } from '../application/viewStore.ts';
import { BASE_CHAMBER_SPEC, getWalkableBounds } from '../domain/chamber.ts';
import { EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import { ChamberModel } from './ChamberModel.tsx';
import { ExteriorCameraControls } from './ExteriorCameraControls.tsx';
import { EyeCameraControls } from './EyeCameraControls.tsx';
import { NAVIGATION_HINT_ID } from './hudIds.ts';

const CAMERA_FOV_DEGREES = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;
/** Camera settings; the position and orientation are set by the active camera controls. */
const CAMERA_OPTIONS = {
  fov: CAMERA_FOV_DEGREES,
  near: CAMERA_NEAR,
  far: CAMERA_FAR,
};
const SCENE_BACKGROUND_COLOR = '#bfdbfe';
const EXTERIOR_DESCRIPTION =
  '3D view of the chamber from outside. The camera moves by dragging and scrolling; keyboard camera controls are not available in this view yet.';
const INTERIOR_DESCRIPTION =
  'Eye-level 3D view inside the chamber. Move and look around with the keys listed in the navigation hint.';
/** Distinct from the "Interior view" toggle, so voice control never sees two targets with one name. */
const INTERIOR_REGION_LABEL = 'Interior 3D view';
const INTERIOR_REGION_ROLE = 'application';
const INTERIOR_REGION_TAB_INDEX = 0;
/**
 * Full-size region around the canvas. The focus indicator is drawn by an `::after` layer
 * stacked above the WebGL canvas (which would paint over an outline on the region
 * itself): a 3 px amber outline with a dark inner ring, so it contrasts with both light
 * and dark scene content. `focus:` rather than `focus-visible:` because focus moves here
 * programmatically, including after a mouse click on the view toggle.
 */
const REGION_CLASS_NAME =
  'absolute inset-0 focus:outline-none after:pointer-events-none after:absolute after:inset-0 after:z-10 focus:after:outline-3 focus:after:-outline-offset-3 focus:after:outline-amber-400 focus:after:inset-ring-5 focus:after:inset-ring-slate-900';

const GROUND_SIZE = 120;
const GROUND_COLOR = '#86efac';
const GROUND_ROTATION_X = -Math.PI / 2;
const WALL_COLOR = '#e2e8f0';
const AMBIENT_LIGHT_INTENSITY = 0.6;
const SUN_INTENSITY = 1.8;
const SUN_INTENSITY_MAX = 5;
const SUN_INTENSITY_STEP = 0.1;
const SUN_POSITION: [number, number, number] = [20, 30, 15];

/** Where the interior eye may stand: the base chamber's clear rectangle minus the body radius. */
const WALKABLE_BOUNDS = getWalkableBounds(BASE_CHAMBER_SPEC, EYE_NAVIGATION_CONFIG.bodyRadius);

/** Props of the scene graph rendered inside the canvas. */
interface SceneContentProps {
  /** Whether the interior (eye-level) view is active. */
  readonly isInterior: boolean;
  /** The focusable region whose key presses drive the interior camera. */
  readonly regionRef: RefObject<HTMLDivElement | null>;
}

/** Lights, ground, the base chamber and the camera controls of the current view. */
function SceneContent({ isInterior, regionRef }: SceneContentProps) {
  const { wallColor, sunIntensity } = useControls('Scene', {
    wallColor: WALL_COLOR,
    sunIntensity: {
      value: SUN_INTENSITY,
      min: 0,
      max: SUN_INTENSITY_MAX,
      step: SUN_INTENSITY_STEP,
    },
  });

  return (
    <>
      <color attach="background" args={[SCENE_BACKGROUND_COLOR]} />
      <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
      <directionalLight position={SUN_POSITION} intensity={sunIntensity} />

      <mesh rotation-x={GROUND_ROTATION_X}>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial color={GROUND_COLOR} />
      </mesh>

      <ChamberModel spec={BASE_CHAMBER_SPEC} showCeiling={isInterior} wallColor={wallColor} />

      {isInterior ? (
        <EyeCameraControls targetRef={regionRef} bounds={WALKABLE_BOUNDS} />
      ) : (
        <ExteriorCameraControls />
      )}
    </>
  );
}

/**
 * Full-size 3D canvas showing the base chamber, switched by the view mode.
 *
 * - Exterior view: pointer-only orbit camera outside the open-topped chamber. The region
 *   has no role and is not focusable (ADR-002).
 * - Interior view: ceiling added and an eye-level camera driven by W/A/S/D (move),
 *   J/L (turn) and I/K (look), stopped by the walls. The region becomes a focusable
 *   `role="application"` named "Interior 3D view" (distinct from the "Interior view"
 *   toggle), described by the full key description of the navigation hint, and takes
 *   focus as soon as the view opens, with a visible focus indicator.
 *
 * The canvas stays mounted across view changes. A visually hidden description tells
 * assistive technology what the current view shows.
 *
 * @returns The scene description and the canvas region.
 */
export function BuildingScene() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isInterior) {
      regionRef.current?.focus();
    }
  }, [isInterior]);

  return (
    <>
      <p className="sr-only">{isInterior ? INTERIOR_DESCRIPTION : EXTERIOR_DESCRIPTION}</p>
      <div
        ref={regionRef}
        className={REGION_CLASS_NAME}
        tabIndex={isInterior ? INTERIOR_REGION_TAB_INDEX : undefined}
        role={isInterior ? INTERIOR_REGION_ROLE : undefined}
        aria-label={isInterior ? INTERIOR_REGION_LABEL : undefined}
        aria-describedby={isInterior ? NAVIGATION_HINT_ID : undefined}
      >
        <Canvas camera={CAMERA_OPTIONS}>
          <SceneContent isInterior={isInterior} regionRef={regionRef} />
        </Canvas>
      </div>
    </>
  );
}
