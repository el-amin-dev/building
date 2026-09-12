import { create } from 'zustand';
import {
  INITIAL_INTERIOR_CAMERA_MODE,
  INITIAL_VIEW_MODE,
  toggleInteriorCameraMode,
  toggleViewMode,
  type InteriorCameraMode,
  type ViewMode,
} from '../domain/viewMode.ts';

/**
 * Which way the camera is travelling between the two views, or `'none'` when it is
 * not travelling at all.
 *
 * It is a phase of the camera and of nothing else: the view mode, the HUD and the
 * focus all move at the *start* of a transition (see {@link ViewState.toggleViewMode}),
 * so everything outside the camera behaves exactly as it did before transitions
 * existed and nothing has to wait for a tween to finish.
 */
export type CameraTransition = 'none' | 'toInterior' | 'toExterior';

/** No camera travel in progress. */
const NO_CAMERA_TRANSITION: CameraTransition = 'none';

/**
 * The camera travel a switch *into* `mode` starts.
 *
 * @param mode - The view mode being switched to.
 * @returns `'toInterior'` when entering the building, `'toExterior'` when leaving it.
 */
function getCameraTransition(mode: ViewMode): CameraTransition {
  return mode === 'interior' ? 'toInterior' : 'toExterior';
}

/** State and actions of the building view. */
export interface ViewState {
  /** The current view mode. */
  readonly viewMode: ViewMode;
  /**
   * Switches between the exterior and interior view, and starts the camera travel
   * that goes with it — unless {@link ViewState.prefersReducedMotion} is set, in
   * which case the phase stays `'none'` and the switch is instant.
   */
  readonly toggleViewMode: () => void;
  /**
   * How the interior camera follows the person. Kept when the view mode
   * changes, so re-entering the interior restores the last camera mode.
   */
  readonly interiorCameraMode: InteriorCameraMode;
  /** Switches the interior camera between first and third person. */
  readonly toggleInteriorCameraMode: () => void;
  /** Which way the camera is currently travelling between the views. */
  readonly cameraTransition: CameraTransition;
  /**
   * Reported by the frame loop when the camera has arrived; a no-op update returns
   * the previous state.
   */
  readonly endCameraTransition: () => void;
  /** Whether the viewer asked for reduced motion (`ui/usePrefersReducedMotion.ts`). */
  readonly prefersReducedMotion: boolean;
  /** Records the viewer's motion preference; a no-op update returns the previous state. */
  readonly setPrefersReducedMotion: (value: boolean) => void;
}

/**
 * Global store holding the current building view mode, the interior camera mode and
 * the phase of the exterior↔interior camera travel.
 *
 * The transition phase lives here rather than in the component that animates it for
 * the same reason the view mode does: the camera controls are sides of a ternary in
 * `BuildingScene` and unmount on every view change, so anything they held would die
 * with them. The phase is also what the view region stamps for the e2e gate, and what
 * gates the controls that must not fight the tween.
 *
 * **The reduced-motion preference governs this transition and nothing else.** It
 * suppresses the phase, which makes the view switch bit-for-bit the instant one the
 * app had before transitions existed. It is deliberately *not* consulted anywhere
 * else: an automatic walk to a room is locomotion rather than decoration, so its
 * speed, its route and its outcome are untouched by it.
 *
 * Every update that changes nothing returns the previous state unchanged, as the
 * other stores do, so no subscriber is notified pointlessly.
 *
 * @returns A React hook selecting from {@link ViewState}.
 */
export const useViewStore = create<ViewState>()((set) => ({
  viewMode: INITIAL_VIEW_MODE,
  toggleViewMode: () =>
    set((state) => {
      const viewMode = toggleViewMode(state.viewMode);
      return {
        viewMode,
        cameraTransition: state.prefersReducedMotion
          ? NO_CAMERA_TRANSITION
          : getCameraTransition(viewMode),
      };
    }),
  interiorCameraMode: INITIAL_INTERIOR_CAMERA_MODE,
  toggleInteriorCameraMode: () =>
    set((state) => ({ interiorCameraMode: toggleInteriorCameraMode(state.interiorCameraMode) })),
  cameraTransition: NO_CAMERA_TRANSITION,
  endCameraTransition: () =>
    set((state) =>
      state.cameraTransition === NO_CAMERA_TRANSITION
        ? state
        : { cameraTransition: NO_CAMERA_TRANSITION },
    ),
  prefersReducedMotion: false,
  setPrefersReducedMotion: (value) =>
    set((state) =>
      state.prefersReducedMotion === value ? state : { prefersReducedMotion: value },
    ),
}));
