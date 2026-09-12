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

/**
 * The live `prefers-reduced-motion: reduce` preference of the viewer.
 *
 * Read through `window.matchMedia` and kept current with a `change` listener, so
 * a viewer switching the preference on mid-session is obeyed without a reload;
 * the listener is removed when the component unmounts.
 *
 * **Defensive by design.** A missing `window.matchMedia` — an old browser, a
 * server-side render, a test environment such as jsdom that does not implement it
 * — yields `false` instead of throwing: a viewer who cannot be asked gets the
 * animated behaviour, which is the app's normal one, rather than a blank screen.
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
    queryList.addEventListener('change', handleChange);
    return () => {
      queryList.removeEventListener('change', handleChange);
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
