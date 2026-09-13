import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrbitPose } from '../domain/orbitNavigation.ts';
import { getRememberedOrbitPose, useExteriorOrbitStore } from './exteriorOrbitStore.ts';

/** A pose the viewer might have left the exterior view at: three-quarters round, tilted down. */
const A_POSE: OrbitPose = { azimuth: 0.8, polar: 1.1, distance: 24 };

/** A plainly different pose: the opposite side of the building, closer and flatter. */
const ANOTHER_POSE: OrbitPose = { azimuth: -2.4, polar: 1.4, distance: 12 };

/** Half the store's angular tolerance: a difference it must call no difference at all. */
const NEGLIGIBLE_ANGLE = 5e-10;

/** Half the store's length tolerance, in metres: likewise below notice. */
const NEGLIGIBLE_LENGTH = 5e-10;

/** A movement of a tenth of a degree, in radians: far smaller than a key-hold, still real. */
const SMALL_ANGLE = 0.0017;

/** A movement of a millimetre, in metres: the smallest zoom that should still be remembered. */
const SMALL_LENGTH = 0.001;

function remembered(): OrbitPose | undefined {
  return useExteriorOrbitStore.getState().orbitPose;
}

describe('useExteriorOrbitStore', () => {
  beforeEach(() => {
    useExteriorOrbitStore.setState(useExteriorOrbitStore.getInitialState(), true);
  });

  it('remembers no pose at first', () => {
    expect(remembered()).toBeUndefined();
  });

  it('remembers the pose it is given', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);

    expect(remembered()).toEqual(A_POSE);
  });

  it('replaces the pose it remembers', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);
    useExteriorOrbitStore.getState().rememberOrbitPose(ANOTHER_POSE);

    expect(remembered()).toEqual(ANOTHER_POSE);
  });

  it.each([
    ['azimuth', { ...A_POSE, azimuth: A_POSE.azimuth + SMALL_ANGLE }],
    ['polar', { ...A_POSE, polar: A_POSE.polar - SMALL_ANGLE }],
    ['distance', { ...A_POSE, distance: A_POSE.distance - SMALL_LENGTH }],
  ] as const)('remembers a small change of %s', (_axis, moved) => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);

    useExteriorOrbitStore.getState().rememberOrbitPose(moved);

    expect(remembered()).toEqual(moved);
  });

  it('keeps the same state object when the pose remembered is the one already stored', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);
    const before = useExteriorOrbitStore.getState();
    const listener = vi.fn();
    const unsubscribe = useExteriorOrbitStore.subscribe(listener);

    useExteriorOrbitStore.getState().rememberOrbitPose({ ...A_POSE });

    expect(useExteriorOrbitStore.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('treats a pose differing by less than the tolerances as the same pose', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);
    const before = useExteriorOrbitStore.getState();
    const listener = vi.fn();
    const unsubscribe = useExteriorOrbitStore.subscribe(listener);

    useExteriorOrbitStore.getState().rememberOrbitPose({
      azimuth: A_POSE.azimuth + NEGLIGIBLE_ANGLE,
      polar: A_POSE.polar - NEGLIGIBLE_ANGLE,
      distance: A_POSE.distance + NEGLIGIBLE_LENGTH,
    });

    expect(useExteriorOrbitStore.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies a subscriber once for a pose that really moved', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);
    const listener = vi.fn();
    const unsubscribe = useExteriorOrbitStore.subscribe(listener);

    useExteriorOrbitStore.getState().rememberOrbitPose(ANOTHER_POSE);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('copies the pose in, so mutating the given object afterwards changes nothing', () => {
    const mutable = { ...A_POSE };
    useExteriorOrbitStore.getState().rememberOrbitPose(mutable);

    mutable.azimuth = ANOTHER_POSE.azimuth;

    expect(remembered()).toEqual(A_POSE);
  });

  it('leaves an already-read pose alone when a later pose is remembered', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);
    const first = remembered();

    useExteriorOrbitStore.getState().rememberOrbitPose(ANOTHER_POSE);

    expect(first).toEqual(A_POSE);
  });
});

describe('getRememberedOrbitPose', () => {
  beforeEach(() => {
    useExteriorOrbitStore.setState(useExteriorOrbitStore.getInitialState(), true);
  });

  it('reads no pose before the exterior view is first framed', () => {
    expect(getRememberedOrbitPose()).toBeUndefined();
  });

  it('reads the pose the store remembers', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);

    expect(getRememberedOrbitPose()).toEqual(A_POSE);
  });

  it('reads the same object the store holds, without subscribing', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);

    expect(getRememberedOrbitPose()).toBe(remembered());
  });

  it('reads the pose that replaced an earlier one', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE);
    useExteriorOrbitStore.getState().rememberOrbitPose(ANOTHER_POSE);

    expect(getRememberedOrbitPose()).toEqual(ANOTHER_POSE);
  });
});
