import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';

const EXPECTED_HEIGHT = 1.8;
const EXPECTED_EYE_HEIGHT = 1.68;
const EXPECTED_RADIUS = 0.25;
const ALTERED_HEIGHT = 9;

/** Shoulder width of the body: the diameter of the circle collision keeps clear. */
const EXPECTED_BODY_WIDTH = 0.5;

/** The narrowest port of the floor, in metres: the two guest cubicle doors. */
const NARROWEST_PORT_WIDTH = 0.6;

describe('person', () => {
  it('is a 1.80 m person with eyes at 1.68 m and a 0.25 m body radius', () => {
    expect(PERSON_SPEC).toEqual({
      height: EXPECTED_HEIGHT,
      eyeHeight: EXPECTED_EYE_HEIGHT,
      radius: EXPECTED_RADIUS,
    });
  });

  it('is half a metre across the shoulders', () => {
    expect(PERSON_SPEC.radius * 2).toBe(EXPECTED_BODY_WIDTH);
  });

  it('is taller than it is wide', () => {
    expect(PERSON_SPEC.radius * 2).toBeLessThan(PERSON_SPEC.height);
  });

  it('fits through the narrowest port of the floor', () => {
    expect(PERSON_SPEC.radius * 2).toBeLessThan(NARROWEST_PORT_WIDTH);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PERSON_SPEC)).toBe(true);
  });

  it('rejects assignment and keeps its value', () => {
    const mutable = PERSON_SPEC as { height: number };

    expect(() => {
      mutable.height = ALTERED_HEIGHT;
    }).toThrow(TypeError);
    expect(PERSON_SPEC.height).toBe(EXPECTED_HEIGHT);
  });

  it('keeps the eyes below the top of the head', () => {
    expect(PERSON_SPEC.eyeHeight).toBeLessThan(PERSON_SPEC.height);
  });

  it('fits under a door', () => {
    expect(PERSON_SPEC.height).toBeLessThan(FLOOR_HEIGHTS.door);
  });
});
