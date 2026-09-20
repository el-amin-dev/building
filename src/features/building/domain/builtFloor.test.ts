/**
 * What this file used to assert, and why the figures moved.
 *
 * The floor was rebuilt from the single source of truth
 * (`sourceOfTruth/plan.ts`): 18 spaces became 21 — each bathroom grew a walled
 * bath, and the main one a walled shower as well, each with its own door — and
 * `linkCorridor` was deleted. This file pinned 24 openings; the rebuilt plan
 * declares 19 ports and 8 windows, so 27 holes are punched. Three totals it
 * pinned came from the superseded plan and are re-measured here:
 *
 * - `WALL_FOOTPRINT_AREA` was 42.52 m² and is 43.720 m²;
 * - `FLOOR_AREA_TOTAL` was 167.38 m² and is 165.920 m²: the source of truth's
 *   FLOOR total of 163.920 m², which excludes the stair bay, plus the 2.00 m²
 *   arrival landing, the only part of the bay that is floor at this storey;
 * - the "15.10 m² void" was the old side-B strip. The plan's two `'void'`
 *   spaces measure 9.36 m², and the bay adds a second unpaved area: 6.00 m² of
 *   open shaft, which the old plan did not have.
 *
 * The guest suite accounts for the last move of all three. It was drawn for a
 * while with a shower cubicle of its own, which made 22 spaces, 20 ports and 9
 * windows; the owner dropped it, restoring brief §7.3's own table — guest
 * sanitair: sink and bath, no shower — and the sanitair and its bath cubicle
 * slid east onto the floor it held while the guest room grew into the west end
 * they left. That is one room, one port and one `air` window fewer, and it is
 * where the 0.405 m² that left the walls and arrived in the floor comes from.
 *
 * The plot closure is therefore in four parts rather than three —
 * FLOOR + VOID + WALLS + SHAFT = 225.00 m² — and it is asserted from the parts
 * the modules produce, so it holds whatever the wall rule does next.
 *
 * Behaviour changed in two places, and the old assertions were not merely
 * mis-numbered but wrong:
 *
 * - windows no longer take their sill and head from `FloorHeights`. Each one
 *   declares its own in the schedule, because they differ by purpose: an `air`
 *   window vents a wet cubicle at 1.90–2.30, a `pass` window hands coffee at
 *   1.00–1.80, a `light` window sits at 0.90–2.10. So the old "the windows get
 *   `heights.windowSill` and `heights.windowHead`" is replaced by "each window
 *   gets the sill and head the schedule declares", and the injected-heights
 *   guard no longer forbids 0.90 and 2.10: those levels now come from the plan
 *   and must survive a change of heights. A new case pins that directly;
 * - `heights.wall` is not the top of every wall any more. The spec names the
 *   side-A balustrade in `PARAPET_WALLS` and states 1.10 m for it (1.00 m until
 *   ADR-011, where the owner chose 1.10 and the entry was rewritten to carry
 *   `HEIGHTS.railing` itself rather than a second literal), so one block is a
 *   parapet whose top no injected height moves. That is also why the wall
 *   BLOCK COUNT is not height-independent: it is 238 at production heights and
 *   236 at the injected ones, because a parapet that stays put merges with its
 *   neighbours differently. The old `keeps the plan figures` case asserted the
 *   count was unchanged; it now asserts what really cannot change — the
 *   footprint area, the floor area and the opening counts — and pins the count
 *   difference as the fact it is.
 *
 * Two assertions were strengthened because they could no longer fail:
 *
 * - `stands each railing on the balcony slab it guards` asserted every railing
 *   stood on `balconySlabB`. The rebuilt plan has three railings, one of them on
 *   the control-centre balcony, so the case is now "each railing stands on the
 *   slab of the floored space it guards", read off the railing's own pair;
 * - the port hole table built its cases from a slice shorter than the schedule,
 *   so the last port's opening was `undefined` and the case threw inside a
 *   helper instead of checking anything. The count is pinned against
 *   `PORT_SCHEDULE.length` before the table is built.
 */

import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from './builtFloor.ts';
import { FLOOR_PLAN, PLOT_RECT, getSpace, getSpaceArea } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import type { PlanBox } from './planBox.ts';
import {
  LENGTH_TOLERANCE,
  rectArea,
  rectContainsPoint,
  rectsOverlap,
  toPlanLength,
} from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { PORT_SCHEDULE, getPortOpening } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { getServiceRuns } from './services.ts';
import { PARAPET_WALLS, SERVICE_RUNS, WINDOWS } from './sourceOfTruth/plan.ts';
import { STAIRS_SPEC } from './stairs.ts';
import { getWallFootprintArea, getWallPieces } from './walls.ts';
import type { FloorWindow } from './windows.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const NONE = 0;
const ONE = 1;
const TWO = 2;

/** Level of the finished floor: the datum every vertical size is measured from. */
const FLOOR_LEVEL = 0;

/**
 * Underside of the slab, where every wall starts: −0.30 m (3.00 − 2.70), snapped
 * to the plan grid exactly as `slabs.ts` snaps it, so that the walls and the
 * slabs are compared against the one level both of them are built from.
 */
const SLAB_BOTTOM = -toPlanLength(FLOOR_HEIGHTS.floorToFloor - FLOOR_HEIGHTS.wall);

/* ------------------------------------------------------------------ *
 * Composed counts of the typical floor.
 * ------------------------------------------------------------------ */

