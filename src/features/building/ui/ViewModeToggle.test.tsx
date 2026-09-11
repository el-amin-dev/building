import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { ViewModeToggle } from './ViewModeToggle.tsx';

describe('ViewModeToggle', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('shows the exterior view as not pressed initially', () => {
    render(<ViewModeToggle />);

    expect(screen.getByRole('button', { name: 'Interior view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('status')).toHaveTextContent('View: Exterior');
  });

  it('switches to the interior view on click', async () => {
    const user = userEvent.setup();
    render(<ViewModeToggle />);

    await user.click(screen.getByRole('button', { name: 'Interior view' }));

    expect(screen.getByRole('button', { name: 'Interior view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('View: Interior');
    expect(useViewStore.getState().viewMode).toBe('interior');
  });

  it('is reachable with Tab and operable with Enter and Space', async () => {
    const user = userEvent.setup();
    render(<ViewModeToggle />);
    const button = screen.getByRole('button', { name: 'Interior view' });

    await user.tab();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('View: Exterior');
  });
});
