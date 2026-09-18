import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { rectsOverlap } from '../domain/planGeometry.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { THIRD_PERSON_CAMERA_CONFIG } from '../domain/thirdPersonCamera.ts';
import {
  BUILT_FLOOR,
  CAMERA_FIELD,
  getCameraFields,
  getWalkSurfaces,
  INTERIOR_START_POSE,
  STAIR_WALK_FIELD,
  WALK_FIELD,
} from './floorInstance.ts';

/** The centre of the stairs arrival landing, in metres (see `stairs.test.ts`). */
const EXPECTED_ARRIVAL_X = 5.1;
const EXPECTED_ARRIVAL_Z = 5;
/** Looking toward +x, out of the bay and along the corridor: yaw −π/2. */
const EXPECTED_ARRIVAL_YAW = -Math.PI / 2;
const LEVEL_PITCH = 0;
const PRECISION_DIGITS = 2;
const NONE = 0;
/** The storey the viewer walks in on: the lowest one designed (ADR-006). */
const FIRST_FLOOR = MIN_FLOOR_COUNT;
/** Standing on the finished floor of that storey, not part way up a flight. */
const FLOOR_PLANE_RISE = 0;
/** A stack tall enough to have a bottom, a middle and a top storey. */
const TALL_STACK = 3;
/** Index of the storey in the middle of {@link TALL_STACK}: the one with a flight either way. */
const MIDDLE_INDEX = 1;
const FIRST_INDEX = 0;
const LAST_INDEX_OFFSET = 1;

/** The rectangles of a field that reach into the stair bay. */
function inBay(rects: readonly PlanRect[]): readonly PlanRect[] {
  return rects.filter((rect) => rectsOverlap(rect, BUILT_FLOOR.stairs.bay));
}

