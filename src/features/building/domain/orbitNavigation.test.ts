import { describe, expect, it } from 'vitest';
import { EYE_KEY_BINDINGS, isEyeNavigationKey } from './eyeNavigation.ts';
import type { ExteriorFraming, Vector3Like } from './exteriorFraming.ts';
import {
  clampOrbitPose,
  getOrbitIntent,
  getOrbitIntentFromActions,
  getOrbitLimits,
  getOrbitPose,
  getOrbitPosition,
  isOrbitNavigationKey,
  ORBIT_ACTIONS,
  ORBIT_GROUND_CLEARANCE_RADIANS,
  ORBIT_KEY_BINDINGS,
  ORBIT_NAVIGATION_CONFIG,
  ORBIT_ZENITH_CLEARANCE_RADIANS,
  stepOrbitPose,
} from './orbitNavigation.ts';
import type { OrbitAction, OrbitIntent, OrbitLimits, OrbitPose } from './orbitNavigation.ts';
import { CAMERA_MODE_TOGGLE_KEY_CODE } from './viewMode.ts';

/** A typical frame at 20 fps: short enough to stay well inside every limit. */
const STEP = 0.05;
/** Ten seconds of stepping: enough to run any axis into its limit. */
const MANY_STEPS = 200;
/** Decimal places the spherical round trip is asserted to, well inside double precision. */
const ROUND_TRIP_DIGITS = 12;
/** Decimal places the exact angular and multiplicative arithmetic is asserted to. */
const EXACT_DIGITS = 10;
/** An angle a hair short of the (−π, π] seam, so one step crosses it. */
const NEAR_SEAM = Math.PI - 0.01;
const QUARTER_TURN = Math.PI / 2;

/**
 * A framing with numbers of its own, unrelated to any real plot: the limits must come
 * from these fields and from nothing else, so a literal in the module under test would
 * fail here.
 */
const FRAMING: ExteriorFraming = Object.freeze({
  target: Object.freeze({ x: 11.25, y: 1.5, z: 5 }),
  position: Object.freeze({ x: 1, y: 20, z: 30 }),
  fitDistance: 40,
  minDistance: 10,
  maxDistance: 80,
  fogNear: 100,
  fogFar: 200,
  groundSize: 400,
});

/** A second framing, as a resize would produce: every distance differs from {@link FRAMING}. */
const NARROW_FRAMING: ExteriorFraming = Object.freeze({
  ...FRAMING,
  fitDistance: 96,
  minDistance: 24,
  maxDistance: 192,
});

const LIMITS: OrbitLimits = getOrbitLimits(FRAMING);
const TARGET: Vector3Like = FRAMING.target;

const IDLE: OrbitIntent = { orbit: 0, tilt: 0, zoom: 0 };
/**
 * A tilt well inside both clearances — about 38° above level with the target, the sort of
 * elevation the framing starts at — so a step in either direction is free to move.
 */
const BASE_POLAR = 0.9;
/** A legal starting pose: out along +z, looking down at the floor, mid-way through the zoom. */
const BASE_POSE: OrbitPose = { azimuth: 0, polar: BASE_POLAR, distance: FRAMING.fitDistance };

function intent(partial: Partial<OrbitIntent>): OrbitIntent {
  return { ...IDLE, ...partial };
}

function pose(partial: Partial<OrbitPose> = {}): OrbitPose {
  return { ...BASE_POSE, ...partial };
}

/** An action that does not exist, as an on-screen control could send it by mistake. */
const UNKNOWN_ACTION = 'roll' as unknown as OrbitAction;

/** The intent of one action alone, per action. */
const SINGLE_ACTION_CASES = [
  ['orbitLeft', { orbit: 1 }],
  ['orbitRight', { orbit: -1 }],
  ['tiltUp', { tilt: 1 }],
  ['tiltDown', { tilt: -1 }],
  ['zoomIn', { zoom: 1 }],
  ['zoomOut', { zoom: -1 }],
] as const satisfies ReadonlyArray<readonly [OrbitAction, Partial<OrbitIntent>]>;

/** The opposite pairs, one per orbit axis. */
const OPPOSITE_ACTION_CASES = [
  ['orbitLeft', 'orbitRight'],
  ['tiltUp', 'tiltDown'],
  ['zoomIn', 'zoomOut'],
] as const satisfies ReadonlyArray<readonly [OrbitAction, OrbitAction]>;

const BOUND_CODES = Object.keys(ORBIT_KEY_BINDINGS);

