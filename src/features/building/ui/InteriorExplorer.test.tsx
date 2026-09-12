import type { RootState } from '@react-three/fiber';
import { act, fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import { getThirdPersonCamera } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import { BUILT_FLOOR, CAMERA_FIELD, INTERIOR_START_POSE } from './floorInstance.ts';
import { InteriorExplorer } from './InteriorExplorer.tsx';

type FrameCallback = (state: RootState, delta: number) => void;

// jsdom has no WebGL and no render loop: `useFrame` only records the latest callback. The
// person model (a three.js scene graph) and the pose reporter are replaced by probes that
// record the props they are handed and render nothing, so the only frame callback left is the
// camera controls', and the two children can be checked without a canvas.
const frameLoop = vi.hoisted(() => ({ callback: null as FrameCallback | null }));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: FrameCallback) => {
    frameLoop.callback = callback;
  },
}));

const children = vi.hoisted(() => ({
  personProps: null as unknown,
  reporterPoseRef: null as unknown,
}));

vi.mock('./PersonModel.tsx', () => ({
  PersonModel: (props: unknown) => {
    children.personProps = props;
    return null;
  },
}));

vi.mock('./ExplorerPoseReporter.tsx', () => ({
  ExplorerPoseReporter: ({ poseRef }: { poseRef: RefObject<EyePose> }) => {
    children.reporterPoseRef = poseRef;
    return null;
  },
}));

/** What `PersonModel` is handed, as this test reads it back. */
interface RecordedPersonProps {
  /** The pose ref the model reads every frame. */
  readonly poseRef: RefObject<EyePose>;
  /** The field the model resolves its own visibility against. */
  readonly field: unknown;
  /** The camera mode the model is told about. */
  readonly cameraMode: InteriorCameraMode;
}

const FORWARD_CODE = 'KeyW';
const TURN_CODE = 'KeyJ';
const SETTLE_DELTA_SECONDS = 0;
const WALK_DELTA_SECONDS = 0.1;
const LEVEL_PITCH = 0;

/** Where the stairs put the viewer: the pose the interior must always open on. */
const ARRIVAL = BUILT_FLOOR.stairs.arrival;

describe('InteriorExplorer', () => {
  let target: HTMLDivElement;
  let camera: PerspectiveCamera;

  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useRemoteControlStore.setState(useRemoteControlStore.getInitialState(), true);
    children.personProps = null;
    children.reporterPoseRef = null;
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

  const renderExplorer = () => render(<InteriorExplorer targetRef={{ current: target }} />);

  /** Runs one frame of the latest registered `useFrame` callback on the test camera. */
  const runFrame = (delta: number) => {
    const callback = frameLoop.callback;
    if (callback === null) {
      throw new Error('InteriorExplorer registered no frame callback');
    }
    callback({ camera } as unknown as RootState, delta);
  };

  /** The pose ref handed to the pose reporter. */
  const reporterPoseRef = (): RefObject<EyePose> => {
    const poseRef = children.reporterPoseRef;
    if (poseRef === null) {
      throw new Error('InteriorExplorer rendered no ExplorerPoseReporter');
    }
    return poseRef as RefObject<EyePose>;
  };

  /** The props handed to the person model. */
  const personProps = (): RecordedPersonProps => {
    const props = children.personProps;
    if (props === null) {
      throw new Error('InteriorExplorer rendered no PersonModel');
    }
    return props as RecordedPersonProps;
  };

  it('opens on the stairs arrival, looking level', () => {
    renderExplorer();

    runFrame(SETTLE_DELTA_SECONDS);

    // Entry to the floor is through the stairs (ADR-006), so this is the one opening pose.
    expect(camera.position.x).toBeCloseTo(ARRIVAL.x);
    expect(camera.position.z).toBeCloseTo(ARRIVAL.z);
    expect(camera.position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    expect(camera.rotation.y).toBeCloseTo(ARRIVAL.yaw);
    expect(camera.rotation.x).toBeCloseTo(LEVEL_PITCH);
  });

  it('starts from the one shared start pose object, not a fresh equal one', () => {
    renderExplorer();

    // The transition's interior endpoint and this pose must be the same object, so the camera
    // lands exactly where the controls then place it (`floorInstance.ts`).
    expect(reporterPoseRef().current).toBe(INTERIOR_START_POSE);
  });

  it('starts again from the stairs arrival after an unmount and remount', () => {
    const { unmount } = renderExplorer();
    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: TURN_CODE });
    runFrame(WALK_DELTA_SECONDS);
    expect(camera.rotation.y).not.toBeCloseTo(ARRIVAL.yaw);

    unmount();
    renderExplorer();
    runFrame(SETTLE_DELTA_SECONDS);

    expect(camera.position.x).toBeCloseTo(ARRIVAL.x);
    expect(camera.position.z).toBeCloseTo(ARRIVAL.z);
    expect(camera.rotation.y).toBeCloseTo(ARRIVAL.yaw);
  });

  it('hands the pose reporter the very ref the camera controls step', () => {
    renderExplorer();

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);

    // The reporter runs after the controls in the same frame, so what it reads must be the
    // pose the controls have just written — the same ref, not a copy of the start pose.
    const reported = reporterPoseRef().current;
    expect(reported).not.toBe(INTERIOR_START_POSE);
    expect(reported.x).toBeCloseTo(camera.position.x);
    expect(reported.z).toBeCloseTo(camera.position.z);
  });

  it('hands the person model the shared pose ref, the camera field and the camera mode', () => {
    renderExplorer();

    expect(personProps().poseRef).toBe(reporterPoseRef());
    expect(personProps().field).toBe(CAMERA_FIELD);
    expect(personProps().cameraMode).toBe('firstPerson');

    act(() => {
      useViewStore.getState().toggleInteriorCameraMode();
    });

    expect(personProps().cameraMode).toBe('thirdPerson');
  });

  it('walks while the remote control holds an action, with no keyboard event', () => {
    renderExplorer();
    runFrame(SETTLE_DELTA_SECONDS);

    act(() => {
      useRemoteControlStore.getState().pressAction('moveForward');
    });
    runFrame(WALK_DELTA_SECONDS);

    // The arrival faces out of the stair bay, so walking forward leaves the landing.
    const walked = Math.hypot(camera.position.x - ARRIVAL.x, camera.position.z - ARRIVAL.z);
    expect(walked).toBeGreaterThan(0);
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
    const walkedPose = reporterPoseRef().current;

    act(() => {
      useViewStore.getState().toggleInteriorCameraMode();
    });
    runFrame(SETTLE_DELTA_SECONDS);

    const expected = getThirdPersonCamera(walkedPose, CAMERA_FIELD).position;
    expect(camera.position.x).toBeCloseTo(expected.x);
    expect(camera.position.y).toBeCloseTo(expected.y);
    expect(camera.position.z).toBeCloseTo(expected.z);
  });
});
