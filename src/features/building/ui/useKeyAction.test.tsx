import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyAction } from './useKeyAction.ts';

const ACTION_CODE = 'KeyV';
const OTHER_CODE = 'KeyW';
const KEY_DOWN_EVENT = 'keydown';
const ONE_CALL = 1;

describe('useKeyAction', () => {
  let target: HTMLDivElement;

  beforeEach(() => {
    target = document.createElement('div');
    target.tabIndex = 0;
    document.body.appendChild(target);
    target.focus();
  });

  afterEach(() => {
    target.remove();
  });

  const renderKeyAction = (onPress: () => void) => {
    const targetRef = { current: target };
    return renderHook(({ action }) => useKeyAction(targetRef, ACTION_CODE, action), {
      initialProps: { action: onPress },
    });
  };

  it('runs the action once per press of the key on the focused target and prevents its default', () => {
    const onPress = vi.fn();
    renderKeyAction(onPress);

    const notPrevented = fireEvent.keyDown(target, { code: ACTION_CODE });

    expect(onPress).toHaveBeenCalledTimes(ONE_CALL);
    expect(notPrevented).toBe(false);
  });

  it('ignores other keys without preventing their default behaviour', () => {
    const onPress = vi.fn();
    renderKeyAction(onPress);

    const notPrevented = fireEvent.keyDown(target, { code: OTHER_CODE });

    expect(onPress).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])('ignores the key pressed with %s', (_modifier, modifiers) => {
    const onPress = vi.fn();
    renderKeyAction(onPress);

    const notPrevented = fireEvent.keyDown(target, { code: ACTION_CODE, ...modifiers });

    expect(onPress).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it('ignores auto-repeated keydown events of a held key', () => {
    const onPress = vi.fn();
    renderKeyAction(onPress);

    fireEvent.keyDown(target, { code: ACTION_CODE });
    fireEvent.keyDown(target, { code: ACTION_CODE, repeat: true });
    fireEvent.keyDown(target, { code: ACTION_CODE, repeat: true });

    expect(onPress).toHaveBeenCalledTimes(ONE_CALL);
  });

  it('ignores the key pressed on other elements', () => {
    const onPress = vi.fn();
    renderKeyAction(onPress);
    const other = document.createElement('div');
    other.tabIndex = 0;
    document.body.appendChild(other);
    other.focus();

    fireEvent.keyDown(other, { code: ACTION_CODE });
    fireEvent.keyDown(document.body, { code: ACTION_CODE });

    expect(onPress).not.toHaveBeenCalled();
    other.remove();
  });

  it('removes its listener on unmount', () => {
    const onPress = vi.fn();
    const { unmount } = renderKeyAction(onPress);

    unmount();
    fireEvent.keyDown(target, { code: ACTION_CODE });

    expect(onPress).not.toHaveBeenCalled();
  });

  it('calls the latest action without re-attaching the listener', () => {
    const addListener = vi.spyOn(target, 'addEventListener');
    const firstAction = vi.fn();
    const latestAction = vi.fn();
    const { rerender } = renderKeyAction(firstAction);

    rerender({ action: latestAction });
    fireEvent.keyDown(target, { code: ACTION_CODE });

    expect(firstAction).not.toHaveBeenCalled();
    expect(latestAction).toHaveBeenCalledTimes(ONE_CALL);
    const keyDownListeners = addListener.mock.calls.filter(([type]) => type === KEY_DOWN_EVENT);
    expect(keyDownListeners).toHaveLength(ONE_CALL);
  });
});
