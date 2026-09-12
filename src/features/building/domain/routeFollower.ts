/**
 * Steering controller that walks a list of waypoints.
 *
 * The follower is not a mover. It reads the walker's pose and returns a
 * {@link MovementIntent} whose components are only −1, 0 or +1 — the very same
 * vocabulary a held key or an on-screen control produces (`eyeNavigation.ts`).
 * Something else (`stepEyePose` plus the floor collision) decides what that
 * intent actually achieves, and the follower learns the outcome from the next
 * frame's pose. That is why it can never push the body through a wall, and why
 * *stuck* is its only failure mode: it has no position to write and no geometry
 * to consult, so a refused step simply shows up as a pose that did not change.
 *
 * Coordinates are in metres and angles in radians, with the conventions of
 * `eyeNavigation.ts`: the plan lies on `x`/`z`, yaw 0 looks toward −z,
 * increasing yaw turns left, forward is `(−sin yaw, −cos yaw)` and right is
 * `(cos yaw, −sin yaw)`. Yaw and every heading error are wrapped into (−π, π],
 * so an error is always measured the shortest way round, including across the
 * ±π seam.
 *
 * ## Turn, then go
 *
 * Turning and walking at the same time arcs the walker into doorways, and a
 * doorway has very little to spare: a 0.90 m door leaves 0.20 m of slack for a
 * 0.25 m body radius, a 0.60 m cubicle door only 0.05 m. So each leg is walked
 * in two stages — turn on the spot onto the leg's bearing, then walk it — with
 * hysteresis between them ({@link RouteFollowerConfig.headingEnter} to start
 * walking, the wider {@link RouteFollowerConfig.headingExit} to stop) so the
 * controller cannot flap between the two on a borderline error.
 *
 * A leg is a *line*, not just a point: its bearing runs from `legOrigin` to the
 * target waypoint, and while walking the follower both holds that bearing
 * (`turn`) and closes any sideways drift off the line (`strafe`). The
 * cross-track term is what makes narrow doors passable. A waypoint counts as
 * reached anywhere within {@link RouteFollowerConfig.arrivalRadius}, so a
 * walker running along a corridor can stop up to that radius short of a
 * doorway's outer approach point; on the crossing leg that shortfall is a
 * *lateral* error instead, and the first 0.30 m of the crossing is still
 * outside the wall, during which the strafe closes it while the walker
 * advances.
 *
 * A waypoint counts as reached either within {@link RouteFollowerConfig.arrivalRadius} or once
 * the walker has passed its foot along the leg's line (see {@link isReached}). The radius alone is
 * only a *sample* of a disc the walker flies through: at the longest frame the navigation counts,
 * one step is wider than the chord across that disc, so a sample can be stepped clean over — and a
 * missed sample is unrecoverable, because the bearing is fixed at `legOrigin` and the walker never
 * re-aims, so it would march on down the old line until the stall clock declared it blocked. The
 * along-track projection is monotone in forward progress, so once it has passed the foot it stays
 * passed and no frame rate can skip it. At most one waypoint is consumed per frame, so a run of
 * degenerate legs cannot collapse a whole route in a single step.
 *
 * ## Why the tolerances are sized differently
 *
 * The two *position* tolerances (`arrivalRadius`, `lateralDeadband`) are sized
 * for a nominal 30 fps frame, not the worst-case frame. Sizing them for the
 * worst case would give `walkSpeed × maxStepSeconds` = 0.14 m, wider than the
 * 0.05 m of slack a 0.60 m cubicle door leaves — narrow doors would be
 * unpassable by construction. The *heading* tolerances are sized for the
 * worst-case frame instead, because once cross-track correction exists a coarse
 * heading costs nothing: the strafe cleans up whatever the heading leaves.
 *
 * ## Being stuck
 *
 * Progress is judged per leg: the closest approach so far (`bestDistance`) and
 * the time since it last improved (`stalledSeconds`). The clock is measured in
 * *seconds*, not frames, because a frame count would give a 144 Hz machine a
 * quarter of the patience of a 30 Hz one; and the time step is sanitised
 * exactly as `stepEyePose` sanitises it, so the stall clock and the body's
 * motion can never disagree about how long a frame was. That is what stops a
 * ten-second tab-away frame from instantly declaring the walk stuck. The clock
 * runs only while walking: turning cannot be blocked, because `stepEyePose`
 * applies yaw before translation and never clamps it.
 */

