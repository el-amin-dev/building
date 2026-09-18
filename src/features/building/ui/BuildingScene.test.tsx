import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { ExteriorFraming } from '../domain/exteriorFraming.ts';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { getSlabThickness } from '../domain/slabs.ts';
import { MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import {
  BuildingScene,
  CAMERA_FAR,
  GROUND_LEVEL,
  GROUND_STOREYS_BELOW_SLAB,
} from './BuildingScene.tsx';
import type { FloorModelProps } from './FloorModel.tsx';
import { INTERIOR_REGION_ID, NAVIGATION_HINT_ID } from './hudIds.ts';
import { NavigationHint } from './NavigationHint.tsx';

const { CANVAS_TEST_ID, STUB_FRAMING } = vi.hoisted(() => ({
  CANVAS_TEST_ID: 'scene-canvas',
  /**
   * The only two things `BuildingScene` itself reads off the framing: where the ground plane
   * is centred, and how wide it is. Everything else the framing carries is consumed by the
   * scene's children, which are mocked out below.
   */
  STUB_FRAMING: { target: { x: 6, y: 0, z: 4 }, groundSize: 120 },
}));

/** Every `FloorModel` rendered inside the canvas, in order, with the props it was handed. */
const { floorModels } = vi.hoisted(() => ({ floorModels: [] as unknown[] }));

// jsdom has no WebGL: the canvas is replaced by a plain element, so drei (and the CommonJS
// three build it would load) is skipped and the r3f hooks are inert. It does render its
// children, because the scene graph is where the storey count has to arrive.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid={CANVAS_TEST_ID}>{children}</div>
  ),
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));

// The framing reads the live canvas size through `useThree`, which the mock above leaves
// inert, so it is answered with a stand-in instead. A stand-in rather than a real framing
// because the framing is `exteriorFraming.ts`'s subject and is tested there: here it is only
// the two numbers the ground plane is placed with, so nothing in this file has to be kept in
// step with how a framing is derived.
vi.mock('./useExteriorFraming.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useExteriorFraming.ts')>();
  return {
    ...actual,
    useExteriorFraming: () => STUB_FRAMING as unknown as ExteriorFraming,
  };
});

// The rest of the scene graph is covered by its own files and needs a renderer; here only the
// props `BuildingScene` hands down are of interest.
vi.mock('./SceneLighting.tsx', () => ({ SceneLighting: () => null }));
vi.mock('./ViewTransition.tsx', () => ({ ViewTransition: () => null }));
vi.mock('./InteriorExplorer.tsx', () => ({ InteriorExplorer: () => null }));
vi.mock('./ExteriorCameraControls.tsx', () => ({ ExteriorCameraControls: () => null }));
vi.mock('./FloorModel.tsx', () => ({
  FloorModel: (props: FloorModelProps) => {
    floorModels.push(props);
    return null;
  },
}));

const INTERIOR_REGION_NAME = 'Interior 3D view';
const EXTERIOR_REGION_NAME = 'Exterior 3D view';
/** Decimal digits two lengths must share to count as equal (sub-nanometre). */
const PRECISION_DIGITS = 9;
/** Fewest storeys the ground may sit below the slab, for the void to read as a shaft. */
const MINIMUM_STOREYS_BELOW = 1;
const CAMERA_MODE_CODE = 'KeyV';
const CANCEL_WALK_CODE = 'Escape';
/** The attribute a screenshot gate reads to know the camera has stopped moving. */
const CAMERA_TRANSITION_ATTRIBUTE = 'data-camera-transition';
/** A room to ask for a walk to, so Escape has something to abandon. */
const WALK_TARGET = makeFloorSpaceRef(MIN_FLOOR_COUNT, 'kitchen');
/** One built floor is mounted per canvas: the whole building is that one component. */
const ONE_MODEL = 1;
/** Far clipping distance the scene camera must have, in metres. */
const EXPECTED_CAMERA_FAR = 800;
/** What it was while the building was one storey tall. */
const PREVIOUS_CAMERA_FAR = 500;
const EXTERIOR_DESCRIPTION =
  '3D view of the whole floor from outside: its rooms, balconies, corridors and stairs, seen from above the open side of the building. Drag to orbit and scroll to zoom, or use the keyboard while this view has focus: the left and right arrows orbit around the building, the up and down arrows tilt over it, and the plus and minus keys zoom in and out. The on-screen camera pad in the HUD offers the same six movements without a keyboard.';
