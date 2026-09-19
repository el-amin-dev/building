import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { BuiltFixture } from '../domain/fixtures.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import type { SpaceKind } from '../domain/floorPlan/index.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { PORT_SCHEDULE } from '../domain/ports/index.ts';
import { getRoomInfo, NO_DAYLIGHT_NOTE } from '../domain/roomInfo.ts';
import type { RoomDoor, RoomInfo } from '../domain/roomInfo.ts';
import type { FloorWindow } from '../domain/windows.ts';
import { BUILT_FLOOR } from './floorInstance.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';

/**
 * DOM id of the panel the trigger opens.
 *
 * Module-private rather than in `hudIds.ts`, because nothing outside this file names it:
 * the trigger, the panel and its heading are one component, and the id is only here so
 * `aria-controls` and `aria-labelledby` have something to resolve.
 */
const PANEL_ID = 'room-info-panel';

/** DOM id of the panel's heading, which is what gives the section its accessible name. */
const HEADING_ID = 'room-info-heading';

/**
 * The part of the trigger's name that is not the room, and the half that stays VISIBLE
 * on a phone — the room label is the half that goes `sr-only` there.
 *
 * That is the opposite of the `FloorCountStepper` move, and it has to be. This trigger
 * shares a row with "Go to room", and the label is the long half: `F1-R06/STR · Stairwell`
 * is three times the width of these three words, so keeping it and hiding the caption wraps
 * the row onto a second line at 400 px and takes the 3D view from 60 % of the viewport
 * height to 57 %. `remoteControl.spec.ts` measures exactly that and fails, which is how this
 * was caught — and it only failed intermittently, because the panel renders nothing at all
 * until the viewer's room resolves, so the second row appeared a beat after the page did.
 *
 * Nothing is lost to assistive technology: the accessible name is the button's whole text
 * content, `sr-only` half included, so it still names the room.
 */
const TRIGGER_CAPTION = 'About this room';

/** `KeyboardEvent.key` that closes the panel, as every disclosure does. */
const CLOSE_KEY = 'Escape';

/** `MouseEvent.detail` of a click fired by the keyboard (Enter or Space); pointer clicks count up from 1. */
const KEYBOARD_CLICK_DETAIL = 0;

/** Decimal places every length and area is printed to: the plan is drawn on a centimetre grid. */
const DECIMALS = 2;

/** An empty list, said in words; see the four constants below. */
const NO_DOORS = 'Nothing opens into it';
const NO_WINDOWS = 'No windows';
const NO_FIXTURES = 'Nothing stands in it';
const NO_OPEN_ITEMS = 'Nothing open';

/** What the panel calls each thing it lists. */
const MATRICULE_TERM = 'Matricule';
const SIZE_TERM = 'Clear size';
const AREA_TERM = 'Area';
const DOORS_TERM = 'Doors and openings';
const WINDOWS_TERM = 'Windows';
const FIXTURES_TERM = 'Fixtures';
const OPEN_ITEMS_TERM = 'Open items';

/**
 * The kinds of space that are under the open sky.
 *
 * `getRoomInfo` derives `daylight: 'none'` for the two balconies no window happens to
 * name — `ccBalcony` and `balconySlabB` — and so puts {@link NO_DAYLIGHT_NOTE} in their
 * open items. That is a finding its own docblock records rather than a defect: a balcony
 * *is* under the sky, but `DaylightSource` has no value saying so, and inventing one there
 * would change the contract every other consumer of the type reads.
 *
 * So the sentence is suppressed here, at the one place the derived answer is turned into
 * words. "Electric light only (no daylight)" printed on a balcony is simply false, and the
 * viewer standing on one can see that it is; a room with the lights on is what the sentence
 * is for, and an `openAir` space or a `void` is not one.
 */
const SKY_KINDS: readonly SpaceKind[] = Object.freeze(['openAir', 'void']);

/** The HUD's button look, copied from `CameraModeToggle` so the strip reads as one control. */
const TRIGGER_CLASS_NAME =
  'min-h-6 min-w-6 cursor-pointer rounded-md bg-white px-2 py-1 text-sm font-medium text-slate-900 hover:bg-slate-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-400 sm:px-3 sm:py-1.5';

/**
 * The open panel: anchored below the trigger, tall enough to scroll, and out of flow.
 *
 * `absolute top-full left-0` for the reason `RoomMenu`'s list docblock sets out at length —
 * an `absolute` box with no offset falls back to its static position, which the wrapper's
 * centring flex row puts above the top of the window — and out of flow for a second reason
 * of its own: the HUD overlay's bounding box must not grow when the panel opens.
 * `tests/e2e/remoteControl.spec.ts` asserts the 3D view keeps at least 60 % of the height at
 * a 400 px width, and `tests/e2e/sceneCapture.ts` finds the HUD to hide it by the
 * `data-hud-overlay` attribute on that same box. A panel in flow would push both.
 */
