import { describe, expect, it } from 'vitest';
import { getEyeLevel } from './eyeNavigation.ts';
import type { EyePose } from './eyeNavigation.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { PERSON_SPEC } from './person.ts';
import { getStoreyLevel } from './storeys.ts';
import {
  easeInOutCubic,
  getEyeCameraPose,
  getTransitionPose,
  VIEW_TRANSITION_SECONDS,
} from './viewTransition.ts';
import type { CameraPose } from './viewTransition.ts';

const TWEEN_START = 0;
const TWEEN_MIDPOINT = 0.5;
const TWEEN_END = 1;
/** Samples across the whole travel, to check the easing only ever increases. */
const SAMPLE_COUNT = 64;
/** Level gaze, the pitch every transition endpoint is expressed at. */
const LEVEL_PITCH = 0;
/** A quarter turn: the yaw of the stairs arrival, looking toward +x. */
const QUARTER_TURN = Math.PI / 2;
/** How far ahead the first-person endpoint looks, in metres. */
const LOOK_AHEAD_METRES = 1;
/** The storey every interior visit begins on: the one the whole file used before the stack. */
const GROUND_FLOOR = 1;
/** A storey well up the stack, to separate the storey datum from the eye height. */
const UPPER_FLOOR = 3;
/** Standing on a storey's own finished floor. */
const ON_THE_FLOOR = 0;
const PRECISION_DIGITS = 9;

/** An exterior-looking endpoint: far out from the building, looking at its centre. */
const FROM: CameraPose = Object.freeze({
  position: Object.freeze({ x: 10, y: 20, z: 30 }),
  target: Object.freeze({ x: 0, y: 2, z: 4 }),
});
/** An interior-looking endpoint: inside a room at eye height. */
const TO: CameraPose = Object.freeze({
  position: Object.freeze({ x: 2, y: 1.68, z: 6 }),
  target: Object.freeze({ x: 3, y: 1.68, z: 6 }),
});

describe('VIEW_TRANSITION_SECONDS', () => {
  it('is a positive duration short enough not to hold the viewer up', () => {
    expect(VIEW_TRANSITION_SECONDS).toBeGreaterThan(TWEEN_START);
    expect(VIEW_TRANSITION_SECONDS).toBeLessThan(2);
  });
});

describe('easeInOutCubic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeInOutCubic(TWEEN_START)).toBe(TWEEN_START);
    expect(easeInOutCubic(TWEEN_END)).toBe(TWEEN_END);
  });

  it('has covered half the way at the midpoint', () => {
    expect(easeInOutCubic(TWEEN_MIDPOINT)).toBeCloseTo(TWEEN_MIDPOINT);
  });

  it('never decreases across the travel', () => {
    let previous = -Infinity;
    for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
      const eased = easeInOutCubic(index / SAMPLE_COUNT);
      expect(eased).toBeGreaterThanOrEqual(previous);
      previous = eased;
    }
  });

  it('starts and ends at rest: the first and last steps are the smallest', () => {
    const step = TWEEN_END / SAMPLE_COUNT;
    const firstStep = easeInOutCubic(step) - easeInOutCubic(TWEEN_START);
    const middleStep =
      easeInOutCubic(TWEEN_MIDPOINT + step) - easeInOutCubic(TWEEN_MIDPOINT - step);
    const lastStep = easeInOutCubic(TWEEN_END) - easeInOutCubic(TWEEN_END - step);

    expect(firstStep).toBeLessThan(middleStep);
    expect(lastStep).toBeLessThan(middleStep);
  });

  it('is symmetric about the midpoint', () => {
    const quarter = 0.25;
    expect(easeInOutCubic(quarter) + easeInOutCubic(TWEEN_END - quarter)).toBeCloseTo(TWEEN_END);
  });

  it('clamps a parameter outside the travel, and treats NaN as the start', () => {
    expect(easeInOutCubic(-1)).toBe(TWEEN_START);
    expect(easeInOutCubic(2)).toBe(TWEEN_END);
    expect(easeInOutCubic(Number.NaN)).toBe(TWEEN_START);
  });
});