/** Ports of the declared schedule: one per door of the source of truth. */
const PORT_COUNT = 19;
/** Windows of the declared schedule: the owner's air, pass and light openings. */
const WINDOW_COUNT = 8;
/** Holes fed to the wall generator: every port opening, then every window opening. */
const OPENING_COUNT = PORT_COUNT + WINDOW_COUNT;
/**
 * Wall blocks left once the 27 openings are punched out.
 *
 * PROVISIONAL: a defect in the isolation rule of `walls.ts` is under
 * investigation, and a change to which stretches are built heavy changes how the
 * cells merge. The footprint area below moves with it. The plot closure
 * (FLOOR + VOID + WALLS + SHAFT = 225.00 m²) does not, which is why it is
 * asserted from the parts rather than from these literals.
 */
const WALL_PIECE_COUNT = 238;
/** Blocks that start at the underside of the slab. PROVISIONAL, see above. */
const BASE_PIECE_COUNT = 204;
/** Blocks that start at the head of an opening: the lintels. PROVISIONAL, see above. */
const HEAD_PIECE_COUNT = 34;
/** One slab per clear rect of every floored space, the bay floored only at its landing. */
const SLAB_COUNT = 22;
/** Guard railings: the two fall edges of the side-B voids, plus the balcony one. */
const RAILING_COUNT = 3;
/** Step boxes of the half-turn stair: nine risers each side of this floor. */
const STEP_COUNT = 18;
/**
 * Runs the floor threads: one built run per run the plan declares.
 *
 * DERIVED, not pinned, and it is the odd one out in this block on purpose. Every
 * other count here is a literal because the thing it counts is COMPUTED — how
 * many blocks 27 openings cut a wall into is a fact about `walls.ts` that a
 * literal is the only honest guard for. A service run is not computed: it is
 * declared, one entry at a time, and the only claim this file has any business
 * making is that the composition hands every one of them on. Pinning the number
 * here as well would just be `SERVICE_RUNS.length` written twice, and the second
 * copy would go stale the first time a run is added to the plan.
 */
const SERVICE_RUN_COUNT = SERVICE_RUNS.length;
/** Risers of one full storey, as the stair spec declares them. */
const RISER_COUNT = STAIRS_SPEC.riserCount;
/** Risers between this floor and a half-landing: half of them. */
const RISERS_PER_FLIGHT = RISER_COUNT / TWO;

/* ------------------------------------------------------------------ *
 * Areas, in square metres.
 * ------------------------------------------------------------------ */

/**
 * Wall footprint of the typical floor, in square metres.
 *
 * PROVISIONAL: this is the figure the code measures today, 43.720, and it is the
 * one under review by the isolation-rule investigation. It is also the number
 * behind the published "WALLS 43.72" — the same area rounded to two decimals.
 */
const WALL_FOOTPRINT_AREA = 43.72;
/** Floor total: what the slabs cover, the bay counted only at its landing. */
const FLOOR_AREA_TOTAL = 165.92;
/** The two `'void'` spaces of the plan: the side-B holes. */
const VOID_AREA = 9.36;
/** The open stair shaft: the bay less its arrival landing. */
const SHAFT_AREA = 6;
/** The 22.50 × 10.00 m plot. */
const PLOT_AREA = 225;

/* ------------------------------------------------------------------ *
 * Injected heights.
 * ------------------------------------------------------------------ */

/**
 * Vertical sizes with every field changed, to prove that no level of a
 * {@link BuiltFloor} is hard-coded. No value is a real one, and neither the slab
 * thickness they imply (4.44 − 3.33 = 1.11) nor any riser line
 * (k · 4.44 / 18) lands on a real level.
 *
 * There are no window fields to set: `FloorHeights` carries no sill or head, the
 * windows carry their own. That is asserted below rather than assumed.
 */
const OTHER_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 4.44,
  wall: 3.33,
  door: 2.22,
  railing: 1.55,
});

/** Levels every window declares for itself: plan data, not vertical sizes. */
const WINDOW_STATED_LEVELS: readonly number[] = Object.freeze(
  WINDOWS.flatMap((window) => [window.sill, window.head]),
);

/**
 * Heights the spec states for the parapets: plan data too, and 1.10 m since
 * ADR-011 — the same number as `FLOOR_HEIGHTS.railing`, because the entry carries
 * the constant itself rather than a second literal.
 */
const PARAPET_STATED_LEVELS: readonly number[] = Object.freeze(
  PARAPET_WALLS.map((parapet) => parapet.height),
);

/**
 * Levels the source of truth states, which therefore survive a change of
 * heights: every declared window sill and head, and the stated height of every
 * parapet. They are plan data, not vertical sizes.
 */
const PLAN_STATED_LEVELS: readonly number[] = Object.freeze([
  ...WINDOW_STATED_LEVELS,
  ...PARAPET_STATED_LEVELS,
]);

/**
 * Tells whether a level equals one of a set of levels.
 *
 * @param level - The level to test, in metres.
 * @param levels - The levels to match against.
 * @returns `true` when one of them is within {@link LENGTH_TOLERANCE} of `level`.
 */
function isOneOf(level: number, levels: readonly number[]): boolean {
  return levels.some((candidate) => Math.abs(level - candidate) <= LENGTH_TOLERANCE);
}

/**
 * Production levels that must vanish once {@link OTHER_HEIGHTS} is injected.
 *
 * The wall height, the railing height, the slab underside and the riser of the
 * real storey. `door` (2.10) is deliberately absent: it coincides with a level
 * the WINDOW SCHEDULE declares — the head of every `light` window is 2.10, and
 * its sill is 0.90 — so it goes on appearing whatever the heights say, and
 * forbidding it would fail for the plan's reason rather than for a leaked
 * height. `floorToFloor` is absent because nothing is ever
 * built at it. Every level left here is checked to appear on the real floor
 * below, so the guard is known to be able to fail.
 *
 * Only the WINDOW levels are filtered out, not every plan-stated level. Since
 * ADR-011 the parapet states 1.10 m, which is `FLOOR_HEIGHTS.railing` exactly, so
 * filtering against all plan-stated levels silently deleted the railing height
 * from this list — and with it the only thing that would catch a hard-coded 1.10
 * on the railings or the television panel of an injected floor. The parapet is
 * kept honest instead by measuring the floor WITHOUT its stated parapets
 * ({@link everyLevelButStatedParapets}): a 1.10 anywhere else is still a leak.
 */