const PANEL_CLASS_NAME =
  'absolute top-full left-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg bg-slate-900 p-2 text-sm text-white shadow-lg';

/**
 * Prints a length or an area to the centimetre.
 *
 * @param metres - The value, in metres or square metres.
 * @returns It to two decimals, e.g. `0.90`.
 */
function formatLength(metres: number): string {
  return metres.toFixed(DECIMALS);
}

/**
 * Describes one of a room's rectangles as a size.
 *
 * One line per rectangle and never a bounding box: the kitchen, the corridor and the guest
 * room are each drawn as two, and their box states a width and a depth the room does not
 * have (`domain/roomInfo.ts`). The subtraction is the only arithmetic in this file, and it
 * is a rectangle's own two sides rather than a fact about the room.
 *
 * @param rect - One clear rectangle of the room.
 * @returns e.g. `2.20 × 2.30 m`.
 */
function formatRect(rect: PlanRect): string {
  return `${formatLength(rect.maxX - rect.minX)} × ${formatLength(rect.maxZ - rect.minZ)} m`;
}

/**
 * Describes one passage into the room: where it leads, how wide it is, and how it moves.
 *
 * @param door - The passage, as `getRoomInfo` lists it.
 * @returns e.g. `Corridor — 0.90 m door, sliding`.
 */
function formatDoor(door: RoomDoor): string {
  const movement = door.sliding ? ', sliding' : '';
  return `${door.partnerName} — ${formatLength(door.width)} m ${door.kind}${movement}`;
}

/**
 * Describes one window: what it is for, and where it sits in the wall.
 *
 * @param window - The window, as the built floor holds it.
 * @returns e.g. `light — sill 0.90 m, head 2.10 m`.
 */
function formatWindow(window: FloorWindow): string {
  return `${window.kind} — sill ${formatLength(window.sill)} m, head ${formatLength(window.head)} m`;
}

/**
 * Describes one fixture by its X number, what it is, and what the plan says about it.
 *
 * @param fixture - The fixture, as the built floor holds it.
 * @returns e.g. `R12/LND-X3 · sink — dirty clothes`.
 */
function formatFixture(fixture: BuiltFixture): string {
  const note = fixture.note === undefined ? '' : ` — ${fixture.note}`;
  return `${fixture.matricule} · ${fixture.kind}${note}`;
}

/**
 * The open items as the panel prints them, with the balcony sentence taken out.
 *
 * @param info - Everything known about the room.
 * @returns Its open items, minus {@link NO_DAYLIGHT_NOTE} when the space is under the
 *   sky; see {@link SKY_KINDS} for why that is decided here and not in the domain.
 */
function getShownOpenItems(info: RoomInfo): readonly string[] {
  if (!SKY_KINDS.includes(info.kind)) {
    return info.openItems;
  }
  return info.openItems.filter((item) => item !== NO_DAYLIGHT_NOTE);
}

/**
 * One term of the panel and what the model answers for it.
 *
 * A `<div>` inside the `<dl>` so that each pair is one block, which is what HTML allows a
 * definition list to be grouped by.
 *
 * @param props - The term, and the answer to render under it.
 * @param props.term - What the panel calls this thing.
 * @param props.children - The answer.
 * @returns The pair.
 */
