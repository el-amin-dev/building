import { describe, expect, it } from 'vitest';
import {
  createInitialEyePose,
  EYE_KEY_BINDINGS,
  EYE_NAVIGATION_CONFIG,
  getMovementIntent,
  isEyeNavigationKey,
  stepEyePose,
} from './eyeNavigation.ts';
import type { EyePose, MovementIntent } from './eyeNavigation.ts';
import type { PlanRect } from './planGeometry.ts';

const HALF_EXTENT = 5;
const BOUNDS: PlanRect = {
  minX: -HALF_EXTENT,
  maxX: HALF_EXTENT,
  minZ: -HALF_EXTENT,
  maxZ: HALF_EXTENT,
};
const STEP = 0.05;
const MANY_STEPS = 200;
const NEAR_EDGE = HALF_EXTENT - 0.01;

const IDLE: MovementIntent = { move: 0, strafe: 0, turn: 0, look: 0 };
const ORIGIN_POSE: EyePose = { x: 0, z: 0, yaw: 0, pitch: 0 };

/** Walkable bounds of the base chamber: 5.00 × 3.40 m clear shrunk by 0.25 m. */
const BASE_WALKABLE_HALF_WIDTH = 2.25;
const BASE_WALKABLE_HALF_DEPTH = 1.45;
const BASE_WALKABLE_BOUNDS: PlanRect = {
  minX: -BASE_WALKABLE_HALF_WIDTH,
  maxX: BASE_WALKABLE_HALF_WIDTH,
  minZ: -BASE_WALKABLE_HALF_DEPTH,
  maxZ: BASE_WALKABLE_HALF_DEPTH,
};
const OFFSET_BOUNDS: PlanRect = { minX: -1, maxX: 3, minZ: 2, maxZ: 4.5 };
const THIN_BOUNDS: PlanRect = { minX: 1, maxX: 1, minZ: -2, maxZ: 3 };
const SHALLOW_BOUNDS: PlanRect = { minX: -4, maxX: 2, minZ: 0.5, maxZ: 0.5 };
const DEGENERATE_BOUNDS: PlanRect = { minX: 1.5, maxX: 1.5, minZ: -0.5, maxZ: -0.5 };

function intent(partial: Partial<MovementIntent>): MovementIntent {
  return { ...IDLE, ...partial };
}

function pose(partial: Partial<EyePose> = {}): EyePose {
  return { ...ORIGIN_POSE, ...partial };
}

function displacement(from: EyePose, to: EyePose): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

