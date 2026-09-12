/**
 * Interim walking clamp of the interior viewer: one room of the floor.
 *
 * Part 2 renders the whole floor, but the viewer has no wall collision yet, so
 * walking is still restricted to a single rectangular room instead of the whole
 * plan. This module derives that restriction from the floor plan, in plan
 * coordinates.
 *
 * THIS MODULE IS TEMPORARY. Part 3 introduces wall collision against the real
 * plan, after which the viewer walks the whole floor and this module — together
 * with `INTERIM_WALK_SPACE_ID` and every use of it — is deleted rather than
 * extended.
 *
 * Coordinates are in metres, with the plan conventions of `floorPlan/types.ts`.
 */

import { getSpace, getSpaceBounds, hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, SpaceId } from './floorPlan/index.ts';
import { insetRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { createCameraRoomBox } from './thirdPersonCamera.ts';
import type { CameraRoomBox } from './thirdPersonCamera.ts';

/**
 * The single space the viewer is confined to until Part 3 brings wall collision.
 *
 * The master bedroom is a plain rectangle of the top row, so one rect clamps it exactly,
 * and it is the room the viewer's start pose already sits in.
 */
export const INTERIM_WALK_SPACE_ID: SpaceId = 'masterBedroom';

/** Where the viewer may stand in one room, and where its third-person camera may go. */
export interface RoomWalkArea {
  /** The clear (inside) rectangle of the room, in metres. */
  readonly clearRect: PlanRect;
  /** Where the eye may be: `clearRect` shrunk by the body radius, for `stepEyePose`. */
  readonly bounds: PlanRect;
  /** Where the third-person camera may be (see `createCameraRoomBox`). */
  readonly roomBox: CameraRoomBox;
}

/**
 * Derives the walking area and camera box of one room of the floor plan.
 *
 * The room must be a single rectangle with a floor: an L-shaped space cannot be clamped
 * by one rectangle without letting the viewer walk through the notch, and a `'void'` space
 * has nothing to stand on.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param spaceId - Identifier of the room the viewer is confined to.
 * @param bodyRadius - Radius of the viewer's body on the plan, in metres.
 * @param ceilingHeight - Height of the ceiling above the finished floor, in metres.
 * @param margin - Distance the third-person camera keeps from walls, floor and ceiling,
 *   in metres.
 * @returns A deeply frozen walking area.
 * @throws RangeError naming the offending argument when `spaceId` is unknown to the plan,
 *   when the space is made of anything other than exactly one rect, when the space has no
 *   floor, when `bodyRadius`, `ceilingHeight` or `margin` is not finite or is negative, or
 *   when `bodyRadius` or `margin` leaves no room in the rect (see `insetRect` and
 *   `createCameraRoomBox`).
 */
export function getRoomWalkArea(
  plan: FloorPlan,
  spaceId: SpaceId,
  bodyRadius: number,
  ceilingHeight: number,
  margin: number,
): RoomWalkArea {
  assertNonNegative('bodyRadius', bodyRadius);
  assertNonNegative('ceilingHeight', ceilingHeight);
  assertNonNegative('margin', margin);

  const space = getSpace(plan, spaceId);
  if (space.rects.length !== 1) {
    throw new RangeError(
      `space "${spaceId}" must be a single rect to clamp walking, got ${String(space.rects.length)}`,
    );
  }
  if (!hasFloor(space.kind)) {
    throw new RangeError(`space "${spaceId}" has no floor to walk on, its kind is "${space.kind}"`);
  }

  const clearRect = getSpaceBounds(space);
  return Object.freeze({
    clearRect,
    bounds: insetRect(clearRect, bodyRadius),
    roomBox: createCameraRoomBox(clearRect, ceilingHeight, margin),
  });
}

/** Rejects a length that is not a finite, non-negative number, naming it. */
function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number, got ${String(value)}`);
  }
}
