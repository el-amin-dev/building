/**
 * Keyboard-and-control navigation of the exterior orbit camera.
 *
 * The exterior view orbits a fixed pivot (the framing's `target`), so its pose is
 * spherical rather than a position and an orientation: an `azimuth` around the
 * pivot, a `polar` angle down from straight up, and a `distance` from the pivot.
 * This module owns that pose, the action vocabulary both input paths name, and the
 * per-frame step — exactly as `eyeNavigation.ts` does for the interior eye, and
 * deliberately in its shape.
 *
 * drei's `OrbitControls` cannot be driven from a key: its own key handling *pans*
 * (it moves `target`, which would destroy the derived framing pivot) and it exposes
 * no imperative rotate or tilt. So the camera stays the live authority — the pose is
 * read off it, stepped, and written back — and `OrbitControls` keeps pointer drag
 * and wheel. That only works if the spherical convention here is three.js's own, to
 * the letter:
 *
 * - `x = target.x + distance · sin(polar) · sin(azimuth)`
 * - `y = target.y + distance · cos(polar)`
 * - `z = target.z + distance · sin(polar) · cos(azimuth)`
 *
 * and inversely `distance = |p − target|`, `polar = acos((p.y − target.y) / distance)`,
 * `azimuth = atan2(p.x − target.x, p.z − target.z)`. So `azimuth` 0 puts the camera
 * out along +z (straight off the open side B), increasing `azimuth` turns it
 * counter-clockwise seen from above (a right-handed rotation about +y), `polar` 0 is
 * directly overhead and `polar` π/2 is level with the pivot.
 *
 * Angles are in radians, distances in metres. Every limit comes from the exterior
 * framing (`exteriorFraming.ts`) so the clamp here and the one on `OrbitControls`
 * are the same numbers and cannot fight.
 */

import type { Axis } from './eyeNavigation.ts';
import type { ExteriorFraming, Vector3Like } from './exteriorFraming.ts';

/**
 * Every navigation command of the exterior orbit, in HUD reading order: orbit, tilt, zoom.
 *
 * The actions are the vocabulary of the navigation: a physical key
 * ({@link ORBIT_KEY_BINDINGS}) and an on-screen control both name one of these, so
 * neither input path has to imitate the other. Frozen.
 */
export const ORBIT_ACTIONS = Object.freeze([
  'orbitLeft',
  'orbitRight',
  'tiltUp',
  'tiltDown',
  'zoomIn',
  'zoomOut',
] as const);

/** A navigation command of the orbit, triggered by a key or by an on-screen control. */
export type OrbitAction = (typeof ORBIT_ACTIONS)[number];

/**
 * Key bindings of the exterior orbit navigation, keyed by `KeyboardEvent.code` so that
 * they target physical keys regardless of the keyboard layout. Frozen.
 *
 * The arrow keys carry orbit and tilt: they are the keys a viewer reaches for to turn a
 * 3-D view, and the interior eye deliberately leaves them free (it binds letters, see
 * `EYE_KEY_BINDINGS`), so the two views never fight over a key. Zoom is bound twice —
 * on the main row and on the numeric keypad — because `Equal`/`Minus` are the keys the
 * zoom symbols are printed on, while `NumpadAdd`/`NumpadSubtract` are the ones reachable
 * one-handed.
 */
export const ORBIT_KEY_BINDINGS: Readonly<Record<string, OrbitAction>> = Object.freeze({
  ArrowLeft: 'orbitLeft',
  ArrowRight: 'orbitRight',
  ArrowUp: 'tiltUp',
  ArrowDown: 'tiltDown',
  Equal: 'zoomIn',
  Minus: 'zoomOut',
  NumpadAdd: 'zoomIn',
  NumpadSubtract: 'zoomOut',
});

/**
 * Tells whether a physical key is bound to an exterior orbit action.
 *
 * Only the bindings' own keys count, so inherited names such as `'toString'`
 * are rejected.
 *
 * @param code - A `KeyboardEvent.code` value, e.g. `'ArrowLeft'`.
 * @returns `true` when the key triggers an {@link OrbitAction}.
 */
export function isOrbitNavigationKey(code: string): boolean {
  return Object.hasOwn(ORBIT_KEY_BINDINGS, code);
}

