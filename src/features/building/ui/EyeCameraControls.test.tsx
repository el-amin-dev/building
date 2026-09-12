import type { RootState } from '@react-three/fiber';
import { fireEvent, render } from '@testing-library/react';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { makeWalkField } from '../domain/collision.ts';
import type { WalkField } from '../domain/collision.ts';
import { EYE_KEY_BINDINGS, EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import type { EyeAction, EyePose, MovementIntent } from '../domain/eyeNavigation.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { createCameraField, getThirdPersonCamera } from '../domain/thirdPersonCamera.ts';
import type { CameraField, ScenePoint } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import { EyeCameraControls } from './EyeCameraControls.tsx';
import { CAMERA_FIELD, INTERIOR_START_POSE, WALK_FIELD } from './floorInstance.ts';

type FrameCallback = (state: RootState, delta: number) => void;

// jsdom has no WebGL and no render loop: `useFrame` only records the latest callback and its
// priority so each test can run a frame by hand against a real three.js camera.
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

/**
 * What the route follower hands the frame loop, under the test's control.
 *
 * The follower's own planning is `useRouteFollower.test.tsx`'s subject; what matters here is
 * which intent reaches `stepEyePose` when a walk and the viewer's hands both have something to
 * say, so the automatic intent is dictated rather than planned. Setting `useReal` hands the
 * real hook back for the one test that needs a genuine walk on the real floor.
 */
const routeFollower = vi.hoisted(() => ({
  intent: undefined as unknown,
  useReal: false,
}));

vi.mock('./useRouteFollower.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useRouteFollower.ts')>();
  return {
    useRouteFollower: () => {
      const advance = actual.useRouteFollower();
      return (pose: EyePose, dtSeconds: number) =>
        routeFollower.useReal
          ? advance(pose, dtSeconds)
          : (routeFollower.intent as MovementIntent | undefined);
    },
  };
});

/** Priority of `useFrame` callbacks registered without one, e.g. the pose reporter's. */
const DEFAULT_FRAME_PRIORITY = 0;

const SETTLE_DELTA_SECONDS = 0;
const WALK_DELTA_SECONDS = 0.1;
const EYE_EULER_ORDER = 'YXZ';
const LEVEL_PITCH = 0;
const NO_ROLL = 0;
/** Yaw of the test poses: turned off the axes, so every plan axis of the follow ray is used. */
const START_POSE_YAW = 0.6;
/** Plan centre of the synthetic room, in metres. */
const ROOM_CENTRE = 0;

/**
 * The floor these tests walk on: one open rectangle with nothing standing on it.
 *
 * The collision model is `collision.test.ts`'s subject; this file is about the frame loop, so
 * the field is a room with no blocker at all — every step asked for is a step taken, and a pose
 * that moved is proof the intent reached `stepEyePose`.
 */
const ROOM_HALF_SIZE = 20;
const ROOM_RECT: PlanRect = {
  minX: -ROOM_HALF_SIZE,
  maxX: ROOM_HALF_SIZE,
  minZ: -ROOM_HALF_SIZE,
  maxZ: ROOM_HALF_SIZE,
};
const OPEN_FIELD: WalkField = makeWalkField([ROOM_RECT], []);
const OPEN_CAMERA_FIELD: CameraField = createCameraField(OPEN_FIELD, FLOOR_HEIGHTS.wall);

const START_POSE: EyePose = Object.freeze({
  x: ROOM_CENTRE,
  z: ROOM_CENTRE,
  yaw: START_POSE_YAW,
  pitch: LEVEL_PITCH,
});

/** An intent asking for nothing: what every dictated automatic intent is built from. */
const NO_INTENT: MovementIntent = Object.freeze({ move: 0, strafe: 0, turn: 0, look: 0 });
/**
 * The automatic intent every walk test dictates: turn left, and nothing else.
 *
 * A turn is what makes the two intents tell each other apart: the manual intent these tests
 * hold is a walk forward, so the pose says which of the two was applied without either having
 * to be spied on.
 */
const AUTO_TURN_INTENT: MovementIntent = Object.freeze({ ...NO_INTENT, turn: 1 });

