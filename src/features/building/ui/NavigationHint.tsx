import { useViewStore } from '../application/viewStore.ts';
import { NAVIGATION_HINT_ID } from './hudIds.ts';

/** Compact key summary shown to sighted users; hidden from assistive technology. */
const NAVIGATION_HINT_TEXT = 'Move: W A S D · Look: I J K L · Person view: V';
/** Full key description read by assistive technology in place of the compact summary. */
const NAVIGATION_HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Press Tab to reach the view toggle.';

/**
 * HUD panel listing the interior navigation keys.
 *
 * W/A/S/D move forward, left, backward and right; J/L turn left and right; I/K look up
 * and down; V switches between first and third person. Rendered only in the interior
 * view. The panel holds two texts:
 *
 * - a compact visible summary, `aria-hidden` so assistive technology does not read it;
 * - a visually hidden (`sr-only`) full description carrying {@link NAVIGATION_HINT_ID}.
 *   It spells out which key moves, turns, looks or switches the camera, notes that the
 *   keys follow their QWERTY positions, and says how to reach the view toggle.
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
