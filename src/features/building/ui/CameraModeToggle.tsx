import { useViewStore } from '../application/viewStore.ts';
import { getInteriorCameraModeLabel } from '../domain/viewMode.ts';

/** Stable label of the toggle; `aria-pressed` tells whether third person is on. */
const TOGGLE_LABEL = getInteriorCameraModeLabel('thirdPerson');

/**
 * HUD control switching the interior camera between first and third person.
 *
 * A native toggle button named "Third person" whose `aria-pressed` is true while the
 * third-person view is active. Rendered only in the interior view; the view status of the
 * view mode toggle announces the current camera mode. The V key does the same while the
 * interior view has focus.
 *
 * @returns The camera mode toggle in the interior view, otherwise `null`.
 */
export function CameraModeToggle() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const isThirdPerson = useViewStore((state) => state.interiorCameraMode === 'thirdPerson');
  const toggle = useViewStore((state) => state.toggleInteriorCameraMode);

  if (!isInterior) {
    return null;
  }

  return (
    <div className="rounded-lg bg-slate-900 px-4 py-2 shadow-lg">
      <button
        type="button"
        aria-pressed={isThirdPerson}
        onClick={toggle}
        className="min-h-6 min-w-6 cursor-pointer rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 aria-pressed:bg-amber-300 aria-pressed:hover:bg-amber-200"
      >
        {TOGGLE_LABEL}
      </button>
    </div>
  );
}
