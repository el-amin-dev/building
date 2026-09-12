import { render } from '@testing-library/react';
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExteriorFraming } from '../domain/exteriorFraming.ts';
import type { ExteriorFraming } from '../domain/exteriorFraming.ts';
import { PLOT_RECT } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
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
  readonly maxPolarAngle?: number;
  readonly onStart?: () => void;
}

/** The part of the three.js store this component reads. */
interface ThreeStateStub {
  readonly size: CanvasSize;
  readonly get: () => { readonly camera: PerspectiveCamera };
}

/** The canvas the component is rendered in: its size, its camera and the captured props. */
const scene = vi.hoisted(() => ({
  width: 0,
  height: 0,
  camera: null as PerspectiveCamera | null,
  orbitProps: null as CapturedOrbitProps | null,
}));

// jsdom has no WebGL: the three.js store is replaced by the two values the component reads
// — the canvas size and the default camera — so `getExteriorFraming` is driven by a size
// each test sets, and the camera is a real three.js camera the reset can be asserted on.
vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: ThreeStateStub) => unknown) =>
    selector({
      size: { width: scene.width, height: scene.height },
      get: () => ({ camera: getCamera() }),
    }),
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
/** A desktop canvas, wider than it is tall: 1920 × 1080 CSS pixels. */
const WIDESCREEN: CanvasSize = { width: 1920, height: 1080 };
/** A phone canvas, narrower than it is tall: 400 × 800 CSS pixels. */
const PHONE: CanvasSize = { width: 400, height: 800 };
/** Somewhere the user could have orbited to: not a framing of any canvas size. */
const ORBITED_POSITION: readonly [number, number, number] = [12, 7, -9];

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

/** A mounted canvas: its camera, and a way to change the size the controls see. */
interface MountedCanvas {
  /** The default camera the controls move. */
  readonly camera: PerspectiveCamera;
  /** Resizes the canvas and re-renders, as a resize of the viewport does. */
  readonly reframeTo: (size: CanvasSize) => void;
}

/**
 * Mounts the controls in a canvas of the given size, with the app's camera settings.
 *
 * @param size - The canvas size `useThree` reports.
 * @returns The camera and a way to resize the canvas under the mounted controls.
 */
function mountAt(size: CanvasSize): MountedCanvas {
  scene.width = size.width;
  scene.height = size.height;
  const camera = new PerspectiveCamera(
    CAMERA_FOV_DEGREES,
    size.width / size.height,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  scene.camera = camera;
  const { rerender } = render(<ExteriorCameraControls />);

  return {
    camera,
    reframeTo: (next: CanvasSize) => {
      scene.width = next.width;
      scene.height = next.height;
      camera.aspect = next.width / next.height;
      camera.updateProjectionMatrix();
      rerender(<ExteriorCameraControls />);
    },
  };
}

/**
 * Renders the controls in a canvas of the given size, with the app's camera settings.
 *
 * @param size - The canvas size `useThree` reports.
 * @returns The camera the controls were given.
 */
function renderAt(size: CanvasSize): PerspectiveCamera {
  return mountAt(size).camera;
}

/**
 * Tells the controls the user has started orbiting, as drei's `onStart` does.
 *
 * @throws Error when the controls report no start of an orbit, which is the whole point:
 *   without it the component cannot know the camera has become the user's.
 */
function startOrbiting(): void {
  const { onStart } = getOrbitProps();
  if (onStart === undefined) {
    throw new Error('the orbit controls were given no onStart handler');
  }
  onStart();
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

describe('ExteriorCameraControls', () => {
  afterEach(() => {
    scene.camera = null;
    scene.orbitProps = null;
  });

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

  it('keeps the closest zoom outside the building and the furthest past it', () => {
    const framing = framingFor(WIDESCREEN);

    renderAt(WIDESCREEN);

    const props = getOrbitProps();
    expect(props.minDistance).toBeGreaterThan(0);
    expect(props.minDistance).toBeLessThan(framing.fitDistance);
    expect(props.maxDistance).toBeGreaterThan(framing.fitDistance);
    expect(props.maxPolarAngle).toBeLessThan(Math.PI * HALF);
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

  it('re-frames the camera when the canvas changes before any orbit', () => {
    const phone = framingFor(PHONE);
    const { camera, reframeTo } = mountAt(WIDESCREEN);

    // The viewport changes shape before the user has touched the controls: the zoom limits
    // move with it, so the camera has to move with them or be snapped into range.
    reframeTo(PHONE);

    const props = getOrbitProps();
    expect(props.minDistance).toBe(phone.minDistance);
    expect(props.maxDistance).toBe(phone.maxDistance);
    expect(camera.position.x).toBeCloseTo(phone.position.x);
    expect(camera.position.y).toBeCloseTo(phone.position.y);
    expect(camera.position.z).toBeCloseTo(phone.position.z);
    expectLookingAt(camera, EXPECTED_TARGET);
    expectWholeFloorVisible(camera);
  });

  it('leaves an orbited camera where the user left it when the canvas changes', () => {
    const phone = framingFor(PHONE);
    const { camera, reframeTo } = mountAt(WIDESCREEN);

    startOrbiting();
    camera.position.set(...ORBITED_POSITION);
    reframeTo(PHONE);

    const props = getOrbitProps();
    expect(camera.position.toArray()).toEqual([...ORBITED_POSITION]);
    // The limits and the pivot still follow the new framing; only the view is left alone.
    expect(props.minDistance).toBe(phone.minDistance);
    expect(props.maxDistance).toBe(phone.maxDistance);
    expect(props.target).toEqual(EXPECTED_TARGET);
  });
});