/**
 * The y component of `before × after` for two camera offsets from the target: positive
 * when the camera has swung counter-clockwise seen from above (a right-handed rotation
 * about +y), negative when clockwise.
 */
function turnDirectionFromAbove(before: Vector3Like, after: Vector3Like): number {
  const beforeX = before.x - TARGET.x;
  const beforeZ = before.z - TARGET.z;
  const afterX = after.x - TARGET.x;
  const afterZ = after.z - TARGET.z;
  return beforeZ * afterX - beforeX * afterZ;
}

describe('orbitNavigation', () => {
  describe('ORBIT_ACTIONS', () => {
    it('lists every orbit action in HUD reading order', () => {
      expect(ORBIT_ACTIONS).toEqual([
        'orbitLeft',
        'orbitRight',
        'tiltUp',
        'tiltDown',
        'zoomIn',
        'zoomOut',
      ]);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ORBIT_ACTIONS)).toBe(true);
    });

    it('holds no duplicate', () => {
      expect(new Set(ORBIT_ACTIONS).size).toBe(ORBIT_ACTIONS.length);
    });

    it('covers exactly the actions the keys are bound to', () => {
      expect(new Set(Object.values(ORBIT_KEY_BINDINGS))).toEqual(new Set(ORBIT_ACTIONS));
    });
  });

  describe('key bindings', () => {
    it('maps every physical key to its action', () => {
      expect(ORBIT_KEY_BINDINGS).toEqual({
        ArrowLeft: 'orbitLeft',
        ArrowRight: 'orbitRight',
        ArrowUp: 'tiltUp',
        ArrowDown: 'tiltDown',
        Equal: 'zoomIn',
        Minus: 'zoomOut',
        NumpadAdd: 'zoomIn',
        NumpadSubtract: 'zoomOut',
      });
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ORBIT_KEY_BINDINGS)).toBe(true);
    });

    it.each(BOUND_CODES)('recognises %s as an orbit navigation key', (code) => {
      expect(isOrbitNavigationKey(code)).toBe(true);
    });

    it.each(['KeyW', 'Space', 'toString', ''])('rejects %j', (code) => {
      expect(isOrbitNavigationKey(code)).toBe(false);
    });

    it('shares no key with the interior eye navigation', () => {
      const eyeCodes = new Set(Object.keys(EYE_KEY_BINDINGS));
      expect(BOUND_CODES.filter((code) => eyeCodes.has(code))).toEqual([]);
    });

    it.each(BOUND_CODES)('leaves %s unbound in the eye navigation', (code) => {
      expect(isEyeNavigationKey(code)).toBe(false);
    });

    it.each(Object.keys(EYE_KEY_BINDINGS))('leaves the eye key %s unbound here', (code) => {
      expect(isOrbitNavigationKey(code)).toBe(false);
    });

    it('leaves the camera mode toggle key free in both navigations', () => {
      expect(BOUND_CODES).not.toContain(CAMERA_MODE_TOGGLE_KEY_CODE);
      expect(Object.keys(EYE_KEY_BINDINGS)).not.toContain(CAMERA_MODE_TOGGLE_KEY_CODE);
      expect(isOrbitNavigationKey(CAMERA_MODE_TOGGLE_KEY_CODE)).toBe(false);
    });
  });

  describe('getOrbitIntent', () => {
    it.each([
      ['ArrowLeft', { orbit: 1 }],
      ['ArrowRight', { orbit: -1 }],
      ['ArrowUp', { tilt: 1 }],
      ['ArrowDown', { tilt: -1 }],
      ['Equal', { zoom: 1 }],
      ['Minus', { zoom: -1 }],
      ['NumpadAdd', { zoom: 1 }],
      ['NumpadSubtract', { zoom: -1 }],
    ] as const)('derives the intent of %s alone', (code, expected) => {
      expect(getOrbitIntent(new Set([code]))).toEqual(intent(expected));
    });

    it.each([
      ['ArrowLeft', 'ArrowRight'],
      ['ArrowUp', 'ArrowDown'],
      ['Equal', 'Minus'],
      ['NumpadAdd', 'NumpadSubtract'],
      ['Equal', 'NumpadSubtract'],
      ['NumpadAdd', 'Minus'],
    ])('cancels %s against %s', (first, second) => {
      expect(getOrbitIntent(new Set([first, second]))).toEqual(IDLE);
    });

    it('counts the two spellings of one zoom action once', () => {
      expect(getOrbitIntent(new Set(['Equal', 'NumpadAdd']))).toEqual(intent({ zoom: 1 }));
    });

    it('ignores unknown codes', () => {
      expect(getOrbitIntent(new Set(['KeyQ', 'KeyW', 'toString', 'ArrowLeft']))).toEqual(
        intent({ orbit: 1 }),
      );
    });

    it('is idle when nothing is pressed', () => {
      expect(getOrbitIntent(new Set())).toEqual(IDLE);
    });

    it('combines actions across every axis', () => {
      expect(getOrbitIntent(new Set(['ArrowLeft', 'ArrowUp', 'Minus']))).toEqual({
        orbit: 1,
        tilt: 1,
        zoom: -1,
      });
    });
  });

  describe('getOrbitIntentFromActions', () => {
    it.each(SINGLE_ACTION_CASES)('derives the intent of %s alone', (action, expected) => {
      expect(getOrbitIntentFromActions([action])).toEqual(intent(expected));
    });

    it.each(OPPOSITE_ACTION_CASES)('cancels %s against %s', (first, second) => {
      expect(getOrbitIntentFromActions([first, second])).toEqual(IDLE);
      expect(getOrbitIntentFromActions([second, first])).toEqual(IDLE);
    });

    it('ignores unknown actions', () => {
      expect(getOrbitIntentFromActions([UNKNOWN_ACTION, 'tiltUp'])).toEqual(intent({ tilt: 1 }));
    });

    it.each([
      ['an empty array', [] as readonly OrbitAction[]],
      ['an empty set', new Set<OrbitAction>()],
    ] as const)('is idle for %s', (_label, actions) => {
      expect(getOrbitIntentFromActions(actions)).toEqual(IDLE);
    });

    it('counts a repeated action once', () => {
      expect(getOrbitIntentFromActions(['orbitLeft', 'orbitLeft'])).toEqual(intent({ orbit: 1 }));
    });

    it('combines actions across every axis', () => {
      expect(getOrbitIntentFromActions(['orbitRight', 'tiltDown', 'zoomIn'])).toEqual({
        orbit: -1,
        tilt: -1,
        zoom: 1,
      });
    });

    it.each(SINGLE_ACTION_CASES)('agrees with the key bound to %s', (action) => {
      const code = BOUND_CODES.find((key) => ORBIT_KEY_BINDINGS[key] === action);
      expect(code).toBeDefined();
      expect(getOrbitIntentFromActions([action])).toEqual(getOrbitIntent(new Set([code ?? ''])));
    });
  });

  describe('getOrbitIntent with actions from another input', () => {
    it('is idle when neither input asks for anything', () => {
      expect(getOrbitIntent(new Set(), [])).toEqual(IDLE);
    });

    it('unions the held keys and the held actions', () => {
      expect(getOrbitIntent(new Set(['ArrowLeft']), ['zoomIn'])).toEqual(
        intent({ orbit: 1, zoom: 1 }),
      );
    });

    it('cancels a key against the opposite action', () => {
      expect(getOrbitIntent(new Set(['ArrowLeft']), ['orbitRight'])).toEqual(IDLE);
      expect(getOrbitIntent(new Set(['NumpadAdd']), ['zoomOut'])).toEqual(IDLE);
    });

    it('counts an action asked for by both inputs once', () => {
      expect(getOrbitIntent(new Set(['ArrowUp']), ['tiltUp'])).toEqual(intent({ tilt: 1 }));
    });

    it('takes the actions alone when no key is held', () => {
      expect(getOrbitIntent(new Set(), ['zoomOut'])).toEqual(intent({ zoom: -1 }));
    });

    it('ignores unknown codes and unknown actions alike', () => {
      expect(getOrbitIntent(new Set(['KeyQ', 'toString']), [UNKNOWN_ACTION])).toEqual(IDLE);
    });

    it('accepts a set of actions, as an on-screen pad store holds them', () => {
      const held: ReadonlySet<OrbitAction> = new Set<OrbitAction>(['tiltDown']);
      expect(getOrbitIntent(new Set(['ArrowLeft']), held)).toEqual(intent({ orbit: 1, tilt: -1 }));
    });
  });

  describe('getOrbitLimits', () => {
    it('takes both distances from the framing', () => {
      expect(getOrbitLimits(FRAMING).minDistance).toBe(FRAMING.minDistance);
      expect(getOrbitLimits(FRAMING).maxDistance).toBe(FRAMING.maxDistance);
    });

    it('follows the framing when it changes, holding no distance of its own', () => {
      const narrow = getOrbitLimits(NARROW_FRAMING);
      expect(narrow.minDistance).toBe(NARROW_FRAMING.minDistance);
      expect(narrow.maxDistance).toBe(NARROW_FRAMING.maxDistance);
      expect(narrow.minDistance).not.toBe(FRAMING.minDistance);
      expect(narrow.maxDistance).not.toBe(FRAMING.maxDistance);
    });

    it('stops the tilt short of the zenith and short of level with the target', () => {
      expect(LIMITS.minPolar).toBe(ORBIT_ZENITH_CLEARANCE_RADIANS);
      expect(LIMITS.maxPolar).toBeCloseTo(
        QUARTER_TURN - ORBIT_GROUND_CLEARANCE_RADIANS,
        EXACT_DIGITS,
      );
    });

    it('keeps the same angular limits whatever the framing', () => {
      expect(getOrbitLimits(NARROW_FRAMING).minPolar).toBe(LIMITS.minPolar);
      expect(getOrbitLimits(NARROW_FRAMING).maxPolar).toBe(LIMITS.maxPolar);
    });

    it('never puts the camera below the ground plane it orbits over', () => {
      const lowest = getOrbitPosition(TARGET, pose({ polar: LIMITS.maxPolar }));
      expect(lowest.y).toBeGreaterThan(TARGET.y);
    });

    it('returns a fresh object on each call', () => {
      const first = getOrbitLimits(FRAMING);
      const second = getOrbitLimits(FRAMING);
      expect(second).not.toBe(first);
      expect(second).toEqual(first);
    });
  });

  describe('stepOrbitPose orbit', () => {
    const delta = ORBIT_NAVIGATION_CONFIG.orbitSpeed * STEP;

    it('orbits left by increasing the azimuth', () => {
      expect(stepOrbitPose(pose(), intent({ orbit: 1 }), STEP, LIMITS).azimuth).toBeCloseTo(
        delta,
        EXACT_DIGITS,
      );
    });

    it('orbits right by decreasing the azimuth', () => {
      expect(stepOrbitPose(pose(), intent({ orbit: -1 }), STEP, LIMITS).azimuth).toBeCloseTo(
        -delta,
        EXACT_DIGITS,
      );
    });

    it('leaves the tilt and the distance alone', () => {
      const next = stepOrbitPose(pose(), intent({ orbit: 1 }), STEP, LIMITS);
      expect(next.polar).toBe(BASE_POSE.polar);
      expect(next.distance).toBe(BASE_POSE.distance);
    });

    it('wraps the azimuth past π into negative angles', () => {
      const dt = ORBIT_NAVIGATION_CONFIG.maxStepSeconds;
      const start = pose({ azimuth: NEAR_SEAM });
      const next = stepOrbitPose(start, intent({ orbit: 1 }), dt, LIMITS);
      expect(next.azimuth).toBeLessThan(0);
      expect(next.azimuth).toBeGreaterThan(-Math.PI);
      expect(next.azimuth).toBeCloseTo(
        start.azimuth + ORBIT_NAVIGATION_CONFIG.orbitSpeed * dt - 2 * Math.PI,
        EXACT_DIGITS,
      );
    });

    it('wraps the azimuth past -π into positive angles', () => {
      const dt = ORBIT_NAVIGATION_CONFIG.maxStepSeconds;
      const start = pose({ azimuth: -NEAR_SEAM });
      const next = stepOrbitPose(start, intent({ orbit: -1 }), dt, LIMITS);
      expect(next.azimuth).toBeGreaterThan(0);
      expect(next.azimuth).toBeLessThanOrEqual(Math.PI);
      expect(next.azimuth).toBeCloseTo(
        start.azimuth - ORBIT_NAVIGATION_CONFIG.orbitSpeed * dt + 2 * Math.PI,
        EXACT_DIGITS,
      );
    });

    it.each([1, -1] as const)('keeps the azimuth within (-π, π] while orbiting %s', (orbit) => {
      let current = pose();
      for (let index = 0; index < MANY_STEPS; index += 1) {
        current = stepOrbitPose(current, intent({ orbit }), STEP, LIMITS);
        expect(current.azimuth).toBeGreaterThan(-Math.PI);
        expect(current.azimuth).toBeLessThanOrEqual(Math.PI);
      }
    });
  });

  describe('stepOrbitPose tilt', () => {
    const delta = ORBIT_NAVIGATION_CONFIG.tiltSpeed * STEP;

    it('tilts up by decreasing the polar angle', () => {
      expect(stepOrbitPose(pose(), intent({ tilt: 1 }), STEP, LIMITS).polar).toBeCloseTo(
        BASE_POSE.polar - delta,
        EXACT_DIGITS,
      );
    });

    it('tilts down by increasing the polar angle', () => {
      expect(stepOrbitPose(pose(), intent({ tilt: -1 }), STEP, LIMITS).polar).toBeCloseTo(
        BASE_POSE.polar + delta,
        EXACT_DIGITS,
      );
    });

    it('raises the camera when it tilts up', () => {
      const start = pose();
      const next = stepOrbitPose(start, intent({ tilt: 1 }), STEP, LIMITS);
      expect(getOrbitPosition(TARGET, next).y).toBeGreaterThan(getOrbitPosition(TARGET, start).y);
    });

    it('lowers the camera when it tilts down', () => {
      const start = pose({ polar: QUARTER_TURN - 0.5 });
      const next = stepOrbitPose(start, intent({ tilt: -1 }), STEP, LIMITS);
      expect(getOrbitPosition(TARGET, next).y).toBeLessThan(getOrbitPosition(TARGET, start).y);
    });

    it.each([
      [1, 'minPolar'],
      [-1, 'maxPolar'],
    ] as const)('clamps the polar angle when tilting %s', (tilt, bound) => {
      let current = pose();
      for (let index = 0; index < MANY_STEPS; index += 1) {
        current = stepOrbitPose(current, intent({ tilt }), STEP, LIMITS);
        expect(current.polar).toBeGreaterThanOrEqual(LIMITS.minPolar);
        expect(current.polar).toBeLessThanOrEqual(LIMITS.maxPolar);
      }
      expect(current.polar).toBe(LIMITS[bound]);
    });
  });

  describe('stepOrbitPose zoom', () => {
    const factor = Math.exp(-ORBIT_NAVIGATION_CONFIG.zoomRate * STEP);

    it('zooms in by scaling the distance down', () => {
      expect(stepOrbitPose(pose(), intent({ zoom: 1 }), STEP, LIMITS).distance).toBeCloseTo(
        BASE_POSE.distance * factor,
        EXACT_DIGITS,
      );
    });

    it('zooms out by scaling the distance up', () => {
      expect(stepOrbitPose(pose(), intent({ zoom: -1 }), STEP, LIMITS).distance).toBeCloseTo(
        BASE_POSE.distance / factor,
        EXACT_DIGITS,
      );
    });

    it('scales by the same factor whatever the distance, rather than by a fixed step', () => {
      const near = pose({ distance: LIMITS.minDistance * 2 });
      const far = pose({ distance: LIMITS.maxDistance / 2 });
      const nearRatio = stepOrbitPose(near, intent({ zoom: 1 }), STEP, LIMITS).distance;
      const farRatio = stepOrbitPose(far, intent({ zoom: 1 }), STEP, LIMITS).distance;
      expect(nearRatio / near.distance).toBeCloseTo(farRatio / far.distance, EXACT_DIGITS);
    });

    it.each([
      [1, 'minDistance'],
      [-1, 'maxDistance'],
    ] as const)('clamps the distance to the framing when zooming %s', (zoom, bound) => {
      let current = pose();
      for (let index = 0; index < MANY_STEPS; index += 1) {
        current = stepOrbitPose(current, intent({ zoom }), STEP, LIMITS);
        expect(current.distance).toBeGreaterThanOrEqual(LIMITS.minDistance);
        expect(current.distance).toBeLessThanOrEqual(LIMITS.maxDistance);
      }
      expect(current.distance).toBe(LIMITS[bound]);
    });

    it('never lets the zoom reach the target', () => {
      let current = pose();
      for (let index = 0; index < MANY_STEPS; index += 1) {
        current = stepOrbitPose(current, intent({ zoom: 1 }), STEP, LIMITS);
      }
      expect(current.distance).toBeGreaterThan(0);
    });
  });

  describe('stepOrbitPose time step', () => {
    const start = pose({ azimuth: 0.5, polar: 1, distance: 30 });
    const everything = intent({ orbit: 1, tilt: 1, zoom: 1 });

    it('caps a long time step at maxStepSeconds', () => {
      const capped = stepOrbitPose(
        start,
        everything,
        ORBIT_NAVIGATION_CONFIG.maxStepSeconds,
        LIMITS,
      );
      const long = stepOrbitPose(start, everything, 10, LIMITS);
      expect(long.azimuth).toBeCloseTo(capped.azimuth, EXACT_DIGITS);
      expect(long.polar).toBeCloseTo(capped.polar, EXACT_DIGITS);
      expect(long.distance).toBeCloseTo(capped.distance, EXACT_DIGITS);
    });

    it.each([0, -1, Number.NaN, Number.NEGATIVE_INFINITY])(
      'leaves the pose unchanged for dt %s',
      (dt) => {
        expect(stepOrbitPose(start, everything, dt, LIMITS)).toEqual(start);
      },
    );

    it('is idle for an idle intent', () => {
      expect(stepOrbitPose(start, IDLE, STEP, LIMITS)).toEqual(start);
    });
  });

  describe('stepOrbitPose sign conventions', () => {
    it('orbits counter-clockwise seen from above when orbiting left', () => {
      const start = pose();
      const next = stepOrbitPose(start, intent({ orbit: 1 }), STEP, LIMITS);
      const before = getOrbitPosition(TARGET, start);
      const after = getOrbitPosition(TARGET, next);

      // From the +z side, counter-clockwise from above swings the camera toward +x.
      expect(before.x).toBeCloseTo(TARGET.x, EXACT_DIGITS);
      expect(after.x).toBeGreaterThan(TARGET.x);
      expect(after.z).toBeLessThan(before.z);
      expect(turnDirectionFromAbove(before, after)).toBeGreaterThan(0);
    });

    it('orbits clockwise seen from above when orbiting right', () => {
      const start = pose();
      const next = stepOrbitPose(start, intent({ orbit: -1 }), STEP, LIMITS);
      const before = getOrbitPosition(TARGET, start);
      const after = getOrbitPosition(TARGET, next);

      expect(after.x).toBeLessThan(TARGET.x);
      expect(turnDirectionFromAbove(before, after)).toBeLessThan(0);
    });

    it('keeps the camera on the sphere while it orbits', () => {
      const start = pose();
      const next = stepOrbitPose(start, intent({ orbit: 1, tilt: 1 }), STEP, LIMITS);
      const after = getOrbitPosition(TARGET, next);
      expect(Math.hypot(after.x - TARGET.x, after.y - TARGET.y, after.z - TARGET.z)).toBeCloseTo(
        next.distance,
        EXACT_DIGITS,
      );
    });
  });

  describe('stepOrbitPose purity', () => {
    it('never mutates the input pose', () => {
      const start = Object.freeze(pose({ azimuth: 1, polar: 1.2, distance: 33 }));
      const snapshot = { ...start };
      const next = stepOrbitPose(start, intent({ orbit: 1, tilt: -1, zoom: 1 }), STEP, LIMITS);
      expect(start).toEqual(snapshot);
      expect(next).not.toBe(start);
    });

    it('gives the same numbers for the same inputs', () => {
      const start = pose({ azimuth: -2, polar: 0.9, distance: 51 });
      const step = intent({ orbit: -1, tilt: 1, zoom: -1 });
      expect(stepOrbitPose(start, step, STEP, LIMITS)).toEqual(
        stepOrbitPose(start, step, STEP, LIMITS),
      );
    });

    it('never mutates the limits', () => {
      const limits = getOrbitLimits(FRAMING);
      const snapshot = { ...limits };
      stepOrbitPose(pose(), intent({ orbit: 1, tilt: 1, zoom: 1 }), STEP, limits);
      expect(limits).toEqual(snapshot);
    });
  });

  describe('clampOrbitPose', () => {
    it('leaves a legal pose as it is', () => {
      const legal = pose({ azimuth: 1.2, polar: 1, distance: 40 });
      expect(clampOrbitPose(legal, LIMITS)).toEqual(legal);
    });

    it.each([
      ['too close', { distance: LIMITS.minDistance / 2 }, { distance: LIMITS.minDistance }],
      ['too far', { distance: LIMITS.maxDistance * 2 }, { distance: LIMITS.maxDistance }],
      ['above the zenith limit', { polar: 0 }, { polar: LIMITS.minPolar }],
      ['below the ground limit', { polar: Math.PI }, { polar: LIMITS.maxPolar }],
    ] as const)('pulls a pose %s back inside the limits', (_label, partial, expected) => {
      expect(clampOrbitPose(pose(partial), LIMITS)).toMatchObject(expected);
    });

    it('wraps an azimuth that has run past the seam', () => {
      const wrapped = clampOrbitPose(pose({ azimuth: Math.PI + 1 }), LIMITS);
      expect(wrapped.azimuth).toBeCloseTo(1 - Math.PI, EXACT_DIGITS);
      expect(wrapped.azimuth).toBeGreaterThan(-Math.PI);
      expect(wrapped.azimuth).toBeLessThanOrEqual(Math.PI);
    });

    it('re-clamps a pose the framing has outgrown, as a resize leaves it', () => {
      // The closest the wide framing allowed is closer than the narrow one's closest.
      const close = pose({ distance: FRAMING.minDistance });
      expect(clampOrbitPose(close, LIMITS).distance).toBe(FRAMING.minDistance);
      expect(clampOrbitPose(close, getOrbitLimits(NARROW_FRAMING)).distance).toBe(
        NARROW_FRAMING.minDistance,
      );
    });

    it('never mutates the input pose and returns a fresh object', () => {
      const start = Object.freeze(pose({ distance: 1000 }));
      const snapshot = { ...start };
      const clamped = clampOrbitPose(start, LIMITS);
      expect(start).toEqual(snapshot);
      expect(clamped).not.toBe(start);
    });

    it('is idempotent', () => {
      const once = clampOrbitPose(pose({ azimuth: 7, polar: -1, distance: 0 }), LIMITS);
      expect(clampOrbitPose(once, LIMITS)).toEqual(once);
    });
  });

  describe('getOrbitPosition', () => {
    const DISTANCE = 20;

    it('puts the camera out along +z at azimuth 0, level with the target', () => {
      const position = getOrbitPosition(
        TARGET,
        pose({ azimuth: 0, polar: QUARTER_TURN, distance: DISTANCE }),
      );
      expect(position.x).toBeCloseTo(TARGET.x, EXACT_DIGITS);
      expect(position.y).toBeCloseTo(TARGET.y, EXACT_DIGITS);
      expect(position.z).toBeCloseTo(TARGET.z + DISTANCE, EXACT_DIGITS);
    });

    it('puts the camera out along +x at azimuth π/2', () => {
      const position = getOrbitPosition(
        TARGET,
        pose({ azimuth: QUARTER_TURN, polar: QUARTER_TURN, distance: DISTANCE }),
      );
      expect(position.x).toBeCloseTo(TARGET.x + DISTANCE, EXACT_DIGITS);
      expect(position.z).toBeCloseTo(TARGET.z, EXACT_DIGITS);
    });

    it('puts the camera straight overhead at polar 0', () => {
      const position = getOrbitPosition(TARGET, pose({ polar: 0, distance: DISTANCE }));
      expect(position.x).toBeCloseTo(TARGET.x, EXACT_DIGITS);
      expect(position.y).toBeCloseTo(TARGET.y + DISTANCE, EXACT_DIGITS);
      expect(position.z).toBeCloseTo(TARGET.z, EXACT_DIGITS);
    });

    it('returns a fresh object on each call', () => {
      const first = getOrbitPosition(TARGET, BASE_POSE);
      const second = getOrbitPosition(TARGET, BASE_POSE);
      expect(second).not.toBe(first);
      expect(second).toEqual(first);
    });
  });

  describe('getOrbitPose', () => {
    it('reads the pose of a camera out along +z', () => {
      const read = getOrbitPose(TARGET, { x: TARGET.x, y: TARGET.y, z: TARGET.z + 20 });
      expect(read.azimuth).toBeCloseTo(0, EXACT_DIGITS);
      expect(read.polar).toBeCloseTo(QUARTER_TURN, EXACT_DIGITS);
      expect(read.distance).toBeCloseTo(20, EXACT_DIGITS);
    });

    it('reads the pose of a camera straight overhead', () => {
      const read = getOrbitPose(TARGET, { x: TARGET.x, y: TARGET.y + 20, z: TARGET.z });
      expect(read.polar).toBeCloseTo(0, EXACT_DIGITS);
      expect(read.distance).toBeCloseTo(20, EXACT_DIGITS);
    });

    it('gives a level pose out along +z for a camera sitting on the target', () => {
      expect(getOrbitPose(TARGET, TARGET)).toEqual({
        azimuth: 0,
        polar: QUARTER_TURN,
        distance: 0,
      });
    });

    it('reads the framing start position as a legal pose', () => {
      const read = getOrbitPose(FRAMING.target, FRAMING.position);
      expect(read.azimuth).toBeGreaterThan(-Math.PI);
      expect(read.azimuth).toBeLessThanOrEqual(Math.PI);
      expect(read.polar).toBeGreaterThanOrEqual(0);
      expect(read.polar).toBeLessThanOrEqual(Math.PI);
      expect(read.distance).toBeGreaterThan(0);
    });
  });

  describe('getOrbitPose round trip', () => {
    const ROUND_TRIP_POSES = [
      ['level, out along +z', { azimuth: 0, polar: QUARTER_TURN, distance: 20 }],
      ['the base pose', BASE_POSE],
      ['a quarter turn round', { azimuth: QUARTER_TURN, polar: 1.1, distance: 37.5 }],
      ['a negative azimuth', { azimuth: -2.3, polar: 0.8, distance: 12.25 }],
      ['near the zenith limit', { azimuth: 3, polar: LIMITS.minPolar, distance: 80 }],
      ['near the ground limit', { azimuth: -0.4, polar: LIMITS.maxPolar, distance: 10 }],
      ['the framing start pose', getOrbitPose(FRAMING.target, FRAMING.position)],
    ] as const satisfies ReadonlyArray<readonly [string, OrbitPose]>;

    it.each(ROUND_TRIP_POSES)('recovers %s from its position', (_label, original) => {
      const read = getOrbitPose(TARGET, getOrbitPosition(TARGET, original));
      expect(read.azimuth).toBeCloseTo(original.azimuth, ROUND_TRIP_DIGITS);
      expect(read.polar).toBeCloseTo(original.polar, ROUND_TRIP_DIGITS);
      expect(read.distance).toBeCloseTo(original.distance, ROUND_TRIP_DIGITS);
    });

    it.each(ROUND_TRIP_POSES)('recovers the position of %s from its pose', (_label, original) => {
      const position = getOrbitPosition(TARGET, original);
      const again = getOrbitPosition(TARGET, getOrbitPose(TARGET, position));
      expect(again.x).toBeCloseTo(position.x, ROUND_TRIP_DIGITS);
      expect(again.y).toBeCloseTo(position.y, ROUND_TRIP_DIGITS);
      expect(again.z).toBeCloseTo(position.z, ROUND_TRIP_DIGITS);
    });

    it('round trips about an origin target too', () => {
      const origin: Vector3Like = { x: 0, y: 0, z: 0 };
      const original = pose({ azimuth: 1.7, polar: 0.6, distance: 55 });
      const read = getOrbitPose(origin, getOrbitPosition(origin, original));
      expect(read.azimuth).toBeCloseTo(original.azimuth, ROUND_TRIP_DIGITS);
      expect(read.polar).toBeCloseTo(original.polar, ROUND_TRIP_DIGITS);
      expect(read.distance).toBeCloseTo(original.distance, ROUND_TRIP_DIGITS);
    });

    it('survives a whole orbit one step at a time', () => {
      let current = pose();
      for (let index = 0; index < MANY_STEPS; index += 1) {
        current = stepOrbitPose(current, intent({ orbit: 1 }), STEP, LIMITS);
        const read = getOrbitPose(TARGET, getOrbitPosition(TARGET, current));
        expect(read.polar).toBeCloseTo(current.polar, ROUND_TRIP_DIGITS);
        expect(read.distance).toBeCloseTo(current.distance, ROUND_TRIP_DIGITS);
      }
    });
  });

  describe('ORBIT_NAVIGATION_CONFIG', () => {
    it('holds the default tuning', () => {
      expect(ORBIT_NAVIGATION_CONFIG.orbitSpeed).toBeCloseTo(Math.PI / 3, EXACT_DIGITS);
      expect(ORBIT_NAVIGATION_CONFIG.tiltSpeed).toBeCloseTo(Math.PI / 4, EXACT_DIGITS);
      expect(ORBIT_NAVIGATION_CONFIG.zoomRate).toBe(0.8);
      expect(ORBIT_NAVIGATION_CONFIG.maxStepSeconds).toBe(0.1);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ORBIT_NAVIGATION_CONFIG)).toBe(true);
    });

    it('accepts a caller-supplied tuning', () => {
      const slow = { ...ORBIT_NAVIGATION_CONFIG, orbitSpeed: 1, maxStepSeconds: 1 };
      expect(stepOrbitPose(pose(), intent({ orbit: 1 }), 0.5, LIMITS, slow).azimuth).toBeCloseTo(
        0.5,
        EXACT_DIGITS,
      );
    });
  });

  describe('clearances', () => {
    it('keeps the tilt range wide enough to be worth having', () => {
      expect(ORBIT_GROUND_CLEARANCE_RADIANS).toBeGreaterThan(0);
      expect(ORBIT_ZENITH_CLEARANCE_RADIANS).toBeGreaterThan(0);
      expect(LIMITS.maxPolar - LIMITS.minPolar).toBeGreaterThan(1);
    });
  });
});
