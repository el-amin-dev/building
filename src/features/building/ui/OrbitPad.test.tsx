import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useOrbitControlStore } from '../application/orbitControlStore.ts';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { ORBIT_ACTIONS } from '../domain/orbitNavigation.ts';
import type { OrbitAction } from '../domain/orbitNavigation.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';
import { OrbitPad } from './OrbitPad.tsx';
import { RemoteControl } from './RemoteControl.tsx';

const GROUP_NAME = 'Camera control';
const REMOTE_GROUP_NAME = 'Remote control';
const REGION_TEST_ID = 'exterior-region';
const FOCUSABLE_TAB_INDEX = 0;
const SPACE_KEY = ' ';
const ENTER_KEY = 'Enter';
const FIRST_POINTER_ID = 1;
/** Smallest target size the pad must offer on both axes: 44 px (WCAG 2.5.8). */
const TARGET_SIZE_CLASSES: readonly string[] = ['min-h-11', 'min-w-11'];

/** The accessible name of every button, in the pad's reading order. */
const BUTTON_NAMES: ReadonlyArray<readonly [OrbitAction, string]> = [
  ['orbitLeft', 'Rotate left'],
  ['orbitRight', 'Rotate right'],
  ['tiltUp', 'Tilt up'],
  ['tiltDown', 'Tilt down'],
  ['zoomIn', 'Zoom in'],
  ['zoomOut', 'Zoom out'],
];

function toggleView() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function activeActions(): ReadonlySet<OrbitAction> {
  return useOrbitControlStore.getState().activeActions;
}

function getButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/**
 * Renders a focusable stand-in for the 3D view region before the pad, as in the app: one
 * element serves both views and keeps the id `INTERIOR_REGION_ID` (ADR-013).
 */
function renderWithRegion() {
  render(
    <>
      <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      <OrbitPad />
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
}

describe('OrbitPad', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useOrbitControlStore.setState(useOrbitControlStore.getInitialState(), true);
    useRemoteControlStore.setState(useRemoteControlStore.getInitialState(), true);
  });

  it('offers exactly one button per orbit action, in the reading order of the vocabulary', () => {
    render(<OrbitPad />);

    expect(BUTTON_NAMES.map(([action]) => action)).toEqual([...ORBIT_ACTIONS]);
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(BUTTON_NAMES.map(([, name]) => name));
  });

  it('names the pad and every button for assistive technology', () => {
    render(<OrbitPad />);

    expect(screen.getByRole('group', { name: GROUP_NAME })).toBeInTheDocument();
    for (const [, name] of BUTTON_NAMES) {
      expect(getButton(name)).toHaveAttribute('type', 'button');
    }
  });

  it('gives every button a target of at least 44 px on both axes', () => {
    render(<OrbitPad />);

    for (const [, name] of BUTTON_NAMES) {
      expect(getButton(name)).toHaveClass(...TARGET_SIZE_CLASSES);
    }
  });

  it('appears in the exterior view and disappears when entering the interior', () => {
    render(<OrbitPad />);
    expect(screen.getByRole('group', { name: GROUP_NAME })).toBeInTheDocument();

    toggleView();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();

    toggleView();
    expect(screen.getByRole('group', { name: GROUP_NAME })).toBeInTheDocument();
  });

  it.each(BUTTON_NAMES)('holds %s alone while "%s" is pressed with a pointer', (action, name) => {
    render(<OrbitPad />);
    const button = getButton(name);

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set([action]));
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });
    expect(activeActions().size).toBe(0);
  });

  it('releases every held action when the view leaves the exterior', () => {
    render(<OrbitPad />);
    fireEvent.pointerDown(getButton('Rotate left'), { pointerId: FIRST_POINTER_ID });
    expect(activeActions().size).toBe(1);

    toggleView();

    expect(activeActions().size).toBe(0);
  });

  it('reflects actions held elsewhere in aria-pressed', () => {
    render(<OrbitPad />);

    act(() => {
      useOrbitControlStore.getState().pressAction('zoomIn');
    });

    expect(getButton('Zoom in')).toHaveAttribute('aria-pressed', 'true');
    expect(getButton('Zoom out')).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves focus back to the 3D view region after a pointer hold', () => {
    const region = renderWithRegion();
    const button = getButton('Rotate left');

    // Without this the orbit keys stay dead until the viewer Tabs back out of the pad.
    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });

    expect(region).toHaveFocus();
  });

  it.each([SPACE_KEY, ENTER_KEY])('keeps focus on the button when it is held with %j', (key) => {
    const region = renderWithRegion();
    const button = getButton('Zoom in');
    act(() => {
      button.focus();
    });

    // A keyboard hold ends where the user put focus: moving it would be an unexpected
    // focus change, so the pointer route and the keyboard route differ on purpose.
    fireEvent.keyDown(button, { key });
    expect(button).toHaveFocus();

    fireEvent.keyUp(button, { key });
    expect(button).toHaveFocus();
    expect(region).not.toHaveFocus();
  });

  it('is never mounted at the same time as the remote control', () => {
    // The two pads share one HUD anchor, which only holds because the views are exclusive.
    render(
      <>
        <OrbitPad />
        <RemoteControl />
      </>,
    );

    expect(screen.getByRole('group', { name: GROUP_NAME })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: REMOTE_GROUP_NAME })).toBeNull();
    expect(screen.getAllByRole('group')).toHaveLength(1);

    toggleView();

    expect(screen.getByRole('group', { name: REMOTE_GROUP_NAME })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });
});
