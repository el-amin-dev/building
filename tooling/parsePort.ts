/** Lowest valid TCP port number. */
export const MIN_PORT = 1;

/** Highest valid TCP port number. */
export const MAX_PORT = 65_535;

const DECIMAL_DIGITS = /^\d+$/;

/**
 * Parses a TCP port from an environment variable value.
 *
 * @param name - Name of the variable, used in the error message.
 * @param value - Raw value, `undefined` when the variable is not set.
 * @param fallback - Port returned when the variable is not set.
 * @returns The validated port.
 * @throws Error when the value is set but is not an integer from 1 to 65535.
 */
export function parsePort(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const port = DECIMAL_DIGITS.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `Invalid ${name}: expected an integer from ${MIN_PORT} to ${MAX_PORT}, received ${JSON.stringify(value)}.`,
    );
  }
  return port;
}
