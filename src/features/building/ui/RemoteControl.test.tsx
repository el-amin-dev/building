import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { EYE_ACTIONS } from '../domain/eyeNavigation.ts';
import type { EyeAction } from '../domain/eyeNavigation.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';
import { RemoteControl } from './RemoteControl.tsx';

const GROUP_NAME = 'Remote control';
const REGION_TEST_ID = 'interior-region';
const FOCUSABLE_TAB_INDEX = 0;
const SPACE_KEY = ' ';
const ENTER_KEY = 'Enter';
const FIRST_POINTER_ID = 1;
const SECOND_POINTER_ID = 2;

/** The accessible name of every button, in the pad's reading order. */
const BUTTON_NAMES: ReadonlyArray<readonly [EyeAction, string]> = [
  ['moveForward', 'Move forward'],
  ['moveBackward', 'Move back'],
  ['strafeLeft', 'Strafe left'],
  ['strafeRight', 'Strafe right'],
  ['turnLeft', 'Turn left'],
  ['turnRight', 'Turn right'],
  ['lookUp', 'Look up'],
  ['lookDown', 'Look down'],
];

function toggleView() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function activeActions(): ReadonlySet<EyeAction> {
  return useRemoteControlStore.getState().activeActions;
}

function getButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/** Renders a focusable stand-in for the interior region before the pad, as in the app. */
function renderWithRegion() {
  render(
    <>
      <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      <RemoteControl />
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
}

describe('RemoteControl', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useRemoteControlStore.setState(useRemoteControlStore.getInitialState(), true);
  });

  it('renders nothing in the exterior view', () => {
    const { container } = render(<RemoteControl />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
  });

  it('appears with the interior view and disappears when leaving it', () => {
    render(<RemoteControl />);

    toggleView();
    expect(screen.getByRole('group', { name: GROUP_NAME })).toBeInTheDocument();

    toggleView();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
  });

  it('offers exactly one button per navigation action', () => {
    toggleView();
    render(<RemoteControl />);

    expect(BUTTON_NAMES.map(([action]) => action)).toEqual([...EYE_ACTIONS]);
    expect(screen.getAllByRole('button')).toHaveLength(EYE_ACTIONS.length);
  });

  it.each(BUTTON_NAMES)('holds %s alone while "%s" is pressed with a pointer', (action, name) => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton(name);

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set([action]));
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('releases the action when the pointer goes up', () => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton('Turn left');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases the action when the pointer is cancelled', () => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton('Turn right');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerCancel(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
  });

  it('releases the action when the pointer capture is lost', () => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton('Move forward');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.lostPointerCapture(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
  });

  it.each([SPACE_KEY, ENTER_KEY])('holds the action while %j is held down', (key) => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton('Look up');
    act(() => {
      button.focus();
    });

    fireEvent.keyDown(button, { key });
    expect(activeActions()).toEqual(new Set(['lookUp']));
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyUp(button, { key });
    expect(activeActions().size).toBe(0);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('ignores an auto-repeated key press', () => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton('Look down');

    fireEvent.keyDown(button, { key: SPACE_KEY, repeat: true });

    expect(activeActions().size).toBe(0);
  });

  it('ignores keys that do not activate a button', () => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton('Move back');

    fireEvent.keyDown(button, { key: 'Tab' });

    expect(activeActions().size).toBe(0);
  });

  it('releases the action when the button loses focus', () => {
    toggleView();
    render(<RemoteControl />);
    const button = getButton('Strafe left');
    act(() => {
      button.focus();
    });

    fireEvent.keyDown(button, { key: SPACE_KEY });
    expect(activeActions().size).toBe(1);

    fireEvent.blur(button);

    expect(activeActions().size).toBe(0);
  });

  it('releases every held action when the window loses focus', () => {
    toggleView();
    render(<RemoteControl />);

    fireEvent.pointerDown(getButton('Move forward'), { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(getButton('Turn left'), { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(2);

    fireEvent.blur(window);

    expect(activeActions().size).toBe(0);
  });

  it('releases every held action when a pointer goes up outside the pad', () => {
    toggleView();
    render(<RemoteControl />);

    fireEvent.pointerDown(getButton('Move forward'), { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(getButton('Turn left'), { pointerId: SECOND_POINTER_ID });

    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
  });

  it('releases every held action when it unmounts', () => {
    toggleView();
    const { unmount } = render(<RemoteControl />);
    fireEvent.pointerDown(getButton('Turn left'), { pointerId: FIRST_POINTER_ID });
    expect(activeActions().size).toBe(1);

    unmount();

    expect(activeActions().size).toBe(0);
  });

  it('releases every held action when the view leaves the interior', () => {
    toggleView();
    render(<RemoteControl />);
    fireEvent.pointerDown(getButton('Turn right'), { pointerId: FIRST_POINTER_ID });
    expect(activeActions().size).toBe(1);

    toggleView();

    expect(activeActions().size).toBe(0);
  });

  it('reflects actions held elsewhere in aria-pressed', () => {
    toggleView();
    render(<RemoteControl />);

    act(() => {
      useRemoteControlStore.getState().pressAction('strafeRight');
    });

    expect(getButton('Strafe right')).toHaveAttribute('aria-pressed', 'true');
    expect(getButton('Strafe left')).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves focus back to the interior region after a pointer hold', () => {
    toggleView();
    const region = renderWithRegion();
    const button = getButton('Move forward');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });

    expect(region).toHaveFocus();
  });

  it('keeps focus on the button when it is held with the keyboard', () => {
    toggleView();
    renderWithRegion();
    const button = getButton('Move forward');
    act(() => {
      button.focus();
    });

    fireEvent.keyDown(button, { key: SPACE_KEY });
    expect(button).toHaveFocus();

    fireEvent.keyUp(button, { key: SPACE_KEY });
    expect(button).toHaveFocus();
  });

  it('is reachable with Tab after the interior region', async () => {
    const user = userEvent.setup();
    toggleView();
    const region = renderWithRegion();

    await user.tab();
    expect(region).toHaveFocus();

    await user.tab();
    expect(getButton('Move forward')).toHaveFocus();
  });

  it('names the pad and every button for assistive technology', () => {
    toggleView();
    render(<RemoteControl />);

    expect(screen.getByRole('group', { name: GROUP_NAME })).toBeInTheDocument();
    for (const [, name] of BUTTON_NAMES) {
      expect(getButton(name)).toHaveAttribute('type', 'button');
    }
  });
});
