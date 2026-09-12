import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { getSpaceLabel } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { INTERIOR_REGION_ID, ROOM_LIST_ID } from './hudIds.ts';
import { ROOM_TARGETS } from './roomTargets.ts';

/** Accessible name of the disclosure button that opens the room list. */
const TRIGGER_LABEL = 'Go to room';

/** Accessible name of the button that abandons a walk in progress. */
const STOP_LABEL = 'Stop walking';

/** `KeyboardEvent.key` that closes the list, as every disclosure does. */
const CLOSE_KEY = 'Escape';

/** `MouseEvent.detail` of a click fired by the keyboard (Enter or Space); pointer clicks count up from 1. */
const KEYBOARD_CLICK_DETAIL = 0;

/**
 * The HUD's button look, shared by the trigger and the stop button.
 *
 * Copied from `CameraModeToggle` and the view toggle so the panel reads as one control strip;
 * `min-h-6 min-w-6` is the 24 px target floor of WCAG 2.5.8.
 */
const HUD_BUTTON_CLASS_NAME =
  'min-h-6 min-w-6 cursor-pointer rounded-md bg-white px-2 py-1 text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 sm:px-3 sm:py-1.5';

/** The look of one room in the open list: a full-width row on the panel's dark ground. */
const ROOM_ITEM_CLASS_NAME =
  'block min-h-6 w-full cursor-pointer rounded-md px-2 py-1 text-left text-sm text-white hover:bg-slate-700 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400';

/**
 * HUD control that walks the viewer to a room they pick.
 *
 * A disclosure button and a plain list of native buttons, one per room of
 * {@link ROOM_TARGETS}. Deliberately neither of the two obvious alternatives:
 *
 * - not a `<select>`, because arrow-keying a closed select fires `change` on every key on
 *   some platforms, so each arrow press would start a walk — a change of context the user
 *   did not ask for (WCAG 3.2.2);
 * - not `role="menu"` or `role="listbox"`, because those promise a keyboard contract
 *   (arrows, Home/End, typeahead, roving tabindex) that native buttons in a list already
 *   give for free, with no focus management to get wrong.
 *
 * Picking a room only records the command, through `startWalkTo`. No pose, route or jump is
 * computed here: the walk is a per-frame concern, and the store is deliberately the whole of
 * the contract between this menu and the frame loop (`roomWalkStore.ts`, ADR-007).
 *
 * "Stop walking" appears only while a walk is running. Activating a room starts motion the
 * viewer is not physically driving, so there has to be an on-screen way to end it — the same
 * reason the remote control exists, and the half of cancellation that WCAG cares about.
 *
 * Focus, following `CameraModeToggle`'s precedent exactly: after a **pointer** pick focus
 * goes to the 3D view region, so the keys and the pad keep working while the viewer watches
 * the walk; after a **keyboard** pick it returns to the trigger, because keyboard focus must
 * not be moved somewhere the user did not put it. The two are told apart by `event.detail`,
 * which is 0 for a keyboard click. Both routes matter here beyond convenience: the control
 * that was activated leaves the DOM — the list closes, and the stop button disappears when
 * the walk ends — so leaving focus where it was would drop it onto `<body>`.
 *
 * Rendered only in the interior view, like `CameraModeToggle` and `RemoteControl`: walking to
 * a room presupposes being inside the building.
 *
 * @returns The room menu in the interior view, otherwise `null`.
 */
export function RoomMenu() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const isWalking = useRoomWalkStore((state) => state.status === 'walking');
  const startWalkTo = useRoomWalkStore((state) => state.startWalkTo);
  const cancelWalk = useRoomWalkStore((state) => state.cancelWalk);
  const [isOpen, setIsOpen] = useState(false);
  const [wasInterior, setWasInterior] = useState(isInterior);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Leaving the interior stops rendering the list without closing it, so re-entering would
  // show it open again — over a view the viewer has just come back to, and out of step with
  // the trigger the exterior never showed them. Adjusted while rendering rather than in an
  // effect: React finishes this render with the new state before anything is painted, so
  // there is no flash of an open list and no second commit
  // (react.dev/learn/you-might-not-need-an-effect).
  if (wasInterior !== isInterior) {
    setWasInterior(isInterior);
    setIsOpen(false);
  }

  if (!isInterior) {
    return null;
  }

  /**
   * Puts focus somewhere usable after a control that removes itself was activated.
   *
   * @param event - The click, whose `detail` says whether a pointer or a key fired it.
   */
  const returnFocus = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > KEYBOARD_CLICK_DETAIL) {
      document.getElementById(INTERIOR_REGION_ID)?.focus();
      return;
    }
    triggerRef.current?.focus();
  };

  const handleTriggerClick = () => {
    setIsOpen((wasOpen) => !wasOpen);
  };

  /**
   * Closes the list and hands focus back to the trigger, wherever inside the control the key
   * was pressed: on the trigger, or on a room the viewer had tabbed to.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== CLOSE_KEY || !isOpen) {
      return;
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  /**
   * Asks for a walk to one room and closes the list.
   *
   * Focus is moved before React unmounts the list, so the picked button is no longer the
   * active element by the time it goes.
   *
   * @param spaceId - The room the viewer picked.
   * @returns The click handler for that room's button.
   */
  const handlePick = (spaceId: SpaceId) => (event: MouseEvent<HTMLButtonElement>) => {
    startWalkTo(spaceId);
    setIsOpen(false);
    returnFocus(event);
  };

  const handleStop = (event: MouseEvent<HTMLButtonElement>) => {
    cancelWalk();
    returnFocus(event);
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="relative flex flex-wrap items-center gap-2 rounded-lg bg-slate-900 px-2 py-1 shadow-lg sm:px-4 sm:py-2"
    >
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={isOpen}
        aria-controls={ROOM_LIST_ID}
        onClick={handleTriggerClick}
        className={HUD_BUTTON_CLASS_NAME}
      >
        {TRIGGER_LABEL}
      </button>
      {isWalking ? (
        <button type="button" onClick={handleStop} className={HUD_BUTTON_CLASS_NAME}>
          {STOP_LABEL}
        </button>
      ) : null}
      {isOpen ? (
        <ul
          id={ROOM_LIST_ID}
          className="absolute z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg bg-slate-900 p-2 shadow-lg"
        >
          {ROOM_TARGETS.map((space) => (
            <li key={space.id}>
              <button type="button" onClick={handlePick(space.id)} className={ROOM_ITEM_CLASS_NAME}>
                {getSpaceLabel(space)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
