import { describe, expect, it } from 'vitest';
import { createInitialEyePose, EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import { findSpaceAt, FLOOR_PLAN, getSpace } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { getRoomWalkArea, INTERIM_WALK_SPACE_ID } from './interimWalkArea.ts';
import type { PlanRect } from './planGeometry.ts';
import { createCameraRoomBox, THIRD_PERSON_CAMERA_CONFIG } from './thirdPersonCamera.ts';

const PRECISION_DIGITS = 9;

const BODY_RADIUS = EYE_NAVIGATION_CONFIG.bodyRadius;
const CEILING_HEIGHT = FLOOR_HEIGHTS.wall;
const MARGIN = THIRD_PERSON_CAMERA_CONFIG.wallMargin;

/** The master bedroom's own clear rect (brief §4.1), restated from the plan data. */
const EXPECTED_CLEAR_RECT: PlanRect = { minX: 1.6, maxX: 6.6, minZ: 0.3, maxZ: 3.7 };
/** The same rect shrunk by the 0.25 m body radius. */
const EXPECTED_BOUNDS: PlanRect = { minX: 1.85, maxX: 6.35, minZ: 0.55, maxZ: 3.45 };

/** The guest room is an L made of three rects, so one rectangle cannot clamp it. */
const L_SHAPED_SPACE_ID: SpaceId = 'guestRoom';
/** A `'void'` space: open to the sky, nothing to stand on. */
const FLOORLESS_SPACE_ID: SpaceId = 'voidWest';
/** An id no plan has; cast because it is deliberately outside `SpaceId`. */
const UNKNOWN_SPACE_ID = 'nowhere' as SpaceId;

const NOT_A_NUMBER = Number.NaN;
const INFINITE = Number.POSITIVE_INFINITY;
const NEGATIVE_LENGTH = -1;
/** Larger than half the master bedroom's 3.40 m depth, so it inverts the rect. */
const OVERSIZED_LENGTH = 2;

const WALK_AREA = getRoomWalkArea(
  FLOOR_PLAN,
  INTERIM_WALK_SPACE_ID,
  BODY_RADIUS,
  CEILING_HEIGHT,
  MARGIN,
);

describe('interimWalkArea', () => {
  describe('INTERIM_WALK_SPACE_ID', () => {
    it('names the master bedroom, a single-rect room of the plan', () => {
      const space = getSpace(FLOOR_PLAN, INTERIM_WALK_SPACE_ID);

      expect(INTERIM_WALK_SPACE_ID).toBe('masterBedroom');
      expect(space.kind).toBe('room');
      expect(space.rects).toHaveLength(1);
    });
  });

  describe('getRoomWalkArea for the master bedroom', () => {
    it('takes the clear rect from the plan', () => {
      const [rect] = getSpace(FLOOR_PLAN, INTERIM_WALK_SPACE_ID).rects;

      expect(WALK_AREA.clearRect).toEqual(rect);
      expect(WALK_AREA.clearRect).toEqual(EXPECTED_CLEAR_RECT);
    });

    it('shrinks the clear rect by the body radius for the walkable bounds', () => {
      expect(WALK_AREA.bounds).toEqual(EXPECTED_BOUNDS);
      expect(WALK_AREA.bounds.minX).toBeCloseTo(
        EXPECTED_CLEAR_RECT.minX + BODY_RADIUS,
        PRECISION_DIGITS,
      );
      expect(WALK_AREA.bounds.maxX).toBeCloseTo(
        EXPECTED_CLEAR_RECT.maxX - BODY_RADIUS,
        PRECISION_DIGITS,
      );
      expect(WALK_AREA.bounds.minZ).toBeCloseTo(
        EXPECTED_CLEAR_RECT.minZ + BODY_RADIUS,
        PRECISION_DIGITS,
      );
      expect(WALK_AREA.bounds.maxZ).toBeCloseTo(
        EXPECTED_CLEAR_RECT.maxZ - BODY_RADIUS,
        PRECISION_DIGITS,
      );
    });

    it('gives the camera the room box of the same clear rect', () => {
      expect(WALK_AREA.roomBox).toEqual(
        createCameraRoomBox(EXPECTED_CLEAR_RECT, CEILING_HEIGHT, MARGIN),
      );
    });

    it('is deeply frozen', () => {
      expect(Object.isFrozen(WALK_AREA)).toBe(true);
      expect(Object.isFrozen(WALK_AREA.clearRect)).toBe(true);
      expect(Object.isFrozen(WALK_AREA.bounds)).toBe(true);
      expect(Object.isFrozen(WALK_AREA.roomBox)).toBe(true);
      expect(Object.isFrozen(WALK_AREA.roomBox.plan)).toBe(true);
    });

    it('starts the viewer inside the master bedroom', () => {
      const pose = createInitialEyePose(WALK_AREA.bounds);

      expect(findSpaceAt(FLOOR_PLAN, pose)?.id).toBe(INTERIM_WALK_SPACE_ID);
    });
  });

  describe('getRoomWalkArea rejections', () => {
    it.each([
      ['a space made of several rects', L_SHAPED_SPACE_ID, 'single rect'],
      ['a space with no floor', FLOORLESS_SPACE_ID, 'no floor'],
      ['an unknown space id', UNKNOWN_SPACE_ID, 'no space with id'],
    ] as const)('rejects %s', (_label, spaceId, message) => {
      const call = (): unknown =>
        getRoomWalkArea(FLOOR_PLAN, spaceId, BODY_RADIUS, CEILING_HEIGHT, MARGIN);

      expect(call).toThrow(RangeError);
      expect(call).toThrow(message);
    });

    it.each([
      ['a non-finite body radius', NOT_A_NUMBER, CEILING_HEIGHT, MARGIN, 'bodyRadius'],
      ['an infinite body radius', INFINITE, CEILING_HEIGHT, MARGIN, 'bodyRadius'],
      ['a negative body radius', NEGATIVE_LENGTH, CEILING_HEIGHT, MARGIN, 'bodyRadius'],
      ['a non-finite ceiling height', BODY_RADIUS, NOT_A_NUMBER, MARGIN, 'ceilingHeight'],
      ['a negative ceiling height', BODY_RADIUS, NEGATIVE_LENGTH, MARGIN, 'ceilingHeight'],
      ['a non-finite margin', BODY_RADIUS, CEILING_HEIGHT, NOT_A_NUMBER, 'margin'],
      ['a negative margin', BODY_RADIUS, CEILING_HEIGHT, NEGATIVE_LENGTH, 'margin'],
      ['a body radius larger than the room', OVERSIZED_LENGTH, CEILING_HEIGHT, MARGIN, 'inset'],
      ['a margin larger than the room', BODY_RADIUS, CEILING_HEIGHT, OVERSIZED_LENGTH, 'margin'],
    ] as const)('rejects %s', (_label, bodyRadius, ceilingHeight, margin, message) => {
      const call = (): unknown =>
        getRoomWalkArea(FLOOR_PLAN, INTERIM_WALK_SPACE_ID, bodyRadius, ceilingHeight, margin);

      expect(call).toThrow(RangeError);
      expect(call).toThrow(message);
    });
  });
});
