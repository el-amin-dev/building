import { describe, expect, it } from 'vitest';
import { ROOMS } from '../sourceOfTruth/plan.ts';
import { SPACE_IDS, SPACE_KINDS } from './types.ts';

/**
 * How many spaces the floor has, read off the source of truth rather than typed
 * in again.
 *
 * `SPACE_IDS` is `ROOMS` of `sourceOfTruth/plan.ts` in matricule order (see
 * `types.ts`), so the count this list must have is however many rooms the owner
 * drew — it was 18 while the plan had a link corridor and carried the baths and
 * showers as fittings, and the number is not this test's to decide.
 */
const SPACE_ID_COUNT = ROOMS.length;
const SPACE_KIND_COUNT = 4;
const EXTRA_ENTRY = 'extra';

describe('floorPlan types', () => {
  it('lists the ids of the source of truth, in matricule order', () => {
    expect([...SPACE_IDS]).toEqual(ROOMS.map((room) => room.id));
  });

  describe.each([
    ['SPACE_IDS', SPACE_IDS, SPACE_ID_COUNT],
    ['SPACE_KINDS', SPACE_KINDS, SPACE_KIND_COUNT],
  ] as const)('%s', (_name, list, expectedCount) => {
    it(`lists ${String(expectedCount)} unique entries`, () => {
      expect(list).toHaveLength(expectedCount);
      expect(new Set(list).size).toBe(expectedCount);
    });

    it('is frozen', () => {
      const mutable = list as unknown as string[];

      expect(Object.isFrozen(list)).toBe(true);
      expect(() => mutable.push(EXTRA_ENTRY)).toThrow(TypeError);
      expect(list).toHaveLength(expectedCount);
    });
  });
});
