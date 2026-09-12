/** Page title the end-to-end build is created with; differs from the app default on purpose. */
export const E2E_APP_TITLE = 'Floor E2E';

/** Accessible name of the view toggle button. */
export const VIEW_TOGGLE_NAME = 'Interior view';
/** Accessible name of the interior 3D region, distinct from the toggle's. */
export const INTERIOR_REGION_NAME = 'Interior 3D view';
/**
 * Accessible name of the exterior 3D region.
 *
 * The region is a focusable `role="application"` in both views now (ADR-013), so leaving the
 * interior renames it rather than removing it.
 */
export const EXTERIOR_REGION_NAME = 'Exterior 3D view';
/** Accessible name of the camera mode toggle button, shown in the interior view only. */
export const CAMERA_TOGGLE_NAME = 'Third person';
/** Status line of the exterior view. */
export const EXTERIOR_STATUS = 'View: Exterior';
/** Status line of the interior view in first person. */
export const FIRST_PERSON_STATUS = 'View: Interior · First person';

/**
 * Attribute the 3D view region stamps with the state of the exterior↔interior camera flight.
 *
 * A view toggle starts a 0.9 s eased camera travel, so the attribute reads
 * {@link CAMERA_TRANSITION_RUNNING} immediately after a toggle and
 * {@link CAMERA_TRANSITION_IDLE} only before the first toggle, once the flight has ended, or
 * under `prefers-reduced-motion`, which suppresses the flight altogether. It is what
 * `expectCameraIdle` gates a screenshot on: a capture taken mid-flight is a frame of a moving
 * camera, and no "two identical captures" rule can rule that out on its own.
 */
export const CAMERA_TRANSITION_ATTRIBUTE = 'data-camera-transition';
/** Value of {@link CAMERA_TRANSITION_ATTRIBUTE} while no camera flight is running. */
export const CAMERA_TRANSITION_IDLE = 'idle';
/** Value of {@link CAMERA_TRANSITION_ATTRIBUTE} while the camera is flying between the views. */
export const CAMERA_TRANSITION_RUNNING = 'running';
