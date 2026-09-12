import type { RootState } from '@react-three/fiber';
import { fireEvent, render } from '@testing-library/react';
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExteriorOrbitStore } from '../application/exteriorOrbitStore.ts';
import { useOrbitControlStore } from '../application/orbitControlStore.ts';
import { getExteriorFraming } from '../domain/exteriorFraming.ts';
import type { ExteriorFraming, Vector3Like } from '../domain/exteriorFraming.ts';
import { PLOT_RECT } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import {
  clampOrbitPose,
  getOrbitLimits,
  getOrbitPose,
  getOrbitPosition,
  ORBIT_NAVIGATION_CONFIG,
} from '../domain/orbitNavigation.ts';
import type { OrbitPose } from '../domain/orbitNavigation.ts';
import { getSlabThickness } from '../domain/slabs.ts';
import { ExteriorCameraControls } from './ExteriorCameraControls.tsx';
import { CAMERA_FOV_DEGREES } from './useExteriorFraming.ts';

/** A canvas size in CSS pixels, as `useThree` reports it. */
interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/** The props the component gives the orbit controls; every one of them is asserted. */
interface CapturedOrbitProps {
  readonly makeDefault?: boolean;
  readonly target?: readonly [number, number, number];
  readonly minDistance?: number;
  readonly maxDistance?: number;
  readonly minPolarAngle?: number;
  readonly maxPolarAngle?: number;
  readonly onEnd?: () => void;
}

/** The part of the three.js store this component reads. */
interface ThreeStateStub {
  readonly size: CanvasSize;
  readonly get: () => { readonly camera: PerspectiveCamera };
  readonly controls: { readonly update: () => void };
}

type FrameCallback = (state: RootState, delta: number) => void;

/** The canvas the component is rendered in: its size, its camera and the captured props. */
const scene = vi.hoisted(() => ({
  width: 0,
  height: 0,
  camera: null as PerspectiveCamera | null,
  orbitProps: null as CapturedOrbitProps | null,
  controlUpdates: 0,
}));

// jsdom has no WebGL and no render loop: the three.js store is replaced by the values the
// component reads — the canvas size, the default camera and the default controls — so
// `getExteriorFraming` is driven by a size each test sets and the camera is a real three.js
// camera the placement can be asserted on, while `useFrame` only records the latest callback
// and its priority so each test can run frames by hand.
const frameLoop = vi.hoisted(() => ({
  callback: null as FrameCallback | null,
  priority: undefined as number | undefined,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: ThreeStateStub) => unknown) =>
    selector({
      size: { width: scene.width, height: scene.height },
      get: () => ({ camera: getCamera() }),
      controls: {
        update: () => {
          scene.controlUpdates += 1;
        },
      },
    }),
  useFrame: (callback: FrameCallback, priority?: number) => {
    frameLoop.callback = callback;
    frameLoop.priority = priority;
  },
}));
// The orbit controls are replaced by a prop recorder: drei's own controls need a WebGL
// renderer and a DOM event target, and what matters here is the framing they are given.
vi.mock('@react-three/drei', () => ({
  OrbitControls: (props: CapturedOrbitProps) => {
    scene.orbitProps = props;
    return null;
  },
}));

const HALF = 0.5;
/** Near and far planes of the app's camera, in metres (see `BuildingScene`). */
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;
/** The three.js default Euler order, which the exterior view restores. */
const EXTERIOR_EULER_ORDER = 'XYZ';
/** Priority of `useFrame` callbacks registered without one, e.g. a scene prop's. */
const DEFAULT_FRAME_PRIORITY = 0;
/** A desktop canvas, wider than it is tall: 1920 × 1080 CSS pixels. */
const WIDESCREEN: CanvasSize = { width: 1920, height: 1080 };
/** A phone canvas, narrower than it is tall: 400 × 800 CSS pixels. */
const PHONE: CanvasSize = { width: 400, height: 800 };
/** Somewhere the user could have orbited to: not a framing of any canvas size. */
const ORBITED_POSITION: readonly [number, number, number] = [12, 7, -9];

