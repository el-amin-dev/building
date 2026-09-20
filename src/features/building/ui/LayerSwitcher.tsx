import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useLayerStore } from '../application/layerStore.ts';
import { SERVICE_LAYERS } from '../domain/sourceOfTruth/plan.ts';
import type { PlanServiceLayerKey } from '../domain/sourceOfTruth/plan.ts';
import { BUILT_FLOOR } from './floorInstance.ts';
import { getFloorLayout, isLayerEmpty } from './floorLayout.ts';
import type { FloorLayout } from './floorLayout.ts';
import { INTERIOR_REGION_ID, LAYER_PANEL_ID, LAYER_SUMMARY_ID } from './hudIds.ts';

/**
 * The solids of the floor grouped by material, built once when this module is loaded.
 *
 * The switcher needs them for one question only — whether a ticked layer has a single box
 * to draw — so nothing here is handed to the GPU and no identity depends on it. The floor
 * itself is still not re-derived: {@link BUILT_FLOOR} is the page's one derivation of it
 * (`floorInstance.ts`), and only the grouping is repeated. `FloorModel.tsx` builds the same
 * grouping for the meshes; the day a third reader wants it, the constant belongs in
 * `floorInstance.ts` beside the floor rather than twice in `ui/`.
 */
const FLOOR_LAYOUT: FloorLayout = getFloorLayout(BUILT_FLOOR);

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

/**
 * Said in the live region when a ticked layer has nothing to draw, before the layers it
 * names: `Nothing to draw on this floor: Gas`.
 *
 * `RoomInfoPanel`'s rule, applied to a list of checkboxes instead of a list of fittings: an
 * empty result stated in words, never as silence. A layer that is ticked and draws nothing
 * looks exactly like a layer that is broken, and the viewer has no way to tell the two
 * apart — so the HUD says which of the two it is. It is a SENTENCE and not only the marker
 * on the row below, because a marker beside a name is a pixel: the summary is the one
 * element of this panel assistive technology is already listening to.
 */
const EMPTY_LAYER_SENTENCE = 'Nothing to draw on this floor';

/** Between the sentence and the layers it names, and between two layer names. */
const EMPTY_LAYER_JOIN = ': ';
const EMPTY_LAYER_SEPARATOR = ', ';

/**
 * The marker on a ticked-but-empty row, in the list itself.
 *
 * Inside the row's `<label>`, so it is read as part of that checkbox's own name: a viewer
 * who tabs onto the box hears `Gas — nothing to draw` and needs neither the summary above
 * nor the colour the marker is painted in. The live sentence still carries the message on
 * its own, for the viewer who never walks the rows.
 *
 * The dash is part of the words rather than a gap between two elements, and that is not a
 * nicety: an accessible name is the concatenation of the label's nodes with each node
 * TRIMMED, so CSS spacing and a whitespace text node alike contribute nothing to it, and
 * the box would announce itself as `Gasnothing to draw`. `LayerSwitcher.test.tsx` pins the
 * name the marker actually produces.
 */
const EMPTY_LAYER_MARK = '— nothing to draw';

/** The marker's look: quiet, but never the only carrier of the message. */
const EMPTY_LAYER_MARK_CLASS_NAME = 'text-amber-300 italic';

/** The sentence's look inside the live region: its own line under the count. */
const EMPTY_LAYER_SENTENCE_CLASS_NAME = 'mt-1 block text-amber-300';

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
 * ## A ticked layer with nothing to draw
 *
 * Such a layer is marked on its row and said in the live summary
 * ({@link EMPTY_LAYER_SENTENCE}), because ticking a box and seeing the floor not change is
 * the one outcome this panel cannot leave unexplained: "this floor has no gas" and "the gas
 * layer is broken" are the same picture, and without the sentence the second one ships. The
 * answer comes from `isLayerEmpty` over the floor's own buckets, so it follows the table the
 * renderer obeys rather than a list kept here.
 *
 * **No layer is empty on the floor as it is drawn today** — all nine have geometry
 * (`floorLayout.test.ts`) — so this state is unreachable in the running app and is proved
 * against constructed layouts instead. It becomes reachable the day the plan declares a
 * layer no run carries, or a storey is built that holds none of one layer's runs.
 *
 * @param props - The switcher's one input.
 * @param props.layout - The solids of the floor grouped by material, read only to tell
 *   whether a ticked layer has anything to draw; defaults to the floor of the page. A
 *   parameter so a test can hand in a floor whose layers are empty, which no plan of this
 *   building produces.
 * @returns The layer switcher, in every view mode.
 */
export function LayerSwitcher({ layout = FLOOR_LAYOUT }: { readonly layout?: FloorLayout }) {
  const shown = useLayerStore((state) => state.shown);
  const toggleLayer = useLayerStore((state) => state.toggleLayer);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const shownCount = SERVICE_LAYERS.filter((layer) => shown[layer.key]).length;
  const summary = formatSummary(shownCount, SERVICE_LAYERS.length);
  // Ticked AND empty: an unticked layer draws nothing by definition, and saying so about it
  // would turn nine rows into nine complaints.
  const emptyLayers = SERVICE_LAYERS.filter(
    (layer) => shown[layer.key] && isLayerEmpty(layout, layer.key),
  );
  const emptyKeys = new Set<PlanServiceLayerKey>(emptyLayers.map((layer) => layer.key));

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
            {emptyLayers.length > 0 ? (
              <span className={EMPTY_LAYER_SENTENCE_CLASS_NAME}>
                {`${EMPTY_LAYER_SENTENCE}${EMPTY_LAYER_JOIN}${emptyLayers
                  .map((layer) => layer.name)
                  .join(EMPTY_LAYER_SEPARATOR)}`}
              </span>
            ) : null}
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
                  {emptyKeys.has(layer.key) ? (
                    <span className={EMPTY_LAYER_MARK_CLASS_NAME}>{EMPTY_LAYER_MARK}</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}
