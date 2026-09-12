import { beforeEach, describe, expect, it } from 'vitest';
import { ORBIT_ACTIONS } from '../domain/orbitNavigation.ts';
import type { OrbitAction } from '../domain/orbitNavigation.ts';
import { useOrbitControlStore } from './orbitControlStore.ts';

function activeActions(): ReadonlySet<OrbitAction> {
  return useOrbitControlStore.getState().activeActions;
}

describe('useOrbitControlStore', () => {
  beforeEach(() => {
    useOrbitControlStore.setState(useOrbitControlStore.getInitialState(), true);
  });

  it('holds no action at first', () => {
    expect(activeActions().size).toBe(0);
  });

  it.each(ORBIT_ACTIONS)('holds %s alone while it is pressed', (action) => {
    useOrbitControlStore.getState().pressAction(action);

    expect(activeActions()).toEqual(new Set([action]));
  });

  it.each(ORBIT_ACTIONS)('releases %s again', (action) => {
    useOrbitControlStore.getState().pressAction(action);
    useOrbitControlStore.getState().releaseAction(action);

    expect(activeActions().size).toBe(0);
  });

  it('holds orbiting and zooming at once, each independent of the other', () => {
    useOrbitControlStore.getState().pressAction('orbitLeft');
    useOrbitControlStore.getState().pressAction('zoomIn');
    expect(activeActions()).toEqual(new Set(['orbitLeft', 'zoomIn']));

    useOrbitControlStore.getState().releaseAction('zoomIn');
    expect(activeActions()).toEqual(new Set(['orbitLeft']));
  });

  it('ignores a second press of an action already held', () => {
    useOrbitControlStore.getState().pressAction('tiltUp');
    const held = activeActions();

    useOrbitControlStore.getState().pressAction('tiltUp');

    expect(activeActions()).toBe(held);
    expect(activeActions()).toEqual(new Set(['tiltUp']));
  });

  it('ignores the release of an action that is not held', () => {
    useOrbitControlStore.getState().pressAction('tiltUp');
    const held = activeActions();

    useOrbitControlStore.getState().releaseAction('tiltDown');

    expect(activeActions()).toBe(held);
  });

  it('releases every action at once', () => {
    for (const action of ORBIT_ACTIONS) {
      useOrbitControlStore.getState().pressAction(action);
    }
    expect(activeActions().size).toBe(ORBIT_ACTIONS.length);

    useOrbitControlStore.getState().releaseAllActions();

    expect(activeActions().size).toBe(0);
  });

  it('leaves the state alone when releasing everything while nothing is held', () => {
    const held = activeActions();

    useOrbitControlStore.getState().releaseAllActions();

    expect(activeActions()).toBe(held);
  });
});
