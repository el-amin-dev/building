import { describe, expect, it } from 'vitest';
import { SPACE_IDS, SPACE_KINDS } from './types.ts';

const SPACE_ID_COUNT = 18;
const SPACE_KIND_COUNT = 4;
const EXTRA_ENTRY = 'extra';

describe('floorPlan types', () => {
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
