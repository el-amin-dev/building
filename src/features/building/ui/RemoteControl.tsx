import { useEffect } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { EyeAction } from '../domain/eyeNavigation.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';

/** Accessible name of the whole pad. */
const GROUP_LABEL = 'Remote control';
/** `KeyboardEvent.key` values that activate a native button. */
const ACTIVATION_KEYS: readonly string[] = Object.freeze([' ', 'Enter']);
const WINDOW_BLUR_EVENT = 'blur';
const WINDOW_POINTER_UP_EVENT = 'pointerup';

/** One button of the pad: the action it holds, its accessible name and its glyph. */
interface RemoteButtonSpec {
  /** The navigation action held while the button is held. */
  readonly action: EyeAction;
  /** Accessible name, e.g. `'Move forward'`. */
  readonly label: string;
  /** Visible arrow, hidden from assistive technology, which reads `label` instead. */
  readonly glyph: string;
}

/** Walking buttons, laid out as a cross: forward above, left/back/right below. Frozen. */
const MOVE_FORWARD: RemoteButtonSpec = Object.freeze({
  action: 'moveForward',
  label: 'Move forward',
  glyph: '↑',
});
const MOVE_ROW: readonly RemoteButtonSpec[] = Object.freeze([
  Object.freeze({ action: 'strafeLeft', label: 'Strafe left', glyph: '←' }),
  Object.freeze({ action: 'moveBackward', label: 'Move back', glyph: '↓' }),
  Object.freeze({ action: 'strafeRight', label: 'Strafe right', glyph: '→' }),
] as const);
/** Turning buttons (yaw). Frozen. */
const TURN_BUTTONS: readonly RemoteButtonSpec[] = Object.freeze([
  Object.freeze({ action: 'turnLeft', label: 'Turn left', glyph: '⟲' }),
  Object.freeze({ action: 'turnRight', label: 'Turn right', glyph: '⟳' }),
] as const);
/** Looking buttons (pitch). Frozen. */
const LOOK_BUTTONS: readonly RemoteButtonSpec[] = Object.freeze([
  Object.freeze({ action: 'lookUp', label: 'Look up', glyph: '▲' }),
  Object.freeze({ action: 'lookDown', label: 'Look down', glyph: '▼' }),
] as const);

/** Captions of the clusters, for sighted users; the buttons carry the accessible names. */
const MOVE_CAPTION = 'Move';
const TURN_CAPTION = 'Turn';
const LOOK_CAPTION = 'Look';

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

/** Moves focus back to the 3D view region, so the navigation keys keep working. */
function focusInteriorRegion(): void {
  document.getElementById(INTERIOR_REGION_ID)?.focus();
}

/**
 * One hold-to-act button of the remote control.
 *
 * It holds its action while it is held down and releases it as soon as the hold ends, by
 * any route: `pointerup`, `pointercancel` (the browser took the pointer over, e.g. for a
 * scroll gesture), `lostpointercapture`, a key release, or losing focus. Nothing here
 * depends on a drag or a gesture (WCAG 2.5.7): a single press is enough.
 *
 * After a pointer hold, focus returns to the 3D view region, the `CameraModeToggle`
 * precedent, so the keys keep working; a keyboard hold leaves focus on the button, where
 * the user put it.
 *
 * @param props - {@link RemoteButtonSpec}
 * @returns The button.
 */
function RemoteButton({ action, label, glyph }: RemoteButtonSpec) {
  const isHeld = useRemoteControlStore((state) => state.activeActions.has(action));
  const pressAction = useRemoteControlStore((state) => state.pressAction);
  const releaseAction = useRemoteControlStore((state) => state.releaseAction);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    pressAction(action);
    capturePointer(event.currentTarget, event.pointerId);
  };

  const handlePointerRelease = () => {
    releaseAction(action);
    focusInteriorRegion();
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

  const handleBlur = () => {
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
      className="flex min-h-11 min-w-11 cursor-pointer touch-none items-center justify-center rounded-md bg-white text-lg leading-none font-semibold text-slate-900 select-none hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 aria-pressed:bg-amber-300 aria-pressed:hover:bg-amber-200"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * HUD remote control: an on-screen replacement for every navigation key.
 *
 * The owner cannot always use a keyboard, so each of the eight navigation actions
 * (forward, back, strafe left/right, turn left/right, look up/down) has its own button,
 * held with a pointer, a finger, or with Space or Enter while it has focus. No drag and no
 * gesture is involved (WCAG 2.5.7) and every target is at least 44 px (WCAG 2.5.8).
 * Rendered only in the interior view, where navigation applies.
 *
 * A held action must never stick: a stuck turn would spin the camera forever. Four nets
 * catch it — the button's own release routes, a window `pointerup` (the pointer went up
 * outside the pad), a window `blur` (Alt/Cmd-Tab away), and the effect cleanup, which also
 * covers leaving the interior view and unmounting.
 *
 * Below the `sm` breakpoint the pad takes itself out of the HUD stack (`fixed`) and anchors to
 * the bottom of the screen, full width and centred: within thumb reach, and no longer stacked
 * under the toggles, where it pushed the 3D view into a strip at the bottom of the screen.
 * Since it leaves the flow, the stack above shrinks to the toggles and the one-line hint. From
 * that breakpoint up it is `static` again, the last panel of the stack, exactly as before.
 * Nothing else changes with the width: the buttons keep their size, names and behaviour, and
 * the DOM order — so the Tab order — is the same everywhere.
 *
 * @returns The remote control in the interior view, otherwise `null`.
 */
export function RemoteControl() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const releaseAllActions = useRemoteControlStore((state) => state.releaseAllActions);

  useEffect(() => {
    if (!isInterior) {
      releaseAllActions();
      return undefined;
    }

    const releaseAll = () => {
      releaseAllActions();
    };

    window.addEventListener(WINDOW_BLUR_EVENT, releaseAll);
    window.addEventListener(WINDOW_POINTER_UP_EVENT, releaseAll);

    return () => {
      window.removeEventListener(WINDOW_BLUR_EVENT, releaseAll);
      window.removeEventListener(WINDOW_POINTER_UP_EVENT, releaseAll);
      releaseAll();
    };
  }, [isInterior, releaseAllActions]);

  if (!isInterior) {
    return null;
  }

  return (
    <div
      role="group"
      aria-label={GROUP_LABEL}
      className="fixed inset-x-2 bottom-2 z-20 flex flex-wrap items-end justify-center gap-2 rounded-lg bg-slate-900 p-2 text-white shadow-lg sm:static sm:justify-start sm:gap-4 sm:p-3"
    >
      <div className="flex flex-col items-center gap-1">
        <span aria-hidden="true" className="text-xs font-medium">
          {MOVE_CAPTION}
        </span>
        <RemoteButton {...MOVE_FORWARD} />
        <div className="flex gap-1">
          {MOVE_ROW.map((spec) => (
            <RemoteButton key={spec.action} {...spec} />
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span aria-hidden="true" className="text-xs font-medium">
          {TURN_CAPTION}
        </span>
        <div className="flex gap-1">
          {TURN_BUTTONS.map((spec) => (
            <RemoteButton key={spec.action} {...spec} />
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span aria-hidden="true" className="text-xs font-medium">
          {LOOK_CAPTION}
        </span>
        <div className="flex gap-1">
          {LOOK_BUTTONS.map((spec) => (
            <RemoteButton key={spec.action} {...spec} />
          ))}
        </div>
      </div>
    </div>
  );
}
