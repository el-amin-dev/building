import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { THIRD_PERSON_CAMERA_CONFIG } from '../domain/thirdPersonCamera.ts';
import { BUILT_FLOOR, CAMERA_FIELD, INTERIOR_START_POSE, WALK_FIELD } from './floorInstance.ts';

/** The centre of the stairs arrival landing, in metres (see `stairs.test.ts`). */
const EXPECTED_ARRIVAL_X = 5.1;
const EXPECTED_ARRIVAL_Z = 5;
/** Looking toward +x, out of the bay and along the corridor: yaw −π/2. */
const EXPECTED_ARRIVAL_YAW = -Math.PI / 2;
const LEVEL_PITCH = 0;
const PRECISION_DIGITS = 2;
const NONE = 0;

describe('INTERIOR_START_POSE', () => {
  it('stands at the centre of the stairs arrival landing, (5.10, 5.00)', () => {
    expect(INTERIOR_START_POSE.x).toBeCloseTo(EXPECTED_ARRIVAL_X, PRECISION_DIGITS);
    expect(INTERIOR_START_POSE.z).toBeCloseTo(EXPECTED_ARRIVAL_Z, PRECISION_DIGITS);
  });

  it('faces out of the bay at yaw −π/2, looking level', () => {
    expect(INTERIOR_START_POSE.yaw).toBeCloseTo(EXPECTED_ARRIVAL_YAW);
    expect(INTERIOR_START_POSE.pitch).toBe(LEVEL_PITCH);
  });

  it('is the arrival of the shared built floor, raised to an eye pose', () => {
    expect(INTERIOR_START_POSE.x).toBe(BUILT_FLOOR.stairs.arrival.x);
    expect(INTERIOR_START_POSE.z).toBe(BUILT_FLOOR.stairs.arrival.z);
    expect(INTERIOR_START_POSE.yaw).toBe(BUILT_FLOOR.stairs.arrival.yaw);
  });
});

describe('WALK_FIELD', () => {
  it('has floor to stand on and blockers to stop at', () => {
    expect(WALK_FIELD.floor.length).toBeGreaterThan(NONE);
    expect(WALK_FIELD.blockers.length).toBeGreaterThan(NONE);
  });

  it('is frozen, as every walk field is', () => {
    expect(Object.isFrozen(WALK_FIELD)).toBe(true);
    expect(Object.isFrozen(WALK_FIELD.floor)).toBe(true);
  });
});

describe('CAMERA_FIELD', () => {
  it('shares the walk field by identity rather than copying it', () => {
    expect(CAMERA_FIELD.walk).toBe(WALK_FIELD);
  });

  it('spans the wall height less the camera margin at both ends', () => {
    expect(CAMERA_FIELD.minY).toBeCloseTo(THIRD_PERSON_CAMERA_CONFIG.wallMargin);
    expect(CAMERA_FIELD.maxY).toBeCloseTo(
      FLOOR_HEIGHTS.wall - THIRD_PERSON_CAMERA_CONFIG.wallMargin,
    );
  });
});

describe('the shared floor instance', () => {
  // The geometry baking of `FloorModel` keys on the identity of these arrays, and the
  // camera transition's endpoint must be the explorer's own start pose rather than an
  // equal copy of it: importing the module again must hand back the very same objects.
  it('derives the floor once: a repeated import gives the identical objects', async () => {
    const again = await import('./floorInstance.ts');

    expect(again.BUILT_FLOOR).toBe(BUILT_FLOOR);
    expect(again.BUILT_FLOOR.walls).toBe(BUILT_FLOOR.walls);
    expect(again.BUILT_FLOOR.slabs).toBe(BUILT_FLOOR.slabs);
    expect(again.WALK_FIELD).toBe(WALK_FIELD);
    expect(again.WALK_FIELD.floor).toBe(WALK_FIELD.floor);
    expect(again.CAMERA_FIELD).toBe(CAMERA_FIELD);
    expect(again.INTERIOR_START_POSE).toBe(INTERIOR_START_POSE);
  });
});
