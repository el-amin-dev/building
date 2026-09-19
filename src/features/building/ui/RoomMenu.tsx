import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { getSpaceLabel } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import { MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { INTERIOR_REGION_ID, ROOM_LIST_ID } from './hudIds.ts';
import { ROOM_TARGETS } from './roomTargets.ts';

/**
 * Accessible name of the disclosure button that opens the room list.
 *
 * Says no storey, and says none on purpose: the storey is on the list it opens, and two
 * end-to-end specs match this string verbatim.
 */
const TRIGGER_LABEL = 'Go to room';

/**
 * Opens the accessible name of the open list, which the storey number finishes.
 *
 * Written here rather than taken from `getFloorLabel`, which capitalises the word for a
 * label that stands alone (`Floor 3`). This one is mid-sentence, where `Rooms on Floor 3`
 * would read as a proper noun; the storey *number* is still the domain's, and the minimap's
 * chip — the place a storey is actually named to the viewer — does use the domain's wording.
 */
const ROOM_LIST_LABEL_PREFIX = 'Rooms on floor';

/** Accessible name of the button that abandons a walk in progress. */
const STOP_LABEL = 'Stop walking';

/** `KeyboardEvent.key` that closes the list, as every disclosure does. */
const CLOSE_KEY = 'Escape';

/** `MouseEvent.detail` of a click fired by the keyboard (Enter or Space); pointer clicks count up from 1. */
const KEYBOARD_CLICK_DETAIL = 0;

/** The close counter before any storey change has closed an open list: nothing to do yet. */
const NO_FLOOR_CHANGE_CLOSES = 0;

/** How much one such close raises the counter, so every close is a value of its own. */
const FLOOR_CHANGE_CLOSE_STEP = 1;

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
 * The open list: a panel anchored below the trigger, tall enough to scroll.
 *
 * **`top-full left-0` is load-bearing, not decoration.** Without an explicit offset an
 * `absolute` box falls back to its *static* position — where it would have sat in the
 * wrapper's `flex flex-wrap items-center` row — and that row centres its items, so a
 * 256 px-tall list was centred on a ~44 px panel: the computed `top` came out at −106 px
 * (−112 px at a phone width), which put the first rooms above the top edge of the window.
 * There they stayed, unreachable by pointer *and* by keyboard, because nothing between the
 * list and `<main class="overflow-hidden">` can scroll in that direction — and the rest of
 * the list covered the toggles and the hint. The offsets resolve against the wrapper below,
 * which carries `relative`.
 *
 * `max-h-64` with `overflow-y-auto` is what keeps twenty rooms inside the window: the
 * panel sits near the top of the viewport, so 256 px below it clears the bottom edge at
 * every viewport these tests cover (`tests/e2e/explore.spec.ts` measures every item).
 */
const ROOM_LIST_CLASS_NAME =
  'absolute top-full left-0 z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg bg-slate-900 p-2 shadow-lg';

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
 * **The rooms of the storey the viewer is on, and no other.** Every storey is the same plan,
 * so a list of every room of every storey would be {@link ROOM_TARGETS} repeated once per
 * floor — 220 buttons at ten storeys, 219 of which are the same twenty rooms said again. The
 * list therefore stays twenty rooms long whatever the stack's height, and names the storey
 * once, on the list itself.
 *
 * **There is deliberately no floor switcher here.** The way to change storey is the stairs:
 * a walk is planned on one floor's reachability graph and the route follower walks it there,
 * so `startWalkTo` cannot cross a storey in this part. A menu offering "kitchen, floor 5"
 * would be offering something the walk cannot do — it would start a walk on the storey the
 * viewer is standing on and label it with another one's number, which is a lie told in the
 * accessible name. When cross-floor walking exists, this is where it goes.
 *
 * @returns The room menu in the interior view, otherwise `null`.
 */
export function RoomMenu() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const isWalking = useRoomWalkStore((state) => state.status === 'walking');
  const startWalkTo = useRoomWalkStore((state) => state.startWalkTo);
  const cancelWalk = useRoomWalkStore((state) => state.cancelWalk);
  const currentFloor = useExplorerPoseStore((state) => state.currentFloor);
  const [isOpen, setIsOpen] = useState(false);
  const [wasInterior, setWasInterior] = useState(isInterior);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The storey whose rooms are listed: the one the viewer is on, or the ground floor until
   * the first pose says otherwise. The list is never labelled with a storey it is not of.
   */
  const shownFloor = currentFloor ?? MIN_FLOOR_COUNT;
  const [wasFloor, setWasFloor] = useState(shownFloor);

  /**
   * How many times a storey change has closed an open list: the effect below watches this
   * for a change rather than for a value.
   *
   * A counter and not a boolean, and state and not a ref, because both of the obvious
   * shapes are wrong here. A ref written while rendering is an ESLint error
   * (`react-hooks/refs`), and a boolean the effect had to clear would need a `setState`
   * inside it, which is another one (`react-hooks/set-state-in-effect`). A number that only
   * ever goes up needs no clearing: every close is a value the effect has not seen, so a
   * viewer who goes 3 → 5 → 3 → 5 with the list open each time gets focus back all four
   * times — which storing the storey number would have missed on the fourth.
   */
  const [closedByFloorChangeCount, setClosedByFloorChangeCount] = useState(NO_FLOOR_CHANGE_CLOSES);

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

  // Climbing a storey with the list open would leave the viewer reading another storey's
  // rooms — the same twenty names, under a heading that now says the wrong floor, offering
  // walks that start where they are standing. Closed for the same reason leaving the
  // interior closes it, and adjusted while rendering for the same reason: no flash of a
  // stale list, no second commit (react.dev/learn/you-might-not-need-an-effect).
  if (wasFloor !== shownFloor) {
    setWasFloor(shownFloor);
    setIsOpen(false);
    if (isOpen) {
      setClosedByFloorChangeCount((count) => count + FLOOR_CHANGE_CLOSE_STEP);
    }
  }

  // Closing the list unmounts whichever room button held focus, which drops focus onto
  // `<body>` — where the keyboard has nothing to Tab from. The effect runs after the commit
  // that removed the list, so `document.activeElement` is the honest answer to "did that
  // close cost anyone their focus?": `<body>` means it did, and anything else means focus is
  // somewhere the viewer put it, where moving it would be taking it from them.
  useEffect(() => {
    if (closedByFloorChangeCount === NO_FLOOR_CHANGE_CLOSES) {
      return;
    }
    if (document.activeElement === null || document.activeElement === document.body) {
      triggerRef.current?.focus();
    }
  }, [closedByFloorChangeCount]);

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
   * @param spaceId - The room the viewer picked, on the storey they are standing on.
   * @returns The click handler for that room's button.
   */
  const handlePick = (spaceId: SpaceId) => (event: MouseEvent<HTMLButtonElement>) => {
    startWalkTo(makeFloorSpaceRef(shownFloor, spaceId));
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
        // Only while the list exists. The `<ul>` is mounted with the disclosure, so a
        // permanent `aria-controls` names an element that is not in the document for most of
        // the control's life — an IDREF assistive technology has to resolve and cannot. No
        // automated check catches it: axe downgrades `aria-controls` on an element whose
        // `aria-expanded` is `false` to *incomplete* rather than a violation, by design, so
        // all four audits in `tests/e2e/accessibility.spec.ts` pass either way.
        aria-controls={isOpen ? ROOM_LIST_ID : undefined}
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
          aria-label={`${ROOM_LIST_LABEL_PREFIX} ${String(shownFloor)}`}
          className={ROOM_LIST_CLASS_NAME}
        >
          {ROOM_TARGETS.map((space) => (
            <li key={space.id}>
              <button type="button" onClick={handlePick(space.id)} className={ROOM_ITEM_CLASS_NAME}>
                {getSpaceLabel(space, shownFloor)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
