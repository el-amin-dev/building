import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePressedKeys } from './usePressedKeys.ts';

const FORWARD_CODE = 'KeyW';
const TURN_CODE = 'KeyJ';
const UNTRACKED_CODE = 'Tab';
const TRACKED_CODES: ReadonlySet<string> = new Set([FORWARD_CODE, TURN_CODE]);
const META_KEY_EVENT = { key: 'Meta', code: 'MetaLeft', metaKey: true } as const;

/**
 * Test predicate tracking the forward and turn keys only.
 *
 * @param code - The `KeyboardEvent.code` to check.
 * @returns `true` for tracked codes.
 */
function isTracked(code: string): boolean {
  return TRACKED_CODES.has(code);
}

describe('usePressedKeys', () => {
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

  const renderPressedKeys = () => {
    const targetRef = { current: target };
    return renderHook(() => usePressedKeys(targetRef, isTracked));
  };

  it('adds a tracked key on keydown and removes it on keyup', () => {
    const { result } = renderPressedKeys();

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    expect(result.current.current.has(FORWARD_CODE)).toBe(true);

    fireEvent.keyUp(target, { code: FORWARD_CODE });
    expect(result.current.current.size).toBe(0);
  });

  it('ignores untracked keys without preventing their default behaviour', () => {
    const { result } = renderPressedKeys();

    const notPrevented = fireEvent.keyDown(target, { code: UNTRACKED_CODE });

    expect(notPrevented).toBe(true);
    expect(result.current.current.size).toBe(0);
  });

  it('prevents the default behaviour of tracked keys', () => {
    renderPressedKeys();

    const notPrevented = fireEvent.keyDown(target, { code: FORWARD_CODE });

    expect(notPrevented).toBe(false);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])('ignores tracked keys pressed with %s', (_modifier, modifiers) => {
    const { result } = renderPressedKeys();

    const notPrevented = fireEvent.keyDown(target, { code: FORWARD_CODE, ...modifiers });

    expect(notPrevented).toBe(true);
    expect(result.current.current.size).toBe(0);
  });

  it('clears held keys when Meta goes down (macOS swallows keyups while Cmd is held)', () => {
    const { result } = renderPressedKeys();
    fireEvent.keyDown(target, { code: FORWARD_CODE });

    fireEvent.keyDown(target, META_KEY_EVENT);

    expect(result.current.current.size).toBe(0);
  });

  it('clears held keys when Meta is released', () => {
    const { result } = renderPressedKeys();
    fireEvent.keyDown(target, { code: FORWARD_CODE });

    fireEvent.keyUp(target, META_KEY_EVENT);

    expect(result.current.current.size).toBe(0);
  });

  it('does not prevent the default behaviour of the Meta key', () => {
    renderPressedKeys();

    const notPrevented = fireEvent.keyDown(target, META_KEY_EVENT);

    expect(notPrevented).toBe(true);
  });

  it('does not track a key pressed while Meta is held', () => {
    const { result } = renderPressedKeys();
    fireEvent.keyDown(target, META_KEY_EVENT);

    const notPrevented = fireEvent.keyDown(target, {
      key: 'w',
      code: FORWARD_CODE,
      metaKey: true,
    });

    expect(notPrevented).toBe(true);
    expect(result.current.current.size).toBe(0);
  });

  it('tracks several keys held at once', () => {
    const { result } = renderPressedKeys();

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: TURN_CODE });
    expect([...result.current.current]).toEqual([FORWARD_CODE, TURN_CODE]);

    fireEvent.keyUp(target, { code: FORWARD_CODE });
    expect([...result.current.current]).toEqual([TURN_CODE]);
  });

  it('clears held keys when the element loses focus', () => {
    const { result } = renderPressedKeys();
    fireEvent.keyDown(target, { code: FORWARD_CODE });

    fireEvent.blur(target);

    expect(result.current.current.size).toBe(0);
  });

  it('clears held keys when the window loses focus', () => {
    const { result } = renderPressedKeys();
    fireEvent.keyDown(target, { code: FORWARD_CODE });

    fireEvent.blur(window);

    expect(result.current.current.size).toBe(0);
  });

  it('ignores keyboard events dispatched on other elements', () => {
    const { result } = renderPressedKeys();
    const other = document.createElement('div');
    document.body.appendChild(other);

    fireEvent.keyDown(other, { code: FORWARD_CODE });
    fireEvent.keyDown(document.body, { code: TURN_CODE });

    expect(result.current.current.size).toBe(0);
    other.remove();
  });

  it('removes its listeners and clears held keys on unmount', () => {
    const { result, unmount } = renderPressedKeys();
    const pressed = result.current.current;
    fireEvent.keyDown(target, { code: FORWARD_CODE });

    unmount();
    expect(pressed.size).toBe(0);

    fireEvent.keyDown(target, { code: TURN_CODE });
    expect(pressed.size).toBe(0);
  });

  it('keeps a single entry for auto-repeated keydown events', () => {
    const { result } = renderPressedKeys();

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: FORWARD_CODE, repeat: true });
    fireEvent.keyDown(target, { code: FORWARD_CODE, repeat: true });

    expect([...result.current.current]).toEqual([FORWARD_CODE]);
  });
});
