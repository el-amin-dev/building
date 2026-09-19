/**
 * DOM ids shared between the 3D view region and the HUD.
 *
 * Kept outside component files so they export only components (react-refresh).
 */

/**
 * DOM id of the interior navigation hint.
 *
 * Referenced by the interior view region's `aria-describedby` so assistive technology
 * reads the key bindings along with the region.
 */
export const NAVIGATION_HINT_ID = 'navigation-hint';

/**
 * DOM id of the 3D view region.
 *
 * HUD controls move focus back to it after a pointer click, so the navigation keys keep
 * working without prop drilling a ref.
 */
export const INTERIOR_REGION_ID = 'interior-3d-view';

/**
 * DOM id of the room readout, the live region announcing the room the explorer is in.
 *
 * Kept here so the readout and anything pointing at it (a label, an `aria-describedby`)
 * name the same element without importing the component.
 */
export const ROOM_READOUT_ID = 'current-room';

/**
 * DOM id of the "go to room" list in the HUD.
 *
 * Its own control and the readout above it are separate components, so the id lives
 * outside both of them.
 */
export const ROOM_LIST_ID = 'room-list';

/**
 * DOM id of the storey count reading in the HUD stepper: the live element showing `01`…`10`.
 *
 * Both stepper buttons are `aria-describedby` this element, so the count is read out with
 * the button's own name before the first press, not only after one.
 */
export const FLOOR_COUNT_VALUE_ID = 'floor-count';

/**
 * DOM id of the stepper's caption, the word naming what the two buttons step.
 *
 * Kept next to the value id so the caption and the reading it belongs to cannot drift
 * apart, and so anything labelling the panel can name it without importing the component.
 */
export const FLOOR_COUNT_LABEL_ID = 'floor-count-label';
