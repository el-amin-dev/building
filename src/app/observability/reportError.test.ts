import { afterEach, describe, expect, it } from 'vitest';
import { reportError, resetErrorSink, setErrorSink } from './reportError.ts';
import type { ErrorReport, ErrorSink, SceneErrorEvent } from './reportError.ts';

/** What a sink receives: the report, plus the moment it was made. */
type StampedReport = ErrorReport & { readonly at: string };

/** A report with every optional field filled, so a dropped field cannot go unnoticed. */
const FULL_REPORT: ErrorReport = Object.freeze({
  event: 'scene-render-failed',
  message: 'The scene threw while rendering.',
  stack: 'Error: boom\n    at SceneContent',
  context: Object.freeze({ floorCount: 3, view: 'interior', retried: false }),
});

/** A report with nothing but the two required fields. */
const BARE_REPORT: ErrorReport = Object.freeze({
  event: 'webgl-unsupported',
  message: 'No WebGL context could be created.',
});

/** Every member of the union, so a new event cannot be added without passing through here. */
const EVERY_EVENT: readonly SceneErrorEvent[] = [
  'scene-render-failed',
  'webgl-context-lost',
  'webgl-unsupported',
  'scene-chunk-failed',
];

/** Exactly what `Date.prototype.toISOString` produces: UTC, to the millisecond. */
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ONE_REPORT = 1;
const NO_REPORTS = 0;

/** A sink that keeps what it is given, and the list it keeps it in. */
function collector(): { readonly sink: ErrorSink; readonly reports: StampedReport[] } {
  const reports: StampedReport[] = [];
  return {
    reports,
    sink: (report) => {
      reports.push(report);
    },
  };
}

/**
 * The seam every other module reports through.
 *
 * Every assertion here goes through an injected sink, and none of them touch `console`: the
 * console is an implementation detail of the default sink, and a test that spied on it would
 * pin the seam's one allowed side effect in place instead of its contract. The reset test
 * below therefore proves that an injected sink is *detached*, and deliberately never reports
 * while the default sink is installed — the browser is where that line belongs, not the run.
 */
describe('reportError', () => {
  afterEach(() => {
    resetErrorSink();
  });

  it('hands the report to the injected sink with every field intact', () => {
    const { sink, reports } = collector();
    setErrorSink(sink);

    reportError(FULL_REPORT);

    expect(reports).toHaveLength(ONE_REPORT);
    expect(reports[0]).toMatchObject(FULL_REPORT);
  });

  it('stamps the moment of the report as an ISO timestamp', () => {
    const { sink, reports } = collector();
    setErrorSink(sink);
    const before = Date.now();

    reportError(BARE_REPORT);

    const after = Date.now();
    const { at } = reports[0];
    expect(at).toMatch(ISO_PATTERN);
    expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(at)).toBeLessThanOrEqual(after);
  });

  it('reports exactly once per call, and once per later call', () => {
    const { sink, reports } = collector();
    setErrorSink(sink);

    reportError(BARE_REPORT);
    expect(reports).toHaveLength(ONE_REPORT);

    reportError(FULL_REPORT);
    expect(reports).toHaveLength(ONE_REPORT + ONE_REPORT);
  });

  it('leaves out the optional fields the caller left out', () => {
    const { sink, reports } = collector();
    setErrorSink(sink);

    reportError(BARE_REPORT);

    const received = reports[0];
    // Absent, not `undefined`: the sink serialises what it is handed, and a `"stack": null`
    // in the log would claim a stack was looked for and not found.
    expect(Object.hasOwn(received, 'stack')).toBe(false);
    expect(Object.hasOwn(received, 'context')).toBe(false);
    expect(Object.keys(received).toSorted()).toEqual(['at', 'event', 'message']);
  });

  it('carries every event of the union through unchanged', () => {
    const { sink, reports } = collector();
    setErrorSink(sink);

    for (const event of EVERY_EVENT) {
      reportError({ event, message: event });
    }

    expect(reports.map((report) => report.event)).toEqual(EVERY_EVENT);
  });

  it('sends later reports to the sink installed last', () => {
    const first = collector();
    const second = collector();
    setErrorSink(first.sink);

    setErrorSink(second.sink);
    reportError(BARE_REPORT);

    expect(first.reports).toHaveLength(NO_REPORTS);
    expect(second.reports).toHaveLength(ONE_REPORT);
  });

  it('detaches the injected sink when it is reset', () => {
    const injected = collector();
    setErrorSink(injected.sink);
    reportError(BARE_REPORT);

    resetErrorSink();

    // Nothing is reported while the default sink is installed: the next report goes to a
    // fresh sink, which is enough to show the first one is no longer attached.
    const replacement = collector();
    setErrorSink(replacement.sink);
    reportError(FULL_REPORT);

    expect(injected.reports).toHaveLength(ONE_REPORT);
    expect(replacement.reports).toHaveLength(ONE_REPORT);
    expect(replacement.reports[0].event).toBe(FULL_REPORT.event);
  });
});
