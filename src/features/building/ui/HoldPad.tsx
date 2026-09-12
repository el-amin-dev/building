import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { HoldToActStore } from '../application/createHoldToActStore.ts';

/** `KeyboardEvent.key` values that activate a native button. */
const ACTIVATION_KEYS: readonly string[] = Object.freeze([' ', 'Enter']);
const WINDOW_BLUR_EVENT = 'blur';
const WINDOW_POINTER_UP_EVENT = 'pointerup';
const WINDOW_POINTER_CANCEL_EVENT = 'pointercancel';

/**
 * Where a pad sits in the HUD.
 *
 * Below the `sm` breakpoint the pad takes itself out of the HUD stack (`fixed`) and anchors
 * to the bottom of the screen, full width and centred: within thumb reach, and no longer
 * stacked under the toggles, where it pushed the 3D view into a strip at the bottom of the
 * screen. Since it leaves the flow, the stack above shrinks to the toggles and the one-line
 * hint. From that breakpoint up it is `static` again, the last panel of the stack.
 *
 * One anchor is enough for every pad because at most one is ever mounted: a pad belongs to
 * one view, and the views are mutually exclusive.
 */
const PAD_CLASS_NAME =
  'fixed inset-x-2 bottom-2 z-20 flex flex-wrap items-end justify-center gap-2 rounded-lg bg-slate-900 p-2 text-white shadow-lg sm:static sm:justify-start sm:gap-4 sm:p-3';
/** One captioned cluster of the pad: its caption above its rows of buttons. */
const CLUSTER_CLASS_NAME = 'flex flex-col items-center gap-1';
/** The cluster caption, for sighted users; the buttons carry the accessible names. */
const CAPTION_CLASS_NAME = 'text-xs font-medium';
/** One row of buttons inside a cluster. */
const ROW_CLASS_NAME = 'flex gap-1';
/** One hold-to-act button: at least 44 px on both axes (WCAG 2.5.8). */
const BUTTON_CLASS_NAME =
  'flex min-h-11 min-w-11 cursor-pointer touch-none items-center justify-center rounded-md bg-white text-lg leading-none font-semibold text-slate-900 select-none hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 aria-pressed:bg-amber-300 aria-pressed:hover:bg-amber-200';

/**
 * Which action every pressing pointer holds, keyed by its `PointerEvent.pointerId`.
 *
 * Two fingers is the natural way to walk and turn at once, so a pointer going up may only
 * release what that pointer was holding. The ledger is what makes that possible: the button
 * writes its action down on `pointerdown` and takes it back out on release, and the
 * window-level net looks the lifted pointer up instead of releasing everything.
 *
 * The ledger — never the element an event landed on — is the authority on what a pointer
 * holds, and several entries may name the same action (two fingers on one button).
 *
 * @typeParam TAction - The pad's action vocabulary.
 */
type HeldPointers<TAction extends string> = Map<number, TAction>;

/** One button of a pad: the action it holds, its accessible name and its glyph. */
export interface HoldPadButtonSpec<TAction extends string> {
  /** The action held while the button is held. */
  readonly action: TAction;
  /** Accessible name, e.g. `'Move forward'`. */
  readonly label: string;
  /** Visible glyph, hidden from assistive technology, which reads `label` instead. */
  readonly glyph: string;
}

/** One captioned cluster of a pad, e.g. the walking cross or the zoom pair. */
export interface HoldPadCluster<TAction extends string> {
  /** Caption shown above the cluster, hidden from assistive technology. */
  readonly caption: string;
  /** The cluster's buttons, one inner array per row, in reading order. */
  readonly rows: readonly (readonly HoldPadButtonSpec<TAction>[])[];
}

/** What a pad needs: its name, its buttons, its store and whether its view is showing. */
export interface HoldPadProps<TAction extends string> {
  /** Accessible name of the whole pad, e.g. `'Remote control'`. */
  readonly groupLabel: string;
  /** The pad's clusters, in reading order. */
  readonly clusters: readonly HoldPadCluster<TAction>[];
  /** The store the pad presses and releases actions on. */
  readonly store: HoldToActStore<TAction>;
  /**
   * DOM id focus returns to after a pointer hold, so the navigation keys keep working.
   * Omitted when the view has no focusable region to hand focus back to: focus then stays
   * where the pointer left it.
   */
  readonly focusTargetId?: string;
  /** Whether the pad's view is showing. `false` renders nothing and releases every action. */
  readonly active: boolean;
}

/**
 * Tells whether a key press activates a button.
 *
 * @param key - A `KeyboardEvent.key` value.
 * @returns `true` for Space and Enter, the two keys native buttons answer to.
 */
function isActivationKey(key: string): boolean {
  return ACTIVATION_KEYS.includes(key);
}