describe('INTERIOR_START_POSE', () => {
  it('stands at the centre of the stairs arrival landing, (5.10, 5.00)', () => {
    expect(INTERIOR_START_POSE.x).toBeCloseTo(EXPECTED_ARRIVAL_X, PRECISION_DIGITS);
    expect(INTERIOR_START_POSE.z).toBeCloseTo(EXPECTED_ARRIVAL_Z, PRECISION_DIGITS);
  });

  it('faces out of the bay at yaw −π/2, looking level', () => {
    expect(INTERIOR_START_POSE.yaw).toBeCloseTo(EXPECTED_ARRIVAL_YAW);
    expect(INTERIOR_START_POSE.pitch).toBe(LEVEL_PITCH);
  });

  it('stands on the first floor, on its finished floor', () => {
    // The same landing exists on every storey, so the storey has to be stated: the viewer
    // walks in at the bottom of the stack, standing on the floor rather than on a tread.
    expect(INTERIOR_START_POSE.floor).toBe(FIRST_FLOOR);
    expect(INTERIOR_START_POSE.rise).toBe(FLOOR_PLANE_RISE);
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

  it('stops a body at the stair bay: the shaft is a hole in the plan', () => {
    expect(inBay(WALK_FIELD.blockers).length).toBeGreaterThan(NONE);
  });
});

describe('STAIR_WALK_FIELD', () => {
  it('leaves nothing in the bay to stop a body: the stair is floor there', () => {
    // Inside the bay it is the stairwell — a question of height — that decides what may be
    // stood on, so no rectangle of the plan may refuse the step first.
    expect(inBay(STAIR_WALK_FIELD.blockers)).toStrictEqual([]);
  });

  it('gives the bay floor to stand on, which the walk field does not', () => {
    expect(inBay(STAIR_WALK_FIELD.floor).length).toBeGreaterThan(inBay(WALK_FIELD.floor).length);
  });

  it('changes nothing outside the bay: the same floor is walked either way', () => {
    const outsideStair = STAIR_WALK_FIELD.floor.filter(
      (rect) => !rectsOverlap(rect, BUILT_FLOOR.stairs.bay),
    );
    const outsideWalk = WALK_FIELD.floor.filter(
      (rect) => !rectsOverlap(rect, BUILT_FLOOR.stairs.bay),
    );

    expect(outsideStair).toStrictEqual(outsideWalk);
  });

  it('is frozen, as every walk field is', () => {
    expect(Object.isFrozen(STAIR_WALK_FIELD)).toBe(true);
    expect(Object.isFrozen(STAIR_WALK_FIELD.blockers)).toBe(true);
  });
});

describe('getWalkSurfaces', () => {
  it('gives one surface per storey', () => {
    expect(getWalkSurfaces(TALL_STACK)).toHaveLength(TALL_STACK);
    expect(getWalkSurfaces(MIN_FLOOR_COUNT)).toHaveLength(MIN_FLOOR_COUNT);
    expect(getWalkSurfaces(MAX_FLOOR_COUNT)).toHaveLength(MAX_FLOOR_COUNT);
  });

  it('hands back the identical list every time it is asked for a count', () => {
    // Read once per frame by the camera controls: a fresh list per call would hand the frame
    // loop a new object sixty times a second and invalidate every memo watching it.
    expect(getWalkSurfaces(TALL_STACK)).toBe(getWalkSurfaces(TALL_STACK));
    expect(getWalkSurfaces(TALL_STACK)[MIDDLE_INDEX]).toBe(
      getWalkSurfaces(TALL_STACK)[MIDDLE_INDEX],
    );
  });

  it('shares one surface between every storey capped the same way', () => {
    const three = getWalkSurfaces(TALL_STACK);
    const ten = getWalkSurfaces(MAX_FLOOR_COUNT);

    // The stair repeats, so the bottom of a three-storey stack and the bottom of a ten-storey
    // one are the same walking surface: only the ends of the stack differ.
    expect(three[FIRST_INDEX]).toBe(ten[FIRST_INDEX]);
    expect(three[MIDDLE_INDEX]).toBe(ten[MIDDLE_INDEX]);
  });

  it('walks the same two plan fields on every storey', () => {
    for (const surface of getWalkSurfaces(MAX_FLOOR_COUNT)) {
      expect(surface.field).toBe(WALK_FIELD);
      expect(surface.bayField).toBe(STAIR_WALK_FIELD);
      expect(surface.floorToFloor).toBe(FLOOR_HEIGHTS.floorToFloor);
    }
  });

  it('offers no flight at all in a one-storey building', () => {
    const [only] = getWalkSurfaces(MIN_FLOOR_COUNT);

    // Both half-flights at the ends of the stack are blocked, though still drawn (owner).
    expect(only.well.ramps).toStrictEqual([]);
    expect(only.well.landings.length).toBeGreaterThan(NONE);
  });

  it('caps the ends of a taller stack and opens the storeys between', () => {
    const surfaces = getWalkSurfaces(TALL_STACK);
    const middle = surfaces[MIDDLE_INDEX];
    const bottom = surfaces[FIRST_INDEX];
    const top = surfaces[surfaces.length - LAST_INDEX_OFFSET];

    expect(middle.well.ramps.length).toBeGreaterThan(bottom.well.ramps.length);
    expect(middle.well.ramps.length).toBeGreaterThan(top.well.ramps.length);
    expect(bottom.well.ramps.length).toBeGreaterThan(NONE);
    expect(top.well.ramps.length).toBeGreaterThan(NONE);
  });

  it('reads the nearest legal stack for a count outside the range', () => {
    expect(getWalkSurfaces(MIN_FLOOR_COUNT - 1)).toBe(getWalkSurfaces(MIN_FLOOR_COUNT));
    expect(getWalkSurfaces(MAX_FLOOR_COUNT + 1)).toBe(getWalkSurfaces(MAX_FLOOR_COUNT));
  });

  it('refuses a count that is not a number of storeys at all', () => {
    expect(() => getWalkSurfaces(Number.NaN)).toThrow(RangeError);
  });
});

describe('getCameraFields', () => {
  it('gives one field per storey, on that storey’s own surface', () => {
    const fields = getCameraFields(TALL_STACK);
    const surfaces = getWalkSurfaces(TALL_STACK);

    expect(fields).toHaveLength(TALL_STACK);
    fields.forEach((field, index) => {
      expect(field.surface).toBe(surfaces[index]);
    });
  });

  it('hands back the identical list every time it is asked for a count', () => {
    expect(getCameraFields(TALL_STACK)).toBe(getCameraFields(TALL_STACK));
  });

  it('spans the wall height less the camera margin at both ends, above the storey datum', () => {
    for (const field of getCameraFields(TALL_STACK)) {
      expect(field.minY).toBeCloseTo(THIRD_PERSON_CAMERA_CONFIG.wallMargin);
      expect(field.maxY).toBeCloseTo(FLOOR_HEIGHTS.wall - THIRD_PERSON_CAMERA_CONFIG.wallMargin);
    }
  });
});

describe('CAMERA_FIELD', () => {
  it('is the field of a lone storey, shared by identity with the table', () => {
    expect(CAMERA_FIELD).toBe(getCameraFields(MIN_FLOOR_COUNT)[FIRST_INDEX]);
  });

  it('shares the walking surface by identity rather than copying it', () => {
    expect(CAMERA_FIELD.surface).toBe(getWalkSurfaces(MIN_FLOOR_COUNT)[FIRST_INDEX]);
    expect(CAMERA_FIELD.surface.field).toBe(WALK_FIELD);
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
    expect(again.STAIR_WALK_FIELD).toBe(STAIR_WALK_FIELD);
    expect(again.getWalkSurfaces(TALL_STACK)).toBe(getWalkSurfaces(TALL_STACK));
    expect(again.getCameraFields(TALL_STACK)).toBe(getCameraFields(TALL_STACK));
    expect(again.CAMERA_FIELD).toBe(CAMERA_FIELD);
    expect(again.INTERIOR_START_POSE).toBe(INTERIOR_START_POSE);
  });
});
