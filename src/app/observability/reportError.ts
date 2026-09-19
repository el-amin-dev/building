/**
 * The application's error seam: everything that fails outside React's normal control flow
 * is said here, once, in one shape.
 *
 * **This module is the only file allowed to touch `console`.** `no-console` is an error
 * everywhere else, and `eslint.config.js` turns it off for this path alone — a file-scoped
 * override rather than an inline `eslint-disable`, so the exception is visible from the
 * configuration instead of hiding in a comment that gets copied along with the line under it.
 * Every other file reports through {@link reportError}.
 *
 * What is logged is deliberately thin: the event, a message, an optional stack and an
 * optional bag of primitives. No pose, no route, no configuration, nothing about the viewer —
 * a failing 3D scene is not a reason to start narrating where somebody is standing.
 */

/**
 * The failures worth reporting, as a closed set.
 *
 * - `scene-render-failed` — the scene tree threw while React was rendering it, caught by
 *   `SceneErrorBoundary`.
 * - `webgl-context-lost` — the browser took the WebGL context away from the live canvas
 *   (driver reset, GPU pressure, a background tab reclaimed); reported by `BuildingScene`.
 * - `webgl-unsupported` — no WebGL context could be created at all; reported by
 *   `detectWebGLSupport`.
 * - `scene-chunk-failed` — the lazily loaded scene chunk could not be fetched.
 */
export type SceneErrorEvent =
  'scene-render-failed' | 'webgl-context-lost' | 'webgl-unsupported' | 'scene-chunk-failed';

/** One failure, as the caller knows it. */
export interface ErrorReport {
  /** Which of the four failures this is. */
  readonly event: SceneErrorEvent;
  /** One sentence a human can read, written for the log and not for the screen. */
  readonly message: string;
  /** The stack of the underlying error, when there was an underlying error. */
  readonly stack?: string;
  /** Primitives that narrow the failure down. Never anything about the viewer. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Where reports go: the console by default, whatever a test (or, later, a collector)
 * installs through {@link setErrorSink} otherwise.
 *
 * It receives the report with the moment it was made stamped on it, so a sink never has to
 * ask the clock itself.
 */
export type ErrorSink = (report: ErrorReport & { readonly at: string }) => void;

/**
 * The default sink: one `console.error` per report, carrying one JSON string.
 *
 * One line and one argument, because that is what survives being copied out of a browser
 * console and pasted into a bug report — an object logged as an object is a collapsed
 * `▶ Object` in a screenshot.
 */
const CONSOLE_SINK: ErrorSink = (report) => {
  console.error(JSON.stringify(report));
};

let sink: ErrorSink = CONSOLE_SINK;

/**
 * Reports one failure through the current sink.
 *
 * @param report - What failed. See {@link ErrorReport}.
 */
export function reportError(report: ErrorReport): void {
  sink({ ...report, at: new Date().toISOString() });
}

/**
 * Sends every later report to `sink` instead of the console.
 *
 * @param nextSink - Where reports go from now on.
 */
export function setErrorSink(nextSink: ErrorSink): void {
  sink = nextSink;
}

/** Sends later reports back to the console, undoing {@link setErrorSink}. */
export function resetErrorSink(): void {
  sink = CONSOLE_SINK;
}