import { clampStep, EYE_NAVIGATION_CONFIG, wrapAngle } from './eyeNavigation.ts';
import type { Axis, EyeNavigationConfig, EyePose, MovementIntent } from './eyeNavigation.ts';
import { LENGTH_TOLERANCE } from './planGeometry.ts';
import type { PlanPoint } from './planGeometry.ts';

/**
 * What the follower is doing.
 *
 * `turning` and `walking` are the two stages of a leg; `arrived` and `blocked`
 * are terminal (see {@link isRouteFollowerDone}) and both emit no intent.
 */
export type RouteFollowerPhase = 'turning' | 'walking' | 'arrived' | 'blocked';

/** Progress along a route. Immutable: every step returns a new one. */
export interface RouteFollowerState {
  /** The route being walked, in order. Frozen copy of the list given to {@link createRouteFollower}. */
  readonly waypoints: readonly PlanPoint[];
  /** Index of the waypoint being walked to; equals `waypoints.length` once arrived. */
  readonly index: number;
  /** What the follower is doing. */
  readonly phase: RouteFollowerPhase;
  /** Where the current leg began, in metres: the origin of its bearing and its line. */
  readonly legOrigin: PlanPoint;
  /** Closest approach to `waypoints[index]` so far on this leg, in metres. */
  readonly bestDistance: number;
  /** Time since `bestDistance` last improved, in seconds, counted only while walking. */
  readonly stalledSeconds: number;
}

/** One step of the follower: the new progress, and what to ask the body to do. */
export interface RouteFollowerStep {
  /** Progress after this step. */
  readonly state: RouteFollowerState;
  /** What to ask the body to do this frame. */
  readonly intent: MovementIntent;
}

/** Tuning of the route follower. Every value is derived from an {@link EyeNavigationConfig}. */
export interface RouteFollowerConfig {
  /** Distance at which a waypoint counts as reached, in metres. */
  readonly arrivalRadius: number;
  /** Sideways drift off the leg's line tolerated without strafing, in metres. */
  readonly lateralDeadband: number;
  /** Heading error tolerated while walking without correcting, in radians. */
  readonly headingDeadband: number;
  /** Heading error at or below which turning becomes walking, in radians. */
  readonly headingEnter: number;
  /** Heading error above which walking returns to turning, in radians. */
  readonly headingExit: number;
  /** Improvement in closest approach that counts as progress, in metres. */
  readonly stallProgress: number;
  /** Time without progress after which the walk is declared blocked, in seconds. */
  readonly stallSeconds: number;
  /** Longest time step counted at once, in seconds. Mirrors `EyeNavigationConfig.maxStepSeconds`. */
  readonly maxStepSeconds: number;
}

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;

/** The slowest frame rate the position tolerances are sized for, in frames per second. */
const NOMINAL_FRAMES_PER_SECOND = 30;
/** Duration of that nominal frame, in seconds: the step length the position tolerances assume. */
const NOMINAL_FRAME_SECONDS = 1 / NOMINAL_FRAMES_PER_SECOND;
/**
 * Arrival radius, in nominal steps: `arrivalRadius = walkSpeed × NOMINAL_FRAME_SECONDS × 1.7`
 * ≈ 0.079 m. More than one step, so the walker cannot stride clean across the arrival disc and
 * miss the waypoint; well under the 0.20 m of slack a 0.90 m door leaves, so stopping short of a
 * doorway's approach point still leaves the crossing passable.
 */
