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
 *
 * **Inside the stair bay the plan alone is not enough.** The shaft is open on
 * the plan — that is what lets the camera keep a real distance behind a body on
 * a flight — but it is not open overhead: half a storey above a half-landing
 * stands the flight the walker is about to climb one storey up, and a landing
 * one storey up is a slab. The plan field knows nothing of either, so the camera
 * is additionally stopped where it would rise through the stair
 * ({@link getStairCeilingExit}).
 */

import { getClearance } from './collision.ts';
import type { PlanVector } from './collision.ts';
import { EYE_NAVIGATION_CONFIG, getFootLevel, getSurfaceField } from './eyeNavigation.ts';
import type { EyePose, WalkSurface } from './eyeNavigation.ts';
import { PERSON_SPEC } from './person.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { getRampRise } from './stairwell.ts';
import type { Stairwell } from './stairwell.ts';

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
/** No storey pitch at all: a stair that repeats by this is read only where it stands. */
const NO_REPEAT = 0;

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
 *   [base + minY, base + maxY], {@link getStairCeilingExit}), the distance at which the ray
 *   meets a blocker, the floor, the ceiling plane or the stair standing over it. The plan term
 *   is `Infinity` for a ray that is vertical to within {@link VERTICAL_RAY_COSINE}, which covers
 *   no plan distance for any blocker to lie in;
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
 * behind a body part way up a flight can sit above that storey's nominal ceiling plane. That is
 * correct for a shaft that is open through the slab: there is no ceiling plane there to stay
 * under. What the shaft does have is the stair itself, half a storey and a whole storey above,
 * and {@link getStairCeilingExit} is what stops the camera rising through it.
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

  /** What the stair carries over this placement, on the datum its own levels are measured from. */
  const overhead: StairCeilingQuery = {
    well: surface.well,
    floorToFloor: surface.floorToFloor,
    storeyDatum: base - pose.rise,
    origin: target,
    back,
    margin: config.wallMargin,
    cap: config.followDistance,
  };

  /** Distance along the ray at elevation `e` before it meets a blocker, the floor or a ceiling. */
  const exitAt = (e: number): number => {
    const horizontal = Math.cos(e);
    const planExit =
      Math.abs(horizontal) < VERTICAL_RAY_COSINE ? Number.POSITIVE_INFINITY : planRoom / horizontal;
    return Math.min(
      planExit,
      getAxisExit(target.y, Math.sin(e), floorLevel, ceilingLevel),
      getStairCeilingExit(overhead, e),
    );
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
 * A walking surface of the stairwell read as a ceiling: where it stands, and how high.
 *
 * `stairwell.ts` describes a flight and a landing differently — one is a height function over
 * its footprint, the other a level — because a walker asks them different questions. A camera
 * underneath asks both the same one, "how high are you over this point", so they are flattened
 * to one shape here rather than branched on at every step of the exit.
 */
interface StairSoffit {
  /** Footprint of the surface, in plan coordinates. */
  readonly rect: PlanRect;
  /**
   * Level of the surface over a point, in metres above the storey datum.
   *
   * `undefined` outside the footprint, exactly as `getRampRise` answers.
   */
  readonly levelAt: (point: PlanPoint) => number | undefined;
  /** Lowest level the surface reaches anywhere on its footprint, on the same datum. */
  readonly lowest: number;
}

/** A range of distances along the camera's ray, in metres. */
interface RaySpan {
  /** Where the range starts, in metres from the target. */
  readonly from: number;
  /** Where it ends, likewise. Never less than `from`. */
  readonly to: number;
}

/**
 * Reads every surface of a stairwell as a soffit.
 *
 * @param well - The stairwell, whose levels are rises above its storey's finished floor.
 * @returns One {@link StairSoffit} per flight and per landing, in the stairwell's own order.
 */
function readSoffits(well: Stairwell): readonly StairSoffit[] {
  return [
    ...well.ramps.map((ramp) => ({
      rect: ramp.rect,
      levelAt: (point: PlanPoint): number | undefined => getRampRise(ramp, point),
      lowest: Math.min(ramp.lowLevel, ramp.highLevel),
    })),
    ...well.landings.map((landing) => ({
      rect: landing.rect,
      levelAt: (): number => landing.level,
      lowest: landing.level,
    })),
  ];
}

/**
 * Range of ray distances over which the ray's plan point lies inside a rectangle.
 *
 * @param origin - Where the ray starts, in metres.
 * @param step - Plan travel per metre of ray, i.e. the backward unit vector times cos(elevation).
 *   A ray that is vertical to within {@link VERTICAL_RAY_COSINE} has a `step` of about zero and
 *   so stays over one point for its whole length.
 * @param rect - The rectangle, in plan coordinates.
 * @param cap - Longest ray distance of interest, in metres: the range is clipped to it so that a
 *   ray standing still on the plan still answers with a finite range.
 * @returns The range, clipped to [0, `cap`], or `undefined` when the ray never crosses the
 *   rectangle within it.
 */
function getRectSpan(
  origin: PlanPoint,
  step: PlanVector,
  rect: PlanRect,
  cap: number,
): RaySpan | undefined {
  const onX = getAxisSpan(origin.x, step.x, rect.minX, rect.maxX);
  const onZ = getAxisSpan(origin.z, step.z, rect.minZ, rect.maxZ);
  if (onX === undefined || onZ === undefined) {
    return undefined;
  }
  const from = Math.max(0, onX.from, onZ.from);
  const to = Math.min(cap, onX.to, onZ.to);
  return to < from ? undefined : { from, to };
}

/**
 * Range of ray distances over which one plan coordinate stays within [min, max].
 *
 * @param origin - The coordinate the ray starts at, in metres.
 * @param direction - Travel on this axis per metre of ray.
 * @param min - Lower bound of the range, in metres.
 * @param max - Upper bound.
 * @returns The range, unbounded on both ends for a ray that does not move on this axis and
 *   starts inside it; `undefined` when such a ray starts outside it.
 */
function getAxisSpan(
  origin: number,
  direction: number,
  min: number,
  max: number,
): RaySpan | undefined {
  if (Math.abs(direction) < DIRECTION_EPSILON) {
    return origin < min || origin > max
      ? undefined
      : { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY };
  }
  const atMin = (min - origin) / direction;
  const atMax = (max - origin) / direction;
  return { from: Math.min(atMin, atMax), to: Math.max(atMin, atMax) };
}

/**
 * Distance along the ray at which it would rise through the stair standing over it.
 *
 * **The rule: the camera never rises through the stair.** A flight or a landing over the
 * camera is a ceiling, and the plan cannot see it — inside the bay the plan is a released
 * field where the whole shaft is floor, so it answers "open, back up freely" for a space that
 * is open underfoot and solid overhead. This is the one bound that reads the stairwell's own
 * geometry, and it bounds the vertical: the ray is stopped where it would cross a walking
 * surface from below, less the wall margin the camera keeps from everything else.
 *
 * Only a crossing FROM BELOW counts. A ray already over a surface when it reaches that
 * surface's footprint is flying over the flight rather than under it — which is exactly what
 * the camera does behind a body on the arrival landing, looking down over the stair — and
 * nothing there is between it and the body.
 *
 * Two details decide which surfaces are consulted:
 *
 * - **the stair repeats every storey**, so the surfaces over a body high up a flight belong to
 *   the storey above and are not in this storey's stairwell at all. Each surface is therefore
 *   also read at whole storey pitches above itself, as many as the ray can reach. Reading the
 *   repeats off a WALKABLE stairwell is sound because the stair is DRAWN through every storey
 *   whether or not a walker may climb it (`getStairwellEnds`): a top storey's stairwell carries
 *   no surface above its own floor, but the flights standing there are still built, and they
 *   are the repeats of the ones below;
 * - **the footprint is shrunk by the margin**, so a surface is a ceiling only where the
 *   camera's own circle is wholly under it. The two flights of a half-turn meet along one line,
 *   and a camera travelling down that line is threading the open middle of the shaft rather
 *   than passing under either flight; growing the footprint instead would close the shaft that
 *   the pull-back from the arrival landing needs.
 *
 * @param query - The placement being measured (see {@link StairCeilingQuery}).
 * @param elevation - Elevation of the ray above the horizontal, in radians.
 * @returns The distance from the target at which the ray meets the stair overhead, in metres,
 *   or `Infinity` when nothing of the stair stands over the ray within `query.cap`.
 */
function getStairCeilingExit(query: StairCeilingQuery, elevation: number): number {
  const { well, floorToFloor, storeyDatum, origin, back, margin, cap } = query;
  const horizontal = Math.cos(elevation);
  const rise = Math.sin(elevation);
  const step: PlanVector = { x: back.x * horizontal, z: back.z * horizontal };
  /** Highest a surface can stand and still be crossed: the ray never passes `cap` or the band. */
  const reach = origin.y + rise * cap + margin;

  return readSoffits(well).reduce((nearest, soffit) => {
    const lifts = getStoreyLifts(storeyDatum + soffit.lowest, reach, floorToFloor);
    return lifts.reduce(
      (closest, lift) => Math.min(closest, getSoffitExit(soffit, lift, query, step, rise)),
      nearest,
    );
  }, Number.POSITIVE_INFINITY);
}

/**
 * Whole-storey lifts at which a surface still stands low enough for the ray to reach it.
 *
 * @param foot - Level of the surface's lowest point, in metres: a surface whose lowest point is
 *   already over the ray cannot be crossed anywhere on its footprint.
 * @param reach - Highest level the ray reaches, in metres.
 * @param pitch - Storey pitch the stair repeats by, in metres; a pitch of {@link NO_REPEAT} or
 *   less leaves the surface to be read where it stands and nowhere else.
 * @returns `0` first, then one lift per repeat that stays within reach; empty when the surface
 *   already stands above the ray.
 */
function getStoreyLifts(foot: number, reach: number, pitch: number): readonly number[] {
  if (foot > reach) {
    return [];
  }
  if (pitch <= NO_REPEAT) {
    return [NO_REPEAT];
  }
  return Array.from({ length: Math.floor((reach - foot) / pitch) + 1 }, (_, step) => step * pitch);
}

/** Everything {@link getStairCeilingExit} needs to know about one camera placement. */
interface StairCeilingQuery {
  /** The stairwell standing over the body, with its levels on its storey's datum. */
  readonly well: Stairwell;
  /** Storey pitch, in metres: how far up the stair repeats itself. */
  readonly floorToFloor: number;
  /** Level of the finished floor the stairwell's levels are measured from, in metres. */
  readonly storeyDatum: number;
  /** Where the ray starts: the point the camera looks at. */
  readonly origin: ScenePoint;
  /** Behind the person on the plan, unit. */
  readonly back: PlanVector;
  /** Distance the camera keeps from the stair, in metres. */
  readonly margin: number;
  /** Longest ray distance of interest, in metres: the camera is never further than this. */
  readonly cap: number;
}

/**
 * Distance at which the ray crosses one surface of the stair, lifted by whole storeys.
 *
 * Over the stretch of ray that lies under the surface's footprint, both the ray's height and
 * the surface's level are linear in the distance travelled, so the crossing is one division
 * rather than a search: the surface is sampled at the two ends of that stretch and interpolated
 * between them.
 *
 * The margin is kept in whichever direction the ray runs out of room first. A ray that reaches
 * the soffit's level before it reaches the footprint is not yet under the soffit but beside it,
 * so it is stopped at the footprint's own edge — which the shrinking has already set a margin
 * back from the real one — rather than at a level it never had to clear.
 *
 * @param soffit - The surface, read as a ceiling.
 * @param lift - Whole storeys the surface is raised by, in metres.
 * @param query - The placement being measured.
 * @param step - Plan travel per metre of ray.
 * @param rise - Height gained per metre of ray, i.e. sin(elevation).
 * @returns The distance from the target, in metres, or `Infinity` when the ray stays clear of
 *   the surface — because it misses the footprint, because it never catches up with a surface
 *   climbing at least as fast as it does, or because it is already over the surface where it
 *   reaches it, which is a camera flying over the flight rather than passing under it.
 */
function getSoffitExit(
  soffit: StairSoffit,
  lift: number,
  query: StairCeilingQuery,
  step: PlanVector,
  rise: number,
): number {
  const { origin, margin, storeyDatum, cap } = query;
  const shrunk = shrinkRect(soffit.rect, margin);
  if (shrunk === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const span = getRectSpan(origin, step, shrunk, cap);
  if (span === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const levelFrom = soffit.levelAt(planPointAt(origin, step, span.from));
  const levelTo = soffit.levelAt(planPointAt(origin, step, span.to));
  if (levelFrom === undefined || levelTo === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const run = span.to - span.from;
  const climb = run > 0 ? (levelTo - levelFrom) / run : 0;
  const gain = rise - climb;
  if (gain <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (origin.y + rise * span.from >= storeyDatum + levelFrom + lift) {
    return Number.POSITIVE_INFINITY;
  }
  const at = (storeyDatum + levelFrom + lift - margin - climb * span.from - origin.y) / gain;
  return at <= span.to ? Math.max(at, span.from) : Number.POSITIVE_INFINITY;
}

/** Where the ray's plan point is after travelling `distance` metres. */
function planPointAt(origin: PlanPoint, step: PlanVector, distance: number): PlanPoint {
  return { x: origin.x + step.x * distance, z: origin.z + step.z * distance };
}

/**
 * Shrinks a rectangle inward by the same distance on every face.
 *
 * @param rect - The rectangle to shrink.
 * @param by - Distance each face moves inward, in metres.
 * @returns The shrunken rectangle, or `undefined` when the distance leaves nothing of it.
 */
function shrinkRect(rect: PlanRect, by: number): PlanRect | undefined {
  const minX = rect.minX + by;
  const maxX = rect.maxX - by;
  const minZ = rect.minZ + by;
  const maxZ = rect.maxZ - by;
  return minX > maxX || minZ > maxZ ? undefined : { minX, maxX, minZ, maxZ };
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
