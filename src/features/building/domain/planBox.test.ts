import { describe, expect, it } from 'vitest';
import { boxVolume, makeBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect } from './planGeometry.ts';

const PRECISION_DIGITS = 9;

const RECT_MIN_X = 1.6;
const RECT_MAX_X = 3.6;
const RECT_MIN_Z = 0.3;
const RECT_MAX_Z = 3.3;
const RECT_WIDTH = 2.0;
const RECT_DEPTH = 3.0;

const SLAB_BOTTOM = -0.3;
const WALL_TOP = 2.7;
const BOX_HEIGHT = 3.0;
const BOX_VOLUME = 18.0;

const FLOOR_LEVEL = 0;
const HALF_TOLERANCE = LENGTH_TOLERANCE / 2;
const DOUBLE_TOLERANCE = LENGTH_TOLERANCE * 2;

/** Floor-to-floor height of 3.00 m climbed in 17 equal steps: an off-grid riser. */
const STAIR_RISER_COUNT = 17;
const STAIR_RISER = BOX_HEIGHT / STAIR_RISER_COUNT;

const RECT = makeRect(RECT_MIN_X, RECT_MAX_X, RECT_MIN_Z, RECT_MAX_Z);
const ZERO_AREA_RECT = makeRect(RECT_MIN_X, RECT_MIN_X, RECT_MIN_Z, RECT_MAX_Z);
const ALTERED_TOP = 9;

describe('makeBox', () => {
  it('stores the footprint and the two levels as given', () => {
    const box = makeBox(RECT, SLAB_BOTTOM, WALL_TOP);

    expect(box).toEqual({ rect: RECT, bottom: SLAB_BOTTOM, top: WALL_TOP });
  });

  it('returns a frozen box whose footprint is frozen', () => {
    const box = makeBox(RECT, FLOOR_LEVEL, WALL_TOP);

    expect(Object.isFrozen(box)).toBe(true);
    expect(Object.isFrozen(box.rect)).toBe(true);
  });

  it('rejects assignment and keeps its value', () => {
    const box = makeBox(RECT, FLOOR_LEVEL, WALL_TOP);
    const mutable = box as { top: number };

    expect(() => {
      mutable.top = ALTERED_TOP;
    }).toThrow(TypeError);
    expect(box.top).toBe(WALL_TOP);
  });

  it('allows a bottom below the finished floor', () => {
    expect(makeBox(RECT, SLAB_BOTTOM, FLOOR_LEVEL).bottom).toBe(SLAB_BOTTOM);
  });

  it('keeps an off-grid vertical level unrounded, such as a stair riser', () => {
    const box = makeBox(RECT, FLOOR_LEVEL, STAIR_RISER);

    expect(box.top).toBe(STAIR_RISER);
    expect(box.top * STAIR_RISER_COUNT).toBeCloseTo(BOX_HEIGHT, PRECISION_DIGITS);
  });

  it('accepts a height just above the tolerance', () => {
    expect(makeBox(RECT, FLOOR_LEVEL, DOUBLE_TOLERANCE).top).toBe(DOUBLE_TOLERANCE);
  });

  it.each([
    ['the height is zero', FLOOR_LEVEL, FLOOR_LEVEL, String(FLOOR_LEVEL)],
    ['the height is negative', WALL_TOP, FLOOR_LEVEL, String(WALL_TOP)],
    ['the height is within the tolerance', FLOOR_LEVEL, HALF_TOLERANCE, String(HALF_TOLERANCE)],
    ['the bottom is NaN', Number.NaN, WALL_TOP, 'NaN'],
    ['the top is NaN', FLOOR_LEVEL, Number.NaN, 'NaN'],
    ['the bottom is infinite', Number.NEGATIVE_INFINITY, WALL_TOP, '-Infinity'],
    ['the top is infinite', FLOOR_LEVEL, Number.POSITIVE_INFINITY, 'Infinity'],
  ])('rejects a box where %s', (_label, bottom, top, named) => {
    expect(() => makeBox(RECT, bottom, top)).toThrow(RangeError);
    expect(() => makeBox(RECT, bottom, top)).toThrow(named);
  });
});

describe('boxVolume', () => {
  it('multiplies the footprint area by the height', () => {
    const box = makeBox(RECT, SLAB_BOTTOM, WALL_TOP);

    expect(boxVolume(box)).toBeCloseTo(BOX_VOLUME, PRECISION_DIGITS);
    expect(boxVolume(box)).toBeCloseTo(RECT_WIDTH * RECT_DEPTH * BOX_HEIGHT, PRECISION_DIGITS);
  });

  it('is zero for a zero-area footprint', () => {
    expect(boxVolume(makeBox(ZERO_AREA_RECT, FLOOR_LEVEL, WALL_TOP))).toBe(0);
  });
});
