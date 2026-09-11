/**
 * The door schedule of the typical floor: every port between two spaces.
 *
 * The schedule comes from brief §6 (access graph / door schedule) as amended by
 * ADR-006 and the owner answers of 2026-09-11. Doors are {@link DOOR_WIDTH}
 * wide unless an exception says otherwise, and each port is placed in the wall
 * between its two spaces by the span its width covers along
 * {@link Port.along}.
 *
 * Two rules of the schedule are worth naming here:
 * - the living room opens onto the corridor through a {@link LIVING_OPENING_WIDTH}
 *   opening with no leaf (brief §4.1), the only `opening` of the floor;
 * - there is deliberately **no side-A exterior door**: the floor is entered
 *   through the stairs, so ADR-006 overrides the brief §6 line
 *   "Side A (exterior) → A balcony".
 *
 * The whole structure is deeply frozen. It is not validated at module load;
 * tests run `validatePorts` on it.
 */
import type { SpaceId } from '../floorPlan/index.ts';
import type { Port, PortAxis, PortKind } from './types.ts';

/** Clear width of a default door leaf, in metres (brief §6). */
const DOOR_WIDTH = 0.9;

/**
 * Clear width of the door from the side-A balcony into the link corridor, in
 * metres: narrower than {@link DOOR_WIDTH} because the link corridor is only
 * 0.90 m wide (ADR-006).
 */
const LINK_DOOR_WIDTH = 0.8;

/**
 * Clear width of the living-room opening onto the corridor, in metres
 * (brief §4.1).
 */
const LIVING_OPENING_WIDTH = 3.5;

/** Why the balcony-A to link-corridor door is narrower than a default door. */
const LINK_DOOR_EXCEPTION =
  'A 0.90 m leaf would leave no jamb in the 0.90 m wide link corridor, so this door is 0.80 m (ADR-006).';

/** Why the master-bedroom door sits 0.02 m west of the drawn position. */
const MASTER_DOOR_EXCEPTION =
  'Moved 0.02 m west of the drawn x 5.67 m to keep a 0.05 m jamb against the master-bedroom east wall (owner answer 2026-09-11).';

/** Why the guest-room to kitchen door sits 0.15 m north of the drawn position. */
const GUEST_KITCHEN_EXCEPTION =
  'Moved 0.15 m north of the drawn z 6.15–7.05: the guest-room east arm ends at z 6.90, so the drawn span ran past the wall (ADR-006).';

/** Why the guest-sanitair door sits 0.05 m south of the drawn position. */
const GUEST_SANITAIR_EXCEPTION =
  'Moved 0.05 m south of the drawn z 7.05–7.95, which cut the guest-sanitair north wall (owner answer 2026-09-11).';

/**
 * Builds a frozen port with a frozen space pair.
 *
 * @param first - First space of the port, in schedule order.
 * @param second - Second space of the port; a port is undirected.
 * @param kind - Whether the passage has a leaf or is an open interruption.
 * @param along - Plan axis the width runs along.
 * @param spanMin - Start of the port along `along`, in metres.
 * @param width - Clear width of the passage, in metres.
 * @param exception - Why the port deviates from the brief §6 default; omitted
 *   when it follows the default.
 * @returns A deeply frozen {@link Port}.
 */
function definePort(
  first: SpaceId,
  second: SpaceId,
  kind: PortKind,
  along: PortAxis,
  spanMin: number,
  width: number,
  exception?: string,
): Port {
  const spaces: readonly [SpaceId, SpaceId] = Object.freeze([first, second] as const);
  return Object.freeze({
    spaces,
    kind,
    along,
    spanMin,
    width,
    ...(exception === undefined ? {} : { exception }),
  });
}

/**
 * Every port of the typical floor, in the order the brief §6 schedule walks the
 * plan: side A first, then the top row onto the corridor, the corridor doors,
 * the link corridor and the service row, and finally the side-B balcony slab.
 *
 * Deeply frozen: the array, every port and every `spaces` pair.
 */
export const PORT_SCHEDULE: readonly Port[] = Object.freeze([
  // Side A: the balcony serves the master bedroom and the link corridor.
  definePort('balconyA', 'masterBedroom', 'door', 'z', 1.85, DOOR_WIDTH),
  // Top row (C side) onto the corridor.
  definePort('masterBedroom', 'corridor', 'door', 'x', 5.65, DOOR_WIDTH, MASTER_DOOR_EXCEPTION),
  definePort('livingRoom', 'corridor', 'opening', 'x', 7.5, LIVING_OPENING_WIDTH),
  definePort('bedroomMaleKids', 'corridor', 'door', 'x', 14.05, DOOR_WIDTH),
  definePort('bedroomFemaleKids', 'corridor', 'door', 'x', 18.55, DOOR_WIDTH),
  definePort('corridor', 'utilityRoom', 'door', 'z', 4.2, DOOR_WIDTH),
  // Circulation: the stairs and the corridor onto the link corridor.
  definePort('stairs', 'linkCorridor', 'door', 'x', 4.0, DOOR_WIDTH),
  definePort('corridor', 'linkCorridor', 'door', 'x', 5.67, DOOR_WIDTH),
  // Corridor doors into the service row (B side).
  definePort('corridor', 'kitchen', 'door', 'x', 11.55, DOOR_WIDTH),
  definePort('corridor', 'mainSanitair', 'door', 'x', 18.45, DOOR_WIDTH),
  definePort('balconyA', 'linkCorridor', 'door', 'z', 5.65, LINK_DOOR_WIDTH, LINK_DOOR_EXCEPTION),
  // Service row, room to room.
  definePort('guestRoom', 'kitchen', 'door', 'z', 6.0, DOOR_WIDTH, GUEST_KITCHEN_EXCEPTION),
  definePort('kitchen', 'laundry', 'door', 'z', 6.15, DOOR_WIDTH),
  definePort('laundry', 'mainSanitair', 'door', 'z', 6.15, DOOR_WIDTH),
  // Link corridor into the control center and the guest room.
  definePort('linkCorridor', 'controlCenter', 'door', 'x', 2.3, DOOR_WIDTH),
  definePort('linkCorridor', 'guestRoom', 'door', 'x', 4.4, DOOR_WIDTH),
  definePort('guestRoom', 'guestSanitair', 'door', 'z', 7.1, DOOR_WIDTH, GUEST_SANITAIR_EXCEPTION),
  // Side B: the walkable balcony slab.
  definePort('kitchen', 'balconySlabB', 'door', 'x', 12.7, DOOR_WIDTH),
  definePort('laundry', 'balconySlabB', 'door', 'x', 15.3, DOOR_WIDTH),
]);
