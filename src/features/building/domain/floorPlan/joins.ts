/**
 * Wall thickness of the join between two spaces of a floor plan.
 *
 * MEASURED, not inferred. The owner's plan draws every wall at its real width,
 * so the gap two spaces leave between their clear rects IS the wall between
 * them, and this module reads that gap rather than guessing a thickness from the
 * two kinds. Guessing is what it used to do, and it was wrong for every wall on
 * the owner's isolation list: isolation on this floor is a WIDTH, not a material
 * — "widther 30cm, widthless 15cm" — so a named wall is simply drawn 0.30 where
 * a plain separator is drawn 0.15, and measuring reports it with no list to
 * consult. That is why there is no isolation branch here and no second copy of
 * `INSULATED_WALLS`: a second copy of the owner's list is the drift this module
 * would exist to cause.
 *
 * The precedence is `walls.ts`'s, to the letter (`contactsAlong`): a stated
 * override wins, else the measured gap, else the kind rule. The two modules
 * therefore cannot disagree about a wall, which they did for fourteen of them.
 */
import { LENGTH_TOLERANCE } from '../planGeometry.ts';
import { WALL_SPEC } from '../wallSpec.ts';
import { getNeighbours } from './queries.ts';
import type { FloorPlan, Space, SpaceId, SpaceKind } from './types.ts';

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
 * Returns every thickness the plan actually draws between two spaces.
 *
 * One entry per facing pair of rects, read through `getNeighbours` so that the
 * measurement is the one the rest of the model already uses. Contacts with no
 * gap at all are dropped: two rects that touch leave no wall to measure, and
 * that is the one case the kind rule is still needed for.
 *
 * @param plan - The floor plan holding the geometry.
 * @param id - Identifier of one space of the join.
 * @param neighbourId - Identifier of the other.
 * @returns The drawn thicknesses, in metres, empty when the two do not join or
 *   join with no wall between them.
 * @throws RangeError naming the id when the plan holds no such space.
 */
function drawnThicknesses(plan: FloorPlan, id: SpaceId, neighbourId: SpaceId): readonly number[] {
  return getNeighbours(plan, id)
    .filter((contact) => contact.neighbourId === neighbourId && contact.gap > LENGTH_TOLERANCE)
    .map((contact) => contact.gap);
}

/**
 * Returns the thickness of the wall between two spaces.
 *
 * The rule, which is `walls.ts`'s rule:
 * - an entry of `plan.joinOverrides` whose `spaces` pair is {a.id, b.id}, in
 *   either order, wins and gives its `thickness`; it states a width the geometry
 *   would not predict, a zero-thickness join among them;
 * - otherwise the gap the two spaces' rects leave IS the thickness, read off the
 *   plan. A wall the owner named for sound and heat is drawn `WALL_SPEC.insulated`
 *   (0.30) and comes back as 0.30 for that reason alone;
 * - otherwise — the rects touch, or nothing joins them — it is the kind rule:
 *   `WALL_SPEC.voidFacing` (0.30) when either space is `'openAir'` or `'void'`,
 *   since that face is exposed to the weather, and `WALL_SPEC.partition` (0.15)
 *   between two indoor spaces.
 *
 * ONE NUMBER FOR A JOIN THAT VARIES. A join is not always one thickness: the
 * control center meets the guest room across 0.15 under the room's north strip
 * and across 0.30 on its east wall, and both are right. This function answers
 * with the THICKEST, which is the owner's junction rule — "in thick wall when X
 * wall meet Y wall and both this the XY point is RED thick win" — and is the
 * same summary `DerivedWall.thickness` gives a face. Like that one it is for
 * quantities and takeoff, never for drawing: to draw a face, walk the
 * `contacts` of `walls.ts`, which carry a thickness per stretch.
 *
 * Only a gap up to the thickest wall of `WALL_SPEC` is read as a join
 * (`getNeighbours`), so a wider one has to be stated as an override.
 *
 * The envelope of the floor (sides A, B, C and D) uses `WALL_SPEC.exterior`;
 * it separates a space from the outside, not from another space, so it is not
 * a join and is not handled here.
 *
 * @param plan - The floor plan: its overrides, and the geometry that is measured.
 * @param a - One space of the join; it names the space, and the plan supplies
 *   the rects the join is measured between.
 * @param b - The other space of the join; the argument order does not matter.
 * @returns The wall thickness between the two spaces, in metres.
 * @throws RangeError naming the id when `a` and `b` have the same id, or when
 *   the plan holds no space with one of their ids.
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
  const drawn = drawnThicknesses(plan, a.id, b.id);
  if (drawn.length > 0) {
    return Math.max(...drawn);
  }
  return isWeatherExposed(a.kind) || isWeatherExposed(b.kind)
    ? WALL_SPEC.voidFacing
    : WALL_SPEC.partition;
}
