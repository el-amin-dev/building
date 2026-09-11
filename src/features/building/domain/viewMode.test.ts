import { describe, expect, it } from 'vitest';
import { EYE_KEY_BINDINGS, isEyeNavigationKey } from './eyeNavigation.ts';
import {
  CAMERA_MODE_TOGGLE_KEY_CODE,
  getInteriorCameraModeLabel,
  getViewModeLabel,
  INITIAL_INTERIOR_CAMERA_MODE,
  INITIAL_VIEW_MODE,
  toggleInteriorCameraMode,
  toggleViewMode,
} from './viewMode.ts';

const EXPECTED_TOGGLE_KEY_CODE = 'KeyV';

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

describe('interior camera mode', () => {
  it('starts in first person', () => {
    expect(INITIAL_INTERIOR_CAMERA_MODE).toBe('firstPerson');
  });

  it('toggles first person to third person and back', () => {
    expect(toggleInteriorCameraMode('firstPerson')).toBe('thirdPerson');
    expect(toggleInteriorCameraMode('thirdPerson')).toBe('firstPerson');
  });

  it('labels each mode', () => {
    expect(getInteriorCameraModeLabel('firstPerson')).toBe('First person');
    expect(getInteriorCameraModeLabel('thirdPerson')).toBe('Third person');
  });

  it('switches with the physical V key', () => {
    expect(CAMERA_MODE_TOGGLE_KEY_CODE).toBe(EXPECTED_TOGGLE_KEY_CODE);
  });

  it('uses a toggle key that is not an eye navigation key', () => {
    expect(Object.keys(EYE_KEY_BINDINGS)).not.toContain(CAMERA_MODE_TOGGLE_KEY_CODE);
    expect(isEyeNavigationKey(CAMERA_MODE_TOGGLE_KEY_CODE)).toBe(false);
  });
});
