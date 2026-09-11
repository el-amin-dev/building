import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { CameraModeToggle } from './CameraModeToggle.tsx';

const TOGGLE_NAME = 'Third person';

function toggleView() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function getToggle(): HTMLElement {
  return screen.getByRole('button', { name: TOGGLE_NAME });
}

describe('CameraModeToggle', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('renders nothing in the exterior view', () => {
    const { container } = render(<CameraModeToggle />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: TOGGLE_NAME })).toBeNull();
  });

  it('appears with the interior view and disappears when leaving it', () => {
    render(<CameraModeToggle />);

    toggleView();
    expect(getToggle()).toBeInTheDocument();

    toggleView();
    expect(screen.queryByRole('button', { name: TOGGLE_NAME })).toBeNull();
  });

  it('reflects the interior camera mode of the store in aria-pressed', () => {
    toggleView();
    render(<CameraModeToggle />);
    expect(getToggle()).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      useViewStore.getState().toggleInteriorCameraMode();
    });

    expect(getToggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the camera mode on click', async () => {
    const user = userEvent.setup();
    toggleView();
    render(<CameraModeToggle />);

    await user.click(getToggle());
    expect(getToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(useViewStore.getState().interiorCameraMode).toBe('thirdPerson');

    await user.click(getToggle());
    expect(getToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(useViewStore.getState().interiorCameraMode).toBe('firstPerson');
  });

  it('is reachable with Tab and operable with Enter and Space', async () => {
    const user = userEvent.setup();
    toggleView();
    render(<CameraModeToggle />);
    const button = getToggle();

    await user.tab();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(useViewStore.getState().interiorCameraMode).toBe('firstPerson');
  });
});
