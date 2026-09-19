import { render } from '@testing-library/react';
import { Euler, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeWalkField } from '../domain/collision.ts';
import { getFootLevel } from '../domain/eyeNavigation.ts';
import type { EyePose, WalkSurface } from '../domain/eyeNavigation.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { makeRect } from '../domain/planGeometry.ts';
import type { Stairwell } from '../domain/stairwell.ts';
import { getStoreyLevel, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { createCameraField } from '../domain/thirdPersonCamera.ts';
import type { CameraField } from '../domain/thirdPersonCamera.ts';
import { PersonModel } from './PersonModel.tsx';

type FrameCallback = () => void;

// jsdom has no WebGL and no render loop: `useFrame` only records the latest callback, which
// each test then runs by hand. The scene graph itself renders as plain unknown elements.
const frameLoop = vi.hoisted(() => ({ callback: null as FrameCallback | null }));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: FrameCallback) => {
    frameLoop.callback = callback;
  },
}));

/** Plan half-size of the open room the poses stand in, metres. */
const ROOM_HALF_SIZE = 20;
const FAR_AWAY = 1000;
const BAY_SIZE = 1;
const REACH = 0.25;

/** A bay nowhere near the room: these poses stand on a flat storey, never on a stair. */
const NO_STAIR_WELL: Stairwell = Object.freeze({
  bay: makeRect(FAR_AWAY, FAR_AWAY + BAY_SIZE, FAR_AWAY, FAR_AWAY + BAY_SIZE),
  ramps: [],
  landings: [],
  reach: REACH,
});

const OPEN_SURFACE: WalkSurface = Object.freeze({
  field: makeWalkField(
    [makeRect(-ROOM_HALF_SIZE, ROOM_HALF_SIZE, -ROOM_HALF_SIZE, ROOM_HALF_SIZE)],
    [],
  ),
  bayField: makeWalkField(
    [makeRect(-ROOM_HALF_SIZE, ROOM_HALF_SIZE, -ROOM_HALF_SIZE, ROOM_HALF_SIZE)],
    [],
  ),
  well: NO_STAIR_WELL,
  floorToFloor: FLOOR_HEIGHTS.floorToFloor,
});
const CAMERA_FIELD: CameraField = createCameraField(OPEN_SURFACE, FLOOR_HEIGHTS.wall);

const ROOM_CENTRE = 0;
const LEVEL_PITCH = 0;
/** Turned off the axes, so the yaw copied into the group is unmistakable. */
const POSE_YAW = 0.6;
const GROUND_FLOOR = MIN_FLOOR_COUNT;
const FLOOR_PLANE_RISE = 0;
/** A storey well up the stack, and a rise part way up the flight out of it. */
const UPPER_FLOOR = 3;
const HALF_STOREY_RISE = 1.5;

const GROUND_POSE: EyePose = Object.freeze({
  x: ROOM_CENTRE,
  z: ROOM_CENTRE,
  yaw: POSE_YAW,
  pitch: LEVEL_PITCH,
  floor: GROUND_FLOOR,
  rise: FLOOR_PLANE_RISE,
});

/**
 * The three.js object properties the component writes into its group, on the DOM node jsdom
 * hands the ref.
 *
 * `<group>` renders as an unrecognised element here, so the ref holds an element rather than
 * a three.js `Group`; giving it a real `Vector3` and `Euler` lets the component's own writes
 * be read back exactly as three would store them, without a renderer.
 */
interface GroupStandIn {
  position: Vector3;
  rotation: Euler;
  visible: boolean;
}

describe('PersonModel', () => {
  afterEach(() => {
    frameLoop.callback = null;
  });

  /** Renders the model over a pose ref and returns the group the frame callback writes to. */
  const renderModel = (
    pose: EyePose,
    cameraMode: 'firstPerson' | 'thirdPerson' = 'thirdPerson',
  ) => {
    const poseRef = { current: pose };
    const { container } = render(
      <PersonModel poseRef={poseRef} field={CAMERA_FIELD} cameraMode={cameraMode} />,
    );
    const element = container.firstElementChild;
    if (element === null) {
      throw new Error('PersonModel rendered no group');
    }
    const group = Object.assign(element, {
      position: new Vector3(),
      rotation: new Euler(),
      visible: false,
    }) as unknown as GroupStandIn;
    return { group, poseRef };
  };

  /** Runs one frame of the recorded callback. */
  const runFrame = () => {
    const callback = frameLoop.callback;
    if (callback === null) {
      throw new Error('PersonModel registered no frame callback');
    }
    callback();
  };

  it('stands the mannequin at the pose’s plan position, turned by its yaw', () => {
    const { group } = renderModel(GROUND_POSE);

    runFrame();

    expect(group.position.x).toBeCloseTo(GROUND_POSE.x);
    expect(group.position.z).toBeCloseTo(GROUND_POSE.z);
    expect(group.rotation.y).toBeCloseTo(GROUND_POSE.yaw);
  });

  it('stands it on the storey the pose is on, not on the ground floor', () => {
    const upstairs: EyePose = { ...GROUND_POSE, floor: UPPER_FLOOR };
    const { group } = renderModel(upstairs);

    runFrame();

    expect(group.position.y).toBeCloseTo(getFootLevel(upstairs));
    expect(group.position.y).toBeCloseTo(getStoreyLevel(UPPER_FLOOR));
  });

  it('carries it up the flight it is climbing: the storey level plus the rise', () => {
    const climbing: EyePose = { ...GROUND_POSE, floor: UPPER_FLOOR, rise: HALF_STOREY_RISE };
    const { group } = renderModel(climbing);

    runFrame();

    expect(group.position.y).toBeCloseTo(getFootLevel(climbing));
    expect(group.position.y).toBeCloseTo(getStoreyLevel(UPPER_FLOOR) + HALF_STOREY_RISE);
  });

  it('follows the pose the controls step, frame by frame', () => {
    const { group, poseRef } = renderModel(GROUND_POSE);
    runFrame();

    poseRef.current = { ...GROUND_POSE, floor: UPPER_FLOOR, x: GROUND_POSE.x + 1 };
    runFrame();

    expect(group.position.x).toBeCloseTo(GROUND_POSE.x + 1);
    expect(group.position.y).toBeCloseTo(getStoreyLevel(UPPER_FLOOR));
  });

  it('is shown in third person and hidden in first', () => {
    const shown = renderModel(GROUND_POSE);
    runFrame();
    expect(shown.group.visible).toBe(true);

    const hidden = renderModel(GROUND_POSE, 'firstPerson');
    runFrame();
    expect(hidden.group.visible).toBe(false);
  });
});
