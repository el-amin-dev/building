import { reportError } from '../../../app/observability/reportError.ts';

/** Whether this browser can give the scene a WebGL context at all. */
export type WebGLSupport = 'supported' | 'unsupported';

/**
 * The context identifiers tried, best first.
 *
 * three.js asks for `webgl2` and falls back to `webgl`, so the probe has to ask for the same
 * two: a browser that answers only the older one still runs the scene, and calling it
 * unsupported would replace a working building with an apology.
 */
const CONTEXT_IDS = ['webgl2', 'webgl'] as const;

/** What is said about a browser that answered neither identifier. */
const UNSUPPORTED_MESSAGE = 'No WebGL context could be created: the 3D scene cannot be drawn.';

/** The probe surface: a throwaway canvas, never added to the document. */
function createProbeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

/**
 * Asks the browser whether it can open a WebGL context, without mounting the scene.
 *
 * A failed `getContext` is not an exception in every browser — most return `null`, some
 * throw (a blocked or crashed GPU process, a hardened privacy setting), and a locked-down
 * browser can throw from `createElement` itself. All three answers mean the same thing here,
 * so all three are collapsed into `'unsupported'`.
 *
 * **It reports.** `'unsupported'` is emitted once per call through the error seam, because
 * this is the one place in the app that learns the fact: the caller only decides what to
 * render. Pure otherwise — the canvas is never attached and nothing is kept.
 *
 * The canvas comes from an injected factory so both answers are reachable in a test: jsdom
 * implements no WebGL at all, so the real `document.createElement('canvas')` could only ever
 * produce the unsupported branch.
 *
 * @param createCanvas - How to make the throwaway canvas; the document's own by default.
 * @returns Whether a WebGL context could be created.
 */
export function detectWebGLSupport(
  createCanvas: () => HTMLCanvasElement = createProbeCanvas,
): WebGLSupport {
  try {
    const canvas = createCanvas();
    for (const contextId of CONTEXT_IDS) {
      if (canvas.getContext(contextId) !== null) {
        return 'supported';
      }
    }
  } catch (cause) {
    reportError({
      event: 'webgl-unsupported',
      message: UNSUPPORTED_MESSAGE,
      stack: cause instanceof Error ? cause.stack : undefined,
      context: { probe: 'threw' },
    });
    return 'unsupported';
  }
  reportError({
    event: 'webgl-unsupported',
    message: UNSUPPORTED_MESSAGE,
    context: { probe: 'null' },
  });
  return 'unsupported';
}