/**
 * Routes every later event of this pointer to the button, so sliding off it still releases
 * the action on the button itself (`pointerup` / `lostpointercapture`).
 *
 * Pointer capture is not implemented everywhere (jsdom has no such method), so a missing
 * method is simply skipped: the window-level release then ends the hold.
 *
 * @param button - The button being held.
 * @param pointerId - `PointerEvent.pointerId` of the pointer holding it.
 */
function capturePointer(button: HTMLButtonElement, pointerId: number): void {
  if (typeof button.setPointerCapture !== 'function') {
    return;
  }
  button.setPointerCapture(pointerId);
}

/**
 * Tells whether any pointer left in the ledger holds `action`.
 *
 * @param held - The pad's ledger of pressing pointers.
 * @param action - The action to look for.
 * @returns `true` while at least one entry names it.
 */
function isActionStillHeld<TAction extends string>(
  held: HeldPointers<TAction>,
  action: TAction,
): boolean {
  for (const heldAction of held.values()) {
    if (heldAction === action) {
      return true;
    }
  }
  return false;
}

/**
 * Takes one pointer out of the ledger and reports the action that is now free, if any.
 *
 * Two fingers may press the same button, and the store holds a set of actions rather than a
 * count, so the action is freed by the last finger, not the first: while another entry still
 * names it, nothing is released and the button stays pressed.
 *
 * @param held - The pad's ledger of pressing pointers.
 * @param pointerId - `PointerEvent.pointerId` of the pointer whose hold is ending.
 * @returns The action to release, or `undefined` when the pointer held nothing or another
 *   pointer still holds what it was holding.
 */
function takePointerHold<TAction extends string>(
  held: HeldPointers<TAction>,
  pointerId: number,
): TAction | undefined {
  const action = held.get(pointerId);
  if (action === undefined) {
    return undefined;
  }
  held.delete(pointerId);
  return isActionStillHeld(held, action) ? undefined : action;
}

/**
 * Moves focus back to the pad's view region, so the navigation keys keep working.
 *
 * @param focusTargetId - DOM id of the region, or `undefined` when the view has none.
 */
function focusViewRegion(focusTargetId: string | undefined): void {
  if (focusTargetId === undefined) {
    return;
  }
  document.getElementById(focusTargetId)?.focus();
}

/** What one button needs: its own spec, the pad's ledger, store and focus target. */
interface HoldButtonProps<TAction extends string> extends HoldPadButtonSpec<TAction> {
  /** {@link HeldPointers}, written on press and cleared on release. */
  readonly heldPointers: RefObject<HeldPointers<TAction>>;
  /** The store the button presses and releases its action on. */
  readonly store: HoldToActStore<TAction>;
  /** DOM id focus returns to after a pointer hold; see {@link HoldPadProps.focusTargetId}. */
  readonly focusTargetId: string | undefined;
}

/**
 * One hold-to-act button of a pad.
 *
 * It holds its action while it is held down and releases it as soon as the hold ends, by
 * any route: `pointerup`, `pointercancel` (the browser took the pointer over, e.g. for a
 * scroll gesture), `lostpointercapture`, a key release, or losing focus. Nothing here
 * depends on a drag or a gesture (WCAG 2.5.7): a single press is enough.
 *
 * After a pointer hold, focus returns to the view region named by `focusTargetId`, the
 * `CameraModeToggle` precedent, so the keys keep working; a keyboard hold leaves focus on
 * the button, where the user put it.
 *
 * @param props - {@link HoldButtonProps}
 * @returns The button.
 */
