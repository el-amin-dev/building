/**
 * Structural validation of a port schedule against a {@link FloorPlan}.
 *
 * Validation is pure: it reads the plan and the schedule and either returns the
 * schedule unchanged or throws a `RangeError` naming the offending port index
 * and its space pair.
 */
import { getSpace, hasFloor } from '../floorPlan/index.ts';
import type { FloorPlan, SpaceId } from '../floorPlan/index.ts';
import { LENGTH_TOLERANCE, isOnPlanGrid } from '../planGeometry.ts';
import { getPortContact, getPortSpan } from './queries.ts';
import type { Port, PortAxis, PortKind } from './types.ts';

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
 * Checks that a port's kind and axis are known values.
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
}

/**
 * Checks that a port's width and start lie on the centimetre plan grid, with a
 * width greater than zero.
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
 * Checks that a port sits in exactly one wall contact, and that the contact has
 * a wall to cut.
 *
 * The single-contact rule of `getPortContact` also enforces that the port span
 * fits inside the contact span, so no separate fit check is needed here.
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
}

/**
 * Validates a port schedule against a floor plan.
 *
 * Checks every port, in schedule order, and within a port in this order:
 * 1. both spaces exist in the plan and are distinct;
 * 2. `kind` and `along` are known values;
 * 3. `width` is greater than zero and on the centimetre grid, and `spanMin` is
 *    on the grid;
 * 4. neither space is a `void`, which has no floor to open onto;
 * 5. the port sits in exactly one wall contact whose span contains it (see
 *    `getPortContact`), and that contact has a non-zero gap, i.e. a wall to cut;
 * 6. no unordered pair of spaces appears twice in the schedule. Two ports
 *    between the same pair are always an error: the floor has none.
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
