/**
 * Third-person follow camera of the interior viewer.
 *
 * The camera sits behind the person and looks at the head. Coordinates are
 * expressed in metres and angles in radians, with the conventions of
 * `eyeNavigation.ts`: `y` points up, the plan lies on `x`/`z`, yaw 0 looks
 * toward −z, increasing yaw turns left and positive pitch looks up. Forward on
 * the plan is `(−sin yaw, −cos yaw)`, so behind the person — where the camera
 * goes — is the opposite, `(sin yaw, cos yaw)`.
 *
 * The camera never passes through anything the body cannot pass through: it is
 * pulled in to the clearance the real collision field (`collision.ts`) leaves
 * behind the person, measured for a circle of `wallMargin` rather than of the
 * body radius, plus a vertical range between the floor and the ceiling. When
 * that clearance is too small to see the body (e.g. with the person's back to a
 * wall), the camera rises toward overhead instead, looking down at the head. It
 * never goes below head height (see {@link MIN_ELEVATION_RADIANS}).
 *
 * **The camera is not confined to one room, and that is deliberate.** It is
 * stopped by blockers, not by the walls of the space the person stands in, so
 * with an open doorway straight behind the person it follows through the doorway
 * into the next space instead of being trapped against the plane of the wall.
 * What it must never do is pass through masonry, and it cannot: a window leaves
 * a sill block that is solid at body height, so the blocker list is unbroken
 * across a window and the camera stops at it exactly as the body does.
 */