const ORBIT_LEFT_CODE = 'ArrowLeft';
const ORBIT_RIGHT_CODE = 'ArrowRight';
const TILT_UP_CODE = 'ArrowUp';
const TILT_DOWN_CODE = 'ArrowDown';
const ZOOM_IN_CODE = 'Equal';
const ZOOM_OUT_CODE = 'Minus';

/** One frame of holding a key, in seconds: the stepper's own cap, so nothing is discarded. */
const FRAME_DELTA_SECONDS = ORBIT_NAVIGATION_CONFIG.maxStepSeconds;
/** A frame that advances no time, to place the camera without moving it. */
const SETTLE_DELTA_SECONDS = 0;
/**
 * Frames of holding one key: twenty seconds of input, far longer than any axis needs to
 * cross its whole range (the zoom range takes under two seconds, the tilt range two).
 */
const HOLD_FRAMES = 200;
/** Idle frames run after a release, to prove the pose is remembered only once. */
const IDLE_FRAMES = 3;
/** One write of the remembered pose. */
const SINGLE_WRITE = 1;

/**
 * Tolerance for comparing two orbit distances, in metres.
 *
 * A pose is written to the camera as a position and read back as a pose, so a distance that
 * did not change still travels through a square root: a few ulps at the tens of metres the
 * exterior camera sits at is around `1e-14` m. This sits far above that and far below any
 * real zoom (the slowest zoom frame moves the camera by centimetres).
 */
const DISTANCE_TOLERANCE_METRES = 1e-9;

/** Orbit pivot the framing must produce: the centre of the plot at half the wall height. */
const EXPECTED_TARGET: readonly [number, number, number] = [
  (PLOT_RECT.minX + PLOT_RECT.maxX) * HALF,
  FLOOR_HEIGHTS.wall * HALF,
  (PLOT_RECT.minZ + PLOT_RECT.maxZ) * HALF,
];

/** Vertical span of the floor: from the underside of its slabs to the top of its walls. */
const FLOOR_BOTTOM = -getSlabThickness();
const FLOOR_TOP = FLOOR_HEIGHTS.wall;

/**
 * Returns the camera of the current test.
 *
 * @returns The camera the mocked store hands out.
 * @throws Error when no test has rendered the controls yet.
 */
function getCamera(): PerspectiveCamera {
  if (scene.camera === null) {
    throw new Error('no camera: the controls were not rendered');
  }
  return scene.camera;
}

/**
 * Returns the props the component last gave the orbit controls.
 *
 * @returns The captured props.
 * @throws Error when the controls were not rendered.
 */
function getOrbitProps(): CapturedOrbitProps {
  if (scene.orbitProps === null) {
    throw new Error('the orbit controls were not rendered');
  }
  return scene.orbitProps;
}

/** A mounted canvas: its camera, a way to change the size, and a way to take it down. */
interface MountedCanvas {
  /** The default camera the controls move. */
  readonly camera: PerspectiveCamera;
  /** Resizes the canvas and re-renders, as a resize of the viewport does. */
  readonly reframeTo: (size: CanvasSize) => void;
  /** Unmounts the controls, as switching to the interior view does. */
  readonly unmount: () => void;
}

/**
 * The framing the component must derive for a canvas size.
 *
 * @param size - The canvas size.
 * @returns The framing of the real plot at that aspect ratio.
 */
function framingFor(size: CanvasSize): ExteriorFraming {
  return getExteriorFraming(PLOT_RECT, FLOOR_HEIGHTS, CAMERA_FOV_DEGREES, size.width / size.height);
}

/** The orbit pivot, the same at every canvas size: the centre of the plot. */
const TARGET: Vector3Like = framingFor(WIDESCREEN).target;

/**
 * The pose the framing of a canvas size starts the camera at.
 *
 * @param size - The canvas size.
 * @returns The start pose of that framing.
 */
function framingPoseFor(size: CanvasSize): OrbitPose {
  const framing = framingFor(size);
  return getOrbitPose(framing.target, framing.position);
}

/**
 * Reads the orbit pose off the camera, around the framing pivot.
 *
 * @param camera - The camera as the controls left it.
 * @returns Where it sits on the sphere around the orbit target.
 */
