import { describe, expect, it } from 'vitest';
import { EYE_NAVIGATION_CONFIG } from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { getRoomWalkArea, INTERIM_WALK_SPACE_ID } from '../domain/interimWalkArea.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import { THIRD_PERSON_CAMERA_CONFIG } from '../domain/thirdPersonCamera.ts';
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
const HALF = 0.5;
const FLOOR_LEVEL = 0;
const SCALED_HEIGHT = 2;
const HEAD_NAME = 'head';
const LEVEL_PITCH = 0;
const FACING_NEGATIVE_Z_YAW = 0;
const INVALID_HEIGHTS = [0, -PERSON_SPEC.height, Number.NaN, Number.POSITIVE_INFINITY];

/** The room walking is clamped to, in floor coordinates: the same one `BuildingScene` uses. */
const WALK_AREA = getRoomWalkArea(
  FLOOR_PLAN,
  INTERIM_WALK_SPACE_ID,
  EYE_NAVIGATION_CONFIG.bodyRadius,
  FLOOR_HEIGHTS.wall,
  THIRD_PERSON_CAMERA_CONFIG.wallMargin,
);
const WALKABLE_BOUNDS = WALK_AREA.bounds;
const ROOM_BOX = WALK_AREA.roomBox;
/** In the middle of the room, facing −z: the follow camera backs away along +z freely. */
const CENTRE_POSE: EyePose = {
  x: (WALKABLE_BOUNDS.minX + WALKABLE_BOUNDS.maxX) * HALF,
  z: (WALKABLE_BOUNDS.minZ + WALKABLE_BOUNDS.maxZ) * HALF,
  yaw: FACING_NEGATIVE_Z_YAW,
  pitch: LEVEL_PITCH,
};
/** Back against the +z wall at the walking limit: the follow camera rises above the head. */
const BACK_TO_WALL_POSE: EyePose = { ...CENTRE_POSE, z: WALKABLE_BOUNDS.maxZ };
/** On the camera box's +z face, beyond the walking limit: no room at all behind the head. */
const NO_ROOM_BEHIND_POSE: EyePose = { ...BACK_TO_WALL_POSE, z: ROOM_BOX.plan.maxZ };

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
    expect(isPersonModelVisible('firstPerson', CENTRE_POSE, ROOM_BOX)).toBe(false);
  });

  it('shows the model in third person when the camera has room behind the person', () => {
    expect(isPersonModelVisible('thirdPerson', CENTRE_POSE, ROOM_BOX)).toBe(true);
  });

  it('shows the model in third person with the back against a wall, the camera raised', () => {
    expect(isPersonModelVisible('thirdPerson', BACK_TO_WALL_POSE, ROOM_BOX)).toBe(true);
  });

  it('hides the model in third person when there is no room at all behind the person', () => {
    expect(isPersonModelVisible('thirdPerson', NO_ROOM_BEHIND_POSE, ROOM_BOX)).toBe(false);
  });
});
