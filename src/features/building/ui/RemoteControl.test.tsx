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
/** A pointer id the pad never saw go down, e.g. a click somewhere else in the page. */
const UNKNOWN_POINTER_ID = 7;

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

/** Every press and release the pad asked the store for, in order. */
interface ActionLog {
  readonly pressed: EyeAction[];
  readonly released: EyeAction[];
}

/**
 * Starts logging the store calls the pad makes, to tell one release from two and a real
 * release from a no-op on an action that was never held. Call before rendering.
 *
 * @returns The log, filled in as the pad presses and releases.
 */
function recordActionCalls(): ActionLog {
  const log: ActionLog = { pressed: [], released: [] };
  const { pressAction, releaseAction } = useRemoteControlStore.getState();
  useRemoteControlStore.setState({
    pressAction: (action) => {
      log.pressed.push(action);
      pressAction(action);
    },
    releaseAction: (action) => {
      log.released.push(action);
      releaseAction(action);
    },
  });
  return log;
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

  it('releases only the lifted pointer when a second finger holds another button', () => {
    toggleView();
    render(<RemoteControl />);
    const forward = getButton('Move forward');
    const turnLeft = getButton('Turn left');

    // Walking while turning: one finger on each button, as a walk around a corner is done.
    fireEvent.pointerDown(forward, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(turnLeft, { pointerId: SECOND_POINTER_ID });
    expect(activeActions()).toEqual(new Set(['moveForward', 'turnLeft']));

    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['turnLeft']));
    expect(forward).toHaveAttribute('aria-pressed', 'false');
    expect(turnLeft).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerUp(document.body, { pointerId: SECOND_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(turnLeft).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases only the cancelled pointer when the browser takes it over', () => {
    toggleView();
    render(<RemoteControl />);
    const forward = getButton('Move forward');
    const turnRight = getButton('Turn right');

    fireEvent.pointerDown(forward, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(turnRight, { pointerId: SECOND_POINTER_ID });

    fireEvent.pointerCancel(document.body, { pointerId: SECOND_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['moveForward']));
    expect(forward).toHaveAttribute('aria-pressed', 'true');
    expect(turnRight).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases nothing when a pointer the pad never held goes up', () => {
    toggleView();
    render(<RemoteControl />);
    const turnLeft = getButton('Turn left');

    fireEvent.pointerDown(turnLeft, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(document.body, { pointerId: UNKNOWN_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['turnLeft']));
    expect(turnLeft).toHaveAttribute('aria-pressed', 'true');
  });

  it('releases the held action when its own pointer goes up outside the pad', () => {
    toggleView();
    render(<RemoteControl />);
    const turnLeft = getButton('Turn left');

    // No pointer capture in jsdom, so the release lands on the body: the window net has to
    // catch it, or the turn would spin the camera forever.
    fireEvent.pointerDown(turnLeft, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(turnLeft).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases what the pointer really holds when the finger slides onto another button', () => {
    toggleView();
    const log = recordActionCalls();
    render(<RemoteControl />);

    // Without pointer capture (jsdom, older WebViews), a finger that slid off "Turn left"
    // lifts over its neighbour, whose own release must not swallow the pointer.
    fireEvent.pointerDown(getButton('Turn left'), { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(getButton('Move forward'), { pointerId: FIRST_POINTER_ID });

    expect(log.pressed).toEqual(['turnLeft']);
    expect(log.released).toEqual(['turnLeft']);
    expect(activeActions().size).toBe(0);
    expect(getButton('Turn left')).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves a pointer another button holds in the ledger', () => {
    toggleView();
    render(<RemoteControl />);
    const turnLeft = getButton('Turn left');

    fireEvent.pointerDown(turnLeft, { pointerId: FIRST_POINTER_ID });
    // A capture lost on a button this pointer never pressed: not that button's hold to end.
    fireEvent.lostPointerCapture(getButton('Move forward'), { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['turnLeft']));
    expect(turnLeft).toHaveAttribute('aria-pressed', 'true');

    // The entry survived, so the pointer's own release still ends the turn.
    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(turnLeft).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a button held while a second finger is still pressing it', () => {
    toggleView();
    render(<RemoteControl />);
    const forward = getButton('Move forward');

    fireEvent.pointerDown(forward, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(forward, { pointerId: SECOND_POINTER_ID });

    fireEvent.pointerUp(forward, { pointerId: FIRST_POINTER_ID });
    expect(activeActions()).toEqual(new Set(['moveForward']));
    expect(forward).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerUp(forward, { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(0);
    expect(forward).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a finger hold when focus leaves the button', () => {
    toggleView();
    renderWithRegion();
    const forward = getButton('Move forward');
    act(() => {
      forward.focus();
    });

    // Handing focus back to the 3D view blurs the button while the finger is still down.
    fireEvent.pointerDown(forward, { pointerId: FIRST_POINTER_ID });
    fireEvent.blur(forward);

    expect(activeActions()).toEqual(new Set(['moveForward']));
    expect(forward).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerUp(forward, { pointerId: FIRST_POINTER_ID });
    expect(activeActions().size).toBe(0);
  });

  it('clears the whole ledger when the view leaves the interior with two fingers down', () => {
    toggleView();
    render(<RemoteControl />);
    const forward = getButton('Move forward');
    fireEvent.pointerDown(forward, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(forward, { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(1);

    toggleView();
    expect(activeActions().size).toBe(0);

    // Back inside, the forgotten pointers release nothing: the ledger was emptied too.
    toggleView();
    fireEvent.pointerDown(getButton('Turn left'), { pointerId: SECOND_POINTER_ID });
    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['turnLeft']));
  });

  it('releases a doubly held action when it unmounts', () => {
    toggleView();
    const { unmount } = render(<RemoteControl />);
    const forward = getButton('Move forward');
    fireEvent.pointerDown(forward, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(forward, { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(1);

    unmount();

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
