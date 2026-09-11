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

  it('starts the interior camera in first person', () => {
    expect(useViewStore.getState().interiorCameraMode).toBe('firstPerson');
  });

  it('toggles the interior camera to third person and back', () => {
    useViewStore.getState().toggleInteriorCameraMode();
    expect(useViewStore.getState().interiorCameraMode).toBe('thirdPerson');

    useViewStore.getState().toggleInteriorCameraMode();
    expect(useViewStore.getState().interiorCameraMode).toBe('firstPerson');
  });

  it('keeps the interior camera mode when the view mode is toggled twice', () => {
    useViewStore.getState().toggleInteriorCameraMode();

    useViewStore.getState().toggleViewMode();
    useViewStore.getState().toggleViewMode();

    expect(useViewStore.getState().interiorCameraMode).toBe('thirdPerson');
  });

  it('leaves the view mode alone when the interior camera mode is toggled', () => {
    useViewStore.getState().toggleViewMode();

    useViewStore.getState().toggleInteriorCameraMode();

    expect(useViewStore.getState().viewMode).toBe('interior');
  });
});