/** A room the stairs arrival can really be walked to, for the one real-follower test. */
const REAL_WALK_TARGET: SpaceId = 'kitchen';
/** One frame at 60 fps, in seconds. */
const FRAME_SECONDS = 1 / 60;
/** Frames of real walking driven: a second of it, long enough to leave the landing. */
const REAL_WALK_FRAMES = 60;

/** The keys of an {@link EyePose}, sorted: what the pose ref must hold, and nothing more. */
const EYE_POSE_KEYS = ['pitch', 'x', 'yaw', 'z'];

/**
 * The physical key bound to a navigation action.
 *
 * Looked up rather than written down, so a rebound key moves these tests with it.
 *
 * @param action - The action wanted.
 * @returns The `KeyboardEvent.code` bound to it.
 * @throws Error when no key is bound to the action.
 */
function keyFor(action: EyeAction): string {
  const code = Object.keys(EYE_KEY_BINDINGS).find((candidate) => {
    return EYE_KEY_BINDINGS[candidate] === action;
  });
  if (code === undefined) {
    throw new Error(`No key is bound to ${action}`);
  }
  return code;
}

const FORWARD_CODE = keyFor('moveForward');
const TURN_CODE = keyFor('turnLeft');
const LOOK_UP_CODE = keyFor('lookUp');

/** How the controls are rendered; every field has a default. */
interface RenderOptions {
  /** First or third person; first by default. */
  readonly cameraMode?: InteriorCameraMode;
  /** The pose the test-owned ref starts at. */
  readonly initialPose?: EyePose;
  /** The collision field walking is resolved against. */
  readonly field?: WalkField;
  /** The field the follow camera is placed in. */
  readonly cameraField?: CameraField;
}

