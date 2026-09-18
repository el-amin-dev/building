/**
 * First-person ("eye") navigation of the interior viewer.
 *
 * Coordinates are expressed in metres and angles in radians. `y` points up and
 * the floor plan lies on `x`/`z`. The camera follows the three.js convention
 * with Euler order `YXZ`: `yaw` is the rotation about +y and `pitch` the
 * rotation about x. At yaw 0 the eye looks toward −z; increasing yaw turns
 * left and increasing pitch looks up.
 *
 * On the plan, the forward unit vector is `(−sin yaw, −cos yaw)` and the right
 * unit vector is `(cos yaw, −sin yaw)` on `(x, z)`.
 *
 * Where the body may go on the plan is not this module's business: a step is
 * handed to `collision.ts`, which stops it at whatever it runs into anywhere on
 * the floor. How HIGH the body is, is: a pose carries the storey it stands on
 * and the rise it stands at above that storey's finished floor, the stair under
 * its feet (`stairwell.ts`) decides that rise, and a full storey climbed
 * promotes it to the next floor. See {@link EyePose} and {@link WalkSurface}.
 */

import { moveBody } from './collision.ts';
import type { PlanVector, WalkField } from './collision.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { PERSON_SPEC } from './person.ts';
import { LENGTH_TOLERANCE } from './planGeometry.ts';
import type { PlanPoint } from './planGeometry.ts';
import { getStairFooting, isNearStairwell } from './stairwell.ts';
import type { Stairwell } from './stairwell.ts';
import { clampFloorCount, getStoreyLevel, MIN_FLOOR_COUNT } from './storeys.ts';

/**
 * Every navigation command of the eye, in HUD reading order: move, strafe, turn, look.
 *
 * The actions are the vocabulary of the navigation: a physical key
 * ({@link EYE_KEY_BINDINGS}) and an on-screen control both name one of these, so neither
 * input path has to imitate the other. Frozen.
 */
export const EYE_ACTIONS = Object.freeze([
  'moveForward',
  'moveBackward',
  'strafeLeft',
  'strafeRight',
  'turnLeft',
  'turnRight',
  'lookUp',
  'lookDown',
] as const);

/** A navigation command, triggered by a key or by an on-screen control. */
export type EyeAction = (typeof EYE_ACTIONS)[number];

/**
 * Key bindings of the eye navigation, keyed by `KeyboardEvent.code` so that
 * they target physical keys regardless of the keyboard layout. Frozen.
 */
export const EYE_KEY_BINDINGS: Readonly<Record<string, EyeAction>> = Object.freeze({
  KeyW: 'moveForward',
  KeyS: 'moveBackward',
  KeyA: 'strafeLeft',
  KeyD: 'strafeRight',
  KeyJ: 'turnLeft',
  KeyL: 'turnRight',
  KeyI: 'lookUp',
  KeyK: 'lookDown',
});

/**
 * Tells whether a physical key is bound to an eye navigation action.
 *
 * Only the bindings' own keys count, so inherited names such as `'toString'`
 * are rejected.
 *
 * @param code - A `KeyboardEvent.code` value, e.g. `'KeyW'`.
 * @returns `true` when the key triggers an {@link EyeAction}.
 */
export function isEyeNavigationKey(code: string): boolean {
  return Object.hasOwn(EYE_KEY_BINDINGS, code);
}

/** The action a physical key triggers, or `undefined` when it is not bound. */
function getEyeAction(code: string): EyeAction | undefined {
  return isEyeNavigationKey(code) ? EYE_KEY_BINDINGS[code] : undefined;
}

/** A signed direction along one navigation axis: negative, none or positive. */
export type Axis = -1 | 0 | 1;

/**
 * What the viewer is currently asking for, one signed value per axis.
 *
 * Opposite keys held together cancel each other out to `0`.
 *
 * The values are signs and nothing else: they say which way, never how fast.
 * That is what lets one intent come from held keys, from held on-screen
 * controls, or from an automated route follower, with the speed staying the
 * navigation's own ({@link EyeNavigationConfig}).
 */
