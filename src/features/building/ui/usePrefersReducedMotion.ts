import { useEffect, useState } from 'react';

/**
 * The media query that asks whether the viewer wants less motion.
 *
 * Exported so that a test, or any other reader of the preference, names the same
 * query rather than respelling it.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** What the preference is taken to be where the platform cannot be asked at all. */
const NO_PREFERENCE = false;

/** The event a `MediaQueryList` fires when its `matches` flips. */
const CHANGE_EVENT = 'change';

/**
 * The live `prefers-reduced-motion: reduce` preference of the viewer.
 *
 * Read through `window.matchMedia` and kept current with a `change` listener, so
 * a viewer switching the preference on mid-session is obeyed without a reload;
 * the listener is removed when the component unmounts.
 *
 * **Defensive by design**, in both of the two ways a platform can fall short:
 *
 * - a missing `window.matchMedia` — an old browser, a server-side render, a test
 *   environment such as jsdom that does not implement it — yields `false` instead
 *   of throwing: a viewer who cannot be asked gets the animated behaviour, which
 *   is the app's normal one, rather than a blank screen;
 * - a query list with no `addEventListener` — Safari before 14, which exposes only
 *   the older `addListener`/`removeListener` pair — is still subscribed to, through
 *   whichever of the two it has. The preference is otherwise read once and then
 *   never followed, which on that browser is the silent half of the bug: the value
 *   is right at mount and wrong from the first time the viewer changes it.
 *
 * @returns `true` while the viewer asks for reduced motion, `false` otherwise.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => getQueryList()?.matches ?? NO_PREFERENCE,
  );

  useEffect(() => {
    const queryList = getQueryList();
    if (queryList === undefined) {
      return;
    }

    const handleChange = (event: MediaQueryListEvent): void => {
      setPrefersReducedMotion(event.matches);
    };

    if (typeof queryList.addEventListener === 'function') {
      queryList.addEventListener(CHANGE_EVENT, handleChange);
      return () => {
        queryList.removeEventListener(CHANGE_EVENT, handleChange);
      };
    }
    // Deprecated, and the only listener Safari < 14 has.
    queryList.addListener(handleChange);
    return () => {
      queryList.removeListener(handleChange);
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * The reduced-motion query list, or `undefined` where `matchMedia` is missing.
 *
 * @returns The live query list of {@link REDUCED_MOTION_QUERY}.
 */
function getQueryList(): MediaQueryList | undefined {
  if (typeof window.matchMedia !== 'function') {
    return undefined;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY);
}
