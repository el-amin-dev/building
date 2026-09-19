import type { RootState } from '@react-three/fiber';
import { render } from '@testing-library/react';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExteriorOrbitStore } from '../application/exteriorOrbitStore.ts';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { getExteriorFraming } from '../domain/exteriorFraming.ts';
import type { Vector3Like } from '../domain/exteriorFraming.ts';
import { PLOT_RECT } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import {
  clampOrbitPose,
  getOrbitLimits,
  getOrbitPose,
  getOrbitPosition,
} from '../domain/orbitNavigation.ts';
import type { OrbitPose } from '../domain/orbitNavigation.ts';
import { INITIAL_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { getThirdPersonCamera } from '../domain/thirdPersonCamera.ts';
import { getEyeCameraPose, VIEW_TRANSITION_SECONDS } from '../domain/viewTransition.ts';
import { getCameraFields, INTERIOR_START_POSE } from './floorInstance.ts';
import { CAMERA_FOV_DEGREES } from './useExteriorFraming.ts';
import { ViewTransition } from './ViewTransition.tsx';

type FrameCallback = (state: RootState, delta: number) => void;

/** The canvas the component believes it is in, and the frame callback it registered. */
const scene = vi.hoisted(() => ({
  width: 1920,
  height: 1080,
  callback: null as FrameCallback | null,
}));

// jsdom has no WebGL and no render loop: `useFrame` only records the callback so each test
// can run frames by hand against a real three.js camera, and `useThree` hands out the canvas
// size `useExteriorFraming` derives the framing from.
vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: FrameCallback) => {
    scene.callback = callback;
  },
  useThree: (selector: (state: { size: { width: number; height: number } }) => unknown) =>
    selector({ size: { width: scene.width, height: scene.height } }),
}));

/** The framing the mocked canvas size produces: what the component's endpoints use. */
const FRAMING = getExteriorFraming(
  PLOT_RECT,
  FLOOR_HEIGHTS,
  CAMERA_FOV_DEGREES,
  scene.width / scene.height,
  INITIAL_FLOOR_COUNT,
);

/** A frame at 60 fps, in seconds. */
const FRAME_SECONDS = 1 / 60;
/** Enough frames to finish the travel with room to spare. */
const FRAMES_TO_FINISH = Math.ceil(VIEW_TRANSITION_SECONDS / FRAME_SECONDS) + 2;
/** A first frame that advances no time, the way a settling frame does. */
const NO_TIME = 0;
/** Somewhere the viewer could have left the camera: not a framing of any canvas size. */
const LEFT_BEHIND: Vector3Like = { x: 12, y: 7, z: -9 };
/** A pose the viewer could have orbited to, inside the framing's zoom range. */
const ORBITED_POSE: OrbitPose = { azimuth: 1.1, polar: 1.2, distance: FRAMING.fitDistance };
/** Factor taking a distance past the framing's furthest, as a resize can leave it. */
const BEYOND_THE_LIMIT = 1.5;

/**
 * The camera field of the storey the visit starts on, at a given storey count.
 *
 * Written the way the component derives it — the start pose's own storey, out of the
 * stack's own table — so the case pins the hand-off rather than a number of its own.
 *
 * @param floorCount - How many storeys the stack shows.
 * @returns The field the follow camera is placed in when the viewer steps inside.
 */
const startCameraFieldAt = (floorCount: number) =>
  getCameraFields(floorCount)[INTERIOR_START_POSE.floor - MIN_FLOOR_COUNT];

/** A stack taller than the one the page opens with, to step the count to. */
const TALLER_STACK = 4;

/** The framing of that taller stack at the mocked canvas size. */
const TALLER_FRAMING = getExteriorFraming(
  PLOT_RECT,
  FLOOR_HEIGHTS,
  CAMERA_FOV_DEGREES,
  scene.width / scene.height,
  TALLER_STACK,
);