describe('getTransitionPose', () => {
  it('is the start pose at t = 0', () => {
    const pose = getTransitionPose(FROM, TO, TWEEN_START);

    expect(pose.position).toEqual(FROM.position);
    expect(pose.target).toEqual(FROM.target);
  });

  it('is the end pose at t = 1, exactly', () => {
    const pose = getTransitionPose(FROM, TO, TWEEN_END);

    expect(pose.position).toEqual(TO.position);
    expect(pose.target).toEqual(TO.target);
  });

  it('is half way along both the position and the target at t = 0.5', () => {
    const pose = getTransitionPose(FROM, TO, TWEEN_MIDPOINT);

    expect(pose.position.x).toBeCloseTo((FROM.position.x + TO.position.x) * TWEEN_MIDPOINT);
    expect(pose.position.y).toBeCloseTo((FROM.position.y + TO.position.y) * TWEEN_MIDPOINT);
    expect(pose.position.z).toBeCloseTo((FROM.position.z + TO.position.z) * TWEEN_MIDPOINT);
    expect(pose.target.x).toBeCloseTo((FROM.target.x + TO.target.x) * TWEEN_MIDPOINT);
    expect(pose.target.y).toBeCloseTo((FROM.target.y + TO.target.y) * TWEEN_MIDPOINT);
    expect(pose.target.z).toBeCloseTo((FROM.target.z + TO.target.z) * TWEEN_MIDPOINT);
  });

  it('eases rather than moving linearly: a quarter of the time is less than a quarter of the way', () => {
    const quarter = 0.25;
    const pose = getTransitionPose(FROM, TO, quarter);
    const covered = (pose.position.y - FROM.position.y) / (TO.position.y - FROM.position.y);

    expect(covered).toBeGreaterThan(TWEEN_START);
    expect(covered).toBeLessThan(quarter);
  });

  it('clamps a parameter outside the travel to the endpoints', () => {
    expect(getTransitionPose(FROM, TO, -1).position).toEqual(FROM.position);
    expect(getTransitionPose(FROM, TO, 2).position).toEqual(TO.position);
  });

  it('mutates neither endpoint and returns fresh objects', () => {
    const pose = getTransitionPose(FROM, TO, TWEEN_MIDPOINT);

    expect(FROM).toEqual({ position: { x: 10, y: 20, z: 30 }, target: { x: 0, y: 2, z: 4 } });
    expect(TO).toEqual({ position: { x: 2, y: 1.68, z: 6 }, target: { x: 3, y: 1.68, z: 6 } });
    expect(pose.position).not.toBe(FROM.position);
    expect(pose.position).not.toBe(TO.position);
    expect(pose.target).not.toBe(FROM.target);
    expect(pose.target).not.toBe(TO.target);
  });

  it('is pure: the same arguments give the same result', () => {
    expect(getTransitionPose(FROM, TO, TWEEN_MIDPOINT)).toEqual(
      getTransitionPose(FROM, TO, TWEEN_MIDPOINT),
    );
  });
});

