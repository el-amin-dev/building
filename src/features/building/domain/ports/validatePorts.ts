/**
 * Structural validation of a port schedule against a {@link FloorPlan}.
 *
 * Validation is pure: it reads the plan and the schedule and either returns the
 * schedule unchanged or throws a `RangeError` naming the offending port index
 * and its space pair.
 *
 * What this module is for: the schedule is derived from the source of truth, so
 * the numbers are the owner's — but "the owner drew it" is not the same as "it
 * can be built". These checks are the ones that catch a door drawn across a
 * corner, past the end of its wall, onto a space with no floor, or in a wall
 * that is not one thickness where the door sits.
 */
import { getSpace, hasFloor } from '../floorPlan/index.ts';
import type { FloorPlan, SpaceId } from '../floorPlan/index.ts';
import { LENGTH_TOLERANCE, isOnPlanGrid } from '../planGeometry.ts';
import { getPortContact, getPortSpan, getPortThicknesses } from './queries.ts';
import type { Port, PortAxis, PortKind, PortSwing } from './types.ts';

/**
 * Every port kind, for the runtime check of `Port.kind`. Mirrors the
 * {@link PortKind} union, which `types.ts` does not publish as a value.
 */
const PORT_KINDS: readonly PortKind[] = Object.freeze(['door', 'opening']);

/**
 * Every port axis, for the runtime check of `Port.along`. Mirrors the
 * {@link PortAxis} union, which `types.ts` does not publish as a value.
 */
const PORT_AXES: readonly PortAxis[] = Object.freeze(['x', 'z']);

/**
 * Every way a leaf may open other than swinging, for the runtime check of
 * `Port.swing`. Mirrors the {@link PortSwing} union, which `types.ts` does not
 * publish as a value. `undefined` is accepted separately: it is the normal case,
 * a leaf that swings.
 */
const PORT_SWINGS: readonly PortSwing[] = Object.freeze(['slide']);

/** The number of distinct wall thicknesses a port may cross: exactly one. */
const ONE_THICKNESS = 1;

/** Separator between the two ids of an unordered port pair key. */
const PAIR_KEY_SEPARATOR = '|';

/**
 * Formats a port for an error message.
 *
 * @param port - The port to name.
 * @param index - Index of the port in the schedule.
 * @returns A label such as `ports[3] ("corridor" ↔ "kitchen")`.
 */
function formatPort(port: Port, index: number): string {
  const [first, second] = port.spaces;
  return `ports[${String(index)}] ("${first}" ↔ "${second}")`;
}

/**
 * Builds the order-independent key of a port's space pair.
 *
 * @param port - The port whose pair to key.
 * @returns The two ids sorted and joined, so that both orders give one key.
 */
function pairKey(port: Port): string {
  const [first, second] = port.spaces;
  return first < second
    ? `${first}${PAIR_KEY_SEPARATOR}${second}`
    : `${second}${PAIR_KEY_SEPARATOR}${first}`;
}

/**
 * Checks that a port names two distinct spaces that both exist in the plan.
 *
 * @param plan - The plan holding the spaces.
 * @param port - The port to check.
 * @param label - Label of the port for error messages.
 * @throws RangeError naming the port and the offending id.
 */
function checkSpaces(plan: FloorPlan, port: Port, label: string): void {
  const knownIds = new Set<SpaceId>(plan.spaces.map((space) => space.id));
  for (const id of port.spaces) {
    if (!knownIds.has(id)) {
      throw new RangeError(`${label} references space "${id}", which is not in the plan`);
    }
  }
  const [first, second] = port.spaces;
  if (first === second) {
    throw new RangeError(`${label} must connect two distinct spaces`);
  }
}

/**
 * Checks that a port's kind, axis and swing are known values.
 *
 * `swing` is optional and open by design: absent means the leaf swings, which is
 * how every port behaved before sliding leaves existed, so the check accepts
 * `undefined` and otherwise insists on a value the model knows.
 *
 * @param port - The port to check.
 * @param label - Label of the port for error messages.
 * @throws RangeError naming the port and the offending value.
 */
function checkEnums(port: Port, label: string): void {
  if (!PORT_KINDS.includes(port.kind)) {
    throw new RangeError(
      `${label} kind must be one of ${PORT_KINDS.join(', ')}, got "${String(port.kind)}"`,
    );
  }
  if (!PORT_AXES.includes(port.along)) {
    throw new RangeError(
      `${label} along must be one of ${PORT_AXES.join(', ')}, got "${String(port.along)}"`,
    );
  }
  if (port.swing !== undefined && !PORT_SWINGS.includes(port.swing)) {
    throw new RangeError(
      `${label} swing must be absent (a swinging leaf) or one of ${PORT_SWINGS.join(', ')}, got "${String(port.swing)}"`,
    );
  }
}

/**
 * Checks that a port's width and start lie on the centimetre plan grid, with a
 * width greater than zero.
 *
 * Deliberately no check against a list of allowed widths. The floor uses six,
 * from 0.60 to 3.50, and each one is a consequence of the room it serves rather
 * than a choice from a set — a rule naming the permitted widths would have to be
 * rewritten every time the owner moves a wall.
 *
 * @param port - The port to check.
 * @param label - Label of the port for error messages.
 * @throws RangeError naming the port and the offending value.
 */
