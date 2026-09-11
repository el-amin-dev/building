import { useViewStore } from '../application/viewStore.ts';
import { getViewModeLabel } from '../domain/viewMode.ts';

const TOGGLE_LABEL = `${getViewModeLabel('interior')} view`;
const CURRENT_VIEW_PREFIX = 'View:';

/**
 * HUD control switching between the exterior and interior view.
 *
 * A native toggle button (`aria-pressed` is true while the interior view is active)
 * next to a status line announcing the current view to assistive technology.
 *
 * @returns The view mode toggle.
 */
export function ViewModeToggle() {
  const viewMode = useViewStore((state) => state.viewMode);
  const toggle = useViewStore((state) => state.toggleViewMode);

  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-900 px-4 py-2 text-white shadow-lg">
      <p role="status" className="text-sm">
        {CURRENT_VIEW_PREFIX} <span className="font-semibold">{getViewModeLabel(viewMode)}</span>
      </p>
      <button
        type="button"
        aria-pressed={viewMode === 'interior'}
        onClick={toggle}
        className="cursor-pointer rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 aria-pressed:bg-amber-300 aria-pressed:hover:bg-amber-200"
      >
        {TOGGLE_LABEL}
      </button>
    </div>
  );
}
