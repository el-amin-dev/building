import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrbitPose } from '../domain/orbitNavigation.ts';
import { getPlacementOrbitPose, useExteriorOrbitStore } from './exteriorOrbitStore.ts';

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

/** The stack the app opens on: one designed floor. */
const ONE_STOREY = 1;

/** A stack of ten, the tallest the stepper reaches: a different building to frame. */
const TEN_STOREYS = 10;

/** The pose the framing of a ten-storey stack would place the camera at on its own. */
const FRAMING_POSE: OrbitPose = { azimuth: -0.4, polar: 0.9, distance: 43.6 };

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
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);

    expect(remembered()).toEqual(A_POSE);
  });

  it('replaces the pose it remembers', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);
    useExteriorOrbitStore.getState().rememberOrbitPose(ANOTHER_POSE, ONE_STOREY);

    expect(remembered()).toEqual(ANOTHER_POSE);
  });

  it.each([
    ['azimuth', { ...A_POSE, azimuth: A_POSE.azimuth + SMALL_ANGLE }],
    ['polar', { ...A_POSE, polar: A_POSE.polar - SMALL_ANGLE }],
    ['distance', { ...A_POSE, distance: A_POSE.distance - SMALL_LENGTH }],
  ] as const)('remembers a small change of %s', (_axis, moved) => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);

    useExteriorOrbitStore.getState().rememberOrbitPose(moved, ONE_STOREY);

    expect(remembered()).toEqual(moved);
  });

  it('keeps the same state object when the pose remembered is the one already stored', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);
    const before = useExteriorOrbitStore.getState();
    const listener = vi.fn();
    const unsubscribe = useExteriorOrbitStore.subscribe(listener);

    useExteriorOrbitStore.getState().rememberOrbitPose({ ...A_POSE }, ONE_STOREY);

    expect(useExteriorOrbitStore.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('treats a pose differing by less than the tolerances as the same pose', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);
    const before = useExteriorOrbitStore.getState();
    const listener = vi.fn();
    const unsubscribe = useExteriorOrbitStore.subscribe(listener);

    useExteriorOrbitStore.getState().rememberOrbitPose(
      {
        azimuth: A_POSE.azimuth + NEGLIGIBLE_ANGLE,
        polar: A_POSE.polar - NEGLIGIBLE_ANGLE,
        distance: A_POSE.distance + NEGLIGIBLE_LENGTH,
      },
      ONE_STOREY,
    );

    expect(useExteriorOrbitStore.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies a subscriber once for a pose that really moved', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);
    const listener = vi.fn();
    const unsubscribe = useExteriorOrbitStore.subscribe(listener);

    useExteriorOrbitStore.getState().rememberOrbitPose(ANOTHER_POSE, ONE_STOREY);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('copies the pose in, so mutating the given object afterwards changes nothing', () => {
    const mutable = { ...A_POSE };
    useExteriorOrbitStore.getState().rememberOrbitPose(mutable, ONE_STOREY);

    mutable.azimuth = ANOTHER_POSE.azimuth;

    expect(remembered()).toEqual(A_POSE);
  });

  it('remembers the storey count the pose was framed for', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, TEN_STOREYS);

    expect(useExteriorOrbitStore.getState().framedStoreyCount).toBe(TEN_STOREYS);
  });

  it('remembers no storey count at first', () => {
    expect(useExteriorOrbitStore.getState().framedStoreyCount).toBeUndefined();
  });

  it('records the same pose again when it was framed for a different stack', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);
    const listener = vi.fn();
    const unsubscribe = useExteriorOrbitStore.subscribe(listener);

    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, TEN_STOREYS);

    expect(useExteriorOrbitStore.getState().framedStoreyCount).toBe(TEN_STOREYS);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('leaves an already-read pose alone when a later pose is remembered', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);
    const first = remembered();

    useExteriorOrbitStore.getState().rememberOrbitPose(ANOTHER_POSE, ONE_STOREY);

    expect(first).toEqual(A_POSE);
  });
});

describe('getPlacementOrbitPose', () => {
  beforeEach(() => {
    useExteriorOrbitStore.setState(useExteriorOrbitStore.getInitialState(), true);
  });

  it('places the camera at the framing pose before the exterior view is first framed', () => {
    expect(getPlacementOrbitPose(FRAMING_POSE, ONE_STOREY)).toBe(FRAMING_POSE);
  });

  it('places the camera at the remembered pose while the stack is the one it framed', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);

    expect(getPlacementOrbitPose(FRAMING_POSE, ONE_STOREY)).toEqual(A_POSE);
  });

  it('reads the object the store holds, without subscribing', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);

    expect(getPlacementOrbitPose(FRAMING_POSE, ONE_STOREY)).toBe(remembered());
  });

  it('refits the distance when the stack is no longer the one the pose was framed for', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);

    const placement = getPlacementOrbitPose(FRAMING_POSE, TEN_STOREYS);

    // The angle is the viewer's own and survives; the distance framed a 2.70 m building
    // and would leave most of a 29.70 m one out of frame.
    expect(placement.azimuth).toBe(A_POSE.azimuth);
    expect(placement.polar).toBe(A_POSE.polar);
    expect(placement.distance).toBe(FRAMING_POSE.distance);
  });

  it('refits the distance when storeys are taken away as well as added', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, TEN_STOREYS);

    const placement = getPlacementOrbitPose(FRAMING_POSE, ONE_STOREY);

    expect(placement.azimuth).toBe(A_POSE.azimuth);
    expect(placement.distance).toBe(FRAMING_POSE.distance);
  });

  it('stops refitting once the refitted pose is remembered for the new stack', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);
    const refitted = getPlacementOrbitPose(FRAMING_POSE, TEN_STOREYS);

    useExteriorOrbitStore.getState().rememberOrbitPose(refitted, TEN_STOREYS);

    // Idempotent: the mounting controls and the camera flight both place from this call,
    // whichever of them runs second, and the second must not move the camera again.
    expect(getPlacementOrbitPose(FRAMING_POSE, TEN_STOREYS)).toEqual(refitted);
  });

  it('leaves the framing pose it was given untouched', () => {
    useExteriorOrbitStore.getState().rememberOrbitPose(A_POSE, ONE_STOREY);

    getPlacementOrbitPose(FRAMING_POSE, TEN_STOREYS);

    expect(FRAMING_POSE).toEqual({ azimuth: -0.4, polar: 0.9, distance: 43.6 });
  });
});
