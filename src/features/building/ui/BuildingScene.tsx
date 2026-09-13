import { Canvas } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { getSlabThickness } from '../domain/slabs.ts';
import { CAMERA_MODE_TOGGLE_KEY_CODE } from '../domain/viewMode.ts';
import type { InteriorCameraMode, ViewMode } from '../domain/viewMode.ts';
import { ExteriorCameraControls } from './ExteriorCameraControls.tsx';
import { FloorModel } from './FloorModel.tsx';
import { INTERIOR_REGION_ID, NAVIGATION_HINT_ID } from './hudIds.ts';
import { InteriorExplorer } from './InteriorExplorer.tsx';
import { SceneLighting } from './SceneLighting.tsx';
import { CAMERA_FOV_DEGREES, useExteriorFraming } from './useExteriorFraming.ts';
import { useKeyAction } from './useKeyAction.ts';
import { ViewTransition } from './ViewTransition.tsx';

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
  '3D view of the whole floor from outside: its rooms, balconies, corridors and stairs, seen from above the open side of the building. Drag to orbit and scroll to zoom, or use the keyboard while this view has focus: the left and right arrows orbit around the building, the up and down arrows tilt over it, and the plus and minus keys zoom in and out. The on-screen camera pad in the HUD offers the same six movements without a keyboard.';
/** What the interior view shows, per camera mode. */
const INTERIOR_DESCRIPTIONS: Readonly<Record<InteriorCameraMode, string>> = Object.freeze({
  firstPerson:
    'Eye-level 3D view inside the floor, opening on the stair arrival landing facing the corridor. Move and look around with the keys listed in the navigation hint; the whole floor is walkable, through its doors. The room readout in the HUD names the room you are standing in, "Go to room" walks you to any room of the floor, and the minimap shows where you are on it.',
  thirdPerson:
    'Third-person 3D view following your person inside the floor, opening on the stair arrival landing facing the corridor. Move and look around with the keys listed in the navigation hint; the whole floor is walkable, through its doors. The room readout in the HUD names the room you are standing in, "Go to room" walks you to any room of the floor, and the minimap shows where you are on it.',
});
/**
 * Accessible name of the view region per view mode.
 *
 * Distinct from the "Interior view" toggle, so voice control never sees two targets with
 * one name. The interior name is matched verbatim by the end-to-end specs.
 */
const INTERIOR_REGION_LABEL = 'Interior 3D view';
const EXTERIOR_REGION_LABEL = 'Exterior 3D view';
const REGION_ROLE = 'application';
const REGION_TAB_INDEX = 0;
/** Physical key that abandons an automatic walk while the view has focus. */
const CANCEL_WALK_KEY_CODE = 'Escape';
/**
 * The two values of `data-camera-transition`, the attribute the end-to-end capture helper
 * gates on.
 *
 * A 0.9 s camera travel would otherwise be caught mid-flight by a screenshot, which no
 * "two identical captures" rule can rule out on its own; the region says out loud whether
 * the camera is still moving, so "settled" can mean it.
 */
const CAMERA_IDLE = 'idle';
const CAMERA_RUNNING = 'running';
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

/** Props of the scene graph rendered inside the canvas. */
interface SceneContentProps {
  /** Whether the interior view is active. */
  readonly isInterior: boolean;
  /**
   * Whether the camera is travelling between the two views, in which case neither view's
   * controls are mounted: both write the camera every frame while mounted, so they would
   * simply overwrite the travel.
   */
  readonly isTravelling: boolean;
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
 * `ViewTransition` is mounted here for the whole life of the scene, outside the view
 * ternary, because it is the one thing that has to survive a change of view: it owns the
 * camera while the travel between the two runs, and the controls it replaces are exactly
 * the sides of that ternary.
 *
 * @param props - {@link SceneContentProps}
 * @returns The scene graph of the active view.
 */
function SceneContent({ isInterior, isTravelling, regionRef }: SceneContentProps) {
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

      <ViewTransition />

      {isTravelling ? null : isInterior ? (
        <InteriorExplorer targetRef={regionRef} />
      ) : (
        <ExteriorCameraControls targetRef={regionRef} />
      )}
    </>
  );
}

