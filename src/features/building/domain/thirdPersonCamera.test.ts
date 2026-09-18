import { describe, expect, it } from 'vitest';
import { getBuiltFloor } from './builtFloor.ts';
import { getClearance, getWalkField, isClear, makeWalkField } from './collision.ts';
import type { WalkField } from './collision.ts';
import {
  createArrivalPose,
  EYE_NAVIGATION_CONFIG,
  getFootLevel,
  getSurfaceField,
} from './eyeNavigation.ts';
import type { EyePose, WalkSurface } from './eyeNavigation.ts';
import { FLOOR_PLAN } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';
import { insetRect, LENGTH_TOLERANCE, makeRect, rectContainsRect } from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { getStairsLayout, getStairwell } from './stairs.ts';
import { getRampRise } from './stairwell.ts';
import type { StairLanding, StairRamp, Stairwell } from './stairwell.ts';
import { getStoreyLevel } from './storeys.ts';
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

/** The storey a synthetic pose stands on unless the case says otherwise. */
const GROUND_FLOOR = 1;
/** A storey well up the stack: its datum is 6.00 m, far from every floor-1 expectation. */
const UPPER_FLOOR = 3;
/** Standing on a storey's own finished floor: the rise every flat-floor pose is at. */
const ON_THE_FLOOR = 0;
/** Level of the ground storey's finished floor: the datum of the whole stack. */
const GROUND_LEVEL = 0;

/** The real stair of the typical floor: the bay the camera has to see into. */
const REAL_LAYOUT = getStairsLayout();
const REAL_WELL: Stairwell = getStairwell(REAL_LAYOUT, FLOOR_HEIGHTS, {
  hasAbove: true,
  hasBelow: true,
});

/**
 * A bay far from every synthetic test room, so a flat-floor case never meets a stair.
 *
 * The surfaces built on it then behave exactly as the single plan field the camera
 * read before the stack existed, which is what lets every floor-1 expectation of this
 * file stand unchanged.
 */
const FAR_AWAY = 1000;
const NO_STAIR_WELL: Stairwell = Object.freeze({
  bay: makeRect(FAR_AWAY, FAR_AWAY + 1, FAR_AWAY, FAR_AWAY + 1),
  ramps: [],
  landings: [],
  reach: REAL_WELL.reach,
});

/**
 * Wraps a plan field as the walking surface of a storey.
 *
 * @param field - The field outside the stair bay.
 * @param well - The stairwell; none anywhere near, by default.
 * @param bayField - The field inside the bay; the same one, by default.
 * @returns The surface a camera field is built on.
 */
function surfaceOf(
  field: WalkField,
  well: Stairwell = NO_STAIR_WELL,
  bayField: WalkField = field,
): WalkSurface {
  return { field, bayField, well, floorToFloor: FLOOR_HEIGHTS.floorToFloor };
}

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
const OPEN_SURFACE: WalkSurface = surfaceOf(OPEN_WALK);
/** Floor with nothing on it under a very high ceiling: the camera is bounded by nothing. */
const OPEN_FIELD = createCameraField(OPEN_SURFACE, OPEN_CEILING);

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
const ROOM_SURFACE: WalkSurface = surfaceOf(ROOM_WALK);
/** Camera field of that room, under a 2.70 m wall. */
const ROOM_FIELD = createCameraField(ROOM_SURFACE, FLOOR_HEIGHTS.wall);
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
  floor: GROUND_FLOOR,
  rise: ON_THE_FLOOR,
};