import { getClearance } from './collision.ts';
import type { PlanVector, WalkField } from './collision.ts';
import { EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import type { EyePose } from './eyeNavigation.ts';
import { PERSON_SPEC } from './person.ts';
import type { PlanPoint } from './planGeometry.ts';

/** A point in scene space, metres (x, z on the plan; y up). */
export interface ScenePoint {
  /** Position along the plan width, in metres. */
  readonly x: number;
  /** Height above the finished floor, in metres. */
  readonly y: number;
  /** Position along the plan depth, in metres. */
  readonly z: number;
}

/** Where the follow camera may go: the same blockers the body is stopped by, plus a vertical range. */
export interface CameraField {
  /** The collision field of the storey; only its blockers are consulted. */
  readonly walk: WalkField;
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
  /** Largest elevation of the camera, in radians. */
  readonly maxElevation: number;
  /**
   * Largest absolute pitch of the person, in radians: pitch −`maxPitch` (looking down) maps to
   * elevation `maxElevation` and pitch +`maxPitch` (looking up) to {@link MIN_ELEVATION_RADIANS}.
   */
  readonly maxPitch: number;
  /**
   * Distance the camera keeps from blockers, floor and ceiling, in metres. It is the radius of
   * the camera's own body on the plan, the way `PERSON_SPEC.radius` is the person's.
   */
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
/**
 * Reachable with the back flat against a wall face, in metres.
 *
 * The body stops flush against the face, its centre at `face − PERSON_SPEC.radius` (0.25 m); the
 * camera keeps `WALL_MARGIN_METRES` (0.15 m) from that same face, so 0.10 m of clearance is left
 * straight behind the body centre. The camera therefore rises to
 * acos(0.10 / 0.5) ≈ 78.5°, which is under the 80° elevation limit — so the body stays visible
 * in the tightest legal pose the collision field allows rather than being hidden.
 */
const MIN_BODY_VISIBLE_DISTANCE_METRES = 0.5;

/** A ray direction component smaller than this never reaches a face of the vertical slab. */
const DIRECTION_EPSILON = 1e-12;
/**
 * Cosine of the elevation below which the ray counts as vertical: it covers no plan distance, so
 * no blocker can ever bound it and only the vertical slab does.
 */
const VERTICAL_RAY_COSINE = 1e-12;
/**
 * Rounding slack, in metres, when comparing a distance with the visibility threshold: a camera
 * raised to exactly the threshold distance must not be hidden by a last-bit rounding error.
 */
const DISTANCE_TOLERANCE_METRES = 1e-9;

/**
 * Lowest elevation of the third-person camera, in radians: level with the head.
 *
 * Below head height, a camera behind the person looks up through the torso and clips it; with the
 * person's back near a wall, the raise toward overhead would also flip the camera from above the
 * head to below it as the pitch crosses this value. Looking fully up therefore gives a level view
 * from behind, never one from below.
 */
export const MIN_ELEVATION_RADIANS = 0;

/** Default tuning of the third-person camera. Frozen. */
export const THIRD_PERSON_CAMERA_CONFIG: ThirdPersonCameraConfig = Object.freeze({
  followDistance: FOLLOW_DISTANCE_METRES,
  targetHeight: PERSON_SPEC.eyeHeight,
  baseElevation: BASE_ELEVATION_DEGREES * RADIANS_PER_DEGREE,
  maxElevation: MAX_ELEVATION_DEGREES * RADIANS_PER_DEGREE,
  maxPitch: EYE_NAVIGATION_CONFIG.maxPitch,
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
  /** Chosen angle of the camera above the target's horizontal, in radians. */
  readonly elevation: number;
}

/**
 * Camera field of a storey: its walk field, plus the vertical range between floor and ceiling.
 *
 * The plan is NOT narrowed here, because there is nothing to narrow: the blockers already are
 * where the camera may not go, and the margin is applied per query by {@link getClearance} —
 * which is what lets the camera follow through a doorway that no single room rectangle contains.
 *
 * @param walk - The collision field of the storey (see `getWalkField`). Captured, not copied; it
 *   is already deeply frozen by `makeWalkField`.
 * @param ceilingHeight - Height of the ceiling above the finished floor, in metres.
 * @param config - Camera tuning; defaults to {@link THIRD_PERSON_CAMERA_CONFIG}. Only
 *   `wallMargin` is read.
 * @returns A frozen field with `minY` = `config.wallMargin` and `maxY` =
 *   `ceilingHeight − config.wallMargin`.
 * @throws RangeError when `ceilingHeight` is not finite, or when the margin leaves no vertical
 *   range at all (`ceilingHeight` at most twice the margin).
 */
export function createCameraField(
  walk: WalkField,
  ceilingHeight: number,
  config: ThirdPersonCameraConfig = THIRD_PERSON_CAMERA_CONFIG,
): CameraField {
  const minY = config.wallMargin;
  const maxY = ceilingHeight - config.wallMargin;
  if (!Number.isFinite(ceilingHeight) || maxY <= minY) {
    throw new RangeError(
      `ceilingHeight must be finite and leave room above the ${String(config.wallMargin)} m margin, got ${String(ceilingHeight)}`,
    );
  }
  return Object.freeze({ walk, minY, maxY });
}

/**
 * Follow camera behind the person.
 *
 * - target = (pose.x, clamp(config.targetHeight, minY, maxY), pose.z). The plan is taken
 *   verbatim: the pose is legal by construction — collision put it there — so clamping it into a
 *   rectangle would fight the collision model rather than protect it;
 * - requested elevation e0: pitch maps piecewise-linearly so that pitch 0 gives
 *   `baseElevation`, pitch −`maxPitch` (looking down) gives `maxElevation` and pitch
 *   +`maxPitch` (looking up) gives {@link MIN_ELEVATION_RADIANS} (level with the head); the
 *   result is clamped to [`MIN_ELEVATION_RADIANS`, `maxElevation`]. Looking up lowers the
 *   camera down to head level, never below; looking down raises it, with no dead zone;
 * - direction(e) (unit, from target toward camera) = (sin yaw · cos e, sin e, cos yaw · cos e),
 *   i.e. backward on the plan;
 * - H = the plan clearance straight behind the person, for a circle of `config.wallMargin`
 *   (see {@link getClearance}): `Infinity` when nothing is behind, `0` when the camera's own
 *   circle already overlaps a blocker;
 * - exit(e) = min(H / cos e, the travel at which the ray leaves the vertical range), the
 *   distance at which the ray meets a blocker, the floor or the ceiling. The plan term is
 *   `Infinity` for a ray that is vertical to within {@link VERTICAL_RAY_COSINE}, which covers no
 *   plan distance for any blocker to lie in;
 * - when min(followDistance, exit(e0)) ≥ t (`minBodyVisibleDistance`), e = e0. Otherwise the
 *   camera rises: with Vc = maxY − target.y, eMin = acos(min(1, H / t)) is the lowest elevation
 *   at which the plan allows distance t and eCeil = asin(min(1, Vc / t)) the highest the ceiling
 *   allows. If max(e0, eMin) ≤ min(maxElevation, eCeil), e = max(e0, eMin), the lowest elevation
 *   at which the body is visible; otherwise e = clamp(atan2(Vc, H), e0, maxElevation), the
 *   elevation giving the largest distance;
 * - distance = max(0, min(followDistance, exit(e))); position = target + direction(e) · distance,
 *   with the height clamped into [minY, maxY] to absorb floating-point rounding, which only ever
 *   moves it by a negligible amount.
 *
 * @param pose - The person's pose. Not mutated.
 * @param field - Where the camera may go (see {@link createCameraField}). Not mutated.
 * @param config - Camera tuning; defaults to {@link THIRD_PERSON_CAMERA_CONFIG}.
 * @returns A new camera placement, with the chosen elevation.
 */
export function getThirdPersonCamera(
  pose: EyePose,
  field: CameraField,
  config: ThirdPersonCameraConfig = THIRD_PERSON_CAMERA_CONFIG,
): ThirdPersonCamera {
  const { walk, minY, maxY } = field;
  const target: ScenePoint = {
    x: pose.x,
    y: clamp(config.targetHeight, minY, maxY),
    z: pose.z,
  };

  const sinYaw = Math.sin(pose.yaw);
  const cosYaw = Math.cos(pose.yaw);
  const planTarget: PlanPoint = { x: pose.x, z: pose.z };
  /** Behind the person on the plan, unit: the opposite of forward `(−sin yaw, −cos yaw)`. */
  const back: PlanVector = { x: sinYaw, z: cosYaw };
  /** Plan clearance straight behind the person, for a circle of the camera's margin. */
  const planRoom = getClearance(planTarget, back, walk, config.wallMargin);

  /** Distance along the ray at elevation `e` before it meets a blocker, the floor or the ceiling. */
  const exitAt = (e: number): number => {
    const horizontal = Math.cos(e);
    const planExit =
      Math.abs(horizontal) < VERTICAL_RAY_COSINE ? Number.POSITIVE_INFINITY : planRoom / horizontal;
    return Math.min(planExit, getAxisExit(target.y, Math.sin(e), minY, maxY));
  };

  const requested = getRequestedElevation(pose.pitch, config);
  const threshold = config.minBodyVisibleDistance;
  let elevation = requested;
  if (Math.min(config.followDistance, exitAt(requested)) < threshold) {
    const ceilingRoom = maxY - target.y;
    const lowestVisible = Math.acos(Math.min(1, planRoom / threshold));
    const highestUnderCeiling = Math.asin(Math.min(1, ceilingRoom / threshold));
    const raised = Math.max(requested, lowestVisible);
    elevation =
      raised <= Math.min(config.maxElevation, highestUnderCeiling)
        ? raised
        : clamp(Math.atan2(ceilingRoom, planRoom), requested, config.maxElevation);
  }

  const horizontal = Math.cos(elevation);
  const directionX = sinYaw * horizontal;
  const directionY = Math.sin(elevation);
  const directionZ = cosYaw * horizontal;
  const distance = Math.max(0, Math.min(config.followDistance, exitAt(elevation)));

  return {
    position: {
      x: target.x + directionX * distance,
      y: clamp(target.y + directionY * distance, minY, maxY),
      z: target.z + directionZ * distance,
    },
    target,
    distance,
    elevation,
  };
}

/**
 * Whether the person model should be hidden because the camera is pulled in too close.
 *
 * A distance within rounding slack (`DISTANCE_TOLERANCE_METRES`) of the threshold still shows the
 * model, so a camera raised to exactly `minBodyVisibleDistance` is never hidden by a rounding
 * error.
 *
 * @param camera - The camera placement (see {@link getThirdPersonCamera}).
 * @param config - Camera tuning; defaults to {@link THIRD_PERSON_CAMERA_CONFIG}.
 * @returns `true` when `camera.distance` is below `config.minBodyVisibleDistance`.
 */
export function shouldHidePersonModel(
  camera: ThirdPersonCamera,
  config: ThirdPersonCameraConfig = THIRD_PERSON_CAMERA_CONFIG,
): boolean {
  return camera.distance < config.minBodyVisibleDistance - DISTANCE_TOLERANCE_METRES;
}

/**
 * Camera elevation asked for by the person's pitch, before any blocker is taken into account.
 *
 * Piecewise-linear: pitch 0 gives `baseElevation`, −`maxPitch` gives `maxElevation` and
 * +`maxPitch` gives {@link MIN_ELEVATION_RADIANS}; clamped to [`MIN_ELEVATION_RADIANS`,
 * `maxElevation`], so the camera never asks to go below head height.
 *
 * @returns The requested elevation, in radians.
 */
function getRequestedElevation(pitch: number, config: ThirdPersonCameraConfig): number {
  const { baseElevation, maxElevation, maxPitch } = config;
  const ratio = maxPitch > 0 ? pitch / maxPitch : 0;
  const elevation =
    ratio <= 0
      ? baseElevation - ratio * (maxElevation - baseElevation)
      : baseElevation + ratio * (MIN_ELEVATION_RADIANS - baseElevation);
  return clamp(elevation, MIN_ELEVATION_RADIANS, maxElevation);
}

/**
 * Distance along the vertical at which a ray from an inside origin leaves the slab [min, max].
 *
 * The vertical is the one axis a camera field still bounds as a slab; the plan is bounded by
 * blockers instead (see {@link createCameraField}).
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
