import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { FloorCountStepper } from './FloorCountStepper.tsx';
import { FLOOR_COUNT_VALUE_ID, INTERIOR_REGION_ID } from './hudIds.ts';

const DECREASE_NAME = 'Remove a floor';
const INCREASE_NAME = 'Add a floor';

/** What the live region says at the initial count: the announced sentence, not just `01`. */
const INITIAL_READING = 'Floors shown: 01';

/** The stepper's own buttons: `[−]` and `[+]`, and nothing else. */
const STEP_BUTTON_COUNT = 2;

/** Presses it takes to cross the whole range, 1 → 10 or back. */
const RANGE_PRESSES = MAX_FLOOR_COUNT - MIN_FLOOR_COUNT;

/** Somewhere in the middle of the range, where neither button is at a bound. */
const MIDDLE_COUNT = 4;

/**
 * `MouseEvent.detail` of a click fired by the keyboard (Enter or Space); a pointer click
 * counts up from 1.
 *
 * `CameraModeToggle` branches on exactly this to hand focus back to the 3D view after a
 * pointer click. The stepper deliberately does not, so the test below proves both halves:
 * that the click really was a pointer one (its detail is above this), and that focus stayed
 * on the button anyway.
 */
const KEYBOARD_CLICK_DETAIL = 0;

const REGION_TEST_ID = 'interior-region';
const FOCUSABLE_TAB_INDEX = 0;

function setFloorCount(count: number): void {
  act(() => {
    useFloorCountStore.getState().setFloorCount(count);
  });
}

