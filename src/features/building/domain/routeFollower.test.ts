import { describe, expect, it } from 'vitest';
import { EYE_NAVIGATION_CONFIG } from './eyeNavigation.ts';
import type { EyePose, MovementIntent } from './eyeNavigation.ts';
import { toPlanLength } from './planGeometry.ts';
import type { PlanPoint } from './planGeometry.ts';
import {
  createRouteFollower,
  createRouteFollowerConfig,
  hasAnyInput,
  isRouteFollowerDone,
  ROUTE_FOLLOWER_CONFIG,
  stepRouteFollower,
} from './routeFollower.ts';
import type { RouteFollowerPhase, RouteFollowerState } from './routeFollower.ts';

const NAV = EYE_NAVIGATION_CONFIG;
const CONFIG = ROUTE_FOLLOWER_CONFIG;

const DEGREES_PER_HALF_TURN = 180;
const FULL_TURN = 2 * Math.PI;

/** The slowest frame rate the position tolerances are sized for, in frames per second. */
const NOMINAL_FRAMES_PER_SECOND = 30;
/** Duration of that nominal frame, in seconds. */
const NOMINAL_STEP_SECONDS = 1 / NOMINAL_FRAMES_PER_SECOND;
/** Distance a walker covers in one nominal frame, in metres. */
const NOMINAL_STEP_METRES = NAV.walkSpeed * NOMINAL_STEP_SECONDS;
/** Distance a walker covers in the longest frame the navigation counts, in metres. */
const WORST_CASE_STEP_METRES = NAV.walkSpeed * NAV.maxStepSeconds;

const IDLE_INTENT: MovementIntent = { move: 0, strafe: 0, turn: 0, look: 0 };
const ORIGIN_POSE: EyePose = { x: 0, z: 0, yaw: 0, pitch: 0 };
const ORIGIN: PlanPoint = { x: 0, z: 0 };

/** Step budget for walks that are expected to finish long before it. */
const MANY_STEPS = 5000;
/** Number of steps the anti-flapping and never-blocked-while-turning checks run for. */
const LONG_RUN_STEPS = 200;

function radians(degreeValue: number): number {
  return (degreeValue * Math.PI) / DEGREES_PER_HALF_TURN;
}

function degrees(angle: number): number {
  return (angle * DEGREES_PER_HALF_TURN) / Math.PI;
}

