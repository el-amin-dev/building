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
 */

import type { PlanRect } from './planGeometry.ts';

/** A navigation command that a key can trigger. */
export type EyeAction =
  | 'moveForward'
  | 'moveBackward'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'lookUp'
  | 'lookDown';

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

/** A signed direction along one navigation axis: negative, none or positive. */
export type Axis = -1 | 0 | 1;

/**
 * What the viewer is currently asking for, one signed value per axis.
 *
 * Opposite keys held together cancel each other out to `0`.
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

/**
 * Derives the movement intent from the set of physical keys held down.
 *
 * Unknown key codes are ignored and opposite actions cancel to `0`.
 *
 * @param pressedCodes - The `KeyboardEvent.code` values currently pressed.
 * @returns The signed intent along each navigation axis.
 */
export function getMovementIntent(pressedCodes: ReadonlySet<string>): MovementIntent {
  const actions = new Set<EyeAction>();
  for (const code of pressedCodes) {
    if (isEyeNavigationKey(code)) {
      const action = EYE_KEY_BINDINGS[code];
      if (action !== undefined) {
        actions.add(action);
      }
    }
  }

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

/**
 * Creates the pose the viewer starts from: in the (maxX, maxZ) corner of the
 * walkable area, looking level toward the opposite (minX, minZ) corner.
 *
 * Starting in a corner facing the opposite corner puts two walls, the corner
 * between them, the floor and the ceiling in view on entry, instead of a blank
 * wall filling the view as it does from the centre facing a wall.
 *
 * @param bounds - The walkable rectangle for the eye position, already shrunk
 *   by the body radius (see {@link stepEyePose}).
 * @returns A new pose at (bounds.maxX, bounds.maxZ) with zero pitch and a yaw
 *   within (−π, π] whose forward vector points at (bounds.minX, bounds.minZ);
 *   yaw is `0` when the bounds have zero width and zero depth.
 */
export function createInitialEyePose(bounds: PlanRect): EyePose {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const yaw = width === 0 && depth === 0 ? 0 : wrapAngle(Math.atan2(width, depth));
  return { x: bounds.maxX, z: bounds.maxZ, yaw, pitch: 0 };
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
  /** Radius of the viewer's body on the plan, in metres, kept clear of walls. */
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
const BODY_RADIUS_METRES = 0.25;

/** Default tuning of the eye navigation. Frozen. */
export const EYE_NAVIGATION_CONFIG: EyeNavigationConfig = Object.freeze({
  walkSpeed: WALK_SPEED_METRES_PER_SECOND,
  turnSpeed: TURN_SPEED_DEGREES_PER_SECOND * RADIANS_PER_DEGREE,
  lookSpeed: LOOK_SPEED_DEGREES_PER_SECOND * RADIANS_PER_DEGREE,
  maxPitch: MAX_PITCH_DEGREES * RADIANS_PER_DEGREE,
  maxStepSeconds: MAX_STEP_SECONDS,
  bodyRadius: BODY_RADIUS_METRES,
});

/**
 * Advances the eye pose by one time step.
 *
 * The step is applied in this order:
 * 1. the time step is sanitised (`NaN` or negative becomes `0`) and capped at
 *    `config.maxStepSeconds`;
 * 2. yaw changes by the turn intent, then wraps into (−π, π];
 * 3. pitch changes by the look intent, then clamps to ±`config.maxPitch`;
 * 4. the plan position moves along the forward/right vectors of the new yaw,
 *    with diagonal movement normalised so it is no faster than straight;
 * 5. the position is clamped inside `bounds`.
 *
 * @param pose - The current pose. Not mutated.
 * @param intent - The signed intent along each navigation axis.
 * @param dtSeconds - Elapsed time since the previous step, in seconds.
 * @param bounds - The walkable rectangle for the eye position. The caller must
 *   already have shrunk it by `config.bodyRadius` so the body stays off walls.
 * @param config - Navigation tuning; defaults to {@link EYE_NAVIGATION_CONFIG}.
 * @returns A new pose.
 */
export function stepEyePose(
  pose: EyePose,
  intent: MovementIntent,
  dtSeconds: number,
  bounds: PlanRect,
  config: EyeNavigationConfig = EYE_NAVIGATION_CONFIG,
): EyePose {
  const dt = clampStep(dtSeconds, config.maxStepSeconds);

  const yaw = wrapAngle(pose.yaw + intent.turn * config.turnSpeed * dt);
  const pitch = clamp(
    pose.pitch + intent.look * config.lookSpeed * dt,
    -config.maxPitch,
    config.maxPitch,
  );

  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const vectorX = -sinYaw * intent.move + cosYaw * intent.strafe;
  const vectorZ = -cosYaw * intent.move - sinYaw * intent.strafe;
  const length = Math.hypot(vectorX, vectorZ);
  const scale = (length > 1 ? 1 / length : 1) * config.walkSpeed * dt;

  return {
    x: clamp(pose.x + vectorX * scale, bounds.minX, bounds.maxX),
    z: clamp(pose.z + vectorZ * scale, bounds.minZ, bounds.maxZ),
    yaw,
    pitch,
  };
}

/** Maps a pair of opposite pressed states to a signed axis value. */
function toAxis(positive: boolean, negative: boolean): Axis {
  if (positive === negative) {
    return 0;
  }
  return positive ? 1 : -1;
}

/** Sanitises a time step: `NaN` or non-positive gives `0`, capped at `maxStep`. */
function clampStep(dtSeconds: number, maxStep: number): number {
  if (!(dtSeconds > 0)) {
    return 0;
  }
  return Math.min(dtSeconds, maxStep);
}

/** Wraps an angle, in radians, into (−π, π]. */
function wrapAngle(angle: number): number {
  if (angle > -Math.PI && angle <= Math.PI) {
    return angle;
  }
  const offset = (((Math.PI - angle) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return Math.PI - offset;
}

/** Restricts a value to the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
