/**
 * Wall thickness of the join between two spaces of a floor plan.
 */
import { WALL_SPEC } from '../wallSpec.ts';
import type { FloorPlan, Space, SpaceKind } from './types.ts';

/**
 * Tells whether a kind of space exposes the wall facing it to the weather.
 *
 * @param kind - The kind of space.
 * @returns `true` for `'openAir'` and `'void'`.
 */
function isWeatherExposed(kind: SpaceKind): boolean {
  return kind === 'openAir' || kind === 'void';
}

/**
 * Returns the thickness of the wall between two spaces.
 *
 * Rule (brief §2):
 * - an entry of `plan.joinOverrides` whose `spaces` pair is {a.id, b.id}, in
 *   either order, wins and gives its `thickness`;
 * - otherwise the wall is `WALL_SPEC.voidFacing` (0.30 m) when either space is
 *   `'openAir'` or `'void'`, since that face is exposed to the weather;
 * - otherwise it is an interior partition, `WALL_SPEC.partition` (0.20 m).
 *
 * The envelope of the floor (sides A, B, C and D) uses `WALL_SPEC.exterior`;
 * it separates a space from the outside, not from another space, so it is not
 * a join and is not handled here.
 *
 * @param plan - The floor plan holding the join overrides.
 * @param a - One space of the join.
 * @param b - The other space of the join; the argument order does not matter.
 * @returns The wall thickness between the two spaces, in metres.
 * @throws RangeError naming the id when `a` and `b` have the same id.
 */
export function getJoinThickness(plan: FloorPlan, a: Space, b: Space): number {
  if (a.id === b.id) {
    throw new RangeError(`a join needs two different spaces, got "${a.id}" twice`);
  }
  const override = plan.joinOverrides.find(
    ({ spaces: [first, second] }) =>
      (first === a.id && second === b.id) || (first === b.id && second === a.id),
  );
  if (override !== undefined) {
    return override.thickness;
  }
  return isWeatherExposed(a.kind) || isWeatherExposed(b.kind)
    ? WALL_SPEC.voidFacing
    : WALL_SPEC.partition;
}
