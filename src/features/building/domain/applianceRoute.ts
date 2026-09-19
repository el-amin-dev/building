/**
 * Can an appliance actually be carried to the room it stands in?
 *
 * Two claims about this building have never been checked. Brief §7.5 sizes the
 * corridor at 1.50 m "chosen so a fridge (~0.90 m) or a washing machine can be
 * carried through with clearance", and ADR-010 spends 0.03 m of going on a
 * second 1.00 × 2.00 m landing so that an appliance can be turned in it. Both
 * are geometry, and neither had a test.
 *
 * **Every value this module works from is derived.** The appliance's size is
 * read off its own fixture rather than transcribed from the prose that names it,
 * so moving the fridge in `sourceOfTruth/plan.ts` moves the measurement; the
 * corridor's width is measured off a {@link WalkField}, not off the rectangle the
 * corridor was drawn as. That distinction is the point of {@link getClearWidth}:
 * a rect says how wide the corridor was drawn, a field says how much of it is
 * still clear once the masonry, the holes and the railings have taken their
 * share. Nothing here holds a number of its own except the sampling resolution.
 *
 * What this module does NOT do is simulate carrying anything. {@link canTurn} is
 * a sufficient condition on two rectangles and says so; a route is a sequence of
 * spaces from `reachability.ts` and a clear width is a minimum over samples.
 * Whether the man carrying the fridge can get his hands round it is not a
 * question geometry answers.
 *
 * Pure geometry, in metres, with the plan conventions of `floorPlan/types.ts`
 * (ADR-005): no plan and no field is read from module scope, so every answer is
 * about the floor the caller handed in.
 */
import type { WalkField } from './collision.ts';
import type { BuiltFixture } from './fixtures.ts';
import { CENTIMETRES_PER_METRE, LENGTH_TOLERANCE, rectDepth, rectWidth } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import type { PlanFixtureKind } from './sourceOfTruth/plan.ts';

/** How many fixtures of a kind a footprint can be read off: exactly one. */
const EXACTLY_ONE = 1;

/** The starting width of a clear run before any of it has been measured, in metres. */
const NO_SPAN = 0;

/** Half a sampling step, which is what puts a sample in the middle of one. */
const HALF = 0.5;

/**
 * Distance between two samples across a rect, in metres: one centimetre.
 *
 * The plan grid (`planGeometry.ts`, ADR-005), so a blocker face can never fall
 * between two samples without a sample landing in the gap it leaves.
 */
const SAMPLE_STEP = 1 / CENTIMETRES_PER_METRE;

/** A plan axis: the two directions a rect has faces on. */
export type PlanAxis = 'x' | 'z';

/** The two faces of a rect on one axis, in metres. */
interface AxisSpan {
  /** The low face. */
  readonly min: number;
  /** The high face. */
  readonly max: number;
}

/**
 * The floor a rigid appliance occupies, with its longer side named first.
 *
 * Normalised rather than reported as (x, z), and that is the whole difference
 * between this and the fixture's rect. A fixture rect is where the thing stands;
 * `fixtures.ts` states outright that a rect does not say which face is the
 * front, so which of its two sides is "width" is a fact about where it was
 * parked and not about the object. An appliance being carried is turned to
 * whichever face suits the opening, so the only two numbers that matter are its
 * larger plan dimension and its smaller one.
 */
export interface ApplianceFootprint {
  /** The longer side of the footprint, in metres. */
  readonly width: number;
  /** The shorter side, in metres. */
  readonly depth: number;
}

/**
 * Reads the two faces a rect has on one axis.
 *
 * @param rect - The rectangle to read.
 * @param axis - Which pair of faces is wanted.
 * @returns The low and high face on that axis, in metres.
 */
function spanOn(rect: PlanRect, axis: PlanAxis): AxisSpan {
  return axis === 'x' ? { min: rect.minX, max: rect.maxX } : { min: rect.minZ, max: rect.maxZ };
}

/**
 * The footprint of an appliance, read off its own fixture — never transcribed.
 *
 * The brief writes "~0.90 m" beside the fridge, and a test that believed the
 * prose would go on passing after somebody narrowed the appliance in the plan.
 * So the size comes from the placed fixture, which means the plan and the test
 * cannot disagree about how big the thing is.
 *
 * @param built - The fixtures of the floor, as `getFixtures` built them.
 * @param kind - The kind of fixture to measure.
 * @returns Its frozen {@link ApplianceFootprint}, longer side first.
 * @throws RangeError naming the kind and the count when the floor holds no
 *   fixture of that kind or more than one. Silence would be worse than the
 *   throw: a route test that measured nothing at all would pass, and a `'tv'`
 *   asked for here is exactly that case — the plan numbers one, and
 *   `getFixtures` drops it because `tvPanel.ts` derives the panel instead.
 */
export function getApplianceFootprint(
  built: readonly BuiltFixture[],
  kind: PlanFixtureKind,
): ApplianceFootprint {
  const matches = built.filter((fixture) => fixture.kind === kind);
  if (matches.length !== EXACTLY_ONE) {
    throw new RangeError(
      `the floor holds ${String(matches.length)} fixtures of kind "${kind}", and a footprint can only be read off exactly one`,
    );
  }
  const [only] = matches;
  const acrossX = rectWidth(only.rect);
  const acrossZ = rectDepth(only.rect);
  return Object.freeze({
    width: Math.max(acrossX, acrossZ),
    depth: Math.min(acrossX, acrossZ),
  });
}

