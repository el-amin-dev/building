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
 * behind the person — the one `getSurfaceField` picks for the body's own stance,
 * so the camera and the walker are never bounded by different models of the
 * stair bay — measured for a circle of `wallMargin` rather than of the body
 * radius, plus a vertical range above the storey the body stands on. When
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
import type { PlanVector } from './collision.ts';
import { EYE_NAVIGATION_CONFIG, getFootLevel, getSurfaceField } from './eyeNavigation.ts';
import type { EyePose, WalkSurface } from './eyeNavigation.ts';
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
  /** The storey being walked: where the body may stand, and its stairwell. */
  readonly surface: WalkSurface;
  /**
   * Lowest camera height ABOVE THE BODY'S STOREY DATUM, in metres.
   *
   * The range is storey-RELATIVE, so one field describes the camera's band on
   * whichever storey the body is on: {@link getThirdPersonCamera} adds
   * `getFootLevel(pose)` to both ends of it.
   */
  readonly minY: number;
  /** Highest, likewise relative. */
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
  /**
   * Camera distance at or below which the person model is hidden, in metres: the body is
   * only visible from further away than this.
   */
  readonly minBodyVisibleDistance: number;
}

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;

const FOLLOW_DISTANCE_METRES = 2.5;
const BASE_ELEVATION_DEGREES = 15;
const MAX_ELEVATION_DEGREES = 80;
const WALL_MARGIN_METRES = 0.15;
/**
 * Distance the body starts hiding the room rather than standing in it, in metres.
 *
 * Half a metre behind a head roughly 0.22 m across — an eighth of the standing height — is
 * the back of that head filling the middle of the frame, so at this distance and nearer the
 * model is hidden and the viewer looks out from just behind it (see
 * {@link shouldHidePersonModel}).
 *
 * It is also the distance the raise can always reach, which is why it is this number and not
 * a larger one. The body stops flush against a wall face, its centre at
 * `face − PERSON_SPEC.radius` (0.25 m); the camera keeps `WALL_MARGIN_METRES` (0.15 m) from
 * that same face, so 0.10 m of clearance is left straight behind the body centre, and the
 * camera reaches this distance by rising to acos(0.10 / 0.5) ≈ 78.5° — under the 80°
 * elevation limit. A threshold the raise could not reach would instead leave the camera
 * pinned against the wall in the tightest legal pose the collision field allows.
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
 * Rounding slack, in metres, when comparing a distance with the visibility threshold.
 *
 * The threshold is inclusive — a camera exactly there hides the model — and the raise aims at
 * exactly that distance, so it lands a last bit either side of it. The slack puts both sides
 * of that last bit on the hidden side, rather than letting floating-point noise decide
 * whether the frame is filled by the back of a head.
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
 * Camera field of a storey: its walking surface, plus the vertical range between floor and ceiling.
 *
 * The plan is NOT narrowed here, because there is nothing to narrow: the blockers already are
 * where the camera may not go, and the margin is applied per query by {@link getClearance} —
 * which is what lets the camera follow through a doorway that no single room rectangle contains.
 *
 * The vertical range is relative to the storey the body stands on, not to storey 1: the same
 * field therefore serves a body on any storey of the stack, and the datum is added per
 * placement by {@link getThirdPersonCamera}.
 *
 * @param surface - The walking surface of the storey (see `WalkSurface`): both its plan fields
 *   and its stairwell. Captured, not copied; its fields are already deeply frozen by
 *   `makeWalkField`.
 * @param ceilingHeight - Height of the ceiling above the finished floor, in metres.
 * @param config - Camera tuning; defaults to {@link THIRD_PERSON_CAMERA_CONFIG}. Only
 *   `wallMargin` is read.
 * @returns A frozen field with `minY` = `config.wallMargin` and `maxY` =
 *   `ceilingHeight − config.wallMargin`, both above the body's storey datum.
 * @throws RangeError when `ceilingHeight` is not finite, or when the margin leaves no vertical
 *   range at all (`ceilingHeight` at most twice the margin).
 */
export function createCameraField(
  surface: WalkSurface,
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
  return Object.freeze({ surface, minY, maxY });
}

