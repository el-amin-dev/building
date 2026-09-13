import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Minimal `window.matchMedia`, which jsdom does not implement at all.
 *
 * Without it every component that reads a media preference — the reduced-motion
 * one the camera transition obeys, and whatever follows it — throws on render
 * unless each test stubs the global itself. It reports no match and registers no
 * listener, which is the default the app is designed around (see
 * `usePrefersReducedMotion`), and a test that cares assigns its own
 * `window.matchMedia` or uses `vi.stubGlobal` to override it.
 *
 * Guarded on there being a `window` at all: this setup file is shared by every
 * test, including the ones that opt into the node environment with
 * `// @vitest-environment node` (`tooling/parsePort.test.ts`), which have no DOM
 * to stub and would otherwise fail to load here.
 */
if (typeof window !== 'undefined') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
