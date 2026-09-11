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
