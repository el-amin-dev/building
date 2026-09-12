import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, getSpace } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeRect, rectContainsRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { getTvPanel, TV_PANEL_SPEC } from './tvPanel.ts';

const PRECISION_DIGITS = 9;

/** The space the television hangs in (brief §4.1), restated from the plan data. */
const TV_WALL_SPACE_ID: SpaceId = 'corridor';

/**
 * The living-room opening onto the corridor: x 7.50–11.00, the 3.50 m wall
 * interruption of brief §4.1 (ADR-006), hand-written from the port schedule.
 *
 * The television has to face this opening, otherwise the living room looks at a
 * blank corridor wall instead of the screen.
 */
const LIVING_OPENING_SPAN = Object.freeze({ min: 7.5, max: 11 });

/** The panel as drawn on Page-2: z 5.32–5.40 on the corridor's south wall face. */
const EXPECTED_RECT: PlanRect = { minX: 7.55, maxX: 11.05, minZ: 5.32, maxZ: 5.4 };

/** How much of the opening the panel covers, in metres: 11.00 − 7.55. */
const EXPECTED_OPENING_OVERLAP = 3.45;

/** Distance the corridor is moved along z to prove the panel follows it, in metres. */
const CORRIDOR_SHIFT_Z = 0.5;

/** A corridor that stops west of the panel's east end, so the panel cannot fit. */
const SHORT_CORRIDOR_RECT: PlanRect = makeRect(5.3, 8, 3.9, 5.4);

/** A corridor shallower than the panel is thick, so the panel cannot fit either. */
const SHALLOW_CORRIDOR_RECT: PlanRect = makeRect(5.3, 20.2, 5.39, 5.4);

/** Vertical sizes that share no value with `FLOOR_HEIGHTS`. */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 2.55,
  wall: 2.22,
  door: 1.88,
  railing: 0.61,
  windowSill: 0.42,
  windowHead: 1.73,
});

/** Heights whose railing is above the door, which leaves the panel no height. */
const INVERTED_HEIGHTS: FloorHeights = Object.freeze({
  ...FLOOR_HEIGHTS,
  railing: FLOOR_HEIGHTS.door,
  door: FLOOR_HEIGHTS.railing,
});

/**
 * Builds a copy of the plan whose corridor is one given rect.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param rect - The rect the corridor becomes.
 * @returns A new plan with the replaced corridor.
 */
function withCorridorRect(plan: FloorPlan, rect: PlanRect): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) =>
      space.id === TV_WALL_SPACE_ID ? { ...space, rects: [rect] } : space,
    ),
  };
}

const [CORRIDOR_RECT] = getSpace(FLOOR_PLAN, TV_WALL_SPACE_ID).rects;
const PANEL = getTvPanel(FLOOR_PLAN);

describe('tvPanel', () => {
  describe('TV_PANEL_SPEC', () => {
    it('is the frozen plan extent drawn on Page-2', () => {
      expect(TV_PANEL_SPEC).toEqual({ minX: 7.55, maxX: 11.05, thickness: 0.08 });
      expect(Object.isFrozen(TV_PANEL_SPEC)).toBe(true);
    });
  });

  describe('getTvPanel on the typical floor', () => {
    it('returns the panel drawn on Page-2', () => {
      expect(PANEL.rect).toEqual(EXPECTED_RECT);
    });

    it('runs from the railing height to the door height (owner answer 2026-09-11)', () => {
      expect(PANEL.bottom).toBe(FLOOR_HEIGHTS.railing);
      expect(PANEL.top).toBe(FLOOR_HEIGHTS.door);
    });

    it('hangs inside the corridor, flush with its south wall', () => {
      expect(rectContainsRect(CORRIDOR_RECT, PANEL.rect)).toBe(true);
      expect(PANEL.rect.maxZ).toBe(CORRIDOR_RECT.maxZ);
      expect(PANEL.rect.maxZ - PANEL.rect.minZ).toBeCloseTo(
        TV_PANEL_SPEC.thickness,
        PRECISION_DIGITS,
      );
    });

    it('faces the living-room opening', () => {
      const overlap =
        Math.min(PANEL.rect.maxX, LIVING_OPENING_SPAN.max) -
        Math.max(PANEL.rect.minX, LIVING_OPENING_SPAN.min);

      expect(overlap).toBeCloseTo(EXPECTED_OPENING_OVERLAP, PRECISION_DIGITS);
      expect(overlap).toBeGreaterThan(0);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(PANEL)).toBe(true);
      expect(Object.isFrozen(PANEL.rect)).toBe(true);
    });
  });

  describe('derived placement', () => {
    it('follows the corridor when its south wall moves', () => {
      const moved = makeRect(
        CORRIDOR_RECT.minX,
        CORRIDOR_RECT.maxX,
        CORRIDOR_RECT.minZ + CORRIDOR_SHIFT_Z,
        CORRIDOR_RECT.maxZ + CORRIDOR_SHIFT_Z,
      );
      const panel = getTvPanel(withCorridorRect(FLOOR_PLAN, moved));

      expect(panel.rect.maxZ).toBe(moved.maxZ);
      expect(panel.rect.minZ).toBe(EXPECTED_RECT.minZ + CORRIDOR_SHIFT_Z);
      expect(panel.rect.minX).toBe(TV_PANEL_SPEC.minX);
    });
  });

  describe('injected heights', () => {
    it('takes its two levels from the heights it is given', () => {
      const panel = getTvPanel(FLOOR_PLAN, SYNTHETIC_HEIGHTS);

      expect(panel.bottom).toBe(SYNTHETIC_HEIGHTS.railing);
      expect(panel.top).toBe(SYNTHETIC_HEIGHTS.door);
      expect(panel.bottom).not.toBe(FLOOR_HEIGHTS.railing);
      expect(panel.top).not.toBe(FLOOR_HEIGHTS.door);
      expect(panel.rect).toEqual(PANEL.rect);
    });
  });

  describe('rejections', () => {
    it.each([
      ['the corridor is too short for the panel', SHORT_CORRIDOR_RECT],
      ['the corridor is shallower than the panel', SHALLOW_CORRIDOR_RECT],
    ] as const)('rejects a plan where %s', (_label, rect) => {
      const call = (): unknown => getTvPanel(withCorridorRect(FLOOR_PLAN, rect));

      expect(call).toThrow(RangeError);
      expect(call).toThrow('does not fit');
    });

    it('rejects heights that leave the panel no height', () => {
      const call = (): unknown => getTvPanel(FLOOR_PLAN, INVERTED_HEIGHTS);

      expect(call).toThrow(RangeError);
      expect(call).toThrow('must lie above');
    });
  });
});
