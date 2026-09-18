import type { RootState } from '@react-three/fiber';
import { fireEvent, render } from '@testing-library/react';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { makeWalkField } from '../domain/collision.ts';
import type { WalkField } from '../domain/collision.ts';
import { EYE_KEY_BINDINGS, EYE_NAVIGATION_CONFIG, getEyeLevel } from '../domain/eyeNavigation.ts';
import type { EyeAction, EyePose, MovementIntent, WalkSurface } from '../domain/eyeNavigation.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import { makeRect } from '../domain/planGeometry.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import type { Stairwell } from '../domain/stairwell.ts';
import { MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { createCameraField, getThirdPersonCamera } from '../domain/thirdPersonCamera.ts';
import type { CameraField, ScenePoint } from '../domain/thirdPersonCamera.ts';
import { CAMERA_MODE_TOGGLE_KEY_CODE } from '../domain/viewMode.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import { EyeCameraControls } from './EyeCameraControls.tsx';
import { getCameraFields, getWalkSurfaces, INTERIOR_START_POSE } from './floorInstance.ts';

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

/**
 * A stair bay far from the synthetic room, so no test pose is ever near one.
 *
 * The stairwell is `eyeNavigation.test.ts`'s subject; here the storey is the flat floor the
 * frame loop has always walked, and what matters is only WHICH surface of the list is picked.
 */
const FAR_AWAY = 1000;
const BAY_SIZE = 1;
const REACH = 0.25;
const NO_STAIR_WELL: Stairwell = Object.freeze({
  bay: makeRect(FAR_AWAY, FAR_AWAY + BAY_SIZE, FAR_AWAY, FAR_AWAY + BAY_SIZE),
  ramps: [],
  landings: [],
  reach: REACH,
});

/** Wraps a plan field as the walking surface of one storey, with no stair anywhere near. */
function surfaceOf(field: WalkField): WalkSurface {
  return Object.freeze({
    field,
    bayField: field,
    well: NO_STAIR_WELL,
    floorToFloor: FLOOR_HEIGHTS.floorToFloor,
  });
}

const OPEN_SURFACE: WalkSurface = surfaceOf(OPEN_FIELD);
const OPEN_CAMERA_FIELD: CameraField = createCameraField(OPEN_SURFACE, FLOOR_HEIGHTS.wall);
/** A one-storey stack of the open room: what every test walks unless it says otherwise. */
const OPEN_STOREYS: readonly WalkSurface[] = Object.freeze([OPEN_SURFACE]);
const OPEN_CAMERA_FIELDS: readonly CameraField[] = Object.freeze([OPEN_CAMERA_FIELD]);

/**
 * A storey walled off straight ahead of a pose at yaw 0: the face stands exactly one body
 * radius away, so the body cannot advance along −z by any amount at all.
 */
const WALLED_SURFACE: WalkSurface = surfaceOf(
  makeWalkField(
    [ROOM_RECT],
    [makeRect(-ROOM_HALF_SIZE, ROOM_HALF_SIZE, -ROOM_HALF_SIZE, -PERSON_SPEC.radius)],
  ),
);

/** The storey a synthetic pose stands on unless the case says otherwise. */
const GROUND_FLOOR = MIN_FLOOR_COUNT;
/** Standing on the finished floor of that storey, not part way up a flight. */
const FLOOR_PLANE_RISE = 0;

const START_POSE: EyePose = Object.freeze({
  x: ROOM_CENTRE,
  z: ROOM_CENTRE,
  yaw: START_POSE_YAW,
  pitch: LEVEL_PITCH,
  floor: GROUND_FLOOR,
  rise: FLOOR_PLANE_RISE,
});

/** Facing straight along −z, so a wall across the room is a wall straight ahead. */
const FACING_WALL_YAW = 0;
/** The storey a two-storey test pose stands on: the upper one. */
const UPPER_FLOOR = GROUND_FLOOR + 1;
/** A storey far above any stack these tests build, to be clamped back into the list. */
const OFF_THE_TOP_FLOOR = 3;
/** The eye level of a pose standing on the third storey, in metres: 2 × 3.00 + 1.68. */
const THIRD_STOREY_EYE_LEVEL = 7.68;

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
const EYE_POSE_KEYS = ['floor', 'pitch', 'rise', 'x', 'yaw', 'z'];

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
const BACKWARD_CODE = keyFor('moveBackward');
const TURN_CODE = keyFor('turnLeft');
const LOOK_UP_CODE = keyFor('lookUp');

/** How the controls are rendered; every field has a default. */
interface RenderOptions {
  /** First or third person; first by default. */
  readonly cameraMode?: InteriorCameraMode;
  /** The pose the test-owned ref starts at. */
  readonly initialPose?: EyePose;
  /** The walking surface of every storey of the stack, lowest first. */
  readonly surfaces?: readonly WalkSurface[];
  /** The field the follow camera is placed in, per storey. */
  readonly cameraFields?: readonly CameraField[];
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
    surfaces = OPEN_STOREYS,
    cameraFields = OPEN_CAMERA_FIELDS,
  }: RenderOptions = {}) => {
    const targetRef = { current: target };
    const poseRef = { current: initialPose };
    const renderWith = (mode: InteriorCameraMode) => (
      <EyeCameraControls
        targetRef={targetRef}
        poseRef={poseRef}
        cameraMode={mode}
        surfaces={surfaces}
        cameraFields={cameraFields}
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
    expectCameraAt({ x: pose.x, y: getEyeLevel(pose), z: pose.z });
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
    expect(camera.position.y).toBeCloseTo(getEyeLevel(START_POSE));
    expect(camera.rotation.x).toBeCloseTo(LEVEL_PITCH);
  });

  it('walks at eye height while the forward key is held on the target', () => {
    renderControls();
    runFrame(SETTLE_DELTA_SECONDS);

    fireEvent.keyDown(target, { code: FORWARD_CODE });
    runFrame(WALK_DELTA_SECONDS);

    expect(camera.position.y).toBeCloseTo(getEyeLevel(START_POSE));
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
    expect(camera.position.y).toBeGreaterThan(getEyeLevel(START_POSE));
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

    it('cancels the walk on two opposite keys, which collapse to no movement', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      fireEvent.keyDown(target, { code: BACKWARD_CODE });
      runFrame(WALK_DELTA_SECONDS);

      // The viewer's hands are plainly on the controls, so the trip is over even though the
      // two keys ask for nothing between them; the body stays put rather than walking on.
      expect(walkStatus()).toBe('idle');
      expect(walkedFrom(poseRef.current)).toBeCloseTo(0);
      expect(poseRef.current.yaw).toBeCloseTo(START_POSE.yaw);
    });

    it('cancels the walk on the pad’s own opposite pair', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      useRemoteControlStore.getState().pressAction('moveForward');
      useRemoteControlStore.getState().pressAction('moveBackward');
      runFrame(WALK_DELTA_SECONDS);

      expect(walkStatus()).toBe('idle');
      expect(walkedFrom(poseRef.current)).toBeCloseTo(0);
      expect(poseRef.current.yaw).toBeCloseTo(START_POSE.yaw);
    });

    it('leaves the walk running under a key that steers nothing, such as the mode toggle', () => {
      routeFollower.intent = AUTO_TURN_INTENT;
      startWalk();
      const { poseRef } = renderControls();

      fireEvent.keyDown(target, { code: CAMERA_MODE_TOGGLE_KEY_CODE });
      runFrame(WALK_DELTA_SECONDS);

      expect(walkStatus()).toBe('walking');
      expect(poseRef.current.yaw).toBeCloseTo(
        START_POSE.yaw + EYE_NAVIGATION_CONFIG.turnSpeed * WALK_DELTA_SECONDS,
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
        surfaces: getWalkSurfaces(MIN_FLOOR_COUNT),
        cameraFields: getCameraFields(MIN_FLOOR_COUNT),
      });

      for (let frame = 0; frame < REAL_WALK_FRAMES; frame += 1) {
        runFrame(FRAME_SECONDS);
      }

      expect(poseRef.current).not.toBe(INTERIOR_START_POSE);
      expect(poseRef.current).not.toEqual(INTERIOR_START_POSE);
      expect(poseRef.current.pitch).toBe(LEVEL_PITCH);
    });
  });

  describe('the storey the pose stands on', () => {
    /** The two-storey stack these cases walk: walled below, open above. */
    const TWO_STOREYS: readonly WalkSurface[] = Object.freeze([WALLED_SURFACE, OPEN_SURFACE]);
    /** Facing the wall of the lower storey, standing on the lower storey. */
    const WALL_POSE: EyePose = Object.freeze({ ...START_POSE, yaw: FACING_WALL_YAW });
    /** The same plan position, one storey up. */
    const UPPER_POSE: EyePose = Object.freeze({ ...WALL_POSE, floor: UPPER_FLOOR });

    it('walks the surface of the storey the pose names, not the first of the list', () => {
      const { poseRef } = renderControls({ initialPose: UPPER_POSE, surfaces: TWO_STOREYS });

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      runFrame(WALK_DELTA_SECONDS);

      // The upper storey is open, so the step is taken in full: the wall belongs to the
      // storey below and must not stop a body walking above it.
      expect(walkedFrom(poseRef.current, UPPER_POSE)).toBeCloseTo(
        EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS,
      );
      expect(poseRef.current.floor).toBe(UPPER_FLOOR);
    });

    it('is stopped by the blocker of its own storey', () => {
      const { poseRef } = renderControls({ initialPose: WALL_POSE, surfaces: TWO_STOREYS });

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      runFrame(WALK_DELTA_SECONDS);

      expect(walkedFrom(poseRef.current, WALL_POSE)).toBeCloseTo(0);
    });

    it('clamps a pose standing a storey above the stack it is handed', () => {
      // A reduction of the storey count re-renders the parent, but the pose it relocates is
      // a ref read on the next frame: for one frame the pose can name a storey that is gone.
      const ahead: EyePose = { ...START_POSE, floor: OFF_THE_TOP_FLOOR };
      const { poseRef } = renderControls({ initialPose: ahead });

      fireEvent.keyDown(target, { code: FORWARD_CODE });
      expect(() => {
        runFrame(WALK_DELTA_SECONDS);
      }).not.toThrow();

      expect(walkedFrom(poseRef.current, ahead)).toBeCloseTo(
        EYE_NAVIGATION_CONFIG.walkSpeed * WALK_DELTA_SECONDS,
      );
    });

    it('places the first-person camera at the eye level of the storey, not at eye height', () => {
      const onThirdStorey: EyePose = { ...START_POSE, floor: OFF_THE_TOP_FLOOR };
      renderControls({ initialPose: onThirdStorey });

      runFrame(SETTLE_DELTA_SECONDS);

      // Two storeys of 3.00 m under the feet, plus the 1.68 m eye height of the person.
      expect(camera.position.y).toBeCloseTo(THIRD_STOREY_EYE_LEVEL);
      expect(camera.position.y).toBeCloseTo(getEyeLevel(onThirdStorey));
      expect(camera.position.y).toBeGreaterThan(PERSON_SPEC.eyeHeight);
    });

    it('follows in the camera field of the storey the step ends on', () => {
      const LOW_CEILING = FLOOR_HEIGHTS.wall / 2;
      const upperField = createCameraField(OPEN_SURFACE, LOW_CEILING);
      renderControls({
        cameraMode: 'thirdPerson',
        initialPose: UPPER_POSE,
        surfaces: TWO_STOREYS,
        cameraFields: [OPEN_CAMERA_FIELD, upperField],
      });

      runFrame(SETTLE_DELTA_SECONDS);

      const expected = getThirdPersonCamera(UPPER_POSE, upperField);
      expectCameraAt(expected.position);
      expect(expected.position.y).not.toBeCloseTo(
        getThirdPersonCamera(UPPER_POSE, OPEN_CAMERA_FIELD).position.y,
      );
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
