import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';

const EXPECTED_HEIGHT = 1.8;
const EXPECTED_EYE_HEIGHT = 1.68;
const ALTERED_HEIGHT = 9;

describe('person', () => {
  it('is a 1.80 m person with eyes at 1.68 m', () => {
    expect(PERSON_SPEC).toEqual({ height: EXPECTED_HEIGHT, eyeHeight: EXPECTED_EYE_HEIGHT });
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