function checkSpanNumbers(port: Port, label: string): void {
  if (!isOnPlanGrid(port.width) || port.width <= 0) {
    throw new RangeError(
      `${label} width must be a finite number > 0 on the centimetre grid, got ${String(port.width)}`,
    );
  }
  if (!isOnPlanGrid(port.spanMin)) {
    throw new RangeError(
      `${label} spanMin must be a finite number on the centimetre grid, got ${String(port.spanMin)}`,
    );
  }
}

/**
 * Checks that both spaces of a port have a floor to walk on.
 *
 * A `void` space is open to the sky, so nothing can open onto it (brief §5.2).
 *
 * @param plan - The plan holding the spaces.
 * @param port - The port to check.
 * @param label - Label of the port for error messages.
 * @throws RangeError naming the port and the void space.
 */
function checkFloors(plan: FloorPlan, port: Port, label: string): void {
  for (const id of port.spaces) {
    const space = getSpace(plan, id);
    if (!hasFloor(space.kind)) {
      throw new RangeError(`${label} opens onto "${id}", which is a "${space.kind}" with no floor`);
    }
  }
}

/**
 * Checks that a port sits in exactly one wall contact, that the contact has a
 * wall to cut, and that the wall is one thickness across the whole port.
 *
 * The single-contact rule of `getPortContact` also enforces that the port span
 * fits inside the contact span, so no separate fit check is needed here.
 *
 * The thickness rule is the one that is new with this plan. A wall face is no
 * longer one number along its length: isolation is built as width, so a face is
 * commonly 0.30 where it backs onto a weather-exposed or isolated space and 0.15
 * where it backs onto an ordinary one (`scripts/source-of-truth/walls.mjs` tiles
 * a face with a `contacts` list for exactly this reason). A port's opening depth,
 * on the other hand, is a single number: `getPortOpening` cuts the hole from one
 * rect face to the facing one. Those two facts only agree while a port stays
 * inside one thickness, so that is checked rather than assumed — otherwise a door
 * drawn across a step in the wall would be punched at one depth and leave the
 * rest of its hole filled in, silently.
 *
 * @param plan - The plan holding the spaces.
 * @param port - The port to check.
 * @param label - Label of the port for error messages.
 * @throws RangeError naming the port, with the contact failure as its cause.
 */
function checkContact(plan: FloorPlan, port: Port, label: string): void {
  const [spanMin, spanMax] = getPortSpan(port);
  let gap: number;
  try {
    gap = getPortContact(plan, port).gap;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new RangeError(
      `${label} must sit in exactly one wall contact along ${port.along}, spanning ${String(spanMin)}–${String(spanMax)}: ${detail}`,
      { cause },
    );
  }
  if (gap <= LENGTH_TOLERANCE) {
    throw new RangeError(
      `${label} has no wall to cut: the two spaces join with a gap of ${String(gap)} m`,
    );
  }
  const thicknesses = getPortThicknesses(plan, port);
  if (thicknesses.length > ONE_THICKNESS) {
    throw new RangeError(
      `${label} crosses a change of wall thickness: the wall is ${thicknesses.map(String).join(' m and ')} m thick across the port, so its opening has no single depth`,
    );
  }
}

/**
 * Validates a port schedule against a floor plan.
 *
 * Checks every port, in schedule order, and within a port in this order:
 * 1. both spaces exist in the plan and are distinct;
 * 2. `kind` and `along` are known values, and `swing` is absent or known;
 * 3. `width` is greater than zero and on the centimetre grid, and `spanMin` is
 *    on the grid;
 * 4. neither space is a `void`, which has no floor to open onto;
 * 5. the port sits in exactly one wall contact whose span contains it (see
 *    `getPortContact`), that contact has a non-zero gap, i.e. a wall to cut, and
 *    the wall is one thickness across the whole port;
 * 6. no unordered pair of spaces appears twice in the schedule. Two ports
 *    between the same pair are always an error: the floor has none.
 *
 * What this deliberately does NOT check is whether a leaf has floor to swing
 * into. That needs the fixtures, which live in the source of truth and not in
 * this model, and it is checked where they are — `scripts/source-of-truth/
 * verify.mjs` step 9, which exempts every sliding leaf by name rather than
 * skipping it quietly. `needsSwingClearance` in `queries.ts` is the one place
 * that exemption is decided, so a future check here can reuse it instead of
 * inventing a second answer.
 *
 * @param plan - The plan the ports are placed in.
 * @param ports - The schedule to validate.
 * @returns The same `ports` reference, unchanged, when every check passes.
 * @throws RangeError naming the port index and its space pair for the first
 *   failing check.
 */
export function validatePorts(plan: FloorPlan, ports: readonly Port[]): readonly Port[] {
  const seenPairs = new Set<string>();
  ports.forEach((port, index) => {
    const label = formatPort(port, index);
    checkSpaces(plan, port, label);
    checkEnums(port, label);
    checkSpanNumbers(port, label);
    checkFloors(plan, port, label);
    checkContact(plan, port, label);
    const key = pairKey(port);
    if (seenPairs.has(key)) {
      throw new RangeError(`${label} repeats a pair that the schedule already connects`);
    }
    seenPairs.add(key);
  });
  return ports;
}
