import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import { MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { useRoomWalkStore } from './roomWalkStore.ts';
import { useViewStore } from './viewStore.ts';

/** The ground-floor kitchen: the room the one walk in this file asks for. */
const KITCHEN = makeFloorSpaceRef(MIN_FLOOR_COUNT, 'kitchen');

describe('useViewStore', () => {
  beforeEach(() => {
    useViewStore.setState(useViewStore.getInitialState(), true);
  });

  it('starts in the exterior view', () => {
    expect(useViewStore.getState().viewMode).toBe('exterior');
  });

  it('toggles to the interior view and back', () => {
    useViewStore.getState().toggleViewMode();
    expect(useViewStore.getState().viewMode).toBe('interior');

    useViewStore.getState().toggleViewMode();
    expect(useViewStore.getState().viewMode).toBe('exterior');
  });

  it('starts the interior camera in first person', () => {
    expect(useViewStore.getState().interiorCameraMode).toBe('firstPerson');
  });

  it('toggles the interior camera to third person and back', () => {
    useViewStore.getState().toggleInteriorCameraMode();
    expect(useViewStore.getState().interiorCameraMode).toBe('thirdPerson');

    useViewStore.getState().toggleInteriorCameraMode();
    expect(useViewStore.getState().interiorCameraMode).toBe('firstPerson');
  });

  it('keeps the interior camera mode when the view mode is toggled twice', () => {
    useViewStore.getState().toggleInteriorCameraMode();

    useViewStore.getState().toggleViewMode();
    useViewStore.getState().toggleViewMode();

    expect(useViewStore.getState().interiorCameraMode).toBe('thirdPerson');
  });

  it('leaves the view mode alone when the interior camera mode is toggled', () => {
    useViewStore.getState().toggleViewMode();

    useViewStore.getState().toggleInteriorCameraMode();

    expect(useViewStore.getState().viewMode).toBe('interior');
  });

  describe('the camera transition', () => {
    it('is not running at first', () => {
      expect(useViewStore.getState().cameraTransition).toBe('none');
    });

    it('travels inward when the interior view is entered', () => {
      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().cameraTransition).toBe('toInterior');
    });

    it('travels outward when the building is left', () => {
      useViewStore.getState().toggleViewMode();

      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().cameraTransition).toBe('toExterior');
    });

    it('moves the view mode at the start of the travel, not at its end', () => {
      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().viewMode).toBe('interior');
      expect(useViewStore.getState().cameraTransition).toBe('toInterior');
    });

    it('stops running when the frame loop reports the camera has arrived', () => {
      useViewStore.getState().toggleViewMode();

      useViewStore.getState().endCameraTransition();

      expect(useViewStore.getState().cameraTransition).toBe('none');
      expect(useViewStore.getState().viewMode).toBe('interior');
    });

    it('restarts on the next view change after it has ended', () => {
      useViewStore.getState().toggleViewMode();
      useViewStore.getState().endCameraTransition();

      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().cameraTransition).toBe('toExterior');
    });

    it('changes nothing when it is ended twice', () => {
      const before = useViewStore.getState();

      before.endCameraTransition();

      expect(useViewStore.getState()).toBe(before);
    });

    it('is left alone by the interior camera mode toggle', () => {
      useViewStore.getState().toggleViewMode();
      useViewStore.getState().endCameraTransition();

      useViewStore.getState().toggleInteriorCameraMode();

      expect(useViewStore.getState().cameraTransition).toBe('none');
    });
  });

  describe('the reduced-motion preference', () => {
    it('is unset at first', () => {
      expect(useViewStore.getState().prefersReducedMotion).toBe(false);
    });

    it('is recorded, and recording the same value changes nothing', () => {
      useViewStore.getState().setPrefersReducedMotion(true);
      expect(useViewStore.getState().prefersReducedMotion).toBe(true);

      const before = useViewStore.getState();
      before.setPrefersReducedMotion(true);

      expect(useViewStore.getState()).toBe(before);
    });

    it('suppresses the camera travel, leaving the view switch instant', () => {
      useViewStore.getState().setPrefersReducedMotion(true);

      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().viewMode).toBe('interior');
      expect(useViewStore.getState().cameraTransition).toBe('none');
    });

    it('suppresses it in both directions', () => {
      useViewStore.getState().setPrefersReducedMotion(true);

      useViewStore.getState().toggleViewMode();
      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().viewMode).toBe('exterior');
      expect(useViewStore.getState().cameraTransition).toBe('none');
    });

    it('keeps the interior camera mode across a suppressed switch', () => {
      useViewStore.getState().setPrefersReducedMotion(true);
      useViewStore.getState().toggleInteriorCameraMode();

      useViewStore.getState().toggleViewMode();
      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().interiorCameraMode).toBe('thirdPerson');
    });

    it('stops a running travel from outliving the preference being set mid-flight', () => {
      useViewStore.getState().toggleViewMode();
      expect(useViewStore.getState().cameraTransition).toBe('toInterior');

      useViewStore.getState().setPrefersReducedMotion(true);
      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().cameraTransition).toBe('none');
    });

    // Reduced motion governs the camera transition and nothing else: walking to a room is
    // locomotion, not decoration, so a walk in progress is not touched by the preference.
    it('leaves a "go to room" walk untouched', () => {
      useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
      useRoomWalkStore.getState().startWalkTo(KITCHEN);
      const walk = useRoomWalkStore.getState();
      useViewStore.getState().setPrefersReducedMotion(true);

      useViewStore.getState().toggleViewMode();

      expect(useViewStore.getState().cameraTransition).toBe('none');
      expect(useRoomWalkStore.getState()).toBe(walk);
      expect(useRoomWalkStore.getState().status).toBe('walking');
      expect(useRoomWalkStore.getState().target).toBe(KITCHEN);
    });
  });
});
