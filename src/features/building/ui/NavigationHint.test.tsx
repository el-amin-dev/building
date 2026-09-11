import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { NAVIGATION_HINT_ID } from './hudIds.ts';
import { NavigationHint } from './NavigationHint.tsx';

const HINT_TEXT = 'Move: W A S D · Look: I J K L · Person view: V';
const HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Press Tab to reach the view toggle, then the Third person toggle. After using the HUD buttons with the keyboard, press Shift+Tab to return to the view: once from the view toggle, twice from the Third person toggle.';
const SCREEN_READER_ONLY_CLASS = 'sr-only';

function toggleView() {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

describe('NavigationHint', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('renders nothing in the exterior view', () => {
    const { container } = render(<NavigationHint />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
    expect(screen.queryByText(HINT_DESCRIPTION)).toBeNull();
  });

  it('shows the compact key summary to sighted users only in the interior view', () => {
    toggleView();
    render(<NavigationHint />);

    const summary = screen.getByText(HINT_TEXT, { exact: true });
    expect(summary).toHaveAttribute('aria-hidden', 'true');
    expect(summary).not.toHaveAttribute('id');
  });

  it('gives the full, visually hidden key description its id in the interior view', () => {
    toggleView();
    render(<NavigationHint />);

    const description = document.getElementById(NAVIGATION_HINT_ID);
    expect(description).not.toBeNull();
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
    expect(document.getElementById(NAVIGATION_HINT_ID)).toBeNull();

    toggleView();
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument();
    expect(document.getElementById(NAVIGATION_HINT_ID)).toHaveTextContent(HINT_DESCRIPTION);

    toggleView();
    expect(screen.queryByText(HINT_TEXT)).toBeNull();
    expect(document.getElementById(NAVIGATION_HINT_ID)).toBeNull();
  });
});
