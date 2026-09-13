import { beforeEach, describe, expect, it } from 'vitest';
import { createHoldToActStore } from './createHoldToActStore.ts';

/**
 * A stand-in vocabulary: the factory knows nothing of any real action set, so the generic
 * behaviours are pinned on names no view uses.
 */
const TEST_ACTIONS = Object.freeze(['alpha', 'beta', 'gamma'] as const);
type TestAction = (typeof TEST_ACTIONS)[number];

/** A second, disjoint vocabulary, to show what two stores do and do not share. */
type OtherAction = 'first' | 'second';

const useTestStore = createHoldToActStore<TestAction>();

function activeActions(): ReadonlySet<TestAction> {
  return useTestStore.getState().activeActions;
}

describe('createHoldToActStore', () => {
  beforeEach(() => {
    useTestStore.setState(useTestStore.getInitialState(), true);
  });

  it('holds no action at first', () => {
    expect(activeActions().size).toBe(0);
  });

  it.each(TEST_ACTIONS)('holds %s alone while it is pressed', (action) => {
    useTestStore.getState().pressAction(action);

    expect(activeActions()).toEqual(new Set([action]));
  });

  it.each(TEST_ACTIONS)('releases %s again', (action) => {
    useTestStore.getState().pressAction(action);
    useTestStore.getState().releaseAction(action);

    expect(activeActions().size).toBe(0);
  });

  it('holds several actions at once, each independent of the others', () => {
    useTestStore.getState().pressAction('alpha');
    useTestStore.getState().pressAction('beta');
    expect(activeActions()).toEqual(new Set(['alpha', 'beta']));

    useTestStore.getState().releaseAction('beta');
    expect(activeActions()).toEqual(new Set(['alpha']));
  });

  it('ignores a second press of an action already held', () => {
    useTestStore.getState().pressAction('alpha');
    const held = activeActions();

    useTestStore.getState().pressAction('alpha');

    expect(activeActions()).toBe(held);
    expect(activeActions()).toEqual(new Set(['alpha']));
  });

  it('ignores the release of an action that is not held', () => {
    useTestStore.getState().pressAction('alpha');
    const held = activeActions();

    useTestStore.getState().releaseAction('gamma');

    expect(activeActions()).toBe(held);
  });

  it('releases every action at once', () => {
    for (const action of TEST_ACTIONS) {
      useTestStore.getState().pressAction(action);
    }
    expect(activeActions().size).toBe(TEST_ACTIONS.length);

    useTestStore.getState().releaseAllActions();

    expect(activeActions().size).toBe(0);
  });

  it('leaves the state alone when releasing everything while nothing is held', () => {
    const held = activeActions();

    useTestStore.getState().releaseAllActions();

    expect(activeActions()).toBe(held);
  });

  it('comes back to the very set it started from when everything is released', () => {
    useTestStore.getState().pressAction('alpha');

    useTestStore.getState().releaseAllActions();

    expect(activeActions()).toBe(useTestStore.getInitialState().activeActions);
  });

  it('never mutates the previous set', () => {
    useTestStore.getState().pressAction('alpha');
    const afterPress = activeActions();

    useTestStore.getState().pressAction('beta');
    expect(afterPress).toEqual(new Set(['alpha']));

    useTestStore.getState().releaseAllActions();
    expect(afterPress).toEqual(new Set(['alpha']));
  });

  it('replaces the set on every change', () => {
    const empty = activeActions();
    useTestStore.getState().pressAction('alpha');
    const one = activeActions();
    useTestStore.getState().pressAction('beta');

    expect(one).not.toBe(empty);
    expect(activeActions()).not.toBe(one);
  });

  it('starts every store, whatever its vocabulary, from the one frozen empty set', () => {
    const first = createHoldToActStore<TestAction>();
    const second = createHoldToActStore<OtherAction>();

    const shared = first.getInitialState().activeActions;
    expect(second.getInitialState().activeActions).toBe(shared);
    expect(shared.size).toBe(0);
    expect(Object.isFrozen(shared)).toBe(true);
  });

  it('holds each store’s actions apart from every other store’s', () => {
    const other = createHoldToActStore<OtherAction>();

    useTestStore.getState().pressAction('alpha');
    other.getState().pressAction('first');

    expect(activeActions()).toEqual(new Set(['alpha']));
    expect(other.getState().activeActions).toEqual(new Set(['first']));

    other.getState().releaseAllActions();

    expect(activeActions()).toEqual(new Set(['alpha']));
  });
});