describe('eyeNavigation', () => {
  describe('key bindings', () => {
    it('maps every physical key to its action', () => {
      expect(EYE_KEY_BINDINGS).toEqual({
        KeyW: 'moveForward',
        KeyS: 'moveBackward',
        KeyA: 'strafeLeft',
        KeyD: 'strafeRight',
        KeyJ: 'turnLeft',
        KeyL: 'turnRight',
        KeyI: 'lookUp',
        KeyK: 'lookDown',
      });
    });

    it('is frozen', () => {
      expect(Object.isFrozen(EYE_KEY_BINDINGS)).toBe(true);
    });

    it.each(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyJ', 'KeyL', 'KeyI', 'KeyK'])(
      'recognises %s as a navigation key',
      (code) => {
        expect(isEyeNavigationKey(code)).toBe(true);
      },
    );

    it.each(['ArrowUp', 'KeyQ', 'toString', ''])('rejects %j', (code) => {
      expect(isEyeNavigationKey(code)).toBe(false);
    });
  });

  describe('getMovementIntent', () => {
    it.each([
      ['KeyW', { move: 1 }],
      ['KeyS', { move: -1 }],
      ['KeyD', { strafe: 1 }],
      ['KeyA', { strafe: -1 }],
      ['KeyJ', { turn: 1 }],
      ['KeyL', { turn: -1 }],
      ['KeyI', { look: 1 }],
      ['KeyK', { look: -1 }],
    ] as const)('derives the intent of %s alone', (code, expected) => {
      expect(getMovementIntent(new Set([code]))).toEqual(intent(expected));
    });

    it.each([
      ['KeyW', 'KeyS'],
      ['KeyA', 'KeyD'],
      ['KeyJ', 'KeyL'],
      ['KeyI', 'KeyK'],
    ])('cancels %s against %s', (first, second) => {
      expect(getMovementIntent(new Set([first, second]))).toEqual(IDLE);
    });

    it('ignores unknown codes', () => {
      expect(getMovementIntent(new Set(['KeyQ', 'ArrowUp', 'toString', 'KeyW']))).toEqual(
        intent({ move: 1 }),
      );
    });

    it('is idle when nothing is pressed', () => {
      expect(getMovementIntent(new Set())).toEqual(IDLE);
    });
  });

  describe('createInitialEyePose', () => {
    const NON_DEGENERATE_CASES = [
      ['the base walkable bounds', BASE_WALKABLE_BOUNDS],
      ['off-centre bounds', OFFSET_BOUNDS],
      ['bounds with zero width', THIN_BOUNDS],
      ['bounds with zero depth', SHALLOW_BOUNDS],
    ] as const;

    it.each(NON_DEGENERATE_CASES)('starts in the (maxX, maxZ) corner of %s', (_label, bounds) => {
      const start = createInitialEyePose(bounds);
      expect(start.x).toBe(bounds.maxX);
      expect(start.z).toBe(bounds.maxZ);
      expect(start.pitch).toBe(0);
    });

    it.each(NON_DEGENERATE_CASES)('faces the opposite corner of %s', (_label, bounds) => {
      const { yaw } = createInitialEyePose(bounds);
      const towardX = bounds.minX - bounds.maxX;
      const towardZ = bounds.minZ - bounds.maxZ;
      const length = Math.hypot(towardX, towardZ);
      expect(-Math.sin(yaw)).toBeCloseTo(towardX / length);
      expect(-Math.cos(yaw)).toBeCloseTo(towardZ / length);
      expect(yaw).toBeGreaterThan(-Math.PI);
      expect(yaw).toBeLessThanOrEqual(Math.PI);
    });

    it('gives the base walkable bounds a yaw of atan2(4.5, 2.9)', () => {
      const { yaw } = createInitialEyePose(BASE_WALKABLE_BOUNDS);
      expect(yaw).toBeCloseTo(
        Math.atan2(2 * BASE_WALKABLE_HALF_WIDTH, 2 * BASE_WALKABLE_HALF_DEPTH),
      );
    });

    it('uses yaw 0 when the bounds have zero width and zero depth', () => {
      expect(createInitialEyePose(DEGENERATE_BOUNDS)).toEqual({
        x: DEGENERATE_BOUNDS.maxX,
        z: DEGENERATE_BOUNDS.maxZ,
        yaw: 0,
        pitch: 0,
      });
    });

    it('returns a fresh object on each call', () => {
      const first = createInitialEyePose(BASE_WALKABLE_BOUNDS);
      const second = createInitialEyePose(BASE_WALKABLE_BOUNDS);
      expect(second).not.toBe(first);
      expect(second).toEqual(first);
    });
  });

  describe('stepEyePose movement', () => {
    const distance = EYE_NAVIGATION_CONFIG.walkSpeed * STEP;

    it('walks forward toward -z at yaw 0', () => {
      const next = stepEyePose(pose(), intent({ move: 1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(-distance);
    });

    it('walks backward toward +z at yaw 0', () => {
      const next = stepEyePose(pose(), intent({ move: -1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(distance);
    });

    it('strafes right toward +x at yaw 0', () => {
      const next = stepEyePose(pose(), intent({ strafe: 1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo(distance);
      expect(next.z).toBeCloseTo(0);
    });

    it('walks forward toward -x at yaw π/2', () => {
      const next = stepEyePose(pose({ yaw: Math.PI / 2 }), intent({ move: 1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo(-distance);
      expect(next.z).toBeCloseTo(0);
    });

    it('walks forward toward +x at yaw -π/2', () => {
      const next = stepEyePose(pose({ yaw: -Math.PI / 2 }), intent({ move: 1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo(distance);
      expect(next.z).toBeCloseTo(0);
    });

    it('strafes right toward -z at yaw π/2', () => {
      const next = stepEyePose(pose({ yaw: Math.PI / 2 }), intent({ strafe: 1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(-distance);
    });

    it('strafes left toward -z at yaw -π/2', () => {
      const next = stepEyePose(pose({ yaw: -Math.PI / 2 }), intent({ strafe: -1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(-distance);
    });

    it('walks forward and strafes right along the normalised sum at yaw π/6', () => {
      const yaw = Math.PI / 6;
      const sumX = -Math.sin(yaw) + Math.cos(yaw);
      const sumZ = -Math.cos(yaw) - Math.sin(yaw);
      const length = Math.hypot(sumX, sumZ);
      const next = stepEyePose(pose({ yaw }), intent({ move: 1, strafe: 1 }), STEP, BOUNDS);
      expect(next.x).toBeCloseTo((sumX / length) * distance);
      expect(next.z).toBeCloseTo((sumZ / length) * distance);
    });

    it('moves diagonally no faster than straight', () => {
      const start = pose();
      const straight = stepEyePose(start, intent({ move: 1 }), STEP, BOUNDS);
      const diagonal = stepEyePose(start, intent({ move: 1, strafe: 1 }), STEP, BOUNDS);
      expect(displacement(start, diagonal)).toBeCloseTo(displacement(start, straight));
    });
  });

  describe('stepEyePose time step', () => {
    const start = pose({ x: 1, z: -2, yaw: 0.5, pitch: 0.2 });
    const everything = intent({ move: 1, strafe: 1, turn: 1, look: 1 });

    it('caps a long time step at maxStepSeconds', () => {
      const capped = stepEyePose(start, everything, EYE_NAVIGATION_CONFIG.maxStepSeconds, BOUNDS);
      const long = stepEyePose(start, everything, 5, BOUNDS);
      expect(long.x).toBeCloseTo(capped.x);
      expect(long.z).toBeCloseTo(capped.z);
      expect(long.yaw).toBeCloseTo(capped.yaw);
      expect(long.pitch).toBeCloseTo(capped.pitch);
    });

    it.each([-1, Number.NaN, Number.NEGATIVE_INFINITY])(
      'leaves the pose unchanged for dt %s',
      (dt) => {
        expect(stepEyePose(start, everything, dt, BOUNDS)).toEqual(start);
      },
    );
  });

  describe('stepEyePose wall clamping', () => {
    it.each([
      ['maxX', pose({ x: NEAR_EDGE }), intent({ strafe: 1 }), { x: BOUNDS.maxX }],
      ['minX', pose({ x: -NEAR_EDGE }), intent({ strafe: -1 }), { x: BOUNDS.minX }],
      ['maxZ', pose({ z: NEAR_EDGE }), intent({ move: -1 }), { z: BOUNDS.maxZ }],
      ['minZ', pose({ z: -NEAR_EDGE }), intent({ move: 1 }), { z: BOUNDS.minZ }],
    ] as const)('stops at %s', (_side, start, push, expected) => {
      const next = stepEyePose(start, push, EYE_NAVIGATION_CONFIG.maxStepSeconds, BOUNDS);
      expect(next).toMatchObject(expected);
    });
  });

  describe('stepEyePose orientation', () => {
    it('turns left by increasing yaw', () => {
      const next = stepEyePose(pose(), intent({ turn: 1 }), STEP, BOUNDS);
      expect(next.yaw).toBeCloseTo(EYE_NAVIGATION_CONFIG.turnSpeed * STEP);
    });

    it('wraps yaw past π into negative angles', () => {
      const start = pose({ yaw: Math.PI - 0.01 });
      const dt = EYE_NAVIGATION_CONFIG.maxStepSeconds;
      const next = stepEyePose(start, intent({ turn: 1 }), dt, BOUNDS);
      expect(next.yaw).toBeLessThan(0);
      expect(next.yaw).toBeGreaterThan(-Math.PI);
      expect(next.yaw).toBeCloseTo(start.yaw + EYE_NAVIGATION_CONFIG.turnSpeed * dt - 2 * Math.PI);
    });

    it('keeps yaw within (-π, π] while turning continuously', () => {
      let current = pose();
      for (let i = 0; i < MANY_STEPS; i += 1) {
        current = stepEyePose(current, intent({ turn: -1 }), STEP, BOUNDS);
        expect(current.yaw).toBeGreaterThan(-Math.PI);
        expect(current.yaw).toBeLessThanOrEqual(Math.PI);
      }
    });

    it.each([
      [1, EYE_NAVIGATION_CONFIG.maxPitch],
      [-1, -EYE_NAVIGATION_CONFIG.maxPitch],
    ] as const)('clamps pitch when looking %s', (look, limit) => {
      let current = pose();
      for (let i = 0; i < MANY_STEPS; i += 1) {
        current = stepEyePose(current, intent({ look }), STEP, BOUNDS);
      }
      expect(current.pitch).toBeCloseTo(limit);
    });
  });

  it('never mutates the input pose', () => {
    const start = Object.freeze(pose({ x: 1, z: 1, yaw: 1, pitch: 0.1 }));
    const snapshot = { ...start };
    const next = stepEyePose(start, intent({ move: 1, strafe: 1, turn: 1, look: 1 }), STEP, BOUNDS);
    expect(start).toEqual(snapshot);
    expect(next).not.toBe(start);
  });

  describe('EYE_NAVIGATION_CONFIG', () => {
    it('holds the default tuning', () => {
      expect(EYE_NAVIGATION_CONFIG.walkSpeed).toBe(1.4);
      expect(EYE_NAVIGATION_CONFIG.turnSpeed).toBeCloseTo(Math.PI / 2);
      expect(EYE_NAVIGATION_CONFIG.lookSpeed).toBeCloseTo(Math.PI / 3);
      expect(EYE_NAVIGATION_CONFIG.maxPitch).toBeCloseTo((80 * Math.PI) / 180);
      expect(EYE_NAVIGATION_CONFIG.maxStepSeconds).toBe(0.1);
      expect(EYE_NAVIGATION_CONFIG.bodyRadius).toBe(0.25);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(EYE_NAVIGATION_CONFIG)).toBe(true);
    });
  });
});
