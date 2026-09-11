import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { BuildingScene } from './BuildingScene.tsx';
import { NAVIGATION_HINT_ID } from './hudIds.ts';
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
const EXTERIOR_DESCRIPTION =
  '3D view of the chamber from outside. The camera moves by dragging and scrolling; keyboard camera controls are not available in this view yet.';
const INTERIOR_DESCRIPTION =
  'Eye-level 3D view inside the chamber. Move and look around with the keys listed in the navigation hint.';
const HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. Keys follow their positions on a QWERTY keyboard. Press Tab to reach the view toggle.';

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
});
