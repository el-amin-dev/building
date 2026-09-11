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
