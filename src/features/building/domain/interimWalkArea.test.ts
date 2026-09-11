import { describe, expect, it } from 'vitest';
import {
  createInitialEyePose,
  createRoomCentrePose,
  EYE_NAVIGATION_CONFIG,
} from './eyeNavigation.ts';
import { findSpaceAt, FLOOR_PLAN, getSpace, getSpaceBounds } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { getRoomWalkArea, INTERIM_WALK_SPACE_ID } from './interimWalkArea.ts';
import { rectContainsPoint } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { getPortSpan, getPortsOf, PORT_SCHEDULE } from './ports/index.ts';
import {
  createCameraRoomBox,
  getThirdPersonCamera,
  shouldHidePersonModel,
  THIRD_PERSON_CAMERA_CONFIG,
} from './thirdPersonCamera.ts';

const PRECISION_DIGITS = 9;

const BODY_RADIUS = EYE_NAVIGATION_CONFIG.bodyRadius;
const CEILING_HEIGHT = FLOOR_HEIGHTS.wall;
const MARGIN = THIRD_PERSON_CAMERA_CONFIG.wallMargin;

/** The master bedroom's own clear rect (brief §4.1), restated from the plan data. */
const EXPECTED_CLEAR_RECT: PlanRect = { minX: 1.6, maxX: 6.6, minZ: 0.3, maxZ: 3.7 };
/** The same rect shrunk by the 0.25 m body radius. */
const EXPECTED_BOUNDS: PlanRect = { minX: 1.85, maxX: 6.35, minZ: 0.55, maxZ: 3.45 };

/** Centre of the walkable bounds along x: `(1.85 + 6.35) / 2`. */
const EXPECTED_START_X = 4.1;
/** Centre of the walkable bounds along z: `(0.55 + 3.45) / 2`. */
const EXPECTED_START_Z = 2;
/** Yaw looking toward −x, along the room's 5.00 m axis. */
const QUARTER_TURN = Math.PI / 2;
/** The space the start sightline runs into, through the doorway in the room's −x wall. */
const BALCONY_SPACE_ID: SpaceId = 'balconyA';
/**
 * Share of the follow distance the camera must keep at the start pose: the reason for
 * starting in the centre is that no wall pulls the camera in, let alone raises it overhead.
 */
const NEAR_FOLLOW_DISTANCE_SHARE = 0.9;

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

    it('keeps the corner pose of createInitialEyePose inside the master bedroom', () => {
      const pose = createInitialEyePose(WALK_AREA.bounds);

      expect(findSpaceAt(FLOOR_PLAN, pose)?.id).toBe(INTERIM_WALK_SPACE_ID);
    });

    it('starts the walk in the centre of the master bedroom, inside the walkable bounds', () => {
      const pose = createRoomCentrePose(WALK_AREA.bounds);

      expect(pose.x).toBeCloseTo(EXPECTED_START_X, PRECISION_DIGITS);
      expect(pose.z).toBeCloseTo(EXPECTED_START_Z, PRECISION_DIGITS);
      expect(pose.yaw).toBeCloseTo(QUARTER_TURN, PRECISION_DIGITS);
      expect(pose.pitch).toBe(0);
      expect(rectContainsPoint(WALK_AREA.bounds, pose)).toBe(true);
      expect(findSpaceAt(FLOOR_PLAN, pose)?.id).toBe(INTERIM_WALK_SPACE_ID);
    });

    it('looks along the longer axis of the room, through the balcony-A doorway', () => {
      const pose = createRoomCentrePose(WALK_AREA.bounds);
      const balcony = getSpaceBounds(getSpace(FLOOR_PLAN, BALCONY_SPACE_ID));
      const doorSpans = getPortsOf(PORT_SCHEDULE, INTERIM_WALK_SPACE_ID)
        .filter((port) => port.spaces.includes(BALCONY_SPACE_ID) && port.along === 'z')
        .map(getPortSpan);

      // The balcony lies past the room's −x wall, and the forward vector (−sin yaw, −cos yaw)
      // of the start pose points straight at it.
      expect(balcony.maxX).toBeLessThanOrEqual(WALK_AREA.clearRect.minX);
      expect(-Math.sin(pose.yaw)).toBeCloseTo(-1, PRECISION_DIGITS);
      expect(-Math.cos(pose.yaw)).toBeCloseTo(0, PRECISION_DIGITS);
      expect(doorSpans).toHaveLength(1);
      for (const [spanMin, spanMax] of doorSpans) {
        expect(pose.z).toBeGreaterThan(spanMin);
        expect(pose.z).toBeLessThan(spanMax);
      }
    });

    it('leaves the follow camera nearly its whole distance behind the start pose', () => {
      const pose = createRoomCentrePose(WALK_AREA.bounds);
      const camera = getThirdPersonCamera(pose, WALK_AREA.roomBox);
      // Behind the person is +x at this yaw, so the maxX face of the camera box is the limit.
      const roomBehind = WALK_AREA.roomBox.plan.maxX - pose.x;

      expect(camera.elevation).toBeCloseTo(THIRD_PERSON_CAMERA_CONFIG.baseElevation);
      expect(camera.distance).toBeCloseTo(roomBehind / Math.cos(camera.elevation));
      expect(camera.distance).toBeGreaterThan(
        NEAR_FOLLOW_DISTANCE_SHARE * THIRD_PERSON_CAMERA_CONFIG.followDistance,
      );
      expect(shouldHidePersonModel(camera)).toBe(false);
    });

    it('pulled the follow camera onto the head at the corner pose, which the centre avoids', () => {
      const corner = createInitialEyePose(WALK_AREA.bounds);
      const camera = getThirdPersonCamera(corner, WALK_AREA.roomBox);

      // Two walls right behind the person: the camera rises overhead and stops at the
      // closest distance that still shows the body — the head close-up this pose replaces.
      expect(camera.distance).toBeCloseTo(THIRD_PERSON_CAMERA_CONFIG.minBodyVisibleDistance);
      expect(camera.elevation).toBeGreaterThan(THIRD_PERSON_CAMERA_CONFIG.baseElevation);
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