export interface MovementIntent {
  /** `+1` walks forward, `−1` walks backward. */
  readonly move: Axis;
  /** `+1` steps to the right, `−1` steps to the left. */
  readonly strafe: Axis;
  /** `+1` turns left (yaw increases), `−1` turns right (yaw decreases). */
  readonly turn: Axis;
  /** `+1` looks up (pitch increases), `−1` looks down (pitch decreases). */
  readonly look: Axis;
}

/** No action at all: the default second argument of {@link getMovementIntent}. Read-only. */
const NO_ACTIONS: ReadonlySet<EyeAction> = new Set<EyeAction>();

/**
 * Derives the movement intent from the actions currently being asked for.
 *
 * This is the single rule both input paths share: the keyboard maps its held keys to
 * actions, an on-screen control names them directly. Values that are not
 * {@link EyeAction}s are ignored, duplicates make no difference and opposite actions
 * cancel to `0`.
 *
 * @param actions - The actions being asked for, in any order and with any repetitions.
 * @returns The signed intent along each navigation axis.
 */
export function getIntentFromActions(actions: Iterable<EyeAction>): MovementIntent {
  return toIntent(new Set(actions));
}

/**
 * Derives the movement intent from the physical keys held down, plus any actions asked
 * for by another input (e.g. the on-screen remote control).
 *
 * Unknown key codes are ignored, an action asked for by both inputs counts once and
 * opposite actions cancel to `0`.
 *
 * @param pressedCodes - The `KeyboardEvent.code` values currently pressed.
 * @param extraActions - Actions held outside the keyboard; none by default.
 * @returns The signed intent along each navigation axis.
 */
export function getMovementIntent(
  pressedCodes: ReadonlySet<string>,
  extraActions: Iterable<EyeAction> = NO_ACTIONS,
): MovementIntent {
  const actions = new Set<EyeAction>(extraActions);
  for (const code of pressedCodes) {
    const action = getEyeAction(code);
    if (action !== undefined) {
      actions.add(action);
    }
  }

  return toIntent(actions);
}

/** Reduces the held actions to one signed value per navigation axis. */
function toIntent(actions: ReadonlySet<EyeAction>): MovementIntent {
  return {
    move: toAxis(actions.has('moveForward'), actions.has('moveBackward')),
    strafe: toAxis(actions.has('strafeRight'), actions.has('strafeLeft')),
    turn: toAxis(actions.has('turnLeft'), actions.has('turnRight')),
    look: toAxis(actions.has('lookUp'), actions.has('lookDown')),
  };
}

/**
 * Position on the floor plan, orientation, and height of the viewer's eye.
 *
 * The height is told as TWO fields — a storey and a rise above it — rather than
 * one absolute `y`, and that is a decision rather than a convenience.
 *
 * **The storey is stored, never re-derived.** Which floor the body is on is a
 * discrete fact the rest of the application reads: the floor the HUD prints, the
 * storey the minimap draws, the walls the scene shows. Dividing a height by the
 * floor-to-floor pitch to recover it puts that fact at the mercy of the last
 * bit of a float: a body stepping off the top riser is at a height that lands on
 * `3.0 ± 1 ulp`, and the quotient then answers "storey 2" on one frame and
 * "storey 1" on the next — flickering at exactly the boundary every walker
 * crosses. So {@link EyePose.floor} is carried as itself and {@link stepEyePose}
 * changes it once, deliberately, when a whole pitch has been climbed.
 *
 * **The rise carries the continuum, and is assigned rather than integrated.**
 * {@link EyePose.rise} is read off the walking surface under the body's feet
 * every frame ({@link stepEyePose} step 8), never accumulated from a vertical
 * speed, so it cannot drift: a body that stops on a tread stands at exactly that
 * tread's level however long it walked to reach it.
 */
