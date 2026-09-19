import { useFloorCountStore } from '../application/floorCountStore.ts';
import { formatFloorCount, MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { FLOOR_COUNT_LABEL_ID, FLOOR_COUNT_VALUE_ID } from './hudIds.ts';

/** Caption naming what the two buttons step; `sr-only` below the `sm` breakpoint. */
const PANEL_CAPTION = 'Floors';

/**
 * Read inside the live region, before the count.
 *
 * Living inside the live element rather than beside it is what keeps the announcement a
 * sentence — "Floors shown: 03" — while the pixels stay the bare `03` a stepper should
 * show. The `ViewModeToggle` pattern: one element is both the reading and the live region,
 * so what is announced and what is on screen cannot drift.
 */
const VALUE_PREFIX = 'Floors shown: ';

/** Accessible name of the button that takes the top storey off the stack. */
const DECREASE_LABEL = 'Remove a floor';

/** Accessible name of the button that adds a storey above the stack. */
const INCREASE_LABEL = 'Add a floor';

/**
 * The glyph on the decrease button: a real minus sign (U+2212), not a hyphen.
 *
 * A hyphen is drawn shorter and higher than the bar of the `+` next to it, so the pair
 * reads as mismatched at the 14 px of this HUD. It is `aria-hidden` either way — the
 * button's name is {@link DECREASE_LABEL}, not its glyph.
 */
const MINUS_GLYPH = '−';

/** The glyph on the increase button; `aria-hidden`, as {@link MINUS_GLYPH} is. */
const PLUS_GLYPH = '+';

/**
 * The HUD's button classes, plus the greying a bound applies.
 *
 * The first half is what `CameraModeToggle` and the room menu wear, down to the 24 px
 * target floor of WCAG 2.5.8 (`min-h-6 min-w-6`). The `aria-disabled:` half is the
 * `aria-pressed:` trick the other HUD buttons already use: the state lives in the ARIA
 * attribute and the paint follows it, so there is one source of truth for "this press does
 * nothing" and no second `data-` flag to keep in step. Each `aria-disabled:` selector
 * carries the attribute *and* a class, so it outweighs the plain colour it overrides.
 */
const STEP_BUTTON_CLASS_NAME =
  'min-h-6 min-w-6 cursor-pointer rounded-md bg-white px-2 py-1 text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 aria-disabled:cursor-not-allowed aria-disabled:bg-slate-500 aria-disabled:text-slate-200 aria-disabled:hover:bg-slate-500 sm:px-3 sm:py-1.5';

/**
 * HUD stepper setting how many storeys of the typical floor are stacked: `[−] 01 [+]`.
 *
 * Two native buttons around a live reading of the count. Mounted in both views — the stack
 * is as much an exterior fact as an interior one — so it has no `null` branch, and it is the
 * third panel of the HUD's first row (`app/App.tsx`), which puts its two buttons after the
 * two toggles and before "Go to room" in the Tab order.
 *
 * ## Why the reading is a bare `aria-live` paragraph
 *
 * It is a `<p>` with `aria-live="polite"` and **no role**. An `<output>` would carry an
 * implicit `role="status"`, and this HUD rations that to exactly one element: the view
 * status of `ViewModeToggle`. The room readout gives up its own role for the same reason
 * (`RoomReadout.tsx`), because the end-to-end screenshot mask and three `getByRole('status')`
 * queries all find the HUD by there being a single status on the page.
 *
 * It is not a `role="spinbutton"` either. A spinbutton announces its value only while the
 * spinbutton itself has focus, and here focus lives on the two buttons; a polite live region
 * announces the new count wherever focus is. Declaring the role would also promise the
 * arrow-key, Home and End contract that this stepper deliberately does not implement.
 *
 * ## Why the bounds are `aria-disabled`, never `disabled`
 *
 * Stepping from 4 down to 1 with the keyboard would otherwise disable the button *under the
 * user's focus* on the last press, and a disabled element cannot hold focus: the user would
 * be dropped onto `<body>` mid-run, with no idea where they landed. `aria-disabled` keeps
 * the button focusable and announced as dimmed, the handler guards the press into a no-op,
 * and {@link STEP_BUTTON_CLASS_NAME} greys it.
 *
 * ## Keyboard, and focus after a press
 *
 * Native buttons and nothing else: Tab, Enter, Space. No arrow keys, no Home or End, no
 * press-and-hold repeat and no shortcut key — no role here promises that contract, the whole
 * range is nine presses end to end, and every free key of the interior view is already bound.
 *
 * A press never moves focus. `CameraModeToggle` hands focus back to the 3D view when
 * `event.detail` is above 0, the mark of a pointer click rather than a keyboard one, but
 * that is a control whose effect lives in the view's own key bindings. This stepper persists,
 * its presses come in runs of up to nine, and the screen readers that activate buttons with
 * real pointer events (iOS VoiceOver, TalkBack) would then jump to and re-announce the whole
 * `role="application"` region on every single tap. So `event.detail` is not read here at all,
 * and the handlers take no event.
 *
 * @returns The floor count stepper, in every view mode.
 */
export function FloorCountStepper() {
  const floorCount = useFloorCountStore((state) => state.floorCount);
  const increaseFloorCount = useFloorCountStore((state) => state.increaseFloorCount);
  const decreaseFloorCount = useFloorCountStore((state) => state.decreaseFloorCount);

  const atMin = floorCount <= MIN_FLOOR_COUNT;
  const atMax = floorCount >= MAX_FLOOR_COUNT;

  /**
   * The store clamps too, so a press at a bound would change nothing in any case. The guard
   * is here so the button's behaviour is decided where its `aria-disabled` is: what the
   * attribute promises and what the press does are one line apart and cannot drift.
   */
  const handleDecrease = () => {
    if (atMin) {
      return;
    }
    decreaseFloorCount();
  };

  const handleIncrease = () => {
    if (atMax) {
      return;
    }
    increaseFloorCount();
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-2 py-1 text-white shadow-lg sm:gap-3 sm:px-4 sm:py-2">
      <span id={FLOOR_COUNT_LABEL_ID} className="sr-only text-sm sm:not-sr-only">
        {PANEL_CAPTION}
      </span>
      <button
        type="button"
        aria-label={DECREASE_LABEL}
        aria-describedby={FLOOR_COUNT_VALUE_ID}
        aria-disabled={atMin}
        onClick={handleDecrease}
        className={STEP_BUTTON_CLASS_NAME}
      >
        <span aria-hidden="true">{MINUS_GLYPH}</span>
      </button>
      <p
        id={FLOOR_COUNT_VALUE_ID}
        aria-live="polite"
        aria-atomic="true"
        className="min-w-6 text-center text-sm font-semibold tabular-nums"
      >
        <span className="sr-only">{VALUE_PREFIX}</span>
        {formatFloorCount(floorCount)}
      </p>
      <button
        type="button"
        aria-label={INCREASE_LABEL}
        aria-describedby={FLOOR_COUNT_VALUE_ID}
        aria-disabled={atMax}
        onClick={handleIncrease}
        className={STEP_BUTTON_CLASS_NAME}
      >
        <span aria-hidden="true">{PLUS_GLYPH}</span>
      </button>
    </div>
  );
}
