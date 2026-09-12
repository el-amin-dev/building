import { describe, expect, it } from 'vitest';
import { FLOOR_PLAN } from '../floorPlan/index.ts';
import type { SpaceId } from '../floorPlan/index.ts';
import { PORT_SCHEDULE } from './portSchedule.ts';
import type { Port, PortAxis, PortKind } from './types.ts';
import { validatePorts } from './validatePorts.ts';

const DOOR_WIDTH = 0.9;
const OFF_GRID_WIDTH = 0.905;
const OFF_GRID_SPAN_MIN = 5.655;
const ZERO_WIDTH = 0;
const NEGATIVE_WIDTH = -0.9;

/** An id no space of the plan carries, for the unknown-id check. */
const UNKNOWN_ID = 'nowhere' as unknown as SpaceId;
/** A kind outside the {@link PortKind} union, for the enum check. */
const UNKNOWN_KIND = 'window' as unknown as PortKind;
/** An axis outside the {@link PortAxis} union, for the enum check. */
const UNKNOWN_AXIS = 'y' as unknown as PortAxis;

/**
 * Builds a port for a validation test.
 *
 * @param spaces - The two spaces, in the order the validator walks them.
 * @param kind - Kind of the passage.
 * @param along - Axis the width runs along.
 * @param spanMin - Start of the port along `along`, in metres.
 * @param width - Clear width, in metres.
 * @returns A plain {@link Port}.
 */
function makePort(
  spaces: readonly [SpaceId, SpaceId],
  kind: PortKind,
  along: PortAxis,
  spanMin: number,
  width: number,
): Port {
  return { spaces, kind, along, spanMin, width };
}

/** A valid port, used as the base of the rejection cases. */
const VALID_PORT = makePort(['corridor', 'kitchen'], 'door', 'x', 11.55, DOOR_WIDTH);

/** One schedule the validator must reject, with the phrase its message carries. */
const REJECTED: readonly (readonly [string, readonly Port[], RegExp])[] = [
  [
    'a space that is not in the plan',
    [makePort(['corridor', UNKNOWN_ID], 'door', 'x', 11.55, DOOR_WIDTH)],
    /ports\[0\].*is not in the plan/,
  ],
  [
    'a port from a space to itself',
    [makePort(['corridor', 'corridor'], 'door', 'x', 11.55, DOOR_WIDTH)],
    /ports\[0\].*two distinct spaces/,
  ],
  [
    'an unknown kind',
    [makePort(['corridor', 'kitchen'], UNKNOWN_KIND, 'x', 11.55, DOOR_WIDTH)],
    /ports\[0\].*kind must be one of/,
  ],
  [
    'an unknown axis',
    [makePort(['corridor', 'kitchen'], 'door', UNKNOWN_AXIS, 11.55, DOOR_WIDTH)],
    /ports\[0\].*along must be one of/,
  ],
  [
    'a zero width',
    [makePort(['corridor', 'kitchen'], 'door', 'x', 11.55, ZERO_WIDTH)],
    /ports\[0\].*width must be/,
  ],
  [
    'a negative width',
    [makePort(['corridor', 'kitchen'], 'door', 'x', 11.55, NEGATIVE_WIDTH)],
    /ports\[0\].*width must be/,
  ],
  [
    'a width off the centimetre grid',
    [makePort(['corridor', 'kitchen'], 'door', 'x', 11.55, OFF_GRID_WIDTH)],
    /ports\[0\].*width must be/,
  ],
  [
    'a start off the centimetre grid',
    [makePort(['masterBedroom', 'corridor'], 'door', 'x', OFF_GRID_SPAN_MIN, DOOR_WIDTH)],
    /ports\[0\].*spanMin must be/,
  ],
  [
    'a port onto a void',
    [makePort(['kitchen', 'voidWest'], 'door', 'x', 11.0, DOOR_WIDTH)],
    /ports\[0\].*no floor/,
  ],
  [
    'two spaces that share no wall',
    [makePort(['livingRoom', 'kitchen'], 'door', 'x', 10.5, DOOR_WIDTH)],
    /ports\[0\].*exactly one wall contact/,
  ],
  [
    'an axis that matches no contact',
    [makePort(['masterBedroom', 'corridor'], 'door', 'z', 1.0, DOOR_WIDTH)],
    /ports\[0\].*exactly one wall contact/,
  ],
  [
    'a span running past the end of the wall',
    [makePort(['masterBedroom', 'corridor'], 'door', 'x', 5.65, 1.5)],
    /ports\[0\].*exactly one wall contact/,
  ],
  [
    'a pair that joins with no wall',
    [makePort(['stairs', 'corridor'], 'opening', 'z', 4.2, DOOR_WIDTH)],
    /ports\[0\].*no wall to cut/,
  ],
  [
    'the same pair twice',
    [VALID_PORT, makePort(['kitchen', 'corridor'], 'door', 'x', 11.55, DOOR_WIDTH)],
    /ports\[1\].*repeats a pair/,
  ],
];

describe('validatePorts', () => {
  it('accepts PORT_SCHEDULE and returns the same reference', () => {
    expect(validatePorts(FLOOR_PLAN, PORT_SCHEDULE)).toBe(PORT_SCHEDULE);
  });

  it('accepts an empty schedule', () => {
    const empty: readonly Port[] = [];

    expect(validatePorts(FLOOR_PLAN, empty)).toBe(empty);
  });

  it('accepts a single valid port', () => {
    const ports = [VALID_PORT];

    expect(validatePorts(FLOOR_PLAN, ports)).toBe(ports);
  });

  it.each(REJECTED)('rejects %s', (_label, ports, message) => {
    expect(() => validatePorts(FLOOR_PLAN, ports)).toThrow(RangeError);
    expect(() => validatePorts(FLOOR_PLAN, ports)).toThrow(message);
  });

  it('names the offending pair as well as its index', () => {
    const ports = [VALID_PORT, makePort(['livingRoom', 'kitchen'], 'door', 'x', 10.5, DOOR_WIDTH)];

    expect(() => validatePorts(FLOOR_PLAN, ports)).toThrow(
      /ports\[1\] \("livingRoom" ↔ "kitchen"\)/,
    );
  });
});
