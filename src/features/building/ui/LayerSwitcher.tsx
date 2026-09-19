import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useLayerStore } from '../application/layerStore.ts';
import { SERVICE_LAYERS } from '../domain/sourceOfTruth/plan.ts';
import type { PlanServiceLayerKey } from '../domain/sourceOfTruth/plan.ts';
import { INTERIOR_REGION_ID, LAYER_PANEL_ID, LAYER_SUMMARY_ID } from './hudIds.ts';

/**
 * The half of the trigger's name that stays VISIBLE on a phone; the summary is the half
 * that goes `sr-only` there.
 *
 * `RoomInfoPanel`'s move, for its reason: this trigger shares the HUD's second row with
 * "Go to room" and "About this room", and that row is already measured at a 400 px width
 * (`tests/e2e/remoteControl.spec.ts`, which fails the moment a panel wraps the band onto
 * another line). One word is what fits. Nothing is lost to assistive technology — the
 * accessible name is the button's whole text content, `sr-only` half included, so it still
 * says which layers are on.
 */
const TRIGGER_CAPTION = 'Layers';

/** Names the group of checkboxes, as the `<legend>` of the `<fieldset>` holding them. */
const LEGEND = 'Build layers';

/**
 * What the switcher calls the state it starts in: every box unticked.
 *
 * The default is not "nothing selected" but a *view* — the building with its services
 * still inside the walls — and the summary says so in the owner's own words rather than
 * leaving the viewer to read an empty count (ADR-022, answer 1).
 */
const NAKED_SUMMARY = 'Naked walls';

/** Joins the count of ticked layers to the count of layers there are: `3 of 9 on`. */
const SUMMARY_MIDDLE = 'of';
const SUMMARY_SUFFIX = 'on';

/** Separates the caption from the summary in the trigger's accessible name. */
const SUMMARY_SEPARATOR = ': ';

/**
 * Read inside the live region, before the summary.
 *
 * `FloorCountStepper`'s pattern: the element that is read is the element that is live, so
 * what is announced and what is on screen cannot drift, and the announcement is a sentence
 * — "Layers shown: 3 of 9 on" — while the pixels stay the bare summary.
 */
const SUMMARY_PREFIX = 'Layers shown: ';

/** `KeyboardEvent.key` that closes the panel, as every disclosure in this HUD does. */
const CLOSE_KEY = 'Escape';

/** `MouseEvent.detail` of a click fired by the keyboard (Enter or Space); pointer clicks count up from 1. */
const KEYBOARD_CLICK_DETAIL = 0;

/** The HUD's button look, copied from `RoomInfoPanel` so the strip reads as one control. */
const TRIGGER_CLASS_NAME =
  'min-h-6 min-w-6 cursor-pointer rounded-md bg-white px-2 py-1 text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 sm:px-3 sm:py-1.5';

/**
 * The open panel: anchored below the trigger, tall enough to scroll, and out of flow.
 *
 * `absolute top-full left-0` for the reason `RoomMenu`'s list docblock sets out at length —
 * an `absolute` box with no offset falls back to its static position, which the wrapper's
 * centring flex row puts *above* the top of the window, where nothing can scroll to it by
 * pointer or by key — and out of flow for a second reason of its own: the HUD overlay's
 * bounding box must not grow when the panel opens. Nine rows in flow would push it by a
 * third of a phone screen; `tests/e2e/remoteControl.spec.ts` asserts the 3D view keeps at
 * least 60 % of the height at a 400 px width, and `tests/e2e/sceneCapture.ts` finds the HUD
 * to hide it by the `data-hud-overlay` attribute on that same box.
 *
 * `max-h-64` with `overflow-y-auto` is what keeps the ninth layer inside the window at every
 * viewport these tests cover, exactly as it keeps the twentieth room inside it.
 */
const PANEL_CLASS_NAME =
  'absolute top-full left-0 z-30 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg bg-slate-900 p-2 text-sm text-white shadow-lg';

/**
 * One layer's row: the whole row is the label, so the words are as clickable as the box.
 *
 * `min-h-6` is the 24 px target floor of WCAG 2.5.8 that every other HUD control carries,
 * and it is on the row rather than only on the box, so a tap anywhere along the name counts.
 */
const ROW_CLASS_NAME =
  'flex min-h-6 cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-700';

/**
 * The box itself: a native `<input type="checkbox">`, sized up to the target floor.
 *
 * Never a styled `<div>` with `role="checkbox"`. The box is drawn by the platform, so it
 * carries the platform's own checked, focused and forced-colours painting, its pointer
 * behaviour and its announcement, none of which a div gets back without being written again
 * and none of which an audit would notice was missing.
 *
 * `min-h-6 min-w-6` gives it the 24 × 24 CSS px of WCAG 2.5.8 on its own, so the box is a
 * target even where the label's words are not under the finger. `accent-amber-400` paints
 * the ticked state in the HUD's focus colour — against `bg-slate-900` both the white box and
 * the amber fill clear the 3:1 of WCAG 1.4.11 by a wide margin.
 */
const CHECKBOX_CLASS_NAME =
  'min-h-6 min-w-6 shrink-0 cursor-pointer accent-amber-400 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400';

/**
 * Says what is on, in as few words as fit on the trigger.
 *
 * @param shownCount - How many layers are ticked.
 * @param total - How many layers there are.
 * @returns {@link NAKED_SUMMARY} when none is ticked, otherwise `3 of 9 on`.
 */
function formatSummary(shownCount: number, total: number): string {
  if (shownCount === 0) {
    return NAKED_SUMMARY;
  }
  return `${String(shownCount)} ${SUMMARY_MIDDLE} ${String(total)} ${SUMMARY_SUFFIX}`;
}