export interface EyePose {
  /** Plan position along the width, in metres. */
  readonly x: number;
  /** Plan position along the depth, in metres. */
  readonly z: number;
  /** Rotation about +y, in radians, within (−π, π]. `0` looks toward −z. */
  readonly yaw: number;
  /** Rotation about x, in radians. Positive values look up. */
  readonly pitch: number;
  /** Storey the body stands on, 1…N, as the plan numbers them. */
  readonly floor: number;
  /**
   * Height of the feet above that storey's finished floor, in metres. `0`
   * everywhere but inside the stair bay. Invariant: `|rise| < floorToFloor`,
   * which {@link stepEyePose} maintains by promoting the storey instead.
   */
  readonly rise: number;
}

/** The pitch of a level gaze: straight ahead, neither up nor down. */
const LEVEL_PITCH = 0;

/** The rise of a storey's floor plane: its finished floor is the datum of the rise. */
const FLOOR_PLANE_RISE = 0;

/**
 * The margin the footing question is asked with: none.
 *
 * What may be stood on is asked of the bay itself, never of the approach to it,
 * unlike the field selection of {@link getSurfaceField}, which is asked of the
 * bay grown by a body radius. The two must differ: a body walking past the bay
 * is already reading the bay field a radius before it arrives, and if that ring
 * outside the bay were judged by the stairwell it would find no surface there
 * and stop dead beside a stair it never entered.
 */
const BAY_ITSELF = 0;

/** Storeys one promotion moves the body: a flight climbs exactly one. */
const STOREY_STEP = 1;

/**
 * Returns the absolute height of the feet, in metres.
 *
 * The one place the two height fields of an {@link EyePose} are added together,
 * so that the camera, the person model and the minimap cannot each invent their
 * own way of reading a pose's height.
 *
 * @param pose - The pose to measure.
 * @param heights - Vertical sizes the stack's pitch is read from; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns The level of the storey's finished floor plus the pose's rise, in
 *   metres above storey 1's finished floor.
 * @throws RangeError when `pose.floor` is not an integer of at least 1, or when
 *   the pitch is not finite and positive (see `getStoreyLevel`).
 */
export function getFootLevel(pose: EyePose, heights: FloorHeights = FLOOR_HEIGHTS): number {
  return getStoreyLevel(pose.floor, heights) + pose.rise;
}

/**
 * Returns the absolute height of the eyes, in metres.
 *
 * @param pose - The pose to measure.
 * @param heights - Vertical sizes the stack's pitch is read from; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns {@link getFootLevel} plus `PERSON_SPEC.eyeHeight`: the eye height is
 *   a size of the person, so it is read from the person rather than restated.
 * @throws RangeError under the conditions {@link getFootLevel} states.
 */
export function getEyeLevel(pose: EyePose, heights: FloorHeights = FLOOR_HEIGHTS): number {
  return getFootLevel(pose, heights) + PERSON_SPEC.eyeHeight;
}

/**
 * Raises a plan arrival pose to an eye pose: the same point and heading, looking level.
 *
 * Entry to the floor is through the stairs (ADR-006), and the stair bay knows
 * where a person lands and which way they face without knowing anything about a
 * camera. This is the one step between the two: it adds the level gaze and
 * nothing else, so the arrival point is not nudged, re-centred, or clamped.
 *
 * The parameter is typed structurally rather than imported, so that navigation
 * does not depend on the stair bay: `StairsArrival` (`stairs.ts`) is assignable
 * to it, and so is any other plan pose a future entrance produces.
 *
 * The storey is asked for rather than defaulted. The same arrival landing exists
 * on every storey of the stack — it is one floor repeated — so there is no
 * storey the plan pose itself implies, and a silent default of the ground floor
 * would land a viewer entering the third storey on the first without a word.
 *
 * @param arrival - Where the person lands and the heading they land with, in
 *   metres and radians. Not mutated.
 * @param floor - The storey they land on, 1…N as the plan numbers them. Stored
 *   as given: which storeys exist is the business of the stack
 *   ({@link placeInStack}), not of an arrival.
 * @returns A new pose at the arrival point on that storey, standing on its
 *   finished floor (`rise` 0), with `pitch` level and the arrival yaw wrapped
 *   into (−π, π] so the {@link EyePose} invariant holds. A yaw already in that
 *   range is returned unchanged.
 */
