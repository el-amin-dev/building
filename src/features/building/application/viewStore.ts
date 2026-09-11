import { create } from 'zustand';
import {
  INITIAL_INTERIOR_CAMERA_MODE,
  INITIAL_VIEW_MODE,
  toggleInteriorCameraMode,
  toggleViewMode,
  type InteriorCameraMode,
  type ViewMode,
} from '../domain/viewMode.ts';

/** State and actions of the building view. */
export interface ViewState {
  /** The current view mode. */
  readonly viewMode: ViewMode;
  /** Switches between the exterior and interior view. */
  readonly toggleViewMode: () => void;
  /**
   * How the interior camera follows the person. Kept when the view mode
   * changes, so re-entering the interior restores the last camera mode.
   */
  readonly interiorCameraMode: InteriorCameraMode;
  /** Switches the interior camera between first and third person. */
  readonly toggleInteriorCameraMode: () => void;
}

/**
 * Global store holding the current building view mode and interior camera mode.
 *
 * @returns A React hook selecting from {@link ViewState}.
 */
export const useViewStore = create<ViewState>()((set) => ({
  viewMode: INITIAL_VIEW_MODE,
  toggleViewMode: () => set((state) => ({ viewMode: toggleViewMode(state.viewMode) })),
  interiorCameraMode: INITIAL_INTERIOR_CAMERA_MODE,
  toggleInteriorCameraMode: () =>
    set((state) => ({ interiorCameraMode: toggleInteriorCameraMode(state.interiorCameraMode) })),
}));
