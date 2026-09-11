import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { ViewModeToggle } from './ViewModeToggle.tsx';

const TOGGLE_NAME = 'Interior view';
const EXTERIOR_STATUS = 'View: Exterior';
const FIRST_PERSON_STATUS = 'View: Interior · First person';
const THIRD_PERSON_STATUS = 'View: Interior · Third person';
/** The camera-mode half of the status line, as its own element (whitespace normalised). */
const CAMERA_MODE_BADGE = '· First person';
/** Classes hiding that half visually on a narrow viewport and showing it from `sm` up. */
const SCREEN_READER_ONLY_CLASS = 'sr-only';
const WIDE_VISIBLE_CLASS = 'sm:not-sr-only';

/** Asserts the whole status line, not just a prefix of it. */
function expectStatus(text: string) {
  expect(screen.getByRole('status').textContent).toBe(text);
}

describe('ViewModeToggle', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('shows the exterior view as not pressed initially', () => {
    render(<ViewModeToggle />);

    expect(screen.getByRole('button', { name: TOGGLE_NAME })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expectStatus(EXTERIOR_STATUS);
  });

  it('switches to the interior view on click and announces the camera mode', async () => {
    const user = userEvent.setup();
    render(<ViewModeToggle />);

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));

    expect(screen.getByRole('button', { name: TOGGLE_NAME })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expectStatus(FIRST_PERSON_STATUS);
    expect(useViewStore.getState().viewMode).toBe('interior');
  });

  it('keeps the camera mode in the status line while hiding it visually on a narrow viewport', async () => {
    const user = userEvent.setup();
    render(<ViewModeToggle />);
    expect(screen.queryByText(CAMERA_MODE_BADGE)).toBeNull();

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));

    expectStatus(FIRST_PERSON_STATUS);
    expect(screen.getByText(CAMERA_MODE_BADGE)).toHaveClass(
      SCREEN_READER_ONLY_CLASS,
      WIDE_VISIBLE_CLASS,
    );
  });

  it('follows the interior camera mode in the status line', () => {
    render(<ViewModeToggle />);
    act(() => {
      useViewStore.getState().toggleViewMode();
    });

    act(() => {
      useViewStore.getState().toggleInteriorCameraMode();
    });
    expectStatus(THIRD_PERSON_STATUS);

    act(() => {
      useViewStore.getState().toggleViewMode();
    });
    expectStatus(EXTERIOR_STATUS);
  });

  it('is reachable with Tab and operable with Enter and Space', async () => {
    const user = userEvent.setup();
    render(<ViewModeToggle />);
    const button = screen.getByRole('button', { name: TOGGLE_NAME });

    await user.tab();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expectStatus(EXTERIOR_STATUS);
  });
});
