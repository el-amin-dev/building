import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { ExplorerPoseReporter } from './ExplorerPoseReporter.tsx';

type FrameCallback = () => void;

// jsdom has no WebGL and no render loop: `useFrame` only records the latest callback and its
// priority, so each test can run a frame by hand.
const frameLoop = vi.hoisted(() => ({
  callback: null as FrameCallback | null,
  priority: undefined as number | undefined,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: FrameCallback, priority?: number) => {
    frameLoop.callback = callback;
    frameLoop.priority = priority;
  },
}));

/** Default `useFrame` priority: the camera controls step the pose before it, at −1. */
const DEFAULT_FRAME_PRIORITY = 0;

/**
 * Yaw and pitch never reach the room lookup; the test poses look level ahead.
 *
 * Nor does the height: the reporter samples a plan point, and the typical floor is the same
 * plan at every storey. Both poses stand flat on the ground storey — floor 1, no rise.
 */
const LEVEL_POSE = { yaw: 0, pitch: 0, floor: 1, rise: 0 };
/** The centre of the kitchen's west rect (x 10.00–12.20, z 6.30–8.60). */
const IN_KITCHEN: EyePose = { x: 11.1, z: 7.45, ...LEVEL_POSE };
/** The centre of the stairwell (x 1.60–5.60, z 4.00–6.00), rooms away from the kitchen. */
const IN_STAIRS: EyePose = { x: 3.6, z: 5.0, ...LEVEL_POSE };

describe('ExplorerPoseReporter', () => {
  beforeEach(() => {
    useExplorerPoseStore.setState(useExplorerPoseStore.getInitialState(), true);
    useExplorerPoseStore.getState().clearPose();
  });

  afterEach(() => {
    frameLoop.callback = null;
    frameLoop.priority = undefined;
  });

  /** Renders the reporter with a test-owned pose ref the test can move between frames. */
  const renderReporter = (initialPose: EyePose = IN_KITCHEN) => {
    const poseRef = { current: initialPose };
    const { container, unmount } = render(<ExplorerPoseReporter poseRef={poseRef} />);
    return { poseRef, container, unmount };
  };

  /** Runs one frame of the registered `useFrame` callback. */
  const runFrame = () => {
    const callback = frameLoop.callback;
    if (callback === null) {
      throw new Error('ExplorerPoseReporter registered no frame callback');
    }
    act(() => {
      callback();
    });
  };

  it('reports at the default priority, after the pose step of the camera controls', () => {
    renderReporter();

    expect(frameLoop.priority).toBe(DEFAULT_FRAME_PRIORITY);
  });

  it('renders nothing', () => {
    const { container } = renderReporter();

    expect(container).toBeEmptyDOMElement();
  });

  it('reports no pose until a frame runs', () => {
    renderReporter();

    expect(useExplorerPoseStore.getState().getLatestPose()).toBeUndefined();
    expect(useExplorerPoseStore.getState().currentSpace).toBeUndefined();
  });

  it('reports the pose of every frame, so the room follows the explorer', () => {
    const { poseRef } = renderReporter();

    runFrame();
    expect(useExplorerPoseStore.getState().getLatestPose()).toBe(IN_KITCHEN);
    expect(useExplorerPoseStore.getState().currentSpace?.spaceId).toBe('kitchen');

    poseRef.current = IN_STAIRS;
    runFrame();

    expect(useExplorerPoseStore.getState().getLatestPose()).toBe(IN_STAIRS);
    expect(useExplorerPoseStore.getState().currentSpace?.spaceId).toBe('stairs');
  });

  it('clears the pose and the room when it unmounts with the interior view', () => {
    const { unmount } = renderReporter();
    runFrame();

    unmount();

    expect(useExplorerPoseStore.getState().currentSpace).toBeUndefined();
    expect(useExplorerPoseStore.getState().getLatestPose()).toBeUndefined();
  });
});
