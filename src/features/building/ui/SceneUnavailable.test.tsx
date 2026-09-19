import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SceneUnavailable } from './SceneUnavailable.tsx';
import { ViewModeToggle } from './ViewModeToggle.tsx';

const WEBGL_TITLE = '3D view unavailable';
const WEBGL_ADVICE =
  'This browser cannot open the WebGL context the building is drawn with. Try a current version of Chrome, Edge, Firefox or Safari, and check that hardware acceleration is switched on in its settings.';
const FAILED_TITLE = '3D view stopped';
const FAILED_ADVICE =
  'Something went wrong while drawing the building, so the view was stopped. Reload the page to start it again; if it stops a second time, the graphics driver of this device is the likeliest cause.';

/** The one HUD panel class both reasons wear, shared with the hint and the room menu. */
const PANEL_CLASS = 'bg-slate-900';
/** Heading level of the panel's title: the page's own `<h1>` is the application title. */
const HEADING_LEVEL = 2;
/** How many elements of the whole HUD may carry `role="status"`: the view status, and no other. */
const ONE_STATUS = 1;
const NO_TARGETS = 0;

describe('SceneUnavailable', () => {
  it('says what a browser without WebGL can do about it', () => {
    render(<SceneUnavailable reason="webgl-unsupported" />);

    expect(screen.getByRole('heading', { level: HEADING_LEVEL })).toHaveTextContent(WEBGL_TITLE);
    expect(screen.getByText(WEBGL_ADVICE)).toBeInTheDocument();
    expect(screen.queryByText(FAILED_ADVICE)).toBeNull();
  });

  it('says what a scene that threw can do about it, in different words', () => {
    render(<SceneUnavailable reason="scene-failed" />);

    expect(screen.getByRole('heading', { level: HEADING_LEVEL })).toHaveTextContent(FAILED_TITLE);
    expect(screen.getByText(FAILED_ADVICE)).toBeInTheDocument();
    expect(screen.queryByText(WEBGL_ADVICE)).toBeNull();

    // The two failures ask different things of the viewer, so they may not share a sentence.
    expect(FAILED_ADVICE).not.toBe(WEBGL_ADVICE);
    expect(FAILED_TITLE).not.toBe(WEBGL_TITLE);
  });

  it('leaves the single status role of the HUD to the view status, for either reason', () => {
    for (const reason of ['webgl-unsupported', 'scene-failed'] as const) {
      const { unmount } = render(
        <>
          <ViewModeToggle />
          <SceneUnavailable reason={reason} />
        </>,
      );

      expect(screen.getAllByRole('status')).toHaveLength(ONE_STATUS);
      unmount();
    }
  });

  it('wears the HUD panel look and offers nothing to operate', () => {
    render(<SceneUnavailable reason="scene-failed" />);

    expect(screen.getByText(FAILED_ADVICE).parentElement).toHaveClass(PANEL_CLASS);
    // Nothing to click means no 24 px target to keep: the way out is a page reload, which
    // the browser's own chrome already offers.
    expect(screen.queryAllByRole('button')).toHaveLength(NO_TARGETS);
    expect(screen.queryAllByRole('link')).toHaveLength(NO_TARGETS);
  });
});
