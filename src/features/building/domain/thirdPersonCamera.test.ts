import { describe, expect, it } from 'vitest';
import { BASE_CHAMBER_SPEC, getClearRect } from './chamber.ts';
import { EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import type { EyePose } from './eyeNavigation.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';
import type { PlanRect } from './planGeometry.ts';
import {
  createCameraRoomBox,
  getThirdPersonCamera,
  shouldHidePersonModel,
  THIRD_PERSON_CAMERA_CONFIG,
} from './thirdPersonCamera.ts';
import type { CameraRoomBox, ThirdPersonCamera } from './thirdPersonCamera.ts';

const PRECISION_DIGITS = 9;
const DEGREES_PER_HALF_TURN = 180;

const MARGIN = THIRD_PERSON_CAMERA_CONFIG.wallMargin;
const FOLLOW_DISTANCE = THIRD_PERSON_CAMERA_CONFIG.followDistance;

const LARGE_HALF_EXTENT = 50;
const LARGE_CEILING = 100;
const LARGE_CLEAR_RECT: PlanRect = {
  minX: -LARGE_HALF_EXTENT,
  maxX: LARGE_HALF_EXTENT,
  minZ: -LARGE_HALF_EXTENT,
  maxZ: LARGE_HALF_EXTENT,
};
const LARGE_BOX = createCameraRoomBox(LARGE_CLEAR_RECT, LARGE_CEILING, MARGIN);

/** Chamber-like box: 5.00 × 3.40 m clear under a 2.70 m wall, non-symmetric on the plan. */
const CHAMBER_BOX = createCameraRoomBox(
  getClearRect(BASE_CHAMBER_SPEC),
  FLOOR_HEIGHTS.wall,
  MARGIN,
);

const LOW_CEILING = 2.2;
const LOW_CEILING_BOX = createCameraRoomBox(LARGE_CLEAR_RECT, LOW_CEILING, MARGIN);

const WALL_GAP = 0.5;
const CORNER_GAP = 0.3;
const LOOK_DOWN_PITCH = -Math.PI / 3;
const FREE_SPACE_YAW = Math.PI / 5;
const BEYOND_LIMIT_PITCH = Math.PI;
const OUTSIDE_OFFSET = 1;

const YAW_FACING_MINUS_Z = 0;
const YAW_FACING_PLUS_Z = Math.PI;
const YAW_FACING_MINUS_X = Math.PI / 2;
const YAW_FACING_PLUS_X = -Math.PI / 2;
const YAW_BACK_TO_MAX_CORNER = Math.PI / 4;

const LEVEL_POSE: EyePose = { x: 0, z: 0, yaw: 0, pitch: 0 };

/**
 * Builds a pose from the level pose at the origin.
 *
 * @param partial - Fields to override.
 * @returns A new pose.
 */
function pose(partial: Partial<EyePose> = {}): EyePose {
  return { ...LEVEL_POSE, ...partial };
}

/**
 * Returns the distance between the camera position and its target.
 *
 * @param camera - The camera placement.
 * @returns The Euclidean length of position − target.
 */
function offsetLength(camera: ThirdPersonCamera): number {
  const { position, target } = camera;
  return Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
}

/**
 * Asserts that the camera position lies inside a box, bounds included.
 *
 * @param camera - The camera placement.
 * @param box - The box it must stay inside.
 */
function expectInsideBox(camera: ThirdPersonCamera, box: CameraRoomBox): void {
  const { position } = camera;
  expect(position.x).toBeGreaterThanOrEqual(box.plan.minX);
  expect(position.x).toBeLessThanOrEqual(box.plan.maxX);
  expect(position.y).toBeGreaterThanOrEqual(box.minY);
  expect(position.y).toBeLessThanOrEqual(box.maxY);
  expect(position.z).toBeGreaterThanOrEqual(box.plan.minZ);
  expect(position.z).toBeLessThanOrEqual(box.plan.maxZ);
}

/**
 * Returns the elevation of the camera above the target's horizontal.
 *
 * @param camera - The camera placement, with a non-zero distance.
 * @returns The elevation angle, in radians.
 */
function elevationOf(camera: ThirdPersonCamera): number {
  const { position, target } = camera;
  const horizontal = Math.hypot(position.x - target.x, position.z - target.z);
  return Math.atan2(position.y - target.y, horizontal);
}

describe('thirdPersonCamera', () => {
  describe('THIRD_PERSON_CAMERA_CONFIG', () => {
    const EXPECTED_FOLLOW_DISTANCE = 2.5;
    const EXPECTED_BASE_ELEVATION_DEGREES = 15;
    const EXPECTED_MAX_ELEVATION_DEGREES = 80;
    const EXPECTED_WALL_MARGIN = 0.15;
    const EXPECTED_MIN_BODY_VISIBLE_DISTANCE = 0.6;

    it('holds the default tuning, angles in radians', () => {
      expect(THIRD_PERSON_CAMERA_CONFIG.followDistance).toBe(EXPECTED_FOLLOW_DISTANCE);
      expect(THIRD_PERSON_CAMERA_CONFIG.targetHeight).toBe(PERSON_SPEC.eyeHeight);
      expect(THIRD_PERSON_CAMERA_CONFIG.baseElevation).toBeCloseTo(
        (EXPECTED_BASE_ELEVATION_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN,
        PRECISION_DIGITS,
      );
      expect(THIRD_PERSON_CAMERA_CONFIG.maxElevation).toBeCloseTo(
        (EXPECTED_MAX_ELEVATION_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN,
        PRECISION_DIGITS,
      );
      expect(THIRD_PERSON_CAMERA_CONFIG.wallMargin).toBe(EXPECTED_WALL_MARGIN);
      expect(THIRD_PERSON_CAMERA_CONFIG.minBodyVisibleDistance).toBe(
        EXPECTED_MIN_BODY_VISIBLE_DISTANCE,
      );
    });

    it('is frozen', () => {
      expect(Object.isFrozen(THIRD_PERSON_CAMERA_CONFIG)).toBe(true);
    });
  });

  describe('createCameraRoomBox', () => {
    const CLEAR_RECT: PlanRect = { minX: -1, maxX: 3, minZ: 2, maxZ: 4.5 };
    const CEILING = 2.7;
    const BOX_MARGIN = 0.2;
    const NEGATIVE_MARGIN = -0.1;
    const HALF = 0.5;

    it('shrinks the clear rect and the floor-to-ceiling range by the margin', () => {
      const box = createCameraRoomBox(CLEAR_RECT, CEILING, BOX_MARGIN);
      expect(box.plan.minX).toBeCloseTo(CLEAR_RECT.minX + BOX_MARGIN, PRECISION_DIGITS);
      expect(box.plan.maxX).toBeCloseTo(CLEAR_RECT.maxX - BOX_MARGIN, PRECISION_DIGITS);
      expect(box.plan.minZ).toBeCloseTo(CLEAR_RECT.minZ + BOX_MARGIN, PRECISION_DIGITS);
      expect(box.plan.maxZ).toBeCloseTo(CLEAR_RECT.maxZ - BOX_MARGIN, PRECISION_DIGITS);
      expect(box.minY).toBeCloseTo(BOX_MARGIN, PRECISION_DIGITS);
      expect(box.maxY).toBeCloseTo(CEILING - BOX_MARGIN, PRECISION_DIGITS);
    });

    it('keeps the clear rect and ceiling as they are with a zero margin', () => {
      expect(createCameraRoomBox(CLEAR_RECT, CEILING, 0)).toEqual({
        plan: CLEAR_RECT,
        minY: 0,
        maxY: CEILING,
      });
    });

    it('is frozen, plan included', () => {
      const box = createCameraRoomBox(CLEAR_RECT, CEILING, BOX_MARGIN);
      expect(Object.isFrozen(box)).toBe(true);
      expect(Object.isFrozen(box.plan)).toBe(true);
    });

    const NARROW_WIDTH = 1;
    const NARROW_RECT: PlanRect = { ...CLEAR_RECT, maxX: CLEAR_RECT.minX + NARROW_WIDTH };
    const LOW_ROOM_CEILING = 2;
    const CLEAR_DEPTH = CLEAR_RECT.maxZ - CLEAR_RECT.minZ;

    it.each([
      ['the width', NARROW_RECT, CEILING, NARROW_WIDTH * HALF],
      ['the depth', CLEAR_RECT, CEILING, CLEAR_DEPTH * HALF],
      ['the ceiling height', CLEAR_RECT, LOW_ROOM_CEILING, LOW_ROOM_CEILING * HALF],
    ] as const)('rejects a margin that leaves no room in %s', (_label, rect, ceiling, margin) => {
      expect(() => createCameraRoomBox(rect, ceiling, margin)).toThrow(RangeError);
    });

    it('accepts a margin just below the limit of the smallest dimension', () => {
      const MARGIN_STEP = 0.01;
      const box = createCameraRoomBox(CLEAR_RECT, CEILING, CLEAR_DEPTH * HALF - MARGIN_STEP);
      expect(box.plan.maxZ).toBeGreaterThan(box.plan.minZ);
    });

    it('rejects a negative margin', () => {
      expect(() => createCameraRoomBox(CLEAR_RECT, CEILING, NEGATIVE_MARGIN)).toThrow(RangeError);
    });

    it.each([
      ['margin NaN', CLEAR_RECT, CEILING, Number.NaN],
      ['ceiling Infinity', CLEAR_RECT, Number.POSITIVE_INFINITY, BOX_MARGIN],
      ['rect minX NaN', { ...CLEAR_RECT, minX: Number.NaN }, CEILING, BOX_MARGIN],
      ['rect maxZ -Infinity', { ...CLEAR_RECT, maxZ: Number.NEGATIVE_INFINITY }, CEILING, 0],
    ] as const)('rejects non-finite input: %s', (_label, rect, ceiling, margin) => {
      expect(() => createCameraRoomBox(rect, ceiling, margin)).toThrow(RangeError);
    });
  });

  describe('getThirdPersonCamera in free space', () => {
    const camera = getThirdPersonCamera(pose({ yaw: FREE_SPACE_YAW }), LARGE_BOX);

    it('uses the full follow distance', () => {
      expect(camera.distance).toBe(FOLLOW_DISTANCE);
      expect(offsetLength(camera)).toBeCloseTo(FOLLOW_DISTANCE, PRECISION_DIGITS);
    });

    it('looks at the head of the person', () => {
      expect(camera.target).toEqual({ x: LEVEL_POSE.x, y: PERSON_SPEC.eyeHeight, z: LEVEL_POSE.z });
    });

    it('sits at the base elevation at pitch 0', () => {
      expect(elevationOf(camera)).toBeCloseTo(
        THIRD_PERSON_CAMERA_CONFIG.baseElevation,
        PRECISION_DIGITS,
      );
    });
  });

  describe('getThirdPersonCamera sign and axis guard', () => {
    it.each([
      ['0', YAW_FACING_MINUS_Z],
      ['π/2', YAW_FACING_MINUS_X],
      ['-π/2', YAW_FACING_PLUS_X],
      ['π', YAW_FACING_PLUS_Z],
    ])('sits behind the person at yaw %s', (_label, yaw) => {
      const camera = getThirdPersonCamera(pose({ yaw }), CHAMBER_BOX);
      const offsetX = camera.position.x - camera.target.x;
      const offsetZ = camera.position.z - camera.target.z;
      const forward = offsetX * -Math.sin(yaw) + offsetZ * -Math.cos(yaw);
      const lateral = offsetX * Math.cos(yaw) + offsetZ * -Math.sin(yaw);

      expect(camera.distance).toBeGreaterThan(0);
      expect(forward).toBeLessThan(0);
      expect(lateral).toBeCloseTo(0, PRECISION_DIGITS);
    });
  });

  describe('getThirdPersonCamera wall pull-in', () => {
    const { plan } = CHAMBER_BOX;

    it.each([
      ['+z', pose({ z: plan.maxZ - WALL_GAP, yaw: YAW_FACING_MINUS_Z }), 'z', plan.maxZ],
      ['-z', pose({ z: plan.minZ + WALL_GAP, yaw: YAW_FACING_PLUS_Z }), 'z', plan.minZ],
      ['+x', pose({ x: plan.maxX - WALL_GAP, yaw: YAW_FACING_MINUS_X }), 'x', plan.maxX],
      ['-x', pose({ x: plan.minX + WALL_GAP, yaw: YAW_FACING_PLUS_X }), 'x', plan.minX],
    ] as const)('stops at the %s wall behind the person', (_side, start, axis, wall) => {
      const camera = getThirdPersonCamera(start, CHAMBER_BOX);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position[axis]).toBeCloseTo(wall, PRECISION_DIGITS);
      expectInsideBox(camera, CHAMBER_BOX);
    });
  });

  describe('getThirdPersonCamera ceiling and floor', () => {
    it('raises the camera when looking down', () => {
      const level = getThirdPersonCamera(pose(), LARGE_BOX);
      const lookingDown = getThirdPersonCamera(pose({ pitch: LOOK_DOWN_PITCH }), LARGE_BOX);

      expect(lookingDown.position.y).toBeGreaterThan(level.position.y);
    });

    it('stays under a low ceiling and pulls in when looking down', () => {
      const camera = getThirdPersonCamera(pose({ pitch: LOOK_DOWN_PITCH }), LOW_CEILING_BOX);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position.y).toBeLessThanOrEqual(LOW_CEILING_BOX.maxY);
      expect(camera.position.y).toBeCloseTo(LOW_CEILING_BOX.maxY, PRECISION_DIGITS);
    });

    it('stays above the floor when looking up', () => {
      const camera = getThirdPersonCamera(
        pose({ pitch: EYE_NAVIGATION_CONFIG.maxPitch }),
        CHAMBER_BOX,
      );

      expect(camera.position.y).toBeLessThan(camera.target.y);
      expect(camera.position.y).toBeGreaterThanOrEqual(CHAMBER_BOX.minY);
      expectInsideBox(camera, CHAMBER_BOX);
    });
  });

  it('stays inside the box on both plan axes in a corner', () => {
    const { plan } = CHAMBER_BOX;
    const start = pose({
      x: plan.maxX - CORNER_GAP,
      z: plan.maxZ - CORNER_GAP,
      yaw: YAW_BACK_TO_MAX_CORNER,
    });
    const camera = getThirdPersonCamera(start, CHAMBER_BOX);

    expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
    expectInsideBox(camera, CHAMBER_BOX);
  });

  describe('getThirdPersonCamera elevation clamp', () => {
    it.each([
      ['looking down', -BEYOND_LIMIT_PITCH, THIRD_PERSON_CAMERA_CONFIG.maxElevation],
      ['looking up', BEYOND_LIMIT_PITCH, -THIRD_PERSON_CAMERA_CONFIG.maxElevation],
    ])('clamps the elevation when %s beyond the limit', (_label, pitch, expected) => {
      const camera = getThirdPersonCamera(pose({ pitch }), LARGE_BOX);

      expect(camera.distance).toBeGreaterThan(0);
      expect(elevationOf(camera)).toBeCloseTo(expected, PRECISION_DIGITS);
    });
  });

  it('clamps a target outside the box into it before following', () => {
    const { plan } = CHAMBER_BOX;
    const outside = pose({ x: plan.maxX + OUTSIDE_OFFSET, z: plan.minZ - OUTSIDE_OFFSET });
    const camera = getThirdPersonCamera(outside, CHAMBER_BOX);

    expect(camera.target.x).toBe(plan.maxX);
    expect(camera.target.z).toBe(plan.minZ);
    expectInsideBox(camera, CHAMBER_BOX);
  });

  it('never mutates the input pose', () => {
    const ARBITRARY_COORDINATE = 1;
    const ARBITRARY_ANGLE = 1;
    const start = Object.freeze(
      pose({
        x: ARBITRARY_COORDINATE,
        z: ARBITRARY_COORDINATE,
        yaw: ARBITRARY_ANGLE,
        pitch: ARBITRARY_ANGLE,
      }),
    );
    const snapshot = { ...start };

    getThirdPersonCamera(start, CHAMBER_BOX);

    expect(start).toEqual(snapshot);
  });

  describe('shouldHidePersonModel', () => {
    const THRESHOLD = THIRD_PERSON_CAMERA_CONFIG.minBodyVisibleDistance;
    const DISTANCE_STEP = 0.01;
    const ORIGIN = { x: 0, y: 0, z: 0 };

    /**
     * Builds a camera placement at a given distance.
     *
     * @param distance - The camera distance, in metres.
     * @returns A placement whose only meaningful field is `distance`.
     */
    function cameraAt(distance: number): ThirdPersonCamera {
      return { position: ORIGIN, target: ORIGIN, distance };
    }

    it.each([
      ['hides the model at distance 0', 0, true],
      ['hides the model just below the threshold', THRESHOLD - DISTANCE_STEP, true],
      ['shows the model at the threshold', THRESHOLD, false],
      ['shows the model above the threshold', THRESHOLD + DISTANCE_STEP, false],
      ['shows the model at the follow distance', FOLLOW_DISTANCE, false],
    ])('%s', (_label, distance, expected) => {
      expect(shouldHidePersonModel(cameraAt(distance))).toBe(expected);
    });

    it('hides the model when the person backs into a wall', () => {
      const { plan } = CHAMBER_BOX;
      const camera = getThirdPersonCamera(
        pose({ z: plan.maxZ, yaw: YAW_FACING_MINUS_Z }),
        CHAMBER_BOX,
      );

      expect(camera.distance).toBe(0);
      expect(shouldHidePersonModel(camera)).toBe(true);
    });
  });
});