export function createArrivalPose(
  arrival: {
    readonly x: number;
    readonly z: number;
    readonly yaw: number;
  },
  floor: number,
): EyePose {
  return {
    x: arrival.x,
    z: arrival.z,
    yaw: wrapAngle(arrival.yaw),
    pitch: LEVEL_PITCH,
    floor,
    rise: FLOOR_PLANE_RISE,
  };
}

/** Tuning of the eye navigation. */
export interface EyeNavigationConfig {
  /** Walking speed, in metres per second. */
  readonly walkSpeed: number;
  /** Turning (yaw) speed, in radians per second. */
  readonly turnSpeed: number;
  /** Looking up/down (pitch) speed, in radians per second. */
  readonly lookSpeed: number;
  /** Largest absolute pitch the eye may reach, in radians. */
  readonly maxPitch: number;
  /** Longest time step simulated at once, in seconds, to absorb frame hitches. */
  readonly maxStepSeconds: number;
  /**
   * Radius of the viewer's body on the plan, in metres, kept clear of every wall,
   * hole and railing. It is a size of the person, so the default is
   * `PERSON_SPEC.radius` rather than a number of its own.
   */
  readonly bodyRadius: number;
}

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;
const FULL_TURN = 2 * Math.PI;

const WALK_SPEED_METRES_PER_SECOND = 1.4;
const TURN_SPEED_DEGREES_PER_SECOND = 90;
const LOOK_SPEED_DEGREES_PER_SECOND = 60;
const MAX_PITCH_DEGREES = 80;
const MAX_STEP_SECONDS = 0.1;

/** Default tuning of the eye navigation. Frozen. */
export const EYE_NAVIGATION_CONFIG: EyeNavigationConfig = Object.freeze({
  walkSpeed: WALK_SPEED_METRES_PER_SECOND,
  turnSpeed: TURN_SPEED_DEGREES_PER_SECOND * RADIANS_PER_DEGREE,
  lookSpeed: LOOK_SPEED_DEGREES_PER_SECOND * RADIANS_PER_DEGREE,
  maxPitch: MAX_PITCH_DEGREES * RADIANS_PER_DEGREE,
  maxStepSeconds: MAX_STEP_SECONDS,
  bodyRadius: PERSON_SPEC.radius,
});

/** The result of one step: the new pose, plus what the body was allowed to do. */
export interface EyeStep {
  /** The pose after the step. */
  readonly pose: EyePose;
  /** The plan step that was asked for, in metres. */
  readonly requested: PlanVector;
  /** The plan step that was taken, in metres: shorter than `requested` when blocked. */
  readonly applied: PlanVector;
  /**
   * Whether something shortened the step: a blocker on the plan, or a surface
   * the body could not reach. Turning and looking are never blocked.
   */
  readonly blocked: boolean;
  /** Change in absolute height over the step, in metres; positive climbing. */
  readonly climbed: number;
  /** Whether the step changed the storey. */
  readonly storeyChanged: boolean;
}

/**
 * Everything one storey offers a walker underfoot: the plan it walks on, and the
 * stair it climbs out of it.
 *
 * Two plan fields rather than one, because the stair bay is the one place where
 * the flat-floor model is wrong. Outside the bay the stair shaft is a hole and
 * belongs in `blockers`, exactly as `getWalkField` sweeps it; inside it the
 * flights and landings are floor, and what may be stood on is decided by height
 * ({@link Stairwell}) rather than by a rectangle. {@link getSurfaceField} picks
 * between them, and it picks by the point alone.
 */
