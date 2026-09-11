import { useViewStore } from '../application/viewStore.ts';
import { NAVIGATION_HINT_ID } from './hudIds.ts';

/** Compact key summary shown to sighted users; hidden from assistive technology. */
const NAVIGATION_HINT_TEXT =
  'Move: W A S D · Look: I J K L · Person view: V · or use the on-screen remote control';
/** Full key description read by assistive technology in place of the compact summary. */
const NAVIGATION_HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. Press Tab to reach the view toggle, then the Third person toggle, then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';

/**
 * HUD panel listing the interior navigation keys and pointing at the remote control.
 *
 * W/A/S/D move forward, left, backward and right; J/L turn left and right; I/K look up
 * and down; V switches between first and third person. Every movement is equally
 * available on the on-screen `RemoteControl`, so navigation never requires a keyboard
 * (WCAG 2.1.1 read the other way round). Rendered only in the interior view. The panel
 * holds two texts:
 *
 * - a compact visible summary, `aria-hidden` so assistive technology does not read it;
 * - a visually hidden (`sr-only`) full description carrying {@link NAVIGATION_HINT_ID}.
 *   It spells out which key moves, turns, looks or switches the camera, notes that the
 *   keys follow their QWERTY positions, says that the remote control offers the same
 *   movements and how it is held, says how to reach the HUD controls with Tab, and how
 *   to return to the view with Shift+Tab after using the Third person toggle (the region
 *   precedes the HUD in the Tab order: region, view toggle, Third person toggle, then the
 *   remote control buttons). Only that toggle is covered: Enter on the view toggle leaves
 *   the interior view.
 *
 * It is not a live region, because the view status of the view mode toggle already
 * announces the change. The interior view region points `aria-describedby` at the full
 * description, so screen readers announce it as the region's description when the region
 * receives focus; it can also be read in the HUD after the toggle. The compact summary is
 * `aria-hidden`, so the keys are not read twice.
 *
 * @returns The navigation hint in the interior view, otherwise `null`.
 */
export function NavigationHint() {
  const viewMode = useViewStore((state) => state.viewMode);

  if (viewMode !== 'interior') {
    return null;
  }

  return (
    <p className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
      <span aria-hidden="true">{NAVIGATION_HINT_TEXT}</span>
      <span id={NAVIGATION_HINT_ID} className="sr-only">
        {NAVIGATION_HINT_DESCRIPTION}
      </span>
    </p>
  );
}
