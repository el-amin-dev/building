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

/**
 * Start of a door along x that really does sit in one wall contact, in metres.
 *
 * On the redrawn floor the corridor meets the kitchen along x over 10.00–11.90
 * (corridor rect 1 ↔ kitchen rect 0) and again over 12.20–14.10, and meets the
 * west void over 10.00–11.65, so a 0.90 m door starting here fits inside one
 * contact of either pair. It was 11.55, which runs to 12.45 — off the end of the
 * first contact and short of the second. Every case below therefore carried a
 * second, geometric defect on top of the one it names, and the cases meant to be
 * rejected for a bad id, kind, axis or width were passing only because those
 * checks happen to run before the geometry one.
 */
const DOOR_SPAN_MIN = 10.5;

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
const VALID_PORT = makePort(['corridor', 'kitchen'], 'door', 'x', DOOR_SPAN_MIN, DOOR_WIDTH);

/** One schedule the validator must reject, with the phrase its message carries. */
const REJECTED: readonly (readonly [string, readonly Port[], RegExp])[] = [
  [
    'a space that is not in the plan',
    [makePort(['corridor', UNKNOWN_ID], 'door', 'x', DOOR_SPAN_MIN, DOOR_WIDTH)],
    /ports\[0\].*is not in the plan/,
  ],
  [
    'a port from a space to itself',
    [makePort(['corridor', 'corridor'], 'door', 'x', DOOR_SPAN_MIN, DOOR_WIDTH)],
    /ports\[0\].*two distinct spaces/,
  ],
  [
    'an unknown kind',
    [makePort(['corridor', 'kitchen'], UNKNOWN_KIND, 'x', DOOR_SPAN_MIN, DOOR_WIDTH)],
    /ports\[0\].*kind must be one of/,
  ],
  [
    'an unknown axis',
    [makePort(['corridor', 'kitchen'], 'door', UNKNOWN_AXIS, DOOR_SPAN_MIN, DOOR_WIDTH)],
    /ports\[0\].*along must be one of/,
  ],
  [
    'a zero width',
    [makePort(['corridor', 'kitchen'], 'door', 'x', DOOR_SPAN_MIN, ZERO_WIDTH)],
    /ports\[0\].*width must be/,
  ],
  [
    'a negative width',
    [makePort(['corridor', 'kitchen'], 'door', 'x', DOOR_SPAN_MIN, NEGATIVE_WIDTH)],
    /ports\[0\].*width must be/,
  ],
  [
    'a width off the centimetre grid',
    [makePort(['corridor', 'kitchen'], 'door', 'x', DOOR_SPAN_MIN, OFF_GRID_WIDTH)],
    /ports\[0\].*width must be/,
  ],
  [
    'a start off the centimetre grid',
    [makePort(['masterBedroom', 'corridor'], 'door', 'x', OFF_GRID_SPAN_MIN, DOOR_WIDTH)],
    /ports\[0\].*spanMin must be/,
  ],
  [
    'a port onto a void',
    [makePort(['kitchen', 'voidWest'], 'door', 'x', DOOR_SPAN_MIN, DOOR_WIDTH)],
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
    [VALID_PORT, makePort(['kitchen', 'corridor'], 'door', 'x', DOOR_SPAN_MIN, DOOR_WIDTH)],
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

  it('builds the rejection cases on a base port the plan really accepts', () => {
    // Almost every case below is VALID_PORT with one field spoiled. The base going
    // stale is exactly how this file broke before: at x 11.55 it matched no wall
    // contact, so the id, kind, axis and width cases still threw and still matched
    // their phrase — for the base's geometry rather than for the defect they name.
    // Nothing here proves a case fails for its own reason unless the base passes.
    expect(VALID_PORT.spaces).toStrictEqual(['corridor', 'kitchen']);
    expect(VALID_PORT.spanMin).toBe(DOOR_SPAN_MIN);
    expect(VALID_PORT.width).toBe(DOOR_WIDTH);
    expect(() => validatePorts(FLOOR_PLAN, [VALID_PORT])).not.toThrow();
    expect(() =>
      validatePorts(FLOOR_PLAN, [
        makePort(['masterBedroom', 'corridor'], 'door', 'x', 5.65, DOOR_WIDTH),
      ]),
    ).not.toThrow();
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