export interface WalkSurface {
  /** Plan field outside the stair bay. */
  readonly field: WalkField;
  /** Plan field inside the bay, where the stairwell's footprints are floor, not blockers. */
  readonly bayField: WalkField;
  /**
   * This storey's stairwell, already capped at the storeys that exist
   * (`getStairwellEnds`), and measured from THIS storey's finished floor: its
   * levels are rises, on the same datum as {@link EyePose.rise}. A caller must
   * therefore rebuild the surface for the new storey whenever a step reports
   * {@link EyeStep.storeyChanged}.
   */
  readonly well: Stairwell;
  /** Storey pitch, in metres: the rise that promotes the walker. */
  readonly floorToFloor: number;
}

/**
 * Returns the plan field that bounds a body standing at a point.
 *
 * One rule, two consumers: the walker asks it to know what may stop its step,
 * and the follow camera asks it to know what may stop its pull-back, so the two
 * can never disagree about which model the body is in.
 *
 * It is a pure function of the point — is the point inside the bay grown by the
 * body radius? — rather than a flag raised on entering the stair and lowered on
 * leaving it, so there is nothing stateful to go stale, and a body teleported
 * into or out of the bay is bounded correctly on its very next frame. Growing by
 * the radius is what makes the changeover seamless: the field changes while the
 * body's edge is still a radius clear of the shaft, which is further than one
 * frame of walking.
 *
 * @param surface - The walking surface of the storey.
 * @param point - Where the body stands, in plan coordinates.
 * @param radius - Radius of the body on the plan, in metres.
 * @returns `surface.bayField` when the point is within `radius` of the bay,
 *   otherwise `surface.field`. One of the surface's own fields, never a copy.
 */
export function getSurfaceField(surface: WalkSurface, point: PlanPoint, radius: number): WalkField {
  return isNearStairwell(surface.well, point, radius) ? surface.bayField : surface.field;
}

/**
 * Advances the eye pose by one time step.
 *
 * The step is applied in this order:
 * 1. the time step is sanitised (`NaN` or non-positive becomes `0`) and capped at
 *    `config.maxStepSeconds`;
 * 2. yaw changes by the turn intent, then wraps into (−π, π];
 * 3. pitch changes by the look intent, then clamps to ±`config.maxPitch`;
 * 4. the plan step is measured along the forward/right vectors of the new yaw,
 *    with diagonal movement normalised so it is no faster than straight;
 * 5. that step is resolved against the field {@link getSurfaceField} picks for
 *    the point the body stands at, by `moveBody`, which stops the body at walls,
 *    holes and railings wherever they stand on the floor, and slides it along a
 *    face it has stopped against;
 * 6. the footing at the point that reaches is resolved. INSIDE the bay it is
 *    whatever surface of the stairwell is within reach of the rise the body is
 *    already at, and `undefined` — no surface in reach — refuses the step
 *    exactly as a wall would. OUTSIDE it there is only the floor plane, so the
 *    step is legal only when the body is already at the floor plane, within
 *    `well.reach` of it: **you step off a stair onto the floor plane only at the
 *    floor plane**, which is what keeps a body halfway up a flight from walking
 *    out of the shaft into mid-air;
 * 7. a refusal is retried x-only, then z-only, then held. That mirrors
 *    `moveBody`'s own x-then-z asymmetry, and it is what lets a body brushing
 *    the boundary of a flight slide along it instead of wedging against it;
 * 8. the rise is ASSIGNED from the surface reached, never integrated, so it
 *    cannot drift from the geometry under the feet;
 * 9. the storey is promoted at most once: a rise that has reached a whole
 *    `surface.floorToFloor` becomes the next floor up at the rise left over, and
 *    a rise that has fallen to a whole pitch below becomes the floor below. The
 *    body does not move: promotion is a change of datum, which is why
 *    {@link EyeStep.climbed} is continuous across it.
 *
 * Four of those details are a contract an automated caller relies on rather than
 * incidental behaviour, and must be preserved:
 *
 * - **the intent stays signed.** Every component is one of −1, 0, +1
 *   ({@link Axis}) and never gains a magnitude channel, so a route follower
 *   steers by naming the same signs a held key produces and the speed stays this
 *   module's;
 * - **the time step is sanitised and capped**, exactly as step 1 says, so a
 *   follower measuring progress off the pose runs on the same clock;
 * - **yaw is applied before the translation**, so a step that turns and walks at
 *   once walks along the heading it ends the step with;
 * - **the diagonal `move` + `strafe` combination stays normalised**, so a
 *   corrected step that walks and strafes at once is never faster than a
 *   straight one.
 *
 * When the move is fully blocked the returned `x` and `z` are the ones passed in,
 * unchanged: a blocked frame has to look like a blocked frame, because stuck
 * detection reads progress from the pose.
 *
 * @param pose - The current pose. Not mutated.
 * @param intent - The signed intent along each navigation axis. Source-agnostic:
 *   held keys, held on-screen pad buttons, or an automated route follower.
 * @param dtSeconds - Elapsed time since the previous step, in seconds.
 * @param surface - What the storey being walked offers underfoot: its two plan
 *   fields, its stairwell and its pitch. Built once outside the frame loop, and
 *   rebuilt for the new storey whenever a step reports `storeyChanged`.
 * @param config - Navigation tuning; defaults to {@link EYE_NAVIGATION_CONFIG}.
 * @returns A new {@link EyeStep}: the new pose, the step asked for, the step
 *   actually taken, whether anything shortened it, the height climbed and
 *   whether the storey changed.
 */