/**
 * Full-size 3D canvas showing the whole built floor, switched by the view mode.
 *
 * - Exterior view: an orbit camera outside the unroofed floor, framed so the whole plot
 *   fits whatever the viewport shape, driven by pointer drag and wheel, by the arrow and
 *   zoom keys of `orbitNavigation.ts` while the region has focus, and by the on-screen
 *   camera pad.
 * - Interior view: ceilings added and a person driven by W/A/S/D (move), J/L (turn) and
 *   I/K (look), stopped by the walls of the whole floor and free to walk through its
 *   doors, seen at eye level (first person) or from behind (third person). V switches the
 *   camera mode and Escape abandons an automatic "go to room" walk, both while the region
 *   has focus.
 *
 * **The region is focusable in both views.** It is a `role="application"` tab stop named
 * "Interior 3D view" or "Exterior 3D view" (each distinct from the toggle that switches
 * to it), described by the full key description of the navigation hint, with a visible
 * focus indicator. This supersedes ADR-002, which left the exterior view roleless and
 * unfocusable precisely because it had no keyboard controls; it now has them. It keeps the
 * id `INTERIOR_REGION_ID` although it serves both views: renaming it would touch six files
 * for no change in behaviour, and the naming debt is recorded in ADR-013 instead.
 *
 * Focus follows a change of view and never a first paint: entering the interior takes
 * focus, as it always has, and so does coming back out to the exterior, so the keys of the
 * view just opened work without hunting for it. Arriving on the page does not, so no focus
 * ring is drawn over the building before the viewer has asked for anything (owner
 * decision). The previous view mode is kept in a ref to tell the two apart.
 *
 * The region also stamps `data-camera-transition`, so a screenshot is never taken while the
 * camera is still flying between the views. The canvas stays mounted across view changes. A
 * visually hidden description tells assistive technology what the current view and camera
 * mode show.
 *
 * @returns The scene description and the canvas region.
 */
export function BuildingScene() {
  const viewMode = useViewStore((state) => state.viewMode);
  const cameraMode = useViewStore((state) => state.interiorCameraMode);
  const cameraTransition = useViewStore((state) => state.cameraTransition);
  const toggleCameraMode = useViewStore((state) => state.toggleInteriorCameraMode);
  const cancelWalk = useRoomWalkStore((state) => state.cancelWalk);
  const regionRef = useRef<HTMLDivElement>(null);
  /** The view of the previous render, `undefined` until the first change: see the docblock. */
  const previousViewRef = useRef<ViewMode | undefined>(undefined);

  const isInterior = viewMode === 'interior';
  const isTravelling = cameraTransition !== 'none';

  useEffect(() => {
    const previousView = previousViewRef.current;
    previousViewRef.current = viewMode;
    if (previousView === undefined || previousView === viewMode) {
      return;
    }
    regionRef.current?.focus();
  }, [viewMode]);

  useKeyAction(regionRef, CAMERA_MODE_TOGGLE_KEY_CODE, () => {
    if (isInterior) {
      toggleCameraMode();
    }
  });

  useKeyAction(regionRef, CANCEL_WALK_KEY_CODE, cancelWalk);

  return (
    <>
      <p className="sr-only">
        {isInterior ? INTERIOR_DESCRIPTIONS[cameraMode] : EXTERIOR_DESCRIPTION}
      </p>
      <div
        ref={regionRef}
        id={INTERIOR_REGION_ID}
        className={REGION_CLASS_NAME}
        tabIndex={REGION_TAB_INDEX}
        role={REGION_ROLE}
        aria-label={isInterior ? INTERIOR_REGION_LABEL : EXTERIOR_REGION_LABEL}
        aria-describedby={NAVIGATION_HINT_ID}
        data-camera-transition={isTravelling ? CAMERA_RUNNING : CAMERA_IDLE}
      >
        <Canvas camera={CAMERA_OPTIONS}>
          <SceneContent isInterior={isInterior} isTravelling={isTravelling} regionRef={regionRef} />
        </Canvas>
      </div>
    </>
  );
}
