import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN, getSpace } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { getPortSpan, PORT_SCHEDULE } from './ports/index.ts';
import { makeRect, rectContainsRect, rectDepth, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { FIXTURES } from './sourceOfTruth/plan.ts';
import { getTvPanel, TV_PANEL_SPEC } from './tvPanel.ts';

const PRECISION_DIGITS = 9;

/** The space the television hangs in (brief §4.1), restated from the plan data. */
const TV_WALL_SPACE_ID: SpaceId = 'corridor';

/** The space the screen faces across the corridor (brief §4.1). */
const LIVING_ROOM_SPACE_ID: SpaceId = 'livingRoom';

/**
 * The corridor as the plan draws it: the long hall, then the stair bay behind it.
 *
 * Read from the plan rather than written out, and both rects are named: which one
 * the panel ends up on is the whole question this file answers, so a test that
 * quietly destructured the first rect could not tell the two apart.
 */
const CORRIDOR_RECTS = getSpace(FLOOR_PLAN, TV_WALL_SPACE_ID).rects;
/**
 * The long hall, x 5.60–20.20 / z 4.00–5.50, and the stair bay behind it,
 * x 5.60–11.90 / z 5.50–6.00. The panel mounts on the BAY: it is the southernmost
 * rect that can host it, and so the one carrying the corridor's real south face.
 */
const [CORRIDOR_HALL_RECT, CORRIDOR_STAIR_BAY_RECT] = CORRIDOR_RECTS;
/** How many rects the corridor is drawn as: the hall and the stair bay. */
const CORRIDOR_RECT_COUNT = 2;

/**
 * The panel as `getTvPanel` builds it: x from the plan's `tv` fixture, z from the
 * corridor rect it hangs on.
 *
 * The z is 5.92–6.00: flush inside the corridor's south face at z 6.00, which is
 * what the module's doc comment and the plan's `tv` fixture both describe.
 *
 * It was 5.42–5.50 until `getTvPanel` was corrected, and the reason is worth
 * keeping. The module took the FIRST corridor rect that could host the panel, and
 * that is the hall (x 5.60–20.20, z 4.00–5.50): it covers the panel's x run and is
 * far deeper than 0.08, so it always won. But the stair bay (x 5.60–11.90,
 * z 5.50–6.00) sits directly behind the hall across the panel's whole width, so the
 * hall's `maxZ` is not a wall there at all — the television hung in mid corridor,
 * 0.50 short of the wall it is mounted on. The module now takes the SOUTHERNMOST
 * hosting rect, so it finds the face that is really the corridor's south side.
 */
const EXPECTED_RECT: PlanRect = { minX: 7.5, maxX: 11, minZ: 5.92, maxZ: 6 };

/**
 * The ports with no leaf between the living room and the corridor.
 *
 * Derived from the schedule instead of hand-written: the opening is the reason the
 * television is on this wall at all, and a hand-copied span would keep agreeing with
 * a panel that had drifted away from it.
 */
const LIVING_OPENING_PORTS = PORT_SCHEDULE.filter(
  (port) =>
    port.kind === 'opening' &&
    port.spaces.includes(LIVING_ROOM_SPACE_ID) &&
    port.spaces.includes(TV_WALL_SPACE_ID),
);
/** How many such ports the schedule holds: the single living-room opening. */
const LIVING_OPENING_COUNT = 1;

/** The `tv` fixtures of the plan; `tvPanel.ts` fails loudly unless there is exactly one. */
const TV_FIXTURES = FIXTURES.filter((fixture) => fixture.kind === 'tv');
/** How many televisions the plan carries. */
const TV_FIXTURE_COUNT = 1;

/** How much of the opening the panel covers, in metres: all 3.50 m of it. */
const EXPECTED_OPENING_OVERLAP = 3.5;
/** An overlap of nothing: the panel would be facing a blank wall. */
const NO_OVERLAP = 0;

/**
 * Distance the STAIR BAY is moved south to prove the panel follows its wall, in metres.
 *
 * The bay, not the hall. Moving the hall proves nothing now: `getTvPanel` takes the
 * southernmost hosting rect, and a hall shifted 0.40 south still ends at z 5.90,
 * short of the bay's 6.00, so the bay goes on winning and the panel does not move
 * at all. The rect that has to move is the one that actually hosts the panel.
 *
 * The value has to be one where three different implementations give three
 * different answers, or the test proves nothing. Measured on the moved plan:
 *
 * - southernmost hosting rect (the rule): the bay's face moves to 6.40, panel
 *   6.32–6.40;
 * - the `tv` fixture's own z, ignoring the corridor: 5.92–6.00 — which is also the
 *   UNSHIFTED answer, so 0 is the one value this constant may never take;
 * - the FIRST rect that fits, the old defect: the hall's face, 5.42–5.50.
 *
 * 0.40 separates all three. It also keeps the moved bay a legal host: it still
 * spans the panel's x run and is still 0.50 deep.
 */
const BAY_SHIFT_Z = 0.4;

/**
 * Distance the stair bay is moved NORTH, in metres, to put its face in front of
 * the hall's instead of behind it.
 *
 * −0.60 takes the bay to z 4.90–5.40, so the hall's 5.50 becomes the southernmost
 * face of the corridor and the panel must move onto the HALL. That is what makes
 * the rule "the greatest `maxZ`" rather than "the second rect" or "the bay": a
 * module that had simply swapped one hard-coded rect for another passes every
 * other case in this file and fails this one.
 *
 * The moved bay stays a legal host — same x run, same 0.50 depth — so it is
 * rejected for its position alone and not for being unable to carry the panel.
 */
const BAY_RETREAT_Z = -0.6;

/** How far short of the panel's east end the short corridor stops, in metres. */
const MISSING_WIDTH = 0.1;

/**
 * A corridor that stops west of the panel's east end, so the panel cannot fit.
 *
 * Derived from the real hall so that it is a corridor in every other respect: it is
 * still 1.50 m deep, so it can only be rejected for its length.
 */
const SHORT_CORRIDOR_RECT: PlanRect = makeRect(
  CORRIDOR_HALL_RECT.minX,
  toPlanLength(TV_PANEL_SPEC.maxX - MISSING_WIDTH),
  CORRIDOR_HALL_RECT.minZ,
  CORRIDOR_HALL_RECT.maxZ,
);

/** Depth of the shallow corridor, in metres: half of what the panel needs. */
const TOO_SHALLOW_DEPTH = 0.04;

/**
 * A corridor shallower than the panel is thick, so the panel cannot fit either.
 *
 * It spans the panel's full x run on purpose: it can only be rejected for its depth.
 */
const SHALLOW_CORRIDOR_RECT: PlanRect = makeRect(
  CORRIDOR_HALL_RECT.minX,
  CORRIDOR_HALL_RECT.maxX,
  toPlanLength(CORRIDOR_HALL_RECT.maxZ - TOO_SHALLOW_DEPTH),
  CORRIDOR_HALL_RECT.maxZ,
);

/** Vertical sizes that share no value with `FLOOR_HEIGHTS`. */
const SYNTHETIC_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 2.55,
  wall: 2.22,
  door: 1.88,
  railing: 0.61,
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
  return withCorridorRects(plan, [rect]);
}