/**
 * HUD disclosure peeling the building layer by layer: naked walls, then one box per level.
 *
 * A trigger carrying the current summary, and a real `<fieldset>` with a `<legend>` holding
 * one native `<input type="checkbox">` per entry of `SERVICE_LAYERS` — in the plan's order,
 * which is the order a building is actually built in, and under the plan's own names. The
 * list is never written out here: a tenth layer added to the source of truth appears in this
 * panel with no edit to this file, and a layer renamed there cannot be called something else
 * on screen. Only `key` and `name` are read: a layer's `why` is the plan's note to whoever
 * maintains the list — it names ADRs, cites the owner and quotes other layers' keys — and
 * printing it under a checkbox would put developer prose in front of a viewer.
 *
 * The boxes are **additive, not exclusive** (ADR-022, answer 1): nothing ticked is the naked
 * building, and each tick adds a level over it. That is why they are checkboxes and not a
 * dropdown — water over naked walls, then water and gas together, then everything but the
 * finish, is how the floor is read, and a dropdown allows exactly one answer.
 *
 * ## Pointer-operable, and that is the point
 *
 * The owner cannot always use a keyboard (ADR-008/ADR-013), and a native checkbox is
 * pointer-operable by nature: the whole row is the `<label>`, so a tap anywhere along a
 * layer's name toggles it, and every box clears the 24 × 24 CSS px of WCAG 2.5.8 on its own.
 * There is deliberately **no keyboard shortcut** — not because one would be wrong, but
 * because a shortcut here would be an addition to these nine on-screen controls and never a
 * replacement for them, and nothing yet asks for one. `Escape` closes the panel, which is
 * the disclosure contract every other HUD panel already keeps, not a way to reach a layer.
 *
 * ## Why the summary is a bare `aria-live` paragraph
 *
 * It is a `<p>` with `aria-live="polite"` and **no role**, for the reason `FloorCountStepper`
 * gives: an `<output>` would carry an implicit `role="status"`, and this HUD rations that to
 * exactly one element — the view status of `ViewModeToggle` — because the end-to-end
 * screenshot mask and three `getByRole('status')` queries all find the HUD by there being a
 * single status on the page.
 *
 * ## Focus
 *
 * `RoomInfoPanel`'s rule exactly: after a **pointer** press on the trigger focus goes to the
 * 3D view region, so the navigation keys and the remote pad keep working while the viewer
 * reads the panel; after a **keyboard** press (`event.detail === 0`) focus stays on the
 * trigger, where the user put it. Ticking a box never moves focus — the boxes are ticked in
 * runs, and a viewer who has just turned gas on is usually about to turn water on too.
 *
 * `aria-controls` is set only while the panel is mounted: an `aria-controls` naming an
 * element that is not in the document is an IDREF assistive technology cannot resolve, and
 * axe reports it as *incomplete* rather than a violation, so no audit would catch it
 * (`RoomMenu`'s docblock flags the same trap).
 *
 * Mounted in **both views**, with no `null` branch at all, like `FloorCountStepper`: how the
 * building is layered is as much a fact of the exterior it is seen from as of the interior it
 * is walked in.
 *
 * @returns The layer switcher, in every view mode.
 */
export function LayerSwitcher() {
  const shown = useLayerStore((state) => state.shown);
  const toggleLayer = useLayerStore((state) => state.toggleLayer);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const shownCount = SERVICE_LAYERS.filter((layer) => shown[layer.key]).length;
  const summary = formatSummary(shownCount, SERVICE_LAYERS.length);

  /**
   * Toggles the panel and puts focus where the press asked for it.
   *
   * @param event - The click, whose `detail` says whether a pointer or a key fired it.
   */
  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    setIsOpen((wasOpen) => !wasOpen);
    if (event.detail > KEYBOARD_CLICK_DETAIL) {
      document.getElementById(INTERIOR_REGION_ID)?.focus();
    }
  };

  /**
   * Closes the panel on Escape and keeps focus on the trigger, wherever inside the control
   * the key was pressed: on the trigger, or on a box the viewer had tabbed to.
   *
   * @param event - The key press, from anywhere inside the control.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== CLOSE_KEY || !isOpen) {
      return;
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  /**
   * Ticks or unticks one layer.
   *
   * @param key - The layer the row belongs to.
   * @returns The change handler for that row's box.
   */
  const handleToggle = (key: PlanServiceLayerKey) => () => {
    toggleLayer(key);
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="relative flex flex-wrap items-center gap-2 rounded-lg bg-slate-900 px-2 py-1 text-white shadow-lg sm:px-4 sm:py-2"
    >
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={isOpen}
        aria-controls={isOpen ? LAYER_PANEL_ID : undefined}
        onClick={handleTriggerClick}
        className={TRIGGER_CLASS_NAME}
      >
        <span>{TRIGGER_CAPTION}</span>
        <span className="sr-only sm:not-sr-only">{`${SUMMARY_SEPARATOR}${summary}`}</span>
      </button>
      {isOpen ? (
        <fieldset id={LAYER_PANEL_ID} className={PANEL_CLASS_NAME}>
          <legend className="text-sm font-semibold">{LEGEND}</legend>
          <p id={LAYER_SUMMARY_ID} aria-live="polite" aria-atomic="true" className="mt-1">
            <span className="sr-only">{SUMMARY_PREFIX}</span>
            {summary}
          </p>
          <ul className="mt-2">
            {SERVICE_LAYERS.map((layer) => (
              <li key={layer.key}>
                <label className={ROW_CLASS_NAME}>
                  <input
                    type="checkbox"
                    checked={shown[layer.key]}
                    onChange={handleToggle(layer.key)}
                    className={CHECKBOX_CLASS_NAME}
                  />
                  <span>{layer.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}
