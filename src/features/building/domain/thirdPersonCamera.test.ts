import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from './builtFloor.ts';
import { getWalkField, isClear, makeWalkField } from './collision.ts';
import type { WalkField } from './collision.ts';
import { EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import type { EyePose } from './eyeNavigation.ts';
import { FLOOR_PLAN } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';
import { insetRect, makeRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import {
  createCameraField,
  getThirdPersonCamera,
  MIN_ELEVATION_RADIANS,
  shouldHidePersonModel,
  THIRD_PERSON_CAMERA_CONFIG,
} from './thirdPersonCamera.ts';
import type { CameraField, ThirdPersonCamera } from './thirdPersonCamera.ts';

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
const TARGET_HEIGHT = THIRD_PERSON_CAMERA_CONFIG.targetHeight;
/** Radius of the body on the plan: what collision keeps clear of every blocker. */
const BODY_RADIUS = PERSON_SPEC.radius;

/** Thickness of every test wall, in metres. Only its inner face matters to the camera. */
const WALL_THICKNESS = 0.2;

/**
 * Builds the four walls that ring a clear rectangle, overlapping at the corners.
 *
 * @param clear - The clear (inside) rectangle of the room, in metres.
 * @param thickness - Wall thickness, in metres.
 * @returns Four blocker rectangles whose inner faces are exactly the faces of `clear`.
 */
function ringWalls(clear: PlanRect, thickness: number): readonly PlanRect[] {
  const outer = insetRect(clear, -thickness);
  return [
    makeRect(outer.minX, clear.minX, outer.minZ, outer.maxZ),
    makeRect(clear.maxX, outer.maxX, outer.minZ, outer.maxZ),
    makeRect(outer.minX, outer.maxX, outer.minZ, clear.minZ),
    makeRect(outer.minX, outer.maxX, clear.maxZ, outer.maxZ),
  ];
}

const OPEN_HALF_EXTENT = 50;
const OPEN_CEILING = 100;
const OPEN_WALK: WalkField = makeWalkField(
  [makeRect(-OPEN_HALF_EXTENT, OPEN_HALF_EXTENT, -OPEN_HALF_EXTENT, OPEN_HALF_EXTENT)],
  [],
);
/** Floor with nothing on it under a very high ceiling: the camera is bounded by nothing. */
const OPEN_FIELD = createCameraField(OPEN_WALK, OPEN_CEILING);

/** Half the sides of the test room: a 5.00 × 3.40 m clear rect, non-symmetric on the plan. */
const ROOM_HALF_WIDTH = 2.5;
const ROOM_HALF_DEPTH = 1.7;
/**
 * The room every pose of this file is built in: centred on the origin, on purpose.
 *
 * The poses below are written around the origin — a level pose at (0, 0), "back flat
 * against the +z wall", "back to the max corner" — so the room they mean has to be centred
 * there. Taking a room of the real floor plan instead would move every one of them into a
 * corner of that room or outside it, which changes what the cases test without failing a
 * single assertion. The camera reads a collision field and nothing else, so where the walls
 * sit on the plan is precisely what it must not depend on; the real field of the real floor
 * is exercised on its own, further down.
 */
const ROOM_CLEAR_RECT: PlanRect = makeRect(
  -ROOM_HALF_WIDTH,
  ROOM_HALF_WIDTH,
  -ROOM_HALF_DEPTH,
  ROOM_HALF_DEPTH,
);
/** That room as a collision field: floor inside, four walls round it. */
const ROOM_WALK: WalkField = makeWalkField(
  [ROOM_CLEAR_RECT],
  ringWalls(ROOM_CLEAR_RECT, WALL_THICKNESS),
);
/** Camera field of that room, under a 2.70 m wall. */
const ROOM_FIELD = createCameraField(ROOM_WALK, FLOOR_HEIGHTS.wall);
/** Where the camera comes to rest against each wall of the room: the face less the margin. */
const CAMERA_LIMITS = {
  minX: ROOM_CLEAR_RECT.minX + MARGIN,
  maxX: ROOM_CLEAR_RECT.maxX - MARGIN,
  minZ: ROOM_CLEAR_RECT.minZ + MARGIN,
  maxZ: ROOM_CLEAR_RECT.maxZ - MARGIN,
} as const;
/** Where the person may stand in it: one body radius from every wall. */
const WALKABLE_BOUNDS = insetRect(ROOM_CLEAR_RECT, BODY_RADIUS);
/**
 * The tightest pose the room allows: backed into its max corner, facing the min corner.
 *
 * Written out here rather than taken from a pose factory of `eyeNavigation.ts`, because what
 * these cases need is the geometry — a body flush against two walls at once — and not whichever
 * pose the viewer happens to start a walk from.
 */
const START_POSE: EyePose = {
  x: WALKABLE_BOUNDS.maxX,
  z: WALKABLE_BOUNDS.maxZ,
  yaw: Math.atan2(
    WALKABLE_BOUNDS.maxX - WALKABLE_BOUNDS.minX,
    WALKABLE_BOUNDS.maxZ - WALKABLE_BOUNDS.minZ,
  ),
  pitch: 0,
};

const LOW_CEILING = 2.2;
const LOW_CEILING_FIELD = createCameraField(OPEN_WALK, LOW_CEILING);

/** Inner face of the single wall the doorway and window fields are built around, in metres. */
const WALL_FACE_Z = 1;
/** Half width of the doorway: a 0.90 m door, the width of the narrowest real one. */
const DOOR_HALF_WIDTH = 0.45;
const PARTITION_HALF_LENGTH = 5;
const PARTITION_FLOOR = makeRect(
  -PARTITION_HALF_LENGTH,
  PARTITION_HALF_LENGTH,
  -PARTITION_HALF_LENGTH,
  PARTITION_HALF_LENGTH,
);
/**
 * A wall 1.00 m behind the origin, unbroken: what a window leaves.
 *
 * A window sills at 0.60 m or above, so its sill block is solid at body height and the
 * blocker runs right across the opening (`collision.ts`). There is nothing for the camera
 * to slip through.
 */
const WINDOW_WALK: WalkField = makeWalkField(
  [PARTITION_FLOOR],
  [
    makeRect(
      -PARTITION_HALF_LENGTH,
      PARTITION_HALF_LENGTH,
      WALL_FACE_Z,
      WALL_FACE_Z + WALL_THICKNESS,
    ),
  ],
);
const WINDOW_FIELD = createCameraField(WINDOW_WALK, FLOOR_HEIGHTS.wall);
/** The same wall with a door in it: the threshold is floor, so only the two jambs block. */
const DOORWAY_WALK: WalkField = makeWalkField(
  [PARTITION_FLOOR],
  [
    makeRect(-PARTITION_HALF_LENGTH, -DOOR_HALF_WIDTH, WALL_FACE_Z, WALL_FACE_Z + WALL_THICKNESS),
    makeRect(DOOR_HALF_WIDTH, PARTITION_HALF_LENGTH, WALL_FACE_Z, WALL_FACE_Z + WALL_THICKNESS),
  ],
);
const DOORWAY_FIELD = createCameraField(DOORWAY_WALK, FLOOR_HEIGHTS.wall);

/** The real collision field of the real floor, under its 2.70 m walls. */
const REAL_FIELD = createCameraField(
  getWalkField(getBuiltFloor(), FLOOR_PLAN.plot),
  FLOOR_HEIGHTS.wall,
);

const WALL_GAP = 0.5;
const CORNER_GAP = 0.3;
const LOOK_DOWN_PITCH = -Math.PI / 3;
const FREE_SPACE_YAW = Math.PI / 5;
const BEYOND_LIMIT_PITCH = Math.PI;
const OUTSIDE_OFFSET = 17;

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
 * Asserts that the camera stands where a circle of the camera margin legally may.
 *
 * This is the field-era replacement for "inside the room box": the camera must overlap no
 * blocker, and must stay within the vertical range. It says nothing about which room the
 * camera is in, because following through a doorway is allowed.
 *
 * @param camera - The camera placement.
 * @param field - The field it was placed in.
 */
function expectClearOfBlockers(camera: ThirdPersonCamera, field: CameraField): void {
  const { position } = camera;
  expect(isClear({ x: position.x, z: position.z }, field.walk, MARGIN)).toBe(true);
  expect(position.y).toBeGreaterThanOrEqual(field.minY);
  expect(position.y).toBeLessThanOrEqual(field.maxY);
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

    it('leaves the body visible with the back flat against a wall face', () => {
      /** Clearance left behind the body centre: the body radius less the camera margin. */
      const ROOM_AT_WALKING_LIMIT = BODY_RADIUS - MARGIN;

      expect(Math.acos(ROOM_AT_WALKING_LIMIT / VISIBLE_DISTANCE)).toBeLessThan(MAX_ELEVATION);
    });
  });

  describe('createCameraField', () => {
    const CEILING = 2.7;

    it('keeps the walk field and derives the vertical range from the margin', () => {
      const field = createCameraField(ROOM_WALK, CEILING);

      expect(field.walk).toBe(ROOM_WALK);
      expect(field.minY).toBe(MARGIN);
      expect(field.maxY).toBeCloseTo(CEILING - MARGIN, PRECISION_DIGITS);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(createCameraField(ROOM_WALK, CEILING))).toBe(true);
    });

    it.each([
      ['a non-finite ceiling', Number.POSITIVE_INFINITY],
      ['a NaN ceiling', Number.NaN],
      ['a ceiling with no room above the margin', MARGIN + MARGIN],
      ['a negative ceiling', -CEILING],
    ] as const)('rejects %s', (_label, ceiling) => {
      expect(() => createCameraField(ROOM_WALK, ceiling)).toThrow(RangeError);
    });
  });

  describe('getThirdPersonCamera in free space', () => {
    const camera = getThirdPersonCamera(pose({ yaw: FREE_SPACE_YAW }), OPEN_FIELD);

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
      const camera = getThirdPersonCamera(pose({ yaw }), ROOM_FIELD);
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
    it('stops a wall 1.00 m behind the person at that wall, less the margin', () => {
      /** Distance from the person to the wall face behind, in metres. */
      const WALL_DISTANCE = 1;
      const start = pose({ z: WALL_FACE_Z - WALL_DISTANCE, yaw: YAW_FACING_MINUS_Z });
      const camera = getThirdPersonCamera(start, WINDOW_FIELD);
      const planRoom = WALL_DISTANCE - MARGIN;

      expect(camera.elevation).toBe(BASE_ELEVATION);
      expect(camera.distance).toBeCloseTo(planRoom / Math.cos(BASE_ELEVATION), PRECISION_DIGITS);
      expect(camera.position.z).toBeCloseTo(WALL_FACE_Z - MARGIN, PRECISION_DIGITS);
      expectClearOfBlockers(camera, WINDOW_FIELD);
    });

    it.each([
      ['+z', pose({ z: CAMERA_LIMITS.maxZ - WALL_GAP, yaw: YAW_FACING_MINUS_Z }), 'z', 'maxZ'],
      ['-z', pose({ z: CAMERA_LIMITS.minZ + WALL_GAP, yaw: YAW_FACING_PLUS_Z }), 'z', 'minZ'],
      ['+x', pose({ x: CAMERA_LIMITS.maxX - WALL_GAP, yaw: YAW_FACING_MINUS_X }), 'x', 'maxX'],
      ['-x', pose({ x: CAMERA_LIMITS.minX + WALL_GAP, yaw: YAW_FACING_PLUS_X }), 'x', 'minX'],
    ] as const)('stops at the %s wall behind the person', (_side, start, axis, limit) => {
      const camera = getThirdPersonCamera(start, ROOM_FIELD);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position[axis]).toBeCloseTo(CAMERA_LIMITS[limit], PRECISION_DIGITS);
      expectClearOfBlockers(camera, ROOM_FIELD);
    });

    it('stays clear of both walls in a corner', () => {
      const start = pose({
        x: CAMERA_LIMITS.maxX - CORNER_GAP,
        z: CAMERA_LIMITS.maxZ - CORNER_GAP,
        yaw: YAW_BACK_TO_MAX_CORNER,
      });
      const camera = getThirdPersonCamera(start, ROOM_FIELD);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expectClearOfBlockers(camera, ROOM_FIELD);
    });
  });

  describe('getThirdPersonCamera through an opening behind the person', () => {
    /** Straight behind the doorway, one metre in front of the wall. */
    const start = pose({ z: WALL_FACE_Z - 1, yaw: YAW_FACING_MINUS_Z });

    it('follows through an open doorway instead of stopping at the wall plane', () => {
      const camera = getThirdPersonCamera(start, DOORWAY_FIELD);

      expect(camera.distance).toBe(FOLLOW_DISTANCE);
      expect(camera.position.z).toBeGreaterThan(WALL_FACE_Z + WALL_THICKNESS);
      expect(camera.elevation).toBe(BASE_ELEVATION);
      expectClearOfBlockers(camera, DOORWAY_FIELD);
    });

    it('never passes through a window in the same wall', () => {
      const camera = getThirdPersonCamera(start, WINDOW_FIELD);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position.z).toBeLessThanOrEqual(WALL_FACE_Z - MARGIN + TOLERANCE);
      expectClearOfBlockers(camera, WINDOW_FIELD);
    });

    it('still stops at a jamb when the doorway is not behind the person', () => {
      /** Far enough off the opening that the grown jamb is squarely behind the person. */
      const OFF_AXIS_X = 1;
      const camera = getThirdPersonCamera({ ...start, x: OFF_AXIS_X }, DOORWAY_FIELD);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position.z).toBeCloseTo(WALL_FACE_Z - MARGIN, PRECISION_DIGITS);
      expectClearOfBlockers(camera, DOORWAY_FIELD);
    });
  });

  describe('getThirdPersonCamera with little room behind the person', () => {
    /** Room left behind the person at the walking limit: body radius minus camera margin. */
    const ROOM_AT_WALKING_LIMIT = BODY_RADIUS - MARGIN;

    it('shows the person from the start pose, raised just enough', () => {
      const camera = getThirdPersonCamera(START_POSE, ROOM_FIELD);
      /** Plan clearance behind the corner start pose, along `(sin yaw, cos yaw)`. */
      const planRoom = Math.min(
        ROOM_AT_WALKING_LIMIT / Math.sin(START_POSE.yaw),
        ROOM_AT_WALKING_LIMIT / Math.cos(START_POSE.yaw),
      );
      const lowestVisible = Math.acos(planRoom / VISIBLE_DISTANCE);

      expect(shouldHidePersonModel(camera)).toBe(false);
      expect(camera.distance).toBeGreaterThanOrEqual(VISIBLE_DISTANCE - TOLERANCE);
      expect(camera.elevation).toBeCloseTo(lowestVisible, PRECISION_DIGITS);
      expect(elevationOf(camera)).toBeCloseTo(lowestVisible, PRECISION_DIGITS);
      expectClearOfBlockers(camera, ROOM_FIELD);
    });

    it.each([
      ['+z', pose({ z: WALKABLE_BOUNDS.maxZ, yaw: YAW_FACING_MINUS_Z })],
      ['-z', pose({ z: WALKABLE_BOUNDS.minZ, yaw: YAW_FACING_PLUS_Z })],
      ['+x', pose({ x: WALKABLE_BOUNDS.maxX, yaw: YAW_FACING_MINUS_X })],
      ['-x', pose({ x: WALKABLE_BOUNDS.minX, yaw: YAW_FACING_PLUS_X })],
    ] as const)(
      'shows the person with the back flat against the %s wall, from above and behind',
      (_side, start) => {
        const camera = getThirdPersonCamera(start, ROOM_FIELD);

        expect(shouldHidePersonModel(camera)).toBe(false);
        expect(camera.distance).toBeGreaterThanOrEqual(VISIBLE_DISTANCE - TOLERANCE);
        expect(camera.elevation).toBeCloseTo(
          Math.acos(ROOM_AT_WALKING_LIMIT / VISIBLE_DISTANCE),
          PRECISION_DIGITS,
        );
        expect(camera.elevation).toBeLessThanOrEqual(MAX_ELEVATION);
        expect(camera.position.y).toBeGreaterThan(camera.target.y);
        expectClearOfBlockers(camera, ROOM_FIELD);
        expectNotInFront(camera, start.yaw);
      },
    );

    it('keeps the requested elevation and full follow distance in open space', () => {
      const start = pose({ yaw: FREE_SPACE_YAW, pitch: LOOK_DOWN_PITCH });
      const requested =
        BASE_ELEVATION + (-LOOK_DOWN_PITCH / MAX_PITCH) * (MAX_ELEVATION - BASE_ELEVATION);
      const camera = getThirdPersonCamera(start, OPEN_FIELD);

      expect(camera.elevation).toBeCloseTo(requested, PRECISION_DIGITS);
      expect(camera.distance).toBe(FOLLOW_DISTANCE);
    });

    describe('under a ceiling too low to reach the visible distance', () => {
      /** Room between the head and the field's top. */
      const CEILING_ROOM = 0.2;
      /** Room behind the person on the plan. */
      const BACK_ROOM = 0.1;
      const field = createCameraField(WINDOW_WALK, TARGET_HEIGHT + CEILING_ROOM + MARGIN);
      const start = pose({ z: WALL_FACE_Z - MARGIN - BACK_ROOM, yaw: YAW_FACING_MINUS_Z });
      const verticalRoom = field.maxY - TARGET_HEIGHT;
      const camera = getThirdPersonCamera(start, field);

      it('is a case where the ceiling forbids the lowest visible elevation', () => {
        const lowestVisible = Math.acos(Math.min(1, BACK_ROOM / VISIBLE_DISTANCE));
        const highestUnderCeiling = Math.asin(Math.min(1, verticalRoom / VISIBLE_DISTANCE));

        expect(verticalRoom).toBeCloseTo(CEILING_ROOM, PRECISION_DIGITS);
        expect(highestUnderCeiling).toBeLessThan(lowestVisible);
      });

      it('falls back to the elevation that maximises the distance, clear of the wall', () => {
        const expected = Math.min(
          Math.max(Math.atan2(verticalRoom, BACK_ROOM), BASE_ELEVATION),
          MAX_ELEVATION,
        );

        expect(camera.elevation).toBeCloseTo(expected, PRECISION_DIGITS);
        expect(camera.distance).toBeCloseTo(Math.hypot(BACK_ROOM, verticalRoom), PRECISION_DIGITS);
        expect(shouldHidePersonModel(camera)).toBe(true);
        expectClearOfBlockers(camera, field);
      });
    });

    it('never gets closer as the person moves away from the wall behind', () => {
      const STEP = 0.01;
      let previous = 0;
      for (let z = CAMERA_LIMITS.maxZ; z >= WALKABLE_BOUNDS.minZ; z -= STEP) {
        const camera = getThirdPersonCamera(pose({ z, yaw: YAW_FACING_MINUS_Z }), ROOM_FIELD);

        expect(camera.distance).toBeGreaterThanOrEqual(previous - TOLERANCE);
        expectClearOfBlockers(camera, ROOM_FIELD);
        previous = camera.distance;
      }
      expect(previous).toBe(FOLLOW_DISTANCE);
    });
  });

  describe('getThirdPersonCamera ceiling and floor', () => {
    it('raises the camera when looking down', () => {
      const level = getThirdPersonCamera(pose(), OPEN_FIELD);
      const lookingDown = getThirdPersonCamera(pose({ pitch: LOOK_DOWN_PITCH }), OPEN_FIELD);

      expect(lookingDown.position.y).toBeGreaterThan(level.position.y);
    });

    it('lowers the camera down to head level when looking up, never below', () => {
      const level = getThirdPersonCamera(pose(), OPEN_FIELD);
      const lookingUp = getThirdPersonCamera(pose({ pitch: -LOOK_DOWN_PITCH }), OPEN_FIELD);
      const fullyUp = getThirdPersonCamera(pose({ pitch: MAX_PITCH }), OPEN_FIELD);

      expect(lookingUp.position.y).toBeLessThan(level.position.y);
      expect(lookingUp.position.y).toBeGreaterThan(lookingUp.target.y);
      expect(fullyUp.position.y).toBeCloseTo(fullyUp.target.y, PRECISION_DIGITS);
      expect(fullyUp.distance).toBe(FOLLOW_DISTANCE);
    });

    it('stays under a low ceiling and pulls in when looking down', () => {
      const camera = getThirdPersonCamera(pose({ pitch: LOOK_DOWN_PITCH }), LOW_CEILING_FIELD);

      expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
      expect(camera.position.y).toBeLessThanOrEqual(LOW_CEILING_FIELD.maxY);
      expect(camera.position.y).toBeCloseTo(LOW_CEILING_FIELD.maxY, PRECISION_DIGITS);
    });

    it('stays level with the head, clear of the walls, when looking fully up', () => {
      const camera = getThirdPersonCamera(pose({ pitch: MAX_PITCH }), ROOM_FIELD);

      expect(camera.position.y).toBeCloseTo(camera.target.y, PRECISION_DIGITS);
      expectClearOfBlockers(camera, ROOM_FIELD);
    });
  });

  describe('getThirdPersonCamera pitch to elevation', () => {
    /** Number of equal pitch steps sampled across [−maxPitch, +maxPitch]. */
    const PITCH_SAMPLES = 64;

    it.each([
      ['level', 0, BASE_ELEVATION],
      ['fully down', -MAX_PITCH, MAX_ELEVATION],
      ['fully up', MAX_PITCH, MIN_ELEVATION_RADIANS],
    ])('maps the %s pitch onto its elevation', (_label, pitch, expected) => {
      const camera = getThirdPersonCamera(pose({ pitch }), OPEN_FIELD);

      expect(camera.elevation).toBeCloseTo(expected, PRECISION_DIGITS);
      expect(elevationOf(camera)).toBeCloseTo(expected, PRECISION_DIGITS);
    });

    it('lowers the elevation strictly as the pitch rises, with no dead zone', () => {
      let previous = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= PITCH_SAMPLES; step += 1) {
        const pitch = -MAX_PITCH + (step / PITCH_SAMPLES) * (MAX_PITCH + MAX_PITCH);
        const { elevation } = getThirdPersonCamera(pose({ pitch }), OPEN_FIELD);

        expect(elevation).toBeLessThan(previous);
        previous = elevation;
      }
    });

    it.each([
      ['looking down', -BEYOND_LIMIT_PITCH, MAX_ELEVATION],
      ['looking up', BEYOND_LIMIT_PITCH, MIN_ELEVATION_RADIANS],
    ])('clamps the elevation when %s beyond the limit', (_label, pitch, expected) => {
      const camera = getThirdPersonCamera(pose({ pitch }), OPEN_FIELD);

      expect(camera.distance).toBeGreaterThan(0);
      expect(elevationOf(camera)).toBeCloseTo(expected, PRECISION_DIGITS);
    });

    it('never places the camera below head height, whatever the pose', () => {
      /** Number of equal steps sampled across each axis of the walkable area. */
      const POSITION_SAMPLES = 12;
      /** Number of equal yaw steps sampled across a full turn. */
      const YAW_SAMPLES = 16;
      const FULL_TURN = Math.PI + Math.PI;
      const fields = [ROOM_FIELD, LOW_CEILING_FIELD];
      let lowestElevation = Number.POSITIVE_INFINITY;
      let lowestHeightAboveHead = Number.POSITIVE_INFINITY;

      for (const field of fields) {
        for (let i = 0; i <= POSITION_SAMPLES; i += 1) {
          const x =
            WALKABLE_BOUNDS.minX +
            (i / POSITION_SAMPLES) * (WALKABLE_BOUNDS.maxX - WALKABLE_BOUNDS.minX);
          for (let j = 0; j <= POSITION_SAMPLES; j += 1) {
            const z =
              WALKABLE_BOUNDS.minZ +
              (j / POSITION_SAMPLES) * (WALKABLE_BOUNDS.maxZ - WALKABLE_BOUNDS.minZ);
            for (let k = 0; k < YAW_SAMPLES; k += 1) {
              const yaw = (k / YAW_SAMPLES) * FULL_TURN;
              for (let step = 0; step <= PITCH_SAMPLES; step += 1) {
                const pitch =
                  -BEYOND_LIMIT_PITCH +
                  (step / PITCH_SAMPLES) * (BEYOND_LIMIT_PITCH + BEYOND_LIMIT_PITCH);
                const camera = getThirdPersonCamera({ x, z, yaw, pitch }, field);
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
      ['a wall 0.5 m behind', pose({ z: CAMERA_LIMITS.maxZ - WALL_GAP, yaw: YAW_FACING_MINUS_Z })],
    ] as const)(
      'stays at or above the head, shows the person and moves smoothly: %s',
      (_label, start) => {
        let previous: ThirdPersonCamera | undefined;
        for (let step = 0; step <= LOOK_UP_STEPS; step += 1) {
          const pitch = (step / LOOK_UP_STEPS) * MAX_PITCH;
          const camera = getThirdPersonCamera({ ...start, pitch }, ROOM_FIELD);

          expect(camera.position.y).toBeGreaterThanOrEqual(camera.target.y - TOLERANCE);
          expect(shouldHidePersonModel(camera)).toBe(false);
          expectNotInFront(camera, start.yaw);
          expectClearOfBlockers(camera, ROOM_FIELD);
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

  describe('getThirdPersonCamera on the real floor', () => {
    /** Number of equal yaw steps sampled across a full turn at every sampled stance. */
    const YAW_SAMPLES = 12;
    const FULL_TURN = Math.PI + Math.PI;
    const HALF = 0.5;
    /** Fewest stances the sample must find, so the sweep cannot pass by testing nothing. */
    const MIN_STANCES = 20;

    /** Every floor rectangle centre a body actually fits on: the stances to sweep from. */
    const stances = REAL_FIELD.walk.floor
      .map((rect) => ({ x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF }))
      .filter((point) => isClear(point, REAL_FIELD.walk, BODY_RADIUS));

    it('finds enough legal stances to sweep', () => {
      expect(stances.length).toBeGreaterThan(MIN_STANCES);
    });

    it('never stands inside a wall, a hole or a railing, from any stance or yaw', () => {
      for (const stance of stances) {
        for (let k = 0; k < YAW_SAMPLES; k += 1) {
          const yaw = (k / YAW_SAMPLES) * FULL_TURN;
          const camera = getThirdPersonCamera({ ...stance, yaw, pitch: 0 }, REAL_FIELD);

          expectClearOfBlockers(camera, REAL_FIELD);
          expect(camera.distance).toBeLessThanOrEqual(FOLLOW_DISTANCE);
          expect(camera.position.y).toBeGreaterThanOrEqual(camera.target.y - TOLERANCE);
        }
      }
    });
  });

  describe('getThirdPersonCamera purity', () => {
    it('takes the target from the pose on the plan, with no clamp', () => {
      const outside = pose({ x: OUTSIDE_OFFSET, z: -OUTSIDE_OFFSET });
      const camera = getThirdPersonCamera(outside, ROOM_FIELD);

      expect(camera.target.x).toBe(outside.x);
      expect(camera.target.z).toBe(outside.z);
      expect(camera.target.y).toBe(TARGET_HEIGHT);
    });

    it('never mutates the input pose or field', () => {
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
      const poseSnapshot = { ...start };
      const fieldSnapshot = structuredClone({
        floor: [...ROOM_FIELD.walk.floor],
        blockers: [...ROOM_FIELD.walk.blockers],
        minY: ROOM_FIELD.minY,
        maxY: ROOM_FIELD.maxY,
      });

      getThirdPersonCamera(start, ROOM_FIELD);

      expect(start).toEqual(poseSnapshot);
      expect({
        floor: [...ROOM_FIELD.walk.floor],
        blockers: [...ROOM_FIELD.walk.blockers],
        minY: ROOM_FIELD.minY,
        maxY: ROOM_FIELD.maxY,
      }).toEqual(fieldSnapshot);
    });

    it('returns the same placement for the same inputs, in a new object', () => {
      const start = pose({ z: CAMERA_LIMITS.maxZ - WALL_GAP, yaw: YAW_FACING_MINUS_Z });
      const first = getThirdPersonCamera(start, ROOM_FIELD);
      const second = getThirdPersonCamera(start, ROOM_FIELD);

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
    });
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
      /** Flush against the wall face the camera itself stops at: closer than a body may stand. */
      const camera = getThirdPersonCamera(
        pose({ z: CAMERA_LIMITS.maxZ, yaw: YAW_FACING_MINUS_Z }),
        ROOM_FIELD,
      );

      expect(camera.distance).toBe(0);
      expect(shouldHidePersonModel(camera)).toBe(true);
    });
  });
});
