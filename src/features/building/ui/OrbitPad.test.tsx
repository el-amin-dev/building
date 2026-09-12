import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useOrbitControlStore } from '../application/orbitControlStore.ts';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { ORBIT_ACTIONS } from '../domain/orbitNavigation.ts';
import type { OrbitAction } from '../domain/orbitNavigation.ts';
import { OrbitPad } from './OrbitPad.tsx';
import { RemoteControl } from './RemoteControl.tsx';

const GROUP_NAME = 'Camera control';
const REMOTE_GROUP_NAME = 'Remote control';
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