const ARRIVAL_STEP_FACTOR = 1.7;
/**
 * Lateral deadband, in nominal diagonal steps:
 * `lateralDeadband = walkSpeed / √2 × NOMINAL_FRAME_SECONDS × 1.2` ≈ 0.040 m. Wider than the
 * sideways distance one diagonal step covers, so the strafe cannot oscillate about the line, and
 * inside the 0.05 m of slack a 0.60 m cubicle door leaves.
 */
const LATERAL_STEP_FACTOR = 1.2;
/**
 * Heading deadband, in worst-case turning steps:
 * `headingDeadband = turnSpeed × maxStepSeconds × 1.1` ≈ 9.9°. Sized for the worst-case frame
 * rather than the nominal one: a coarse heading costs nothing once the strafe closes the
 * resulting drift, and a deadband narrower than one turning step would make the yaw hunt.
 */
const HEADING_STEP_FACTOR = 1.1;
/** Entry threshold, as a multiple of the deadband: `headingEnter = headingDeadband × 1.2` ≈ 11.9°. */
const HEADING_ENTER_FACTOR = 1.2;
/**
 * Heading error above which walking returns to turning, in degrees.
 *
 * Far wider than {@link HEADING_ENTER_FACTOR}'s threshold, which is the hysteresis: a walker
 * holding its line within a few degrees can never flap back into turning. At 45° the walker's own
 * right vector is still within 45° of the leg line's right vector, so a strafe chosen from the
 * cross-track sign always has a positive component toward the line — which is what makes the
 * correction converge for every heading error the walking phase permits.
 */
const HEADING_EXIT_DEGREES = 45;
/**
 * Improvement in closest approach that counts as progress, in metres.
 *
 * Coarse on purpose: a walker making real headway covers this in a fraction of a frame, while a
 * body grinding along a wall does not, so the test separates the two without being fooled by the
 * last bits of floating-point noise in a position.
 */
const STALL_PROGRESS_METRES = 0.02;
/**
 * Time without progress after which the walk is declared blocked, in seconds.
 *
 * Long enough to cover a turn on the spot plus a doorway squeeze, short enough that a walker
 * wedged on a corner gives up while the viewer is still watching.
 */
const STALL_SECONDS = 1.5;
/**
 * Speed divisor of a walker moving forward and strafing at once: `stepEyePose` normalises a
 * diagonal so it is no faster than a straight walk, leaving `walkSpeed / √2` on each axis.
 */
const DIAGONAL_SPEED_DIVISOR = Math.SQRT2;

/** No action at all: the intent of every terminal phase. Frozen. */
const IDLE_INTENT: MovementIntent = Object.freeze({ move: 0, strafe: 0, turn: 0, look: 0 });

/**
 * Derives the follower's tolerances from the navigation tuning.
 *
 * Nothing here is a free parameter: every tolerance is a stated multiple of a distance or angle
 * the walker actually covers in one frame (see the module documentation for why the position and
 * heading tolerances assume different frames).
 *
 * @param navigation - Navigation tuning; defaults to {@link EYE_NAVIGATION_CONFIG}.
 * @returns Frozen follower tuning.
 */
export function createRouteFollowerConfig(
  navigation: EyeNavigationConfig = EYE_NAVIGATION_CONFIG,
): RouteFollowerConfig {
  const nominalStep = navigation.walkSpeed * NOMINAL_FRAME_SECONDS;
  const headingDeadband = navigation.turnSpeed * navigation.maxStepSeconds * HEADING_STEP_FACTOR;
  return Object.freeze({
    arrivalRadius: nominalStep * ARRIVAL_STEP_FACTOR,
    lateralDeadband: (nominalStep / DIAGONAL_SPEED_DIVISOR) * LATERAL_STEP_FACTOR,
    headingDeadband,
    headingEnter: headingDeadband * HEADING_ENTER_FACTOR,
    headingExit: HEADING_EXIT_DEGREES * RADIANS_PER_DEGREE,
    stallProgress: STALL_PROGRESS_METRES,
    stallSeconds: STALL_SECONDS,
    maxStepSeconds: navigation.maxStepSeconds,
  });
}

