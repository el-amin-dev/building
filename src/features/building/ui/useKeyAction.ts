import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const KEY_DOWN_EVENT = 'keydown';

/**
 * Runs an action once per press of a physical key while a given element has focus.
 *
 * - The listener is attached to the target element only, so a single-character key acts
 *   only while that element is focused (WCAG 2.1.4, Character Key Shortcuts).
 * - It fires when `event.code` matches and no Ctrl, Alt or Meta modifier is held, so
 *   browser and OS shortcuts (e.g. Ctrl+V) keep working; the default behaviour of a
 *   handled press is prevented.
 * - Auto-repeated keydown events of a held key are ignored: one press, one action.
 * - The latest `onPress` is always called, without re-attaching the listener, so an
 *   inline arrow function is fine.
 *
 * The target element must already be mounted when this hook's effect runs (see
 * `usePressedKeys`); if `targetRef.current` is `null` at that point, nothing is listened to.
 *
 * @param targetRef - Ref to the focusable element whose key presses trigger the action.
 * @param code - The `KeyboardEvent.code` of the physical key, e.g. `'KeyV'`.
 * @param onPress - The action to run on each press.
 */
export function useKeyAction(
  targetRef: RefObject<HTMLElement | null>,
  code: string,
  onPress: () => void,
): void {
  const onPressRef = useRef(onPress);

  useLayoutEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);

  useEffect(() => {
    const target = targetRef.current;
    if (target === null) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== code || event.repeat || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      event.preventDefault();
      onPressRef.current();
    };

    target.addEventListener(KEY_DOWN_EVENT, handleKeyDown);
    return () => {
      target.removeEventListener(KEY_DOWN_EVENT, handleKeyDown);
    };
  }, [targetRef, code]);
}
