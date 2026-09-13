import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { ROOM_SAMPLE_DISTANCE_METRES, useExplorerPoseStore } from './explorerPoseStore.ts';

/** Yaw and pitch are irrelevant to the room lookup; every test pose looks level ahead. */
const LEVEL_POSE = { yaw: 0, pitch: 0 };

/** Builds a pose standing at a plan point. */
function poseAt(x: number, z: number): EyePose {
  return { x, z, ...LEVEL_POSE };
}

/** x of the zero-gap join between the stairwell (to x 5.60) and the corridor (from x 5.60). */
const JOIN_X = 5.6;
/** z where both the stairwell and the corridor reach that join. */
const JOIN_Z = 4.5;

/**
 * Half a step shorter than one sample distance, in metres: a there-and-back across the join
 * moves twice this, still less than {@link ROOM_SAMPLE_DISTANCE_METRES}.
 */
const HALF_SHORT_STEP_METRES = 0.02;
/** A step comfortably longer than one sample distance, in metres. */
const LONG_STEP_METRES = 0.1;

/** Just inside the stairwell, a hair west of the join. */
const IN_STAIRS = poseAt(JOIN_X - HALF_SHORT_STEP_METRES, JOIN_Z);
/** Just inside the corridor, a hair east of the join: under the sample distance from {@link IN_STAIRS}. */
const JUST_OVER_JOIN = poseAt(JOIN_X + HALF_SHORT_STEP_METRES, JOIN_Z);
/** Well inside the corridor, past the sample distance from {@link IN_STAIRS}. */
const IN_CORRIDOR = poseAt(JOIN_X + LONG_STEP_METRES, JOIN_Z);

/** The centre of the master bedroom (x 1.60–6.60, z 0.30–3.70). */
const IN_MASTER_BEDROOM = poseAt(4.1, 2.0);
/** Inside the 0.30 m wall east of it, which no space covers. */
const IN_BEDROOM_WALL = poseAt(6.75, 2.0);

/** Inside the kitchen's west rect (x 10.00–12.20, z 6.30–8.60). */
const IN_KITCHEN = poseAt(11.1, 7.45);
/** Deeper into the same kitchen rect, past the sample distance. */
const DEEPER_IN_KITCHEN = poseAt(11.1, 7.45 + LONG_STEP_METRES);
/** Inside `voidWest` (z 8.90–9.70), which has no floor. */
const IN_VOID_WEST = poseAt(11.1, 9.3);

function currentSpaceId(): string | undefined {
  return useExplorerPoseStore.getState().currentSpaceId;
}

function reportPose(pose: EyePose): void {
  useExplorerPoseStore.getState().reportPose(pose);
}

describe('useExplorerPoseStore', () => {
  beforeEach(() => {
    useExplorerPoseStore.setState(useExplorerPoseStore.getInitialState(), true);
    // The pose channel lives in module variables, outside the store state, so replacing the
    // state is not enough on its own: `clearPose` is what resets it between tests.
    useExplorerPoseStore.getState().clearPose();
  });

  it('uses test steps that straddle the sample distance', () => {
    expect(HALF_SHORT_STEP_METRES * 2).toBeLessThan(ROOM_SAMPLE_DISTANCE_METRES);
    expect(LONG_STEP_METRES).toBeGreaterThan(ROOM_SAMPLE_DISTANCE_METRES);
  });

  it('knows neither a room nor a pose at first', () => {
    expect(currentSpaceId()).toBeUndefined();
    expect(useExplorerPoseStore.getState().getLatestPose()).toBeUndefined();
  });

  it('resolves the room on the very first report', () => {
    reportPose(IN_KITCHEN);

    expect(currentSpaceId()).toBe('kitchen');
  });

  it('does not look the room up again below the sample distance, even across a boundary', () => {
    reportPose(IN_STAIRS);
    expect(currentSpaceId()).toBe('stairs');

    reportPose(JUST_OVER_JOIN);

    expect(currentSpaceId()).toBe('stairs');
  });

  it('picks the new room up once the eye has moved the sample distance', () => {
    reportPose(IN_STAIRS);
    const listener = vi.fn();
    const unsubscribe = useExplorerPoseStore.subscribe(listener);

    reportPose(JUST_OVER_JOIN);
    reportPose(IN_CORRIDOR);

    expect(currentSpaceId()).toBe('corridor');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('notifies nobody while the explorer walks on inside the same room', () => {
    reportPose(IN_KITCHEN);
    const listener = vi.fn();
    const unsubscribe = useExplorerPoseStore.subscribe(listener);

    reportPose(DEEPER_IN_KITCHEN);

    expect(currentSpaceId()).toBe('kitchen');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies nobody while the explorer stands still or turns in place', () => {
    reportPose(IN_KITCHEN);
    const listener = vi.fn();
    const unsubscribe = useExplorerPoseStore.subscribe(listener);

    reportPose(IN_KITCHEN);
    reportPose({ ...IN_KITCHEN, yaw: 1.2, pitch: -0.3 });

    expect(currentSpaceId()).toBe('kitchen');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps the room while the body straddles a wall', () => {
    reportPose(IN_MASTER_BEDROOM);

    reportPose(IN_BEDROOM_WALL);

    expect(currentSpaceId()).toBe('masterBedroom');
  });

  it('keeps the room over the void, which is never announced', () => {
    reportPose(IN_KITCHEN);

    reportPose(IN_VOID_WEST);

    expect(currentSpaceId()).toBe('kitchen');
  });

  it('keeps the latest pose current on every report, sampled or not', () => {
    const { getLatestPose } = useExplorerPoseStore.getState();

    reportPose(IN_STAIRS);
    expect(getLatestPose()).toBe(IN_STAIRS);

    reportPose(JUST_OVER_JOIN);
    expect(getLatestPose()).toBe(JUST_OVER_JOIN);

    reportPose(IN_CORRIDOR);
    expect(getLatestPose()).toBe(IN_CORRIDOR);
  });

  it('forgets the pose and the room when the interior view is left', () => {
    reportPose(IN_KITCHEN);

    useExplorerPoseStore.getState().clearPose();

    expect(currentSpaceId()).toBeUndefined();
    expect(useExplorerPoseStore.getState().getLatestPose()).toBeUndefined();
  });

  it('forgets the room it would otherwise have fallen back on', () => {
    reportPose(IN_MASTER_BEDROOM);
    useExplorerPoseStore.getState().clearPose();

    reportPose(IN_BEDROOM_WALL);

    expect(currentSpaceId()).toBeUndefined();
  });

  it('notifies nobody when clearing a store that knows no room', () => {
    const listener = vi.fn();
    const unsubscribe = useExplorerPoseStore.subscribe(listener);

    useExplorerPoseStore.getState().clearPose();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('throws on a non-finite pose rather than freezing the readout', () => {
    reportPose(IN_KITCHEN);

    expect(() => {
      reportPose(poseAt(Number.NaN, JOIN_Z));
    }).toThrow(RangeError);
  });
});