/** The action a physical key triggers, or `undefined` when it is not bound. */
function getOrbitAction(code: string): OrbitAction | undefined {
  return isOrbitNavigationKey(code) ? ORBIT_KEY_BINDINGS[code] : undefined;
}

/**
 * What the viewer is currently asking the orbit for, one signed value per axis.
 *
 * Opposite keys held together cancel each other out to `0`.
 */
export interface OrbitIntent {
  /** `+1` orbits left (azimuth increases), `−1` orbits right. */
  readonly orbit: Axis;
  /** `+1` tilts up toward overhead (polar decreases), `−1` tilts down toward level. */
  readonly tilt: Axis;
  /** `+1` zooms in (distance shrinks), `−1` zooms out. */
  readonly zoom: Axis;
}

/** No action at all: the default second argument of {@link getOrbitIntent}. Read-only. */
const NO_ACTIONS: ReadonlySet<OrbitAction> = new Set<OrbitAction>();

/**
 * Derives the orbit intent from the actions currently being asked for.
 *
 * This is the single rule both input paths share: the keyboard maps its held keys to
 * actions, an on-screen control names them directly. Values that are not
 * {@link OrbitAction}s are ignored, duplicates make no difference and opposite actions
 * cancel to `0`.
 *
 * @param actions - The actions being asked for, in any order and with any repetitions.
 * @returns The signed intent along each orbit axis.
 */
export function getOrbitIntentFromActions(actions: Iterable<OrbitAction>): OrbitIntent {
  return toIntent(new Set(actions));
}

/**
 * Derives the orbit intent from the physical keys held down, plus any actions asked for
 * by another input (e.g. the on-screen orbit pad).
 *
 * Unknown key codes are ignored, an action asked for by both inputs counts once and
 * opposite actions cancel to `0`. Whether a key event counted at all — modifiers,
 * repeats, focus — is the caller's business (`usePressedKeys`), not this module's.
 *
 * @param pressedCodes - The `KeyboardEvent.code` values currently pressed.
 * @param extraActions - Actions held outside the keyboard; none by default.
 * @returns The signed intent along each orbit axis.
 */
export function getOrbitIntent(
  pressedCodes: ReadonlySet<string>,
  extraActions: Iterable<OrbitAction> = NO_ACTIONS,
): OrbitIntent {
  const actions = new Set<OrbitAction>(extraActions);
  for (const code of pressedCodes) {
    const action = getOrbitAction(code);
    if (action !== undefined) {
      actions.add(action);
    }
  }

  return toIntent(actions);
}

/** Reduces the held actions to one signed value per orbit axis. */
function toIntent(actions: ReadonlySet<OrbitAction>): OrbitIntent {
  return {
    orbit: toAxis(actions.has('orbitLeft'), actions.has('orbitRight')),
    tilt: toAxis(actions.has('tiltUp'), actions.has('tiltDown')),
    zoom: toAxis(actions.has('zoomIn'), actions.has('zoomOut')),
  };
}

/** Where the exterior camera sits on the sphere around the orbit target. */
export interface OrbitPose {
  /** Heading around the target, in radians, within (−π, π]. `0` is out along +z. */
  readonly azimuth: number;
  /** Angle down from straight up, in radians. `0` is overhead, `π/2` is level. */
  readonly polar: number;
  /** Distance from the orbit target, in metres. */
  readonly distance: number;
}

/** How far the orbit pose may travel along each axis. */
export interface OrbitLimits {
  /** Closest the camera may come to the target, in metres. */
  readonly minDistance: number;
  /** Furthest the camera may go from the target, in metres. */
  readonly maxDistance: number;
  /** Smallest polar angle, in radians: how close to straight overhead the tilt may go. */
  readonly minPolar: number;
  /** Largest polar angle, in radians: how close to level with the target the tilt may go. */
  readonly maxPolar: number;
}

