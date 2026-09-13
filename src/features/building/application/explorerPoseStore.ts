import { create } from 'zustand';
import { getCurrentSpace } from '../domain/currentSpace.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import type { Space, SpaceId } from '../domain/floorPlan/index.ts';

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

/** State and actions of the explorer's position on the floor. */
export interface ExplorerPoseState {
  /** The space the explorer is in; changes only when the room changes. Reactive. */
  readonly currentSpaceId: SpaceId | undefined;
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
 * @param from - The pose the room was last resolved at.
 * @param to - The pose just reported.
 * @returns `true` when the eye has moved at least {@link ROOM_SAMPLE_DISTANCE_METRES} on x
 *   or on z, or when a coordinate is not finite.
 */
function hasMovedEnough(from: EyePose, to: EyePose): boolean {
  return !(
    Math.abs(to.x - from.x) < ROOM_SAMPLE_DISTANCE_METRES &&
    Math.abs(to.z - from.z) < ROOM_SAMPLE_DISTANCE_METRES
  );
}

/**
 * Global store holding where the explorer is on the floor, on two channels.
 *
 * The room is reactive: the HUD readout subscribes to `currentSpaceId` and re-renders when
 * the viewer walks into another room — a handful of times per walk. The pose is not: it is
 * reported every frame and read back through `getLatestPose`, so the frame loop can drive
 * a minimap without re-rendering the HUD sixty times a second.
 *
 * The room is re-resolved by **distance**, not on a timer. A distance threshold is
 * deterministic in a test with no clock to fake; it does nothing at all while the viewer
 * stands still or turns in place, which is most of the time; and at the 1.4 m/s walking
 * speed it resolves every two or three frames, so a boundary is caught within five
 * centimetres of being crossed. `set` is then called only when the resolved id actually
 * differs, so walking the length of one room notifies nobody.
 *
 * @returns A React hook selecting from {@link ExplorerPoseState}.
 */
export const useExplorerPoseStore = create<ExplorerPoseState>()((set, get) => ({
  currentSpaceId: undefined,

  reportPose: (pose) => {
    latestPose = pose;
    if (lastSampledPose !== undefined && !hasMovedEnough(lastSampledPose, pose)) {
      return;
    }
    lastSampledPose = pose;
    lastSpace = getCurrentSpace(FLOOR_PLAN, pose, lastSpace);
    const resolvedId = lastSpace?.id;
    if (get().currentSpaceId !== resolvedId) {
      set({ currentSpaceId: resolvedId });
    }
  },

  getLatestPose: () => latestPose,

  clearPose: () => {
    latestPose = undefined;
    lastSampledPose = undefined;
    lastSpace = undefined;
    set((state) => (state.currentSpaceId === undefined ? state : { currentSpaceId: undefined }));
  },
}));