/** Default tuning of the route follower, derived from {@link EYE_NAVIGATION_CONFIG}. Frozen. */
export const ROUTE_FOLLOWER_CONFIG: RouteFollowerConfig = createRouteFollowerConfig();

/**
 * Starts following a route from a pose.
 *
 * Waypoints the walker is already standing on — anything within
 * `config.arrivalRadius`, counted from the front of the list — are consumed
 * straight away, without computing a bearing toward them. A route that is empty,
 * or whose every waypoint is already reached, therefore comes back `'arrived'`,
 * so a caller can tell there is nothing to walk without stepping first.
 *
 * @param waypoints - The route, in order. Copied and frozen; not mutated.
 * @param pose - The walker's current pose. Not mutated.
 * @param config - Follower tuning; defaults to {@link ROUTE_FOLLOWER_CONFIG}.
 * @returns Progress at the start of the route.
 */
export function createRouteFollower(
  waypoints: readonly PlanPoint[],
  pose: EyePose,
  config: RouteFollowerConfig = ROUTE_FOLLOWER_CONFIG,
): RouteFollowerState {
  const route: readonly PlanPoint[] = Object.freeze([...waypoints]);
  const started: RouteFollowerState = {
    waypoints: route,
    index: 0,
    phase: 'turning',
    legOrigin: { x: pose.x, z: pose.z },
    bestDistance: route.length > 0 ? distanceTo(route[0], pose) : 0,
    stalledSeconds: 0,
  };
  const reached = consumeReached(started, pose, config.arrivalRadius);
  return reached.index >= route.length ? { ...reached, phase: 'arrived' } : reached;
}

/**
 * Advances the follower by one frame.
 *
 * The step is decided in this order:
 * 1. a terminal state returns itself and no intent — `'blocked'` is never re-planned;
 * 2. the time step is sanitised exactly as `stepEyePose` sanitises it (`NaN` or non-positive
 *    becomes `0`, then capped at `config.maxStepSeconds`);
 * 3. at most one waypoint is consumed — the target counts as reached when it is within
 *    `config.arrivalRadius` or when the walker has passed its foot along the leg (see
 *    {@link isReached}) — resetting the leg's origin, closest approach and stall clock; running
 *    out of waypoints is `'arrived'`;
 * 4. the leg's bearing (from `legOrigin` to the target) is compared with the walker's yaw the
 *    shortest way round, and the hysteresis decides turning or walking;
 * 5. turning emits `turn` alone; walking emits `move: +1` plus a `turn` to hold the bearing and a
 *    `strafe` to close any drift off the leg's line;
 * 6. while walking, progress is judged and the stall clock advanced; out of patience is
 *    `'blocked'`.
 *
 * `look` is always `0` — following a route never moves the walker's eyes — and `move` is never
 * `−1`: a person walks forward, and a mannequin reversing across a room in third-person view
 * reads as broken, so a waypoint behind the walker is turned toward, not backed along.
 *
 * Pure: the same state and pose always give the same result, and neither argument is mutated.
 *
 * @param state - Progress so far. Not mutated.
 * @param pose - The walker's pose this frame, the only report of what the previous intent
 *   achieved. Not mutated.
 * @param dtSeconds - Elapsed time since the previous step, in seconds.
 * @param config - Follower tuning; defaults to {@link ROUTE_FOLLOWER_CONFIG}.
 * @returns The new progress and the intent to apply this frame.
 */
