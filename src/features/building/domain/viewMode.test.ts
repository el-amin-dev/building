import { describe, expect, it } from 'vitest';
import { getViewModeLabel, INITIAL_VIEW_MODE, toggleViewMode } from './viewMode.ts';

describe('viewMode', () => {
  it('starts from the exterior', () => {
    expect(INITIAL_VIEW_MODE).toBe('exterior');
  });

  it('toggles exterior to interior and back', () => {
    expect(toggleViewMode('exterior')).toBe('interior');
    expect(toggleViewMode('interior')).toBe('exterior');
  });

  it('labels each mode', () => {
    expect(getViewModeLabel('exterior')).toBe('Exterior');
    expect(getViewModeLabel('interior')).toBe('Interior');
  });
});
