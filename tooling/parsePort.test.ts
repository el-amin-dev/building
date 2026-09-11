// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_PORT, MIN_PORT, parsePort } from './parsePort.ts';

const FALLBACK_PORT = 4173;

describe('parsePort', () => {
  it('returns the fallback when the variable is not set', () => {
    expect(parsePort('DEV_SERVER_PORT', undefined, FALLBACK_PORT)).toBe(FALLBACK_PORT);
  });

  it('parses a valid port', () => {
    expect(parsePort('DEV_SERVER_PORT', '5199', FALLBACK_PORT)).toBe(5199);
  });

  it('accepts the bounds of the valid range', () => {
    expect(parsePort('DEV_SERVER_PORT', String(MIN_PORT), FALLBACK_PORT)).toBe(MIN_PORT);
    expect(parsePort('DEV_SERVER_PORT', String(MAX_PORT), FALLBACK_PORT)).toBe(MAX_PORT);
  });

  it.each(['', ' ', '0', '65536', '-1', '80.5', '1e3', '0x50', ' 80', 'abc'])(
    'rejects %j with a clear error',
    (value) => {
      expect(() => parsePort('DEV_SERVER_PORT', value, FALLBACK_PORT)).toThrow(
        /Invalid DEV_SERVER_PORT: expected an integer from 1 to 65535/,
      );
    },
  );
});