const FORBIDDEN_LEVELS: readonly number[] = Object.freeze(
  [
    FLOOR_HEIGHTS.wall,
    FLOOR_HEIGHTS.railing,
    SLAB_BOTTOM,
    FLOOR_HEIGHTS.floorToFloor / RISER_COUNT,
  ].filter((level) => !isOneOf(level, WINDOW_STATED_LEVELS)),
);

/* ------------------------------------------------------------------ *
 * Mutation-guard figures.
 * ------------------------------------------------------------------ */

/** Wall blocks when only the 19 port openings are punched out. PROVISIONAL, see above. */
const PORT_ONLY_PIECE_COUNT = 194;
/**
 * Wall blocks at the injected heights: two fewer than at production heights,
 * because the stated 1.10 m parapet does not move with `heights.wall` and so
 * merges with its neighbours differently. PROVISIONAL, see above.
 */
const INJECTED_WALL_PIECE_COUNT = 236;
/** Blocks covering a window centre when the windows are dropped: the wall is solid. */
const SOLID_PIECES_AT_WINDOW = 1;

/**
 * Clear width of a default door leaf, taken from the schedule rather than written
 * here, for the synthetic port of the validation guard.
 */
const DOOR_WIDTH = PORT_SCHEDULE[0].width;

/**
 * A port across the stairs/corridor join, which the plan leaves without a wall:
 * the arrival landing is continuous with the corridor. `validatePorts` must
 * reject it, so `getBuiltFloor` never reaches the wall generator with a hole
 * that cuts nothing.
 */
const ZERO_WALL_PORT: Port = Object.freeze({
  spaces: Object.freeze(['stairs', 'corridor'] as const),
  kind: 'door',
  along: 'z',
  spanMin: 4.2,
  width: DOOR_WIDTH,
});

const FLOOR = getBuiltFloor();

/** The port openings of {@link FLOOR}, in schedule order. */
const PORT_OPENINGS = FLOOR.openings.slice(0, PORT_COUNT);

/**
 * Names a port for a test title.
 *
 * @param port - The port to name.
 * @returns The two space ids joined, such as `corridor ↔ kitchen`.
 */
function portLabel(port: Port): string {
  const [first, second] = port.spaces;
  return `${first} ↔ ${second}`;
}

/** Every port of the schedule with its name and its opening, for the hole table. */
const PORT_CASES: readonly (readonly [string, PlanBox])[] = PORT_SCHEDULE.map(
  (port, index) => [portLabel(port), PORT_OPENINGS[index]] as const,
);

/** Every window with its name, for the hole table. */
const WINDOW_CASES: readonly (readonly [string, FloorWindow])[] = FLOOR.windows.map(
  (window) => [`${window.kind} window of ${window.spaceId} (${window.side})`, window] as const,
);

/**
 * Returns the centre of a rectangle, which never lies on a grid line of the wall
 * generator and so identifies the wall blocks over one opening exactly.
 *
 * @param rect - The rectangle to measure.
 * @returns Its midpoint, in plan coordinates.
 */
function centreOf(rect: PlanRect): PlanPoint {
  return { x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF };
}

/**
 * Formats a footprint for a failure message.
 *
 * @param rect - The rectangle to format.
 * @returns Its four faces, in metres.
 */
function footprintKey(rect: PlanRect): string {
  return `x ${String(rect.minX)}–${String(rect.maxX)} z ${String(rect.minZ)}–${String(rect.maxZ)}`;
}

/**
 * Tells whether two boxes share a volume.
 *
 * @param a - First box.
 * @param b - Second box.
 * @returns `true` when their footprints overlap and their vertical spans do, both
 *   by more than {@link LENGTH_TOLERANCE}; boxes that merely touch do not overlap.
 */
function boxesOverlap(a: PlanBox, b: PlanBox): boolean {
  return (
    rectsOverlap(a.rect, b.rect) &&
    Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > LENGTH_TOLERANCE
  );
}

/**
 * Lists the wall blocks that stand in the way of an opening.
 *
 * @param pieces - The wall blocks to search.
 * @param opening - The hole that must be clear.
 * @returns The blocks covering the opening's centre whose span overlaps its own.
 */
function coveringPieces(pieces: readonly PlanBox[], opening: PlanBox): readonly PlanBox[] {
  const centre = centreOf(opening.rect);
  return pieces.filter(
    (piece) =>
      rectContainsPoint(piece.rect, centre) &&
      Math.min(piece.top, opening.top) - Math.max(piece.bottom, opening.bottom) > LENGTH_TOLERANCE,
  );
}

/**
 * Lists the wall blocks sitting on top of an opening: its lintel.
 *
 * @param pieces - The wall blocks to search.
 * @param opening - The hole to look above.
 * @returns The blocks over the opening's centre that start at or above its head.
 */
function piecesAbove(pieces: readonly PlanBox[], opening: PlanBox): readonly PlanBox[] {
  const centre = centreOf(opening.rect);
  return pieces.filter(
    (piece) =>
      rectContainsPoint(piece.rect, centre) && piece.bottom >= opening.top - LENGTH_TOLERANCE,
  );
}