/**
 * Follow camera behind the person.
 *
 * Every height below is measured from `base` = `getFootLevel(pose)`, the level of the body's
 * feet: the field's `minY`/`maxY` are the camera's band above the storey the body stands on, so
 * the camera rides up the stack with the walker instead of staying on storey 1.
 *
 * - target = (pose.x, base + clamp(config.targetHeight, minY, maxY), pose.z). The plan is taken
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
 *   (see {@link getClearance}), read off the field `getSurfaceField` picks for the body's own
 *   stance: `Infinity` when nothing is behind, `0` when the camera's own circle already overlaps
 *   a blocker. **Asking the surface rather than the plan field is what keeps the camera behind a
 *   body on the stairs**: mid-flight the body stands inside what the plan field calls a hole, so
 *   that field would answer `0`, send the camera overhead and hide the model — a viewer would
 *   watch the top of a head climb the stair. The bay-released field answers with the real room
 *   the shaft leaves;
 * - exit(e) = min(H / cos e, the travel at which the ray leaves the vertical range
 *   [base + minY, base + maxY]), the distance at which the ray meets a blocker, the floor or the
 *   ceiling. The plan term is `Infinity` for a ray that is vertical to within
 *   {@link VERTICAL_RAY_COSINE}, which covers no plan distance for any blocker to lie in;
 * - when min(followDistance, exit(e0)) ≥ t (`minBodyVisibleDistance`), e = e0. Otherwise the
 *   camera rises: with Vc = base + maxY − target.y, eMin = acos(min(1, H / t)) is the lowest elevation
 *   at which the plan allows distance t and eCeil = asin(min(1, Vc / t)) the highest the ceiling
 *   allows. If max(e0, eMin) ≤ min(maxElevation, eCeil), e = max(e0, eMin), the lowest elevation
 *   at which the body is visible; otherwise e = clamp(atan2(Vc, H), e0, maxElevation), the
 *   elevation giving the largest distance;
 * - distance = max(0, min(followDistance, exit(e))); position = target + direction(e) · distance,
 *   with the height clamped into [base + minY, base + maxY] to absorb floating-point rounding,
 *   which only ever moves it by a negligible amount.
 *
 * Inside the open shaft the band is the band of the storey the body's feet are on, so a camera
 * behind a body part way up a flight can sit above that storey's nominal ceiling plane, and can
 * clip a tread behind the body. Both are correct for a shaft that is open through the slab:
 * there is no ceiling there to stay under, and the treads behind the body are the stair the
 * viewer just climbed.
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
  const { surface, minY, maxY } = field;
  /** Level of the body's feet: the datum the field's vertical range is measured from. */
  const base = getFootLevel(pose);
  const floorLevel = base + minY;
  const ceilingLevel = base + maxY;
  const target: ScenePoint = {
    x: pose.x,
    y: base + clamp(config.targetHeight, minY, maxY),
    z: pose.z,
  };

  const sinYaw = Math.sin(pose.yaw);
  const cosYaw = Math.cos(pose.yaw);
  const planTarget: PlanPoint = { x: pose.x, z: pose.z };
  /** Behind the person on the plan, unit: the opposite of forward `(−sin yaw, −cos yaw)`. */
  const back: PlanVector = { x: sinYaw, z: cosYaw };
  /** Plan clearance straight behind the person, for a circle of the camera's margin. */
  const planRoom = getClearance(
    planTarget,
    back,
    getSurfaceField(surface, planTarget, config.wallMargin),
    config.wallMargin,
  );

  /** Distance along the ray at elevation `e` before it meets a blocker, the floor or the ceiling. */
  const exitAt = (e: number): number => {
    const horizontal = Math.cos(e);
    const planExit =
      Math.abs(horizontal) < VERTICAL_RAY_COSINE ? Number.POSITIVE_INFINITY : planRoom / horizontal;
    return Math.min(planExit, getAxisExit(target.y, Math.sin(e), floorLevel, ceilingLevel));
  };

  const requested = getRequestedElevation(pose.pitch, config);
  const threshold = config.minBodyVisibleDistance;
  let elevation = requested;
  if (Math.min(config.followDistance, exitAt(requested)) < threshold) {
    const ceilingRoom = ceilingLevel - target.y;
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
      y: clamp(target.y + directionY * distance, floorLevel, ceilingLevel),
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
 * The threshold is **inclusive**: at exactly `minBodyVisibleDistance` the body already covers
 * the centre of the frame, which is the distance the raise settles on whenever the plan leaves
 * it no more room, so hiding there is what lets the viewer see the room from just behind the
 * head rather than from inside it. A distance within rounding slack
 * (`DISTANCE_TOLERANCE_METRES`) above the threshold is hidden too, so the last bit of a raise
 * aimed at the threshold cannot show the model again.
 *
 * @param camera - The camera placement (see {@link getThirdPersonCamera}).
 * @param config - Camera tuning; defaults to {@link THIRD_PERSON_CAMERA_CONFIG}.
 * @returns `true` when `camera.distance` is at or below `config.minBodyVisibleDistance`.
 */
export function shouldHidePersonModel(
  camera: ThirdPersonCamera,
  config: ThirdPersonCameraConfig = THIRD_PERSON_CAMERA_CONFIG,
): boolean {
  return camera.distance <= config.minBodyVisibleDistance + DISTANCE_TOLERANCE_METRES;
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