/** Tuning of the exterior orbit navigation. */
export interface OrbitNavigationConfig {
  /** Orbiting (azimuth) speed, in radians per second. */
  readonly orbitSpeed: number;
  /** Tilting (polar) speed, in radians per second. */
  readonly tiltSpeed: number;
  /** Zoom rate, in e-folds of distance per second. */
  readonly zoomRate: number;
  /** Longest time step simulated at once, in seconds, to absorb frame hitches. */
  readonly maxStepSeconds: number;
}

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;
const FULL_TURN = 2 * Math.PI;
const HALF = 0.5;

/** Polar angle of a camera level with the orbit target: a quarter turn down from overhead. */
const POLAR_AT_HORIZON = Math.PI * HALF;

/**
 * Orbiting speed, in degrees per second: a full turn around the building in six seconds.
 *
 * Slow enough to read the facade going past, quick enough that reaching the opposite side
 * is three seconds of holding a key rather than a chore.
 */
const ORBIT_SPEED_DEGREES_PER_SECOND = 60;

/**
 * Tilting speed, in degrees per second: level to overhead in two seconds.
 *
 * Slower than the orbit because the tilt range is a quarter turn where the orbit's is a
 * full one, so the same key-hold covers a comparable share of each range.
 */
const TILT_SPEED_DEGREES_PER_SECOND = 45;

/**
 * Zoom rate, in e-folds of distance per second.
 *
 * Zoom is multiplicative — a second of zooming in scales the distance by `e^−0.8`, about
 * 0.45 — so a step feels the same size when the whole floor is in frame as when one room
 * is. At this rate crossing the framing's whole zoom range (`maxDistance` is eight times
 * `minDistance`) takes `ln(8) / 0.8`, a little over two and a half seconds.
 */
const ZOOM_RATE_PER_SECOND = 0.8;

/** Same frame-hitch cap as the interior eye: see `EYE_NAVIGATION_CONFIG.maxStepSeconds`. */
const MAX_STEP_SECONDS = 0.1;

/** Default tuning of the exterior orbit navigation. Frozen. */
export const ORBIT_NAVIGATION_CONFIG: OrbitNavigationConfig = Object.freeze({
  orbitSpeed: ORBIT_SPEED_DEGREES_PER_SECOND * RADIANS_PER_DEGREE,
  tiltSpeed: TILT_SPEED_DEGREES_PER_SECOND * RADIANS_PER_DEGREE,
  zoomRate: ZOOM_RATE_PER_SECOND,
  maxStepSeconds: MAX_STEP_SECONDS,
});

/**
 * How far above level with the orbit target the tilt stops, in radians, so the camera
 * never swings under the building and looks up through the ground plane.
 */
export const ORBIT_GROUND_CLEARANCE_RADIANS = 0.05;

/**
 * How far off straight overhead the tilt stops, in radians.
 *
 * At the zenith the camera's view direction is parallel to its own up axis, so the
 * heading it is looking from is undefined and a `lookAt` flips the frame; stopping just
 * short keeps the azimuth meaningful at the top of the range.
 */
export const ORBIT_ZENITH_CLEARANCE_RADIANS = 0.05;

/**
 * Derives the limits of the orbit pose from the exterior framing.
 *
 * The distances are the framing's own (`exteriorFraming.ts` derives them from the plot,
 * the heights, the field of view and the live aspect ratio), so this module holds no
 * distance of its own and the domain clamp is numerically the clamp `OrbitControls` is
 * given. The angular limits are the two clearances, measured from overhead and from
 * level with the target.
 *
 * @param framing - The exterior framing of the floor.
 * @returns The limits of the orbit pose; a fresh object.
 */
export function getOrbitLimits(framing: ExteriorFraming): OrbitLimits {
  return {
    minDistance: framing.minDistance,
    maxDistance: framing.maxDistance,
    minPolar: ORBIT_ZENITH_CLEARANCE_RADIANS,
    maxPolar: POLAR_AT_HORIZON - ORBIT_GROUND_CLEARANCE_RADIANS,
  };
}