/**
 * Lists the wall blocks under an opening: a threshold under a door, a sill under
 * a window.
 *
 * @param pieces - The wall blocks to search.
 * @param opening - The hole to look below.
 * @returns The blocks under the opening's centre that end at or below its underside.
 */
function piecesBelow(pieces: readonly PlanBox[], opening: PlanBox): readonly PlanBox[] {
  const centre = centreOf(opening.rect);
  return pieces.filter(
    (piece) =>
      rectContainsPoint(piece.rect, centre) && piece.top <= opening.bottom + LENGTH_TOLERANCE,
  );
}

/**
 * Sums the footprints of a set of boxes.
 *
 * @param boxes - The boxes to measure.
 * @returns The total area, in square metres.
 */
function totalRectArea(boxes: readonly { readonly rect: PlanRect }[]): number {
  return boxes.reduce((sum, box) => sum + rectArea(box.rect), 0);
}

/**
 * Returns the area of the plan that has no floor because it is a void.
 *
 * Derived from the plan rather than written down, so the 225.00 m² total is a
 * check on the plan and not on a copied number.
 *
 * @param plan - The floor plan to measure.
 * @returns The summed area of its `'void'` spaces, in square metres.
 */
function voidArea(plan: typeof FLOOR_PLAN): number {
  return plan.spaces
    .filter((space) => space.kind === 'void')
    .reduce((sum, space) => sum + getSpaceArea(space), 0);
}

/**
 * Returns the area of the stair bay that is not floor at this storey.
 *
 * The stair runs through the floor, so the bay is a hole everywhere but the
 * arrival landing. Read off the layout, not named, so a plan that declares
 * another landing moves this figure with it.
 *
 * @param floor - The built floor to measure.
 * @returns The bay less its arrival landing, in square metres.
 */
function shaftArea(floor: ReturnType<typeof getBuiltFloor>): number {
  return rectArea(floor.stairs.bay) - rectArea(floor.stairs.landingRect);
}

/**
 * Lists every vertical level a built floor carries, across every part of it.
 *
 * @param floor - The built floor to read.
 * @returns Every bottom and top of the walls, the slabs, the steps, the TV panel,
 *   the window openings and the port openings, plus the railing tops.
 */
function everyLevel(floor: ReturnType<typeof getBuiltFloor>): readonly number[] {
  return [
    ...floor.walls.flatMap((piece) => [piece.bottom, piece.top]),
    ...floor.slabs.flatMap((slab) => [slab.bottom, slab.top]),
    ...floor.railings.map((railing) => railing.top),
    ...floor.stairs.steps.flatMap((step) => [step.bottom, step.top]),
    floor.tvPanel.bottom,
    floor.tvPanel.top,
    ...floor.windows.flatMap((window) => [window.opening.bottom, window.opening.top]),
    ...floor.openings.flatMap((opening) => [opening.bottom, opening.top]),
  ];
}

/**
 * Lists every level of a built floor except the tops of its stated parapets.
 *
 * A parapet's top is plan data: `PARAPET_WALLS` states 1.10 m and no height may
 * move it. Every OTHER level is a vertical size, so this is the set a change of
 * heights must sweep clean — and keeping the parapet out of it is what lets the
 * railing height stay forbidden even though the plan now states the same number.
 *
 * @param floor - The built floor to read.
 * @returns Every level of {@link everyLevel} bar those of the parapet blocks.
 */
function everyLevelButStatedParapets(floor: ReturnType<typeof getBuiltFloor>): readonly number[] {
  return everyLevel({ ...floor, walls: floor.walls.filter((piece) => piece.kind !== 'parapet') });
}

/**
 * Returns the level the slabs of a built floor end at and the lowest level its
 * walls start at, so that the two can be compared exactly.
 *
 * @param floor - The built floor to measure.
 * @returns The sole slab underside and the lowest wall underside, in metres.
 */
function undersides(floor: ReturnType<typeof getBuiltFloor>): {
  readonly slab: number;
  readonly wall: number;
} {
  const slabLevels = [...new Set(floor.slabs.map((slab) => slab.bottom))];

  expect(slabLevels).toHaveLength(ONE);
  return { slab: slabLevels[0], wall: Math.min(...floor.walls.map((piece) => piece.bottom)) };
}

