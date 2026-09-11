import type { RootState } from '@react-three/fiber';
import { fireEvent, render } from '@testing-library/react';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_CHAMBER_SPEC, getClearRect, getWalkableBounds } from '../domain/chamber.ts';
import { createInitialEyePose, EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import {
  createCameraRoomBox,
  getThirdPersonCamera,
  THIRD_PERSON_CAMERA_CONFIG,
} from '../domain/thirdPersonCamera.ts';
import type { ScenePoint } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
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
/** Yaw of the centre test pose: turned left, so every plan axis of the follow ray is used. */
const CENTRE_POSE_YAW = 0.6;

const WALKABLE_BOUNDS = getWalkableBounds(BASE_CHAMBER_SPEC, EYE_NAVIGATION_CONFIG.bodyRadius);
const ROOM_BOX = createCameraRoomBox(
  getClearRect(BASE_CHAMBER_SPEC),
  FLOOR_HEIGHTS.wall,
  THIRD_PERSON_CAMERA_CONFIG.wallMargin,
);
const START_POSE = createInitialEyePose(WALKABLE_BOUNDS);
/** A pose in the middle of the room, where the follow camera has room to back away. */
const CENTRE_POSE: EyePose = { x: 0, z: 0, yaw: CENTRE_POSE_YAW, pitch: LEVEL_PITCH };

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

  /**
   * Renders the controls with a test-owned pose ref; `setCameraMode` re-renders them with
   * the same refs and another camera mode.
   */
  const renderControls = (
    cameraMode: InteriorCameraMode = 'firstPerson',
    initialPose: EyePose = START_POSE,
  ) => {
    const targetRef = { current: target };
    const poseRef = { current: initialPose };
    const renderWith = (mode: InteriorCameraMode) => (
      <EyeCameraControls
        targetRef={targetRef}
        bounds={WALKABLE_BOUNDS}
        poseRef={poseRef}
        cameraMode={mode}
        roomBox={ROOM_BOX}
      />
    );
    const { rerender } = render(renderWith(cameraMode));
    return {
      poseRef,
      setCameraMode: (mode: InteriorCameraMode) => {
        rerender(renderWith(mode));
      },
    };
  };

  /** Runs one frame of the latest registered `useFrame` callback on the test camera. */
  const runFrame = (delta: number) => {
    const callback = frameLoop.callback;
    if (callback === null) {
      throw new Error('EyeCameraControls registered no frame callback');
    }
    callback({ camera } as unknown as RootState, delta);
  };

  const expectCameraAt = (point: ScenePoint) => {
    expect(camera.position.x).toBeCloseTo(point.x);
    expect(camera.position.y).toBeCloseTo(point.y);
    expect(camera.position.z).toBeCloseTo(point.z);
  };

  const expectFirstPersonCamera = (pose: EyePose) => {
    expectCameraAt({ x: pose.x, y: PERSON_SPEC.eyeHeight, z: pose.z });
    expect(camera.rotation.order).toBe(EYE_EULER_ORDER);
    expect(camera.rotation.x).toBeCloseTo(pose.pitch);
    expect(camera.rotation.y).toBeCloseTo(pose.yaw);
    expect(camera.rotation.z).toBeCloseTo(NO_ROLL);
  };

  const expectThirdPersonCamera = (pose: EyePose) => {
    const expected = getThirdPersonCamera(pose, ROOM_BOX);
    expectCameraAt(expected.position);
    const towardTarget = new Vector3(expected.target.x, expected.target.y, expected.target.z)
      .sub(camera.position)
      .normalize();
    const direction = camera.getWorldDirection(new Vector3());
    expect(direction.x).toBeCloseTo(towardTarget.x);
    expect(direction.y).toBeCloseTo(towardTarget.y);
    expect(direction.z).toBeCloseTo(towardTarget.z);
  };

  it('places the camera at eye height in the start corner, level, with YXZ order', () => {
    renderControls();

    runFrame(SETTLE_DELTA_SECONDS);

    expectFirstPersonCamera(START_POSE);
    expect(camera.position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    expect(camera.rotation.x).toBeCloseTo(LEVEL_PITCH);
  });

  it('walks toward the opposite corner at eye height while W is held on the target', () => {
    renderControls();
    runFrame(SETTLE_DELTA_SECONDS);

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);

    expect(camera.position.x).toBeLessThan(START_POSE.x);
    expect(camera.position.z).toBeLessThan(START_POSE.z);
    expect(camera.position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    const walked = Math.hypot(camera.position.x - START_POSE.x, camera.position.z - START_POSE.z);
    expect(walked).toBeCloseTo(EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS);
    expect(camera.rotation.y).toBeCloseTo(START_POSE.yaw);
  });

  it('writes the stepped pose back to the pose ref', () => {
    const { poseRef } = renderControls();

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: TURN_CODE });
    runFrame(WALK_DELTA_SECONDS);

    const pose = poseRef.current;
    expect(pose).not.toBe(START_POSE);
    expect(pose.x).toBeLessThan(START_POSE.x);
    expect(pose.yaw).toBeGreaterThan(START_POSE.yaw);
    expectFirstPersonCamera(pose);
  });

  it('follows the person from behind in third person, looking at the follow target', () => {
    renderControls('thirdPerson', CENTRE_POSE);

    runFrame(SETTLE_DELTA_SECONDS);

    expectThirdPersonCamera(CENTRE_POSE);
    expect(camera.position.y).toBeGreaterThan(PERSON_SPEC.eyeHeight);
  });

  it('keeps following while walking in third person', () => {
    const { poseRef } = renderControls('thirdPerson', CENTRE_POSE);

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);

    expect(poseRef.current.z).toBeLessThan(CENTRE_POSE.z);
    expectThirdPersonCamera(poseRef.current);
  });

  it('keeps the pose when the camera mode changes', () => {
    const { poseRef, setCameraMode } = renderControls();
    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: TURN_CODE });
    runFrame(WALK_DELTA_SECONDS);
    fireEvent.keyUp(target, { code: FORWARD_CODE });
    fireEvent.keyUp(target, { code: TURN_CODE });
    const walkedPose = poseRef.current;

    setCameraMode('thirdPerson');
    runFrame(SETTLE_DELTA_SECONDS);

    expect(poseRef.current).toEqual(walkedPose);
    expectThirdPersonCamera(walkedPose);

    setCameraMode('firstPerson');
    runFrame(SETTLE_DELTA_SECONDS);

    expect(poseRef.current).toEqual(walkedPose);
    expectFirstPersonCamera(walkedPose);
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

    expectFirstPersonCamera(START_POSE);
    other.remove();
  });
});
