import { describe, expect, it } from 'vitest';
import { makeWalkField } from '../domain/collision.ts';
import { EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import type { EyePose, WalkSurface } from '../domain/eyeNavigation.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import { makeRect } from '../domain/planGeometry.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import type { Stairwell } from '../domain/stairwell.ts';
import { MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import {
  createCameraField,
  getThirdPersonCamera,
  THIRD_PERSON_CAMERA_CONFIG,
} from '../domain/thirdPersonCamera.ts';
import type { CameraField } from '../domain/thirdPersonCamera.ts';
import {
  getMannequinPartHalfExtent,
  getMannequinParts,
  isPersonModelVisible,
} from './personModelParts.ts';
import type { MannequinPart } from './personModelParts.ts';

/** Decimal digits two lengths must share to count as equal (sub-nanometre). */
const LENGTH_PRECISION_DIGITS = 9;
/** A diameter is two radii. */
const DIAMETER_PER_RADIUS = 2;
const FLOOR_LEVEL = 0;
const SCALED_HEIGHT = 2;
const HEAD_NAME = 'head';
const LEVEL_PITCH = 0;
const FACING_NEGATIVE_Z_YAW = 0;
const INVALID_HEIGHTS = [0, -PERSON_SPEC.height, Number.NaN, Number.POSITIVE_INFINITY];

/**
 * A synthetic field rather than the live floor: what the visibility rule turns on is how much
 * room the follow camera has straight behind the person, so one wall at a known distance says
 * more than a real room whose walls would have to be looked up to read the test.
 */
const ROOM_HALF_SIZE = 20;
/** Plan x of every test pose: the middle of the room, far from its side walls. */
const ROOM_CENTRE_X = 0;
/** The z of the face of the one wall these poses stand in front of. */
const WALL_FACE_Z = 0;
/** Thickness of that wall, metres; any positive value blocks the same way. */
const WALL_THICKNESS = 0.2;

/** Open floor in front of the wall: plenty of room to stand anywhere these poses need. */
const FLOOR_RECT: PlanRect = {
  minX: -ROOM_HALF_SIZE,
  maxX: ROOM_HALF_SIZE,
  minZ: -ROOM_HALF_SIZE,
  maxZ: WALL_FACE_Z,
};
/** The wall itself, on the +z side of the floor: the only thing behind a person facing −z. */
const WALL_RECT: PlanRect = {
  minX: -ROOM_HALF_SIZE,
  maxX: ROOM_HALF_SIZE,
  minZ: WALL_FACE_Z,
  maxZ: WALL_FACE_Z + WALL_THICKNESS,
};
/**
 * A stair bay far from the room, so no pose here is ever near one: the storey below is the
 * flat floor these cases stand on, and the stairwell is `stairwell.ts`'s subject.
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

const WALLED_SURFACE: WalkSurface = Object.freeze({
  field: makeWalkField([FLOOR_RECT], [WALL_RECT]),
  bayField: makeWalkField([FLOOR_RECT], [WALL_RECT]),
  well: NO_STAIR_WELL,
  floorToFloor: FLOOR_HEIGHTS.floorToFloor,
});

const CAMERA_FIELD: CameraField = createCameraField(WALLED_SURFACE, FLOOR_HEIGHTS.wall);

/** The storey every pose of this file stands on, on its finished floor. */
const GROUND_FLOOR = MIN_FLOOR_COUNT;
const FLOOR_PLANE_RISE = 0;
/** A storey well up the stack, for the cases asking whether the height changes the answer. */
const UPPER_FLOOR = 3;

/**
 * Clearance left behind the camera's own circle in the roomy pose, metres: more than the
 * follow distance, so nothing pulls the camera in at all.
 */
const ROOMY_CLEARANCE = 3;

/**
 * Far from the wall, facing −z: the camera backs away along +z for its full follow distance.
 *
 * The camera keeps `wallMargin` from the wall face, so the pose is placed that much further
 * again than the clearance being asked for.
 */
const CENTRE_POSE: EyePose = Object.freeze({
  x: ROOM_CENTRE_X,
  z: WALL_FACE_Z - THIRD_PERSON_CAMERA_CONFIG.wallMargin - ROOMY_CLEARANCE,
  yaw: FACING_NEGATIVE_Z_YAW,
  pitch: LEVEL_PITCH,
  floor: GROUND_FLOOR,
  rise: FLOOR_PLANE_RISE,
});

/**
 * Back flat against the wall: the tightest pose the collision model allows, since a body stops
 * with its centre at `face − PERSON_SPEC.radius`. It leaves the camera 0.10 m of plan clearance,
 * so the camera rises to nearly its elevation limit and reaches exactly `minBodyVisibleDistance`
 * — the boundary the model is hidden at (`thirdPersonCamera.ts` sizes that distance on this very
 * pose, as the one the raise must still be able to reach).
 */
const BACK_TO_WALL_POSE: EyePose = Object.freeze({
  ...CENTRE_POSE,
  z: WALL_FACE_Z - PERSON_SPEC.radius,
});

/**
 * Standing on the wall face itself: closer than a body can ever legally get, so the camera's
 * own circle already overlaps the wall and there is no room behind the person at all.
 */
const NO_ROOM_BEHIND_POSE: EyePose = Object.freeze({ ...CENTRE_POSE, z: WALL_FACE_Z });

const PARTS = getMannequinParts(PERSON_SPEC.height);

function bottomOf(part: MannequinPart): number {
  return part.position.y - getMannequinPartHalfExtent(part).y;
}

function topOf(part: MannequinPart): number {
  return part.position.y + getMannequinPartHalfExtent(part).y;
}

function frontOf(part: MannequinPart): number {
  return part.position.z - getMannequinPartHalfExtent(part).z;
}

function getHead(parts: readonly MannequinPart[]): MannequinPart {
  const head = parts.find((part) => part.name === HEAD_NAME);
  if (head === undefined) {
    throw new Error('The mannequin has no head');
  }
  return head;
}

describe('getMannequinParts', () => {
  it('reaches the standing height with the top of the head', () => {
    expect(topOf(getHead(PARTS))).toBeCloseTo(PERSON_SPEC.height, LENGTH_PRECISION_DIGITS);
    expect(Math.max(...PARTS.map(topOf))).toBeCloseTo(PERSON_SPEC.height, LENGTH_PRECISION_DIGITS);
  });

  it('stands with its lowest point on the floor', () => {
    expect(Math.min(...PARTS.map(bottomOf))).toBeCloseTo(FLOOR_LEVEL, LENGTH_PRECISION_DIGITS);
  });

  it('puts the eye height inside the head', () => {
    const head = getHead(PARTS);

    expect(bottomOf(head)).toBeLessThan(PERSON_SPEC.eyeHeight);
    expect(topOf(head)).toBeGreaterThan(PERSON_SPEC.eyeHeight);
  });

  it('is no wider than the body diameter used against the walls', () => {
    const left = Math.min(
      ...PARTS.map((part) => part.position.x - getMannequinPartHalfExtent(part).x),
    );
    const right = Math.max(
      ...PARTS.map((part) => part.position.x + getMannequinPartHalfExtent(part).x),
    );

    expect(right - left).toBeLessThanOrEqual(
      DIAMETER_PER_RADIUS * EYE_NAVIGATION_CONFIG.bodyRadius,
    );
  });

  it('has a single facing marker on the front (−z), ahead of every body part', () => {
    const markers = PARTS.filter((part) => part.role === 'facingMarker');
    const body = PARTS.filter((part) => part.role === 'body');

    expect(markers).toHaveLength(1);
    const [marker] = markers;
    expect(marker.position.z).toBeLessThan(0);
    expect(frontOf(marker)).toBeLessThan(Math.min(...body.map(frontOf)));
  });

  it('names every part uniquely and covers legs, hips, torso, arms, neck and head', () => {
    const names = PARTS.map((part) => part.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'leftLeg',
        'rightLeg',
        'hips',
        'torso',
        'leftArm',
        'rightArm',
        'neck',
        HEAD_NAME,
      ]),
    );
  });

  it('returns frozen parts', () => {
    expect(Object.isFrozen(PARTS)).toBe(true);
    for (const part of PARTS) {
      expect(Object.isFrozen(part)).toBe(true);
      expect(Object.isFrozen(part.position)).toBe(true);
      if (part.shape === 'box') {
        expect(Object.isFrozen(part.size)).toBe(true);
      }
    }
  });

  it('scales linearly with the height', () => {
    const scaled = getMannequinParts(SCALED_HEIGHT);
    const ratio = SCALED_HEIGHT / PERSON_SPEC.height;

    expect(topOf(getHead(scaled))).toBeCloseTo(SCALED_HEIGHT, LENGTH_PRECISION_DIGITS);
    expect(Math.min(...scaled.map(bottomOf))).toBeCloseTo(FLOOR_LEVEL, LENGTH_PRECISION_DIGITS);
    scaled.forEach((part, index) => {
      const original = PARTS[index];
      const extent = getMannequinPartHalfExtent(part);
      const originalExtent = getMannequinPartHalfExtent(original);
      expect(part.name).toBe(original.name);
      expect(part.position.x).toBeCloseTo(original.position.x * ratio, LENGTH_PRECISION_DIGITS);
      expect(part.position.y).toBeCloseTo(original.position.y * ratio, LENGTH_PRECISION_DIGITS);
      expect(part.position.z).toBeCloseTo(original.position.z * ratio, LENGTH_PRECISION_DIGITS);
      expect(extent.y).toBeCloseTo(originalExtent.y * ratio, LENGTH_PRECISION_DIGITS);
    });
  });

  it.each(INVALID_HEIGHTS)('rejects the height %s', (height) => {
    expect(() => getMannequinParts(height)).toThrow(RangeError);
  });
});