function toggleView(): void {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function getDecrease(): HTMLElement {
  return screen.getByRole('button', { name: DECREASE_NAME });
}

function getIncrease(): HTMLElement {
  return screen.getByRole('button', { name: INCREASE_NAME });
}

/** The live reading, found by the id the buttons are `aria-describedby`. */
function getValue(): HTMLElement {
  const value = document.getElementById(FLOOR_COUNT_VALUE_ID);
  if (value === null) {
    throw new Error(`no element with id "${FLOOR_COUNT_VALUE_ID}" is in the document`);
  }
  return value;
}

/** Renders a focusable stand-in for the 3D view region before the stepper, as in the app. */
function renderWithRegion(): HTMLElement {
  render(
    <>
      <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      <FloorCountStepper />
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
}

describe('FloorCountStepper', () => {
  beforeEach(() => {
    useFloorCountStore.setState(useFloorCountStore.getInitialState(), true);
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('reads the initial count as a sentence, padded to two digits', () => {
    render(<FloorCountStepper />);

    expect(getValue().textContent).toBe(INITIAL_READING);
  });

  it('adds a storey on a press of the plus, in the reading and in the store', async () => {
    const user = userEvent.setup();
    render(<FloorCountStepper />);

    await user.click(getIncrease());

    expect(getValue().textContent).toBe('Floors shown: 02');
    expect(useFloorCountStore.getState().floorCount).toBe(2);
  });

  it('removes a storey on a press of the minus', async () => {
    const user = userEvent.setup();
    render(<FloorCountStepper />);
    setFloorCount(MIDDLE_COUNT);

    await user.click(getDecrease());

    expect(getValue().textContent).toBe('Floors shown: 03');
    expect(useFloorCountStore.getState().floorCount).toBe(3);
  });

  it('leaves both buttons operable away from the bounds', () => {
    render(<FloorCountStepper />);
    setFloorCount(MIDDLE_COUNT);

    expect(getDecrease()).toHaveAttribute('aria-disabled', 'false');
    expect(getIncrease()).toHaveAttribute('aria-disabled', 'false');
  });

  it('marks the minus aria-disabled at the minimum, and a press there changes nothing and keeps focus', async () => {
    const user = userEvent.setup();
    render(<FloorCountStepper />);
    const decrease = getDecrease();

    expect(decrease).toHaveAttribute('aria-disabled', 'true');
    // Never the `disabled` attribute: that would drop focus onto <body> mid-run.
    expect(decrease).not.toBeDisabled();

    await user.click(decrease);

    expect(useFloorCountStore.getState().floorCount).toBe(MIN_FLOOR_COUNT);
    expect(getValue().textContent).toBe(INITIAL_READING);
    expect(decrease).toHaveFocus();
  });

  it('marks the plus aria-disabled at the maximum, and a press there changes nothing and keeps focus', async () => {
    const user = userEvent.setup();
    render(<FloorCountStepper />);
    setFloorCount(MAX_FLOOR_COUNT);
    const increase = getIncrease();

    expect(increase).toHaveAttribute('aria-disabled', 'true');
    expect(increase).not.toBeDisabled();

    await user.click(increase);

    expect(useFloorCountStore.getState().floorCount).toBe(MAX_FLOOR_COUNT);
    expect(getValue().textContent).toBe('Floors shown: 10');
    expect(increase).toHaveFocus();
  });

  it('announces the reading politely and atomically, with no role of its own', () => {
    render(<FloorCountStepper />);
    const value = getValue();

    expect(value).toHaveAttribute('aria-live', 'polite');
    expect(value).toHaveAttribute('aria-atomic', 'true');
    // A role here would be a second `status` on the page, or a `spinbutton` whose value is
    // announced only while it has focus — and focus lives on the buttons.
    expect(value).not.toHaveAttribute('role');
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('adds no status region to the page', () => {
    render(<FloorCountStepper />);

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('is exactly two buttons, minus then reading then plus', () => {
    render(<FloorCountStepper />);
    const buttons = screen.getAllByRole('button');
    const value = getValue();

    expect(buttons).toHaveLength(STEP_BUTTON_COUNT);
    expect(buttons[0]).toHaveAccessibleName(DECREASE_NAME);
    expect(buttons[1]).toHaveAccessibleName(INCREASE_NAME);
    expect(value.previousElementSibling).toBe(buttons[0]);
    expect(value.nextElementSibling).toBe(buttons[1]);
  });

  it('describes both buttons by the reading, so the count is known before the first press', () => {
    render(<FloorCountStepper />);
    setFloorCount(3);

    expect(getDecrease()).toHaveAttribute('aria-describedby', FLOOR_COUNT_VALUE_ID);
    expect(getIncrease()).toHaveAttribute('aria-describedby', FLOOR_COUNT_VALUE_ID);
    // The gap is loose on purpose: an accessible name is built by concatenating the text of
    // *inline* children with no separator, and jsdom loads no stylesheet, so the `sr-only`
    // span is inline here and the description comes back as "Floors shown:03". In a browser
    // the same span is absolutely positioned — hence blockified — and the space returns. What
    // matters either way is that the prefix and the current count are both in the description.
    expect(getDecrease()).toHaveAccessibleDescription(/^Floors shown:\s*03$/);
    expect(getIncrease()).toHaveAccessibleDescription(/^Floors shown:\s*03$/);
  });

  it('stays mounted in both view modes', () => {
    render(<FloorCountStepper />);

    expect(getValue()).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(STEP_BUTTON_COUNT);

    toggleView();

    expect(useViewStore.getState().viewMode).toBe('interior');
    expect(getValue()).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(STEP_BUTTON_COUNT);
  });

  it('crosses the whole range in nine presses each way', async () => {
    const user = userEvent.setup();
    render(<FloorCountStepper />);

    for (let press = 0; press < RANGE_PRESSES; press += 1) {
      await user.click(getIncrease());
    }
    expect(useFloorCountStore.getState().floorCount).toBe(MAX_FLOOR_COUNT);
    expect(getValue().textContent).toBe('Floors shown: 10');

    for (let press = 0; press < RANGE_PRESSES; press += 1) {
      await user.click(getDecrease());
    }
    expect(useFloorCountStore.getState().floorCount).toBe(MIN_FLOOR_COUNT);
    expect(getValue().textContent).toBe(INITIAL_READING);
  });

  it('is reachable with Tab and operable with Enter and Space, keeping focus on itself', async () => {
    const user = userEvent.setup();
    const region = renderWithRegion();

    await user.tab();
    expect(region).toHaveFocus();
    await user.tab();
    expect(getDecrease()).toHaveFocus();
    await user.tab();
    expect(getIncrease()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(useFloorCountStore.getState().floorCount).toBe(2);
    expect(getIncrease()).toHaveFocus();

    await user.keyboard(' ');
    expect(useFloorCountStore.getState().floorCount).toBe(3);
    expect(getIncrease()).toHaveFocus();
  });

  it('never hands focus to the 3D view after a pointer press', async () => {
    const user = userEvent.setup();
    const detail = vi.fn<(clickDetail: number) => void>();
    render(
      <div onClickCapture={(event) => detail(event.detail)}>
        <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
        <FloorCountStepper />
      </div>,
    );

    await user.click(getIncrease());

    // A real pointer click, the one `CameraModeToggle` would have answered by focusing the
    // view region — and focus stayed on the button all the same.
    expect(detail).toHaveBeenCalledTimes(1);
    expect(detail.mock.calls[0]?.[0]).toBeGreaterThan(KEYBOARD_CLICK_DETAIL);
    expect(screen.getByTestId(REGION_TEST_ID)).not.toHaveFocus();
    expect(getIncrease()).toHaveFocus();
  });
});
