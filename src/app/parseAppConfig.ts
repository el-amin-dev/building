/** The raw environment variables read by the app. Untrusted until parsed. */
export interface RawEnv {
  /** `true` in the Vite development server. */
  readonly DEV?: unknown;
  /** See `.env.example`. */
  readonly VITE_APP_TITLE?: unknown;
  /** See `.env.example`. */
  readonly VITE_DEBUG_PANEL?: unknown;
}

/** Validated application configuration. */
export interface AppConfig {
  /** Page title shown in the browser tab. */
  readonly appTitle: string;
  /** Whether the Leva debug panel is shown (development builds only). */
  readonly showDebugPanel: boolean;
}

/** Title used when `VITE_APP_TITLE` is not set. */
export const DEFAULT_APP_TITLE = 'Floor';

/** Debug panel flag used when `VITE_DEBUG_PANEL` is not set. */
export const DEFAULT_DEBUG_PANEL = false;

const BOOLEAN_STRINGS: Readonly<Record<string, boolean>> = { true: true, false: false };

function parseAppTitle(value: unknown): string {
  if (value === undefined) {
    return DEFAULT_APP_TITLE;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Invalid VITE_APP_TITLE: expected a non-empty string, received ${JSON.stringify(value)}.`,
    );
  }
  return value.trim();
}

function parseBooleanFlag(name: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'string' && Object.hasOwn(BOOLEAN_STRINGS, value)) {
    return BOOLEAN_STRINGS[value];
  }
  throw new Error(
    `Invalid ${name}: expected "true" or "false", received ${JSON.stringify(value)}.`,
  );
}

/**
 * Parses and validates the application configuration from raw environment variables.
 * Pure: used by the app at runtime and by the Vite config to fail fast at dev/build start.
 *
 * @param env - Raw environment values, e.g. `import.meta.env` or Vite's `loadEnv` result.
 * @returns The validated configuration.
 * @throws Error when a variable is set but malformed.
 */
export function parseAppConfig(env: RawEnv): AppConfig {
  const appTitle = parseAppTitle(env.VITE_APP_TITLE);
  const debugPanelEnabled = parseBooleanFlag(
    'VITE_DEBUG_PANEL',
    env.VITE_DEBUG_PANEL,
    DEFAULT_DEBUG_PANEL,
  );
  return {
    appTitle,
    showDebugPanel: env.DEV === true && debugPanelEnabled,
  };
}