/** Wraps an angle into (−π, π], the range every pose yaw and heading error lives in. */
function wrapAngle(angle: number): number {
  if (angle > -Math.PI && angle <= Math.PI) {
    return angle;
  }
  const offset = (((Math.PI - angle) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return Math.PI - offset;
}

function makePose(partial: Partial<EyePose> = {}): EyePose {
  return { ...ORIGIN_POSE, ...partial };
}

function distanceTo(point: PlanPoint, from: EyePose): number {
  return Math.hypot(point.x - from.x, point.z - from.z);
}

/** Unwraps a lookup the test has just asserted is present, without a non-null assertion. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`expected to find ${what}`);
  }
  return value;
}

/**
 * Yaw whose forward vector points from one plan point at another, measured here independently of
 * the follower so a test can state the heading error it expects.
 */
function bearingOf(from: PlanPoint, to: PlanPoint): number {
  return wrapAngle(Math.atan2(-(to.x - from.x), -(to.z - from.z)));
}

/** A point `length` metres from `from` along the forward vector of `bearing`. */
function pointAtBearing(from: PlanPoint, bearing: number, length: number): PlanPoint {
  return { x: from.x - Math.sin(bearing) * length, z: from.z - Math.cos(bearing) * length };
}

/** Signed heading error of a pose against the bearing of the leg from `legOrigin` to `target`. */
function headingErrorOf(legOrigin: PlanPoint, target: PlanPoint, from: EyePose): number {
  return wrapAngle(bearingOf(legOrigin, target) - from.yaw);
}

/** Advances a pose from an intent. */
type Mover = (from: EyePose, intent: MovementIntent, dtSeconds: number) => EyePose;

/**
 * Stand-in for `stepEyePose`: the same time-step rule and the same yaw-then-translate maths,
 * including the diagonal normalisation, but with no bounds and no collision at all, so a test sees
 * exactly what the follower asked for and nothing else.
 *
 * The real `stepEyePose` is deliberately not used: the follower's whole contract is that it emits
 * intents and never moves anything, and that contract is testable without a mover that can refuse.
 */
const stubMove: Mover = (from, intent, dtSeconds) => {
  const dt = dtSeconds > 0 ? Math.min(dtSeconds, NAV.maxStepSeconds) : 0;
  const yaw = wrapAngle(from.yaw + intent.turn * NAV.turnSpeed * dt);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const vectorX = -sinYaw * intent.move + cosYaw * intent.strafe;
  const vectorZ = -cosYaw * intent.move - sinYaw * intent.strafe;
  const length = Math.hypot(vectorX, vectorZ);
  const scale = (length > 1 ? 1 / length : 1) * NAV.walkSpeed * dt;
  return { x: from.x + vectorX * scale, z: from.z + vectorZ * scale, yaw, pitch: from.pitch };
};

/** A mover that refuses everything, standing in for a body wedged against geometry. */
const frozenMove: Mover = (from) => from;

/** Progress a creeping mover makes toward −z each frame, whatever it was asked for, in metres. */
const CREEP_METRES_PER_STEP = 0.03;

/** A mover that creeps forward regardless of the intent: slow, but real, progress. */
const creepMove: Mover = (from) => ({ ...from, z: from.z - CREEP_METRES_PER_STEP });

interface WalkFrame {
  /** The pose this frame's intent was computed from. */
  readonly pose: EyePose;
  /** What the follower asked for. */
  readonly intent: MovementIntent;
  /** Progress after the step. */
  readonly state: RouteFollowerState;
}

interface Walk {
  readonly frames: readonly WalkFrame[];
  readonly state: RouteFollowerState;
  readonly pose: EyePose;
}

/** Drives a follower state with a mover until it is done or the step budget runs out. */
function walkFrom(
  initial: RouteFollowerState,
  start: EyePose,
  dtSeconds: number,
  maxSteps: number,
  mover: Mover = stubMove,
): Walk {
  let state = initial;
  let current = start;
  const frames: WalkFrame[] = [];
  for (let step = 0; step < maxSteps && !isRouteFollowerDone(state); step += 1) {
    const next = stepRouteFollower(state, current, dtSeconds);
    frames.push({ pose: current, intent: next.intent, state: next.state });
    state = next.state;
    current = mover(current, next.intent, dtSeconds);
  }
  return { frames, state, pose: current };
}

/** Follows a route from a pose, as the frame loop would. */
function followRoute(
  waypoints: readonly PlanPoint[],
  start: EyePose,
  dtSeconds: number,
  maxSteps: number,
  mover: Mover = stubMove,
): Walk {
  return walkFrom(createRouteFollower(waypoints, start), start, dtSeconds, maxSteps, mover);
}

/** A hand-built mid-leg state, for the situations {@link createRouteFollower} cannot produce. */
function legState(
  waypoints: readonly PlanPoint[],
  legOrigin: PlanPoint,
  from: EyePose,
  phase: RouteFollowerPhase,
  overrides: Partial<RouteFollowerState> = {},
): RouteFollowerState {
  return {
    waypoints,
    index: 0,
    phase,
    legOrigin,
    bestDistance: distanceTo(waypoints[0], from),
    stalledSeconds: 0,
    ...overrides,
  };
}

describe('createRouteFollowerConfig', () => {
  /** `walkSpeed` 1.4 m/s × 1/30 s × 1.7. */
  const EXPECTED_ARRIVAL_RADIUS_METRES = 0.0793333;
  /** (`walkSpeed` 1.4 / √2) m/s × 1/30 s × 1.2. */
  const EXPECTED_LATERAL_DEADBAND_METRES = 0.039598;
  /** `turnSpeed` 90°/s × `maxStepSeconds` 0.1 s × 1.1. */
  const EXPECTED_HEADING_DEADBAND_DEGREES = 9.9;
  /** The heading deadband × 1.2. */
  const EXPECTED_HEADING_ENTER_DEGREES = 11.88;
  /** The far side of the hysteresis. */
  const EXPECTED_HEADING_EXIT_DEGREES = 45;
  /** Patience before a walk is declared blocked, in seconds. */
  const EXPECTED_STALL_SECONDS = 1.5;
  /** Improvement that counts as progress, in metres. */
  const EXPECTED_STALL_PROGRESS_METRES = 0.02;
  /** Digits the derived arithmetic is pinned to. */
  const PRECISION = 6;

  /** Slack a 0.90 m door leaves a 0.25 m body radius: (0.90 − 2 × 0.25) / 2. */
  const WIDE_DOOR_SLACK_METRES = 0.2;
  /** Slack a 0.60 m cubicle door leaves the same body: (0.60 − 2 × 0.25) / 2. */
  const NARROW_DOOR_SLACK_METRES = 0.05;

  it('derives the arrival radius from the walk speed over a nominal frame', () => {
    expect(CONFIG.arrivalRadius).toBeCloseTo(EXPECTED_ARRIVAL_RADIUS_METRES, PRECISION);
  });

  it('derives the lateral deadband from the diagonal walk speed over a nominal frame', () => {
    expect(CONFIG.lateralDeadband).toBeCloseTo(EXPECTED_LATERAL_DEADBAND_METRES, PRECISION);
  });

  it('derives the heading tolerances from the turn speed over a worst-case frame', () => {
    expect(degrees(CONFIG.headingDeadband)).toBeCloseTo(
      EXPECTED_HEADING_DEADBAND_DEGREES,
      PRECISION,
    );
    expect(degrees(CONFIG.headingEnter)).toBeCloseTo(EXPECTED_HEADING_ENTER_DEGREES, PRECISION);
    expect(degrees(CONFIG.headingExit)).toBeCloseTo(EXPECTED_HEADING_EXIT_DEGREES, PRECISION);
  });

  it('carries the stall thresholds and mirrors the navigation time-step cap', () => {
    expect(CONFIG.stallSeconds).toBe(EXPECTED_STALL_SECONDS);
    expect(CONFIG.stallProgress).toBe(EXPECTED_STALL_PROGRESS_METRES);
    expect(CONFIG.maxStepSeconds).toBe(NAV.maxStepSeconds);
  });

  it('orders the thresholds so the hysteresis and the deadbands nest', () => {
    expect(CONFIG.headingDeadband).toBeLessThan(CONFIG.headingEnter);
    expect(CONFIG.headingEnter).toBeLessThan(CONFIG.headingExit);
    expect(CONFIG.lateralDeadband).toBeLessThan(CONFIG.arrivalRadius);
  });

  it('keeps both position tolerances inside the slack a door leaves', () => {
    expect(CONFIG.arrivalRadius).toBeLessThan(WIDE_DOOR_SLACK_METRES);
    expect(CONFIG.lateralDeadband).toBeLessThan(NARROW_DOOR_SLACK_METRES);
  });

  it('would not fit a cubicle door if the positions were sized for the worst frame', () => {
    // The stated reason the position tolerances assume a nominal frame instead.
    expect(WORST_CASE_STEP_METRES).toBeGreaterThan(NARROW_DOOR_SLACK_METRES);
  });

  it('makes the arrival disc wider than one nominal step, so arrival cannot be strided over', () => {
    expect(2 * CONFIG.arrivalRadius).toBeGreaterThan(NOMINAL_STEP_METRES);
  });

  it('crosses the arrival disc on a chord wider than a nominal step but not a worst-case one', () => {
    // A walker drifting by the full lateral deadband crosses the disc on this chord rather than on
    // its diameter. The chord clears a nominal frame's step with room to spare, but not the longest
    // frame the navigation counts: arrival sampling is guaranteed only up to that rate.
    const chord = 2 * Math.sqrt(CONFIG.arrivalRadius ** 2 - CONFIG.lateralDeadband ** 2);
    expect(chord).toBeGreaterThan(NOMINAL_STEP_METRES);
    expect(chord).toBeLessThan(WORST_CASE_STEP_METRES);
  });

  it('scales the position tolerances with the walk speed and leaves the headings alone', () => {
    const faster = createRouteFollowerConfig({ ...NAV, walkSpeed: NAV.walkSpeed * 2 });
    expect(faster.arrivalRadius).toBeCloseTo(CONFIG.arrivalRadius * 2, PRECISION);
    expect(faster.lateralDeadband).toBeCloseTo(CONFIG.lateralDeadband * 2, PRECISION);
    expect(faster.headingDeadband).toBe(CONFIG.headingDeadband);
  });

  it('scales the heading tolerances with the turn speed and leaves the positions alone', () => {
    const spinnier = createRouteFollowerConfig({ ...NAV, turnSpeed: NAV.turnSpeed * 2 });
    expect(spinnier.headingDeadband).toBeCloseTo(CONFIG.headingDeadband * 2, PRECISION);
    expect(spinnier.headingEnter).toBeCloseTo(CONFIG.headingEnter * 2, PRECISION);
    expect(spinnier.headingExit).toBe(CONFIG.headingExit);
    expect(spinnier.arrivalRadius).toBe(CONFIG.arrivalRadius);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
  });
});

describe('createRouteFollower', () => {
  /** A waypoint a comfortable walk straight ahead. */
  const AHEAD: PlanPoint = { x: 0, z: -5 };

  it('is arrived at once for an empty route', () => {
    const state = createRouteFollower([], ORIGIN_POSE);
    expect(state.phase).toBe('arrived');
    expect(state.index).toBe(0);
    expect(isRouteFollowerDone(state)).toBe(true);
  });

  it('starts the first leg turning, from the walker as leg origin', () => {
    const state = createRouteFollower([AHEAD], ORIGIN_POSE);
    expect(state.phase).toBe('turning');
    expect(state.index).toBe(0);
    expect(state.legOrigin).toEqual(ORIGIN);
    expect(state.bestDistance).toBeCloseTo(distanceTo(AHEAD, ORIGIN_POSE));
    expect(state.stalledSeconds).toBe(0);
  });

  it('consumes a waypoint the walker is already standing on', () => {
    const state = createRouteFollower([ORIGIN, AHEAD], ORIGIN_POSE);
    expect(state.index).toBe(1);
    expect(state.phase).toBe('turning');
  });

  it('is arrived at once when its only waypoint is already reached', () => {
    const nearby: PlanPoint = { x: CONFIG.arrivalRadius / 2, z: 0 };
    const state = createRouteFollower([nearby], ORIGIN_POSE);
    expect(state.phase).toBe('arrived');
    expect(isRouteFollowerDone(state)).toBe(true);
  });

  it('drains already-reached waypoints one frame at a time', () => {
    // At most one waypoint is consumed per step, so a route of degenerate legs cannot collapse
    // the whole route in a single frame however short those legs are.
    const nearby: PlanPoint = { x: CONFIG.arrivalRadius / 2, z: 0 };
    const state = createRouteFollower([ORIGIN, nearby], ORIGIN_POSE);
    expect(state.index).toBe(1);
    expect(isRouteFollowerDone(state)).toBe(false);

    const next = stepRouteFollower(state, ORIGIN_POSE, NOMINAL_STEP_SECONDS);
    expect(next.state.phase).toBe('arrived');
    expect(next.intent).toEqual(IDLE_INTENT);
  });

  it('does not consume a waypoint just outside the arrival radius', () => {
    const outside: PlanPoint = { x: 0, z: -(CONFIG.arrivalRadius * 2) };
    const state = createRouteFollower([outside], ORIGIN_POSE);
    expect(state.index).toBe(0);
    expect(state.phase).toBe('turning');
  });

  it('keeps a frozen copy of the route, immune to later changes by the caller', () => {
    const source: PlanPoint[] = [AHEAD];
    const state = createRouteFollower(source, ORIGIN_POSE);
    source.push({ x: 9, z: 9 });
    expect(state.waypoints).toHaveLength(1);
    expect(state.waypoints).not.toBe(source);
    expect(Object.isFrozen(state.waypoints)).toBe(true);
  });
});

describe('turning onto a leg before walking it', () => {
  /** Sideways offset that makes the short way round unambiguous, in metres. */
  const BEHIND_OFFSET_METRES = 0.5;
  /** How far behind the walker the backwards waypoints sit, in metres. */
  const BEHIND_DEPTH_METRES = 5;
  /** A waypoint behind the walker and to its right. */
  const BEHIND_RIGHT: PlanPoint = { x: BEHIND_OFFSET_METRES, z: BEHIND_DEPTH_METRES };
  /** A waypoint behind the walker and to its left. */
  const BEHIND_LEFT: PlanPoint = { x: -BEHIND_OFFSET_METRES, z: BEHIND_DEPTH_METRES };
  /** A waypoint exactly behind the walker: a heading error of exactly π. */
  const BEHIND_EXACTLY: PlanPoint = { x: 0, z: BEHIND_DEPTH_METRES };

  it('turns the short way round toward a waypoint behind and to the right', () => {
    const step = stepRouteFollower(
      createRouteFollower([BEHIND_RIGHT], ORIGIN_POSE),
      ORIGIN_POSE,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.intent).toEqual({ move: 0, strafe: 0, turn: -1, look: 0 });
    expect(step.state.phase).toBe('turning');
  });

  it('turns the short way round toward a waypoint behind and to the left', () => {
    const step = stepRouteFollower(
      createRouteFollower([BEHIND_LEFT], ORIGIN_POSE),
      ORIGIN_POSE,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.intent).toEqual({ move: 0, strafe: 0, turn: 1, look: 0 });
  });

  it('breaks the tie of an exactly-behind waypoint by turning left', () => {
    const step = stepRouteFollower(
      createRouteFollower([BEHIND_EXACTLY], ORIGIN_POSE),
      ORIGIN_POSE,
      NOMINAL_STEP_SECONDS,
    );
    expect(Math.abs(headingErrorOf(ORIGIN, BEHIND_EXACTLY, ORIGIN_POSE))).toBeCloseTo(Math.PI);
    expect(step.intent.turn).toBe(1);
    expect(step.intent.move).toBe(0);
  });

  it('does not move the walker until the heading error is inside the entry threshold', () => {
    const walk = followRoute([BEHIND_RIGHT], ORIGIN_POSE, NOMINAL_STEP_SECONDS, MANY_STEPS);
    const firstWalking = walk.frames.findIndex((frame) => frame.intent.move !== 0);
    expect(firstWalking).toBeGreaterThan(0);

    for (const frame of walk.frames.slice(0, firstWalking)) {
      expect(frame.intent.move).toBe(0);
      expect(frame.intent.strafe).toBe(0);
      expect(frame.pose.x).toBe(ORIGIN_POSE.x);
      expect(frame.pose.z).toBe(ORIGIN_POSE.z);
    }

    const aligned = walk.frames[firstWalking].pose;
    expect(Math.abs(headingErrorOf(ORIGIN, BEHIND_RIGHT, aligned))).toBeLessThanOrEqual(
      CONFIG.headingEnter,
    );
  });

  it('never asks to walk backwards or to look anywhere, even onto a leg behind it', () => {
    const walk = followRoute([BEHIND_RIGHT], ORIGIN_POSE, NOMINAL_STEP_SECONDS, MANY_STEPS);
    expect(walk.state.phase).toBe('arrived');
    for (const frame of walk.frames) {
      expect(frame.intent.move).not.toBe(-1);
      expect(frame.intent.look).toBe(0);
    }
  });

  describe('across the ±π seam', () => {
    /** A bearing just inside the −π side of the seam, in radians. */
    const SEAM_BEARING = -3;
    /** A yaw just inside the +π side of the seam, in radians. */
    const SEAM_YAW = 3;
    /** Length of the seam legs, in metres. */
    const SEAM_LEG_METRES = 4;
    /** Steps the short way round needs; the long way would take more than ten times as many. */
    const SEAM_TURN_STEPS = 3;

    it('turns left across the seam rather than most of the way round', () => {
      const target = pointAtBearing(ORIGIN, SEAM_BEARING, SEAM_LEG_METRES);
      const start = makePose({ yaw: SEAM_YAW });
      expect(Math.abs(headingErrorOf(ORIGIN, target, start))).toBeLessThan(Math.PI);

      const walk = followRoute([target], start, NAV.maxStepSeconds, SEAM_TURN_STEPS);
      expect(walk.frames[0].intent.turn).toBe(1);
      expect(walk.frames[0].intent.move).toBe(0);
      expect(walk.frames.some((frame) => frame.state.phase === 'walking')).toBe(true);
    });

    it('turns right across the seam rather than most of the way round', () => {
      const target = pointAtBearing(ORIGIN, -SEAM_BEARING, SEAM_LEG_METRES);
      const start = makePose({ yaw: -SEAM_YAW });
      const walk = followRoute([target], start, NAV.maxStepSeconds, SEAM_TURN_STEPS);
      expect(walk.frames[0].intent.turn).toBe(-1);
      expect(walk.frames.some((frame) => frame.state.phase === 'walking')).toBe(true);
    });
  });
});

describe('hysteresis between turning and walking', () => {
  /** A heading error between the entry and exit thresholds, in degrees. */
  const MID_BAND_DEGREES = 30;
  /** A heading error beyond the exit threshold, in degrees. */
  const PAST_EXIT_DEGREES = 60;
  /** A heading error inside the deadband, in degrees. */
  const INSIDE_DEADBAND_DEGREES = 5;
  /** The leg the hysteresis tests walk: straight ahead from the origin. */
  const ROUTE: readonly PlanPoint[] = [{ x: 0, z: -5 }];

  it('places the test errors either side of the thresholds', () => {
    expect(radians(MID_BAND_DEGREES)).toBeGreaterThan(CONFIG.headingEnter);
    expect(radians(MID_BAND_DEGREES)).toBeLessThan(CONFIG.headingExit);
    expect(radians(PAST_EXIT_DEGREES)).toBeGreaterThan(CONFIG.headingExit);
    expect(radians(INSIDE_DEADBAND_DEGREES)).toBeLessThan(CONFIG.headingDeadband);
  });

  it('keeps walking at an error the turning phase would not have started walking at', () => {
    const drifted = makePose({ yaw: radians(MID_BAND_DEGREES) });
    const step = stepRouteFollower(
      legState(ROUTE, ORIGIN, drifted, 'walking'),
      drifted,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.state.phase).toBe('walking');
    expect(step.intent.move).toBe(1);
    expect(step.intent.turn).toBe(-1);
  });

  it('does not start walking at that same error when it is still turning', () => {
    const drifted = makePose({ yaw: radians(MID_BAND_DEGREES) });
    const step = stepRouteFollower(
      legState(ROUTE, ORIGIN, drifted, 'turning'),
      drifted,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.state.phase).toBe('turning');
    expect(step.intent.move).toBe(0);
    expect(step.intent.turn).toBe(-1);
  });

  it('returns to turning once the error crosses the exit threshold', () => {
    const lost = makePose({ yaw: radians(PAST_EXIT_DEGREES) });
    const step = stepRouteFollower(
      legState(ROUTE, ORIGIN, lost, 'walking'),
      lost,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.state.phase).toBe('turning');
    expect(step.intent.move).toBe(0);
    expect(step.intent.turn).toBe(-1);
  });

  it('starts walking, without correcting, at an error inside the deadband', () => {
    const nearly = makePose({ yaw: radians(INSIDE_DEADBAND_DEGREES) });
    const step = stepRouteFollower(
      legState(ROUTE, ORIGIN, nearly, 'turning'),
      nearly,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.state.phase).toBe('walking');
    expect(step.intent.move).toBe(1);
    expect(step.intent.turn).toBe(0);
  });

  it('never falls back from walking to turning on the same leg over a long run', () => {
    const route: readonly PlanPoint[] = [
      { x: 0, z: -3 },
      { x: 3, z: -3 },
      { x: 3, z: 0 },
      { x: 0, z: 0 },
    ];
    const walk = followRoute(route, ORIGIN_POSE, NOMINAL_STEP_SECONDS, MANY_STEPS);
    expect(walk.frames.length).toBeGreaterThan(LONG_RUN_STEPS);
    expect(walk.state.phase).toBe('arrived');

    for (let index = 1; index < walk.frames.length; index += 1) {
      const previous = walk.frames[index - 1].state;
      const current = walk.frames[index].state;
      if (previous.phase === 'walking' && current.phase === 'turning') {
        // The only legitimate way back to turning is a new leg, which has a new bearing to face.
        expect(current.index).not.toBe(previous.index);
      }
    }
  });
});

describe('arrival', () => {
  /** A route with two right-angle corners, so every leg needs a fresh bearing. */
  const ROUTE: readonly PlanPoint[] = [
    { x: 0, z: -3 },
    { x: 2, z: -3 },
    { x: 2, z: -6 },
  ];
  /**
   * Realistic frame lengths, at which the walker always lands inside the arrival radius itself.
   * The longest frame the navigation counts is covered separately below, with a looser bound: one
   * step of it is wider than the chord a drifting walker crosses the arrival disc on (see the
   * chord test above), so there it is the foot test that does the arriving, not the radius.
   */
  const STEP_SECONDS = [NOMINAL_STEP_SECONDS, 1 / 60, 1 / 144, 0.05];

  for (const dtSeconds of STEP_SECONDS) {
    describe(`at ${dtSeconds.toFixed(4)} s per frame`, () => {
      it('reaches every waypoint within the arrival radius and stops there', () => {
        const walk = followRoute(ROUTE, ORIGIN_POSE, dtSeconds, MANY_STEPS);
        expect(walk.state.phase).toBe('arrived');
        expect(walk.state.index).toBe(ROUTE.length);

        for (const waypoint of ROUTE) {
          const closest = Math.min(...walk.frames.map((frame) => distanceTo(waypoint, frame.pose)));
          expect(closest).toBeLessThanOrEqual(CONFIG.arrivalRadius);
        }

        const last = ROUTE[ROUTE.length - 1];
        expect(distanceTo(last, walk.pose)).toBeLessThanOrEqual(CONFIG.arrivalRadius);
      });

      it('consumes each waypoint from inside the arrival radius, never further out', () => {
        const walk = followRoute(ROUTE, ORIGIN_POSE, dtSeconds, MANY_STEPS);
        for (let index = 0; index < ROUTE.length; index += 1) {
          const consuming = required(
            walk.frames.find((frame) => frame.state.index > index),
            `the frame consuming waypoint ${String(index)}`,
          );
          expect(distanceTo(ROUTE[index], consuming.pose)).toBeLessThanOrEqual(
            CONFIG.arrivalRadius,
          );
        }
      });
    });
  }

  it('emits no intent once arrived, and stays arrived', () => {
    const walk = followRoute(ROUTE, ORIGIN_POSE, NOMINAL_STEP_SECONDS, MANY_STEPS);
    const again = stepRouteFollower(walk.state, walk.pose, NOMINAL_STEP_SECONDS);
    expect(again.state).toBe(walk.state);
    expect(again.intent).toEqual(IDLE_INTENT);
    expect(hasAnyInput(again.intent)).toBe(false);
  });
});

describe('arrival at the time-step cap', () => {
  /**
   * The longest frame the navigation counts. Not a hypothetical: under software WebGL the interior
   * view runs at a few frames a second, so every frame is capped here — and this is the regime a
   * sampled-only arrival stranded walkers in.
   */
  const STEP_SECONDS = NAV.maxStepSeconds;
  /**
   * How far past a waypoint an arrival may legitimately land here. The foot test fires on the
   * frame the along-track projection reaches the target, by which point a capped step may have
   * carried the walker a whole step beyond it. A destination is a room's standing centre, not a
   * dock, so that much overshoot is a correct arrival rather than a miss.
   */
  const FOOT_TOLERANCE_METRES = CONFIG.arrivalRadius + WORST_CASE_STEP_METRES;
  /** A route with two right-angle corners, so every leg needs a fresh bearing. */
  const ROUTE: readonly PlanPoint[] = [
    { x: 0, z: -3 },
    { x: 2, z: -3 },
    { x: 2, z: -6 },
  ];
  /**
   * A route a sampled-only arrival stranded: the walker came within 0.0797 m of the first waypoint
   * against a 0.0793 m radius — missing the disc by four tenths of a millimetre — then marched
   * 1.87 m past it down the leg's old bearing and was declared blocked, still on the first leg.
   */
  const STRANDED_ROUTE: readonly PlanPoint[] = [
    { x: 0.9, z: 1.02 },
    { x: -2.34, z: -2.93 },
    { x: 0.53, z: -4.55 },
  ];
  /** The start yaw that produced that miss, in radians. */
  const STRANDED_YAW = 2.186;

  /** Number of random routes the sweep walks. */
  const SWEEP_ROUTES = 300;
  /** Most waypoints a generated route is given. */
  const MAX_SWEEP_LEGS = 4;
  /** Span each generated leg is drawn from, in metres. */
  const LEG_SPAN_METRES = 8;
  /** Seed of the sweep's generator, so every run walks exactly the same routes. */
  const SWEEP_SEED = 12345;
  /** Multiplier of the sweep's linear congruential generator. */
  const SWEEP_MULTIPLIER = 1103515245;
  /** Increment of the sweep's linear congruential generator. */
  const SWEEP_INCREMENT = 12345;
  /** Modulus mask of the sweep's linear congruential generator. */
  const SWEEP_MODULUS = 0x7fffffff;
  /** Half, for centring a generated offset on zero. */
  const HALF = 0.5;

  it('arrives on a cornered route, within one capped step of each waypoint', () => {
    const walk = followRoute(ROUTE, ORIGIN_POSE, STEP_SECONDS, MANY_STEPS);
    expect(walk.state.phase).toBe('arrived');
    expect(walk.state.index).toBe(ROUTE.length);

    for (const waypoint of ROUTE) {
      const closest = Math.min(...walk.frames.map((frame) => distanceTo(waypoint, frame.pose)));
      expect(closest).toBeLessThanOrEqual(FOOT_TOLERANCE_METRES);
    }
    expect(distanceTo(ROUTE[ROUTE.length - 1], walk.pose)).toBeLessThanOrEqual(
      FOOT_TOLERANCE_METRES,
    );
  });

  it('arrives on the route that a sampled-only arrival stranded', () => {
    const walk = followRoute(
      STRANDED_ROUTE,
      makePose({ yaw: STRANDED_YAW }),
      STEP_SECONDS,
      MANY_STEPS,
    );
    expect(walk.state.phase).toBe('arrived');
    expect(walk.state.index).toBe(STRANDED_ROUTE.length);
  });

  it('is never blocked over a sweep of random routes', () => {
    let seed = SWEEP_SEED;
    const nextRandom = (): number => {
      seed = (seed * SWEEP_MULTIPLIER + SWEEP_INCREMENT) & SWEEP_MODULUS;
      return seed / SWEEP_MODULUS;
    };

    const stranded: string[] = [];
    for (let trial = 0; trial < SWEEP_ROUTES; trial += 1) {
      const legs = 1 + Math.floor(nextRandom() * MAX_SWEEP_LEGS);
      const route: PlanPoint[] = [];
      let x = 0;
      let z = 0;
      for (let leg = 0; leg < legs; leg += 1) {
        x += (nextRandom() - HALF) * LEG_SPAN_METRES;
        z += (nextRandom() - HALF) * LEG_SPAN_METRES;
        route.push({ x: toPlanLength(x), z: toPlanLength(z) });
      }
      const start = makePose({ yaw: wrapAngle((nextRandom() - HALF) * FULL_TURN) });
      const walk = followRoute(route, start, STEP_SECONDS, MANY_STEPS);
      if (walk.state.phase !== 'arrived') {
        stranded.push(JSON.stringify(route));
      }
    }
    expect(stranded).toEqual([]);
  });
});

describe('cross-track correction', () => {
  /** The straight leg the cross-track tests walk, along −z from the origin. */
  const ROUTE: readonly PlanPoint[] = [{ x: 0, z: -5 }];
  /** A sideways offset well outside the lateral deadband, in metres. */
  const OFFSET_METRES = 0.15;
  /** Steps long enough to close the offset, short enough not to reach the waypoint. */
  const CORRECTION_STEPS = 20;

  /**
   * Signed offset from this leg's line. The leg runs along −z from the origin, so its right vector
   * is +x and the offset is simply the walker's x.
   */
  function offsetOf(from: EyePose): number {
    return from.x;
  }

  it('places the test offset outside the lateral deadband', () => {
    expect(OFFSET_METRES).toBeGreaterThan(CONFIG.lateralDeadband);
  });

  it('strafes toward the line from the right of it', () => {
    const drifted = makePose({ x: OFFSET_METRES });
    const step = stepRouteFollower(
      legState(ROUTE, ORIGIN, drifted, 'walking'),
      drifted,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.intent).toEqual({ move: 1, strafe: -1, turn: 0, look: 0 });
  });

  it('strafes toward the line from the left of it', () => {
    const drifted = makePose({ x: -OFFSET_METRES });
    const step = stepRouteFollower(
      legState(ROUTE, ORIGIN, drifted, 'walking'),
      drifted,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.intent).toEqual({ move: 1, strafe: 1, turn: 0, look: 0 });
  });

  it('does not strafe at an offset inside the deadband', () => {
    const drifted = makePose({ x: CONFIG.lateralDeadband / 2 });
    const step = stepRouteFollower(
      legState(ROUTE, ORIGIN, drifted, 'walking'),
      drifted,
      NOMINAL_STEP_SECONDS,
    );
    expect(step.intent.strafe).toBe(0);
    expect(step.intent.move).toBe(1);
  });

  it('closes the offset monotonically while advancing, then stops strafing', () => {
    const drifted = makePose({ x: OFFSET_METRES });
    const walk = walkFrom(
      legState(ROUTE, ORIGIN, drifted, 'walking'),
      drifted,
      NOMINAL_STEP_SECONDS,
      CORRECTION_STEPS,
    );

    for (const frame of walk.frames) {
      const offset = offsetOf(frame.pose);
      // Never overshoots to the far side of the line.
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(frame.intent.strafe).toBe(offset > CONFIG.lateralDeadband ? -1 : 0);
      // The walker keeps making ground on the waypoint while it corrects.
      expect(frame.intent.move).toBe(1);
    }

    for (let index = 1; index < walk.frames.length; index += 1) {
      const previous = offsetOf(walk.frames[index - 1].pose);
      const current = offsetOf(walk.frames[index].pose);
      if (previous > CONFIG.lateralDeadband) {
        expect(current).toBeLessThan(previous);
      } else {
        expect(current).toBeCloseTo(previous);
      }
    }

    expect(offsetOf(walk.pose)).toBeLessThanOrEqual(CONFIG.lateralDeadband);
  });

  it('closes a doorway-sized offset within the clear run outside the wall', () => {
    /** The clear run outside the wall on a doorway crossing leg, in metres. */
    const APPROACH_METRES = 0.3;
    // The lateral error a walker inherits by stopping a full arrival radius short of the outer
    // approach point of a doorway, which is the worst case a corridor run can hand over.
    const drifted = makePose({ x: CONFIG.arrivalRadius });
    const walk = walkFrom(
      legState(ROUTE, ORIGIN, drifted, 'walking'),
      drifted,
      NOMINAL_STEP_SECONDS,
      CORRECTION_STEPS,
    );

    const closed = required(
      walk.frames.find((frame) => Math.abs(offsetOf(frame.pose)) <= CONFIG.lateralDeadband),
      'the frame the offset closes on',
    );
    expect(Math.abs(closed.pose.z)).toBeLessThanOrEqual(APPROACH_METRES);
  });
});

describe('stuck detection', () => {
  /** The leg the stall tests walk, straight ahead so the walker starts aligned and walking. */
  const ROUTE: readonly PlanPoint[] = [{ x: 0, z: -5 }];
  /** A route whose only waypoint is behind the walker, so it can only ever be turning. */
  const BEHIND_ROUTE: readonly PlanPoint[] = [{ x: 0, z: 5 }];
  /** Frame length of the stall tests: the worst-case cap, 15 of which sum to the patience. */
  const STEP_SECONDS = NAV.maxStepSeconds;
  /** Number of those frames that add up to the stall patience. */
  const STALL_STEPS = 15;
  /** Steps run to show a walker that is not stuck is left alone: far past the patience. */
  const PATIENT_STEPS = 100;

  it('sums exactly to the patience over the expected number of worst-case frames', () => {
    expect(STALL_STEPS * STEP_SECONDS).toBeGreaterThanOrEqual(CONFIG.stallSeconds);
    expect((STALL_STEPS - 1) * STEP_SECONDS).toBeLessThan(CONFIG.stallSeconds);
  });

  it('blocks on the frame the patience runs out, and not before', () => {
    const walk = followRoute(ROUTE, ORIGIN_POSE, STEP_SECONDS, MANY_STEPS, frozenMove);
    expect(walk.frames).toHaveLength(STALL_STEPS);

    for (const frame of walk.frames.slice(0, STALL_STEPS - 1)) {
      expect(frame.state.phase).toBe('walking');
      expect(isRouteFollowerDone(frame.state)).toBe(false);
    }

    const last = walk.frames[STALL_STEPS - 1];
    expect(last.state.phase).toBe('blocked');
    expect(last.state.stalledSeconds).toBeGreaterThanOrEqual(CONFIG.stallSeconds);
    expect(last.intent).toEqual(IDLE_INTENT);
    expect(isRouteFollowerDone(last.state)).toBe(true);
  });

  it('never re-plans once blocked', () => {
    const walk = followRoute(ROUTE, ORIGIN_POSE, STEP_SECONDS, MANY_STEPS, frozenMove);
    const again = stepRouteFollower(walk.state, walk.pose, STEP_SECONDS);
    expect(again.state).toBe(walk.state);
    expect(again.state.index).toBe(walk.state.index);
    expect(again.intent).toEqual(IDLE_INTENT);
  });

  it('does not block while slow but real progress continues', () => {
    expect(CREEP_METRES_PER_STEP).toBeGreaterThan(CONFIG.stallProgress);
    const walk = followRoute(ROUTE, ORIGIN_POSE, STEP_SECONDS, PATIENT_STEPS, creepMove);
    expect(walk.frames).toHaveLength(PATIENT_STEPS);
    for (const frame of walk.frames) {
      expect(frame.state.phase).toBe('walking');
      // The mover acts after the step, so the very first frame cannot yet show progress and
      // carries one frame on the clock. Every frame after it is reset by the creep, so the clock
      // never accumulates past a single frame, let alone reaches the patience.
      expect(frame.state.stalledSeconds).toBeLessThanOrEqual(STEP_SECONDS);
      expect(frame.state.stalledSeconds).toBeLessThan(CONFIG.stallSeconds);
    }
  });

  it('never blocks a walker that is only turning, however long it takes', () => {
    const walk = followRoute(BEHIND_ROUTE, ORIGIN_POSE, STEP_SECONDS, LONG_RUN_STEPS, frozenMove);
    expect(walk.frames).toHaveLength(LONG_RUN_STEPS);
    for (const frame of walk.frames) {
      expect(frame.state.phase).toBe('turning');
      expect(frame.state.stalledSeconds).toBe(0);
    }
  });
});

describe('time-step discipline', () => {
  /** The leg the time-step tests walk, straight ahead so the walker starts aligned and walking. */
  const ROUTE: readonly PlanPoint[] = [{ x: 0, z: -5 }];
  /** Steps run to show a sanitised frame never accumulates: far past the patience. */
  const PATIENT_STEPS = 100;
  /** A frame long enough to have been a tab-away, in seconds. */
  const TAB_AWAY_SECONDS = 10;

  const IGNORED_STEPS = [
    ['not a number', Number.NaN],
    ['negative', -1],
    ['zero', 0],
  ] as const;

  for (const [name, dtSeconds] of IGNORED_STEPS) {
    it(`adds nothing to the stall clock for a ${name} frame`, () => {
      const walk = followRoute(ROUTE, ORIGIN_POSE, dtSeconds, PATIENT_STEPS, frozenMove);
      expect(walk.frames).toHaveLength(PATIENT_STEPS);
      expect(walk.state.phase).toBe('walking');
      expect(walk.state.stalledSeconds).toBe(0);
    });
  }

  it('counts a ten-second frame as exactly the navigation cap, and does not block on it', () => {
    const step = stepRouteFollower(
      createRouteFollower(ROUTE, ORIGIN_POSE),
      ORIGIN_POSE,
      TAB_AWAY_SECONDS,
    );
    expect(step.state.stalledSeconds).toBe(NAV.maxStepSeconds);
    expect(step.state.phase).toBe('walking');
  });
});

describe('degenerate legs', () => {
  /** A waypoint a comfortable walk straight ahead. */
  const AHEAD: PlanPoint = { x: 0, z: -5 };

  it('advances through a zero-length first leg without computing a bearing for it', () => {
    // A bearing taken on a zero-length leg would be the exactly-behind tie, which turns left on the
    // spot. Walking straight on instead is the observable proof that no bearing was taken.
    const state = legState([ORIGIN, AHEAD], ORIGIN, ORIGIN_POSE, 'turning');
    const step = stepRouteFollower(state, ORIGIN_POSE, NOMINAL_STEP_SECONDS);
    expect(step.state.index).toBe(1);
    expect(step.intent).toEqual({ move: 1, strafe: 0, turn: 0, look: 0 });
  });

  it('consumes a run of duplicated waypoints one frame at a time', () => {
    const route: readonly PlanPoint[] = [ORIGIN, ORIGIN, ORIGIN, AHEAD];
    let state = createRouteFollower(route, ORIGIN_POSE);
    expect(state.index).toBe(1);

    for (const expected of [2, 3]) {
      state = stepRouteFollower(state, ORIGIN_POSE, NOMINAL_STEP_SECONDS).state;
      expect(state.index).toBe(expected);
    }
    // Having drained the duplicates it is walking the one real leg, which runs straight ahead.
    expect(state.phase).toBe('walking');
  });

  it('restarts the leg origin, closest approach and stall clock on every new leg', () => {
    const route: readonly PlanPoint[] = [
      { x: 0, z: -3 },
      { x: 2, z: -3 },
    ];
    const walk = followRoute(route, ORIGIN_POSE, NOMINAL_STEP_SECONDS, MANY_STEPS);
    const handover = required(
      walk.frames.find((frame) => frame.state.index === 1),
      'the frame handing over to the second leg',
    );
    expect(handover.state.legOrigin.x).toBeCloseTo(handover.pose.x);
    expect(handover.state.legOrigin.z).toBeCloseTo(handover.pose.z);
    expect(handover.state.stalledSeconds).toBe(0);
    expect(handover.state.bestDistance).toBeCloseTo(distanceTo(route[1], handover.pose));
  });
});

describe('isRouteFollowerDone', () => {
  const PHASE_CASES = [
    ['turning', false],
    ['walking', false],
    ['arrived', true],
    ['blocked', true],
  ] as const;

  for (const [phase, expected] of PHASE_CASES) {
    it(`is ${String(expected)} for ${phase}`, () => {
      const state = legState([{ x: 0, z: -5 }], ORIGIN, ORIGIN_POSE, phase);
      expect(isRouteFollowerDone(state)).toBe(expected);
    });
  }
});

describe('hasAnyInput', () => {
  const SINGLE_AXIS_CASES: readonly (readonly [string, MovementIntent])[] = [
    ['move forward', { ...IDLE_INTENT, move: 1 }],
    ['move backward', { ...IDLE_INTENT, move: -1 }],
    ['strafe right', { ...IDLE_INTENT, strafe: 1 }],
    ['strafe left', { ...IDLE_INTENT, strafe: -1 }],
    ['turn left', { ...IDLE_INTENT, turn: 1 }],
    ['turn right', { ...IDLE_INTENT, turn: -1 }],
    ['look up', { ...IDLE_INTENT, look: 1 }],
    ['look down', { ...IDLE_INTENT, look: -1 }],
  ];

  it('is false for an idle intent', () => {
    expect(hasAnyInput(IDLE_INTENT)).toBe(false);
  });

  for (const [name, intent] of SINGLE_AXIS_CASES) {
    it(`is true for ${name} alone`, () => {
      expect(hasAnyInput(intent)).toBe(true);
    });
  }

  it('is true for several axes at once', () => {
    expect(hasAnyInput({ move: 1, strafe: -1, turn: 1, look: -1 })).toBe(true);
  });
});

describe('purity', () => {
  const ROUTE: readonly PlanPoint[] = [
    { x: 0, z: -3 },
    { x: 2, z: -3 },
  ];
  /** A pose part-way onto a leg, so the step has real work to do. */
  const DRIFTED = makePose({ x: 0.1, z: -1, yaw: radians(10) });

  it('gives the same result for the same state and pose', () => {
    const state = createRouteFollower(ROUTE, ORIGIN_POSE);
    const first = stepRouteFollower(state, DRIFTED, NOMINAL_STEP_SECONDS);
    const second = stepRouteFollower(state, DRIFTED, NOMINAL_STEP_SECONDS);
    expect(second.state).toEqual(first.state);
    expect(second.intent).toEqual(first.intent);
  });

  it('does not mutate the state it is given', () => {
    const state = createRouteFollower(ROUTE, ORIGIN_POSE);
    const before = JSON.stringify(state);
    stepRouteFollower(state, DRIFTED, NOMINAL_STEP_SECONDS);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not mutate the pose it is given', () => {
    const state = createRouteFollower(ROUTE, ORIGIN_POSE);
    const before = JSON.stringify(DRIFTED);
    stepRouteFollower(state, DRIFTED, NOMINAL_STEP_SECONDS);
    expect(JSON.stringify(DRIFTED)).toBe(before);
  });

  it('does not mutate the waypoint array over a whole walk', () => {
    const source: PlanPoint[] = ROUTE.map((waypoint) => ({ ...waypoint }));
    const before = JSON.stringify(source);
    const walk = followRoute(source, ORIGIN_POSE, NOMINAL_STEP_SECONDS, MANY_STEPS);
    expect(walk.state.phase).toBe('arrived');
    expect(JSON.stringify(source)).toBe(before);
  });
});
