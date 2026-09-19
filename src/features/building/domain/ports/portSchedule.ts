/**
 * The door schedule of the typical floor: every port between two spaces.
 *
 * DERIVED, never hand-written. Every port comes from `PORTS` of the source of
 * truth, `../sourceOfTruth/plan.ts`, which is the single copy of the geometry.
 * This file used to hand-write the schedule beside that plan, and the two
 * drifted exactly as a second copy always does: five of its nineteen ports still
 * opened onto `linkCorridor`, a space the owner had deleted. The mapping below
 * is the whole of what this module does — rename `between` to `spaces` and carry
 * the rest across untouched — so there is nothing left to keep in sync.
 *
 * What the new plan changed, beyond the coordinates:
 *
 * - **There is no link corridor.** The guest room's north strip replaced it and
 *   reaches the side-A balcony directly, so the old rules "guest and control
 *   centre via the link corridor" and "the 0.80 m link door" are void. The
 *   control centre is entered through the guest room; the stairs open onto the
 *   guest room's strip, not onto a corridor of their own.
 * - **A bath and a shower are rooms.** A bathroom is an open part with the basin
 *   plus a walled cubicle for each of the things it has, each with its own door,
 *   so the three cubicles carry ports like every other room on the floor. Three
 *   and not four: the family suite has both a bath and a shower, the guest suite
 *   only a bath, its shower having been dropped on 2026-09-19.
 * - **Four leaves slide** (`swing: 'slide'`), because the room they serve is
 *   shallower than the leaf is wide.
 * - **Widths are no longer three values.** See `Port.width`.
 *
 * The schedule holds 19 ports: 18 doors and the single living-room opening. The
 * whole structure is deeply frozen. It is not validated at module load; tests
 * run `validatePorts` on it.
 */
import type { SpaceId } from '../floorPlan/index.ts';
import { PORTS } from '../sourceOfTruth/plan.ts';
import type { PlanPort } from '../sourceOfTruth/plan.ts';
import type { Port } from './types.ts';

/**
 * Builds a frozen port from one declared port of the source of truth.
 *
 * The optional fields are spread in only when the plan states them, so a port
 * that has no reason and no swing carries no key for them at all — `'why' in
 * port` stays a true answer to "did the owner say why?".
 *
 * @param planPort - One entry of `PORTS`, in plan order.
 * @returns A deeply frozen {@link Port} with a frozen space pair.
 */
function definePort(planPort: PlanPort): Port {
  const [first, second] = planPort.between;
  const spaces: readonly [SpaceId, SpaceId] = Object.freeze([first, second] as const);
  return Object.freeze({
    spaces,
    kind: planPort.kind,
    along: planPort.along,
    spanMin: planPort.spanMin,
    width: planPort.width,
    ...(planPort.swing === undefined ? {} : { swing: planPort.swing }),
    ...(planPort.why === undefined ? {} : { why: planPort.why }),
  });
}

/**
 * Every port of the typical floor, in the order the source of truth declares
 * them: the side-A balcony and the top row onto the corridor first, then the
 * corridor doors, the guest suite and the service row, and finally the side-B
 * balcony slab.
 *
 * Deeply frozen: the array, every port and every `spaces` pair.
 */
export const PORT_SCHEDULE: readonly Port[] = Object.freeze(PORTS.map(definePort));
