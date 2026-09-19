import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetErrorSink, setErrorSink } from '../../../app/observability/reportError.ts';
import type { ErrorReport } from '../../../app/observability/reportError.ts';
import { detectWebGLSupport } from './webglSupport.ts';

/** What a sink receives: the report, plus the moment it was made. */
type StampedReport = ErrorReport & { readonly at: string };

/** A stand-in for a WebGL context object: the detector only ever checks it is not `null`. */
const CONTEXT = Object.freeze({});

const ONE_REPORT = 1;
const NO_REPORTS = 0;

/** Every report made during one test; drained by the sink installed below. */
let reports: StampedReport[] = [];

/**
 * A canvas that answers the listed context identifiers and nothing else.
 *
 * @param answers - The identifiers a context is handed back for.
 * @param asked - Filled with every identifier asked for, in order.
 * @returns The stand-in canvas.
 */
function stubCanvas(answers: readonly string[], asked: string[] = []): HTMLCanvasElement {
  return {
    getContext: (contextId: string) => {
      asked.push(contextId);
      return answers.includes(contextId) ? CONTEXT : null;
    },
  } as unknown as HTMLCanvasElement;
}

/** A canvas whose `getContext` throws, the way a blocked GPU process makes it. */
function throwingCanvas(error: Error): HTMLCanvasElement {
  return {
    getContext: () => {
      throw error;
    },
  } as unknown as HTMLCanvasElement;
}

describe('detectWebGLSupport', () => {
  beforeEach(() => {
    reports = [];
    setErrorSink((report) => {
      reports.push(report);
    });
  });

  afterEach(() => {
    resetErrorSink();
    vi.restoreAllMocks();
  });

  it('reports the browser as supported when it answers webgl2', () => {
    const asked: string[] = [];

    expect(detectWebGLSupport(() => stubCanvas(['webgl2', 'webgl'], asked))).toBe('supported');

    // webgl2 first, and nothing after it: three.js asks in this order too.
    expect(asked).toEqual(['webgl2']);
  });

  it('falls back to webgl when webgl2 is not answered', () => {
    const asked: string[] = [];

    expect(detectWebGLSupport(() => stubCanvas(['webgl'], asked))).toBe('supported');

    expect(asked).toEqual(['webgl2', 'webgl']);
  });

  it('says nothing at all while WebGL works', () => {
    detectWebGLSupport(() => stubCanvas(['webgl2']));

    expect(reports).toHaveLength(NO_REPORTS);
  });

  it('reports the browser as unsupported when neither identifier is answered', () => {
    const asked: string[] = [];

    expect(detectWebGLSupport(() => stubCanvas([], asked))).toBe('unsupported');

    expect(asked).toEqual(['webgl2', 'webgl']);
    expect(reports).toHaveLength(ONE_REPORT);
    expect(reports[0].event).toBe('webgl-unsupported');
    expect(reports[0].stack).toBeUndefined();
  });

  it('treats a canvas that cannot be made as unsupported, keeping the stack', () => {
    const blocked = new Error('createElement is not allowed here');

    expect(
      detectWebGLSupport(() => {
        throw blocked;
      }),
    ).toBe('unsupported');

    expect(reports).toHaveLength(ONE_REPORT);
    expect(reports[0].event).toBe('webgl-unsupported');
    expect(reports[0].stack).toBe(blocked.stack);
  });

  it('treats a getContext that throws as unsupported', () => {
    const crashed = new Error('GPU process is gone');

    expect(detectWebGLSupport(() => throwingCanvas(crashed))).toBe('unsupported');

    expect(reports).toHaveLength(ONE_REPORT);
    expect(reports[0].event).toBe('webgl-unsupported');
    expect(reports[0].stack).toBe(crashed.stack);
  });

  it('makes its own canvas when no factory is handed to it', () => {
    // Stubbed rather than left to jsdom, which implements no `getContext` at all and says so
    // on its virtual console: the point here is only which element the detector asks for.
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(stubCanvas(['webgl2']) as unknown as HTMLElement);

    expect(detectWebGLSupport()).toBe('supported');

    expect(createElement).toHaveBeenCalledWith('canvas');
  });
});
