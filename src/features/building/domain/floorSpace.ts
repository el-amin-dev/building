/**
 * The identity of a room in a stacked building: which storey, and which room of
 * the typical floor.
 *
 * Once the building has more than one storey, a {@link SpaceId} stops naming a
 * place: `kitchen` is a room on every floor. A {@link FloorSpaceRef} pairs the
 * storey with the plan's space id, and the plan stays one plan — the storeys
 * repeat it rather than each holding a copy.
 *
 * The pair is a struct and not a string on purpose. `SpaceId` is a literal
 * union of the 22 ids of `SPACE_IDS`, and that union is its whole value: an
 * exhaustive `switch` over it is checked at compile time (`getSlabMaterialKey`
 * is one), `SPACE_IDS` gives the ids a stable order, and a typo is a type error
 * rather than a miss at runtime. A branded `'F2/kitchen'` would throw all of
 * that away at the first consumer and hand every later one a parse — and a
 * parse that can fail is a new error path inside the domain, for information
 * the caller already had in its hands.
 *
 * {@link getFloorSpaceKey} is therefore a key and not a label: React keys and
 * `Map` keys only, never shown to anyone. The display form is a separate thing
 * and lives elsewhere, with `getSpaceLabel` of `floorPlan/queries.ts` — the one
 * label formatter of the model, which grows the storey prefix of
 * `F2-R11/KIT · Kitchen` there rather than here. Nothing formats a label out of
 * this key.
 */
import type { SpaceId } from './floorPlan/types.ts';

/** A room on a storey: the identity of a place in a stacked building. */
export interface FloorSpaceRef {
  /** Storey the room is on, 1…N. Floor 0 is not designed (ADR-006). */
  readonly floor: number;
  /** Which room of the typical floor it is; the plan is one plan. */
  readonly spaceId: SpaceId;
}

/**
 * Lowest storey the building has: the ground floor of the design is floor 1,
 * because no floor 0 was ever drawn (ADR-006).
 */
export const LOWEST_FLOOR = 1;

/** Separates the storey from the space id in a {@link getFloorSpaceKey} key. */
export const FLOOR_SPACE_KEY_SEPARATOR = '/';

/** Marks the storey number in a {@link getFloorSpaceKey} key: `F2/kitchen`. */
const FLOOR_KEY_PREFIX = 'F';

/**
 * Builds the identity of one room on one storey.
 *
 * @param floor - Storey the room is on, an integer of at least
 *   {@link LOWEST_FLOOR}.
 * @param spaceId - Which room of the typical floor it is.
 * @returns A frozen {@link FloorSpaceRef}.
 * @throws RangeError naming the floor when it is not an integer of at least
 *   {@link LOWEST_FLOOR} — which rejects `0`, a negative storey, `1.5` and
 *   `NaN` alike.
 */
export function makeFloorSpaceRef(floor: number, spaceId: SpaceId): FloorSpaceRef {
  if (!Number.isInteger(floor) || floor < LOWEST_FLOOR) {
    throw new RangeError(
      `floor must be an integer of at least ${String(LOWEST_FLOOR)}, got ${String(floor)}`,
    );
  }
  return Object.freeze({ floor, spaceId });
}

/**
 * Compares two room identities by value.
 *
 * The call site is a store asking "did the room change?", so both sides may be
 * absent: `undefined` means the viewer is in no room at all. Two absences are
 * therefore equal — nowhere stayed nowhere, and treating that as a change would
 * fire an entry event every frame the viewer spends outside the building.
 *
 * @param a - First identity, or `undefined` for no room.
 * @param b - Second identity, or `undefined` for no room.
 * @returns `true` when both are absent, or when both name the same room on the
 *   same storey; refs that are equal by value need not be the same object.
 */
export function isSameFloorSpace(
  a: FloorSpaceRef | undefined,
  b: FloorSpaceRef | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.floor === b.floor && a.spaceId === b.spaceId;
}

/**
 * Formats a room identity as a key.
 *
 * For React keys and `Map` keys only: it is never shown to anyone, and a label
 * is not formatted from it. See the module docblock.
 *
 * @param ref - The room identity to key.
 * @returns e.g. `F2/kitchen`; distinct for every distinct identity.
 */
export function getFloorSpaceKey(ref: FloorSpaceRef): string {
  return `${FLOOR_KEY_PREFIX}${String(ref.floor)}${FLOOR_SPACE_KEY_SEPARATOR}${ref.spaceId}`;
}
