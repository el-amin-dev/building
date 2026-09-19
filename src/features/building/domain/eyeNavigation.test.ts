import { describe, expect, it } from 'vitest';
import { makeWalkField } from './collision.ts';
import type { WalkField } from './collision.ts';
import {
  clampStep,
  createArrivalPose,
  EYE_ACTIONS,
  EYE_KEY_BINDINGS,
  EYE_NAVIGATION_CONFIG,
  getEyeLevel,
  getFootLevel,
  getIntentFromActions,
  getMovementIntent,
  getSurfaceField,
  isEyeNavigationKey,
  placeInStack,
  stepEyePose,
  wrapAngle,
} from './eyeNavigation.ts';
import type { EyeAction, EyePose, EyeStep, MovementIntent, WalkSurface } from './eyeNavigation.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';
import { LENGTH_TOLERANCE, makeRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { getStairsLayout, getStairwell } from './stairs.ts';
import type { StairsArrival } from './stairs.ts';
import type { Stairwell } from './stairwell.ts';

/** Radius of the body the navigation moves, in metres. */
const BODY_RADIUS = EYE_NAVIGATION_CONFIG.bodyRadius;

/** Half the width and half the depth of the square test room's clear floor, in metres. */
const ROOM_HALF_EXTENT = 5;
/** Thickness of the walls built around a test room, in metres. */
const WALL_THICKNESS = 0.2;
/**
 * Furthest from the room's centre the body's centre may stand, in metres: the
 * inner wall face less the body radius. The walls are what stop the body, so
 * this is a consequence of the field rather than a bound handed to the step.
 */
const WALK_LIMIT = ROOM_HALF_EXTENT - BODY_RADIUS;
/** A stance one centimetre short of the wall: a single step closes it. */
const NEAR_LIMIT = WALK_LIMIT - 0.01;

/** Clear floor of the square test room. */
const ROOM_FLOOR: PlanRect = makeRect(
  -ROOM_HALF_EXTENT,
  ROOM_HALF_EXTENT,
  -ROOM_HALF_EXTENT,
  ROOM_HALF_EXTENT,
);

/**
 * Builds the four walls that enclose a floor rectangle, each standing outside it.
 *
 * @param rect - The clear floor to enclose.
 * @param thickness - Wall thickness, in metres.
 * @returns The minZ, maxZ, minX and maxX walls, in that order.
 */
function surround(rect: PlanRect, thickness: number): readonly PlanRect[] {
  return [
    makeRect(rect.minX - thickness, rect.maxX + thickness, rect.minZ - thickness, rect.minZ),
    makeRect(rect.minX - thickness, rect.maxX + thickness, rect.maxZ, rect.maxZ + thickness),
    makeRect(rect.minX - thickness, rect.minX, rect.minZ, rect.maxZ),
    makeRect(rect.maxX, rect.maxX + thickness, rect.minZ, rect.maxZ),
  ];
}

/** The square test room: one floor rectangle, four walls around it. */
const ROOM_FIELD: WalkField = makeWalkField([ROOM_FLOOR], surround(ROOM_FLOOR, WALL_THICKNESS));

/** Faces of a partition standing across the middle of the room's floor, in metres. */
const PARTITION_MIN_Z = 0;
const PARTITION_MAX_Z = PARTITION_MIN_Z + WALL_THICKNESS;
/** Where a body walking toward −z is stopped by that partition, in metres. */
const PARTITION_STOP_Z = PARTITION_MAX_Z + BODY_RADIUS;

/** The same room, cut in two by a solid partition: no way from one half to the other. */
const PARTITIONED_FIELD: WalkField = makeWalkField(
  [ROOM_FLOOR],
  [
    ...surround(ROOM_FLOOR, WALL_THICKNESS),
    makeRect(-ROOM_HALF_EXTENT, ROOM_HALF_EXTENT, PARTITION_MIN_Z, PARTITION_MAX_Z),
  ],
);

/** Half the width of the doorway left in the partition, in metres: 1.00 m for a 0.50 m body. */
const DOORWAY_HALF_WIDTH = 0.5;

/** The same partition with a doorway punched in it, centred on x 0. */
const DOORWAY_FIELD: WalkField = makeWalkField(
  [ROOM_FLOOR],
  [
    ...surround(ROOM_FLOOR, WALL_THICKNESS),
    makeRect(-ROOM_HALF_EXTENT, -DOORWAY_HALF_WIDTH, PARTITION_MIN_Z, PARTITION_MAX_Z),
    makeRect(DOORWAY_HALF_WIDTH, ROOM_HALF_EXTENT, PARTITION_MIN_Z, PARTITION_MAX_Z),
  ],
);

const STEP = 0.05;
const MANY_STEPS = 200;
const QUARTER_TURN = Math.PI / 2;

/** Storey pitch of the stack being walked, in metres. */
const FLOOR_TO_FLOOR = FLOOR_HEIGHTS.floorToFloor;

/** The storey a synthetic pose stands on unless the case says otherwise. */
const GROUND_FLOOR = 1;

/** The real stair of the typical floor, and the surfaces it offers a walker. */
const REAL_LAYOUT = getStairsLayout();
const REAL_WELL: Stairwell = getStairwell(REAL_LAYOUT, FLOOR_HEIGHTS, {
  hasAbove: true,
  hasBelow: true,
});

/** How far a body may step up or down to reach a surface, in metres: the real stair's. */
const REACH = REAL_WELL.reach;

/**
 * A bay far from every synthetic test room, so a plain-floor case never meets a
 * stair: the surfaces below are then the flat storey the old tests walked.
 */
const FAR_AWAY = 1000;
const NO_STAIR_WELL: Stairwell = Object.freeze({
  bay: makeRect(FAR_AWAY, FAR_AWAY + 1, FAR_AWAY, FAR_AWAY + 1),
  ramps: [],
  landings: [],
  reach: REACH,
});

/**
 * Wraps a plan field as a walking surface.
 *
 * @param field - The field outside the bay.
 * @param well - The stairwell; none anywhere near, by default.
 * @param bayField - The field inside the bay; the same one, by default.
 * @returns The surface `stepEyePose` walks.
 */
function surfaceOf(
  field: WalkField,
  well: Stairwell = NO_STAIR_WELL,
  bayField: WalkField = field,
): WalkSurface {
  return { field, bayField, well, floorToFloor: FLOOR_TO_FLOOR };
}

/** The square test room as a surface, with no stair in it. */
const ROOM_SURFACE: WalkSurface = surfaceOf(ROOM_FIELD);
const PARTITIONED_SURFACE: WalkSurface = surfaceOf(PARTITIONED_FIELD);
const DOORWAY_SURFACE: WalkSurface = surfaceOf(DOORWAY_FIELD);

const IDLE: MovementIntent = { move: 0, strafe: 0, turn: 0, look: 0 };
const ORIGIN_POSE: EyePose = { x: 0, z: 0, yaw: 0, pitch: 0, floor: GROUND_FLOOR, rise: 0 };

function intent(partial: Partial<MovementIntent>): MovementIntent {
  return { ...IDLE, ...partial };
}

function pose(partial: Partial<EyePose> = {}): EyePose {
  return { ...ORIGIN_POSE, ...partial };
}

/** Steps the pose once on a surface, defaulting to the empty square room. */
function walk(
  from: EyePose,
  moves: Partial<MovementIntent>,
  dtSeconds: number = STEP,
  surface: WalkSurface = ROOM_SURFACE,
): EyeStep {
  return stepEyePose(from, intent(moves), dtSeconds, surface);
}

/** Walks until the body stops making progress, and returns where it ended up. */
function walkUntilStopped(
  from: EyePose,
  moves: Partial<MovementIntent>,
  surface: WalkSurface,
): EyePose {
  let current = from;
  for (let i = 0; i < MANY_STEPS; i += 1) {
    current = walk(current, moves, EYE_NAVIGATION_CONFIG.maxStepSeconds, surface).pose;
  }
  return current;
}

function displacement(from: EyePose, to: EyePose): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/**
 * The real stair as a surface: inside the bay every footprint of the stair is
 * floor and nothing blocks the plan, outside it the whole bay is the hole the
 * stair hangs in. Only blockers are consulted, so the outside field needs no
 * floor rectangles of its own.
 */
const STAIR_SURFACE: WalkSurface = surfaceOf(
  makeWalkField([], [REAL_LAYOUT.bay]),
  REAL_WELL,
  makeWalkField([REAL_LAYOUT.bay], []),
);

/** Where a person lands on the ground storey of the real stair. */
const STAIR_START: EyePose = createArrivalPose(REAL_LAYOUT.arrival, GROUND_FLOOR);

/** The flight climbed out of a storey: the ramp whose low end is that storey's own floor. */
const [FLIGHT_UP] = REAL_WELL.ramps.filter((ramp) => Math.abs(ramp.lowLevel) <= LENGTH_TOLERANCE);

/** One frame of a scripted walk, in seconds: the longest step the navigation simulates. */
const FRAME_SECONDS = EYE_NAVIGATION_CONFIG.maxStepSeconds;

/** Frames a stance is held for to prove it is a stance and not a wobble. */
const IDLE_FRAMES = 100;

/** The four headings the scripted walks use; forward is `(−sin yaw, −cos yaw)`. */
const TOWARD_MINUS_Z = 0;
const TOWARD_PLUS_Z = Math.PI;
const TOWARD_MINUS_X = QUARTER_TURN;
const TOWARD_PLUS_X = -QUARTER_TURN;

/** One leg of a scripted walk: a heading, and how many frames to hold it. */
interface Leg {
  /** The heading walked, in radians. */
  readonly yaw: number;
  /** How many frames of `move: +1` to walk on it. */
  readonly frames: number;
}

/** What a scripted walk did: where it ended up, and every step it took getting there. */
interface Walked {
  /** The pose the walk ended at. */
  readonly pose: EyePose;
  /** Every step of the walk, in order. */
  readonly steps: readonly EyeStep[];
}

/**
 * Walks a scripted route: each leg faces a heading and holds `move: +1`.
 *
 * The heading is set on the pose rather than steered with the turn intent, so
 * the route is exactly reproducible and every assertion is about the climb
 * rather than about how well the turn was timed.
 *
 * @param from - Where the walk starts.
 * @param legs - The legs to walk, in order.
 * @param surface - The surface walked.
 * @returns The final pose and every step taken.
 */
function walkLegs(from: EyePose, legs: readonly Leg[], surface: WalkSurface): Walked {
  const steps: EyeStep[] = [];
  let current = from;
  for (const leg of legs) {
    current = { ...current, yaw: leg.yaw };
    for (let frame = 0; frame < leg.frames; frame += 1) {
      const step = stepEyePose(current, intent({ move: 1 }), FRAME_SECONDS, surface);
      steps.push(step);
      current = step.pose;
    }
  }
  return { pose: current, steps };
}

/** Holds a pose still for a while and returns where it ends up. */
function standStill(at: EyePose, surface: WalkSurface): EyePose {
  let current = at;
  for (let frame = 0; frame < IDLE_FRAMES; frame += 1) {
    current = stepEyePose(current, IDLE, FRAME_SECONDS, surface).pose;
  }
  return current;
}

/**
 * Up one storey of the real stair: off the arrival landing onto flight A, west
 * up flight A, south across the half-landing, then east up flight B and onto the
 * landing of the storey above. The half-turn is why it takes four legs.
 */
const CLIMB: readonly Leg[] = [
  { yaw: TOWARD_MINUS_Z, frames: 4 },
  { yaw: TOWARD_MINUS_X, frames: 20 },
  { yaw: TOWARD_PLUS_Z, frames: 8 },
  { yaw: TOWARD_PLUS_X, frames: 18 },
];

/** The legs of {@link CLIMB} that end on the half-landing, halfway up. */
const HALFWAY_UP: readonly Leg[] = CLIMB.slice(0, 3);

/** Down one storey: the same half-turn walked the other way. */
const DESCENT: readonly Leg[] = [
  { yaw: TOWARD_MINUS_X, frames: 18 },
  { yaw: TOWARD_MINUS_Z, frames: 8 },
  { yaw: TOWARD_PLUS_X, frames: 18 },
];

/** An action that does not exist, as an on-screen control could send it by mistake. */
const UNKNOWN_ACTION = 'jump' as unknown as EyeAction;

/** The intent of one action alone, per action. */
const SINGLE_ACTION_CASES = [
  ['moveForward', { move: 1 }],
  ['moveBackward', { move: -1 }],
  ['strafeRight', { strafe: 1 }],
  ['strafeLeft', { strafe: -1 }],
  ['turnLeft', { turn: 1 }],
  ['turnRight', { turn: -1 }],
  ['lookUp', { look: 1 }],
  ['lookDown', { look: -1 }],
] as const satisfies ReadonlyArray<readonly [EyeAction, Partial<MovementIntent>]>;

/** The opposite pairs, one per navigation axis. */
const OPPOSITE_ACTION_CASES = [
  ['moveForward', 'moveBackward'],
  ['strafeLeft', 'strafeRight'],
  ['turnLeft', 'turnRight'],
  ['lookUp', 'lookDown'],
] as const satisfies ReadonlyArray<readonly [EyeAction, EyeAction]>;

describe('eyeNavigation', () => {
  describe('EYE_ACTIONS', () => {
    it('lists every navigation action', () => {
      expect(EYE_ACTIONS).toEqual([
        'moveForward',
        'moveBackward',
        'strafeLeft',
        'strafeRight',
        'turnLeft',
        'turnRight',
        'lookUp',
        'lookDown',
      ]);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(EYE_ACTIONS)).toBe(true);
    });

    it('holds no duplicate', () => {
      expect(new Set(EYE_ACTIONS).size).toBe(EYE_ACTIONS.length);
    });

    it('covers exactly the actions the keys are bound to', () => {
      expect(new Set(Object.values(EYE_KEY_BINDINGS))).toEqual(new Set(EYE_ACTIONS));
    });
  });

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

  describe('getIntentFromActions', () => {
    it.each(SINGLE_ACTION_CASES)('derives the intent of %s alone', (action, expected) => {
      expect(getIntentFromActions([action])).toEqual(intent(expected));
    });

    it.each(OPPOSITE_ACTION_CASES)('cancels %s against %s', (first, second) => {
      expect(getIntentFromActions([first, second])).toEqual(IDLE);
      expect(getIntentFromActions([second, first])).toEqual(IDLE);
    });

    it('ignores unknown actions', () => {
      expect(getIntentFromActions([UNKNOWN_ACTION, 'moveForward'])).toEqual(intent({ move: 1 }));
    });

    it.each([
      ['an empty array', [] as readonly EyeAction[]],
      ['an empty set', new Set<EyeAction>()],
    ] as const)('is idle for %s', (_label, actions) => {
      expect(getIntentFromActions(actions)).toEqual(IDLE);
    });

    it('counts a repeated action once', () => {
      expect(getIntentFromActions(['turnLeft', 'turnLeft'])).toEqual(intent({ turn: 1 }));
    });

    it('combines actions across every axis', () => {
      expect(getIntentFromActions(['moveForward', 'strafeRight', 'turnLeft', 'lookDown'])).toEqual({
        move: 1,
        strafe: 1,
        turn: 1,
        look: -1,
      });
    });

    it.each(SINGLE_ACTION_CASES)('agrees with the key bound to %s', (action) => {
      const code = Object.keys(EYE_KEY_BINDINGS).find((key) => EYE_KEY_BINDINGS[key] === action);
      expect(code).toBeDefined();
      expect(getIntentFromActions([action])).toEqual(getMovementIntent(new Set([code ?? ''])));
    });

    it('yields nothing but the signs -1, 0 and 1, whatever is held', () => {
      const everything = getIntentFromActions([...EYE_ACTIONS]);
      const held = getIntentFromActions(['moveForward', 'strafeRight']);
      for (const value of [...Object.values(everything), ...Object.values(held)]) {
        expect([-1, 0, 1]).toContain(value);
      }
    });
  });

  describe('getMovementIntent with actions from another input', () => {
    it('is idle when neither input asks for anything', () => {
      expect(getMovementIntent(new Set(), [])).toEqual(IDLE);
    });

    it('unions the held keys and the held actions', () => {
      expect(getMovementIntent(new Set(['KeyW']), ['turnLeft'])).toEqual(
        intent({ move: 1, turn: 1 }),
      );
    });

    it('cancels a key against the opposite action', () => {
      expect(getMovementIntent(new Set(['KeyW']), ['moveBackward'])).toEqual(IDLE);
      expect(getMovementIntent(new Set(['KeyJ']), ['turnRight'])).toEqual(IDLE);
    });

    it('counts an action asked for by both inputs once', () => {
      expect(getMovementIntent(new Set(['KeyW']), ['moveForward'])).toEqual(intent({ move: 1 }));
    });

    it('takes the actions alone when no key is held', () => {
      expect(getMovementIntent(new Set(), ['lookUp'])).toEqual(intent({ look: 1 }));
    });

    it('ignores unknown codes and unknown actions alike', () => {
      expect(getMovementIntent(new Set(['KeyQ', 'toString']), [UNKNOWN_ACTION])).toEqual(IDLE);
    });

    it('accepts a set of actions, as the remote control store holds them', () => {
      const held: ReadonlySet<EyeAction> = new Set<EyeAction>(['strafeLeft']);
      expect(getMovementIntent(new Set(['KeyW']), held)).toEqual(intent({ move: 1, strafe: -1 }));
    });
  });

  describe('createArrivalPose', () => {
    /** The stairs arrival of this floor: on the landing, facing +x down the corridor. */
    const STAIR_ARRIVAL: StairsArrival = { x: 5.1, z: 5, yaw: -QUARTER_TURN };

    it('stands on the stairs arrival point, looking level', () => {
      const start = createArrivalPose(STAIR_ARRIVAL, GROUND_FLOOR);

      expect(start.x).toBe(STAIR_ARRIVAL.x);
      expect(start.z).toBe(STAIR_ARRIVAL.z);
      expect(start.pitch).toBe(0);
    });

    it('stands on the storey it is told to, on that storey’s own finished floor', () => {
      const third = createArrivalPose(STAIR_ARRIVAL, 3);

      expect(third.floor).toBe(3);
      expect(third.rise).toBe(0);
      expect(getFootLevel(third)).toBe(2 * FLOOR_TO_FLOOR);
    });

    // The forward vector is asserted, not assumed: it is the module's (−sin yaw, −cos yaw).
    it('faces +x from the stairs arrival, straight down the corridor', () => {
      const { yaw } = createArrivalPose(STAIR_ARRIVAL, GROUND_FLOOR);

      expect(yaw).toBeCloseTo(-QUARTER_TURN);
      expect(-Math.sin(yaw)).toBeCloseTo(1);
      expect(-Math.cos(yaw)).toBeCloseTo(0);
    });

    it('does not mutate its argument', () => {
      const arrival = Object.freeze({ ...STAIR_ARRIVAL });
      const snapshot = { ...arrival };

      const raised = createArrivalPose(arrival, GROUND_FLOOR);

      expect(arrival).toEqual(snapshot);
      expect(raised).not.toBe(arrival);
    });

    it('wraps a heading that lies outside (-π, π]', () => {
      const { yaw } = createArrivalPose({ x: 0, z: 0, yaw: Math.PI + QUARTER_TURN }, GROUND_FLOOR);

      expect(yaw).toBeGreaterThan(-Math.PI);
      expect(yaw).toBeLessThanOrEqual(Math.PI);
      expect(yaw).toBeCloseTo(-QUARTER_TURN);
    });

    it('returns a fresh object on each call', () => {
      const first = createArrivalPose(STAIR_ARRIVAL, GROUND_FLOOR);
      const second = createArrivalPose(STAIR_ARRIVAL, GROUND_FLOOR);

      expect(second).not.toBe(first);
      expect(second).toEqual(first);
    });
  });

  describe('stepEyePose movement', () => {
    const distance = EYE_NAVIGATION_CONFIG.walkSpeed * STEP;

    it('walks forward toward -z at yaw 0', () => {
      const { pose: next } = walk(pose(), { move: 1 });
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(-distance);
    });

    it('walks backward toward +z at yaw 0', () => {
      const { pose: next } = walk(pose(), { move: -1 });
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(distance);
    });

    it('strafes right toward +x at yaw 0', () => {
      const { pose: next } = walk(pose(), { strafe: 1 });
      expect(next.x).toBeCloseTo(distance);
      expect(next.z).toBeCloseTo(0);
    });

    it('walks forward toward -x at yaw π/2', () => {
      const { pose: next } = walk(pose({ yaw: QUARTER_TURN }), { move: 1 });
      expect(next.x).toBeCloseTo(-distance);
      expect(next.z).toBeCloseTo(0);
    });

    it('walks forward toward +x at yaw -π/2', () => {
      const { pose: next } = walk(pose({ yaw: -QUARTER_TURN }), { move: 1 });
      expect(next.x).toBeCloseTo(distance);
      expect(next.z).toBeCloseTo(0);
    });

    it('strafes right toward -z at yaw π/2', () => {
      const { pose: next } = walk(pose({ yaw: QUARTER_TURN }), { strafe: 1 });
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(-distance);
    });

    it('strafes left toward -z at yaw -π/2', () => {
      const { pose: next } = walk(pose({ yaw: -QUARTER_TURN }), { strafe: -1 });
      expect(next.x).toBeCloseTo(0);
      expect(next.z).toBeCloseTo(-distance);
    });

    it('walks forward and strafes right along the normalised sum at yaw π/6', () => {
      const yaw = Math.PI / 6;
      const sumX = -Math.sin(yaw) + Math.cos(yaw);
      const sumZ = -Math.cos(yaw) - Math.sin(yaw);
      const length = Math.hypot(sumX, sumZ);
      const { pose: next } = walk(pose({ yaw }), { move: 1, strafe: 1 });
      expect(next.x).toBeCloseTo((sumX / length) * distance);
      expect(next.z).toBeCloseTo((sumZ / length) * distance);
    });

    it('moves diagonally no faster than straight', () => {
      const start = pose();
      const straight = walk(start, { move: 1 }).pose;
      const diagonal = walk(start, { move: 1, strafe: 1 }).pose;
      expect(displacement(start, diagonal)).toBeCloseTo(displacement(start, straight));
    });

    it('turns before it translates, so it walks along the yaw it ends the step with', () => {
      const start = pose();
      const dt = EYE_NAVIGATION_CONFIG.maxStepSeconds;

      const { pose: next } = walk(start, { move: 1, turn: 1 }, dt);

      expect(next.x).toBeCloseTo(-Math.sin(next.yaw) * EYE_NAVIGATION_CONFIG.walkSpeed * dt);
      expect(next.z).toBeCloseTo(-Math.cos(next.yaw) * EYE_NAVIGATION_CONFIG.walkSpeed * dt);
      expect(next.yaw).not.toBeCloseTo(start.yaw);
    });

    it('reports an unobstructed step as applied in full', () => {
      const step = walk(pose(), { move: 1 });

      expect(step.blocked).toBe(false);
      expect(step.applied.x).toBeCloseTo(step.requested.x);
      expect(step.applied.z).toBeCloseTo(step.requested.z);
      expect(Math.hypot(step.requested.x, step.requested.z)).toBeCloseTo(distance);
    });

    it('requests nothing when the intent is idle', () => {
      const step = walk(pose(), {});

      // Measured as a length: a component may be a negative zero, which is still no step.
      expect(Math.hypot(step.requested.x, step.requested.z)).toBe(0);
      expect(Math.hypot(step.applied.x, step.applied.z)).toBe(0);
      expect(step.blocked).toBe(false);
      expect(step.pose).toEqual(pose());
    });
  });

  describe('stepEyePose time step', () => {
    const start = pose({ x: 1, z: -2, yaw: 0.5, pitch: 0.2 });
    const everything = { move: 1, strafe: 1, turn: 1, look: 1 } as const;

    it('caps a long time step at maxStepSeconds', () => {
      const capped = walk(start, everything, EYE_NAVIGATION_CONFIG.maxStepSeconds).pose;
      const long = walk(start, everything, 5).pose;
      expect(long.x).toBeCloseTo(capped.x);
      expect(long.z).toBeCloseTo(capped.z);
      expect(long.yaw).toBeCloseTo(capped.yaw);
      expect(long.pitch).toBeCloseTo(capped.pitch);
    });

    it.each([-1, Number.NaN, Number.NEGATIVE_INFINITY])(
      'leaves the pose unchanged for dt %s',
      (dt) => {
        expect(walk(start, everything, dt).pose).toEqual(start);
      },
    );
  });

  describe('stepEyePose collision', () => {
    it.each([
      ['the maxX wall', pose({ x: NEAR_LIMIT }), { strafe: 1 } as const, { x: WALK_LIMIT }],
      ['the minX wall', pose({ x: -NEAR_LIMIT }), { strafe: -1 } as const, { x: -WALK_LIMIT }],
      ['the maxZ wall', pose({ z: NEAR_LIMIT }), { move: -1 } as const, { z: WALK_LIMIT }],
      ['the minZ wall', pose({ z: -NEAR_LIMIT }), { move: 1 } as const, { z: -WALK_LIMIT }],
    ] as const)('stops a body walking into %s', (_side, start, push, expected) => {
      const { pose: next } = walk(start, push, EYE_NAVIGATION_CONFIG.maxStepSeconds);
      expect(next).toMatchObject(expected);
    });

    it('stops at a wall, not at a rectangle edge', () => {
      const end = walkUntilStopped(pose({ z: 2 }), { move: 1 }, PARTITIONED_SURFACE);

      expect(end.z).toBeCloseTo(PARTITION_STOP_Z);
      // The floor rectangle runs on to −5: the partition, not an edge, is what stopped it.
      expect(end.z).toBeGreaterThan(ROOM_FLOOR.minZ + BODY_RADIUS);
    });

    it('walks through a doorway left in that same wall', () => {
      const end = walkUntilStopped(pose({ z: 2 }), { move: 1 }, DOORWAY_SURFACE);

      expect(end.z).toBeLessThan(PARTITION_MIN_Z);
      expect(end.z).toBeCloseTo(-WALK_LIMIT);
      expect(end.x).toBeCloseTo(0);
    });

    it('is blocked walking into a wall, and holds the position it had', () => {
      const start = pose({ x: WALK_LIMIT, yaw: -QUARTER_TURN });

      const step = walk(start, { move: 1 }, EYE_NAVIGATION_CONFIG.maxStepSeconds);

      expect(step.blocked).toBe(true);
      expect(Math.abs(step.pose.x - start.x)).toBeLessThanOrEqual(LENGTH_TOLERANCE);
      expect(Math.abs(step.pose.z - start.z)).toBeLessThanOrEqual(LENGTH_TOLERANCE);
      expect(step.applied).toEqual({ x: 0, z: 0 });
      expect(step.requested.x).toBeGreaterThan(0);
    });

    it('is not blocked turning in place against that wall', () => {
      const start = pose({ x: WALK_LIMIT, yaw: -QUARTER_TURN });

      const step = walk(start, { turn: 1 }, EYE_NAVIGATION_CONFIG.maxStepSeconds);

      expect(step.blocked).toBe(false);
      expect(step.pose.x).toBe(start.x);
      expect(step.pose.z).toBe(start.z);
      expect(step.pose.yaw).not.toBe(start.yaw);
    });

    it('applies less than it requested when it slides along a wall', () => {
      // Heading into the maxX wall at 45°: the x half is refused, the z half is kept.
      const start = pose({ x: WALK_LIMIT, yaw: -Math.PI / 4 });

      const step = walk(start, { move: 1 }, EYE_NAVIGATION_CONFIG.maxStepSeconds);

      expect(step.blocked).toBe(true);
      expect(step.requested.x).toBeGreaterThan(LENGTH_TOLERANCE);
      expect(step.applied.x).toBeCloseTo(0);
      expect(step.applied.z).toBeCloseTo(step.requested.z);
      expect(step.pose.z).toBeLessThan(start.z);
    });
  });

  describe('stepEyePose orientation', () => {
    it('turns left by increasing yaw', () => {
      const { pose: next } = walk(pose(), { turn: 1 });
      expect(next.yaw).toBeCloseTo(EYE_NAVIGATION_CONFIG.turnSpeed * STEP);
    });

    it('wraps yaw past π into negative angles', () => {
      const start = pose({ yaw: Math.PI - 0.01 });
      const dt = EYE_NAVIGATION_CONFIG.maxStepSeconds;
      const { pose: next } = walk(start, { turn: 1 }, dt);
      expect(next.yaw).toBeLessThan(0);
      expect(next.yaw).toBeGreaterThan(-Math.PI);
      expect(next.yaw).toBeCloseTo(start.yaw + EYE_NAVIGATION_CONFIG.turnSpeed * dt - 2 * Math.PI);
    });

    it('keeps yaw within (-π, π] while turning continuously', () => {
      let current = pose();
      for (let i = 0; i < MANY_STEPS; i += 1) {
        current = walk(current, { turn: -1 }).pose;
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
        current = walk(current, { look }).pose;
      }
      expect(current.pitch).toBeCloseTo(limit);
    });
  });

  it('never mutates the input pose', () => {
    const start = Object.freeze(pose({ x: 1, z: 1, yaw: 1, pitch: 0.1 }));
    const snapshot = { ...start };
    const step = walk(start, { move: 1, strafe: 1, turn: 1, look: 1 });
    expect(start).toEqual(snapshot);
    expect(step.pose).not.toBe(start);
  });

  describe('clampStep', () => {
    it('passes a short step through untouched', () => {
      expect(clampStep(STEP, EYE_NAVIGATION_CONFIG.maxStepSeconds)).toBe(STEP);
    });

    it('caps a long step at the maximum', () => {
      expect(clampStep(5, EYE_NAVIGATION_CONFIG.maxStepSeconds)).toBe(
        EYE_NAVIGATION_CONFIG.maxStepSeconds,
      );
    });

    it.each([0, -1, Number.NaN, Number.NEGATIVE_INFINITY])('sanitises %s to 0', (dt) => {
      expect(clampStep(dt, EYE_NAVIGATION_CONFIG.maxStepSeconds)).toBe(0);
    });

    it('is the rule stepEyePose itself applies', () => {
      const start = pose({ x: 1, z: -2 });
      const raw = 5;

      const long = walk(start, { move: 1 }, raw).pose;
      const clamped = walk(
        start,
        { move: 1 },
        clampStep(raw, EYE_NAVIGATION_CONFIG.maxStepSeconds),
      ).pose;

      expect(long).toEqual(clamped);
    });
  });

  describe('wrapAngle', () => {
    it.each([0, 1, -1, Math.PI, -Math.PI + 0.001])('leaves %s in range untouched', (angle) => {
      expect(wrapAngle(angle)).toBe(angle);
    });

    it.each([
      [Math.PI + QUARTER_TURN, -QUARTER_TURN],
      [-Math.PI - QUARTER_TURN, QUARTER_TURN],
      [2 * Math.PI, 0],
      [3 * Math.PI, Math.PI],
    ] as const)('wraps %s into (-π, π]', (angle, expected) => {
      const wrapped = wrapAngle(angle);
      expect(wrapped).toBeCloseTo(expected);
      expect(wrapped).toBeGreaterThan(-Math.PI);
      expect(wrapped).toBeLessThanOrEqual(Math.PI);
    });

    it('is the rule stepEyePose itself applies to yaw', () => {
      const dt = EYE_NAVIGATION_CONFIG.maxStepSeconds;
      const start = pose({ yaw: Math.PI - 0.01 });

      const { pose: next } = walk(start, { turn: 1 }, dt);

      expect(next.yaw).toBe(wrapAngle(start.yaw + EYE_NAVIGATION_CONFIG.turnSpeed * dt));
    });
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

    it('takes the body radius from the person, so the two can never drift', () => {
      expect(EYE_NAVIGATION_CONFIG.bodyRadius).toBe(PERSON_SPEC.radius);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(EYE_NAVIGATION_CONFIG)).toBe(true);
    });
  });

  describe('getFootLevel and getEyeLevel', () => {
    it.each([
      ['the ground storey', 1, 0, 0, 1.68],
      ['the third storey', 3, 0, 6, 7.68],
      ['the second storey, half a storey down the stair', 2, -1.5, 1.5, 3.18],
    ] as const)('stands on %s with the feet at %d m', (_label, floor, rise, feet, eyes) => {
      const standing = pose({ floor, rise });

      expect(getFootLevel(standing)).toBe(feet);
      expect(getEyeLevel(standing)).toBeCloseTo(eyes);
    });

    it('puts the eyes exactly one person above the feet, whatever the storey', () => {
      const standing = pose({ floor: 4, rise: 0.75 });

      expect(getEyeLevel(standing)).toBe(getFootLevel(standing) + PERSON_SPEC.eyeHeight);
    });

    it('measures a storey of the stack, not a storey of its own', () => {
      const tall = { floorToFloor: 4, wall: 3.6, door: 2.1, railing: 1.1 };

      expect(getFootLevel(pose({ floor: 3 }), tall)).toBe(2 * tall.floorToFloor);
    });
  });

  describe('getSurfaceField', () => {
    /** A point on the plan at the depth of the bay, some distance west of its face. */
    const westOfBay = (distance: number) => ({
      x: REAL_LAYOUT.bay.minX - distance,
      z: REAL_LAYOUT.arrival.z,
    });

    it('hands out the bay field inside the bay', () => {
      expect(getSurfaceField(STAIR_SURFACE, REAL_LAYOUT.arrival, BODY_RADIUS)).toBe(
        STAIR_SURFACE.bayField,
      );
    });

    it('hands out the bay field a body radius before the bay, so nothing catches', () => {
      expect(getSurfaceField(STAIR_SURFACE, westOfBay(BODY_RADIUS / 2), BODY_RADIUS)).toBe(
        STAIR_SURFACE.bayField,
      );
    });

    it('hands out the plan field further out than a body radius', () => {
      expect(getSurfaceField(STAIR_SURFACE, westOfBay(BODY_RADIUS * 2), BODY_RADIUS)).toBe(
        STAIR_SURFACE.field,
      );
    });

    it('reads the radius as well as the point: a wider body changes over sooner', () => {
      const point = westOfBay(BODY_RADIUS * 2);

      expect(getSurfaceField(STAIR_SURFACE, point, BODY_RADIUS)).toBe(STAIR_SURFACE.field);
      expect(getSurfaceField(STAIR_SURFACE, point, BODY_RADIUS * 3)).toBe(STAIR_SURFACE.bayField);
    });
  });

  describe('stepEyePose on the real stair', () => {
    it('arrives on the storey above, exactly, having promoted once', () => {
      const climb = walkLegs(STAIR_START, CLIMB, STAIR_SURFACE);

      expect(climb.pose.floor).toBe(GROUND_FLOOR + 1);
      expect(climb.pose.rise).toBe(0);
      expect(getFootLevel(climb.pose)).toBe(FLOOR_TO_FLOOR);
      expect(climb.steps.filter((step) => step.storeyChanged)).toHaveLength(1);
    });

    it('is never blocked on the way up: the half-turn neither traps nor wedges', () => {
      const climb = walkLegs(STAIR_START, CLIMB, STAIR_SURFACE);

      expect(climb.steps.filter((step) => step.blocked)).toHaveLength(0);
    });

    it('climbs continuously, never more than a body can reach in one frame', () => {
      const climb = walkLegs(STAIR_START, CLIMB, STAIR_SURFACE);
      const total = climb.steps.reduce((sum, step) => sum + step.climbed, 0);

      expect(total).toBeCloseTo(FLOOR_TO_FLOOR);
      for (const step of climb.steps) {
        expect(Math.abs(step.climbed)).toBeLessThanOrEqual(REACH);
      }
    });

    it('comes back down exactly, promoting once the other way', () => {
      const top = walkLegs(STAIR_START, CLIMB, STAIR_SURFACE).pose;

      const descent = walkLegs(top, DESCENT, STAIR_SURFACE);

      expect(descent.pose.floor).toBe(GROUND_FLOOR);
      expect(descent.pose.rise).toBe(0);
      expect(getFootLevel(descent.pose)).toBe(0);
      expect(descent.steps.filter((step) => step.storeyChanged)).toHaveLength(1);
    });

    it('turns on the half-landing without promoting, half a storey up', () => {
      const halfway = walkLegs(STAIR_START, HALFWAY_UP, STAIR_SURFACE);

      expect(halfway.pose.floor).toBe(GROUND_FLOOR);
      expect(getFootLevel(halfway.pose)).toBe(FLOOR_TO_FLOOR / 2);
      expect(halfway.steps.filter((step) => step.storeyChanged)).toHaveLength(0);
    });

    it.each([
      ['the landing it was promoted onto', CLIMB],
      ['the half-landing halfway up', HALFWAY_UP],
    ] as const)('stands still on %s, frame after frame', (_label, legs) => {
      const stance = walkLegs(STAIR_START, legs, STAIR_SURFACE).pose;

      const after = standStill(stance, STAIR_SURFACE);

      expect(after.floor).toBe(stance.floor);
      expect(after.rise).toBe(stance.rise);
      expect(after.x).toBe(stance.x);
      expect(after.z).toBe(stance.z);
    });

    it('refuses to leave the bay from halfway up the stair', () => {
      const halfway = walkLegs(STAIR_START, HALFWAY_UP, STAIR_SURFACE).pose;
      expect(Math.abs(halfway.rise)).toBeGreaterThan(REACH);

      const out = walkLegs(halfway, [{ yaw: TOWARD_MINUS_X, frames: 20 }], STAIR_SURFACE);

      expect(out.pose.x).toBeGreaterThan(REAL_LAYOUT.bay.minX - LENGTH_TOLERANCE);
      expect(out.pose.rise).toBe(halfway.rise);
      expect(out.steps.at(-1)?.blocked).toBe(true);
    });

    it('lets the same walker out of the bay at the floor plane', () => {
      const out = walkLegs(STAIR_START, [{ yaw: TOWARD_PLUS_X, frames: 10 }], STAIR_SURFACE);

      expect(out.pose.x).toBeGreaterThan(REAL_LAYOUT.bay.maxX);
      expect(out.pose.rise).toBe(0);
      expect(out.pose.floor).toBe(GROUND_FLOOR);
      expect(out.steps.filter((step) => step.blocked)).toHaveLength(0);
    });

    it('climbs a flight that the same rectangle standing as a wall would stop it at', () => {
      const start = walkLegs(STAIR_START, [{ yaw: TOWARD_MINUS_Z, frames: 4 }], STAIR_SURFACE).pose;
      const west: readonly Leg[] = [{ yaw: TOWARD_MINUS_X, frames: 10 }];
      /** The flight read as masonry instead of as a stair: no stairwell, one blocker. */
      const asWall = surfaceOf(makeWalkField([], [FLIGHT_UP.rect]));

      const tread = walkLegs(start, west, STAIR_SURFACE).pose;
      const wall = walkLegs(start, west, asWall).pose;

      expect(tread.x).toBeLessThan(FLIGHT_UP.rect.maxX);
      expect(tread.rise).toBeGreaterThan(0);
      expect(wall.x).toBe(FLIGHT_UP.rect.maxX + BODY_RADIUS);
      expect(wall.rise).toBe(0);
    });
  });

  describe('stepEyePose across the stack', () => {
    /** Where the partition stops a walker on the ground storey. */
    const groundStop = walkUntilStopped(pose({ z: 2 }), { move: 1 }, PARTITIONED_SURFACE);

    it('stops the ground-storey walker at the partition', () => {
      expect(groundStop.z).toBeCloseTo(PARTITION_STOP_Z);
    });

    it.each([2, 3, 7, 10])('stops a walker on storey %i at exactly the same wall', (floor) => {
      const end = walkUntilStopped(pose({ z: 2, floor }), { move: 1 }, PARTITIONED_SURFACE);

      expect(end.z).toBe(groundStop.z);
      expect(end.floor).toBe(floor);
      expect(end.rise).toBe(0);
    });

    it('reports a walk on flat floor as climbing nothing', () => {
      const step = walk(pose({ floor: 4 }), { move: 1 });

      expect(step.climbed).toBe(0);
      expect(step.storeyChanged).toBe(false);
      expect(step.pose.floor).toBe(4);
      expect(step.pose.rise).toBe(0);
    });
  });

  describe('placeInStack', () => {
    /** Standing away from the stair, high in a tall stack. */
    const HIGH_UP: EyePose = pose({ x: 13, z: 7, yaw: QUARTER_TURN, pitch: 0.3, floor: 7 });

    it('leaves a pose that already stands in the stack exactly as it is', () => {
      expect(placeInStack(HIGH_UP, 9, STAIR_START)).toBe(HIGH_UP);
    });

    it('puts a viewer above the new top storey on it, where they were standing', () => {
      const placed = placeInStack(HIGH_UP, 3, STAIR_START);

      expect(placed.floor).toBe(3);
      expect(placed.rise).toBe(0);
      expect(placed.x).toBe(HIGH_UP.x);
      expect(placed.z).toBe(HIGH_UP.z);
      expect(placed.yaw).toBe(HIGH_UP.yaw);
      expect(placed.pitch).toBe(HIGH_UP.pitch);
    });

    it('returns a viewer caught mid-flight to the arrival landing, still looking their way', () => {
      const midFlight: EyePose = { ...HIGH_UP, rise: FLOOR_TO_FLOOR / 2 };

      const placed = placeInStack(midFlight, 3, STAIR_START);

      expect(placed.x).toBe(STAIR_START.x);
      expect(placed.z).toBe(STAIR_START.z);
      expect(placed.yaw).toBe(STAIR_START.yaw);
      expect(placed.pitch).toBe(midFlight.pitch);
      expect(placed.floor).toBe(3);
      expect(placed.rise).toBe(0);
    });

    it('sets a mid-flight viewer down even when their own storey survives', () => {
      const midFlight: EyePose = pose({ floor: 2, rise: FLOOR_TO_FLOOR / 2 });

      const placed = placeInStack(midFlight, 5, STAIR_START);

      expect(placed.floor).toBe(2);
      expect(placed.rise).toBe(0);
      expect(placed.x).toBe(STAIR_START.x);
    });

    it.each([
      [7, 3],
      [1, 10],
      [0, 5],
      [-4, 5],
      [12, 10],
      [3, 0],
      [5, 99],
    ] as const)('never lands storey %i of %i outside the stack', (floor, count) => {
      const placed = placeInStack(pose({ floor, rise: 0.4 }), count, STAIR_START);

      expect(Number.isInteger(placed.floor)).toBe(true);
      expect(placed.floor).toBeGreaterThanOrEqual(1);
      expect(placed.floor).toBeLessThanOrEqual(Math.min(Math.max(count, 1), 10));
      expect(placed.rise).toBe(0);
    });
  });
});
