import { useViewStore } from '../application/viewStore.ts';
import { NAVIGATION_HINT_ID } from './hudIds.ts';

/** Compact key summary shown to sighted users; hidden from assistive technology. */
const NAVIGATION_HINT_TEXT =
  'Move: W A S D · Look: I J K L · Person view: V · Escape stops a walk · or use the on-screen remote control';
/**
 * Shorter summary shown instead below the `sm` breakpoint, where the full one takes two rows.
 *
 * It points at the pad, which anchors to the bottom of the screen at that width, and names the
 * movement keys only; the full description below keeps every key, for assistive technology.
 */
const NAVIGATION_HINT_SHORT_TEXT = 'Move with the pad below · or W A S D · Escape stops';
/** Full key description read by assistive technology in place of the compact summary. */
const NAVIGATION_HINT_DESCRIPTION =
  'W moves forward, S moves back, A steps left, D steps right, J turns left, L turns right, I looks up, K looks down. V switches between first-person and third-person view. Keys follow their positions on a QWERTY keyboard. Every movement is also available on the on-screen remote control in the HUD, which needs no keyboard: hold one of its buttons with a pointer or a finger, or with Space or Enter while the button has focus. The "Go to room" button in the HUD lists every room of the floor and walks you to the one you pick, through the doors; that walk stops when you activate the "Stop walking" button beside it, when you press Escape while the view has focus, or as soon as you move yourself with any key or pad button. In the exterior view the left and right arrows orbit the camera around the building, the up and down arrows tilt it, and the plus and minus keys zoom in and out; the on-screen camera pad offers those same six movements. The floor control in the HUD stacks the building: "Remove a floor" and "Add a floor" step how many storeys are displayed, which the reading between those two buttons gives as 01 to 10, and the stairs are how you walk from one storey to the next. Press Tab to reach the view toggle, then the Third person toggle, then "Remove a floor", then "Add a floor", then "Go to room", then the remote control buttons. After using the Third person toggle with the keyboard, press Shift+Tab twice to return to the view.';

/** HUD panel classes, worn while the visible summary is shown. */
const PANEL_CLASS_NAME =
  'rounded-lg bg-slate-900 px-2 py-1 text-xs text-white shadow-lg sm:px-4 sm:py-2 sm:text-sm';
/** Keeps the description in the DOM while taking no space and showing no pixels. */
const HIDDEN_CLASS_NAME = 'sr-only';

/**
 * HUD panel listing the navigation keys and pointing at the on-screen pads.
 *
 * W/A/S/D move forward, left, backward and right; J/L turn left and right; I/K look up
 * and down; V switches between first and third person; Escape abandons an automatic
 * walk. Every movement is equally available on the on-screen `RemoteControl`, and every
 * exterior camera key on the `OrbitPad`, so navigation never requires a keyboard (WCAG
 * 2.1.1 read the other way round). The panel holds three texts:
 *
 * - a compact visible summary, `aria-hidden` so assistive technology does not read it, shown
 *   from the `sm` breakpoint up;
 * - a shorter visible summary, also `aria-hidden`, shown below that breakpoint instead, where
 *   the full one would wrap onto a second row and push the 3D view further down;
 * - a visually hidden (`sr-only`) full description carrying {@link NAVIGATION_HINT_ID}.
 *   It spells out which key moves, turns, looks or switches the camera, notes that the
 *   keys follow their QWERTY positions, says that the remote control offers the same
 *   movements and how it is held, describes the "Go to room" route and the three ways a
 *   walk stops, names the exterior orbit, tilt and zoom keys and their camera pad,
 *   introduces the floor stepper — what its two buttons do, what the reading between
 *   them says, and that the stairs are the way between the storeys it stacks — and
 *   says how to reach the HUD controls with Tab and how to return to the view with
 *   Shift+Tab after using the Third person toggle (the region precedes the HUD in the Tab
 *   order). Only that toggle is covered by the Shift+Tab note: Enter on the view toggle
 *   leaves the interior view.
 *
 * **The two visible summaries are interior-only; the description is not.** The view region
 * is a focusable `role="application"` in both views now (ADR-013) and is
 * `aria-describedby` this description in both, so the description has to be in the DOM in
 * both — an `aria-describedby` pointing at nothing is an invalid attribute value, which is
 * an axe violation rather than a cosmetic flaw. Outside the interior the panel is therefore
 * worn as `sr-only` instead: absolutely positioned, so it contributes no pixels and no flex
 * gap to the exterior HUD band, which is what keeps the exterior screenshot baseline
 * byte-identical. This is the `RoomReadout` pattern, for the same reason.
 *
 * It is not a live region, because the view status of the view mode toggle already
 * announces the change. Screen readers announce the description when the region receives
 * focus; it can also be read in the HUD after the toggle. The compact summary is
 * `aria-hidden`, so the keys are not read twice.
 *
 * @returns The navigation hint: a visible panel in the interior view, the hidden key
 *   description alone in the exterior view.
 */
export function NavigationHint() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');

  return (
    <p className={isInterior ? PANEL_CLASS_NAME : HIDDEN_CLASS_NAME}>
      {isInterior ? (
        <>
          <span aria-hidden="true" className="hidden sm:inline">
            {NAVIGATION_HINT_TEXT}
          </span>
          <span aria-hidden="true" className="sm:hidden">
            {NAVIGATION_HINT_SHORT_TEXT}
          </span>
        </>
      ) : null}
      <span id={NAVIGATION_HINT_ID} className={HIDDEN_CLASS_NAME}>
        {NAVIGATION_HINT_DESCRIPTION}
      </span>
    </p>
  );
}
