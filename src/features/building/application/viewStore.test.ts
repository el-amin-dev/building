import { beforeEach, describe, expect, it } from 'vitest';
import { useViewStore } from './viewStore.ts';

describe('useViewStore', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('starts in the exterior view', () => {
    expect(useViewStore.getState().viewMode).toBe('exterior');
  });

  it('toggles to the interior view and back', () => {
    useViewStore.getState().toggleViewMode();
    expect(useViewStore.getState().viewMode).toBe('interior');

    useViewStore.getState().toggleViewMode();
    expect(useViewStore.getState().viewMode).toBe('exterior');
  });
});
