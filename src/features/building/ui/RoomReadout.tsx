import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import type { RoomWalkStatus } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { FLOOR_PLAN, getSpace, getSpaceLabel } from '../domain/floorPlan/index.ts';
import type { FloorSpaceRef } from '../domain/floorSpace.ts';
import { ROOM_READOUT_ID } from './hudIds.ts';

/** Introduces the room the explorer is standing in. */
const ROOM_PREFIX = 'Room:';

/**
 * What the line says about the walk, per status, and which space it names.
 *
 * A prefix here names the walk's **target**, taken from the walk store; `undefined` hands
 * the line back to {@link ROOM_PREFIX} and the **current** room, taken from the pose store.
 *
 * `idle` and `arrived` are both `undefined` on purpose. Arrival needs no message of its own:
 * the destination's label turning up as the room the explorer is in *is* the arrival, which
 * is what keeps a successful walk to exactly two announcements — where it is going, and
 * where it ended up. The two failures are the opposite case: the viewer picked a room and
 * nothing happened, so silence would be the one unacceptable answer.
 *
 * Written as a total record over {@link RoomWalkStatus}, so a new status cannot be added to
 * the walk store without this line deciding what to say about it.
 */
const WALK_PREFIX: Readonly<Record<RoomWalkStatus, string | undefined>> = Object.freeze({
  idle: undefined,
  walking: 'Walking to',
  arrived: undefined,
  unreachable: 'Cannot walk to',
  blocked: 'Stopped before reaching',
});

/** Announced before the first room is resolved, and in the exterior view: nothing at all. */
const NO_MESSAGE = '';
/** HUD panel classes, the same ones the other interior panels wear. */
const PANEL_CLASSES =
  'rounded-lg bg-slate-900 px-2 py-1 text-sm text-white shadow-lg sm:px-4 sm:py-2';
/** Keeps the live region in the DOM while taking no space and showing no pixels. */
const HIDDEN_CLASSES = 'sr-only';

/**
 * Builds the announcement for a space.
 *
 * @param ref - The room to name — which storey, and which room of the typical floor — or
 *   `undefined` when there is nothing to announce.
 * @param prefix - What the line says about that room.
 * @returns e.g. `Room: F2-R11/KIT · Kitchen` or `Walking to F2-R11/KIT · Kitchen`, or the
 *   empty message. The label always comes from `getSpaceLabel`, storey prefix and all, so no
 *   second spelling of a room name can appear anywhere in the app — failure messages
 *   included, and no storey prefix is ever pasted on here.
 */
function getMessage(ref: FloorSpaceRef | undefined, prefix: string): string {
  if (ref === undefined) {
    return NO_MESSAGE;
  }
  return `${prefix} ${getSpaceLabel(getSpace(FLOOR_PLAN, ref.spaceId), ref.floor)}`;
}

/**
 * HUD line announcing the room the explorer is in, or what became of a "go to room" walk.
 *
 * One element is both the visible text and the live region, the `ViewModeToggle` pattern,
 * so what is announced is exactly what is on screen and the two cannot drift. It is a `<p>`
 * with `aria-live="polite"` and **no role**: a second `role="status"` on the page would
 * break the HUD mask of the screenshot specs and every bare `getByRole('status')` query.
 * `aria-atomic` is set because the line is one short phrase that only makes sense re-read
 * whole — "Kitchen" alone, spliced into a half-read sentence, says nothing.
 *
 * While a walk runs, the destination replaces the per-room line (see {@link WALK_PREFIX}).
 * Walking from the stairs to the kitchen crosses the corridor, so the per-room line would
 * announce three rooms mid-walk on top of the start and the arrival; suppressing it leaves
 * exactly two announcements per successful walk.
 *
 * The component only ever reads: it never clears a finished walk, because a store write
 * during render is the wrong place for it and the frame loop drops a terminal status on the
 * viewer's next manual input anyway.
 *
 * With nothing to announce it stays mounted, empty and `sr-only` — in the exterior view,
 * and in the interior view too until the first room resolves a frame or two after entry. A
 * live region has to be in the DOM before its text changes or the first announcement is
 * unreliable, so it never renders `null`; and `sr-only` is absolutely positioned, so an
 * empty one is out of flow: no pixels, no flex gap, and both screenshot baselines
 * unchanged. An empty panel would communicate nothing while baking a dark box into any
 * capture taken before that first frame.
 *
 * @returns The room readout, in every view mode.
 */
export function RoomReadout() {
  const viewMode = useViewStore((state) => state.viewMode);
  const currentSpace = useExplorerPoseStore((state) => state.currentSpace);
  const walkTarget = useRoomWalkStore((state) => state.target);
  const walkStatus = useRoomWalkStore((state) => state.status);

  const isInterior = viewMode === 'interior';
  const walkPrefix = WALK_PREFIX[walkStatus];
  const announced = walkPrefix === undefined ? currentSpace : walkTarget;
  const message = isInterior ? getMessage(announced, walkPrefix ?? ROOM_PREFIX) : NO_MESSAGE;
  /** The panel is worn only when it has something in it; see {@link HIDDEN_CLASSES}. */
  const hasMessage = isInterior && message !== NO_MESSAGE;

  return (
    <p
      id={ROOM_READOUT_ID}
      aria-live="polite"
      aria-atomic="true"
      className={hasMessage ? PANEL_CLASSES : HIDDEN_CLASSES}
    >
      {message}
    </p>
  );
}
