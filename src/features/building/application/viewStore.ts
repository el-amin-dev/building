import { create } from 'zustand';
import { INITIAL_VIEW_MODE, toggleViewMode, type ViewMode } from '../domain/viewMode.ts';

/** State and actions of the building view. */
export interface ViewState {
  /** The current view mode. */
  readonly viewMode: ViewMode;
  /** Switches between the exterior and interior view. */
  readonly toggleViewMode: () => void;
}

/**
 * Global store holding the current building view mode.
 *
 * @returns A React hook selecting from {@link ViewState}.
 */
export const useViewStore = create<ViewState>()((set) => ({
  viewMode: INITIAL_VIEW_MODE,
  toggleViewMode: () => set((state) => ({ viewMode: toggleViewMode(state.viewMode) })),
}));