const INTERIOR_DESCRIPTION =
  'Eye-level 3D view inside the floor, opening on the stair arrival landing facing the corridor. Move and look around with the keys listed in the navigation hint; the whole floor is walkable, through its doors. The room readout in the HUD names the room you are standing in, "Go to room" walks you to any room of the floor, and the minimap shows where you are on it.';
const THIRD_PERSON_DESCRIPTION =
  'Third-person 3D view following your person inside the floor, opening on the stair arrival landing facing the corridor. Move and look around with the keys listed in the navigation hint; the whole floor is walkable, through its doors. The room readout in the HUD names the room you are standing in, "Go to room" walks you to any room of the floor, and the minimap shows where you are on it.';
const HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. The "Go to room" button in the HUD lists every room of the floor and walks you to the one you pick, through the doors; that walk stops when you activate the "Stop walking" button beside it, when you press Escape while the view has focus, or as soon as you move yourself with any key or pad button. In the exterior view the left and right arrows orbit the camera around the building, the up and down arrows tilt it, and the plus and minus keys zoom in and out; the on-screen camera pad offers those same six movements. The floor control in the HUD stacks the building: "Remove a floor" and "Add a floor" step how many storeys are displayed, which the reading between those two buttons gives as 01 to 10, and the stairs are how you walk from one storey to the next. Press Tab to reach the view toggle, then the Third person toggle, then "Remove a floor", then "Add a floor", then "Go to room", then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';

function renderScene() {
  return render(
    <>
      <BuildingScene />
      <NavigationHint />
    </>,
  );
}

function toggleView() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

/** Reports the camera as arrived, the way the transition's frame loop does. */
function endTransition() {
  act(() => {
    useViewStore.getState().endCameraTransition();
  });
}

function getCameraMode() {
  return useViewStore.getState().interiorCameraMode;
}

/** The props every `FloorModel` in the canvas was rendered with, in order. */
function builtModels(): readonly FloorModelProps[] {
  return floorModels as readonly FloorModelProps[];
}

/**
 * Reads the props of the most recent `FloorModel` render.
 *
 * @returns What the scene last asked the building to draw.
 * @throws Error when no built floor was rendered at all.
 */
function lastModel(): FloorModelProps {
  const model = builtModels().at(-ONE_MODEL);
  if (model === undefined) {
    throw new Error('No FloorModel was rendered inside the canvas');
  }
  return model;
}

/** The element wrapping the (mocked) canvas: the view region. */
function getRegion(): HTMLElement {
  const region = screen.getByTestId(CANVAS_TEST_ID).parentElement;
  if (region === null) {
    throw new Error('The canvas has no wrapping region');
  }
  return region;
}

