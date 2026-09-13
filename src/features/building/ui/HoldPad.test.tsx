import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHoldToActStore } from '../application/createHoldToActStore.ts';
import { HoldPad } from './HoldPad.tsx';
import type { HoldPadCluster, HoldPadProps } from './HoldPad.tsx';

const GROUP_NAME = 'Test pad';
/** A stand-in vocabulary: the pad knows nothing of any real action set. */
const PAD_ACTIONS = Object.freeze(['alpha', 'beta', 'gamma', 'delta'] as const);
type PadAction = (typeof PAD_ACTIONS)[number];

const FIRST_CAPTION = 'First';
const SECOND_CAPTION = 'Second';
const ALPHA_GLYPH = '↑';

/** Two clusters: one of two single-button rows, one of a two-button row. */
const CLUSTERS: readonly HoldPadCluster<PadAction>[] = [
  {
    caption: FIRST_CAPTION,
    rows: [
      [{ action: 'alpha', label: 'Alpha', glyph: ALPHA_GLYPH }],
      [{ action: 'beta', label: 'Beta', glyph: '↓' }],
    ],
  },
  {
    caption: SECOND_CAPTION,
    rows: [
      [
        { action: 'gamma', label: 'Gamma', glyph: '←' },
        { action: 'delta', label: 'Delta', glyph: '→' },
      ],
    ],
  },
];

/** The accessible name of every button, in the pad's reading order. */
const BUTTON_NAMES: ReadonlyArray<readonly [PadAction, string]> = [
  ['alpha', 'Alpha'],
  ['beta', 'Beta'],
  ['gamma', 'Gamma'],
  ['delta', 'Delta'],
];

const REGION_ID = 'test-view-region';
const REGION_TEST_ID = 'test-view-region-element';
const FOCUSABLE_TAB_INDEX = 0;
const SPACE_KEY = ' ';
const ENTER_KEY = 'Enter';
const FIRST_POINTER_ID = 1;
const SECOND_POINTER_ID = 2;
/** A pointer id the pad never saw go down, e.g. a click somewhere else in the page. */
const UNKNOWN_POINTER_ID = 7;

const useTestPadStore = createHoldToActStore<PadAction>();

function activeActions(): ReadonlySet<PadAction> {
  return useTestPadStore.getState().activeActions;
}

/** Every press and release the pad asked the store for, in order. */
interface ActionLog {
  readonly pressed: PadAction[];
  readonly released: PadAction[];
}

/**
 * Starts logging the store calls the pad makes, to tell one release from two and a real
 * release from a no-op on an action that was never held. Call before rendering.
 *
 * @returns The log, filled in as the pad presses and releases.
 */
