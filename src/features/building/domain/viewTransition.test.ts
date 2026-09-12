import { describe, expect, it } from 'vitest';
import type { EyePose } from './eyeNavigation.ts';
import { PERSON_SPEC } from './person.ts';
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
  /** Looking toward +x, the heading a person arrives at the stairs with. */
  const POSE: EyePose = Object.freeze({ x: 5.1, z: 5, yaw: -QUARTER_TURN, pitch: LEVEL_PITCH });

  it('puts the camera at eye height over the plan position', () => {
    const { position } = getEyeCameraPose(POSE);

    expect(position.x).toBeCloseTo(POSE.x);
    expect(position.y).toBeCloseTo(PERSON_SPEC.eyeHeight);
    expect(position.z).toBeCloseTo(POSE.z);
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

    expect(POSE).toEqual({ x: 5.1, z: 5, yaw: -QUARTER_TURN, pitch: LEVEL_PITCH });
    expect(pose).toEqual(getEyeCameraPose(POSE));
    expect(pose).not.toBe(getEyeCameraPose(POSE));
  });
});