describe('BuildingScene', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
    useFloorCountStore.setState(useFloorCountStore.getInitialState(), true);
    floorModels.length = 0;
  });

  it('exposes the exterior view as a focusable application region, unfocused on arrival', () => {
    renderScene();

    const region = screen.getByRole('application', { name: EXTERIOR_REGION_NAME });
    expect(region).toBe(getRegion());
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('id', INTERIOR_REGION_ID);
    expect(region).toHaveAttribute('aria-describedby', NAVIGATION_HINT_ID);
    expect(region).toHaveAccessibleDescription(HINT_DESCRIPTION);
    // Never on first paint, so no focus ring is drawn over the building on arrival (owner).
    expect(region).not.toHaveFocus();
    expect(screen.getByText(EXTERIOR_DESCRIPTION)).toBeInTheDocument();
  });

  it('turns the region into a focused application described by the hint in the interior view', () => {
    renderScene();

    toggleView();

    const region = screen.getByRole('application', { name: INTERIOR_REGION_NAME });
    expect(region).toBe(getRegion());
    expect(region).toHaveFocus();
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('id', INTERIOR_REGION_ID);
    expect(region).toHaveAttribute('aria-describedby', NAVIGATION_HINT_ID);
    expect(region).toHaveAccessibleDescription(HINT_DESCRIPTION);
    const hint = document.getElementById(NAVIGATION_HINT_ID);
    expect(hint).not.toBeNull();
    expect(hint).toHaveTextContent(HINT_DESCRIPTION);
    expect(screen.getByText(INTERIOR_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(EXTERIOR_DESCRIPTION)).toBeNull();
  });

  it('keeps the region focusable and renames it when going back to the exterior view', () => {
    renderScene();
    toggleView();

    toggleView();

    const region = screen.getByRole('application', { name: EXTERIOR_REGION_NAME });
    expect(region).toBe(getRegion());
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('aria-describedby', NAVIGATION_HINT_ID);
    // Focus follows the return too, so the orbit keys of the view just opened work without
    // the viewer hunting for it (ADR-013).
    expect(region).toHaveFocus();
    expect(screen.getByText(EXTERIOR_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(INTERIOR_DESCRIPTION)).toBeNull();
  });

  it('stamps the camera transition on the region while it runs, and idle once it ends', () => {
    renderScene();
    expect(getRegion()).toHaveAttribute(CAMERA_TRANSITION_ATTRIBUTE, 'idle');

    toggleView();

    expect(getRegion()).toHaveAttribute(CAMERA_TRANSITION_ATTRIBUTE, 'running');

    endTransition();

    expect(getRegion()).toHaveAttribute(CAMERA_TRANSITION_ATTRIBUTE, 'idle');
  });

  it('reports no transition at all when the viewer asked for reduced motion', () => {
    renderScene();
    act(() => {
      useViewStore.getState().setPrefersReducedMotion(true);
    });

    toggleView();

    expect(getRegion()).toHaveAttribute(CAMERA_TRANSITION_ATTRIBUTE, 'idle');
  });

  it('abandons a walk with Escape while the interior view is focused', () => {
    renderScene();
    toggleView();
    act(() => {
      useRoomWalkStore.getState().startWalkTo(WALK_TARGET);
    });
    expect(useRoomWalkStore.getState().status).toBe('walking');

    const notPrevented = fireEvent.keyDown(getRegion(), { code: CANCEL_WALK_CODE });

    expect(notPrevented).toBe(false);
    expect(useRoomWalkStore.getState().status).toBe('idle');
    expect(useRoomWalkStore.getState().target).toBeUndefined();
  });

  it('ignores Escape pressed on other elements', () => {
    renderScene();
    toggleView();
    act(() => {
      useRoomWalkStore.getState().startWalkTo(WALK_TARGET);
    });
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    fireEvent.keyDown(other, { code: CANCEL_WALK_CODE });
    fireEvent.keyDown(document.body, { code: CANCEL_WALK_CODE });

    expect(useRoomWalkStore.getState().status).toBe('walking');
    other.remove();
  });

  it('switches the camera mode and its description with V while the interior view is focused', () => {
    renderScene();
    toggleView();
    const region = getRegion();
    expect(region).toHaveFocus();

    const notPrevented = fireEvent.keyDown(region, { code: CAMERA_MODE_CODE });

    expect(notPrevented).toBe(false);
    expect(getCameraMode()).toBe('thirdPerson');
    expect(screen.getByText(THIRD_PERSON_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(INTERIOR_DESCRIPTION)).toBeNull();

    fireEvent.keyDown(region, { code: CAMERA_MODE_CODE });

    expect(getCameraMode()).toBe('firstPerson');
    expect(screen.getByText(INTERIOR_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(THIRD_PERSON_DESCRIPTION)).toBeNull();
  });

  it('ignores V in the exterior view', () => {
    renderScene();

    fireEvent.keyDown(getRegion(), { code: CAMERA_MODE_CODE });

    expect(getCameraMode()).toBe('firstPerson');
    expect(screen.getByText(EXTERIOR_DESCRIPTION)).toBeInTheDocument();
  });

  it('ignores V pressed on other elements', () => {
    renderScene();
    toggleView();
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    fireEvent.keyDown(other, { code: CAMERA_MODE_CODE });
    fireEvent.keyDown(document.body, { code: CAMERA_MODE_CODE });

    expect(getCameraMode()).toBe('firstPerson');
    other.remove();
  });

  it('ignores Ctrl+V on the interior view', () => {
    renderScene();
    toggleView();

    const notPrevented = fireEvent.keyDown(getRegion(), { code: CAMERA_MODE_CODE, ctrlKey: true });

    expect(notPrevented).toBe(true);
    expect(getCameraMode()).toBe('firstPerson');
  });

  it('keeps the camera mode when leaving and re-entering the interior view', () => {
    renderScene();
    toggleView();
    fireEvent.keyDown(getRegion(), { code: CAMERA_MODE_CODE });

    toggleView();
    toggleView();

    expect(getCameraMode()).toBe('thirdPerson');
    expect(screen.getByText(THIRD_PERSON_DESCRIPTION)).toBeInTheDocument();
  });
});

describe('the ground plane', () => {
  it('lies a whole storey below the slab underside, derived from FLOOR_HEIGHTS', () => {
    const slabUnderside = -getSlabThickness();

    // Derived, not written down: the level is the slab underside less whole floor-to-floor
    // heights, so a change to either height in `heights.ts` moves the ground with the building.
    expect(GROUND_LEVEL).toBeCloseTo(
      slabUnderside - FLOOR_HEIGHTS.floorToFloor * GROUND_STOREYS_BELOW_SLAB,
      PRECISION_DIGITS,
    );
    // At least one storey down, so the 1.00 m side-B void reads as a shaft through the floor
    // rather than as the flat grey strip it read as when the ground sat 0.35 m under the slabs.
    expect(GROUND_STOREYS_BELOW_SLAB).toBeGreaterThanOrEqual(MINIMUM_STOREYS_BELOW);
    expect(slabUnderside - GROUND_LEVEL).toBeGreaterThanOrEqual(FLOOR_HEIGHTS.floorToFloor);
    expect(GROUND_LEVEL).toBeLessThan(slabUnderside);
  });
});

describe('the storey count in the scene', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useFloorCountStore.setState(useFloorCountStore.getInitialState(), true);
    floorModels.length = 0;
  });

  it('hands the built floor the count the store holds', () => {
    renderScene();

    expect(builtModels()).toHaveLength(ONE_MODEL);
    expect(lastModel().floorCount).toBe(MIN_FLOOR_COUNT);
    expect(lastModel().showCeilings).toBe(false);
  });

  it('hands down a new count as soon as the stepper changes it', () => {
    renderScene();

    act(() => {
      useFloorCountStore.getState().setFloorCount(MAX_FLOOR_COUNT);
    });

    expect(lastModel().floorCount).toBe(MAX_FLOOR_COUNT);
  });

  it('keeps the count through a change of view, with the ceilings inside', () => {
    renderScene();
    act(() => {
      useFloorCountStore.getState().setFloorCount(MAX_FLOOR_COUNT);
    });

    toggleView();

    expect(lastModel().floorCount).toBe(MAX_FLOOR_COUNT);
    expect(lastModel().showCeilings).toBe(true);
  });
});

describe('the scene camera', () => {
  it('sees far enough for a ten-storey building to stay inside the fog', () => {
    expect(CAMERA_FAR).toBe(EXPECTED_CAMERA_FAR);
    // It was 500 while one storey was drawn, and the fog already reaches ~365 m there; the
    // fog grows with the height of the stack and would pass 500 well before ten storeys.
    expect(CAMERA_FAR).toBeGreaterThan(PREVIOUS_CAMERA_FAR);
  });
});
