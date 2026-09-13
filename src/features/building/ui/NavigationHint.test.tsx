import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { NAVIGATION_HINT_ID } from './hudIds.ts';
import { NavigationHint } from './NavigationHint.tsx';

const HINT_TEXT =
  'Move: W A S D · Look: I J K L · Person view: V · Escape stops a walk · or use the on-screen remote control';
const SHORT_HINT_TEXT = 'Move with the pad below · or W A S D · Escape stops';
const HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. The "Go to room" button in the HUD lists every room of the floor and walks you to the one you pick, through the doors; that walk stops when you activate the "Stop walking" button beside it, when you press Escape while the view has focus, or as soon as you move yourself with any key or pad button. In the exterior view the left and right arrows orbit the camera around the building, the up and down arrows tilt it, and the plus and minus keys zoom in and out; the on-screen camera pad offers those same six movements. Press Tab to reach the view toggle, then the Third person toggle, then "Go to room", then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';
const SCREEN_READER_ONLY_CLASS = 'sr-only';
/** Utility classes deciding which of the two visible summaries a viewport width gets. */
const WIDE_ONLY_CLASSES = ['hidden', 'sm:inline'];
const NARROW_ONLY_CLASS = 'sm:hidden';

function toggleView() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

/** The full key description, which carries {@link NAVIGATION_HINT_ID} in every view. */
function getDescription(): HTMLElement {
  const description = document.getElementById(NAVIGATION_HINT_ID);
  if (description === null) {
    throw new Error('The navigation hint renders no key description');
  }
  return description;
}

describe('NavigationHint', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('keeps the key description, and only the description, in the exterior view', () => {
    render(<NavigationHint />);

    // The exterior view region is `aria-describedby` this element too (ADR-013), so it has
    // to be in the DOM in both views: an `aria-describedby` pointing at nothing is an
    // invalid attribute value. It is `sr-only` — and so is its panel — so it adds no pixels
    // and no flex gap to the exterior HUD band.
    expect(getDescription()).toHaveTextContent(HINT_DESCRIPTION, { normalizeWhitespace: true });
    expect(getDescription().parentElement).toHaveClass(SCREEN_READER_ONLY_CLASS);
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
    expect(screen.queryByText(SHORT_HINT_TEXT)).toBeNull();
  });

  it('shows the compact key summary to sighted users only in the interior view', () => {
    toggleView();
    render(<NavigationHint />);

    const summary = screen.getByText(HINT_TEXT, { exact: true });
    expect(summary).toHaveAttribute('aria-hidden', 'true');
    expect(summary).not.toHaveAttribute('id');
  });

  it('swaps the visible summary for a shorter one below the sm breakpoint', () => {
    toggleView();
    render(<NavigationHint />);

    const full = screen.getByText(HINT_TEXT, { exact: true });
    const short = screen.getByText(SHORT_HINT_TEXT, { exact: true });
    expect(short).toHaveAttribute('aria-hidden', 'true');
    expect(short).not.toHaveAttribute('id');
    expect(full).toHaveClass(...WIDE_ONLY_CLASSES);
    expect(short).toHaveClass(NARROW_ONLY_CLASS);
  });

  it('keeps the full description in the panel whichever summary is shown', () => {
    toggleView();
    render(<NavigationHint />);

    const description = getDescription();
    expect(description).toHaveTextContent(HINT_DESCRIPTION, { normalizeWhitespace: true });
    expect(screen.getByText(SHORT_HINT_TEXT, { exact: true }).parentElement).toBe(
      description.parentElement,
    );
  });

  it('gives the full, visually hidden key description its id in the interior view', () => {
    toggleView();
    render(<NavigationHint />);

    const description = getDescription();
    expect(description).toHaveTextContent(HINT_DESCRIPTION, { normalizeWhitespace: true });
    expect(description).toHaveClass(SCREEN_READER_ONLY_CLASS);
    expect(description).not.toHaveAttribute('aria-hidden');
    expect(screen.getByText(HINT_DESCRIPTION, { exact: true })).toBe(description);
  });

  it('keeps both texts in the same panel', () => {
    toggleView();
    render(<NavigationHint />);

    const summary = screen.getByText(HINT_TEXT, { exact: true });
    const description = screen.getByText(HINT_DESCRIPTION, { exact: true });
    expect(summary.parentElement).not.toBeNull();
    expect(summary.parentElement).toBe(description.parentElement);
  });

  it('follows view mode toggles', () => {
    render(<NavigationHint />);
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
    expect(getDescription()).toHaveTextContent(HINT_DESCRIPTION);

    toggleView();
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument();
    expect(getDescription()).toHaveTextContent(HINT_DESCRIPTION);

    toggleView();
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
    // The description never leaves: only the visible summaries follow the view.
    expect(getDescription()).toHaveTextContent(HINT_DESCRIPTION);
  });
});
