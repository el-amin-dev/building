import type { RootState } from '@react-three/fiber';
import { act, fireEvent, render } from '@testing-library/react';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { createRoomCentrePose, EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { getRoomWalkArea, INTERIM_WALK_SPACE_ID } from '../domain/interimWalkArea.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import { getThirdPersonCamera, THIRD_PERSON_CAMERA_CONFIG } from '../domain/thirdPersonCamera.ts';
import { InteriorExplorer } from './InteriorExplorer.tsx';
import { isPersonModelVisible } from './personModelParts.ts';

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

/** The room walking is clamped to, in floor coordinates: the same one `BuildingScene` uses. */
const WALK_AREA = getRoomWalkArea(
  FLOOR_PLAN,
  INTERIM_WALK_SPACE_ID,
  EYE_NAVIGATION_CONFIG.bodyRadius,
  FLOOR_HEIGHTS.wall,
  THIRD_PERSON_CAMERA_CONFIG.wallMargin,
);
const WALKABLE_BOUNDS = WALK_AREA.bounds;
const ROOM_BOX = WALK_AREA.roomBox;
const START_POSE = createRoomCentrePose(WALKABLE_BOUNDS);
/**
 * Share of the follow distance the camera must keep at the start pose: the point of starting
 * in the centre is that no wall pulls the camera in, let alone raises it overhead.
 */
const NEAR_FOLLOW_DISTANCE_SHARE = 0.9;

describe('InteriorExplorer', () => {
  let target: HTMLDivElement;
  let camera: PerspectiveCamera;

  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useRemoteControlStore.setState(useRemoteControlStore.getInitialState(), true);
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

  it('starts again from the room-centre pose after an unmount and remount', () => {
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

  it('walks while the remote control holds an action, with no keyboard event', () => {
    renderExplorer();
    runFrame(SETTLE_DELTA_SECONDS);

    act(() => {
      useRemoteControlStore.getState().pressAction('moveForward');
    });
    runFrame(WALK_DELTA_SECONDS);

    // The start pose looks toward -x along the master bedroom's longer axis, so walking
    // forward lowers x and leaves z where it was.
    expect(camera.position.x).toBeLessThan(START_POSE.x);
    expect(camera.position.z).toBeCloseTo(START_POSE.z);
  });

  it('shows the mannequin at the start pose, the camera a full follow distance behind', () => {
    const camera = getThirdPersonCamera(START_POSE, ROOM_BOX);
    // The camera sits straight behind the person, toward +x, so the maxX face is what limits it.
    const roomBehind = ROOM_BOX.plan.maxX - START_POSE.x;

    expect(camera.elevation).toBeCloseTo(THIRD_PERSON_CAMERA_CONFIG.baseElevation);
    expect(camera.distance).toBeCloseTo(roomBehind / Math.cos(camera.elevation));
    expect(camera.distance).toBeGreaterThan(
      NEAR_FOLLOW_DISTANCE_SHARE * THIRD_PERSON_CAMERA_CONFIG.followDistance,
    );
    expect(camera.distance).toBeGreaterThan(THIRD_PERSON_CAMERA_CONFIG.minBodyVisibleDistance);
    expect(isPersonModelVisible('thirdPerson', START_POSE, ROOM_BOX)).toBe(true);
  });

  it('releases every held remote action when it unmounts', () => {
    const { unmount } = renderExplorer();
    act(() => {
      useRemoteControlStore.getState().pressAction('turnLeft');
    });
    expect(useRemoteControlStore.getState().activeActions.size).toBe(1);

    unmount();

    expect(useRemoteControlStore.getState().activeActions.size).toBe(0);
  });

  it('releases every held remote action when the camera mode changes', () => {
    renderExplorer();
    act(() => {
      useRemoteControlStore.getState().pressAction('moveForward');
    });

    act(() => {
      useViewStore.getState().toggleInteriorCameraMode();
    });

    expect(useRemoteControlStore.getState().activeActions.size).toBe(0);
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