describe('isPersonModelVisible', () => {
  it('hides the model in first person', () => {
    expect(isPersonModelVisible('firstPerson', CENTRE_POSE, CAMERA_FIELD)).toBe(false);
  });

  it('shows the model in third person when the camera has room behind the person', () => {
    // Guards the fixture as much as the rule: nothing pulls the camera in at this pose.
    expect(getThirdPersonCamera(CENTRE_POSE, CAMERA_FIELD).distance).toBeCloseTo(
      THIRD_PERSON_CAMERA_CONFIG.followDistance,
    );
    expect(isPersonModelVisible('thirdPerson', CENTRE_POSE, CAMERA_FIELD)).toBe(true);
  });

  it('hides the model with the back against a wall, where the raise lands on the threshold', () => {
    const camera = getThirdPersonCamera(BACK_TO_WALL_POSE, CAMERA_FIELD);

    expect(camera.elevation).toBeGreaterThan(THIRD_PERSON_CAMERA_CONFIG.baseElevation);
    expect(camera.distance).toBeCloseTo(THIRD_PERSON_CAMERA_CONFIG.minBodyVisibleDistance);
    // The visibility threshold is inclusive (`shouldHidePersonModel`): at exactly that
    // distance the body still covers the middle of the frame, so the model goes and the
    // viewer looks out from just behind the head.
    expect(isPersonModelVisible('thirdPerson', BACK_TO_WALL_POSE, CAMERA_FIELD)).toBe(false);
  });

  it('hides the model in third person when there is no room at all behind the person', () => {
    expect(isPersonModelVisible('thirdPerson', NO_ROOM_BEHIND_POSE, CAMERA_FIELD)).toBe(false);
  });

  it('answers the same on every storey: the rule reads the plan, not the height', () => {
    const upstairs: EyePose = { ...CENTRE_POSE, floor: UPPER_FLOOR };
    const againstTheWall: EyePose = { ...BACK_TO_WALL_POSE, floor: UPPER_FLOOR };

    // The storey is the same floor repeated, so what room the camera has behind the person
    // cannot depend on which one they are standing on — which is why one field serves them all.
    expect(isPersonModelVisible('thirdPerson', upstairs, CAMERA_FIELD)).toBe(true);
    expect(isPersonModelVisible('thirdPerson', againstTheWall, CAMERA_FIELD)).toBe(false);
  });
});
