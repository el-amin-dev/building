import type { MouseEvent } from 'react';
import { useViewStore } from '../application/viewStore.ts';
import { getInteriorCameraModeLabel } from '../domain/viewMode.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';

/** Stable label of the toggle; `aria-pressed` tells whether third person is on. */
const TOGGLE_LABEL = getInteriorCameraModeLabel('thirdPerson');
/** `MouseEvent.detail` of a click fired by the keyboard (Enter or Space); pointer clicks count up from 1. */
const KEYBOARD_CLICK_DETAIL = 0;

/**
 * HUD control switching the interior camera between first and third person.
 *
 * A native toggle button named "Third person" whose `aria-pressed` is true while the
 * third-person view is active. Rendered only in the interior view; the view status of the
 * view mode toggle announces the current camera mode. The V key does the same while the
 * interior view has focus.
 *
 * After a pointer click, focus moves back to the interior view region
 * (`INTERIOR_REGION_ID`), so the navigation keys keep working without an extra step.
 * Keyboard activation (Enter or Space) leaves focus on the button, where the user put it.
 * The two are told apart by `event.detail`, which is 0 for a keyboard click. Some screen
 * readers (iOS VoiceOver, TalkBack) activate buttons with real pointer events, so focus also
 * returns to the view there; that is acceptable, because the view precedes the button in the
 * Tab order and is labelled.
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

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    toggle();
    if (event.detail > KEYBOARD_CLICK_DETAIL) {
      document.getElementById(INTERIOR_REGION_ID)?.focus();
    }
  };

  return (
    <div className="rounded-lg bg-slate-900 px-4 py-2 shadow-lg">
      <button
        type="button"
        aria-pressed={isThirdPerson}
        onClick={handleClick}
        className="min-h-6 min-w-6 cursor-pointer rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 aria-pressed:bg-amber-300 aria-pressed:hover:bg-amber-200"
      >
        {TOGGLE_LABEL}
      </button>
    </div>
  );
}
