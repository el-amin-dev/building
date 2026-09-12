import { describe, expect, it } from 'vitest';
import { createInitialEyePose, EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import type { EyePose } from './eyeNavigation.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';
import { insetRect, makeRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import {
  createCameraRoomBox,
  getThirdPersonCamera,
  MIN_ELEVATION_RADIANS,
  shouldHidePersonModel,
  THIRD_PERSON_CAMERA_CONFIG,
} from './thirdPersonCamera.ts';
import type { CameraRoomBox, ThirdPersonCamera } from './thirdPersonCamera.ts';

const PRECISION_DIGITS = 9;
/** Slack for inequalities on lengths and dot products, in metres. */
const TOLERANCE = 1e-9;
const DEGREES_PER_HALF_TURN = 180;

const MARGIN = THIRD_PERSON_CAMERA_CONFIG.wallMargin;
const FOLLOW_DISTANCE = THIRD_PERSON_CAMERA_CONFIG.followDistance;
const BASE_ELEVATION = THIRD_PERSON_CAMERA_CONFIG.baseElevation;
const MAX_ELEVATION = THIRD_PERSON_CAMERA_CONFIG.maxElevation;
const MAX_PITCH = THIRD_PERSON_CAMERA_CONFIG.maxPitch;
const VISIBLE_DISTANCE = THIRD_PERSON_CAMERA_CONFIG.minBodyVisibleDistance;

const LARGE_HALF_EXTENT = 50;
const LARGE_CEILING = 100;
const LARGE_CLEAR_RECT: PlanRect = {
  minX: -LARGE_HALF_EXTENT,
  maxX: LARGE_HALF_EXTENT,
  minZ: -LARGE_HALF_EXTENT,
  maxZ: LARGE_HALF_EXTENT,
};
const LARGE_BOX = createCameraRoomBox(LARGE_CLEAR_RECT, LARGE_CEILING, MARGIN);

/** Half the sides of the test room: a 5.00 × 3.40 m clear rect, non-symmetric on the plan. */
const ROOM_HALF_WIDTH = 2.5;
const ROOM_HALF_DEPTH = 1.7;
/**
 * The room every pose of this file is built in: centred on the origin, on purpose.
 *
 * The poses below are written around the origin — a level pose at (0, 0), "back flat
 * against the +z wall", "back to the max corner" — so the room they mean has to be centred
 * there. Taking a room of the real floor plan instead (`interimWalkArea.ts`, in plan
 * coordinates) would move every one of them into a corner of that room or outside it, which
 * changes what the cases test without failing a single assertion. `createCameraRoomBox` is
 * pure geometry, so where the rect sits on the plan is precisely what it must not depend on.
 */
const ROOM_CLEAR_RECT: PlanRect = makeRect(
  -ROOM_HALF_WIDTH,
  ROOM_HALF_WIDTH,
  -ROOM_HALF_DEPTH,
  ROOM_HALF_DEPTH,
);
/** Camera box of that room, under a 2.70 m wall. */
const ROOM_BOX = createCameraRoomBox(ROOM_CLEAR_RECT, FLOOR_HEIGHTS.wall, MARGIN);
/** Where the person may stand in it: 0.25 m from every wall. */
const WALKABLE_BOUNDS = insetRect(ROOM_CLEAR_RECT, EYE_NAVIGATION_CONFIG.bodyRadius);
const START_POSE = createInitialEyePose(WALKABLE_BOUNDS);

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
 * Returns the elevation of the camera above the target's horizontal, measured from the placement.
 *
 * @param camera - The camera placement, with a non-zero distance.
 * @returns The elevation angle, in radians.
 */
function elevationOf(camera: ThirdPersonCamera): number {
  const { position, target } = camera;
  const horizontal = Math.hypot(position.x - target.x, position.z - target.z);
  return Math.atan2(position.y - target.y, horizontal);
}

/**
 * Plan distance from the target to the box, straight behind the person (horizontal ray).
 *
 * @param start - The person's pose, inside the box.
 * @param box - The camera box.
 * @returns The distance along `(sin yaw, cos yaw)` at which the plan rectangle is left.
 */
function planRoomBehind(start: EyePose, box: CameraRoomBox): number {
  const { plan } = box;
  const backX = Math.sin(start.yaw);
  const backZ = Math.cos(start.yaw);
  const exitX =
    Math.abs(backX) < TOLERANCE
      ? Number.POSITIVE_INFINITY
      : ((backX > 0 ? plan.maxX : plan.minX) - start.x) / backX;
  const exitZ =
    Math.abs(backZ) < TOLERANCE
      ? Number.POSITIVE_INFINITY
      : ((backZ > 0 ? plan.maxZ : plan.minZ) - start.z) / backZ;
  return Math.min(exitX, exitZ);
}

/**
 * Asserts that the camera does not sit in front of the person on the plan.
 *
 * @param camera - The camera placement.
 * @param yaw - The person's yaw.
 */
function expectNotInFront(camera: ThirdPersonCamera, yaw: number): void {
  const offsetX = camera.position.x - camera.target.x;
  const offsetZ = camera.position.z - camera.target.z;
  const forward = offsetX * -Math.sin(yaw) + offsetZ * -Math.cos(yaw);
  expect(forward).toBeLessThanOrEqual(TOLERANCE);
}

describe('thirdPersonCamera', () => {
  describe('THIRD_PERSON_CAMERA_CONFIG', () => {
    const EXPECTED_FOLLOW_DISTANCE = 2.5;
    const EXPECTED_BASE_ELEVATION_DEGREES = 15;
    const EXPECTED_MAX_ELEVATION_DEGREES = 80;
    const EXPECTED_WALL_MARGIN = 0.15;
    const EXPECTED_MIN_BODY_VISIBLE_DISTANCE = 0.5;

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
      expect(THIRD_PERSON_CAMERA_CONFIG.maxPitch).toBe(EYE_NAVIGATION_CONFIG.maxPitch);
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

    it('sits at the base elevation at pitch 0, and reports it', () => {
      expect(camera.elevation).toBe(BASE_ELEVATION);
      expect(elevationOf(camera)).toBeCloseTo(BASE_ELEVATION, PRECISION_DIGITS);
    });
  });

  describe('getThirdPersonCamera sign and axis guard', () => {
    it.each([
      ['0', YAW_FACING_MINUS_Z],
      ['π/2', YAW_FACING_MINUS_X],
      ['-π/2', YAW_FACING_PLUS_X],
      ['π', YAW_FACING_PLUS_Z],
    ])('sits behind the person at yaw %s', (_label, yaw) => {
      const camera = getThirdPersonCamera(pose({ yaw }), ROOM_BOX);
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
    const { plan } = ROOM_BOX;

    it.each([
      ['+z', pose({ z: plan.maxZ - WALL_GAP, yaw: YAW_FACING_MINUS_Z }), 'z', plan.maxZ],
      ['-z', pose({ z: plan.minZ + WALL_GAP, yaw: YAW_FACING_PLUS_Z }), 'z', plan.minZ],
      ['+x', pose({ x: plan.maxX - WALL_GAP, yaw: YAW_FACING_MINUS_X }), 'x', plan.maxX],
      ['-x', pose({ x: plan.minX + WALL_GAP, yaw: YAW_FACING_PLUS_X }), 'x', plan.minX],
    ] as const)('stops at the %s wall behind the person', (_side, start, axis, wall) => {
      const camera = getThirdPersonCamera(start, ROOM_BOX);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position[axis]).toBeCloseTo(wall, PRECISION_DIGITS);
      expectInsideBox(camera, ROOM_BOX);
    });
  });

  describe('getThirdPersonCamera with little room behind the person', () => {
    /** Room left behind the person at the walking limit: body radius minus camera margin. */
    const ROOM_AT_WALKING_LIMIT = EYE_NAVIGATION_CONFIG.bodyRadius - MARGIN;

    it('shows the person from the start pose, raised just enough', () => {
      const camera = getThirdPersonCamera(START_POSE, ROOM_BOX);
      const lowestVisible = Math.acos(planRoomBehind(START_POSE, ROOM_BOX) / VISIBLE_DISTANCE);

      expect(shouldHidePersonModel(camera)).toBe(false);
      expect(camera.distance).toBeGreaterThanOrEqual(VISIBLE_DISTANCE - TOLERANCE);
      expect(camera.elevation).toBeCloseTo(lowestVisible, PRECISION_DIGITS);
      expect(elevationOf(camera)).toBeCloseTo(lowestVisible, PRECISION_DIGITS);
      expectInsideBox(camera, ROOM_BOX);
    });

    it.each([
      ['+z', pose({ z: WALKABLE_BOUNDS.maxZ, yaw: YAW_FACING_MINUS_Z })],
      ['-z', pose({ z: WALKABLE_BOUNDS.minZ, yaw: YAW_FACING_PLUS_Z })],
      ['+x', pose({ x: WALKABLE_BOUNDS.maxX, yaw: YAW_FACING_MINUS_X })],
      ['-x', pose({ x: WALKABLE_BOUNDS.minX, yaw: YAW_FACING_PLUS_X })],
    ] as const)(
      'shows the person with the back flat against the %s wall, from above and behind',
      (_side, start) => {
        const camera = getThirdPersonCamera(start, ROOM_BOX);

        expect(planRoomBehind(start, ROOM_BOX)).toBeCloseTo(
          ROOM_AT_WALKING_LIMIT,
          PRECISION_DIGITS,
        );
        expect(shouldHidePersonModel(camera)).toBe(false);
        expect(camera.distance).toBeGreaterThanOrEqual(VISIBLE_DISTANCE - TOLERANCE);
        expect(camera.elevation).toBeCloseTo(
          Math.acos(ROOM_AT_WALKING_LIMIT / VISIBLE_DISTANCE),
          PRECISION_DIGITS,
        );
        expect(camera.elevation).toBeLessThanOrEqual(MAX_ELEVATION);
        expect(camera.position.y).toBeGreaterThan(camera.target.y);
        expectInsideBox(camera, ROOM_BOX);
        expectNotInFront(camera, start.yaw);
      },
    );

    it('keeps the requested elevation and full follow distance in open space', () => {
      const start = pose({ yaw: FREE_SPACE_YAW, pitch: LOOK_DOWN_PITCH });
      const requested =
        BASE_ELEVATION + (-LOOK_DOWN_PITCH / MAX_PITCH) * (MAX_ELEVATION - BASE_ELEVATION);
      const camera = getThirdPersonCamera(start, LARGE_BOX);

      expect(camera.elevation).toBeCloseTo(requested, PRECISION_DIGITS);
      expect(camera.distance).toBe(FOLLOW_DISTANCE);
    });

    describe('under a ceiling too low to reach the visible distance', () => {
      /** Room between the head and the camera box's top. */
      const CEILING_ROOM = 0.2;
      /** Room behind the person on the plan. */
      const BACK_ROOM = 0.1;
      const box = createCameraRoomBox(
        LARGE_CLEAR_RECT,
        THIRD_PERSON_CAMERA_CONFIG.targetHeight + CEILING_ROOM + MARGIN,
        MARGIN,
      );
      const start = pose({ z: box.plan.maxZ - BACK_ROOM, yaw: YAW_FACING_MINUS_Z });
      const verticalRoom = box.maxY - THIRD_PERSON_CAMERA_CONFIG.targetHeight;
      const planRoom = planRoomBehind(start, box);
      const camera = getThirdPersonCamera(start, box);

      it('is a case where the ceiling forbids the lowest visible elevation', () => {
        const lowestVisible = Math.acos(Math.min(1, planRoom / VISIBLE_DISTANCE));
        const highestUnderCeiling = Math.asin(Math.min(1, verticalRoom / VISIBLE_DISTANCE));

        expect(highestUnderCeiling).toBeLessThan(lowestVisible);
      });

      it('falls back to the elevation that maximises the distance, inside the box', () => {
        const expected = Math.min(
          Math.max(Math.atan2(verticalRoom, planRoom), BASE_ELEVATION),
          MAX_ELEVATION,
        );

        expect(camera.elevation).toBeCloseTo(expected, PRECISION_DIGITS);
        expect(camera.distance).toBeCloseTo(Math.hypot(planRoom, verticalRoom), PRECISION_DIGITS);
        expect(shouldHidePersonModel(camera)).toBe(true);
        expectInsideBox(camera, box);
      });
    });

    it('never gets closer as the person moves away from the wall behind', () => {
      const STEP = 0.01;
      const { plan } = ROOM_BOX;
      let previous = 0;
      for (let z = plan.maxZ; z >= WALKABLE_BOUNDS.minZ; z -= STEP) {
        const camera = getThirdPersonCamera(pose({ z, yaw: YAW_FACING_MINUS_Z }), ROOM_BOX);

        expect(camera.distance).toBeGreaterThanOrEqual(previous - TOLERANCE);
        expectInsideBox(camera, ROOM_BOX);
        previous = camera.distance;
      }
      expect(previous).toBe(FOLLOW_DISTANCE);
    });
  });

  describe('getThirdPersonCamera ceiling and floor', () => {
    it('raises the camera when looking down', () => {
      const level = getThirdPersonCamera(pose(), LARGE_BOX);
      const lookingDown = getThirdPersonCamera(pose({ pitch: LOOK_DOWN_PITCH }), LARGE_BOX);

      expect(lookingDown.position.y).toBeGreaterThan(level.position.y);
    });

    it('lowers the camera down to head level when looking up, never below', () => {
      const level = getThirdPersonCamera(pose(), LARGE_BOX);
      const lookingUp = getThirdPersonCamera(pose({ pitch: -LOOK_DOWN_PITCH }), LARGE_BOX);
      const fullyUp = getThirdPersonCamera(pose({ pitch: MAX_PITCH }), LARGE_BOX);

      expect(lookingUp.position.y).toBeLessThan(level.position.y);
      expect(lookingUp.position.y).toBeGreaterThan(lookingUp.target.y);
      expect(fullyUp.position.y).toBeCloseTo(fullyUp.target.y, PRECISION_DIGITS);
      expect(fullyUp.distance).toBe(FOLLOW_DISTANCE);
    });

    it('stays under a low ceiling and pulls in when looking down', () => {
      const camera = getThirdPersonCamera(pose({ pitch: LOOK_DOWN_PITCH }), LOW_CEILING_BOX);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position.y).toBeLessThanOrEqual(LOW_CEILING_BOX.maxY);
      expect(camera.position.y).toBeCloseTo(LOW_CEILING_BOX.maxY, PRECISION_DIGITS);
    });

    it('stays level with the head, inside the room, when looking fully up', () => {
      const camera = getThirdPersonCamera(pose({ pitch: MAX_PITCH }), ROOM_BOX);

      expect(camera.position.y).toBeCloseTo(camera.target.y, PRECISION_DIGITS);
      expectInsideBox(camera, ROOM_BOX);
    });
  });

  it('stays inside the box on both plan axes in a corner', () => {
    const { plan } = ROOM_BOX;
    const start = pose({
      x: plan.maxX - CORNER_GAP,
      z: plan.maxZ - CORNER_GAP,
      yaw: YAW_BACK_TO_MAX_CORNER,
    });
    const camera = getThirdPersonCamera(start, ROOM_BOX);

    expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
    expectInsideBox(camera, ROOM_BOX);
  });

  describe('getThirdPersonCamera pitch to elevation', () => {
    /** Number of equal pitch steps sampled across [−maxPitch, +maxPitch]. */
    const PITCH_SAMPLES = 64;

    it.each([
      ['level', 0, BASE_ELEVATION],
      ['fully down', -MAX_PITCH, MAX_ELEVATION],
      ['fully up', MAX_PITCH, MIN_ELEVATION_RADIANS],
    ])('maps the %s pitch onto its elevation', (_label, pitch, expected) => {
      const camera = getThirdPersonCamera(pose({ pitch }), LARGE_BOX);

      expect(camera.elevation).toBeCloseTo(expected, PRECISION_DIGITS);
      expect(elevationOf(camera)).toBeCloseTo(expected, PRECISION_DIGITS);
    });

    it('lowers the elevation strictly as the pitch rises, with no dead zone', () => {
      let previous = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= PITCH_SAMPLES; step += 1) {
        const pitch = -MAX_PITCH + (step / PITCH_SAMPLES) * (MAX_PITCH + MAX_PITCH);
        const { elevation } = getThirdPersonCamera(pose({ pitch }), LARGE_BOX);

        expect(elevation).toBeLessThan(previous);
        previous = elevation;
      }
    });

    it.each([
      ['looking down', -BEYOND_LIMIT_PITCH, MAX_ELEVATION],
      ['looking up', BEYOND_LIMIT_PITCH, MIN_ELEVATION_RADIANS],
    ])('clamps the elevation when %s beyond the limit', (_label, pitch, expected) => {
      const camera = getThirdPersonCamera(pose({ pitch }), LARGE_BOX);

      expect(camera.distance).toBeGreaterThan(0);
      expect(elevationOf(camera)).toBeCloseTo(expected, PRECISION_DIGITS);
    });

    it('never places the camera below head height, whatever the pose', () => {
      /** Number of equal steps sampled across each axis of the camera box, walls included. */
      const POSITION_SAMPLES = 12;
      /** Number of equal yaw steps sampled across a full turn. */
      const YAW_SAMPLES = 16;
      const FULL_TURN = Math.PI + Math.PI;
      const boxes = [ROOM_BOX, LOW_CEILING_BOX];
      let lowestElevation = Number.POSITIVE_INFINITY;
      let lowestHeightAboveHead = Number.POSITIVE_INFINITY;

      for (const box of boxes) {
        const { plan } = box;
        for (let i = 0; i <= POSITION_SAMPLES; i += 1) {
          const x = plan.minX + (i / POSITION_SAMPLES) * (plan.maxX - plan.minX);
          for (let j = 0; j <= POSITION_SAMPLES; j += 1) {
            const z = plan.minZ + (j / POSITION_SAMPLES) * (plan.maxZ - plan.minZ);
            for (let k = 0; k < YAW_SAMPLES; k += 1) {
              const yaw = (k / YAW_SAMPLES) * FULL_TURN;
              for (let step = 0; step <= PITCH_SAMPLES; step += 1) {
                const pitch =
                  -BEYOND_LIMIT_PITCH +
                  (step / PITCH_SAMPLES) * (BEYOND_LIMIT_PITCH + BEYOND_LIMIT_PITCH);
                const camera = getThirdPersonCamera({ x, z, yaw, pitch }, box);
                lowestElevation = Math.min(lowestElevation, camera.elevation);
                lowestHeightAboveHead = Math.min(
                  lowestHeightAboveHead,
                  camera.position.y - camera.target.y,
                );
              }
            }
          }
        }
      }

      expect(lowestElevation).toBeGreaterThanOrEqual(MIN_ELEVATION_RADIANS);
      expect(lowestHeightAboveHead).toBeGreaterThanOrEqual(-TOLERANCE);
    });
  });

  describe('getThirdPersonCamera looking up with a wall close behind', () => {
    /** Number of equal pitch steps from level to fully up. */
    const LOOK_UP_STEPS = 160;
    /**
     * Largest camera movement allowed between two consecutive pitch steps (0.5° each), in
     * metres. A flip below the head moved the camera by 0.35 m to 1 m in a single step.
     */
    const MAX_STEP_MOVEMENT = 0.01;

    it.each([
      ['back flat against the +z wall', pose({ z: WALKABLE_BOUNDS.maxZ, yaw: YAW_FACING_MINUS_Z })],
      ['back flat against the -z wall', pose({ z: WALKABLE_BOUNDS.minZ, yaw: YAW_FACING_PLUS_Z })],
      ['back flat against the +x wall', pose({ x: WALKABLE_BOUNDS.maxX, yaw: YAW_FACING_MINUS_X })],
      ['back flat against the -x wall', pose({ x: WALKABLE_BOUNDS.minX, yaw: YAW_FACING_PLUS_X })],
      ['back to the start corner', START_POSE],
      ['a wall 0.5 m behind', pose({ z: ROOM_BOX.plan.maxZ - WALL_GAP, yaw: YAW_FACING_MINUS_Z })],
    ] as const)(
      'stays at or above the head, shows the person and moves smoothly: %s',
      (_label, start) => {
        let previous: ThirdPersonCamera | undefined;
        for (let step = 0; step <= LOOK_UP_STEPS; step += 1) {
          const pitch = (step / LOOK_UP_STEPS) * MAX_PITCH;
          const camera = getThirdPersonCamera({ ...start, pitch }, ROOM_BOX);

          expect(camera.position.y).toBeGreaterThanOrEqual(camera.target.y - TOLERANCE);
          expect(shouldHidePersonModel(camera)).toBe(false);
          expectNotInFront(camera, start.yaw);
          expectInsideBox(camera, ROOM_BOX);
          if (previous) {
            const movement = Math.hypot(
              camera.position.x - previous.position.x,
              camera.position.y - previous.position.y,
              camera.position.z - previous.position.z,
            );
            expect(movement).toBeLessThanOrEqual(MAX_STEP_MOVEMENT);
          }
          previous = camera;
        }
      },
    );
  });

  it('clamps a target outside the box into it before following', () => {
    const { plan } = ROOM_BOX;
    const outside = pose({ x: plan.maxX + OUTSIDE_OFFSET, z: plan.minZ - OUTSIDE_OFFSET });
    const camera = getThirdPersonCamera(outside, ROOM_BOX);

    expect(camera.target.x).toBe(plan.maxX);
    expect(camera.target.z).toBe(plan.minZ);
    expectInsideBox(camera, ROOM_BOX);
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

    getThirdPersonCamera(start, ROOM_BOX);

    expect(start).toEqual(snapshot);
  });

  describe('shouldHidePersonModel', () => {
    const DISTANCE_STEP = 0.01;
    const ORIGIN = { x: 0, y: 0, z: 0 };

    /**
     * Builds a camera placement at a given distance.
     *
     * @param distance - The camera distance, in metres.
     * @returns A placement whose only meaningful field is `distance`.
     */
    function cameraAt(distance: number): ThirdPersonCamera {
      return { position: ORIGIN, target: ORIGIN, distance, elevation: BASE_ELEVATION };
    }

    it.each([
      ['hides the model at distance 0', 0, true],
      ['hides the model just below the threshold', VISIBLE_DISTANCE - DISTANCE_STEP, true],
      ['shows the model at the threshold', VISIBLE_DISTANCE, false],
      [
        'shows the model a rounding error below the threshold',
        VISIBLE_DISTANCE - TOLERANCE / 2,
        false,
      ],
      ['shows the model above the threshold', VISIBLE_DISTANCE + DISTANCE_STEP, false],
      ['shows the model at the follow distance', FOLLOW_DISTANCE, false],
    ])('%s', (_label, distance, expected) => {
      expect(shouldHidePersonModel(cameraAt(distance))).toBe(expected);
    });

    it('still hides the model when there is no room at all behind the person', () => {
      const { plan } = ROOM_BOX;
      const camera = getThirdPersonCamera(
        pose({ z: plan.maxZ, yaw: YAW_FACING_MINUS_Z }),
        ROOM_BOX,
      );

      expect(camera.distance).toBe(0);
      expect(shouldHidePersonModel(camera)).toBe(true);
    });
  });
});
