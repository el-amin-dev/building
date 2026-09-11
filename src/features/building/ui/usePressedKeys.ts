import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const KEY_DOWN_EVENT = 'keydown';
const KEY_UP_EVENT = 'keyup';
const BLUR_EVENT = 'blur';
/** `KeyboardEvent.key` of both Meta keys (MetaLeft / MetaRight, i.e. Cmd on macOS). */
const META_KEY = 'Meta';

/**
 * Tells whether the event concerns a Meta key itself (not a key pressed with Meta held).
 *
 * @param event - The keyboard event to inspect.
 * @returns `true` when the pressed or released key is Meta.
 */
function isMetaKey(event: KeyboardEvent): boolean {
  return event.key === META_KEY;
}

/**
 * Tells whether a held key combination is reserved for the browser or the OS
 * (e.g. Ctrl+W, Alt+F4, Cmd+Q) and must therefore never be treated as input.
 *
 * @param event - The keyboard event to inspect.
 * @returns `true` when a Ctrl, Alt or Meta modifier is held.
 */
function hasShortcutModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.altKey || event.metaKey;
}

/**
 * Tracks which physical keys (`KeyboardEvent.code`) are currently held while a given
 * element has focus, without ever triggering a re-render.
 *
 * Designed to be read from a per-frame loop (e.g. a camera controller): the returned
 * ref's `current` set is mutated in place as keys go down and up.
 *
 * - Listeners are attached to the target element only, so single-character shortcuts
 *   act only while that element is focused (WCAG 2.1.4, Character Key Shortcuts).
 * - Untracked keys are ignored and keep their default behaviour (Tab, etc.).
 * - Tracked keys pressed together with Ctrl, Alt or Meta are ignored so browser/OS
 *   shortcuts are left untouched; tracked keys otherwise have their default prevented.
 * - Releasing a key removes it regardless of modifiers.
 * - Pressing or releasing Meta (Cmd) clears every held key: macOS browsers do not fire
 *   `keyup` for other keys while Cmd is held, so a key released during the hold would
 *   otherwise stay stuck. Meta itself keeps its default behaviour.
 * - Losing focus (element blur) or leaving the window (window blur, e.g. Alt/Cmd-Tab)
 *   clears every held key to avoid stuck input.
 *
 * The target element must already be mounted when this hook's effect runs (i.e. rendered
 * by the same or a parent component, before this hook's component commits); if
 * `targetRef.current` is `null` at that point, nothing is tracked.
 *
 * @param targetRef - Ref to the focusable element whose keyboard events are tracked.
 * @param isTracked - Predicate selecting the key codes to track. Must be stable across
 *   renders (ideally a module-level function); a new function identity re-attaches the
 *   listeners and clears the held keys.
 * @returns A ref whose `current` set holds the codes of the tracked keys currently held.
 */
export function usePressedKeys(
  targetRef: RefObject<HTMLElement | null>,
  isTracked: (code: string) => boolean,
): RefObject<ReadonlySet<string>> {
  const pressedRef = useRef<Set<string>>(new Set<string>());

  useEffect(() => {
    const target = targetRef.current;
    const pressed = pressedRef.current;
    if (target === null) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isMetaKey(event)) {
        pressed.clear();
        return;
      }
      if (!isTracked(event.code) || hasShortcutModifier(event)) {
        return;
      }
      pressed.add(event.code);
      event.preventDefault();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isMetaKey(event)) {
        pressed.clear();
        return;
      }
      pressed.delete(event.code);
    };

    const clearPressed = () => {
      pressed.clear();
    };

    target.addEventListener(KEY_DOWN_EVENT, handleKeyDown);
    target.addEventListener(KEY_UP_EVENT, handleKeyUp);
    target.addEventListener(BLUR_EVENT, clearPressed);
    window.addEventListener(BLUR_EVENT, clearPressed);

    return () => {
      target.removeEventListener(KEY_DOWN_EVENT, handleKeyDown);
      target.removeEventListener(KEY_UP_EVENT, handleKeyUp);
      target.removeEventListener(BLUR_EVENT, clearPressed);
      window.removeEventListener(BLUR_EVENT, clearPressed);
      pressed.clear();
    };
  }, [targetRef, isTracked]);

  return pressedRef;
}