function recordActionCalls(): ActionLog {
  const log: ActionLog = { pressed: [], released: [] };
  const { pressAction, releaseAction } = useTestPadStore.getState();
  useTestPadStore.setState({
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

function padElement(overrides: Partial<HoldPadProps<PadAction>> = {}) {
  return (
    <HoldPad
      groupLabel={GROUP_NAME}
      clusters={CLUSTERS}
      store={useTestPadStore}
      active
      {...overrides}
    />
  );
}

function renderPad(overrides: Partial<HoldPadProps<PadAction>> = {}) {
  return render(padElement(overrides));
}

/** Renders a focusable stand-in for the view region before the pad, as in the app. */
function renderPadWithRegion(overrides: Partial<HoldPadProps<PadAction>> = {}) {
  render(
    <>
      <div id={REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      {padElement({ focusTargetId: REGION_ID, ...overrides })}
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
}

function getButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('HoldPad', () => {
  beforeEach(() => {
    useTestPadStore.setState(useTestPadStore.getInitialState(), true);
  });

  it('renders nothing while it is inactive', () => {
    const { container } = renderPad({ active: false });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
  });

  it('releases every held action when it is rendered inactive', () => {
    renderPad();
    fireEvent.pointerDown(getButton('Alpha'), { pointerId: FIRST_POINTER_ID });
    expect(activeActions().size).toBe(1);

    renderPad({ active: false });

    expect(activeActions().size).toBe(0);
  });

  it('offers exactly one button per action of its clusters', () => {
    renderPad();

    expect(screen.getAllByRole('button')).toHaveLength(PAD_ACTIONS.length);
    for (const [, name] of BUTTON_NAMES) {
      expect(getButton(name)).toHaveAttribute('type', 'button');
    }
  });

  it('names the pad and every button for assistive technology', () => {
    renderPad();

    expect(screen.getByRole('group', { name: GROUP_NAME })).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(BUTTON_NAMES.map(([, name]) => name));
  });

  it('hides the cluster captions and the glyphs from assistive technology', () => {
    renderPad();

    expect(screen.getByText(FIRST_CAPTION)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(SECOND_CAPTION)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(ALPHA_GLYPH)).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(BUTTON_NAMES)('holds %s alone while "%s" is pressed with a pointer', (action, name) => {
    renderPad();
    const button = getButton(name);

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set([action]));
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('releases the action when the pointer goes up', () => {
    renderPad();
    const button = getButton('Alpha');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases the action when the pointer is cancelled', () => {
    renderPad();
    const button = getButton('Beta');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerCancel(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
  });

  it('releases the action when the pointer capture is lost', () => {
    renderPad();
    const button = getButton('Gamma');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.lostPointerCapture(button, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
  });

  it('releases the held action when its own pointer goes up outside the pad', () => {
    renderPad();
    const button = getButton('Alpha');

    // No pointer capture in jsdom, so the release lands on the body: the window net has to
    // catch it, or the action would stay held forever.
    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases nothing when a pointer the pad never held goes up', () => {
    renderPad();
    const button = getButton('Alpha');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(document.body, { pointerId: UNKNOWN_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['alpha']));
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('releases only the lifted pointer when a second finger holds another button', () => {
    renderPad();
    const alpha = getButton('Alpha');
    const gamma = getButton('Gamma');

    // Two fingers on two buttons, the way two axes are driven at once.
    fireEvent.pointerDown(alpha, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(gamma, { pointerId: SECOND_POINTER_ID });
    expect(activeActions()).toEqual(new Set(['alpha', 'gamma']));

    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['gamma']));
    expect(alpha).toHaveAttribute('aria-pressed', 'false');
    expect(gamma).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerUp(document.body, { pointerId: SECOND_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(gamma).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases only the cancelled pointer when the browser takes it over', () => {
    renderPad();
    const alpha = getButton('Alpha');
    const gamma = getButton('Gamma');

    fireEvent.pointerDown(alpha, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(gamma, { pointerId: SECOND_POINTER_ID });

    fireEvent.pointerCancel(document.body, { pointerId: SECOND_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['alpha']));
    expect(alpha).toHaveAttribute('aria-pressed', 'true');
    expect(gamma).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a button held while a second finger is still pressing it', () => {
    renderPad();
    const alpha = getButton('Alpha');

    fireEvent.pointerDown(alpha, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(alpha, { pointerId: SECOND_POINTER_ID });

    fireEvent.pointerUp(alpha, { pointerId: FIRST_POINTER_ID });
    expect(activeActions()).toEqual(new Set(['alpha']));
    expect(alpha).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerUp(alpha, { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(0);
    expect(alpha).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases what the pointer really holds when the finger slides onto another button', () => {
    const log = recordActionCalls();
    renderPad();

    // Without pointer capture (jsdom, older WebViews), a finger that slid off "Alpha" lifts
    // over its neighbour, whose own release must not swallow the pointer.
    fireEvent.pointerDown(getButton('Alpha'), { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(getButton('Gamma'), { pointerId: FIRST_POINTER_ID });

    expect(log.pressed).toEqual(['alpha']);
    expect(log.released).toEqual(['alpha']);
    expect(activeActions().size).toBe(0);
    expect(getButton('Alpha')).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves a pointer another button holds in the ledger', () => {
    renderPad();
    const alpha = getButton('Alpha');

    fireEvent.pointerDown(alpha, { pointerId: FIRST_POINTER_ID });
    // A capture lost on a button this pointer never pressed: not that button's hold to end.
    fireEvent.lostPointerCapture(getButton('Gamma'), { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['alpha']));
    expect(alpha).toHaveAttribute('aria-pressed', 'true');

    // The entry survived, so the pointer's own release still ends the hold.
    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions().size).toBe(0);
    expect(alpha).toHaveAttribute('aria-pressed', 'false');
  });

  it('releases every held action when the window loses focus', () => {
    renderPad();

    fireEvent.pointerDown(getButton('Alpha'), { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(getButton('Gamma'), { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(2);

    fireEvent.blur(window);

    expect(activeActions().size).toBe(0);
  });

  it.each([SPACE_KEY, ENTER_KEY])('holds the action while %j is held down', (key) => {
    renderPad();
    const button = getButton('Alpha');
    act(() => {
      button.focus();
    });

    fireEvent.keyDown(button, { key });
    expect(activeActions()).toEqual(new Set(['alpha']));
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyUp(button, { key });
    expect(activeActions().size).toBe(0);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('ignores an auto-repeated key press', () => {
    renderPad();

    fireEvent.keyDown(getButton('Alpha'), { key: SPACE_KEY, repeat: true });

    expect(activeActions().size).toBe(0);
  });

  it('ignores keys that do not activate a button', () => {
    renderPad();

    fireEvent.keyDown(getButton('Alpha'), { key: 'Tab' });

    expect(activeActions().size).toBe(0);
  });

  it('releases the action when the button loses focus', () => {
    renderPad();
    const button = getButton('Beta');
    act(() => {
      button.focus();
    });

    fireEvent.keyDown(button, { key: SPACE_KEY });
    expect(activeActions().size).toBe(1);

    fireEvent.blur(button);

    expect(activeActions().size).toBe(0);
  });

  it('keeps a finger hold when focus leaves the button', () => {
    renderPadWithRegion();
    const button = getButton('Alpha');
    act(() => {
      button.focus();
    });

    // Handing focus back to the 3D view blurs the button while the finger is still down.
    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.blur(button);

    expect(activeActions()).toEqual(new Set(['alpha']));
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });
    expect(activeActions().size).toBe(0);
  });

  it('clears the whole ledger when it goes inactive with two fingers down', () => {
    const { rerender } = renderPad();
    const alpha = getButton('Alpha');
    fireEvent.pointerDown(alpha, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(alpha, { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(1);

    rerender(padElement({ active: false }));
    expect(activeActions().size).toBe(0);

    // Active again, the forgotten pointers release nothing: the ledger was emptied too.
    rerender(padElement());
    fireEvent.pointerDown(getButton('Gamma'), { pointerId: SECOND_POINTER_ID });
    fireEvent.pointerUp(document.body, { pointerId: FIRST_POINTER_ID });

    expect(activeActions()).toEqual(new Set(['gamma']));
  });

  it('releases a doubly held action when it unmounts', () => {
    const { unmount } = renderPad();
    const alpha = getButton('Alpha');
    fireEvent.pointerDown(alpha, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(alpha, { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(1);

    unmount();

    expect(activeActions().size).toBe(0);
  });

  it('releases every held action when it unmounts', () => {
    const { unmount } = renderPad();
    fireEvent.pointerDown(getButton('Alpha'), { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerDown(getButton('Gamma'), { pointerId: SECOND_POINTER_ID });
    expect(activeActions().size).toBe(2);

    unmount();

    expect(activeActions().size).toBe(0);
  });

  it('reflects actions held elsewhere in aria-pressed', () => {
    renderPad();

    act(() => {
      useTestPadStore.getState().pressAction('delta');
    });

    expect(getButton('Delta')).toHaveAttribute('aria-pressed', 'true');
    expect(getButton('Gamma')).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves focus back to the view region after a pointer hold', () => {
    const region = renderPadWithRegion();
    const button = getButton('Alpha');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });

    expect(region).toHaveFocus();
  });

  it('leaves focus alone after a pointer hold when no focus target is given', () => {
    const region = renderPadWithRegion({ focusTargetId: undefined });
    const button = getButton('Alpha');

    fireEvent.pointerDown(button, { pointerId: FIRST_POINTER_ID });
    fireEvent.pointerUp(button, { pointerId: FIRST_POINTER_ID });

    expect(region).not.toHaveFocus();
  });

  it('keeps focus on the button when it is held with the keyboard', () => {
    renderPadWithRegion();
    const button = getButton('Alpha');
    act(() => {
      button.focus();
    });

    fireEvent.keyDown(button, { key: SPACE_KEY });
    expect(button).toHaveFocus();

    fireEvent.keyUp(button, { key: SPACE_KEY });
    expect(button).toHaveFocus();
  });

  it('is reachable with Tab after the view region', async () => {
    const user = userEvent.setup();
    const region = renderPadWithRegion();

    await user.tab();
    expect(region).toHaveFocus();

    await user.tab();
    expect(getButton('Alpha')).toHaveFocus();
  });
});
