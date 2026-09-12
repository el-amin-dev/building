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
 * Where the body may go is not this module's business: a step is handed to
 * `collision.ts`, which stops it at whatever it runs into anywhere on the floor.
 */

import { moveBody } from './collision.ts';
import type { PlanVector, WalkField } from './collision.ts';
import { PERSON_SPEC } from './person.ts';

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

/** Position on the floor plan and orientation of the viewer's eye. */
export interface EyePose {
  /** Plan position along the width, in metres. */
  readonly x: number;
  /** Plan position along the depth, in metres. */
  readonly z: number;
  /** Rotation about +y, in radians, within (−π, π]. `0` looks toward −z. */
  readonly yaw: number;
  /** Rotation about x, in radians. Positive values look up. */
  readonly pitch: number;
}

/** The pitch of a level gaze: straight ahead, neither up nor down. */
const LEVEL_PITCH = 0;

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
 * @param arrival - Where the person lands and the heading they land with, in
 *   metres and radians. Not mutated.
 * @returns A new pose at the arrival point, with `pitch` level and the arrival
 *   yaw wrapped into (−π, π] so the {@link EyePose} invariant holds. A yaw
 *   already in that range is returned unchanged.
 */
export function createArrivalPose(arrival: {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}): EyePose {
  return { x: arrival.x, z: arrival.z, yaw: wrapAngle(arrival.yaw), pitch: LEVEL_PITCH };
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
  /** Whether a blocker shortened the step. Turning and looking are never blocked. */
  readonly blocked: boolean;
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
 * 5. that step is resolved against `field` by `moveBody`, which stops the body at
 *    walls, holes and railings wherever they stand on the floor, and slides it
 *    along a face it has stopped against.
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
 * @param field - The collision field of the storey being walked. Built once
 *   outside the frame loop (`collision.ts`); only its blockers are consulted.
 * @param config - Navigation tuning; defaults to {@link EYE_NAVIGATION_CONFIG}.
 * @returns A new {@link EyeStep}: the new pose, plus `moveBody`'s `requested`,
 *   `applied` and `blocked` passed straight through.
 */
export function stepEyePose(
  pose: EyePose,
  intent: MovementIntent,
  dtSeconds: number,
  field: WalkField,
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

  const move = moveBody(
    { x: pose.x, z: pose.z },
    { x: vectorX * scale, z: vectorZ * scale },
    field,
    config.bodyRadius,
  );

  return {
    pose: { x: move.point.x, z: move.point.z, yaw, pitch },
    requested: move.requested,
    applied: move.applied,
    blocked: move.blocked,
  };
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