const LOW_CEILING = 2.2;
const LOW_CEILING_FIELD = createCameraField(OPEN_SURFACE, LOW_CEILING);

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
const WINDOW_SURFACE: WalkSurface = surfaceOf(WINDOW_WALK);
const WINDOW_FIELD = createCameraField(WINDOW_SURFACE, FLOOR_HEIGHTS.wall);
/** The same wall with a door in it: the threshold is floor, so only the two jambs block. */
const DOORWAY_WALK: WalkField = makeWalkField(
  [PARTITION_FLOOR],
  [
    makeRect(-PARTITION_HALF_LENGTH, -DOOR_HALF_WIDTH, WALL_FACE_Z, WALL_FACE_Z + WALL_THICKNESS),
    makeRect(DOOR_HALF_WIDTH, PARTITION_HALF_LENGTH, WALL_FACE_Z, WALL_FACE_Z + WALL_THICKNESS),
  ],
);
const DOORWAY_SURFACE: WalkSurface = surfaceOf(DOORWAY_WALK);
const DOORWAY_FIELD = createCameraField(DOORWAY_SURFACE, FLOOR_HEIGHTS.wall);

const REAL_FLOOR = getBuiltFloor();

/** The swept plan field of the real floor: the stair bay is a hole in it. */
const REAL_WALK: WalkField = getWalkField(REAL_FLOOR, FLOOR_PLAN.plot);

/**
 * The real floor as a walking surface: its swept plan field, and the real stair bay.
 *
 * The bay field releases the shaft the way a body inside it is bounded: the fall
 * cells the sweep left inside the bay stop being blockers and the bay becomes floor,
 * while every wall around it still blocks. That is the field `getSurfaceField` hands
 * the camera for a body standing anywhere in the bay.
 */
const REAL_SURFACE: WalkSurface = surfaceOf(
  REAL_WALK,
  REAL_WELL,
  makeWalkField(
    [...REAL_WALK.floor, REAL_LAYOUT.bay],
    REAL_WALK.blockers.filter((rect) => !rectContainsRect(REAL_LAYOUT.bay, rect)),
  ),
);

/** The real collision field of the real floor, under its 2.70 m walls. */
const REAL_FIELD = createCameraField(REAL_SURFACE, FLOOR_HEIGHTS.wall);

/**
 * Where every interior visit begins: the stairs arrival of the real floor, looking level.
 *
 * Derived here the way `ui/floorInstance.ts` derives the pose the explorer and the camera
 * transition share, so this file pins the framing of the pose the viewer actually arrives in
 * rather than of a synthetic one.
 */
const REAL_START_POSE: EyePose = createArrivalPose(REAL_FLOOR.stairs.arrival, GROUND_FLOOR);

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

const LEVEL_POSE: EyePose = {
  x: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  floor: GROUND_FLOOR,
  rise: ON_THE_FLOOR,
};

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
 * The blockers consulted are the ones that actually bounded the placement: the field
 * `getSurfaceField` picks for the BODY's stance, which the camera's target is. Judging a
 * camera inside the open stair shaft by the plan field — where the shaft is a hole — would
 * fail it for standing exactly where the surface says it may.
 *
 * @param camera - The camera placement.
 * @param field - The field it was placed in.
 * @param base - Level of the body's storey datum, in metres; the ground storey's `0` by
 *   default, which is where every case of this file that is not about the stack stands.
 */