export function stepEyePose(
  pose: EyePose,
  intent: MovementIntent,
  dtSeconds: number,
  surface: WalkSurface,
  config: EyeNavigationConfig = EYE_NAVIGATION_CONFIG,
): EyeStep {
  const dt = clampStep(dtSeconds, config.maxStepSeconds);

  const yaw = wrapAngle(pose.yaw + intent.turn * config.turnSpeed * dt);
  const pitch = clampPitch(pose.pitch + intent.look * config.lookSpeed * dt, config.maxPitch);

  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const vectorX = -sinYaw * intent.move + cosYaw * intent.strafe;
  const vectorZ = -cosYaw * intent.move - sinYaw * intent.strafe;
  const length = Math.hypot(vectorX, vectorZ);
  const scale = (length > 1 ? 1 / length : 1) * config.walkSpeed * dt;

  const from: PlanPoint = { x: pose.x, z: pose.z };
  const move = moveBody(
    from,
    { x: vectorX * scale, z: vectorZ * scale },
    getSurfaceField(surface, from, config.bodyRadius),
    config.bodyRadius,
  );

  const footing = findFooting(surface, from, pose.rise, move.point);
  const applied: PlanVector = { x: footing.point.x - pose.x, z: footing.point.z - pose.z };
  const stack = promoteStorey(pose.floor, footing.rise, surface.floorToFloor);

  return {
    pose: { x: footing.point.x, z: footing.point.z, yaw, pitch, ...stack },
    requested: move.requested,
    applied,
    blocked:
      Math.abs(move.requested.x - applied.x) > LENGTH_TOLERANCE ||
      Math.abs(move.requested.z - applied.z) > LENGTH_TOLERANCE,
    // Read before the promotion, which moves the datum and not the body.
    climbed: footing.rise - pose.rise,
    storeyChanged: stack.floor !== pose.floor,
  };
}

/** Where a body would stand, and the rise it would stand at there. */
interface Footing {
  /** The stance, in plan coordinates. */
  readonly point: PlanPoint;
  /** The rise of the surface under it, in metres. */
  readonly rise: number;
}