/**
 * Builds a copy of the plan whose corridor is the given rects.
 *
 * The plural form is what the placement tests need: a corridor cut down to ONE
 * rect cannot tell "the southernmost rect that can host the panel" from "the only
 * rect there is", so the rect being moved is handed in beside the one it has to
 * beat.
 *
 * @param plan - The plan to copy; it is not modified.
 * @param rects - The rects the corridor becomes, in the order given.
 * @returns A new plan with the replaced corridor.
 */
function withCorridorRects(plan: FloorPlan, rects: readonly PlanRect[]): FloorPlan {
  return {
    ...plan,
    spaces: plan.spaces.map((space) =>
      space.id === TV_WALL_SPACE_ID ? { ...space, rects } : space,
    ),
  };
}

/**
 * Moves the stair bay along z, leaving it a legal host for the panel.
 *
 * @param shift - Distance along z, in metres; positive is south.
 * @returns The moved bay.
 */
function bayMovedBy(shift: number): PlanRect {
  return makeRect(
    CORRIDOR_STAIR_BAY_RECT.minX,
    CORRIDOR_STAIR_BAY_RECT.maxX,
    toPlanLength(CORRIDOR_STAIR_BAY_RECT.minZ + shift),
    toPlanLength(CORRIDOR_STAIR_BAY_RECT.maxZ + shift),
  );
}

const PANEL = getTvPanel(FLOOR_PLAN);