export function stepRouteFollower(
  state: RouteFollowerState,
  pose: EyePose,
  dtSeconds: number,
  config: RouteFollowerConfig = ROUTE_FOLLOWER_CONFIG,
): RouteFollowerStep {
  if (isRouteFollowerDone(state)) {
    return { state, intent: IDLE_INTENT };
  }

  const dt = clampStep(dtSeconds, config.maxStepSeconds);
  const reached = consumeReached(state, pose, config.arrivalRadius);
  if (reached.index >= reached.waypoints.length) {
    return { state: { ...reached, phase: 'arrived' }, intent: IDLE_INTENT };
  }

  const target = reached.waypoints[reached.index];
  const error = wrapAngle(getLegBearing(reached.legOrigin, target, pose) - pose.yaw);
  const absError = Math.abs(error);
  const walking =
    reached.phase === 'walking' ? absError <= config.headingExit : absError <= config.headingEnter;

  if (!walking) {
    // The stall clock is carried over untouched rather than reset, so a walker that flaps
    // between the two stages of a leg cannot outrun being declared blocked.
    return {
      state: { ...reached, phase: 'turning' },
      intent: { move: 0, strafe: 0, turn: toAxis(error), look: 0 },
    };
  }

  const distance = distanceTo(target, pose);
  const improved = distance < reached.bestDistance - config.stallProgress;
  const bestDistance = improved ? distance : reached.bestDistance;
  const stalledSeconds = improved ? 0 : reached.stalledSeconds + dt;
  if (stalledSeconds >= config.stallSeconds) {
    return {
      state: { ...reached, phase: 'blocked', bestDistance, stalledSeconds },
      intent: IDLE_INTENT,
    };
  }

  const crossTrack = getCrossTrack(reached.legOrigin, target, pose);
  return {
    state: { ...reached, phase: 'walking', bestDistance, stalledSeconds },
    intent: {
      move: 1,
      strafe: Math.abs(crossTrack) > config.lateralDeadband ? toAxis(-crossTrack) : 0,
      turn: absError > config.headingDeadband ? toAxis(error) : 0,
      look: 0,
    },
  };
}

/**
 * Whether the follower has finished with this route, for better or worse.
 *
 * @param state - Progress so far.
 * @returns `true` for `'arrived'` and for `'blocked'`, the two terminal phases.
 */
export function isRouteFollowerDone(state: RouteFollowerState): boolean {
  return state.phase === 'arrived' || state.phase === 'blocked';
}

/**
 * Whether an intent asks for anything at all.
 *
 * This is the manual-input test the frame loop uses to cancel a walk: the moment the viewer's own
 * keys or on-screen controls ask for something, the route being followed is abandoned rather than
 * fought with.
 *
 * @param intent - The intent to test.
 * @returns `true` when any axis is non-zero.
 */
export function hasAnyInput(intent: MovementIntent): boolean {
  return intent.move !== 0 || intent.strafe !== 0 || intent.turn !== 0 || intent.look !== 0;
}

/**
 * Consumes the waypoint at `state.index` when the walker has reached it.
 *
 * At most one waypoint per call, so a run of degenerate legs cannot collapse a whole route in a
 * single frame. No bearing is computed for a consumed waypoint, which is what lets an empty route,
 * a duplicated waypoint and a walker already standing on its target all be handled by the same
 * path. When one is consumed, the new leg starts from the walker's present position with a fresh
 * closest approach and stall clock, and the phase returns to `'turning'` because the new leg has a
 * new bearing to face.
 *
 * @returns `state` itself when nothing was consumed, otherwise a new state. The phase of a state
 *   whose index has run off the end of the route is left to the caller to settle.
 */
function consumeReached(
  state: RouteFollowerState,
  pose: EyePose,
  arrivalRadius: number,
): RouteFollowerState {
  const { waypoints, index } = state;
  if (index >= waypoints.length) {
    return state;
  }
  if (!isReached(state.legOrigin, waypoints[index], pose, arrivalRadius)) {
    return state;
  }
  const next = index + 1;
  const done = next >= waypoints.length;
  return {
    waypoints,
    index: next,
    phase: done ? 'arrived' : 'turning',
    legOrigin: { x: pose.x, z: pose.z },
    bestDistance: done ? 0 : distanceTo(waypoints[next], pose),
    stalledSeconds: 0,
  };
}