/**
 * Returns the rise a body at a point would stand at, or `undefined` when it may
 * not stand there at all.
 *
 * The whole of the vertical rule, in one place. Inside the bay the stairwell
 * answers, from the rise the body is already at, and its refusal is passed
 * straight on: a surface out of reach is a surface the body may not step to.
 * Outside the bay there is one surface only, the storey's floor plane, and the
 * body may join it only from within reach of it.
 *
 * @param surface - The walking surface of the storey.
 * @param point - The stance being considered, in plan coordinates.
 * @param fromRise - The rise the body is at now, in metres.
 * @returns The rise of the surface the body would stand on, or `undefined` when
 *   nothing there is within `surface.well.reach` of `fromRise`.
 */
function getSurfaceRise(
  surface: WalkSurface,
  point: PlanPoint,
  fromRise: number,
): number | undefined {
  if (isNearStairwell(surface.well, point, BAY_ITSELF)) {
    return getStairFooting(surface.well, point, fromRise)?.rise;
  }
  return Math.abs(fromRise) <= surface.well.reach ? FLOOR_PLANE_RISE : undefined;
}

/**
 * Resolves the stance a step ends at: the candidate, or the best of its retries.
 *
 * The candidates are tried in `moveBody`'s own order — both axes, then x alone,
 * then z alone, then neither — so that a body whose full step would leave it
 * with nothing underfoot keeps whichever half of it is still standable and
 * slides along the boundary rather than wedging against it.
 *
 * @param surface - The walking surface of the storey.
 * @param from - Where the body stands now, in plan coordinates.
 * @param fromRise - The rise it stands at now, in metres.
 * @param to - Where the plan collision would put it.
 * @returns The first stance of the four with a surface under it. Should even
 *   standing still be refused — a body placed where it never could have walked —
 *   it holds its ground at the rise it already had, because a step must never
 *   leave the body somewhere it did not ask to go.
 */
function findFooting(
  surface: WalkSurface,
  from: PlanPoint,
  fromRise: number,
  to: PlanPoint,
): Footing {
  const candidates: readonly PlanPoint[] = [
    to,
    { x: to.x, z: from.z },
    { x: from.x, z: to.z },
    from,
  ];
  for (const point of candidates) {
    const rise = getSurfaceRise(surface, point, fromRise);
    if (rise !== undefined) {
      return { point, rise };
    }
  }
  return { point: from, rise: fromRise };
}

/**
 * Moves a body onto the next storey when it has climbed a whole one.
 *
 * At most one storey per step, and the arithmetic is exact at the boundary: a
 * rise of exactly one pitch leaves a rise of exactly `0` on the storey above, so
 * a walker arriving at the top of a flight stands on the finished floor it
 * arrived at rather than a rounding above it. The tolerance is there for the
 * flight whose top riser sums a hair short of the pitch, not to smudge the
 * boundary: one frame of the steepest run climbs 0.105 m, a million times
 * {@link LENGTH_TOLERANCE}.
 *
 * @param floor - The storey the body was on.
 * @param rise - The rise it has reached above that storey, in metres.
 * @param floorToFloor - The storey pitch, in metres.
 * @returns The storey and the rise to store: unchanged while the rise is inside
 *   the storey, one floor up or down with the pitch taken off or added on when
 *   it has reached the storey above or below.
 */
function promoteStorey(
  floor: number,
  rise: number,
  floorToFloor: number,
): { readonly floor: number; readonly rise: number } {
  if (rise >= floorToFloor - LENGTH_TOLERANCE) {
    return { floor: floor + STOREY_STEP, rise: rise - floorToFloor };
  }
  if (rise <= -floorToFloor + LENGTH_TOLERANCE) {
    return { floor: floor - STOREY_STEP, rise: rise + floorToFloor };
  }
  return { floor, rise };
}