describe('getEyeCameraPose', () => {
  /** Looking toward +x, the heading a person arrives at the stairs with, on the ground storey. */
  const POSE: EyePose = Object.freeze({
    x: 5.1,
    z: 5,
    yaw: -QUARTER_TURN,
    pitch: LEVEL_PITCH,
    floor: GROUND_FLOOR,
    rise: ON_THE_FLOOR,
  });

  it('puts the camera at eye height over the plan position', () => {
    const { position } = getEyeCameraPose(POSE);

    expect(position.x).toBeCloseTo(POSE.x);
    expect(position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    expect(position.z).toBeCloseTo(POSE.z);
  });

  it('is exactly the eye height on the ground storey, to the last bit', () => {
    // The storey datum is a summand, not a scale: on storey 1 at rise 0 it is a true zero,
    // so the endpoint of the ground-storey flight is the number it always was.
    const { position, target } = getEyeCameraPose(POSE);

    expect(position.y).toBe(PERSON_SPEC.eyeHeight);
    expect(target.y).toBe(PERSON_SPEC.eyeHeight);
  });

  it('looks one metre along the plan forward vector, at eye height', () => {
    const { position, target } = getEyeCameraPose(POSE);

    expect(target.x - position.x).toBeCloseTo(-Math.sin(POSE.yaw) * LOOK_AHEAD_METRES);
    expect(target.z - position.z).toBeCloseTo(-Math.cos(POSE.yaw) * LOOK_AHEAD_METRES);
    expect(Math.hypot(target.x - position.x, target.z - position.z)).toBeCloseTo(LOOK_AHEAD_METRES);
  });

  it('is level: no pitch and no roll, whatever the pose pitch says', () => {
    const pitched: EyePose = { ...POSE, pitch: 1 };
    const { position, target } = getEyeCameraPose(pitched);

    expect(target.y).toBeCloseTo(position.y);
    expect(target.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
  });

  it('looks toward −z at yaw 0', () => {
    const { position, target } = getEyeCameraPose({ ...POSE, yaw: 0 });

    expect(target.x).toBeCloseTo(position.x);
    expect(target.z).toBeCloseTo(position.z - LOOK_AHEAD_METRES);
  });

  it('mutates nothing and is pure', () => {
    const pose = getEyeCameraPose(POSE);

    expect(POSE).toEqual({
      x: 5.1,
      z: 5,
      yaw: -QUARTER_TURN,
      pitch: LEVEL_PITCH,
      floor: GROUND_FLOOR,
      rise: ON_THE_FLOOR,
    });
    expect(pose).toEqual(getEyeCameraPose(POSE));
    expect(pose).not.toBe(getEyeCameraPose(POSE));
  });

  describe('up the stack', () => {
    const upstairs: EyePose = Object.freeze({ ...POSE, floor: UPPER_FLOOR });
    /** The eye on the third storey: 6.00 m of stack plus the 1.68 m eye height. */
    const UPPER_EYE_LEVEL = 7.68;

    it('lands on the eye height of the storey entered, not of the ground one', () => {
      const { position } = getEyeCameraPose(upstairs);

      expect(position.y).toBeCloseTo(UPPER_EYE_LEVEL);
      expect(position.y).toBeCloseTo(getEyeLevel(upstairs));
      expect(position.y).toBeCloseTo(
        getStoreyLevel(UPPER_FLOOR) + PERSON_SPEC.eyeHeight,
        PRECISION_DIGITS,
      );
    });

    it('stays level up there: the position and the target are at the same height', () => {
      const { position, target } = getEyeCameraPose(upstairs);

      expect(position.y).toBe(target.y);
    });

    it('is the ground storey lifted by the storey level, and nothing else', () => {
      const up = getEyeCameraPose(upstairs);
      const down = getEyeCameraPose(POSE);
      const lift = getStoreyLevel(UPPER_FLOOR);

      expect(up.position.x).toBe(down.position.x);
      expect(up.position.z).toBe(down.position.z);
      expect(up.position.y - down.position.y).toBeCloseTo(lift, PRECISION_DIGITS);
      expect(lift).toBeCloseTo(
        (UPPER_FLOOR - GROUND_FLOOR) * FLOOR_HEIGHTS.floorToFloor,
        PRECISION_DIGITS,
      );
    });

    it('carries a rise above the finished floor, for a viewer caught on the stairs', () => {
      const HALF_A_STOREY = FLOOR_HEIGHTS.floorToFloor / 2;
      const { position, target } = getEyeCameraPose({ ...upstairs, rise: HALF_A_STOREY });

      expect(position.y).toBeCloseTo(UPPER_EYE_LEVEL + HALF_A_STOREY, PRECISION_DIGITS);
      expect(target.y).toBe(position.y);
    });
  });
});
