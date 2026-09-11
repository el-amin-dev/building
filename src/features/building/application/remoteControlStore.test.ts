import { beforeEach, describe, expect, it } from 'vitest';
import { EYE_ACTIONS } from '../domain/eyeNavigation.ts';
import { useRemoteControlStore } from './remoteControlStore.ts';

function activeActions(): ReadonlySet<string> {
  return useRemoteControlStore.getState().activeActions;
}

describe('useRemoteControlStore', () => {
  beforeEach(() => {
    useRemoteControlStore.setState(useRemoteControlStore.getInitialState(), true);
  });

  it('holds no action at first', () => {
    expect(activeActions().size).toBe(0);
  });

  it.each(EYE_ACTIONS)('holds %s alone while it is pressed', (action) => {
    useRemoteControlStore.getState().pressAction(action);

    expect(activeActions()).toEqual(new Set([action]));
  });

  it.each(EYE_ACTIONS)('releases %s again', (action) => {
    useRemoteControlStore.getState().pressAction(action);
    useRemoteControlStore.getState().releaseAction(action);

    expect(activeActions().size).toBe(0);
  });

  it('holds several actions at once, each independent of the others', () => {
    useRemoteControlStore.getState().pressAction('moveForward');
    useRemoteControlStore.getState().pressAction('turnLeft');
    expect(activeActions()).toEqual(new Set(['moveForward', 'turnLeft']));

    useRemoteControlStore.getState().releaseAction('turnLeft');
    expect(activeActions()).toEqual(new Set(['moveForward']));
  });

  it('ignores a second press of an action already held', () => {
    useRemoteControlStore.getState().pressAction('moveForward');
    const held = activeActions();

    useRemoteControlStore.getState().pressAction('moveForward');

    expect(activeActions()).toBe(held);
    expect(activeActions()).toEqual(new Set(['moveForward']));
  });

  it('ignores the release of an action that is not held', () => {
    useRemoteControlStore.getState().pressAction('moveForward');
    const held = activeActions();

    useRemoteControlStore.getState().releaseAction('turnRight');

    expect(activeActions()).toBe(held);
  });

  it('releases every action at once', () => {
    for (const action of EYE_ACTIONS) {
      useRemoteControlStore.getState().pressAction(action);
    }
    expect(activeActions().size).toBe(EYE_ACTIONS.length);

    useRemoteControlStore.getState().releaseAllActions();

    expect(activeActions().size).toBe(0);
  });

  it('leaves the state alone when releasing everything while nothing is held', () => {
    const held = activeActions();

    useRemoteControlStore.getState().releaseAllActions();

    expect(activeActions()).toBe(held);
  });

  it('never mutates the previous set', () => {
    useRemoteControlStore.getState().pressAction('moveForward');
    const afterPress = activeActions();

    useRemoteControlStore.getState().pressAction('strafeLeft');
    expect(afterPress).toEqual(new Set(['moveForward']));

    useRemoteControlStore.getState().releaseAllActions();
    expect(afterPress).toEqual(new Set(['moveForward']));
  });

  it('replaces the set on every change', () => {
    const empty = activeActions();
    useRemoteControlStore.getState().pressAction('moveForward');
    const one = activeActions();
    useRemoteControlStore.getState().pressAction('lookUp');

    expect(one).not.toBe(empty);
    expect(activeActions()).not.toBe(one);
  });
});