/**
 * Measures the widest clear run across one sample line of a rect.
 *
 * Every blocker the line passes through is clipped to the band and the gaps
 * between them are what is left. The WIDEST gap rather than the total, because
 * an appliance is carried through one gap: a corridor split down the middle by a
 * column is two narrow passages, not one wide one.
 *
 * @param field - The walk field; only its blockers are consulted.
 * @param at - Where the sample line sits along the direction of travel, in metres.
 * @param along - The direction of travel.
 * @param band - The stretch of the crossing axis the rect covers, in metres.
 * @returns The widest clear run within the band, in metres; `0` when a blocker
 *   covers the whole of it.
 */
function getClearSpanAt(field: WalkField, at: number, along: PlanAxis, band: AxisSpan): number {
  const across: PlanAxis = along === 'x' ? 'z' : 'x';
  const bars = field.blockers
    // Strictly straddling the line: a blocker whose face the line grazes is
    // beside the sample, not across it. Samples sit half a centimetre off the
    // plan grid (see SAMPLE_STEP), so no face of this plan can land on one.
    .filter((blocker) => {
      const reach = spanOn(blocker, along);
      return at > reach.min && at < reach.max;
    })
    .map((blocker) => spanOn(blocker, across))
    .map((bar) => ({ min: Math.max(bar.min, band.min), max: Math.min(bar.max, band.max) }))
    .filter((bar) => bar.max > bar.min)
    .sort((first, second) => first.min - second.min);

  let cursor = band.min;
  let widest = NO_SPAN;
  bars.forEach((bar) => {
    widest = Math.max(widest, bar.min - cursor);
    cursor = Math.max(cursor, bar.max);
  });
  return Math.max(widest, band.max - cursor);
}

/**
 * The narrowest clear span across a rect, perpendicular to `along`, measured off
 * a walk field.
 *
 * Measured off the field's blockers and never off the rect: the rect says how
 * wide the corridor was DRAWN, and the field says how much of that drawing a
 * body can still walk in. The two are the same number only as long as nothing
 * has been put in the way, and finding out whether anything has is the reason
 * this function exists.
 *
 * The rect is sampled every centimetre along `along` — the plan grid, so no
 * blocker face can slip between two samples — and the answer is the worst
 * sample. A minimum rather than an average, because an appliance is stopped by
 * the narrowest point of a passage and by nothing else.
 *
 * @param field - The walk field to measure in; only its blockers are consulted.
 *   A field built for a different storey measures that storey.
 * @param rect - The stretch of floor to measure across, typically one clear rect
 *   of a `circulation` space.
 * @param along - The direction of travel; the span is measured perpendicular to
 *   it, within the rect's own faces on that axis.
 * @returns The narrowest clear span, in metres; `0` where a blocker crosses the
 *   rect completely.
 */
export function getClearWidth(field: WalkField, rect: PlanRect, along: PlanAxis): number {
  const travel = spanOn(rect, along);
  const band = spanOn(rect, along === 'x' ? 'z' : 'x');
  const samples = Math.max(
    EXACTLY_ONE,
    Math.round((travel.max - travel.min) * CENTIMETRES_PER_METRE),
  );
  let narrowest = Number.POSITIVE_INFINITY;
  for (let step = 0; step < samples; step += 1) {
    narrowest = Math.min(
      narrowest,
      getClearSpanAt(field, travel.min + (step + HALF) * SAMPLE_STEP, along, band),
    );
  }
  return narrowest;
}

/**
 * Whether a rigid rectangle can be turned 180° inside a landing.
 *
 * **This is a SUFFICIENT condition, not a simulation.** Nothing here rotates
 * anything: no rigid-body sweep is performed and no intermediate angle is
 * tested. Two tests have to pass, and an item passing both can certainly be
 * turned:
 *
 * 1. it fits the landing in BOTH orientations — so there is somewhere to start
 *    and somewhere to finish;
 * 2. its diagonal fits the landing's longer side — so the longest reach it has
 *    at any angle of the turn is contained.
 *
 * Test 2 is what makes the pair sufficient and is also what makes the answer
 * conservative: an item that fails it may still be walked round a corner in a
 * real building, by shuffling it rather than by pivoting it about a point. So a
 * `false` here means "this module will not vouch for it", not "it is
 * impossible", and a `true` is the only half of the answer worth acting on.
 *
 * @param item - The appliance's footprint, longer side first.
 * @param landing - The floor available to turn on.
 * @returns `true` when the item fits either way round AND its diagonal clears
 *   the landing's longer side.
 */
export function canTurn(item: ApplianceFootprint, landing: PlanRect): boolean {
  const acrossX = rectWidth(landing);
  const acrossZ = rectDepth(landing);
  const shorterSide = Math.min(acrossX, acrossZ);
  const longerSide = Math.max(acrossX, acrossZ);
  const fitsEitherWayRound = Math.max(item.width, item.depth) <= shorterSide + LENGTH_TOLERANCE;
  const diagonalClears = Math.hypot(item.width, item.depth) <= longerSide + LENGTH_TOLERANCE;
  return fitsEitherWayRound && diagonalClears;
}
