import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { getSlabThickness } from '../domain/slabs.ts';
import { BuildingScene, GROUND_LEVEL, GROUND_STOREYS_BELOW_SLAB } from './BuildingScene.tsx';
import { INTERIOR_REGION_ID, NAVIGATION_HINT_ID } from './hudIds.ts';
import { NavigationHint } from './NavigationHint.tsx';

const { CANVAS_TEST_ID } = vi.hoisted(() => ({ CANVAS_TEST_ID: 'scene-canvas' }));

// jsdom has no WebGL: the canvas is replaced by a plain element and its scene graph is never
// rendered, so the hooks used inside it are inert and drei (and the CommonJS three build it
// would load) is skipped.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid={CANVAS_TEST_ID} />,
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));

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
const WALK_TARGET = 'kitchen';
const EXTERIOR_DESCRIPTION =
  '3D view of the whole floor from outside: its rooms, balconies, corridors and stairs, seen from above the open side of the building. Drag to orbit and scroll to zoom, or use the keyboard while this view has focus: the left and right arrows orbit around the building, the up and down arrows tilt over it, and the plus and minus keys zoom in and out. The on-screen camera pad in the HUD offers the same six movements without a keyboard.';
const INTERIOR_DESCRIPTION =
  'Eye-level 3D view inside the floor, opening on the stair arrival landing facing the corridor. Move and look around with the keys listed in the navigation hint; the whole floor is walkable, through its doors. The room readout in the HUD names the room you are standing in, "Go to room" walks you to any room of the floor, and the minimap shows where you are on it.';
const THIRD_PERSON_DESCRIPTION =
  'Third-person 3D view following your person inside the floor, opening on the stair arrival landing facing the corridor. Move and look around with the keys listed in the navigation hint; the whole floor is walkable, through its doors. The room readout in the HUD names the room you are standing in, "Go to room" walks you to any room of the floor, and the minimap shows where you are on it.';
const HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. The "Go to room" button in the HUD lists every room of the floor and walks you to the one you pick, through the doors; that walk stops when you activate the "Stop walking" button beside it, when you press Escape while the view has focus, or as soon as you move yourself with any key or pad button. In the exterior view the left and right arrows orbit the camera around the building, the up and down arrows tilt it, and the plus and minus keys zoom in and out; the on-screen camera pad offers those same six movements. Press Tab to reach the view toggle, then the Third person toggle, then "Go to room", then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';

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
