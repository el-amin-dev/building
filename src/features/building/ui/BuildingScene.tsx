import { Canvas } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useViewStore } from '../application/viewStore.ts';
import { EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { getRoomWalkArea, INTERIM_WALK_SPACE_ID } from '../domain/interimWalkArea.ts';
import { getSlabThickness } from '../domain/slabs.ts';
import { THIRD_PERSON_CAMERA_CONFIG } from '../domain/thirdPersonCamera.ts';
import { CAMERA_MODE_TOGGLE_KEY_CODE } from '../domain/viewMode.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import { ExteriorCameraControls } from './ExteriorCameraControls.tsx';
import { FloorModel } from './FloorModel.tsx';
import { INTERIOR_REGION_ID, NAVIGATION_HINT_ID } from './hudIds.ts';
import { InteriorExplorer } from './InteriorExplorer.tsx';
import { SceneLighting } from './SceneLighting.tsx';
import { CAMERA_FOV_DEGREES, useExteriorFraming } from './useExteriorFraming.ts';
import { useKeyAction } from './useKeyAction.ts';

const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;
/**
 * Camera settings; the position and orientation are set by the active camera controls.
 *
 * The field of view is {@link CAMERA_FOV_DEGREES}, the same constant the exterior framing
 * is derived from, so the distance at which the floor fits the frame matches this camera.
 */
const CAMERA_OPTIONS = {
  fov: CAMERA_FOV_DEGREES,
  near: CAMERA_NEAR,
  far: CAMERA_FAR,
};
const EXTERIOR_DESCRIPTION =
  '3D view of the whole floor from outside: its rooms, balconies, corridors and stairs, seen from above the open side of the building. The camera moves by dragging and scrolling; keyboard camera controls are not available in this view yet.';
/** What the interior view shows, per camera mode. */
const INTERIOR_DESCRIPTIONS: Readonly<Record<InteriorCameraMode, string>> = Object.freeze({
  firstPerson:
    'Eye-level 3D view inside the master bedroom of the floor. Move and look around with the keys listed in the navigation hint. Walking is limited to that room for now.',
  thirdPerson:
    'Third-person 3D view following your person inside the master bedroom of the floor. Move and look around with the keys listed in the navigation hint. Walking is limited to that room for now.',
});
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

/**
 * Colour of the ground: a deep green, where it was a light one while the ground sat just
 * below the slabs.
 *
 * There are no shadow maps until Part 4, so the only cue that the side-B void is a hole is
 * that what shows through it is markedly darker than the lit slabs around it. A dark ground a
 * storey down reads as the bottom of a shaft; a bright one at the same distance still reads as
 * more floor.
 */
const GROUND_COLOR = '#166534';
const GROUND_ROTATION_X = -Math.PI / 2;
/**
 * How many storeys below this floor's slab the ground lies.
 *
 * This is floor 1 of a building, so the ground genuinely belongs a storey down. It also has to
 * clear the slabs by enough that the two are never coplanar (which would z-fight) and — the
 * reason it moved — by enough that the 1.00 m wide side-B void reads as a shaft: at the 0.35 m
 * the ground used to sit at, the opening showed a flat grey surface rather than a hole through
 * the floor.
 */
export const GROUND_STOREYS_BELOW_SLAB = 1;
/**
 * Level of the ground plane, in metres: {@link GROUND_STOREYS_BELOW_SLAB} floor-to-floor
 * heights below the underside of the floor slabs.
 *
 * Derived from `FLOOR_HEIGHTS.floorToFloor` (`heights.ts`) and the slab thickness
 * (`getSlabThickness`, the single source of truth for the underside, `slabs.ts`) instead of
 * being written down, so changing either height moves the ground with the building. Exported
 * with {@link GROUND_STOREYS_BELOW_SLAB} so the tests can assert that derivation.
 */
export const GROUND_LEVEL = -(
  getSlabThickness() +
  FLOOR_HEIGHTS.floorToFloor * GROUND_STOREYS_BELOW_SLAB
);

/**
 * Where the interior viewer may stand and where its follow camera may go: one room.
 *
 * The whole floor is rendered, but there is no wall collision yet, so walking is clamped to
 * the master bedroom — the room the start pose sits in — until Part 3 brings collision
 * against the real plan and this clamp (with `interimWalkArea.ts` itself) is deleted.
 */
const WALK_AREA = getRoomWalkArea(
  FLOOR_PLAN,
  INTERIM_WALK_SPACE_ID,
  EYE_NAVIGATION_CONFIG.bodyRadius,
  FLOOR_HEIGHTS.wall,
  THIRD_PERSON_CAMERA_CONFIG.wallMargin,
);

/** Props of the scene graph rendered inside the canvas. */
interface SceneContentProps {
  /** Whether the interior view is active. */
  readonly isInterior: boolean;
  /** The focusable region whose key presses drive the interior camera. */
  readonly regionRef: RefObject<HTMLDivElement | null>;
}

/**
 * Lighting, ground, the built floor and the camera controls of the current view.
 *
 * Everything that depends on the size of the building comes from `useExteriorFraming`,
 * which must be called from inside the canvas: the fog range and the scale of the sun
 * (through `SceneLighting`), the side of the ground plane, and — inside
 * `ExteriorCameraControls` — the orbit target, the start position and the zoom limits.
 *
 * @param props - {@link SceneContentProps}
 * @returns The scene graph of the active view.
 */
function SceneContent({ isInterior, regionRef }: SceneContentProps) {
  const framing = useExteriorFraming();

  return (
    <>
      <SceneLighting view={isInterior ? 'interior' : 'exterior'} framing={framing} />

      <mesh
        rotation-x={GROUND_ROTATION_X}
        position={[framing.target.x, GROUND_LEVEL, framing.target.z]}
      >
        <planeGeometry args={[framing.groundSize, framing.groundSize]} />
        <meshStandardMaterial color={GROUND_COLOR} />
      </mesh>

      <FloorModel showCeilings={isInterior} />

      {isInterior ? (
        <InteriorExplorer
          targetRef={regionRef}
          bounds={WALK_AREA.bounds}
          roomBox={WALK_AREA.roomBox}
        />
      ) : (
        <ExteriorCameraControls />
      )}
    </>
  );
}

/**
 * Full-size 3D canvas showing the whole built floor, switched by the view mode.
 *
 * - Exterior view: pointer-only orbit camera outside the unroofed floor, framed so the
 *   whole plot fits whatever the viewport shape. The region has no role and is not
 *   focusable (ADR-002).
 * - Interior view: ceilings added and a person driven by W/A/S/D (move), J/L (turn) and
 *   I/K (look), stopped by the walls of the master bedroom (walking is clamped to that one
 *   room until Part 3, see {@link WALK_AREA}), seen at eye level (first person) or from
 *   behind (third person). V switches the camera mode while the region has focus. The
 *   region becomes a focusable `role="application"` named "Interior 3D view" (distinct from
 *   the "Interior view" toggle), described by the full key description of the navigation
 *   hint, and takes focus as soon as the view opens, with a visible focus indicator.
 *
 * The region carries `INTERIOR_REGION_ID`, so HUD controls can hand focus back to it after
 * a pointer click. The canvas stays mounted across view changes. A visually hidden description tells
 * assistive technology what the current view and camera mode show.
 *
 * @returns The scene description and the canvas region.
 */
export function BuildingScene() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const cameraMode = useViewStore((state) => state.interiorCameraMode);
  const toggleCameraMode = useViewStore((state) => state.toggleInteriorCameraMode);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isInterior) {
      regionRef.current?.focus();
    }
  }, [isInterior]);

  useKeyAction(regionRef, CAMERA_MODE_TOGGLE_KEY_CODE, () => {
    if (isInterior) {
      toggleCameraMode();
    }
  });

  return (
    <>
      <p className="sr-only">
        {isInterior ? INTERIOR_DESCRIPTIONS[cameraMode] : EXTERIOR_DESCRIPTION}
      </p>
      <div
        ref={regionRef}
        id={INTERIOR_REGION_ID}
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
