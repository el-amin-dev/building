/**
 * Third-person follow camera of the interior viewer.
 *
 * The camera sits behind the person and looks at the head. Coordinates are
 * expressed in metres and angles in radians, with the conventions of
 * `eyeNavigation.ts`: `y` points up, the plan lies on `x`/`z`, yaw 0 looks
 * toward −z, increasing yaw turns left and positive pitch looks up. Behind the
 * person, on the plan, is therefore `(sin yaw, cos yaw)`.
 *
 * The camera never leaves the room: when a wall, the floor or the ceiling is
 * closer than the follow distance, the camera is pulled in along its ray.
 */

import type { EyePose } from './eyeNavigation.ts';
import { PERSON_SPEC } from './person.ts';
import type { PlanRect } from './planGeometry.ts';

/** A point in scene space, metres (x, z on the plan; y up). */
export interface ScenePoint {
  /** Position along the plan width, in metres. */
  readonly x: number;
  /** Height above the finished floor, in metres. */
  readonly y: number;
  /** Position along the plan depth, in metres. */
  readonly z: number;
}

/** The box the camera must stay inside: plan rect plus a vertical range, metres. */
export interface CameraRoomBox {
  /** Plan rectangle the camera stays inside. */
  readonly plan: PlanRect;
  /** Lowest camera height, in metres. */
  readonly minY: number;
  /** Highest camera height, in metres. */
  readonly maxY: number;
}

/** Tuning of the third-person follow camera. */
export interface ThirdPersonCameraConfig {
  /** Desired distance from the camera to its target, in metres. */
  readonly followDistance: number;
  /** Height of the point the camera looks at (the head), in metres. */
  readonly targetHeight: number;
  /** Angle the camera sits above the target's horizontal at pitch 0, in radians. */
  readonly baseElevation: number;
  /** Largest absolute elevation of the camera, in radians. */
  readonly maxElevation: number;
  /** Distance the camera keeps from walls, floor and ceiling, in metres. */
  readonly wallMargin: number;
  /** Camera distance below which the person model is hidden, in metres. */
  readonly minBodyVisibleDistance: number;
}

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;

const FOLLOW_DISTANCE_METRES = 2.5;
const BASE_ELEVATION_DEGREES = 15;
const MAX_ELEVATION_DEGREES = 80;
const WALL_MARGIN_METRES = 0.15;
const MIN_BODY_VISIBLE_DISTANCE_METRES = 0.6;

const HALF = 0.5;
/** Direction components smaller than this never reach a face of the box. */
const DIRECTION_EPSILON = 1e-12;

/** Default tuning of the third-person camera. Frozen. */
export const THIRD_PERSON_CAMERA_CONFIG: ThirdPersonCameraConfig = Object.freeze({
  followDistance: FOLLOW_DISTANCE_METRES,
  targetHeight: PERSON_SPEC.eyeHeight,
  baseElevation: BASE_ELEVATION_DEGREES * RADIANS_PER_DEGREE,
  maxElevation: MAX_ELEVATION_DEGREES * RADIANS_PER_DEGREE,
  wallMargin: WALL_MARGIN_METRES,
  minBodyVisibleDistance: MIN_BODY_VISIBLE_DISTANCE_METRES,
});

/** Where the third-person camera is and what it looks at. */
export interface ThirdPersonCamera {
  /** Where to put the camera. */
  readonly position: ScenePoint;
  /** What the camera looks at (`lookAt`). */
  readonly target: ScenePoint;
  /** Actual distance from target to position, in metres, within [0, followDistance]. */
  readonly distance: number;
}

/**
 * Camera box of a room: the clear rect shrunk by `margin` on every side, with y from `margin`
 * to `ceilingHeight - margin`. RangeError if the margin leaves no room or inputs are not finite.
 *
 * @param clearRect - The clear (inside) rectangle of the room, in metres.
 * @param ceilingHeight - Height of the ceiling above the finished floor, in metres.
 * @param margin - Distance the camera keeps from walls, floor and ceiling, in metres.
 * @returns A frozen box with a frozen plan rectangle.
 * @throws RangeError when any input is not finite, when `margin` is negative, or when
 *   `margin` is at least half the room's width, depth or ceiling height (leaving no room).
 */