/**
 * Advances the orbit pose by one time step.
 *
 * The step is applied in this order:
 * 1. the time step is sanitised (`NaN` or non-positive becomes `0`) and capped at
 *    `config.maxStepSeconds`, exactly as `stepEyePose` does it;
 * 2. the azimuth changes by the orbit intent, then wraps into (−π, π];
 * 3. the polar angle changes by the tilt intent — tilting up *decreases* it, since it is
 *    measured down from overhead — then clamps to [`limits.minPolar`, `limits.maxPolar`];
 * 4. the distance is *scaled* by `exp(−zoom · config.zoomRate · dt)`, so zooming in
 *    shrinks it by the same proportion per second whatever it currently is, then clamps
 *    to [`limits.minDistance`, `limits.maxDistance`].
 *
 * @param pose - The current pose. Not mutated.
 * @param intent - The signed intent along each orbit axis.
 * @param dtSeconds - Elapsed time since the previous step, in seconds.
 * @param limits - How far the pose may travel; see {@link getOrbitLimits}.
 * @param config - Navigation tuning; defaults to {@link ORBIT_NAVIGATION_CONFIG}.
 * @returns A new pose.
 */
export function stepOrbitPose(
  pose: OrbitPose,
  intent: OrbitIntent,
  dtSeconds: number,
  limits: OrbitLimits,
  config: OrbitNavigationConfig = ORBIT_NAVIGATION_CONFIG,
): OrbitPose {
  const dt = clampStep(dtSeconds, config.maxStepSeconds);

  return {
    azimuth: wrapAngle(pose.azimuth + intent.orbit * config.orbitSpeed * dt),
    polar: clamp(
      pose.polar - intent.tilt * config.tiltSpeed * dt,
      limits.minPolar,
      limits.maxPolar,
    ),
    distance: clamp(
      pose.distance * Math.exp(-intent.zoom * config.zoomRate * dt),
      limits.minDistance,
      limits.maxDistance,
    ),
  };
}

/**
 * Brings a pose back inside the limits.
 *
 * The camera is the live authority on the exterior pose, and pointer drag and wheel move
 * it without asking this module; a resize also re-derives the framing, so the limits can
 * move under a pose that was legal a frame ago. This is the one place that reconciles
 * them: it wraps the azimuth into (−π, π] and clamps the polar angle and the distance.
 *
 * @param pose - The pose to reconcile. Not mutated.
 * @param limits - How far the pose may travel.
 * @returns A new pose inside `limits`.
 */
export function clampOrbitPose(pose: OrbitPose, limits: OrbitLimits): OrbitPose {
  return {
    azimuth: wrapAngle(pose.azimuth),
    polar: clamp(pose.polar, limits.minPolar, limits.maxPolar),
    distance: clamp(pose.distance, limits.minDistance, limits.maxDistance),
  };
}

/**
 * Places the camera in scene space from its orbit pose.
 *
 * Uses the three.js spherical convention to the letter (see the module comment), so a
 * position written to the camera and then read back by `OrbitControls.update()` is the
 * same point.
 *
 * @param target - The orbit pivot, in metres.
 * @param pose - Where the camera sits on the sphere around it.
 * @returns The camera position, in metres; a fresh object.
 */
export function getOrbitPosition(target: Vector3Like, pose: OrbitPose): Vector3Like {
  const sinPolar = Math.sin(pose.polar);
  return {
    x: target.x + pose.distance * sinPolar * Math.sin(pose.azimuth),
    y: target.y + pose.distance * Math.cos(pose.polar),
    z: target.z + pose.distance * sinPolar * Math.cos(pose.azimuth),
  };
}

/**
 * Reads the orbit pose off a camera position: the inverse of {@link getOrbitPosition}.
 *
 * @param target - The orbit pivot, in metres.
 * @param position - The camera position, in metres.
 * @returns The pose, with the azimuth within (−π, π]. A camera sitting exactly on the
 *   target has no heading at all, so that degenerate case gives the level pose out along
 *   +z at distance `0`.
 */
export function getOrbitPose(target: Vector3Like, position: Vector3Like): OrbitPose {
  const offsetX = position.x - target.x;
  const offsetY = position.y - target.y;
  const offsetZ = position.z - target.z;
  const distance = Math.hypot(offsetX, offsetY, offsetZ);
  if (distance === 0) {
    return { azimuth: 0, polar: POLAR_AT_HORIZON, distance: 0 };
  }

  return {
    azimuth: wrapAngle(Math.atan2(offsetX, offsetZ)),
    polar: Math.acos(clamp(offsetY / distance, -1, 1)),
    distance,
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
