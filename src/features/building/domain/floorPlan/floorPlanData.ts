/**
 * The plan data of the typical floor: plot, interior, every space and the join
 * overrides.
 *
 * Every rect is a clear (inner) rectangle in plan coordinates (see
 * `types.ts`), taken from the brief §4–§5. The whole structure is deeply
 * frozen. It is not validated at module load; tests run `validateFloorPlan`
 * on it.
 */
import { insetRect, makeRect } from '../planGeometry.ts';
import type { PlanRect } from '../planGeometry.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import type { FloorPlan, JoinOverride, Space, SpaceId, SpaceKind } from './types.ts';

/** Thickness of a join with no wall at all, in metres. */
const NO_WALL = 0;

/** Clear rect coordinates as `[minX, maxX, minZ, maxZ]`, in metres. */
type RectCoordinates = readonly [minX: number, maxX: number, minZ: number, maxZ: number];

/**
 * Builds a frozen space whose rects are frozen through `makeRect`.
 *
 * @param id - Identifier of the space.
 * @param name - Human-readable name.
 * @param kind - Kind of the space.
 * @param rects - Clear rect coordinates, in order.
 * @returns A deeply frozen {@link Space}.
 */
function defineSpace(
  id: SpaceId,
  name: string,
  kind: SpaceKind,
  rects: readonly RectCoordinates[],
): Space {
  const frozenRects: readonly PlanRect[] = Object.freeze(
    rects.map(([minX, maxX, minZ, maxZ]) => makeRect(minX, maxX, minZ, maxZ)),
  );
  return Object.freeze({ id, name, kind, rects: frozenRects });
}

/**
 * Builds a frozen join override with a frozen space pair.
 *
 * @param first - First space of the join.
 * @param second - Second space of the join.
 * @param thickness - Wall thickness of the join, in metres.
 * @param reason - Why the default thickness does not apply.
 * @returns A deeply frozen {@link JoinOverride}.
 */
function defineJoinOverride(
  first: SpaceId,
  second: SpaceId,
  thickness: number,
  reason: string,
): JoinOverride {
  const spaces: readonly [SpaceId, SpaceId] = Object.freeze([first, second] as const);
  return Object.freeze({ spaces, thickness, reason });
}

/** Outer boundary of the floor: the 22.50 × 10.00 m plot (brief §1, §8). Frozen. */
export const PLOT_RECT: PlanRect = makeRect(0, 22.5, 0, 10);

/**
 * Clear interior of the floor: the plot inset by the 0.30 m exterior walls,
 * x 0.30–22.20 and z 0.30–9.70 (brief §2). Frozen.
 */
export const INTERIOR_RECT: PlanRect = insetRect(PLOT_RECT, WALL_SPEC.exterior);

/** The spaces of the floor, in `SPACE_IDS` order. */
const SPACES: readonly Space[] = Object.freeze([
  // Brief §5.1: side-A balcony, full A depth.
  defineSpace('balconyA', 'Side-A balcony', 'openAir', [[0.3, 1.3, 0.3, 9.7]]),
  // Brief §4.1: top row (C side), four equal 5.00 × 3.40 rooms.
  defineSpace('masterBedroom', 'Master bedroom', 'room', [[1.6, 6.6, 0.3, 3.7]]),
  defineSpace('livingRoom', 'Living room', 'room', [[6.8, 11.8, 0.3, 3.7]]),
  defineSpace('bedroomMaleKids', 'Bedroom — male kids', 'room', [[12.0, 17.0, 0.3, 3.7]]),
  defineSpace('bedroomFemaleKids', 'Bedroom — female kids', 'room', [[17.2, 22.2, 0.3, 3.7]]),
  // Brief §4.2: circulation; stairs continuous with the corridor.
  defineSpace('stairs', 'Stairs', 'circulation', [[1.6, 5.3, 3.9, 5.4]]),
  defineSpace('corridor', 'Corridor', 'circulation', [[5.3, 20.2, 3.9, 5.4]]),
  defineSpace('linkCorridor', 'Link corridor', 'circulation', [[1.6, 7.0, 5.6, 6.5]]),
  // Brief §4.3: service row (B side).
  defineSpace('controlCenter', 'Control center', 'room', [[1.6, 3.8, 6.7, 8.4]]),
  // Brief §4.3: the net L, i.e. the gross L minus the guest-sanitair block
  // x 8.00–9.80 z 6.90–8.40. Three rects: [0] x 4.00–8.00 z 6.70–8.40, the south
  // arm west of the sanitair block; [1] x 7.20–8.00 z 5.60–6.70, the east-arm
  // strip west of x 8.00; [2] x 8.00–9.80 z 5.60–6.90, the east arm east of
  // x 8.00, down to the sanitair's north wall. The link-corridor notch
  // (x 4.00–7.20 z 5.60–6.70) is not part of the room.
  defineSpace('guestRoom', 'Guest room', 'room', [
    [4.0, 8.0, 6.7, 8.4],
    [7.2, 8.0, 5.6, 6.7],
    [8.0, 9.8, 5.6, 6.9],
  ]),
  defineSpace('guestSanitair', 'Guest sanitair', 'room', [[8.2, 9.8, 7.1, 8.4]]),
  defineSpace('kitchen', 'Kitchen', 'room', [[10.0, 14.0, 5.6, 8.4]]),
  defineSpace('laundry', 'Laundry', 'room', [[14.2, 17.4, 5.6, 8.4]]),
  defineSpace('mainSanitair', 'Main sanitair', 'room', [[17.6, 20.2, 5.6, 8.4]]),
  // Brief §4.3: utility room on side D, full depth from the corridor to side B.
  defineSpace('utilityRoom', 'Utility room', 'room', [[20.4, 22.2, 3.9, 9.7]]),
  // Brief §5.2: side-B strip, the walkable slab and the two void parts.
  defineSpace('balconySlabB', 'Side-B balcony slab', 'openAir', [[12.7, 16.2, 8.7, 9.7]]),
  defineSpace('voidWest', 'Void (west)', 'void', [[1.6, 12.7, 8.7, 9.7]]),
  defineSpace('voidEast', 'Void (east)', 'void', [[16.2, 20.2, 8.7, 9.7]]),
]);

/** Joins whose wall thickness deviates from the kind-based default. */
const JOIN_OVERRIDES: readonly JoinOverride[] = Object.freeze([
  defineJoinOverride(
    'stairs',
    'corridor',
    NO_WALL,
    'Stairs are continuous with the corridor, no wall (brief §4.2).',
  ),
  defineJoinOverride(
    'voidWest',
    'balconySlabB',
    NO_WALL,
    'The west void and the balcony slab are the same open-air strip, no wall (brief §5.2).',
  ),
  defineJoinOverride(
    'voidEast',
    'balconySlabB',
    NO_WALL,
    'The east void and the balcony slab are the same open-air strip, no wall (brief §5.2).',
  ),
  defineJoinOverride(
    'voidEast',
    'utilityRoom',
    WALL_SPEC.partition,
    'Owner kept the drawn 0.20 wall; exception to the void-facing rule (ADR-006).',
  ),
]);

/**
 * The complete plan of the typical floor. Deeply frozen: the plan, its spaces
 * array, every space, every rects array and rect, the overrides array, every
 * override and its `spaces` pair.
 */
export const FLOOR_PLAN: FloorPlan = Object.freeze({
  plot: PLOT_RECT,
  interior: INTERIOR_RECT,
  spaces: SPACES,
  joinOverrides: JOIN_OVERRIDES,
});
