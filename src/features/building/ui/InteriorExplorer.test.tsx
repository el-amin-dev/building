import type { RootState } from '@react-three/fiber';
import { act, fireEvent, render } from '@testing-library/react';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewStore } from '../application/viewStore.ts';
import { BASE_CHAMBER_SPEC, getClearRect, getWalkableBounds } from '../domain/chamber.ts';
import { createInitialEyePose, EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import {
  createCameraRoomBox,
  getThirdPersonCamera,
  THIRD_PERSON_CAMERA_CONFIG,
} from '../domain/thirdPersonCamera.ts';
import { InteriorExplorer } from './InteriorExplorer.tsx';

type FrameCallback = (state: RootState, delta: number) => void;

// jsdom has no WebGL and no render loop: `useFrame` only records the latest callback, and the
// person model (a three.js scene graph) is replaced by nothing, so the only frame callback is
// the camera controls'.
const frameLoop = vi.hoisted(() => ({ callback: null as FrameCallback | null }));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: FrameCallback) => {
    frameLoop.callback = callback;
  },
}));
vi.mock('./PersonModel.tsx', () => ({ PersonModel: () => null }));

const FORWARD_CODE = 'KeyW';
const TURN_CODE = 'KeyJ';
const SETTLE_DELTA_SECONDS = 0;
const WALK_DELTA_SECONDS = 0.1;

const WALKABLE_BOUNDS = getWalkableBounds(BASE_CHAMBER_SPEC, EYE_NAVIGATION_CONFIG.bodyRadius);
const ROOM_BOX = createCameraRoomBox(
  getClearRect(BASE_CHAMBER_SPEC),
  FLOOR_HEIGHTS.wall,
  THIRD_PERSON_CAMERA_CONFIG.wallMargin,
);
const START_POSE = createInitialEyePose(WALKABLE_BOUNDS);

describe('InteriorExplorer', () => {
  let target: HTMLDivElement;
  let camera: PerspectiveCamera;

  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
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

  const renderExplorer = () =>
    render(
      <InteriorExplorer
        targetRef={{ current: target }}
        bounds={WALKABLE_BOUNDS}
        roomBox={ROOM_BOX}
      />,
    );

  /** Runs one frame of the latest registered `useFrame` callback on the test camera. */
  const runFrame = (delta: number) => {
    const callback = frameLoop.callback;
    if (callback === null) {
      throw new Error('InteriorExplorer registered no frame callback');
    }
    callback({ camera } as unknown as RootState, delta);
  };

  it('starts again from the corner pose after an unmount and remount', () => {
    const { unmount } = renderExplorer();
    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: TURN_CODE });
    runFrame(WALK_DELTA_SECONDS);
    expect(camera.position.x).toBeLessThan(START_POSE.x);
    expect(camera.rotation.y).not.toBeCloseTo(START_POSE.yaw);

    unmount();
    renderExplorer();
    runFrame(SETTLE_DELTA_SECONDS);

    expect(camera.position.x).toBeCloseTo(START_POSE.x);
    expect(camera.position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    expect(camera.position.z).toBeCloseTo(START_POSE.z);
    expect(camera.rotation.y).toBeCloseTo(START_POSE.yaw);
  });

  it('follows the camera mode of the view store without resetting the pose', () => {
    renderExplorer();
    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);
    fireEvent.keyUp(target, { code: FORWARD_CODE });
    const walkedX = camera.position.x;
    const walkedZ = camera.position.z;
    const walkedPose = { ...START_POSE, x: walkedX, z: walkedZ };

    act(() => {
      useViewStore.getState().toggleInteriorCameraMode();
    });
    runFrame(SETTLE_DELTA_SECONDS);

    const expected = getThirdPersonCamera(walkedPose, ROOM_BOX).position;
    expect(camera.position.x).toBeCloseTo(expected.x);
    expect(camera.position.y).toBeCloseTo(expected.y);
    expect(camera.position.z).toBeCloseTo(expected.z);
  });
});
