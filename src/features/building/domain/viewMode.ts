/** The ways the building can be viewed: from outside or from inside. */
export type ViewMode = 'exterior' | 'interior';

/** View mode the explorer starts in. */
export const INITIAL_VIEW_MODE: ViewMode = 'exterior';

const VIEW_MODE_LABELS: Readonly<Record<ViewMode, string>> = {
  exterior: 'Exterior',
  interior: 'Interior',
};

/**
 * Returns the opposite view mode.
 *
 * @param mode - The current view mode.
 * @returns `'interior'` for `'exterior'` and vice versa.
 */
export function toggleViewMode(mode: ViewMode): ViewMode {
  return mode === 'exterior' ? 'interior' : 'exterior';
}

/**
 * Returns the human-readable label of a view mode.
 *
 * @param mode - The view mode to describe.
 * @returns The display label, e.g. `'Exterior'`.
 */
export function getViewModeLabel(mode: ViewMode): string {
  return VIEW_MODE_LABELS[mode];
}

/**
 * How the camera follows the person in the interior view: through the
 * person's eyes, or from behind the person.
 */
export type InteriorCameraMode = 'firstPerson' | 'thirdPerson';

/** Interior camera mode the explorer starts in. */
export const INITIAL_INTERIOR_CAMERA_MODE: InteriorCameraMode = 'firstPerson';

const INTERIOR_CAMERA_MODE_LABELS: Readonly<Record<InteriorCameraMode, string>> = Object.freeze({
  firstPerson: 'First person',
  thirdPerson: 'Third person',
});

/** Physical key (KeyboardEvent.code) that switches the interior camera mode. */
export const CAMERA_MODE_TOGGLE_KEY_CODE = 'KeyV';

/**
 * Returns the opposite interior camera mode.
 *
 * @param mode - The current interior camera mode.
 * @returns `'thirdPerson'` for `'firstPerson'` and vice versa.
 */
export function toggleInteriorCameraMode(mode: InteriorCameraMode): InteriorCameraMode {
  return mode === 'firstPerson' ? 'thirdPerson' : 'firstPerson';
}

/**
 * Returns the human-readable label of an interior camera mode.
 *
 * @param mode - The interior camera mode to describe.
 * @returns The display label, e.g. `'First person'`.
 */
export function getInteriorCameraModeLabel(mode: InteriorCameraMode): string {
  return INTERIOR_CAMERA_MODE_LABELS[mode];
}