describe('the composed floor', () => {
  it('builds every part of the typical floor once', () => {
    expect(FLOOR.walls).toHaveLength(WALL_PIECE_COUNT);
    expect(FLOOR.slabs).toHaveLength(SLAB_COUNT);
    expect(FLOOR.railings).toHaveLength(RAILING_COUNT);
    expect(FLOOR.windows).toHaveLength(WINDOW_COUNT);
    expect(FLOOR.stairs.steps).toHaveLength(STEP_COUNT);
    expect(FLOOR.openings).toHaveLength(OPENING_COUNT);
    expect(FLOOR.services).toHaveLength(SERVICE_RUN_COUNT);
  });

  it('composes the service runs rather than deriving any of them', () => {
    // The composition invents no geometry, here as for the fixtures: it calls
    // `getServiceRuns` and holds what comes back. Identity across the two calls
    // would prove nothing (the module builds a fresh array each time), so this
    // asserts the stronger thing — that the floor carries exactly the declared
    // runs, in declaration order, with no run added, dropped or reshaped.
    expect(FLOOR.services).toEqual(getServiceRuns());
    expect(FLOOR.services.map((run) => run.matricule)).toEqual(
      getServiceRuns().map((run) => run.matricule),
    );
    // ...and the floor really carries one built run per DECLARED run, which is
    // what makes the length above a claim and not a tautology.
    expect(SERVICE_RUN_COUNT).toBeGreaterThan(NONE);
    expect(new Set(FLOOR.services.map((run) => run.matricule)).size).toBe(SERVICE_RUN_COUNT);
  });

  it('lets no injected height move a single service run', () => {
    // Every level a run is at is declared point by point, measured from the
    // finished floor of its own storey, so the runs are the one part of the
    // floor that takes NEITHER the plan's heights nor an injected set. A run
    // that moved with `heights.wall` would be a pipe that changed depth when
    // the ceiling changed height.
    const elsewhere = getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, OTHER_HEIGHTS);

    expect(elsewhere.services).toEqual(FLOOR.services);
  });

  it('gives every run boxes to be drawn as, so no layer is an empty checkbox', () => {
    const legs = FLOOR.services.flatMap((run) => run.segments.map((segment) => segment.box));

    expect(legs.length).toBeGreaterThan(FLOOR.services.length);
    FLOOR.services.forEach((run) => {
      expect(run.segments.length, run.matricule).toBeGreaterThan(NONE);
      expect(run.bore, run.matricule).toBeGreaterThan(NONE);
    });
  });

  it('takes every port and every window of the declared schedules', () => {
    // The two counts the hole tables below are sliced with: pinned against the
    // schedules, so a table can never be built over a missing opening.
    expect(PORT_SCHEDULE).toHaveLength(PORT_COUNT);
    expect(WINDOWS).toHaveLength(WINDOW_COUNT);
    expect(PORT_CASES).toHaveLength(PORT_COUNT);
    expect(WINDOW_CASES).toHaveLength(WINDOW_COUNT);
    PORT_OPENINGS.forEach((opening) => {
      expect(opening).toBeDefined();
    });
  });

  it('defaults to the real plan, the real schedule and the real heights', () => {
    expect(getBuiltFloor()).toEqual(getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, FLOOR_HEIGHTS));
  });

  it('lists the port openings first, then the window openings', () => {
    PORT_SCHEDULE.forEach((port, index) => {
      expect(FLOOR.openings[index]).toEqual(getPortOpening(FLOOR_PLAN, port));
    });
    FLOOR.windows.forEach((window, index) => {
      expect(FLOOR.openings[PORT_COUNT + index]).toBe(window.opening);
    });
  });

  it('gives the doors a door head and every window the sill and head it declares', () => {
    PORT_OPENINGS.forEach((opening) => {
      expect(opening.bottom).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
      expect(opening.top).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
    });
    FLOOR.windows.forEach((window, index) => {
      // The schedule, not the heights: an air window vents high and a pass
      // window sits at counter height (`sourceOfTruth/plan.ts`).
      expect(window.sill).toBeCloseTo(WINDOWS[index].sill, PRECISION_DIGITS);
      expect(window.head).toBeCloseTo(WINDOWS[index].head, PRECISION_DIGITS);
      expect(window.opening.bottom).toBeCloseTo(window.sill, PRECISION_DIGITS);
      expect(window.opening.top).toBeCloseTo(window.head, PRECISION_DIGITS);
    });
    // And they are not all one size: a single sill would make the case above
    // pass while proving nothing about reading the schedule.
    expect(new Set(FLOOR.windows.map((window) => window.sill)).size).toBeGreaterThan(ONE);
    expect(new Set(FLOOR.windows.map((window) => window.head)).size).toBeGreaterThan(ONE);
  });

  it('splits the walls into bases on the slab and lintels over the openings', () => {
    const bases = FLOOR.walls.filter(
      (piece) => Math.abs(piece.bottom - SLAB_BOTTOM) <= LENGTH_TOLERANCE,
    );
    const heads = FLOOR.walls.filter((piece) => piece.bottom > SLAB_BOTTOM + LENGTH_TOLERANCE);

    expect(bases).toHaveLength(BASE_PIECE_COUNT);
    expect(heads).toHaveLength(HEAD_PIECE_COUNT);
    expect(bases.length + heads.length).toBe(WALL_PIECE_COUNT);
  });

  it('stands the walls on exactly the level the slabs end at', () => {
    const { slab, wall } = undersides(FLOOR);

    // Exact equality, not toBeCloseTo: both levels come from `getSlabThickness`
    // (`slabs.ts`), so the section closes bit for bit rather than merely within
    // LENGTH_TOLERANCE, and an exact comparison downstream cannot drift.
    expect(wall).toBe(slab);
    expect(wall).toBe(-toPlanLength(FLOOR_HEIGHTS.floorToFloor - FLOOR_HEIGHTS.wall));
  });

  it('returns a frozen result whose arrays and members are frozen', () => {
    expect(Object.isFrozen(FLOOR)).toBe(true);
    expect(Object.isFrozen(FLOOR.walls)).toBe(true);
    expect(Object.isFrozen(FLOOR.slabs)).toBe(true);
    expect(Object.isFrozen(FLOOR.railings)).toBe(true);
    expect(Object.isFrozen(FLOOR.windows)).toBe(true);
    expect(Object.isFrozen(FLOOR.openings)).toBe(true);
    expect(Object.isFrozen(FLOOR.stairs)).toBe(true);
    expect(Object.isFrozen(FLOOR.stairs.steps)).toBe(true);
    expect(Object.isFrozen(FLOOR.tvPanel)).toBe(true);
    expect(Object.isFrozen(FLOOR.services)).toBe(true);
    FLOOR.services.forEach((run) => {
      expect(Object.isFrozen(run), run.matricule).toBe(true);
      expect(Object.isFrozen(run.segments), run.matricule).toBe(true);
      expect(Object.isFrozen(run.cover), run.matricule).toBe(true);
      expect(Object.isFrozen(run.caps), run.matricule).toBe(true);
    });
    [...FLOOR.walls, ...FLOOR.slabs, ...FLOOR.openings, ...FLOOR.stairs.steps].forEach((box) => {
      expect(Object.isFrozen(box)).toBe(true);
      expect(Object.isFrozen(box.rect)).toBe(true);
    });
    FLOOR.windows.forEach((window) => {
      expect(Object.isFrozen(window)).toBe(true);
      expect(Object.isFrozen(window.opening)).toBe(true);
    });
    FLOOR.railings.forEach((railing) => {
      expect(Object.isFrozen(railing)).toBe(true);
      expect(Object.isFrozen(railing.rect)).toBe(true);
    });
  });

  it('produces equal geometry on two calls with the same arguments', () => {
    const again = getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, FLOOR_HEIGHTS);

    expect(again).toEqual(FLOOR);
    expect(again).not.toBe(FLOOR);
  });
});