export function createCameraRoomBox(
  clearRect: PlanRect,
  ceilingHeight: number,
  margin: number,
): CameraRoomBox {
  const inputs = [
    clearRect.minX,
    clearRect.maxX,
    clearRect.minZ,
    clearRect.maxZ,
    ceilingHeight,
    margin,
  ];
  if (!inputs.every(Number.isFinite)) {
    throw new RangeError(
      `createCameraRoomBox inputs must be finite, got rect (${inputs.slice(0, 4).map(String).join(', ')}), ceilingHeight ${String(ceilingHeight)}, margin ${String(margin)}`,
    );
  }
  const maxMargin =
    Math.min(clearRect.maxX - clearRect.minX, clearRect.maxZ - clearRect.minZ, ceilingHeight) *
    HALF;
  if (margin < 0 || margin >= maxMargin) {
    throw new RangeError(`margin must be in [0, ${String(maxMargin)}), got ${String(margin)}`);
  }
  return Object.freeze({
    plan: Object.freeze({
      minX: clearRect.minX + margin,
      maxX: clearRect.maxX - margin,
      minZ: clearRect.minZ + margin,
      maxZ: clearRect.maxZ - margin,
    }),
    minY: margin,
    maxY: ceilingHeight - margin,
  });
}

/**
 * Follow camera behind the person.
 *
 * - target = (pose.x, config.targetHeight, pose.z), clamped into `roomBox` first when it lies
 *   outside, so the ray always starts inside the box;
 * - elevation = clamp(config.baseElevation − pose.pitch, −maxElevation, maxElevation): looking
 *   up lowers the camera, looking down raises it;
 * - direction (unit, from target toward camera) = (sin yaw · cos e, sin e, cos yaw · cos e),
 *   i.e. backward on the plan;
 * - exit = distance along that ray at which it leaves `roomBox`; axes whose direction component
 *   is about 0 are ignored;
 * - distance = max(0, min(config.followDistance, exit)); position = target + direction · distance.
 *
 * The position is finally clamped into `roomBox` to absorb floating-point rounding, which only
 * ever moves it by a negligible amount.
 *
 * @param pose - The person's pose. Not mutated.
 * @param roomBox - The box the camera must stay inside (see {@link createCameraRoomBox}).
 * @param config - Camera tuning; defaults to {@link THIRD_PERSON_CAMERA_CONFIG}.
 * @returns A new camera placement.
 */
export function getThirdPersonCamera(
  pose: EyePose,
  roomBox: CameraRoomBox,
  config: ThirdPersonCameraConfig = THIRD_PERSON_CAMERA_CONFIG,
): ThirdPersonCamera {
  const { plan, minY, maxY } = roomBox;
  const target: ScenePoint = {
    x: clamp(pose.x, plan.minX, plan.maxX),
    y: clamp(config.targetHeight, minY, maxY),
    z: clamp(pose.z, plan.minZ, plan.maxZ),
  };

  const elevation = clamp(
    config.baseElevation - pose.pitch,
    -config.maxElevation,
    config.maxElevation,
  );
  const horizontal = Math.cos(elevation);
  const directionX = Math.sin(pose.yaw) * horizontal;
  const directionY = Math.sin(elevation);
  const directionZ = Math.cos(pose.yaw) * horizontal;

  const exit = Math.min(
    getAxisExit(target.x, directionX, plan.minX, plan.maxX),
    getAxisExit(target.y, directionY, minY, maxY),
    getAxisExit(target.z, directionZ, plan.minZ, plan.maxZ),
  );
  const distance = Math.max(0, Math.min(config.followDistance, exit));

  return {
    position: {
      x: clamp(target.x + directionX * distance, plan.minX, plan.maxX),
      y: clamp(target.y + directionY * distance, minY, maxY),
      z: clamp(target.z + directionZ * distance, plan.minZ, plan.maxZ),
    },
    target,
    distance,
  };
}

/**
 * Whether the person model should be hidden because the camera is pulled in too close.
 *
 * @param camera - The camera placement (see {@link getThirdPersonCamera}).
 * @param config - Camera tuning; defaults to {@link THIRD_PERSON_CAMERA_CONFIG}.
 * @returns `true` when `camera.distance` is below `config.minBodyVisibleDistance`.
 */
export function shouldHidePersonModel(
  camera: ThirdPersonCamera,
  config: ThirdPersonCameraConfig = THIRD_PERSON_CAMERA_CONFIG,
): boolean {
  return camera.distance < config.minBodyVisibleDistance;
}

/**
 * Distance along one axis at which a ray from an inside origin leaves the slab [min, max].
 *
 * @returns `Infinity` when the direction component is about 0 (the ray never exits on it).
 */
function getAxisExit(origin: number, direction: number, min: number, max: number): number {
  if (Math.abs(direction) < DIRECTION_EPSILON) {
    return Number.POSITIVE_INFINITY;
  }
  return ((direction > 0 ? max : min) - origin) / direction;
}

/** Restricts a value to the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
