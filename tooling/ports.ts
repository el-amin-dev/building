import { parsePort } from './parsePort.ts';

/** Default port of the Vite development server (`pnpm dev`). */
export const DEFAULT_DEV_SERVER_PORT = 5173;

/** Default port of the Vite preview server (`pnpm preview`). */
export const DEFAULT_PREVIEW_SERVER_PORT = 4173;

/** Default port of the preview server started by the end-to-end tests (`pnpm test:e2e`). */
export const DEFAULT_E2E_SERVER_PORT = 4174;

/** Development server port, overridable with the `DEV_SERVER_PORT` shell variable. */
export const DEV_SERVER_PORT = parsePort(
  'DEV_SERVER_PORT',
  process.env.DEV_SERVER_PORT,
  DEFAULT_DEV_SERVER_PORT,
);

/** Preview server port, overridable with the `PREVIEW_SERVER_PORT` shell variable. */
export const PREVIEW_SERVER_PORT = parsePort(
  'PREVIEW_SERVER_PORT',
  process.env.PREVIEW_SERVER_PORT,
  DEFAULT_PREVIEW_SERVER_PORT,
);

/** End-to-end preview server port, overridable with the `E2E_SERVER_PORT` shell variable. */
export const E2E_SERVER_PORT = parsePort(
  'E2E_SERVER_PORT',
  process.env.E2E_SERVER_PORT,
  DEFAULT_E2E_SERVER_PORT,
);