describe('the four parts of the plot', () => {
  it('walls 43.720 m² of the plot', () => {
    expect(getWallFootprintArea(FLOOR.walls)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('floors 165.920 m² of the plot', () => {
    expect(totalRectArea(FLOOR.slabs)).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
  });

  it('leaves 9.36 m² of void and a 6.00 m² stair shaft unbuilt', () => {
    expect(voidArea(FLOOR_PLAN)).toBeCloseTo(VOID_AREA, PRECISION_DIGITS);
    expect(shaftArea(FLOOR)).toBeCloseTo(SHAFT_AREA, PRECISION_DIGITS);
    // The bay is a hole everywhere but its landing, and the landing is slab.
    expect(rectArea(FLOOR.stairs.landingRect)).toBeCloseTo(
      rectArea(getSpace(FLOOR_PLAN, 'stairs').rects[0]) - SHAFT_AREA,
      PRECISION_DIGITS,
    );
  });

  it('closes FLOOR + VOID + WALLS + SHAFT on the whole 225.00 m² plot', () => {
    // Every part is measured from the module that builds it, so this holds
    // whatever the wall rule decides: a square metre that leaves the walls has
    // to arrive in the floor, the voids or the shaft.
    const walls = getWallFootprintArea(FLOOR.walls);
    const floors = totalRectArea(FLOOR.slabs);
    const voids = voidArea(FLOOR_PLAN);
    const shaft = shaftArea(FLOOR);

    expect(floors + voids + walls + shaft).toBeCloseTo(PLOT_AREA, PRECISION_DIGITS);
    expect(floors + voids + walls + shaft).toBeCloseTo(rectArea(PLOT_RECT), PRECISION_DIGITS);
  });
});

describe('every port of the real schedule holes its wall', () => {
  it.each(PORT_CASES)('opens %s and keeps a lintel over it', (_label, opening) => {
    expect(coveringPieces(FLOOR.walls, opening)).toEqual([]);

    const above = piecesAbove(FLOOR.walls, opening);
    const below = piecesBelow(FLOOR.walls, opening);

    expect(above.length).toBeGreaterThan(NONE);
    above.forEach((piece) => {
      expect(piece.bottom).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
      expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
    });
    expect(below.length).toBeGreaterThan(NONE);
    below.forEach((piece) => {
      expect(piece.top).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
    });
  });
});

describe('every window of the real floor holes its wall', () => {
  it.each(WINDOW_CASES)('glazes the %s between its own sill and head', (_label, window) => {
    expect(coveringPieces(FLOOR.walls, window.opening)).toEqual([]);

    const above = piecesAbove(FLOOR.walls, window.opening);
    const below = piecesBelow(FLOOR.walls, window.opening);

    expect(above.length).toBeGreaterThan(NONE);
    above.forEach((piece) => {
      expect(piece.bottom).toBeCloseTo(window.head, PRECISION_DIGITS);
      expect(piece.top).toBeCloseTo(FLOOR_HEIGHTS.wall, PRECISION_DIGITS);
    });
    expect(below.length).toBeGreaterThan(NONE);
    below.forEach((piece) => {
      expect(piece.bottom).toBeCloseTo(SLAB_BOTTOM, PRECISION_DIGITS);
      expect(piece.top).toBeCloseTo(window.sill, PRECISION_DIGITS);
    });
  });
});

describe('nothing intersects in three dimensions', () => {
  it('never overlaps two wall blocks', () => {
    const offenders = FLOOR.walls.flatMap((piece, position) =>
      FLOOR.walls
        .slice(position + ONE)
        .filter((other) => boxesOverlap(piece, other))
        .map((other) => `${footprintKey(piece.rect)} ↔ ${footprintKey(other.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never overlaps a wall and a slab', () => {
    const offenders = FLOOR.walls.flatMap((piece) =>
      FLOOR.slabs
        .filter((slab) => boxesOverlap(piece, slab))
        .map((slab) => `${footprintKey(piece.rect)} ↔ slab of ${slab.spaceId}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never overlaps a step and a wall', () => {
    const offenders = FLOOR.stairs.steps.flatMap((step, index) =>
      FLOOR.walls
        .filter((piece) => boxesOverlap(step, piece))
        .map((piece) => `step ${String(index)} ↔ ${footprintKey(piece.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never overlaps two steps, and keeps them all off the landing', () => {
    const stepOffenders = FLOOR.stairs.steps.flatMap((step, index) =>
      FLOOR.stairs.steps
        .slice(index + ONE)
        .filter((other) => boxesOverlap(step, other))
        .map((other) => `${footprintKey(step.rect)} ↔ ${footprintKey(other.rect)}`),
    );
    const onLanding = FLOOR.stairs.steps
      .filter((step) => rectsOverlap(step.rect, FLOOR.stairs.landingRect))
      .map((step) => footprintKey(step.rect));

    expect(FLOOR.stairs.steps).toHaveLength(STEP_COUNT);
    expect(stepOffenders).toEqual([]);
    expect(onLanding).toEqual([]);
  });

  it('never overlaps the TV panel and a wall', () => {
    const offenders = FLOOR.walls
      .filter((piece) => boxesOverlap(FLOOR.tvPanel, piece))
      .map((piece) => footprintKey(piece.rect));

    expect(offenders).toEqual([]);
  });

  it('keeps the railings clear of every wall', () => {
    const offenders = FLOOR.railings.flatMap((railing) =>
      FLOOR.walls
        .filter((piece) => rectsOverlap(railing.rect, piece.rect))
        .map((piece) => `${railing.spaces.join(' ↔ ')} ↔ ${footprintKey(piece.rect)}`),
    );

    expect(offenders).toEqual([]);
  });

  it('stands each railing on the slab of the floored space it guards', () => {
    // A railing straddles the slab/void edge by design (`railings.ts`): it is a
    // rail on floor area already counted in the 165.920 m², not a wall, so this
    // one footprint overlap is the documented behaviour rather than a clash.
    // The floored side is read off the railing's own pair — the void first, then
    // the space it guards — so the three railings of the plan check three
    // different slabs instead of all being asserted against the balcony.
    expect(FLOOR.railings).toHaveLength(RAILING_COUNT);
    FLOOR.railings.forEach((railing) => {
      const [voidId, flooredId] = railing.spaces;
      const carried = FLOOR.slabs.filter((slab) => rectsOverlap(railing.rect, slab.rect));

      expect(getSpace(FLOOR_PLAN, voidId).kind).toBe('void');
      expect(carried).toHaveLength(ONE);
      expect(carried[0].spaceId).toBe(flooredId);
    });
    expect(new Set(FLOOR.railings.map((railing) => railing.spaces[1])).size).toBeGreaterThan(ONE);
  });
});

describe('injected heights', () => {
  const injected = getBuiltFloor(FLOOR_PLAN, PORT_SCHEDULE, OTHER_HEIGHTS);
  const levels = everyLevel(injected);

  /** Underside of the slab the injected sizes imply: 4.44 − 3.33. */
  const otherSlabBottom = -toPlanLength(OTHER_HEIGHTS.floorToFloor - OTHER_HEIGHTS.wall);
  /** Height of one riser at the injected storey height. */
  const otherRiser = OTHER_HEIGHTS.floorToFloor / RISER_COUNT;
  /** Half a storey, where the stair hands the walker over: nine risers. */
  const otherHalfStorey = RISERS_PER_FLIGHT * otherRiser;
  /**
   * Every riser line the stair can touch: the step boxes run from one riser
   * below the half-landing beneath this floor up to the half-landing above it.
   */
  const otherRiserLines = Array.from(
    { length: RISER_COUNT + TWO },
    (_unused, offset) => (offset - RISERS_PER_FLIGHT - ONE) * otherRiser,
  );
  const allowedLevels: readonly number[] = [
    otherSlabBottom,
    FLOOR_LEVEL,
    OTHER_HEIGHTS.railing,
    OTHER_HEIGHTS.door,
    OTHER_HEIGHTS.wall,
    ...PLAN_STATED_LEVELS,
    ...otherRiserLines,
  ];

  it('has a forbidden list that the real floor really carries', () => {
    // Without this the guard below could pass by forbidding levels nothing ever
    // builds at. Every level it forbids is on the real floor, and on the parts of
    // it the guard actually measures — the railing height is on the railings and
    // the television panel, not only on the balustrade whose height the plan
    // states, so excluding the parapets does not empty the guard.
    expect(FORBIDDEN_LEVELS.length).toBeGreaterThan(NONE);
    expect(FORBIDDEN_LEVELS).toContain(FLOOR_HEIGHTS.railing);
    FORBIDDEN_LEVELS.forEach((level) => {
      expect(isOneOf(level, everyLevelButStatedParapets(FLOOR)), String(level)).toBe(true);
    });
  });

  it('keeps no production height anywhere in the built floor', () => {
    const survivors = [
      ...new Set(
        everyLevelButStatedParapets(injected).filter((level) => isOneOf(level, FORBIDDEN_LEVELS)),
      ),
    ];

    expect(survivors).toEqual([]);
  });

  it('takes every level from the injected sizes and the plan alone', () => {
    const strangers = [...new Set(levels.filter((level) => !isOneOf(level, allowedLevels)))];

    expect(strangers).toEqual([]);
    // The lowest thing built is the step below the half-landing beneath this
    // floor, not the slab: the stair passes through the storey.
    expect(Math.min(...levels)).toBeCloseTo(-otherHalfStorey - otherRiser, PRECISION_DIGITS);
    expect(Math.min(...levels)).toBeLessThan(otherSlabBottom);
    // And the highest is the top of the walls, which outreach the flight.
    expect(Math.max(...levels)).toBeCloseTo(OTHER_HEIGHTS.wall, PRECISION_DIGITS);
    expect(Math.max(...levels)).toBeGreaterThan(otherHalfStorey);
  });

  it('moves the stairs, the railings and the TV panel with the heights', () => {
    expect(injected.stairs.riser).toBeCloseTo(otherRiser, PRECISION_DIGITS);
    expect(injected.stairs.highestLevel).toBeCloseTo(otherHalfStorey, PRECISION_DIGITS);
    expect(injected.stairs.lowestLevel).toBeCloseTo(-otherHalfStorey, PRECISION_DIGITS);
    injected.railings.forEach((railing) => {
      expect(railing.top).toBeCloseTo(OTHER_HEIGHTS.railing, PRECISION_DIGITS);
    });
    expect(injected.tvPanel.bottom).toBeCloseTo(OTHER_HEIGHTS.railing, PRECISION_DIGITS);
    expect(injected.tvPanel.top).toBeCloseTo(OTHER_HEIGHTS.door, PRECISION_DIGITS);
    injected.slabs.forEach((slab) => {
      expect(slab.bottom).toBeCloseTo(otherSlabBottom, PRECISION_DIGITS);
      expect(slab.top).toBeCloseTo(FLOOR_LEVEL, PRECISION_DIGITS);
    });
  });

  it('leaves the windows and the parapet where the plan states them', () => {
    // These are the levels a change of heights must NOT move: each window's own
    // sill and head, and the stated height of the balustrade. `FloorHeights` has
    // no window sill or head at all, so there is nothing for these to come from
    // but the schedule.
    injected.windows.forEach((window, index) => {
      expect(window.sill).toBeCloseTo(WINDOWS[index].sill, PRECISION_DIGITS);
      expect(window.head).toBeCloseTo(WINDOWS[index].head, PRECISION_DIGITS);
      expect(window.opening.bottom).toBeCloseTo(
        FLOOR.windows[index].opening.bottom,
        PRECISION_DIGITS,
      );
      expect(window.opening.top).toBeCloseTo(FLOOR.windows[index].opening.top, PRECISION_DIGITS);
      // Two assertions deleted here. They proved each sill and head differed
      // from `OTHER_HEIGHTS.windowSill` / `.windowHead` (1.11 and 2.22), the
      // injected floor-wide pair. Those fields are gone, so no window could take
      // a level from them; the four assertions above pin each window to the level
      // the plan states, which is what the deleted pair was approximating.
    });
    const parapets = injected.walls.filter((piece) => piece.kind === 'parapet');

    expect(parapets.length).toBeGreaterThan(NONE);
    parapets.forEach((piece) => {
      expect(isOneOf(piece.top, PARAPET_STATED_LEVELS)).toBe(true);
      expect(piece.top).not.toBeCloseTo(OTHER_HEIGHTS.wall, PRECISION_DIGITS);
      // And not the injected RAILING either. Since ADR-011 the plan states the
      // balustrade at `HEIGHTS.railing`, so at production heights a module reading
      // `heights.railing` for it would look right; here the two differ (1.10
      // stated against 1.55 injected) and only the stated one may win.
      expect(piece.top).not.toBeCloseTo(OTHER_HEIGHTS.railing, PRECISION_DIGITS);
      expect(OTHER_HEIGHTS.railing).not.toBeCloseTo(FLOOR_HEIGHTS.railing, PRECISION_DIGITS);
    });
  });

  it('stands the walls on exactly the level the slabs end at, at any height', () => {
    const { slab, wall } = undersides(injected);

    expect(wall).toBe(slab);
    expect(wall).toBe(otherSlabBottom);
  });

  it('keeps the plan figures, which no height can change', () => {
    expect(injected.openings).toHaveLength(OPENING_COUNT);
    expect(injected.windows).toHaveLength(WINDOW_COUNT);
    expect(injected.slabs).toHaveLength(SLAB_COUNT);
    expect(injected.railings).toHaveLength(RAILING_COUNT);
    expect(getWallFootprintArea(injected.walls)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
    expect(totalRectArea(injected.slabs)).toBeCloseTo(FLOOR_AREA_TOTAL, PRECISION_DIGITS);
    expect(shaftArea(injected)).toBeCloseTo(SHAFT_AREA, PRECISION_DIGITS);
  });

  it('cuts the walls into fewer blocks, because the parapet does not move', () => {
    // The wall COUNT is not a plan figure. The stated 1.10 m balustrade keeps
    // its height while every other wall rises to 3.33, so the cells merge
    // differently and two blocks fewer come out. The footprint area, asserted
    // above, is what stays fixed.
    expect(injected.walls).toHaveLength(INJECTED_WALL_PIECE_COUNT);
    expect(injected.walls.length).not.toBe(WALL_PIECE_COUNT);
  });
});

describe('mutation guards', () => {
  it('solidifies every window when the window openings are dropped', () => {
    const withoutWindows = getWallPieces(FLOOR_PLAN, PORT_OPENINGS);

    expect(withoutWindows).toHaveLength(PORT_ONLY_PIECE_COUNT);
    expect(withoutWindows.length).not.toBe(WALL_PIECE_COUNT);
    FLOOR.windows.forEach((window) => {
      expect(coveringPieces(withoutWindows, window.opening)).toHaveLength(SOLID_PIECES_AT_WINDOW);
      expect(coveringPieces(FLOOR.walls, window.opening)).toEqual([]);
    });
    // The footprint is unchanged: a window takes height out of a wall, not plan area.
    expect(getWallFootprintArea(withoutWindows)).toBeCloseTo(WALL_FOOTPRINT_AREA, PRECISION_DIGITS);
  });

  it('validates the schedule before it derives anything from it', () => {
    expect(() => getBuiltFloor(FLOOR_PLAN, [...PORT_SCHEDULE, ZERO_WALL_PORT])).toThrow(
      /has no wall to cut/u,
    );
    expect(() => getBuiltFloor(FLOOR_PLAN, [ZERO_WALL_PORT])).toThrow(RangeError);
  });

  it('leaves the plan and the schedule untouched', () => {
    expect(Object.isFrozen(FLOOR_PLAN)).toBe(true);
    expect(Object.isFrozen(PORT_SCHEDULE)).toBe(true);
    expect(PORT_SCHEDULE).toHaveLength(PORT_COUNT);
    expect(getBuiltFloor()).toEqual(FLOOR);
  });
});