describe('EyeCameraControls', () => {
  let target: HTMLDivElement;
  let camera: PerspectiveCamera;

  beforeEach(() => {
    useRemoteControlStore.setState(useRemoteControlStore.getInitialState(), true);
    useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
    routeFollower.intent = undefined;
    routeFollower.useReal = false;
    target = document.createElement('div');
    target.tabIndex = 0;
    document.body.appendChild(target);
    target.focus();
    camera = new PerspectiveCamera();
  });

  afterEach(() => {
    target.remove();
    frameLoop.callback = null;
    frameLoop.priority = undefined;
  });

  /**
   * Renders the controls with a test-owned pose ref; `setCameraMode` re-renders them with
   * the same refs and another camera mode.
   */
  const renderControls = ({
    cameraMode = 'firstPerson',
    initialPose = START_POSE,
    field = OPEN_FIELD,
    cameraField = OPEN_CAMERA_FIELD,
  }: RenderOptions = {}) => {
    const targetRef = { current: target };
    const poseRef = { current: initialPose };
    const renderWith = (mode: InteriorCameraMode) => (
      <EyeCameraControls
        targetRef={targetRef}
        field={field}
        poseRef={poseRef}
        cameraMode={mode}
        cameraField={cameraField}
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
    const expected = getThirdPersonCamera(pose, OPEN_CAMERA_FIELD);
    expectCameraAt(expected.position);
    const towardTarget = new Vector3(expected.target.x, expected.target.y, expected.target.z)
      .sub(camera.position)
      .normalize();
    const direction = camera.getWorldDirection(new Vector3());
    expect(direction.x).toBeCloseTo(towardTarget.x);
    expect(direction.y).toBeCloseTo(towardTarget.y);
    expect(direction.z).toBeCloseTo(towardTarget.z);
  };

  /** How far the pose moved on the plan from where it started. */
  const walkedFrom = (pose: EyePose, from: EyePose = START_POSE) => {
    return Math.hypot(pose.x - from.x, pose.z - from.z);
  };

  it('steps the pose before default-priority frame callbacks, keeping automatic rendering', () => {
    renderControls();

    expect(frameLoop.priority).toBeDefined();
    expect(frameLoop.priority).toBeLessThan(DEFAULT_FRAME_PRIORITY);
  });

  it('places the camera at eye height on the start pose, level, with YXZ order', () => {
    renderControls();

    runFrame(SETTLE_DELTA_SECONDS);

    expectFirstPersonCamera(START_POSE);
    expect(camera.position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    expect(camera.rotation.x).toBeCloseTo(LEVEL_PITCH);
  });

  it('walks at eye height while the forward key is held on the target', () => {
    renderControls();
    runFrame(SETTLE_DELTA_SECONDS);

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);

    expect(camera.position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    const walked = Math.hypot(camera.position.x - START_POSE.x, camera.position.z - START_POSE.z);
    expect(walked).toBeCloseTo(EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS);
    expect(camera.rotation.y).toBeCloseTo(START_POSE.yaw);
  });

  it('writes the stepped pose — not the whole step — back to the pose ref', () => {
    const { poseRef } = renderControls();

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    fireEvent.keyDown(target, { code: TURN_CODE });
    runFrame(WALK_DELTA_SECONDS);

    const pose = poseRef.current;
    expect(pose).not.toBe(START_POSE);
    // `stepEyePose` returns an `EyeStep` wrapping the pose; the ref must hold the pose itself,
    // or every later reader of it (the model, the reporter, the follower) is handed a step.
    expect(Object.keys(pose).sort()).toStrictEqual(EYE_POSE_KEYS);
    expect(walkedFrom(pose)).toBeCloseTo(EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS);
    expect(pose.yaw).toBeGreaterThan(START_POSE.yaw);
    expectFirstPersonCamera(pose);
  });

  it('follows the person from behind in third person, looking at the follow target', () => {
    renderControls({ cameraMode: 'thirdPerson' });

    runFrame(SETTLE_DELTA_SECONDS);

    expectThirdPersonCamera(START_POSE);
    expect(camera.position.y).toBeGreaterThan(PERSON_SPEC.eyeHeight);
  });

  it('keeps following while walking in third person', () => {
    const { poseRef } = renderControls({ cameraMode: 'thirdPerson' });

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);

    expect(walkedFrom(poseRef.current)).toBeGreaterThan(0);
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

  describe('on-screen remote control', () => {
    it('walks forward while the remote control holds moveForward, with no keyboard event', () => {
      const { poseRef } = renderControls();
      runFrame(SETTLE_DELTA_SECONDS);

      useRemoteControlStore.getState().pressAction('moveForward');
      runFrame(WALK_DELTA_SECONDS);

      expect(walkedFrom(poseRef.current)).toBeCloseTo(
        EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS,
      );
      expectFirstPersonCamera(poseRef.current);
    });

    it('turns while the remote control holds turnLeft, with no keyboard event', () => {
      const { poseRef } = renderControls();

      useRemoteControlStore.getState().pressAction('turnLeft');
      runFrame(WALK_DELTA_SECONDS);

      expect(poseRef.current.yaw).toBeCloseTo(
        START_POSE.yaw + EYE_NAVIGATION_CONFIG.turnSpeed * WALK_DELTA_SECONDS,
      );
    });

    it('combines a held key with a remote action in one intent', () => {
      const { poseRef } = renderControls();

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      useRemoteControlStore.getState().pressAction('turnLeft');
      runFrame(WALK_DELTA_SECONDS);

      expect(poseRef.current.yaw).toBeGreaterThan(START_POSE.yaw);
      expect(walkedFrom(poseRef.current)).toBeCloseTo(
        EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS,
      );
    });

    it('cancels a remote action against the opposite held key', () => {
      const { poseRef } = renderControls();

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      useRemoteControlStore.getState().pressAction('moveBackward');
      fireEvent.keyDown(target, { code: TURN_CODE });
      useRemoteControlStore.getState().pressAction('turnRight');
      runFrame(WALK_DELTA_SECONDS);

      expect(poseRef.current.x).toBeCloseTo(START_POSE.x);
      expect(poseRef.current.z).toBeCloseTo(START_POSE.z);
      expect(poseRef.current.yaw).toBeCloseTo(START_POSE.yaw);
    });

    it('counts an action held on both inputs once', () => {
      const { poseRef } = renderControls();

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      useRemoteControlStore.getState().pressAction('moveForward');
      runFrame(WALK_DELTA_SECONDS);

      expect(walkedFrom(poseRef.current)).toBeCloseTo(
        EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS,
      );
    });

    it('stops as soon as the remote action is released', () => {
      const { poseRef } = renderControls();
      useRemoteControlStore.getState().pressAction('moveForward');
      runFrame(WALK_DELTA_SECONDS);
      const walkedPose = poseRef.current;

      useRemoteControlStore.getState().releaseAction('moveForward');
      runFrame(WALK_DELTA_SECONDS);

      expect(poseRef.current).toEqual(walkedPose);
    });

    it('stops when every remote action is released at once', () => {
      const { poseRef } = renderControls();
      useRemoteControlStore.getState().pressAction('moveForward');
      useRemoteControlStore.getState().pressAction('turnLeft');
      runFrame(WALK_DELTA_SECONDS);
      const walkedPose = poseRef.current;

      useRemoteControlStore.getState().releaseAllActions();
      runFrame(WALK_DELTA_SECONDS);

      expect(poseRef.current).toEqual(walkedPose);
    });
  });

  describe('the automatic walk', () => {
    /** Asks for a walk, then forces the store into `status` when a finished walk is wanted. */
    const startWalk = (status: 'walking' | 'blocked' | 'unreachable' = 'walking') => {
      useRoomWalkStore.getState().startWalkTo(REAL_WALK_TARGET);
      if (status !== 'walking') {
        useRoomWalkStore.setState({ status });
      }
    };

    const walkStatus = () => useRoomWalkStore.getState().status;

    it('applies the automatic intent while the viewer asks for nothing', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      runFrame(WALK_DELTA_SECONDS);

      expect(poseRef.current.yaw).toBeCloseTo(
        START_POSE.yaw + EYE_NAVIGATION_CONFIG.turnSpeed * WALK_DELTA_SECONDS,
      );
      expect(walkStatus()).toBe('walking');
    });

    it('never tilts the view: the automatic intent asks for no look', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      runFrame(WALK_DELTA_SECONDS);

      expect(poseRef.current.pitch).toBe(LEVEL_PITCH);
    });

    it('lets one held key cancel the walk and steer, in the same frame', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      runFrame(WALK_DELTA_SECONDS);

      expect(walkStatus()).toBe('idle');
      // The manual intent won outright: the walk's turn never reached `stepEyePose`.
      expect(poseRef.current.yaw).toBeCloseTo(START_POSE.yaw);
      expect(walkedFrom(poseRef.current)).toBeCloseTo(
        EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS,
      );
    });

    it('lets one held pad action cancel the walk and steer, in the same frame', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      useRemoteControlStore.getState().pressAction('moveForward');
      runFrame(WALK_DELTA_SECONDS);

      expect(walkStatus()).toBe('idle');
      expect(poseRef.current.yaw).toBeCloseTo(START_POSE.yaw);
      expect(walkedFrom(poseRef.current)).toBeCloseTo(
        EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS,
      );
    });

    it('cancels the walk on a look-only input, which asks for no movement at all', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      fireEvent.keyDown(target, { code: LOOK_UP_CODE });
      runFrame(WALK_DELTA_SECONDS);

      expect(walkStatus()).toBe('idle');
      expect(poseRef.current.pitch).toBeGreaterThan(LEVEL_PITCH);
      expect(poseRef.current.yaw).toBeCloseTo(START_POSE.yaw);
    });

    it.each(['blocked', 'unreachable'] as const)(
      'clears a finished %s readout on the next manual input',
      (status) => {
        startWalk(status);
        renderControls();

        fireEvent.keyDown(target, { code: FORWARD_CODE });
        runFrame(WALK_DELTA_SECONDS);

        // Nothing else can clear the readout: the room readout has no other way to learn that
        // the viewer has moved on from a walk that failed.
        expect(walkStatus()).toBe('idle');
      },
    );

    it('leaves a finished readout standing while the viewer asks for nothing', () => {
      startWalk('blocked');
      renderControls();

      runFrame(WALK_DELTA_SECONDS);

      expect(walkStatus()).toBe('blocked');
    });

    it('walks the real floor with the real follower, never tilting the view', () => {
      routeFollower.useReal = true;
      useRoomWalkStore.getState().startWalkTo(REAL_WALK_TARGET);
      const { poseRef } = renderControls({
        initialPose: INTERIOR_START_POSE,
        field: WALK_FIELD,
        cameraField: CAMERA_FIELD,
      });

      for (let frame = 0; frame < REAL_WALK_FRAMES; frame += 1) {
        runFrame(FRAME_SECONDS);
      }

      expect(poseRef.current).not.toBe(INTERIOR_START_POSE);
      expect(poseRef.current).not.toEqual(INTERIOR_START_POSE);
      expect(poseRef.current.pitch).toBe(LEVEL_PITCH);
    });
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
