import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { reportError } from '../../../app/observability/reportError.ts';
import { SceneUnavailable } from './SceneUnavailable.tsx';

/** Props of {@link SceneErrorBoundary}. */
interface SceneErrorBoundaryProps {
  /** The scene tree to guard: in the app, the lazily loaded `BuildingScene`. */
  readonly children: ReactNode;
}

/** State of {@link SceneErrorBoundary}: one latch, never unset. */
interface SceneErrorBoundaryState {
  /** Whether the scene has thrown, in which case the fallback is shown instead. */
  readonly failed: boolean;
}

/** What a throw with no message of its own is reported as. */
const UNKNOWN_MESSAGE = 'The 3D scene threw a value that is not an Error.';

/**
 * Shows {@link SceneUnavailable} instead of a scene that threw, and reports the throw once.
 *
 * A class, because `getDerivedStateFromError` and `componentDidCatch` are the only way React
 * offers to catch a render-phase throw — there is no hook equivalent.
 *
 * **What it catches**
 *
 * - a throw while React renders anything in the scene tree, including the `<Canvas>` and
 *   every component under it;
 * - a failed lazy chunk: the rejected dynamic `import()` of the scene is re-thrown at the
 *   Suspense boundary during render, which is a render-phase throw like any other.
 *
 * **What it cannot catch, and this is the larger half**
 *
 * - **a throw inside React Three Fiber's frame loop.** `useFrame` callbacks, the camera
 *   controls and the route follower all run outside React's render, driven by
 *   `requestAnimationFrame`; a throw there never passes through this component and ends up
 *   on `window.onerror` instead. That is precisely where a running 3D scene is most likely to
 *   fail, so this boundary should not be read as "the scene cannot break the page".
 * - a lost WebGL context, which is an event and not a throw: the canvas simply stops
 *   painting. `BuildingScene` listens for it and reports it itself.
 * - anything asynchronous, and anything thrown in an event handler.
 *
 * The latch is deliberately one-way: there is no retry button, because nothing here knows
 * what state three.js was left in, and re-mounting a scene that has just thrown tends to
 * throw again. Reloading the page is what the fallback asks for, and it is honest.
 */
export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  override state: SceneErrorBoundaryState = { failed: false };

  /**
   * Switches to the fallback on the same render the throw happened.
   *
   * @returns The failed state.
   */
  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { failed: true };
  }

  /**
   * Reports the throw once, after the fallback has been committed.
   *
   * @param error - Whatever was thrown; React does not promise an `Error`.
   * @param info - React's own account of where it happened.
   */
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? undefined;
    reportError({
      event: 'scene-render-failed',
      message: error instanceof Error ? error.message : UNKNOWN_MESSAGE,
      stack: error instanceof Error ? error.stack : undefined,
      context: componentStack === undefined ? undefined : { componentStack },
    });
  }

  /** @returns The scene, or the fallback once it has thrown. */
  override render(): ReactNode {
    if (this.state.failed) {
      return <SceneUnavailable reason="scene-failed" />;
    }
    return this.props.children;
  }
}
