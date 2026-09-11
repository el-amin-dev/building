import type { RootState } from '@react-three/fiber';
import { fireEvent, render } from '@testing-library/react';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_CHAMBER_SPEC, getWalkableBounds } from '../domain/chamber.ts';
import { createInitialEyePose, EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { EyeCameraControls } from './EyeCameraControls.tsx';

type FrameCallback = (state: RootState, delta: number) => void;

// jsdom has no WebGL and no render loop: `useFrame` only records the latest callback so
// each test can run a frame by hand against a real three.js camera.
const frameLoop = vi.hoisted(() => ({ callback: null as FrameCallback | null }));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: FrameCallback) => {
    frameLoop.callback = callback;
  },
}));

const FORWARD_CODE = 'KeyW';
const TURN_CODE = 'KeyJ';
const SETTLE_DELTA_SECONDS = 0;
const WALK_DELTA_SECONDS = 0.1;
const EYE_EULER_ORDER = 'YXZ';
const LEVEL_PITCH = 0;
const NO_ROLL = 0;

const WALKABLE_BOUNDS = getWalkableBounds(BASE_CHAMBER_SPEC, EYE_NAVIGATION_CONFIG.bodyRadius);
const START_POSE = createInitialEyePose(WALKABLE_BOUNDS);

describe('EyeCameraControls', () => {
  let target: HTMLDivElement;
  let camera: PerspectiveCamera;

  beforeEach(() => {
    target = document.createElement('div');
    target.tabIndex = 0;
    document.body.appendChild(target);
    target.focus();
    camera = new PerspectiveCamera();
  });

  afterEach(() => {
    target.remove();
    frameLoop.callback = null;
  });

  const renderControls = () => {
    const targetRef = { current: target };
    return render(<EyeCameraControls targetRef={targetRef} bounds={WALKABLE_BOUNDS} />);
  };

  /** Runs one frame of the latest registered `useFrame` callback on the test camera. */
  const runFrame = (delta: number) => {
    const callback = frameLoop.callback;
    if (callback === null) {
      throw new Error('EyeCameraControls registered no frame callback');
    }
    callback({ camera } as unknown as RootState, delta);
  };

  const expectCameraAtStart = () => {
    expect(camera.position.x).toBeCloseTo(START_POSE.x);
    expect(camera.position.y).toBeCloseTo(FLOOR_HEIGHTS.eye);
    expect(camera.position.z).toBeCloseTo(START_POSE.z);
    expect(camera.rotation.order).toBe(EYE_EULER_ORDER);
    expect(camera.rotation.x).toBeCloseTo(LEVEL_PITCH);
    expect(camera.rotation.y).toBeCloseTo(START_POSE.yaw);
    expect(camera.rotation.z).toBeCloseTo(NO_ROLL);
  };

  it('places the camera at eye height in the start corner, level, with YXZ order', () => {
    renderControls();

    runFrame(SETTLE_DELTA_SECONDS);

    expectCameraAtStart();
  });

  it('walks toward the opposite corner at eye height while W is held on the target', () => {
    renderControls();
    runFrame(SETTLE_DELTA_SECONDS);

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);

    expect(camera.position.x).toBeLessThan(START_POSE.x);
    expect(camera.position.z).toBeLessThan(START_POSE.z);
    expect(camera.position.y).toBeCloseTo(FLOOR_HEIGHTS.eye);
    const walked = Math.hypot(camera.position.x - START_POSE.x, camera.position.z - START_POSE.z);
    expect(walked).toBeCloseTo(EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS);
    expect(camera.rotation.y).toBeCloseTo(START_POSE.yaw);
  });

  it('starts again from the corner pose after an unmount and remount', () => {
    const { unmount } = renderControls();
    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: TURN_CODE });
    runFrame(WALK_DELTA_SECONDS);
    expect(camera.position.x).toBeLessThan(START_POSE.x);
    expect(camera.rotation.y).not.toBeCloseTo(START_POSE.yaw);

    unmount();
    renderControls();
    runFrame(SETTLE_DELTA_SECONDS);

    expectCameraAtStart();
  });

  it('ignores navigation keys pressed on other elements', () => {
    renderControls();
    const other = document.createElement('div');
    other.tabIndex = 0;
    document.body.appendChild(other);
    other.focus();

    fireEvent.keyDown(other, { code: FORWARD_CODE });
    fireEvent.keyDown(document.body, { code: TURN_CODE });
    runFrame(WALK_DELTA_SECONDS);

    expectCameraAtStart();
    other.remove();
  });
});