function poseOf(camera: PerspectiveCamera): OrbitPose {
  return getOrbitPose(TARGET, camera.position);
}

/**
 * Asserts that every corner of the floor is inside the camera's view frustum.
 *
 * This is what "the floor fits" means: the box spanning the plot on the plan and, in
 * height, from the underside of the slabs to the top of the walls.
 *
 * @param camera - The camera as the controls left it.
 */
function expectWholeFloorVisible(camera: PerspectiveCamera): void {
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );

  for (const x of [PLOT_RECT.minX, PLOT_RECT.maxX]) {
    for (const y of [FLOOR_BOTTOM, FLOOR_TOP]) {
      for (const z of [PLOT_RECT.minZ, PLOT_RECT.maxZ]) {
        expect(
          frustum.containsPoint(new Vector3(x, y, z)),
          `the floor corner (${String(x)}, ${String(y)}, ${String(z)}) must be in view`,
        ).toBe(true);
      }
    }
  }
}

/**
 * Asserts that the camera looks straight at a point.
 *
 * @param camera - The camera as the controls left it.
 * @param point - The point it must look at.
 */
function expectLookingAt(
  camera: PerspectiveCamera,
  point: readonly [number, number, number],
): void {
  const toward = new Vector3(...point).sub(camera.position).normalize();
  const direction = camera.getWorldDirection(new Vector3());

  expect(direction.x).toBeCloseTo(toward.x);
  expect(direction.y).toBeCloseTo(toward.y);
  expect(direction.z).toBeCloseTo(toward.z);
}

/**
 * Asserts that the camera sits exactly where a pose puts it.
 *
 * @param camera - The camera as the controls left it.
 * @param pose - The pose it must have been placed from.
 */
function expectCameraAtPose(camera: PerspectiveCamera, pose: OrbitPose): void {
  const expected = getOrbitPosition(TARGET, pose);

  expect(camera.position.x).toBeCloseTo(expected.x);
  expect(camera.position.y).toBeCloseTo(expected.y);
  expect(camera.position.z).toBeCloseTo(expected.z);
}