/**
 * Puts a pose back inside a stack of `floorCount` storeys.
 *
 * The owner's rule for the floor-count stepper: **taking storeys away below the
 * viewer puts them on the new top storey, where they were standing on it.** The
 * plan position needs no thought, because every storey is the same floor — a
 * point standable on storey 7 is standable on storey 3 by construction — so x,
 * z, yaw and pitch are kept and only the storey changes. Nothing moves at all
 * when the stack still contains the viewer's storey.
 *
 * The exception is a viewer caught MID-FLIGHT, at a rise between two finished
 * floors. There is no plan position for them to keep: the point they are at is
 * over a flight of stairs, which is floor at their rise and thin air at the
 * storey's own. So they are returned to the arrival landing, the one place on
 * the plan every storey is entered at.
 *
 * @param pose - The pose to place. Not mutated.
 * @param floorCount - How many storeys the stack now has; clamped as
 *   `clampFloorCount` does.
 * @param arrival - The pose of the stairs arrival, used only for the mid-flight
 *   exception; its `x`, `z` and `yaw` are taken, and nothing else.
 * @returns `pose` itself, by identity, when it already stands on a storey of the
 *   stack; otherwise a new pose with `rise` exactly `0` and a floor inside
 *   `[1, floorCount]`, keeping the viewer's own pitch either way.
 * @throws RangeError when `floorCount` is not finite.
 */
export function placeInStack(pose: EyePose, floorCount: number, arrival: EyePose): EyePose {
  const storeys = clampFloorCount(floorCount);
  const floor = Math.min(Math.max(Math.round(pose.floor), MIN_FLOOR_COUNT), storeys);
  const standing = Math.abs(pose.rise - FLOOR_PLANE_RISE) <= LENGTH_TOLERANCE;
  if (standing && floor === pose.floor) {
    return pose;
  }
  const { x, z, yaw } = standing ? pose : arrival;
  return { x, z, yaw, pitch: pose.pitch, floor, rise: FLOOR_PLANE_RISE };
}

/** Maps a pair of opposite pressed states to a signed axis value. */
function toAxis(positive: boolean, negative: boolean): Axis {
  if (positive === negative) {
    return 0;
  }
  return positive ? 1 : -1;
}

/**
 * Sanitises a frame time into the time step the navigation will simulate.
 *
 * Exported because it is a rule, not a detail: anything that drives
 * {@link stepEyePose} and also keeps its own clock — a route follower timing how
 * long the body has failed to make progress — must measure the same seconds this
 * does, or the two disagree about how much of a long frame happened.
 *
 * @param dtSeconds - Elapsed time since the previous step, in seconds. May be
 *   `NaN`, negative or absurdly large; all three are handled.
 * @param maxStep - Longest step to simulate at once, in seconds, typically
 *   `EYE_NAVIGATION_CONFIG.maxStepSeconds`.
 * @returns `0` for `NaN` or a non-positive input, otherwise `dtSeconds` capped
 *   at `maxStep`.
 */
export function clampStep(dtSeconds: number, maxStep: number): number {
  if (!(dtSeconds > 0)) {
    return 0;
  }
  return Math.min(dtSeconds, maxStep);
}

/**
 * Wraps an angle, in radians, into (−π, π].
 *
 * The half-open range is the one {@link EyePose} yaw is declared in, and the one
 * shortest-turn arithmetic needs: a difference of two wrapped angles, wrapped
 * again, is the signed shortest way round. Exported so that anything steering a
 * yaw toward a target wraps it exactly as the navigation does.
 *
 * @param angle - The angle to wrap, in radians.
 * @returns The equivalent angle within (−π, π]; an angle already in that range
 *   is returned unchanged, and exactly π stays π.
 */
export function wrapAngle(angle: number): number {
  if (angle > -Math.PI && angle <= Math.PI) {
    return angle;
  }
  const offset = (((Math.PI - angle) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return Math.PI - offset;
}

/** Restricts a pitch, in radians, to the symmetric range [−`limit`, `limit`]. */
function clampPitch(pitch: number, limit: number): number {
  return Math.min(Math.max(pitch, -limit), limit);
}
