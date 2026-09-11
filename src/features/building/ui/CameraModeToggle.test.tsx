import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { CameraModeToggle } from './CameraModeToggle.tsx';
import { INTERIOR_REGION_ID } from './hudIds.ts';

const TOGGLE_NAME = 'Third person';
const REGION_TEST_ID = 'interior-region';
const FOCUSABLE_TAB_INDEX = 0;

function toggleView() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

function getToggle(): HTMLElement {
  return screen.getByRole('button', { name: TOGGLE_NAME });
}

/** Renders a focusable stand-in for the interior region before the toggle, as in the app. */
function renderWithRegion() {
  render(
    <>
      <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      <CameraModeToggle />
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
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

  it('moves focus back to the interior region after a pointer click', async () => {
    const user = userEvent.setup();
    toggleView();
    const region = renderWithRegion();

    await user.click(getToggle());

    expect(useViewStore.getState().interiorCameraMode).toBe('thirdPerson');
    expect(region).toHaveFocus();
  });

  it('is reachable with Tab and operable with Enter and Space, keeping focus on itself', async () => {
    const user = userEvent.setup();
    toggleView();
    const region = renderWithRegion();
    const button = getToggle();

    await user.tab();
    expect(region).toHaveFocus();
    await user.tab();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveFocus();

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(useViewStore.getState().interiorCameraMode).toBe('firstPerson');
    expect(button).toHaveFocus();
  });
});
