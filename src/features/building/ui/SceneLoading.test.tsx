import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SceneLoading } from './SceneLoading.tsx';
import { ViewModeToggle } from './ViewModeToggle.tsx';

const LOADING_TEXT = 'Loading the 3D view…';
/** The one HUD panel class the fallback wears, so the shell keeps its look while it waits. */
const PANEL_CLASS = 'bg-slate-900';
/** The Tailwind prefix of every animation utility: none of them may appear here. */
const ANIMATION_PREFIX = 'animate-';
/** How many elements of the whole HUD may carry `role="status"`: the view status, and no other. */
const ONE_STATUS = 1;

describe('SceneLoading', () => {
  it('says the 3D view is on its way', () => {
    render(<SceneLoading />);

    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
  });

  it('wears the HUD panel look', () => {
    render(<SceneLoading />);

    expect(screen.getByText(LOADING_TEXT)).toHaveClass(PANEL_CLASS);
  });

  it('animates nothing, so there is no motion to make an exception for', () => {
    const { container } = render(<SceneLoading />);

    for (const element of container.querySelectorAll('*')) {
      for (const className of element.classList) {
        expect(className.startsWith(ANIMATION_PREFIX)).toBe(false);
      }
    }
  });

  it('leaves the single status role of the HUD to the view status', () => {
    render(
      <>
        <ViewModeToggle />
        <SceneLoading />
      </>,
    );

    expect(screen.getAllByRole('status')).toHaveLength(ONE_STATUS);
  });
});