function HoldButton<TAction extends string>({
  action,
  label,
  glyph,
  heldPointers,
  store,
  focusTargetId,
}: HoldButtonProps<TAction>) {
  const isHeld = store((state) => state.activeActions.has(action));
  const pressAction = store((state) => state.pressAction);
  const releaseAction = store((state) => state.releaseAction);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    heldPointers.current.set(event.pointerId, action);
    pressAction(action);
    capturePointer(event.currentTarget, event.pointerId);
  };

  /**
   * Ends this button's hold for the lifting pointer: `pointerup`, `pointercancel` or a lost
   * capture.
   *
   * The ledger decides whose hold this is, not the element the event landed on. Where pointer
   * capture is unavailable or lost (jsdom, older WebViews, an element removed mid-gesture) a
   * finger that slid off the button it pressed lifts over a neighbour, and that neighbour must
   * leave the pointer completely alone — its ledger entry included — or the window-level net
   * would find nothing to release and the first button would stay held forever.
   */
  const handlePointerRelease = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (heldPointers.current.get(event.pointerId) !== action) {
      return;
    }
    const freedAction = takePointerHold(heldPointers.current, event.pointerId);
    if (freedAction !== undefined) {
      releaseAction(freedAction);
    }
    focusViewRegion(focusTargetId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || !isActivationKey(event.key)) {
      return;
    }
    pressAction(action);
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isActivationKey(event.key)) {
      return;
    }
    releaseAction(action);
  };

  /**
   * Ends a hold whose end this button would otherwise never see: focus leaves while a key is
   * down, so no `keyup` will arrive here.
   *
   * A pointer hold is not bound to focus, though — a finger may still be pressing this very
   * button, and handing focus back to the 3D view blurs it — so an action the ledger still
   * holds is left to its own release route.
   */
  const handleBlur = () => {
    if (isActionStillHeld(heldPointers.current, action)) {
      return;
    }
    releaseAction(action);
  };

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isHeld}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerRelease}
      onPointerCancel={handlePointerRelease}
      onLostPointerCapture={handlePointerRelease}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={handleBlur}
      className={BUTTON_CLASS_NAME}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * A HUD pad of hold-to-act buttons: an on-screen replacement for a view's navigation keys.
 *
 * The owner cannot always use a keyboard, so every navigation action gets its own button,
 * held with a pointer, a finger, or with Space or Enter while it has focus. No drag and no
 * gesture is involved (WCAG 2.5.7) and every target is at least 44 px (WCAG 2.5.8). A pad is
 * rendered only while `active`, i.e. while the view its actions belong to is showing.
 *
 * A held action must never stick: a stuck turn would spin the camera forever. Four nets
 * catch it — the button's own release routes, a window `pointerup` / `pointercancel` (the
 * pointer went up or was taken over outside the pad), a window `blur` (Alt/Cmd-Tab away),
 * and the effect cleanup, which also covers leaving the view and unmounting.
 *
 * The window-level pointer net releases only what the lifted pointer itself was holding,
 * looked up in {@link HeldPointers}: walking while turning is two fingers on two buttons,
 * and lifting one of them may not stop the other. Every per-button release is checked against
 * the ledger the same way, so a pointer the ledger attributes to another button is left to
 * that button and to the window net; and an action two pointers hold at once ends with the
 * last of them. `blur`, a view change and unmounting are the genuine "everything stops"
 * cases, so those do release every action at once.
 *
 * Nothing here knows a vocabulary: the actions, names, glyphs and store all come from the
 * props, so a second pad is a list of specs rather than a second copy of the ledger and its
 * nets (ADR-012).
 *
 * @param props - {@link HoldPadProps}
 * @returns The pad while `active`, otherwise `null`.
 */
export function HoldPad<TAction extends string>({
  groupLabel,
  clusters,
  store,
  focusTargetId,
  active,
}: HoldPadProps<TAction>) {
  const releaseAction = store((state) => state.releaseAction);
  const releaseAllActions = store((state) => state.releaseAllActions);
  /** Which action each pressing pointer holds; see {@link HeldPointers}. */
  const heldPointers = useRef<HeldPointers<TAction>>(new Map());

  useEffect(() => {
    const held = heldPointers.current;

    const releaseAll = () => {
      held.clear();
      releaseAllActions();
    };

    if (!active) {
      releaseAll();
      return undefined;
    }

    /**
     * Releases the action of the pointer that is lifting, and nothing else — and only once no
     * other pointer still holds that same action.
     */
    const releasePointer = (event: PointerEvent) => {
      const freedAction = takePointerHold(held, event.pointerId);
      if (freedAction !== undefined) {
        releaseAction(freedAction);
      }
    };

    window.addEventListener(WINDOW_BLUR_EVENT, releaseAll);
    window.addEventListener(WINDOW_POINTER_UP_EVENT, releasePointer);
    window.addEventListener(WINDOW_POINTER_CANCEL_EVENT, releasePointer);

    return () => {
      window.removeEventListener(WINDOW_BLUR_EVENT, releaseAll);
      window.removeEventListener(WINDOW_POINTER_UP_EVENT, releasePointer);
      window.removeEventListener(WINDOW_POINTER_CANCEL_EVENT, releasePointer);
      releaseAll();
    };
  }, [active, releaseAction, releaseAllActions]);

  if (!active) {
    return null;
  }

  return (
    <div role="group" aria-label={groupLabel} className={PAD_CLASS_NAME}>
      {clusters.map((cluster) => (
        <div key={cluster.caption} className={CLUSTER_CLASS_NAME}>
          <span aria-hidden="true" className={CAPTION_CLASS_NAME}>
            {cluster.caption}
          </span>
          {cluster.rows.map((row) => (
            <div key={row.map((spec) => spec.action).join()} className={ROW_CLASS_NAME}>
              {row.map((spec) => (
                <HoldButton
                  key={spec.action}
                  {...spec}
                  heldPointers={heldPointers}
                  store={store}
                  focusTargetId={focusTargetId}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