function Field({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <dt className="font-semibold text-slate-300">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A list of lines, or a sentence saying there are none.
 *
 * An empty `<ul>` says nothing to anyone reading it and reads as a bug to anyone with a
 * screen reader ("list, 0 items"), so an empty list is words instead.
 *
 * @param props - The lines and what to say when there are none.
 * @param props.items - The lines, in the order the model gives them.
 * @param props.empty - The sentence for an empty list.
 * @returns The list, or the sentence.
 */
function Lines({ items, empty }: { readonly items: readonly string[]; readonly empty: string }) {
  if (items.length === 0) {
    return <p>{empty}</p>;
  }
  return (
    <ul>
      {items.map((line, index) => (
        <li key={`${String(index)}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * HUD disclosure telling the viewer what the room they are standing in actually is.
 *
 * A trigger naming the current room and a panel holding everything the model knows about
 * it: its matricule, its clear size rectangle by rectangle, its area, what opens into it,
 * its windows, what stands in it, and what is still unsettled about it. The disclosure is
 * `RoomMenu`'s, down to the offsets on the open panel and the way focus is handed back;
 * the content is `getRoomInfo`'s, verbatim. **This component derives nothing.** The two
 * subtractions it does — a rectangle's width from its own two x's, its depth from its two
 * z's — are the sides of a rectangle it was handed, and every number, name and sentence
 * beyond them comes from the domain already worded (`domain/roomInfo.ts`).
 *
 * ## Why it is not a live region
 *
 * The room changes as the viewer walks, and `RoomReadout` already announces it. A second
 * live region over the same fact would double-announce every doorway, and this HUD rations
 * `role="status"` to exactly one element — the view status of `ViewModeToggle` — because
 * the screenshot mask and several bare `getByRole('status')` queries all depend on there
 * being one. So the panel carries no `role`, no `aria-live` and no `aria-atomic`: it is a
 * `<section>` labelled by its own heading, read on demand, and reachable by heading
 * navigation. It follows the viewer from room to room while it is open rather than closing,
 * which is the behaviour a reader who opened it and then walked would expect.
 *
 * ## Focus
 *
 * `CameraModeToggle`'s rule, which `RoomMenu` also follows: after a **pointer** press focus
 * goes to the 3D view region, so the navigation keys and the remote pad keep working while
 * the viewer reads; after a **keyboard** press (`event.detail === 0`) focus stays on the
 * trigger, where the user put it, and `Escape` closes the panel and keeps it there. Nothing
 * inside the panel is focusable, so nothing is trapped and no focus is lost when it closes.
 *
 * `aria-controls` is set only while the panel is mounted, the dangling-IDREF trap
 * `RoomMenu`'s docblock flags: an `aria-controls` naming an element that is not in the
 * document is an IDREF assistive technology cannot resolve, and axe reports it as
 * *incomplete* rather than a violation, so no audit would catch it.
 *
 * Interior view only, like every other control that presupposes being inside; and nothing
 * at all while the viewer is in no room — over a void, inside a wall, or before the first
 * frame resolves one — because there is then no room to be about.
 *
 * @returns The room info panel in the interior view, otherwise `null`.
 */
export function RoomInfoPanel() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const currentSpace = useExplorerPoseStore((state) => state.currentSpace);
  const [isOpen, setIsOpen] = useState(false);
  const [wasInterior, setWasInterior] = useState(isInterior);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Keyed on the room identity, which the pose store only replaces when the room actually
  // changes, so walking the length of one room re-derives nothing.
  const info = useMemo(
    () =>
      currentSpace === undefined
        ? undefined
        : getRoomInfo(FLOOR_PLAN, PORT_SCHEDULE, BUILT_FLOOR, currentSpace),
    [currentSpace],
  );

  // Leaving the interior stops rendering the panel without closing it, so re-entering would
  // show it open again, over a view the viewer has just come back to. Adjusted while
  // rendering rather than in an effect, as `RoomMenu` does it: React finishes this render
  // with the new state before anything is painted, so there is no flash of an open panel and
  // no second commit (react.dev/learn/you-might-not-need-an-effect).
  if (wasInterior !== isInterior) {
    setWasInterior(isInterior);
    setIsOpen(false);
  }

  if (!isInterior || info === undefined) {
    return null;
  }

  /**
   * Toggles the panel and puts focus where the press asked for it.
   *
   * @param event - The click, whose `detail` says whether a pointer or a key fired it.
   */
  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    setIsOpen((wasOpen) => !wasOpen);
    if (event.detail > KEYBOARD_CLICK_DETAIL) {
      document.getElementById(INTERIOR_REGION_ID)?.focus();
    }
  };

  /**
   * Closes the panel on Escape and keeps focus on the trigger.
   *
   * @param event - The key press, from anywhere inside the control.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== CLOSE_KEY || !isOpen) {
      return;
    }
    setIsOpen(false);
    triggerRef.current?.focus();
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
        aria-controls={isOpen ? PANEL_ID : undefined}
        onClick={handleTriggerClick}
        className={TRIGGER_CLASS_NAME}
      >
        <span>{TRIGGER_CAPTION}</span> <span className="sr-only sm:not-sr-only">{info.label}</span>
      </button>
      {isOpen ? (
        <section id={PANEL_ID} aria-labelledby={HEADING_ID} className={PANEL_CLASS_NAME}>
          <h2 id={HEADING_ID} className="text-sm font-semibold">
            {info.label}
          </h2>
          <dl className="mt-2">
            <Field term={MATRICULE_TERM}>{info.matricule}</Field>
            <Field term={SIZE_TERM}>
              <ul>
                {info.rects.map((rect, index) => (
                  <li key={`${String(index)}-${formatRect(rect)}`}>{formatRect(rect)}</li>
                ))}
              </ul>
            </Field>
            <Field term={AREA_TERM}>{formatLength(info.area)} m²</Field>
            <Field term={DOORS_TERM}>
              <Lines items={info.doors.map(formatDoor)} empty={NO_DOORS} />
            </Field>
            <Field term={WINDOWS_TERM}>
              <Lines items={info.windows.map(formatWindow)} empty={NO_WINDOWS} />
            </Field>
            <Field term={FIXTURES_TERM}>
              <Lines items={info.fixtures.map(formatFixture)} empty={NO_FIXTURES} />
            </Field>
            <Field term={OPEN_ITEMS_TERM}>
              <Lines items={getShownOpenItems(info)} empty={NO_OPEN_ITEMS} />
            </Field>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