describe('ViewTransition', () => {
  let camera: PerspectiveCamera;

  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
    useExteriorOrbitStore.setState(useExteriorOrbitStore.getInitialState(), true);
    useFloorCountStore.setState(useFloorCountStore.getInitialState(), true);
    camera = new PerspectiveCamera();
    camera.position.set(LEFT_BEHIND.x, LEFT_BEHIND.y, LEFT_BEHIND.z);
    camera.lookAt(FRAMING.target.x, FRAMING.target.y, FRAMING.target.z);
    camera.updateMatrixWorld();
  });

  afterEach(() => {
    scene.callback = null;
  });

  /** Runs one frame of the registered callback on the test camera. */
  const runFrame = (delta: number) => {
    const callback = scene.callback;
    if (callback === null) {
      throw new Error('ViewTransition registered no frame callback');
    }
    callback({ camera } as unknown as RootState, delta);
  };

  /** Runs frames until the travel is over, or as many as it can possibly need. */
  const runToArrival = () => {
    for (let frame = 0; frame < FRAMES_TO_FINISH; frame += 1) {
      runFrame(FRAME_SECONDS);
    }
  };

  const expectCameraAt = (point: Vector3Like) => {
    expect(camera.position.x).toBeCloseTo(point.x);
    expect(camera.position.y).toBeCloseTo(point.y);
    expect(camera.position.z).toBeCloseTo(point.z);
  };

  /** Asserts the camera looks at `target` from where it stands. */
  const expectCameraLookingAt = (target: Vector3Like) => {
    const towardTarget = new Vector3(target.x, target.y, target.z).sub(camera.position).normalize();
    const direction = camera.getWorldDirection(new Vector3());
    expect(direction.x).toBeCloseTo(towardTarget.x);
    expect(direction.y).toBeCloseTo(towardTarget.y);
    expect(direction.z).toBeCloseTo(towardTarget.z);
  };

  const distanceTo = (point: Vector3Like) =>
    Math.hypot(
      camera.position.x - point.x,
      camera.position.y - point.y,
      camera.position.z - point.z,
    );

  it('renders nothing', () => {
    const { container } = render(<ViewTransition />);

    expect(container).toBeEmptyDOMElement();
  });

  it('does nothing at all while no transition is running', () => {
    render(<ViewTransition />);
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();

    runFrame(FRAME_SECONDS);
    runFrame(FRAME_SECONDS);

    expect(camera.position.equals(position)).toBe(true);
    expect(camera.quaternion.equals(quaternion)).toBe(true);
  });

  it('starts from the live camera pose, so the first frame does not jump', () => {
    render(<ViewTransition />);
    const position = camera.position.clone();
    const direction = camera.getWorldDirection(new Vector3()).clone();
    useViewStore.getState().toggleViewMode();

    runFrame(NO_TIME);

    expectCameraAt(position);
    const moved = camera.getWorldDirection(new Vector3());
    expect(moved.x).toBeCloseTo(direction.x);
    expect(moved.y).toBeCloseTo(direction.y);
    expect(moved.z).toBeCloseTo(direction.z);
  });

  it('drives the camera along the travel, part way and still running', () => {
    render(<ViewTransition />);
    const endPose = getEyeCameraPose(INTERIOR_START_POSE);
    useViewStore.getState().toggleViewMode();
    runFrame(NO_TIME);
    const startDistance = distanceTo(endPose.position);

    runFrame(VIEW_TRANSITION_SECONDS / 2);

    const distance = distanceTo(endPose.position);
    expect(distance).toBeLessThan(startDistance);
    expect(distance).toBeGreaterThan(0);
    expect(useViewStore.getState().cameraTransition).toBe('toInterior');
  });

  it('lands exactly on the first-person endpoint and reports the arrival', () => {
    render(<ViewTransition />);
    const endPose = getEyeCameraPose(INTERIOR_START_POSE);
    useViewStore.getState().toggleViewMode();

    runToArrival();

    expect(camera.position.x).toBe(endPose.position.x);
    expect(camera.position.y).toBe(endPose.position.y);
    expect(camera.position.z).toBe(endPose.position.z);
    expectCameraLookingAt(endPose.target);
    expect(useViewStore.getState().cameraTransition).toBe('none');
  });

  it('reports the arrival exactly once and then holds the endpoint', () => {
    render(<ViewTransition />);
    const endCameraTransition = vi.fn();
    useViewStore.setState({ endCameraTransition });
    const endPose = getEyeCameraPose(INTERIOR_START_POSE);
    useViewStore.getState().toggleViewMode();

    runToArrival();
    expect(endCameraTransition).toHaveBeenCalledTimes(1);

    runFrame(FRAME_SECONDS);
    runFrame(FRAME_SECONDS);

    expect(endCameraTransition).toHaveBeenCalledTimes(1);
    expectCameraAt(endPose.position);
  });

  it('lands on the third-person endpoint instead when the interior follows the person', () => {
    render(<ViewTransition />);
    const firstPerson = getEyeCameraPose(INTERIOR_START_POSE);
    const thirdPerson = getThirdPersonCamera(
      INTERIOR_START_POSE,
      startCameraFieldAt(INITIAL_FLOOR_COUNT),
    );
    useViewStore.getState().toggleInteriorCameraMode();
    useViewStore.getState().toggleViewMode();

    runToArrival();

    expectCameraAt(thirdPerson.position);
    expectCameraLookingAt(thirdPerson.target);
    // The two endpoints are genuinely different places: the first-person camera is in the
    // eyes, the follow camera behind the head. A travel landing on the wrong one would snap
    // the moment the interior control mounts.
    expect(distanceTo(firstPerson.position)).toBeGreaterThan(0);
  });

  it('takes the interior endpoint from the storey the viewer enters, at the live count', () => {
    useFloorCountStore.getState().setFloorCount(TALLER_STACK);
    render(<ViewTransition />);
    const thirdPerson = getThirdPersonCamera(INTERIOR_START_POSE, startCameraFieldAt(TALLER_STACK));
    useViewStore.getState().toggleInteriorCameraMode();
    useViewStore.getState().toggleViewMode();

    runToArrival();

    expectCameraAt(thirdPerson.position);
    expectCameraLookingAt(thirdPerson.target);
    expect(useFloorCountStore.getState().floorCount).toBe(TALLER_STACK);
  });

  describe('leaving the building', () => {
    /** Puts the store inside the building, then switches out, as the toggle does. */
    const startLeaving = () => {
      useViewStore.setState({ viewMode: 'interior' });
      useViewStore.getState().toggleViewMode();
      expect(useViewStore.getState().cameraTransition).toBe('toExterior');
    };

    it('ends at the framing default while no orbit pose is remembered', () => {
      render(<ViewTransition />);
      startLeaving();

      runToArrival();

      expectCameraAt(FRAMING.position);
      expectCameraLookingAt(FRAMING.target);
    });

    it('clamps a remembered pose the live framing no longer allows, as the controls do', () => {
      // The window was resized while the viewer was inside, so `maxDistance` is now below
      // the distance the pose was remembered at. The mounting controls place the camera at
      // the clamped pose, so the travel has to land there too or the hand-off snaps.
      render(<ViewTransition />);
      const illegal: OrbitPose = {
        ...ORBITED_POSE,
        distance: FRAMING.maxDistance * BEYOND_THE_LIMIT,
      };
      useExteriorOrbitStore.getState().rememberOrbitPose(illegal, INITIAL_FLOOR_COUNT);
      const clamped = clampOrbitPose(illegal, getOrbitLimits(FRAMING));
      startLeaving();

      runToArrival();

      expectCameraAt(getOrbitPosition(FRAMING.target, clamped));
      expectCameraLookingAt(FRAMING.target);
      expect(clamped.distance).toBe(FRAMING.maxDistance);
      expect(distanceTo(FRAMING.target)).toBeCloseTo(FRAMING.maxDistance);
      expect(distanceTo(getOrbitPosition(FRAMING.target, illegal))).toBeGreaterThan(0);
    });

    it('refits the distance when storeys were added while the viewer was inside', () => {
      // The stepper is mounted in both views, so the count can change with the exterior
      // controls unmounted: the flight has to come back out framing the stack that is
      // there now, not the one the remembered distance was chosen for.
      useExteriorOrbitStore.getState().rememberOrbitPose(ORBITED_POSE, INITIAL_FLOOR_COUNT);
      useFloorCountStore.getState().setFloorCount(TALLER_STACK);
      render(<ViewTransition />);
      const refitted = clampOrbitPose(
        {
          azimuth: ORBITED_POSE.azimuth,
          polar: ORBITED_POSE.polar,
          distance: getOrbitPose(TALLER_FRAMING.target, TALLER_FRAMING.position).distance,
        },
        getOrbitLimits(TALLER_FRAMING),
      );
      startLeaving();

      runToArrival();

      expectCameraAt(getOrbitPosition(TALLER_FRAMING.target, refitted));
      expectCameraLookingAt(TALLER_FRAMING.target);
      expect(refitted.azimuth).toBeCloseTo(ORBITED_POSE.azimuth);
      expect(refitted.distance).not.toBeCloseTo(ORBITED_POSE.distance);
      expect(distanceTo(TALLER_FRAMING.target)).toBeCloseTo(refitted.distance);
    });

    it('ends at the remembered orbit pose when the viewer has framed the exterior', () => {
      render(<ViewTransition />);
      useExteriorOrbitStore.getState().rememberOrbitPose(ORBITED_POSE, INITIAL_FLOOR_COUNT);
      const remembered = getOrbitPosition(FRAMING.target, ORBITED_POSE);
      startLeaving();

      runToArrival();

      expectCameraAt(remembered);
      expectCameraLookingAt(FRAMING.target);
      expect(
        Math.hypot(
          remembered.x - FRAMING.position.x,
          remembered.y - FRAMING.position.y,
          remembered.z - FRAMING.position.z,
        ),
      ).toBeGreaterThan(0);
    });
  });
});