function expectClearOfBlockers(
  camera: ThirdPersonCamera,
  field: CameraField,
  base: number = GROUND_LEVEL,
): void {
  const { position, target } = camera;
  const bounding = getSurfaceField(field.surface, { x: target.x, z: target.z }, MARGIN);
  expect(isClear({ x: position.x, z: position.z }, bounding, MARGIN)).toBe(true);
  expect(position.y).toBeGreaterThanOrEqual(base + field.minY);
  expect(position.y).toBeLessThanOrEqual(base + field.maxY);
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

/** Storey pitches of stair repeat looked at above a point when reading what stands over it. */
const STOREYS_OVERHEAD = 2;
/** Samples taken along a sightline when looking for the stair lying across it. */
const SIGHTLINE_SAMPLES = 400;
/** Slack, in metres, either side of a level before a sample counts as clear of a surface. */
const LEVEL_SLACK = 1e-6;
/** Decimal places a failure message reports a level and a position along the sightline to. */
const PLACES = 2;

/** One stair surface found over a point: which surface it is, and how high it stands there. */
interface StairOverhead {
  /** Names the surface along the whole sightline: a flight's level changes, its name does not. */
  readonly name: string;
  /** Level of that surface over the point, in metres on the datum of the whole stack. */
  readonly level: number;
}

/**
 * Every stair surface standing over a plan point, with the level it stands at there.
 *
 * The stair repeats every storey, so each surface of the stairwell is read where it stands and
 * at whole storey pitches above it: that is how the flight of the storey ABOVE — which no
 * `Stairwell` of this storey lists, because a walker can never reach it — is found at all.
 *
 * Footprints are shrunk by the camera margin, the same convention the placement uses: the two
 * flights of the half-turn meet along one line, and a camera on that line is threading the open
 * middle of the shaft rather than passing under either of them.
 *
 * @param point - Where to look, in plan coordinates.
 * @returns One entry per surface and per storey repeat standing over the point.
 */
function stairLevelsOver(point: PlanPoint): readonly StairOverhead[] {
  const named: readonly { readonly name: string; readonly level: number | undefined }[] = [
    ...REAL_WELL.ramps.map((ramp: StairRamp, index: number) => ({
      name: `flight ${String(index)}`,
      level: coversPoint(ramp.rect, point) ? getRampRise(ramp, point) : undefined,
    })),
    ...REAL_WELL.landings.map((landing: StairLanding, index: number) => ({
      name: `landing ${String(index)}`,
      level: coversPoint(landing.rect, point) ? landing.level : undefined,
    })),
  ];

  return named.flatMap(({ name, level }) =>
    level === undefined
      ? []
      : Array.from({ length: STOREYS_OVERHEAD + 1 }, (_, storey) => ({
          name: `${name}, ${String(storey)} storeys up`,
          level: level + storey * FLOOR_HEIGHTS.floorToFloor,
        })),
  );
}

/**
 * Tells whether a point lies under a stair footprint, by the camera's own margin.
 *
 * @param rect - The footprint.
 * @param point - The point.
 * @returns `true` when the point is inside the rectangle shrunk by {@link MARGIN} on every face.
 */
function coversPoint(rect: PlanRect, point: PlanPoint): boolean {
  return (
    point.x >= rect.minX + MARGIN &&
    point.x <= rect.maxX - MARGIN &&
    point.z >= rect.minZ + MARGIN &&
    point.z <= rect.maxZ - MARGIN
  );
}

/**
 * Asserts that no stair surface lies across the line from the head to the camera.
 *
 * This is the "is the person actually in frame" check, read off the geometry rather than off
 * the placement maths: the sightline is walked from the head outwards, and a surface the line
 * passes UNDER at one sample and OVER at a later one has been crossed — the camera came up
 * through a flight or a landing, and that flight or landing now stands between it and the body.
 *
 * @param camera - The camera placement.
 */
function expectNothingAcrossTheSightline(camera: ThirdPersonCamera): void {
  const { target, position } = camera;
  const passedUnder = new Set<string>();
  const crossed: string[] = [];
  for (let sample = 0; sample <= SIGHTLINE_SAMPLES; sample += 1) {
    const along = sample / SIGHTLINE_SAMPLES;
    const height = target.y + (position.y - target.y) * along;
    const overhead = stairLevelsOver({
      x: target.x + (position.x - target.x) * along,
      z: target.z + (position.z - target.z) * along,
    });
    for (const { name, level } of overhead) {
      if (height < level - LEVEL_SLACK) {
        passedUnder.add(name);
      } else if (height > level + LEVEL_SLACK && passedUnder.has(name)) {
        crossed.push(`${name}, crossed ${along.toFixed(PLACES)} of the way out`);
      }
    }
  }

  expect(crossed).toEqual([]);
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

    it('is a distance the raise can reach with the back flat against a wall face', () => {
      /** Clearance left behind the body centre: the body radius less the camera margin. */
      const ROOM_AT_WALKING_LIMIT = BODY_RADIUS - MARGIN;

      // The elevation that buys the threshold distance from that clearance is inside the
      // limit, so the camera is never pinned against the wall short of it.
      expect(Math.acos(ROOM_AT_WALKING_LIMIT / VISIBLE_DISTANCE)).toBeLessThan(MAX_ELEVATION);
    });
  });

  describe('createCameraField', () => {
    const CEILING = 2.7;

    it('keeps the walk field and derives the vertical range from the margin', () => {
      const field = createCameraField(ROOM_SURFACE, CEILING);

      expect(field.surface).toBe(ROOM_SURFACE);
      expect(field.minY).toBe(MARGIN);
      expect(field.maxY).toBeCloseTo(CEILING - MARGIN, PRECISION_DIGITS);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(createCameraField(ROOM_SURFACE, CEILING))).toBe(true);
    });

    it.each([
      ['a non-finite ceiling', Number.POSITIVE_INFINITY],
      ['a NaN ceiling', Number.NaN],
      ['a ceiling with no room above the margin', MARGIN + MARGIN],
      ['a negative ceiling', -CEILING],
    ] as const)('rejects %s', (_label, ceiling) => {
      expect(() => createCameraField(ROOM_SURFACE, ceiling)).toThrow(RangeError);
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

    it('raises the camera to the threshold distance from the start pose, model hidden', () => {
      const camera = getThirdPersonCamera(START_POSE, ROOM_FIELD);
      /** Plan clearance behind the corner start pose, along `(sin yaw, cos yaw)`. */
      const planRoom = Math.min(
        ROOM_AT_WALKING_LIMIT / Math.sin(START_POSE.yaw),
        ROOM_AT_WALKING_LIMIT / Math.cos(START_POSE.yaw),
      );
      const lowestVisible = Math.acos(planRoom / VISIBLE_DISTANCE);

      expect(camera.distance).toBeCloseTo(VISIBLE_DISTANCE, PRECISION_DIGITS);
      // The raise buys the whole threshold distance and not one millimetre more, so the body
      // still covers the middle of the frame: the model goes, the view stays behind the head.
      expect(shouldHidePersonModel(camera)).toBe(true);
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
      'looks down on the person with the back flat against the %s wall, from above and behind',
      (_side, start) => {
        const camera = getThirdPersonCamera(start, ROOM_FIELD);

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
      const field = createCameraField(WINDOW_SURFACE, TARGET_HEIGHT + CEILING_ROOM + MARGIN);
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
                const camera = getThirdPersonCamera(
                  { x, z, yaw, pitch, floor: GROUND_FLOOR, rise: ON_THE_FLOOR },
                  field,
                );
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
      'stays at or above the head, keeps the threshold distance and moves smoothly: %s',
      (_label, start) => {
        let previous: ThirdPersonCamera | undefined;
        for (let step = 0; step <= LOOK_UP_STEPS; step += 1) {
          const pitch = (step / LOOK_UP_STEPS) * MAX_PITCH;
          const camera = getThirdPersonCamera({ ...start, pitch }, ROOM_FIELD);

          expect(camera.position.y).toBeGreaterThanOrEqual(camera.target.y - TOLERANCE);
          // The raise never gives up distance as the pitch rises: whether the model is shown
          // at the end of it is {@link shouldHidePersonModel}'s own boundary case, below.
          expect(camera.distance).toBeGreaterThanOrEqual(VISIBLE_DISTANCE - TOLERANCE);
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
    const stances = REAL_FIELD.surface.field.floor
      .map((rect) => ({ x: (rect.minX + rect.maxX) * HALF, z: (rect.minZ + rect.maxZ) * HALF }))
      .filter((point) => isClear(point, REAL_FIELD.surface.field, BODY_RADIUS));

    it('finds enough legal stances to sweep', () => {
      expect(stances.length).toBeGreaterThan(MIN_STANCES);
    });

    it('never stands inside a wall, a hole or a railing, from any stance or yaw', () => {
      for (const stance of stances) {
        for (let k = 0; k < YAW_SAMPLES; k += 1) {
          const yaw = (k / YAW_SAMPLES) * FULL_TURN;
          const camera = getThirdPersonCamera(
            { ...stance, yaw, pitch: 0, floor: GROUND_FLOOR, rise: ON_THE_FLOOR },
            REAL_FIELD,
          );

          expectClearOfBlockers(camera, REAL_FIELD);
          expect(camera.distance).toBeLessThanOrEqual(FOLLOW_DISTANCE);
          expect(camera.position.y).toBeGreaterThanOrEqual(camera.target.y - TOLERANCE);
        }
      }
    });
  });

  describe('getThirdPersonCamera up the stack', () => {
    /** The pose of the free-space case, moved three storeys up without moving on the plan. */
    const upstairs = pose({ yaw: FREE_SPACE_YAW, floor: UPPER_FLOOR });
    const downstairs = pose({ yaw: FREE_SPACE_YAW });
    /** Level of the third storey's finished floor: two pitches above the datum, 6.00 m. */
    const upperLevel = getStoreyLevel(UPPER_FLOOR);

    it('stands the storey on its own datum rather than on the ground', () => {
      expect(upperLevel).toBeCloseTo(
        (UPPER_FLOOR - GROUND_FLOOR) * FLOOR_HEIGHTS.floorToFloor,
        PRECISION_DIGITS,
      );
      expect(getFootLevel(upstairs)).toBe(upperLevel);
    });

    it('looks at the head over the storey the body stands on, not over storey 1', () => {
      const camera = getThirdPersonCamera(upstairs, ROOM_FIELD);
      /** The head on the third storey: 6.00 m of stack plus the 1.68 m eye height. */
      const EXPECTED_TARGET_Y = 7.68;

      expect(camera.target.y).toBeCloseTo(upperLevel + TARGET_HEIGHT, PRECISION_DIGITS);
      expect(camera.target.y).toBeCloseTo(EXPECTED_TARGET_Y, PRECISION_DIGITS);
    });

    it('is never clamped down to the ground storey ceiling', () => {
      const camera = getThirdPersonCamera(upstairs, ROOM_FIELD);

      // The band is storey-relative, so the absolute heights are a whole stack above the
      // 2.55 m the ground storey's field would have clamped both the head and the camera to.
      expect(camera.position.y).toBeGreaterThan(ROOM_FIELD.maxY);
      expect(camera.target.y).toBeGreaterThan(ROOM_FIELD.maxY);
      expectClearOfBlockers(camera, ROOM_FIELD, upperLevel);
    });

    it('places the camera identically on every storey, lifted by the storey level', () => {
      const up = getThirdPersonCamera(upstairs, ROOM_FIELD);
      const down = getThirdPersonCamera(downstairs, ROOM_FIELD);

      expect(up.position.x).toBeCloseTo(down.position.x, PRECISION_DIGITS);
      expect(up.position.z).toBeCloseTo(down.position.z, PRECISION_DIGITS);
      expect(up.position.y - down.position.y).toBeCloseTo(upperLevel, PRECISION_DIGITS);
      expect(up.distance).toBeCloseTo(down.distance, PRECISION_DIGITS);
      expect(up.elevation).toBe(down.elevation);
    });
  });

  describe('getThirdPersonCamera mid-flight on the stairs', () => {
    /** The flight climbed out of the ground storey: the one whose low end is its floor. */
    const [FLIGHT_UP] = REAL_WELL.ramps.filter(
      (ramp) => Math.abs(ramp.lowLevel) <= LENGTH_TOLERANCE,
    );
    const HALF = 0.5;

    /** Half way up that flight: on its footprint, at the rise of its midpoint. */
    const midFlight: EyePose = {
      x: (FLIGHT_UP.rect.minX + FLIGHT_UP.rect.maxX) * HALF,
      z: (FLIGHT_UP.rect.minZ + FLIGHT_UP.rect.maxZ) * HALF,
      yaw: YAW_FACING_MINUS_Z,
      pitch: 0,
      floor: GROUND_FLOOR,
      rise: (FLIGHT_UP.lowLevel + FLIGHT_UP.highLevel) * HALF,
    };

    it('is a stance the plan field alone calls a blocker', () => {
      // The premise of the case, asserted rather than assumed: outside the bay the shaft is
      // a hole, so a body standing in it reads clearance 0 in every direction.
      const back = { x: Math.sin(midFlight.yaw), z: Math.cos(midFlight.yaw) };
      const planRoom = getClearance(
        { x: midFlight.x, z: midFlight.z },
        back,
        REAL_SURFACE.field,
        MARGIN,
      );

      expect(planRoom).toBe(0);
      expect(midFlight.rise).toBeGreaterThan(0);
      expect(midFlight.rise).toBeLessThan(FLOOR_HEIGHTS.floorToFloor);
    });

    it('keeps a real distance behind the body instead of rising to overhead', () => {
      // The regression this design avoids: clearance 0 would raise the camera to overhead
      // and hide the mannequin, and the viewer would watch the top of a head climb the
      // stairs. The bay-released field the surface picks leaves the camera room behind.
      const camera = getThirdPersonCamera(midFlight, REAL_FIELD);

      expect(camera.distance).toBeGreaterThan(VISIBLE_DISTANCE);
      expect(shouldHidePersonModel(camera)).toBe(false);
      expect(camera.elevation).toBe(BASE_ELEVATION);
      expectNotInFront(camera, midFlight.yaw);
    });

    it('rides up with the body: head and camera are a part-storey above the floor', () => {
      const camera = getThirdPersonCamera(midFlight, REAL_FIELD);

      expect(camera.target.y).toBeCloseTo(midFlight.rise + TARGET_HEIGHT, PRECISION_DIGITS);
      expect(camera.position.y).toBeGreaterThan(camera.target.y);
      // Accepted, and correct for a shaft that is open through the slab: inside it the
      // camera's band is the band of the body's own storey, so it may sit above the
      // storey's nominal ceiling plane.
      expect(camera.position.y).toBeGreaterThan(FLOOR_HEIGHTS.wall);
    });
  });

  describe('getThirdPersonCamera under the stair standing overhead', () => {
    /**
     * The three poses the Chrome sweep read the camera at, on the real stair of the real floor.
     *
     * The stair is a half-turn: a flight climbs out of the arrival landing toward −x, a landing
     * half a storey up turns the walker round, and a second flight climbs back toward +x to the
     * arrival landing of the storey above. So a body anywhere on the first flight or on the turn
     * is under the flight of the storey above, which stands one whole storey over the flight it
     * is walking — and which this storey's `Stairwell` does not list, because a walker can never
     * reach it.
     */
    const HALF = 0.5;
    /** The flight climbed out of the ground storey: the one whose low end is its finished floor. */
    const [CLIMBED_FLIGHT] = REAL_WELL.ramps.filter(
      (ramp: StairRamp) => Math.abs(ramp.lowLevel) <= LENGTH_TOLERANCE,
    );
    /** Level of the half-landing, where the walker turns: half a storey up. */
    const HALF_STOREY = FLOOR_HEIGHTS.floorToFloor * HALF;
    /** The landing that turn is made on. */
    const [TURN_LANDING] = REAL_WELL.landings.filter(
      (landing: StairLanding) => Math.abs(landing.level - HALF_STOREY) <= LENGTH_TOLERANCE,
    );
    /** The line a walker comes up the flight on: its middle, off the seam with the flight beside it. */
    const CLIMB_Z = (CLIMBED_FLIGHT.rect.minZ + CLIMBED_FLIGHT.rect.maxZ) * HALF;
    /** Where the sweep read the camera mid-flight, in metres along the plan. */
    const MID_FLIGHT_X = 3;
    /** The rise the flight carries there: 1.20 m, four fifths of the way up a 1.50 m flight. */
    const MID_FLIGHT_RISE = 1.2;

    /**
     * Mid-flight, holding the heading the climb is walked with.
     *
     * The flight runs toward −x, so a walker climbing it faces −x and the camera is behind them
     * at +x — out into the shaft, and under the flight of the storey above.
     */
    const climbing: EyePose = {
      x: MID_FLIGHT_X,
      z: CLIMB_Z,
      yaw: YAW_FACING_MINUS_X,
      pitch: 0,
      floor: GROUND_FLOOR,
      rise: MID_FLIGHT_RISE,
    };
    /** On the half-landing, still facing the way the flight was climbed. */
    const onTheTurn: EyePose = {
      ...climbing,
      x: TURN_LANDING.rect.minX + BODY_RADIUS,
      rise: TURN_LANDING.level,
    };
    /** The same stance, turned round to climb the next flight: back flat to the bay wall. */
    const turnedToClimb: EyePose = { ...onTheTurn, yaw: YAW_FACING_PLUS_X };

    it('stands those three poses where the stair really puts them', () => {
      expect(CLIMBED_FLIGHT.highAt).toBeLessThan(CLIMBED_FLIGHT.lowAt);
      expect(CLIMBED_FLIGHT.highLevel).toBeCloseTo(HALF_STOREY, PRECISION_DIGITS);
      expect(getRampRise(CLIMBED_FLIGHT, { x: MID_FLIGHT_X, z: CLIMB_Z })).toBeCloseTo(
        MID_FLIGHT_RISE,
        PRECISION_DIGITS,
      );
      expect(TURN_LANDING.level).toBeCloseTo(HALF_STOREY, PRECISION_DIGITS);
      // The body is flush against the far face of the turn: the landing is a body across, so
      // this is where a walker coming off the flight actually stops.
      expect(onTheTurn.x).toBeCloseTo(TURN_LANDING.rect.minX + BODY_RADIUS, PRECISION_DIGITS);
    });

    it('keeps the flight of the storey above out of the sightline, mid-flight', () => {
      const camera = getThirdPersonCamera(climbing, REAL_FIELD);

      expectNothingAcrossTheSightline(camera);
      expectClearOfBlockers(camera, REAL_FIELD, getFootLevel(climbing));
      expectNotInFront(camera, climbing.yaw);
    });

    it('keeps the flight of the storey above out of the sightline, on the half-landing', () => {
      const camera = getThirdPersonCamera(onTheTurn, REAL_FIELD);

      expectNothingAcrossTheSightline(camera);
      expectClearOfBlockers(camera, REAL_FIELD, getFootLevel(onTheTurn));
      expectNotInFront(camera, onTheTurn.yaw);
    });

    it('keeps it out of the sightline at the arrival landing too, the pose a visit starts from', () => {
      expectNothingAcrossTheSightline(getThirdPersonCamera(REAL_START_POSE, REAL_FIELD));
    });

    it('stops short of the flight rather than letting the pull-back run under it', () => {
      // The regression: with only the plan to go on, the shaft reads "open, back up freely",
      // and the camera took the whole follow distance out into it — up through the flight of
      // the storey above, which then filled the frame. It is stopped by that flight now, so it
      // keeps less than the follow distance and more than the distance that hides the body.
      for (const stance of [climbing, onTheTurn]) {
        const camera = getThirdPersonCamera(stance, REAL_FIELD);

        expect(camera.distance).toBeLessThan(FOLLOW_DISTANCE);
        expect(camera.distance).toBeGreaterThan(VISIBLE_DISTANCE);
      }
    });

    it('frames the body at all three — "framed" being the model shown rather than hidden', () => {
      // The module's own definition of in-frame is the one used here: a camera at or within
      // `minBodyVisibleDistance` of the head fills the middle of the frame with the back of that
      // head, and `shouldHidePersonModel` takes the model away. Anything further out shows it.
      for (const stance of [climbing, onTheTurn, REAL_START_POSE]) {
        const camera = getThirdPersonCamera(stance, REAL_FIELD);

        expect(shouldHidePersonModel(camera)).toBe(false);
        expect(camera.elevation).toBe(BASE_ELEVATION);
      }
    });

    it('leaves the arrival landing its whole pull-back into the open shaft (ADR-014)', () => {
      // The shaft straight behind the arrival landing is the seam where the two flights meet,
      // and neither of them stands over it: the camera threads between them and keeps the full
      // follow distance, exactly as it did before the stair became a ceiling.
      const camera = getThirdPersonCamera(REAL_START_POSE, REAL_FIELD);

      expect(camera.distance).toBe(FOLLOW_DISTANCE);
      expect(shouldHidePersonModel(camera)).toBe(false);
      expectClearOfBlockers(camera, REAL_FIELD);
    });

    it('is the wall behind, not the stair, that pins the camera with the body turned to climb', () => {
      // The one stance on the stair the stair itself cannot help: turned round on the half-
      // landing, the body's back is a radius from the bay wall, so the plan leaves the camera
      // the same 0.10 m it leaves a body backed against any wall on any flat floor. The camera
      // rises and the model is hidden — the behaviour `MIN_BODY_VISIBLE_DISTANCE_METRES` is
      // chosen for, and the same placement relative to the feet either way.
      const onTheStair = getThirdPersonCamera(turnedToClimb, REAL_FIELD);
      const againstAWall = getThirdPersonCamera(
        pose({ z: WALKABLE_BOUNDS.maxZ, yaw: YAW_FACING_MINUS_Z }),
        ROOM_FIELD,
      );

      expect(shouldHidePersonModel(onTheStair)).toBe(true);
      expect(shouldHidePersonModel(againstAWall)).toBe(true);
      expect(onTheStair.distance).toBeCloseTo(againstAWall.distance, PRECISION_DIGITS);
      expect(onTheStair.elevation).toBeCloseTo(againstAWall.elevation, PRECISION_DIGITS);
      expect(onTheStair.position.y - getFootLevel(turnedToClimb)).toBeCloseTo(
        againstAWall.position.y - getFootLevel(LEVEL_POSE),
        PRECISION_DIGITS,
      );
      expectNothingAcrossTheSightline(onTheStair);
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
        floor: [...ROOM_FIELD.surface.field.floor],
        blockers: [...ROOM_FIELD.surface.field.blockers],
        minY: ROOM_FIELD.minY,
        maxY: ROOM_FIELD.maxY,
      });

      getThirdPersonCamera(start, ROOM_FIELD);

      expect(start).toEqual(poseSnapshot);
      expect({
        floor: [...ROOM_FIELD.surface.field.floor],
        blockers: [...ROOM_FIELD.surface.field.blockers],
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
      // The boundary itself: the distance the raise settles on whenever the plan leaves it
      // no more room. A strict `<` here left the back of a head filling the frame.
      ['hides the model at the threshold', VISIBLE_DISTANCE, true],
      [
        'hides the model a rounding error below the threshold',
        VISIBLE_DISTANCE - TOLERANCE / 2,
        true,
      ],
      [
        'hides the model a rounding error above the threshold',
        VISIBLE_DISTANCE + TOLERANCE / 2,
        true,
      ],
      ['shows the model above the threshold', VISIBLE_DISTANCE + DISTANCE_STEP, false],
      ['shows the model at the follow distance', FOLLOW_DISTANCE, false],
    ])('%s', (_label, distance, expected) => {
      expect(shouldHidePersonModel(cameraAt(distance))).toBe(expected);
    });

    it('shows the model at the real interior start pose: the shaft behind the landing is open', () => {
      // The arrival landing stands INSIDE the stair bay, facing out of it, so the field that
      // bounds the camera there is the bay-released one and what is behind the body is the
      // open shaft rather than the hole the plan field calls it. The camera therefore backs
      // into the shaft and the viewer sees the person standing on the landing — the same
      // release that keeps the body in frame mid-flight, applied at the pose the visit
      // begins from.
      const camera = getThirdPersonCamera(REAL_START_POSE, REAL_FIELD);

      expect(camera.distance).toBeGreaterThan(VISIBLE_DISTANCE);
      expect(shouldHidePersonModel(camera)).toBe(false);
      expectClearOfBlockers(camera, REAL_FIELD);
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