describe('ExteriorCameraControls', () => {
  let region: HTMLDivElement;

  beforeEach(() => {
    useExteriorOrbitStore.setState(useExteriorOrbitStore.getInitialState(), true);
    useOrbitControlStore.setState(useOrbitControlStore.getInitialState(), true);
    scene.camera = null;
    scene.orbitProps = null;
    scene.controlUpdates = 0;
    frameLoop.callback = null;
    frameLoop.priority = undefined;
    region = document.createElement('div');
    region.tabIndex = 0;
    document.body.appendChild(region);
    region.focus();
  });

  afterEach(() => {
    region.remove();
  });

  /**
   * Mounts the controls in a canvas of the given size, with the app's camera settings.
   *
   * @param size - The canvas size `useThree` reports.
   * @returns The camera, and ways to resize and unmount the canvas.
   */
  const mountAt = (size: CanvasSize): MountedCanvas => {
    scene.width = size.width;
    scene.height = size.height;
    const camera = new PerspectiveCamera(
      CAMERA_FOV_DEGREES,
      size.width / size.height,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    scene.camera = camera;
    const targetRef = { current: region };
    const { rerender, unmount } = render(<ExteriorCameraControls targetRef={targetRef} />);

    return {
      camera,
      reframeTo: (next: CanvasSize) => {
        scene.width = next.width;
        scene.height = next.height;
        camera.aspect = next.width / next.height;
        camera.updateProjectionMatrix();
        rerender(<ExteriorCameraControls targetRef={targetRef} />);
      },
      unmount,
    };
  };

  /**
   * Renders the controls in a canvas of the given size, with the app's camera settings.
   *
   * @param size - The canvas size `useThree` reports.
   * @returns The camera the controls were given.
   */
  const renderAt = (size: CanvasSize): PerspectiveCamera => mountAt(size).camera;

  /** Runs one frame of the latest registered `useFrame` callback on the test camera. */
  const runFrame = (delta: number): void => {
    const callback = frameLoop.callback;
    if (callback === null) {
      throw new Error('ExteriorCameraControls registered no frame callback');
    }
    callback({ camera: getCamera() } as unknown as RootState, delta);
  };

  /** Runs several frames of held input, as holding a key for a moment does. */
  const runFrames = (count: number): void => {
    for (let frame = 0; frame < count; frame += 1) {
      runFrame(FRAME_DELTA_SECONDS);
    }
  };

  /**
   * Tells the controls a pointer orbit or a wheel zoom has ended, as drei's `onEnd` does.
   *
   * @throws Error when the controls report no end of an orbit, which is the whole point:
   *   without it the component cannot know where the pointer left the camera.
   */
  const endOrbit = (): void => {
    const { onEnd } = getOrbitProps();
    if (onEnd === undefined) {
      throw new Error('the orbit controls were given no onEnd handler');
    }
    onEnd();
  };

  /**
   * Returns the pose the store remembers.
   *
   * @returns The remembered pose.
   * @throws Error when nothing has been remembered, which every mount must do.
   */
  const getRemembered = (): OrbitPose => {
    const { orbitPose } = useExteriorOrbitStore.getState();
    if (orbitPose === undefined) {
      throw new Error('no pose was remembered');
    }
    return orbitPose;
  };

  it('orbits around the centre of the plot at half the wall height', () => {
    renderAt(WIDESCREEN);

    const props = getOrbitProps();
    expect(props.target).toEqual(EXPECTED_TARGET);
    expect(props.makeDefault).toBe(true);
  });

  it('takes the start position and the zoom limits from the framing of the canvas', () => {
    const framing = framingFor(WIDESCREEN);

    const camera = renderAt(WIDESCREEN);

    const props = getOrbitProps();
    expect(props.minDistance).toBe(framing.minDistance);
    expect(props.maxDistance).toBe(framing.maxDistance);
    expect(camera.position.x).toBeCloseTo(framing.position.x);
    expect(camera.position.y).toBeCloseTo(framing.position.y);
    expect(camera.position.z).toBeCloseTo(framing.position.z);
    expect(camera.rotation.order).toBe(EXTERIOR_EULER_ORDER);
    expectLookingAt(camera, EXPECTED_TARGET);
    expectWholeFloorVisible(camera);
  });

  it('seeds the remembered pose from the framing on the first mount of a session', () => {
    const expected = framingPoseFor(WIDESCREEN);

    renderAt(WIDESCREEN);

    const remembered = getRemembered();
    expect(remembered.azimuth).toBeCloseTo(expected.azimuth);
    expect(remembered.polar).toBeCloseTo(expected.polar);
    expect(remembered.distance).toBeCloseTo(expected.distance);
  });

  it('keeps the closest zoom outside the building and the furthest past it', () => {
    const framing = framingFor(WIDESCREEN);

    renderAt(WIDESCREEN);

    const props = getOrbitProps();
    expect(props.minDistance).toBeGreaterThan(0);
    expect(props.minDistance).toBeLessThan(framing.fitDistance);
    expect(props.maxDistance).toBeGreaterThan(framing.fitDistance);
    expect(props.maxPolarAngle).toBeLessThan(Math.PI * HALF);
  });

  it('hands the orbit controls exactly the limits the domain clamps to', () => {
    const limits = getOrbitLimits(framingFor(WIDESCREEN));

    renderAt(WIDESCREEN);

    const props = getOrbitProps();
    expect(props.maxPolarAngle).toBe(limits.maxPolar);
    expect(props.minPolarAngle).toBe(limits.minPolar);
    expect(props.minDistance).toBe(limits.minDistance);
    expect(props.maxDistance).toBe(limits.maxDistance);
  });

  it('pulls the camera back on a narrow phone canvas, so the floor still fits', () => {
    const widescreen = framingFor(WIDESCREEN);
    const phone = framingFor(PHONE);

    const camera = renderAt(PHONE);

    const props = getOrbitProps();
    expect(phone.fitDistance).toBeGreaterThan(widescreen.fitDistance);
    expect(props.minDistance).toBe(phone.minDistance);
    expect(props.maxDistance).toBe(phone.maxDistance);
    expect(props.minDistance).toBeGreaterThan(widescreen.minDistance);
    expect(props.maxDistance).toBeGreaterThan(widescreen.maxDistance);
    expect(camera.position.y).toBeCloseTo(phone.position.y);
    expect(camera.position.y).toBeGreaterThan(widescreen.position.y);
    expectLookingAt(camera, EXPECTED_TARGET);
    expectWholeFloorVisible(camera);
  });

  it('keeps the remembered angle when the canvas changes, re-clamping into the new limits', () => {
    const phoneLimits = getOrbitLimits(framingFor(PHONE));
    const { camera, reframeTo } = mountAt(WIDESCREEN);
    const before = poseOf(camera);

    // The viewport changes shape: the pivot and the limits move with it, but the angle the
    // viewer is looking from is theirs and is kept, with only the distance re-clamped.
    reframeTo(PHONE);

    const props = getOrbitProps();
    expect(props.minDistance).toBe(phoneLimits.minDistance);
    expect(props.maxDistance).toBe(phoneLimits.maxDistance);
    expect(props.target).toEqual(EXPECTED_TARGET);
    expectCameraAtPose(camera, clampOrbitPose(before, phoneLimits));
    expect(poseOf(camera).azimuth).toBeCloseTo(before.azimuth);
    expect(poseOf(camera).polar).toBeCloseTo(before.polar);
    expectLookingAt(camera, EXPECTED_TARGET);
  });

  it('remembers where a pointer orbit or a wheel zoom left the camera', () => {
    const { camera } = mountAt(WIDESCREEN);

    camera.position.set(...ORBITED_POSITION);
    endOrbit();

    const expected = getOrbitPose(TARGET, new Vector3(...ORBITED_POSITION));
    const remembered = getRemembered();
    expect(remembered.azimuth).toBeCloseTo(expected.azimuth);
    expect(remembered.polar).toBeCloseTo(expected.polar);
    expect(remembered.distance).toBeCloseTo(expected.distance);
  });

  it('keeps the angle the user orbited to when the canvas changes', () => {
    const phoneLimits = getOrbitLimits(framingFor(PHONE));
    const { camera, reframeTo } = mountAt(WIDESCREEN);
    camera.position.set(...ORBITED_POSITION);
    endOrbit();
    const orbited = getOrbitPose(TARGET, new Vector3(...ORBITED_POSITION));

    reframeTo(PHONE);

    expectCameraAtPose(camera, clampOrbitPose(orbited, phoneLimits));
    expect(poseOf(camera).azimuth).toBeCloseTo(orbited.azimuth);
    expect(poseOf(camera).azimuth).not.toBeCloseTo(framingPoseFor(PHONE).azimuth);
    expect(getOrbitProps().minDistance).toBe(phoneLimits.minDistance);
  });

  it('steps the pose before default-priority frame callbacks, keeping automatic rendering', () => {
    renderAt(WIDESCREEN);

    expect(frameLoop.priority).toBeDefined();
    expect(frameLoop.priority).toBeLessThan(DEFAULT_FRAME_PRIORITY);
  });

  it('leaves the camera alone on a frame with no input at all', () => {
    const camera = renderAt(WIDESCREEN);
    const placed = camera.position.clone();

    runFrames(IDLE_FRAMES);

    expect(camera.position.x).toBe(placed.x);
    expect(camera.position.y).toBe(placed.y);
    expect(camera.position.z).toBe(placed.z);
    expect(scene.controlUpdates).toBe(0);
  });

  it('orbits about the target while ArrowLeft is held, keeping the distance', () => {
    const camera = renderAt(WIDESCREEN);
    const before = poseOf(camera);

    fireEvent.keyDown(region, { code: ORBIT_LEFT_CODE });
    runFrame(FRAME_DELTA_SECONDS);

    const after = poseOf(camera);
    expect(after.azimuth).toBeCloseTo(
      before.azimuth + ORBIT_NAVIGATION_CONFIG.orbitSpeed * FRAME_DELTA_SECONDS,
    );
    expect(Math.abs(after.distance - before.distance)).toBeLessThan(DISTANCE_TOLERANCE_METRES);
    expect(after.polar).toBeCloseTo(before.polar);
    expectLookingAt(camera, EXPECTED_TARGET);
    expect(scene.controlUpdates).toBe(SINGLE_WRITE);
  });

  it('orbits the other way while ArrowRight is held', () => {
    const camera = renderAt(WIDESCREEN);
    const before = poseOf(camera);

    fireEvent.keyDown(region, { code: ORBIT_RIGHT_CODE });
    runFrame(FRAME_DELTA_SECONDS);

    const after = poseOf(camera);
    expect(after.azimuth).toBeCloseTo(
      before.azimuth - ORBIT_NAVIGATION_CONFIG.orbitSpeed * FRAME_DELTA_SECONDS,
    );
    expect(Math.abs(after.distance - before.distance)).toBeLessThan(DISTANCE_TOLERANCE_METRES);
  });

  it('never zooms closer than the framing lets it, however long the key is held', () => {
    const limits = getOrbitLimits(framingFor(WIDESCREEN));
    const camera = renderAt(WIDESCREEN);

    fireEvent.keyDown(region, { code: ZOOM_IN_CODE });
    runFrames(HOLD_FRAMES);

    const { distance } = poseOf(camera);
    expect(distance).toBeGreaterThanOrEqual(limits.minDistance - DISTANCE_TOLERANCE_METRES);
    expect(distance).toBeCloseTo(limits.minDistance);
  });

  it('never zooms further out than the framing lets it', () => {
    const limits = getOrbitLimits(framingFor(WIDESCREEN));
    const camera = renderAt(WIDESCREEN);

    fireEvent.keyDown(region, { code: ZOOM_OUT_CODE });
    runFrames(HOLD_FRAMES);

    const { distance } = poseOf(camera);
    expect(distance).toBeLessThanOrEqual(limits.maxDistance + DISTANCE_TOLERANCE_METRES);
    expect(distance).toBeCloseTo(limits.maxDistance);
  });

  it('tilts up no further than the zenith clearance and down no further than the ground', () => {
    const limits = getOrbitLimits(framingFor(WIDESCREEN));
    const camera = renderAt(WIDESCREEN);

    fireEvent.keyDown(region, { code: TILT_UP_CODE });
    runFrames(HOLD_FRAMES);

    expect(poseOf(camera).polar).toBeCloseTo(limits.minPolar);
    expect(poseOf(camera).polar).toBeGreaterThan(0);
    expectLookingAt(camera, EXPECTED_TARGET);

    fireEvent.keyUp(region, { code: TILT_UP_CODE });
    fireEvent.keyDown(region, { code: TILT_DOWN_CODE });
    runFrames(HOLD_FRAMES);

    expect(poseOf(camera).polar).toBeCloseTo(limits.maxPolar);
    expect(poseOf(camera).polar).toBeLessThan(Math.PI * HALF);
    expectLookingAt(camera, EXPECTED_TARGET);
  });

  it('ignores orbit keys pressed while the exterior region does not have focus', () => {
    const camera = renderAt(WIDESCREEN);
    const placed = camera.position.clone();

    // No listener on the document or the window: a key pressed anywhere but the region
    // itself never reaches the orbit, and never has its default prevented either.
    fireEvent.keyDown(window, { code: ORBIT_LEFT_CODE });
    fireEvent.keyDown(document.body, { code: ZOOM_IN_CODE });
    runFrames(IDLE_FRAMES);

    expect(camera.position.x).toBe(placed.x);
    expect(camera.position.y).toBe(placed.y);
    expect(camera.position.z).toBe(placed.z);
  });

  it('orbits while the on-screen pad holds an action, with no keyboard event', () => {
    const camera = renderAt(WIDESCREEN);
    const before = poseOf(camera);

    useOrbitControlStore.getState().pressAction('orbitLeft');
    runFrame(FRAME_DELTA_SECONDS);

    expect(poseOf(camera).azimuth).toBeCloseTo(
      before.azimuth + ORBIT_NAVIGATION_CONFIG.orbitSpeed * FRAME_DELTA_SECONDS,
    );
  });

  it('stops as soon as the pad action is released', () => {
    const camera = renderAt(WIDESCREEN);
    useOrbitControlStore.getState().pressAction('zoomIn');
    runFrame(FRAME_DELTA_SECONDS);
    const zoomed = poseOf(camera);

    useOrbitControlStore.getState().releaseAllActions();
    runFrames(IDLE_FRAMES);

    expect(poseOf(camera).distance).toBeCloseTo(zoomed.distance);
  });

  it('remembers the pose once on the frame the hold is released', () => {
    const rememberSpy = vi.fn(useExteriorOrbitStore.getState().rememberOrbitPose);
    useExteriorOrbitStore.setState({ rememberOrbitPose: rememberSpy });
    const camera = renderAt(WIDESCREEN);
    fireEvent.keyDown(region, { code: ORBIT_LEFT_CODE });
    runFrame(FRAME_DELTA_SECONDS);
    const writesWhileHeld = rememberSpy.mock.calls.length;

    fireEvent.keyUp(region, { code: ORBIT_LEFT_CODE });
    runFrames(IDLE_FRAMES);

    expect(rememberSpy.mock.calls.length - writesWhileHeld).toBe(SINGLE_WRITE);
    const orbited = poseOf(camera);
    expect(getRemembered().azimuth).toBeCloseTo(orbited.azimuth);
    expect(getRemembered().distance).toBeCloseTo(orbited.distance);
  });

  it('does not remember a pose on any frame of a hold', () => {
    const rememberSpy = vi.fn(useExteriorOrbitStore.getState().rememberOrbitPose);
    useExteriorOrbitStore.setState({ rememberOrbitPose: rememberSpy });
    renderAt(WIDESCREEN);
    const writesAfterSeeding = rememberSpy.mock.calls.length;

    fireEvent.keyDown(region, { code: ORBIT_LEFT_CODE });
    runFrames(IDLE_FRAMES);

    expect(rememberSpy.mock.calls.length).toBe(writesAfterSeeding);
  });

  it('remembers the angle on unmount and comes back to it, not to the framing default', () => {
    const framingPose = framingPoseFor(WIDESCREEN);
    const first = mountAt(WIDESCREEN);
    fireEvent.keyDown(region, { code: ORBIT_LEFT_CODE });
    fireEvent.keyDown(region, { code: ZOOM_IN_CODE });
    runFrames(IDLE_FRAMES);
    const orbited = poseOf(first.camera);

    // The exterior→interior switch: the key is never released, so the unmount is the only
    // chance to remember where the viewer was looking from.
    first.unmount();
    const { camera } = mountAt(WIDESCREEN);
    runFrame(SETTLE_DELTA_SECONDS);

    expectCameraAtPose(camera, orbited);
    expect(poseOf(camera).azimuth).toBeCloseTo(orbited.azimuth);
    expect(poseOf(camera).distance).toBeCloseTo(orbited.distance);
    expect(poseOf(camera).azimuth).not.toBeCloseTo(framingPose.azimuth);
    expect(poseOf(camera).distance).not.toBeCloseTo(framingPose.distance);
    expectLookingAt(camera, EXPECTED_TARGET);
  });

  it('carries on from where a pointer orbit left the camera when a key is next held', () => {
    const { camera } = mountAt(WIDESCREEN);
    camera.position.set(...ORBITED_POSITION);
    endOrbit();
    const orbited = poseOf(camera);

    // Rightwards, which for this pose is the direction away from the ±π seam: what is
    // asserted here is the pose the step started from, not the wrap (see the orbit tests).
    fireEvent.keyDown(region, { code: ORBIT_RIGHT_CODE });
    runFrame(FRAME_DELTA_SECONDS);

    expect(poseOf(camera).azimuth).toBeCloseTo(
      orbited.azimuth - ORBIT_NAVIGATION_CONFIG.orbitSpeed * FRAME_DELTA_SECONDS,
    );
    expect(Math.abs(poseOf(camera).distance - orbited.distance)).toBeLessThan(
      DISTANCE_TOLERANCE_METRES,
    );
  });
});