describe('tvPanel', () => {
  describe('TV_PANEL_SPEC', () => {
    it('is the frozen plan extent of the `tv` fixture', () => {
      expect(TV_PANEL_SPEC).toEqual({ minX: 7.5, maxX: 11, thickness: 0.08 });
      expect(Object.isFrozen(TV_PANEL_SPEC)).toBe(true);
    });
  });

  describe('getTvPanel on the typical floor', () => {
    it('returns the panel the plan and the corridor derive', () => {
      expect(PANEL.rect).toEqual(EXPECTED_RECT);
    });

    it('runs from the railing height to the door height (owner answer 2026-09-11)', () => {
      expect(PANEL.bottom).toBe(FLOOR_HEIGHTS.railing);
      expect(PANEL.top).toBe(FLOOR_HEIGHTS.door);
    });

    it('mounts the panel on the southernmost corridor rect that can host it', () => {
      expect(CORRIDOR_RECTS).toHaveLength(CORRIDOR_RECT_COUNT);
      expect(rectContainsRect(CORRIDOR_STAIR_BAY_RECT, PANEL.rect)).toBe(true);
      expect(PANEL.rect.maxZ).toBe(CORRIDOR_STAIR_BAY_RECT.maxZ);
      expect(PANEL.rect.maxZ).toBe(Math.max(...CORRIDOR_RECTS.map((rect) => rect.maxZ)));
      // Named the other way round as well, because the hall is the rect the old
      // module chose: the panel is NOT on it and is not even inside it.
      expect(rectContainsRect(CORRIDOR_HALL_RECT, PANEL.rect)).toBe(false);
      expect(PANEL.rect.maxZ).not.toBe(CORRIDOR_HALL_RECT.maxZ);
      expect(PANEL.rect.maxZ - PANEL.rect.minZ).toBeCloseTo(
        TV_PANEL_SPEC.thickness,
        PRECISION_DIGITS,
      );
    });

    it('skips the hall, whose face the stair bay sits behind across the whole panel', () => {
      // Why the southernmost rect is the right one rather than merely the one the
      // module happens to take. The hall CAN host the panel — it covers the x run
      // and is far deeper than 0.08 — so it is not rejected for fitting badly; it
      // is rejected because its `maxZ` is not a wall. The stair bay starts exactly
      // where the hall ends and covers the panel's full width, so a panel on the
      // hall's face would hang in open corridor, 0.50 m short of the south wall
      // the brief mounts it on.
      const hallCanHost =
        CORRIDOR_HALL_RECT.minX <= TV_PANEL_SPEC.minX &&
        CORRIDOR_HALL_RECT.maxX >= TV_PANEL_SPEC.maxX &&
        rectDepth(CORRIDOR_HALL_RECT) >= TV_PANEL_SPEC.thickness;

      expect(hallCanHost).toBe(true);
      expect(CORRIDOR_STAIR_BAY_RECT.minZ).toBe(CORRIDOR_HALL_RECT.maxZ);
      expect(CORRIDOR_STAIR_BAY_RECT.minX).toBeLessThanOrEqual(TV_PANEL_SPEC.minX);
      expect(CORRIDOR_STAIR_BAY_RECT.maxX).toBeGreaterThanOrEqual(TV_PANEL_SPEC.maxX);
      // So the hall's face has corridor behind it and the bay's has the wall.
      expect(CORRIDOR_STAIR_BAY_RECT.maxZ).toBeGreaterThan(CORRIDOR_HALL_RECT.maxZ);
      expect(PANEL.rect.maxZ).toBe(CORRIDOR_STAIR_BAY_RECT.maxZ);
    });

    it('takes its width from the `tv` fixture and its depth from the fixture thickness', () => {
      expect(TV_FIXTURES).toHaveLength(TV_FIXTURE_COUNT);
      const [fixtureMinX, fixtureMaxX, fixtureMinZ, fixtureMaxZ] = TV_FIXTURES[0].rect;

      expect(PANEL.rect.minX).toBe(fixtureMinX);
      expect(PANEL.rect.maxX).toBe(fixtureMaxX);
      expect(fixtureMaxZ - fixtureMinZ).toBeCloseTo(TV_PANEL_SPEC.thickness, PRECISION_DIGITS);
    });

    it('faces the living-room opening, covering all of it', () => {
      expect(LIVING_OPENING_PORTS).toHaveLength(LIVING_OPENING_COUNT);
      const [openingMin, openingMax] = getPortSpan(LIVING_OPENING_PORTS[0]);
      const overlap = Math.min(PANEL.rect.maxX, openingMax) - Math.max(PANEL.rect.minX, openingMin);

      expect(overlap).toBeCloseTo(EXPECTED_OPENING_OVERLAP, PRECISION_DIGITS);
      expect(overlap).toBeCloseTo(openingMax - openingMin, PRECISION_DIGITS);
      expect(overlap).toBeGreaterThan(NO_OVERLAP);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(PANEL)).toBe(true);
      expect(Object.isFrozen(PANEL.rect)).toBe(true);
    });
  });

  describe('derived placement', () => {
    it('follows the corridor when the wall it hangs on moves', () => {
      // The wall it hangs on is the stair bay's south face, so the bay is what
      // moves. The hall is left in the plan and still fits the panel, so the panel
      // has something to be wrong about.
      const movedBay = bayMovedBy(BAY_SHIFT_Z);
      const [, , fixtureMinZ, fixtureMaxZ] = TV_FIXTURES[0].rect;

      const panel = getTvPanel(withCorridorRects(FLOOR_PLAN, [CORRIDOR_HALL_RECT, movedBay]));

      expect(panel.rect.maxZ).toBe(movedBay.maxZ);
      expect(panel.rect.minZ).toBe(toPlanLength(EXPECTED_RECT.minZ + BAY_SHIFT_Z));
      // The point of the whole module: an implementation reading the fixture's own z
      // would have ignored the move and returned the fixture's 5.92–6.00 unchanged.
      expect(panel.rect.maxZ).not.toBe(fixtureMaxZ);
      expect(panel.rect.minZ).not.toBe(fixtureMinZ);
      // ...and one taking the first rect that fits would have answered the hall's
      // face, which did not move either.
      expect(panel.rect.maxZ).not.toBe(CORRIDOR_HALL_RECT.maxZ);
      // ...while the width still comes from the fixture, which did not move.
      expect(panel.rect.minX).toBe(TV_PANEL_SPEC.minX);
      expect(panel.rect.maxX).toBe(TV_PANEL_SPEC.maxX);
    });

    it('goes back to the hall when the bay is moved north of it', () => {
      // The other direction, which is what makes the rule "the greatest maxZ"
      // rather than "the bay": with the bay pulled north the hall carries the
      // southernmost face, so the panel must hang on the hall — even though the
      // bay is still perfectly able to host it.
      const movedBay = bayMovedBy(BAY_RETREAT_Z);

      const panel = getTvPanel(withCorridorRects(FLOOR_PLAN, [CORRIDOR_HALL_RECT, movedBay]));

      expect(movedBay.maxZ).toBeLessThan(CORRIDOR_HALL_RECT.maxZ);
      expect(rectDepth(movedBay)).toBeGreaterThan(TV_PANEL_SPEC.thickness);
      expect(panel.rect.maxZ).toBe(CORRIDOR_HALL_RECT.maxZ);
      expect(panel.rect.minZ).toBe(toPlanLength(CORRIDOR_HALL_RECT.maxZ - TV_PANEL_SPEC.thickness));
      expect(panel.rect.maxZ).not.toBe(movedBay.maxZ);
      expect(panel.rect.maxZ).not.toBe(EXPECTED_RECT.maxZ);
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

    it('injects heights that share no value with the floor’s own', () => {
      const values = [...Object.values(SYNTHETIC_HEIGHTS), ...Object.values(FLOOR_HEIGHTS)];

      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe('rejections', () => {
    it('builds each rejected corridor so it can only fail for its own reason', () => {
      expect(rectDepth(SHORT_CORRIDOR_RECT)).toBeGreaterThan(TV_PANEL_SPEC.thickness);
      expect(SHORT_CORRIDOR_RECT.maxX).toBeLessThan(TV_PANEL_SPEC.maxX);
      expect(rectDepth(SHALLOW_CORRIDOR_RECT)).toBeLessThan(TV_PANEL_SPEC.thickness);
      expect(SHALLOW_CORRIDOR_RECT.minX).toBeLessThanOrEqual(TV_PANEL_SPEC.minX);
      expect(SHALLOW_CORRIDOR_RECT.maxX).toBeGreaterThanOrEqual(TV_PANEL_SPEC.maxX);
    });

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
