import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetErrorSink, setErrorSink } from '../../../app/observability/reportError.ts';
import type { ErrorReport } from '../../../app/observability/reportError.ts';
import { SceneErrorBoundary } from './SceneErrorBoundary.tsx';
import { ViewModeToggle } from './ViewModeToggle.tsx';

/** What a sink receives: the report, plus the moment it was made. */
type StampedReport = ErrorReport & { readonly at: string };

const CHILD_TEXT = 'the building';
const BOOM_MESSAGE = 'WebGLRenderer: context creation failed';
/** What a throw of something that is not an `Error` is reported as. */
const UNKNOWN_MESSAGE = 'The 3D scene threw a value that is not an Error.';
/** The heading and sentence of the fallback, which is `SceneUnavailable reason="scene-failed"`. */
const FALLBACK_TITLE = '3D view stopped';
const FALLBACK_ADVICE =
  'Something went wrong while drawing the building, so the view was stopped. Reload the page to start it again; if it stops a second time, the graphics driver of this device is the likeliest cause.';

const ONE_REPORT = 1;
const NO_REPORTS = 0;
/** How many elements of the whole HUD may carry `role="status"`: the view status, and no other. */
const ONE_STATUS = 1;

/** Every report made during one test. */
let reports: StampedReport[] = [];

/** A child that renders, so the boundary has something to be transparent about. */
function Scene() {
  return <p>{CHILD_TEXT}</p>;
}

/** A child that throws while React renders it: the one thing this boundary catches. */
function Boom(): ReactNode {
  throw new Error(BOOM_MESSAGE);
}

/** A child that throws something that is not an `Error`, which React allows. */
function BoomWithoutAnError(): ReactNode {
  throw BOOM_MESSAGE;
}

/**
 * Renders a tree under the boundary with React's own logging of the caught error silenced.
 *
 * `onCaughtError` replaces React's default handler, which writes the throw to the console.
 * Passing an empty one keeps the run readable without any test here touching `console` —
 * what the boundary reported is read off the injected sink instead.
 *
 * @param children - The tree to guard.
 * @returns The render result, so a test can re-render or unmount.
 */
function renderGuarded(children: ReactNode) {
  return render(<SceneErrorBoundary>{children}</SceneErrorBoundary>, {
    onCaughtError: () => {},
  });
}

describe('SceneErrorBoundary', () => {
  beforeEach(() => {
    reports = [];
    setErrorSink((report) => {
      reports.push(report);
    });
  });

  afterEach(() => {
    resetErrorSink();
  });

  it('is transparent while the scene renders', () => {
    renderGuarded(<Scene />);

    expect(screen.getByText(CHILD_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_ADVICE)).toBeNull();
    expect(reports).toHaveLength(NO_REPORTS);
  });

  it('shows the fallback instead of a scene that threw while rendering', () => {
    renderGuarded(<Boom />);

    expect(screen.getByRole('heading')).toHaveTextContent(FALLBACK_TITLE);
    expect(screen.getByText(FALLBACK_ADVICE)).toBeInTheDocument();
    expect(screen.queryByText(CHILD_TEXT)).toBeNull();
  });

  it('reports the throw exactly once, with the message and the stack of the error', () => {
    renderGuarded(<Boom />);

    expect(reports).toHaveLength(ONE_REPORT);
    const [report] = reports;
    expect(report.event).toBe('scene-render-failed');
    expect(report.message).toBe(BOOM_MESSAGE);
    expect(report.stack).toContain(BOOM_MESSAGE);
    expect(typeof report.context?.componentStack).toBe('string');
  });

  it('reports a throw that is not an Error without inventing a message for it', () => {
    renderGuarded(<BoomWithoutAnError />);

    expect(reports).toHaveLength(ONE_REPORT);
    expect(reports[0].event).toBe('scene-render-failed');
    expect(reports[0].message).toBe(UNKNOWN_MESSAGE);
    expect(reports[0].stack).toBeUndefined();
    expect(screen.getByText(FALLBACK_ADVICE)).toBeInTheDocument();
  });

  it('keeps the fallback once it has failed, and reports nothing more', () => {
    const { rerender } = renderGuarded(<Boom />);

    // A scene that is fine again on the next render does not bring the view back: nothing
    // here knows what state three.js was left in, so the latch stays shut until a reload.
    rerender(
      <SceneErrorBoundary>
        <Scene />
      </SceneErrorBoundary>,
    );

    expect(screen.getByText(FALLBACK_ADVICE)).toBeInTheDocument();
    expect(screen.queryByText(CHILD_TEXT)).toBeNull();
    expect(reports).toHaveLength(ONE_REPORT);
  });

  it('leaves the single status role of the HUD to the view status when it fails', () => {
    render(
      <>
        <ViewModeToggle />
        <SceneErrorBoundary>
          <Boom />
        </SceneErrorBoundary>
      </>,
      { onCaughtError: () => {} },
    );

    expect(screen.getAllByRole('status')).toHaveLength(ONE_STATUS);
  });
});
