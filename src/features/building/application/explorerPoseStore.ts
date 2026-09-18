import { create } from 'zustand';
import { getCurrentSpace } from '../domain/currentSpace.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { isSameFloorSpace, makeFloorSpaceRef } from '../domain/floorSpace.ts';
import type { FloorSpaceRef } from '../domain/floorSpace.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import type { Space } from '../domain/floorPlan/index.ts';

/** How far the eye must move, in metres, before the room is looked up again. */
export const ROOM_SAMPLE_DISTANCE_METRES = 0.05;

/**
 * The latest pose reported by the frame loop, outside the store on purpose.
 *
 * The pose changes sixty times a second. Putting it through `set` would re-render every
 * subscriber of this store on every frame (ADR-004, ADR-007), which is exactly what the
 * split channel here exists to avoid: the room goes through the store and is reactive,
 * the pose stays in these module variables and is pulled by the readers that want it.
 */
let latestPose: EyePose | undefined;

/** The pose the room was last resolved at, so the next resolution can be spaced out. */
let lastSampledPose: EyePose | undefined;

/**
 * The space resolved last time, kept whole rather than by id: `getCurrentSpace` takes the
 * previous space to fall back on while the body straddles a wall or a doorway.
 */
let lastSpace: Space | undefined;

/** State and actions of the explorer's position in the building. */
export interface ExplorerPoseState {
  /**
   * The room the explorer is in, storey and all; changes only when the room does. Reactive.
   *
   * A {@link FloorSpaceRef} rather than a bare id because the plan is one plan that every
   * storey repeats: `kitchen` alone names a room on every floor, not the one being stood in.
   */
  readonly currentSpace: FloorSpaceRef | undefined;
  /**
   * The storey the explorer stands on, straight off the pose. Reactive.
   *
   * Separate from {@link currentSpace} because it is known sooner and lost later: the pose
   * always carries a floor, while the room is `undefined` over a void, inside a wall and
   * before the first report. A floor readout that waited for a room would blank out in
   * places the walker can perfectly well stand.
   */
  readonly currentFloor: number | undefined;
  /** Called once per frame from the scene. Never notifies unless the room changed. */
  readonly reportPose: (pose: EyePose) => void;
  /** The latest reported pose, read non-reactively by the minimap's own loop. */
  readonly getLatestPose: () => EyePose | undefined;
  /** Forgets the pose and the room; called when the interior view is left. */
  readonly clearPose: () => void;
}

/**
 * Tells whether the room is worth looking up again.
 *
 * Written as the negation of "moved less than the sample distance on both axes" rather
 * than as "moved at least it on one", so that a non-finite coordinate — where every
 * comparison is false — counts as movement and reaches `getCurrentSpace`, which throws on
 * it. A threshold that swallowed a `NaN` pose would hide the upstream bug behind a room
 * name that quietly stopped updating.
 *
 * A change of storey counts on its own, whatever the distance: the threshold compares x and
 * z, and a walker stepping off the stair onto the next floor arrives above where they left —
 * often within five centimetres of it on the plan. Without this the room would keep naming
 * the storey below until the walker happened to cross the floor.
 *
 * @param from - The pose the room was last resolved at.
 * @param to - The pose just reported.
 * @returns `true` when the eye has changed storey, has moved at least
 *   {@link ROOM_SAMPLE_DISTANCE_METRES} on x or on z, or when a coordinate is not finite.
 */
function hasMovedEnough(from: EyePose, to: EyePose): boolean {
  if (to.floor !== from.floor) {
    return true;
  }
  return !(
    Math.abs(to.x - from.x) < ROOM_SAMPLE_DISTANCE_METRES &&
    Math.abs(to.z - from.z) < ROOM_SAMPLE_DISTANCE_METRES
  );
}

/**
 * Global store holding where the explorer is on the floor, on two channels.
 *
 * The room is reactive: the HUD readout subscribes to `currentSpace` and re-renders when
 * the viewer walks into another room — a handful of times per walk. The pose is not: it is
 * reported every frame and read back through `getLatestPose`, so the frame loop can drive
 * a minimap without re-rendering the HUD sixty times a second.
 *
 * The room is re-resolved by **distance**, not on a timer. A distance threshold is
 * deterministic in a test with no clock to fake; it does nothing at all while the viewer
 * stands still or turns in place, which is most of the time; and at the 1.4 m/s walking
 * speed it resolves every two or three frames, so a boundary is caught within five
 * centimetres of being crossed. `set` is then called only when the resolved room actually
 * differs, so walking the length of one room notifies nobody.
 *
 * @returns A React hook selecting from {@link ExplorerPoseState}.
 */
export const useExplorerPoseStore = create<ExplorerPoseState>()((set, get) => ({
  currentSpace: undefined,
  currentFloor: undefined,

  reportPose: (pose) => {
    latestPose = pose;
    if (lastSampledPose !== undefined && !hasMovedEnough(lastSampledPose, pose)) {
      return;
    }
    lastSampledPose = pose;
    lastSpace = getCurrentSpace(FLOOR_PLAN, pose, lastSpace);
    const resolved =
      lastSpace === undefined ? undefined : makeFloorSpaceRef(pose.floor, lastSpace.id);
    const state = get();
    if (isSameFloorSpace(state.currentSpace, resolved) && state.currentFloor === pose.floor) {
      return;
    }
    set({ currentSpace: resolved, currentFloor: pose.floor });
  },

  getLatestPose: () => latestPose,

  clearPose: () => {
    latestPose = undefined;
    lastSampledPose = undefined;
    lastSpace = undefined;
    set((state) =>
      state.currentSpace === undefined && state.currentFloor === undefined
        ? state
        : { currentSpace: undefined, currentFloor: undefined },
    );
  },
}));