/**
 * Whether the walker has reached the target of the leg it is walking.
 *
 * Either of two tests counts:
 *
 * - it is **within `arrivalRadius`** of the target, the ordinary case; or
 * - it has **passed the target's foot**, meaning the projection of its position onto the leg's
 *   line has reached the far end of the leg.
 *
 * The second test is what makes arrival safe at every frame rate. The radius alone is a *sample*
 * of a disc the walker flies through, and a long frame can step clean over it: one worst-case step
 * is `walkSpeed × maxStepSeconds` while the chord across the disc at the full lateral deadband is
 * narrower than that. A missed sample is not a near miss but a lost walk, because the leg's
 * bearing is fixed at `legOrigin` and is never re-aimed: the walker would march on down the old
 * line, its distance growing, until the stall clock declared it blocked a metre or two past the
 * waypoint it had all but touched. The along-track projection, by contrast, only ever increases as
 * the walker advances, so once it has passed the foot it stays passed and no frame rate can skip
 * it.
 *
 * A leg with no length left to speak of has no foot to pass; the radius test has already caught
 * that case, since the walker stands on both ends of it.
 */
function isReached(
  legOrigin: PlanPoint,
  target: PlanPoint,
  pose: EyePose,
  arrivalRadius: number,
): boolean {
  if (distanceTo(target, pose) <= arrivalRadius) {
    return true;
  }
  const dx = target.x - legOrigin.x;
  const dz = target.z - legOrigin.z;
  const legLength = Math.hypot(dx, dz);
  if (!(legLength > LENGTH_TOLERANCE)) {
    return false;
  }
  const alongTrack = ((pose.x - legOrigin.x) * dx + (pose.z - legOrigin.z) * dz) / legLength;
  return alongTrack >= legLength - LENGTH_TOLERANCE;
}

/**
 * Yaw whose forward vector points from the leg's origin at its target.
 *
 * Forward is `(−sin yaw, −cos yaw)`, so the yaw pointing along `(dx, dz)` is `atan2(−dx, −dz)`.
 * Taking the bearing from the leg's origin rather than from the walker is what makes the leg a
 * line to be tracked instead of a point to be homed on: the heading holds the line's direction and
 * the strafe closes the offset from it.
 *
 * @returns The bearing, in radians, wrapped into (−π, π]. A leg with no length left to speak of
 *   falls back to the bearing from the walker to the target.
 */
function getLegBearing(legOrigin: PlanPoint, target: PlanPoint, pose: EyePose): number {
  const dx = target.x - legOrigin.x;
  const dz = target.z - legOrigin.z;
  if (Math.hypot(dx, dz) > LENGTH_TOLERANCE) {
    return wrapAngle(Math.atan2(-dx, -dz));
  }
  return wrapAngle(Math.atan2(pose.x - target.x, pose.z - target.z));
}

/**
 * Signed distance from the walker to the leg's line, in metres.
 *
 * Measured along the line's own right vector `(−dz, dx) / length`, so a positive value puts the
 * walker to the *right* of the line and the correcting strafe is therefore `−sign(crossTrack)`.
 *
 * @returns `0` for a leg with no length left to speak of, which has no line to be off.
 */
function getCrossTrack(legOrigin: PlanPoint, target: PlanPoint, pose: EyePose): number {
  const dx = target.x - legOrigin.x;
  const dz = target.z - legOrigin.z;
  const length = Math.hypot(dx, dz);
  if (!(length > LENGTH_TOLERANCE)) {
    return 0;
  }
  return ((pose.x - legOrigin.x) * -dz + (pose.z - legOrigin.z) * dx) / length;
}

/** Distance from the walker to a point on the plan, in metres. */
function distanceTo(point: PlanPoint, pose: EyePose): number {
  return Math.hypot(point.x - pose.x, point.z - pose.z);
}

/** Maps a signed quantity to a navigation axis; `0` for zero and for `NaN`. */
function toAxis(value: number): Axis {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}
