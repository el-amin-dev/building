import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY, usePrefersReducedMotion } from './usePrefersReducedMotion.ts';

/** The `matchMedia` the test setup installs, restored after every test here. */
const realMatchMedia = window.matchMedia;

/** A `MediaQueryList` whose `matches` a test sets and whose listeners it can fire. */
interface QueryListStub {
  /** The query list handed to the hook. */
  readonly queryList: MediaQueryList;
  /** Fires a `change` event at every registered listener. */
  readonly fireChange: (matches: boolean) => void;
  /** The listeners currently registered on the list. */
  readonly listeners: Set<(event: MediaQueryListEvent) => void>;
  /** The queries `matchMedia` was asked for, in order. */
  readonly queries: string[];
}

/**
 * Installs a `window.matchMedia` answering with `matches` for every query.
 *
 * @param matches - What the query list reports at first.
 * @returns The stub, so a test can fire a change or inspect the listeners.
 */
function stubMatchMedia(matches: boolean): QueryListStub {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const queries: string[] = [];
  let current = matches;

  const queryList = {
    get matches() {
      return current;
    },
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList;

  window.matchMedia = (query: string) => {
    queries.push(query);
    return queryList;
  };

  return {
    queryList,
    listeners,
    queries,
    fireChange: (next: boolean) => {
      current = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
  };
}

/**
 * Installs a `window.matchMedia` whose query list has only `addListener`.
 *
 * The shape Safari shipped before 14: no `addEventListener` at all, so a hook that
 * reaches straight for it either throws or silently never follows the preference.
 *
 * @param matches - What the query list reports at first.
 * @returns The stub, so a test can fire a change or inspect the listeners.
 */
function stubLegacyMatchMedia(matches: boolean): QueryListStub {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const queries: string[] = [];
  let current = matches;

  const queryList = {
    get matches() {
      return current;
    },
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;

  window.matchMedia = (query: string) => {
    queries.push(query);
    return queryList;
  };

  return {
    queryList,
    listeners,
    queries,
    fireChange: (next: boolean) => {
      current = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
  };
}

describe('usePrefersReducedMotion', () => {
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    vi.unstubAllGlobals();
  });

  it('reports true while the viewer asks for reduced motion', () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => usePrefersReducedMotion());

    expect(result.current).toBe(true);
  });

  it('reports false while the viewer does not', () => {
    stubMatchMedia(false);

    const { result } = renderHook(() => usePrefersReducedMotion());

    expect(result.current).toBe(false);
  });

  it('asks for the reduced-motion query', () => {
    const stub = stubMatchMedia(false);

    renderHook(() => usePrefersReducedMotion());

    expect(stub.queries).toContain(REDUCED_MOTION_QUERY);
  });

  it('follows a change of the preference', () => {
    const stub = stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());

    act(() => {
      stub.fireChange(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      stub.fireChange(false);
    });
    expect(result.current).toBe(false);
  });

  it('removes its listener when the component unmounts', () => {
    const stub = stubMatchMedia(false);
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(stub.listeners.size).toBe(1);

    unmount();

    expect(stub.listeners.size).toBe(0);
  });

  it('reports false instead of throwing where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);

    const { result } = renderHook(() => usePrefersReducedMotion());

    expect(result.current).toBe(false);
  });

  it('follows a change through the legacy listener of Safari before 14', () => {
    const stub = stubLegacyMatchMedia(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(stub.listeners.size).toBe(1);

    act(() => {
      stub.fireChange(true);
    });
    expect(result.current).toBe(true);

    unmount();

    expect(stub.listeners.size).toBe(0);
  });
});
