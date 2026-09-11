import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { BuildingScene } from './BuildingScene.tsx';
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
const CAMERA_MODE_CODE = 'KeyV';
const EXTERIOR_DESCRIPTION =
  '3D view of the chamber from outside. The camera moves by dragging and scrolling; keyboard camera controls are not available in this view yet.';
const INTERIOR_DESCRIPTION =
  'Eye-level 3D view inside the chamber. Move and look around with the keys listed in the navigation hint.';
const THIRD_PERSON_DESCRIPTION =
  'Third-person 3D view following your person inside the chamber. Move and look around with the keys listed in the navigation hint.';
const HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. Press Tab to reach the view toggle, then the Third person toggle, then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';

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
  });

  it('exposes no application region and no tab stop in the exterior view', () => {
    renderScene();

    expect(screen.queryByRole('application')).toBeNull();
    const region = getRegion();
    expect(region).not.toHaveAttribute('tabindex');
    expect(region).not.toHaveAttribute('aria-label');
    expect(region).not.toHaveAttribute('aria-describedby');
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

  it('removes the application role and tab stop when going back to the exterior view', () => {
    renderScene();
    toggleView();

    toggleView();

    expect(screen.queryByRole('application')).toBeNull();
    const region = getRegion();
    expect(region).not.toHaveAttribute('tabindex');
    expect(region).not.toHaveAttribute('aria-label');
    expect(region).not.toHaveAttribute('aria-describedby');
    expect(screen.getByText(EXTERIOR_DESCRIPTION)).toBeInTheDocument();
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
