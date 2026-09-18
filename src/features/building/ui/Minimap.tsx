import { useEffect, useRef, useState } from 'react';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { FLOOR_PLAN, PLOT_RECT, getSpace, getSpaceLabel } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import type { FloorSpaceRef } from '../domain/floorSpace.ts';
import { MIN_FLOOR_COUNT, getFloorsLabel } from '../domain/storeys.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';
import {
  MINIMAP_SAMPLE_INTERVAL_MS,
  formatMinimapNumber,
  getFacingSideLabel,
  getMinimapShapes,
  getMinimapViewBox,
  getViewerTransform,
} from './minimapShapes.ts';

/**
 * The floor, drawn once at module load.
 *
 * The plan is frozen data and the shapes are derived from it, so there is one
 * array for the life of the page rather than one per render.
 */
const MINIMAP_SHAPES = getMinimapShapes(FLOOR_PLAN);

/** The plot in SVG user space, one unit per metre (`minimapShapes.ts`). */
const MINIMAP_VIEW_BOX = getMinimapViewBox(PLOT_RECT);

/**
 * Finishes the opening of every announcement, after the storey the drawing is of.
 *
 * The storey comes first — `Floor 3 of 7 minimap.` — because it is the one fact the drawing
 * itself cannot carry: every storey is the same plan, so the picture is identical on all ten
 * and only the words say which one is under the viewer's feet.
 */
const SUMMARY_SUFFIX = 'minimap.';

/**
 * Said in the interior view until the first room resolves, a frame or two after
 * entry: short, and true — the pose has not been reported yet. The storey is
 * still named, because it is known from the pose store before any room resolves.
 */
const UNKNOWN_POSITION_SENTENCE = 'Your position on the floor is not known yet.';

/**
 * The storey chip above the drawing: the visible half of what the accessible
 * name opens with.
 *
 * `aria-hidden` on the chip itself, because the very next element — the drawing —
 * already begins its accessible name with this exact string, and a screen reader
 * would otherwise read the storey twice in a row. Sighted and unsighted users get
 * the same fact once each, from the same `getFloorsLabel`.
 */
const FLOOR_CHIP_CLASS_NAME = 'mb-1 text-center text-xs font-medium text-white';

/** Panel look of the HUD, as `RoomMenu` and `RoomReadout` wear it. */
const PANEL_CLASS_NAME = 'hidden rounded-lg bg-slate-900 p-2 shadow-lg sm:block sm:w-56';

/** The drawing fills the panel; CSS sizes it, the `viewBox` shapes it. */
const SVG_CLASS_NAME = 'block h-auto w-full';

/**
 * A room of the floor: a dark ground with a light outline.
 *
 * The outline rather than the fill carries the contrast against the panel
 * (`slate-300` on `slate-900`), so every room boundary clears the 3:1 of WCAG
 * 1.4.11 whichever room is highlighted.
 */
const ROOM_CLASS_NAME = 'cursor-pointer fill-slate-700 stroke-slate-300 hover:fill-slate-600';

/**
 * The room the explorer is standing in: filled amber, the HUD's accent.
 *
 * A complete class string rather than an extra class on top of
 * {@link ROOM_CLASS_NAME}, because two `fill-*` utilities on one element leave
 * the winner to stylesheet order.
 */
const CURRENT_ROOM_CLASS_NAME = 'cursor-pointer fill-amber-400 stroke-slate-900';

/**
 * The viewer's arrow: dark on the amber it always stands on, haloed in white.
 *
 * **Not amber.** The marker is by definition inside
 * {@link CURRENT_ROOM_CLASS_NAME}'s room — that is the room the pose resolves to —
 * so an amber arrow on an amber fill left the heading readable only by its own
 * hairline outline. `slate-900` on `amber-400` is about 11:1, well past the 3:1
 * of WCAG 1.4.11, and the 2 px white stroke carries the same separation the other
 * way for the frames where the arrow overhangs a neighbouring `slate-700` room or
 * the panel's own ground (about 10:1 and 21:1). Both halves are the HUD's palette
 * already: the panel's `slate-900` and the `text-white` it writes on it.
 */
const VIEWER_CLASS_NAME = 'fill-slate-900 stroke-white stroke-2';

/** Distance from the viewer's position forward to the arrow's tip, in metres. */
const ARROW_TIP_METRES = 0.9;

/** Distance from the viewer's position back to the arrow's base, in metres. */
const ARROW_BASE_METRES = 0.45;

/** Half the width of the arrow's base, in metres. */
const ARROW_HALF_WIDTH_METRES = 0.5;

/**
 * The arrow, pointing toward −y, i.e. up the drawing.
 *
 * Up the drawing is the direction the marker is turned *from*: at yaw 0 the eye
 * looks toward −z, which is −y here, so the unrotated arrow is already correct
 * (see `getViewerTransform`, which derives the rotation as −yaw).
 */
const ARROW_POINTS = [
  `0,${-ARROW_TIP_METRES}`,
  `${ARROW_HALF_WIDTH_METRES},${ARROW_BASE_METRES}`,
  `${-ARROW_HALF_WIDTH_METRES},${ARROW_BASE_METRES}`,
].join(' ');

/** Keeps hairlines one pixel wide instead of multiplying them by the 22.5-unit viewBox. */
const NON_SCALING_STROKE = 'non-scaling-stroke';

/** Attribute carrying the marker's plan x, in metres: for debugging and e2e polling. */
const PLAN_X_ATTRIBUTE = 'data-plan-x';

/** Attribute carrying the marker's plan z, in metres. */
const PLAN_Z_ATTRIBUTE = 'data-plan-z';

/** Attribute carrying the marker's yaw, in radians. */
const YAW_ATTRIBUTE = 'data-yaw';

/** Attribute hiding the marker until a pose is known, so it never sits at the plot corner. */
const VISIBILITY_ATTRIBUTE = 'visibility';

/** Value of {@link VISIBILITY_ATTRIBUTE} once the marker has been placed. */
const VISIBLE = 'visible';

/** Value of {@link VISIBILITY_ATTRIBUTE} before the first pose arrives. */
const HIDDEN = 'hidden';

/**
 * Builds what a screen-reader user is told about the drawing.
 *
 * A dot on a map is worth nothing to somebody who cannot see it, so the summary
 * carries the information the drawing carries: the room and the heading, in
 * words. Both come from the model — `getSpaceLabel` for the room, so no second
 * spelling of a room name exists anywhere in the app, and `getFacingSideLabel`
 * for the heading, in the plan's own side vocabulary.
 *
 * Pure: both facts are handed in, so the string cannot be older than the render
 * that built it.
 *
 * @param space - The room the explorer is in, storey and all, or `undefined`
 *   before the first room resolves.
 * @param facing - The heading as {@link getFacingSideLabel} words it, or
 *   `undefined` before the first pose has been sampled.
 * @param floorsLabel - Which storey of how many the drawing is of, as
 *   `getFloorsLabel` words it.
 * @returns e.g. `Floor 3 of 7 minimap. You are in F3-R11/KIT · Kitchen, facing
 *   toward side D.`, or the storey followed by
 *   {@link UNKNOWN_POSITION_SENTENCE} while the position is unknown. The heading
 *   is left off while no pose has been sampled, rather than guessed at.
 */
function getMinimapSummary(
  space: FloorSpaceRef | undefined,
  facing: string | undefined,
  floorsLabel: string,
): string {
  const prefix = `${floorsLabel} ${SUMMARY_SUFFIX}`;
  if (space === undefined) {
    return `${prefix} ${UNKNOWN_POSITION_SENTENCE}`;
  }
  const label = getSpaceLabel(getSpace(FLOOR_PLAN, space.spaceId), space.floor);
  if (facing === undefined) {
    return `${prefix} You are in ${label}.`;
  }
  return `${prefix} You are in ${label}, facing ${facing}.`;
}

/**
 * HUD minimap: the floor in plan, the room the explorer is in, and which way they face.
 *
 * Interior view only. Outside, the whole floor is already on screen in three
 * dimensions and a second, smaller copy of it would say nothing (owner).
 *
 * **The rooms are pointer targets only, and that is deliberate.** A room is
 * about 15 px across at this size, below the 24 px of WCAG 2.5.8, and twenty-two
 * tab stops through a map nobody can see would be worse than none. The
 * exception the success criterion allows is met instead: the full-size "Go to
 * room" menu (`RoomMenu.tsx`) offers the same function — `startWalkTo`, the same
 * store action — to keyboard and touch users at full size, so the equivalent
 * control exists elsewhere on the same screen. Do not "fix" this by making the
 * rectangles focusable.
 *
 * **Why it barely re-renders.** The pose changes sixty times a second, so the
 * marker is moved by writing attributes on a ref'd `<g>` from one
 * `requestAnimationFrame` loop that samples the non-reactive channel
 * (`getLatestPose`) every {@link MINIMAP_SAMPLE_INTERVAL_MS} and writes only
 * when the transform string actually changed (ADR-004, ADR-007). React renders
 * only when something a *reader* would notice changes: the room, which repaints
 * the highlight, and the heading *bucket*, which rewrites the accessible name.
 *
 * **Why the heading is state and not a memo on the room.** It used to be read
 * once per room change, which froze "facing toward side D" at the moment the room
 * last changed: a viewer who turned 180° on the spot was then told the wrong
 * heading as current fact, which is worse than not being told one. The bucket is
 * therefore sampled in the same frame loop as the marker and kept in state.
 * {@link getFacingSideLabel} quantises a full turn to eight words, and the loop
 * only calls `setState` when the word changes, so the whole cost of being correct
 * is at most eight renders per revolution instead of one per degree — and the
 * announcement still cannot chatter.
 *
 * **One storey's plan, named in words.** The drawing is unchanged by the stack:
 * every storey repeats the typical floor, so ten copies of the same rectangles
 * would carry exactly as much information as one and cost ten times the height.
 * What changes with the stack is which storey the viewer is on, and that is a
 * fact for the chip and the accessible name to carry, not for the geometry.
 *
 * @returns The minimap in the interior view at `sm` and wider, otherwise `null`.
 */
export function Minimap() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const currentSpace = useExplorerPoseStore((state) => state.currentSpace);
  const currentFloor = useExplorerPoseStore((state) => state.currentFloor);
  const floorCount = useFloorCountStore((state) => state.floorCount);
  const startWalkTo = useRoomWalkStore((state) => state.startWalkTo);
  const markerRef = useRef<SVGGElement | null>(null);
  const [facingLabel, setFacingLabel] = useState<string | undefined>(undefined);

  /**
   * The storey the drawing stands for: the one the viewer is on, or the ground
   * floor until the first pose says otherwise. A click walks to a room *here*, so
   * this is also the storey every pick is stamped with.
   */
  const shownFloor = currentFloor ?? MIN_FLOOR_COUNT;
  const floorsLabel = getFloorsLabel(shownFloor, floorCount);
  const summary = getMinimapSummary(currentSpace, facingLabel, floorsLabel);

  /**
   * Which room to paint as the one the viewer is in, on *this* storey — and
   * `undefined` when they are on another one.
   *
   * Both halves of the identity have to match. The plan is one plan, so `kitchen`
   * is a room on every storey: matching the space id alone would light the
   * kitchen of floor 3 while the viewer stood in the kitchen of floor 5. Resolved
   * once here rather than per rectangle, so the sixty-odd shapes below compare
   * one id each and no {@link FloorSpaceRef} is allocated per shape per render.
   */
  const highlightedSpaceId =
    currentSpace !== undefined && currentSpace.floor === shownFloor
      ? currentSpace.spaceId
      : undefined;

  useEffect(() => {
    if (!isInterior) {
      return undefined;
    }
    /** The last string written, so an unchanged frame touches no attribute at all. */
    let lastTransform: string | undefined;
    /** The last heading word announced, so an unchanged bucket asks for no render. */
    let lastFacingLabel: string | undefined;
    /** When the pose was last sampled, to space the samples out. */
    let lastSampleTime: number | undefined;
    let frameHandle = 0;

    const sample = (time: number): void => {
      frameHandle = requestAnimationFrame(sample);
      if (lastSampleTime !== undefined && time - lastSampleTime < MINIMAP_SAMPLE_INTERVAL_MS) {
        return;
      }
      lastSampleTime = time;

      const marker = markerRef.current;
      const pose = useExplorerPoseStore.getState().getLatestPose();
      if (marker === null || pose === undefined) {
        return;
      }
      // The heading first: it is the only thing here a screen reader is told, and it must
      // not be skipped by the transform's own early return.
      const facing = getFacingSideLabel(pose.yaw);
      if (facing !== lastFacingLabel) {
        lastFacingLabel = facing;
        setFacingLabel(facing);
      }

      const transform = getViewerTransform(pose);
      if (transform === lastTransform) {
        return;
      }
      lastTransform = transform;
      marker.setAttribute('transform', transform);
      marker.setAttribute(PLAN_X_ATTRIBUTE, formatMinimapNumber(pose.x));
      marker.setAttribute(PLAN_Z_ATTRIBUTE, formatMinimapNumber(pose.z));
      marker.setAttribute(YAW_ATTRIBUTE, formatMinimapNumber(pose.yaw));
      marker.setAttribute(VISIBILITY_ATTRIBUTE, VISIBLE);
    };

    frameHandle = requestAnimationFrame(sample);
    return () => {
      cancelAnimationFrame(frameHandle);
    };
  }, [isInterior]);

  if (!isInterior) {
    return null;
  }

  /**
   * Asks for a walk to one room and hands focus back to the 3D view.
   *
   * The focus move is `RoomMenu`'s pointer behaviour, for `RoomMenu`'s reason: the keys
   * and the pad have to keep working while the viewer watches the walk. Here it is not
   * merely convenient. These rects are not focusable, so a pointer-down on one *blurs*
   * the view region, and `Escape` — one of the three documented ways to stop a walk —
   * then silently does nothing until the viewer Tabs back. A pick is pointer-only by
   * design (see the note above), so there is no keyboard route to tell apart.
   *
   * @param spaceId - The room whose rectangle was clicked, on the storey drawn.
   * @returns The click handler for that rectangle.
   */
  const handlePick = (spaceId: SpaceId) => () => {
    startWalkTo(makeFloorSpaceRef(shownFloor, spaceId));
    document.getElementById(INTERIOR_REGION_ID)?.focus();
  };

  return (
    <div className={PANEL_CLASS_NAME}>
      <p aria-hidden className={FLOOR_CHIP_CLASS_NAME}>
        {floorsLabel}
      </p>
      <svg
        role="img"
        aria-label={summary}
        viewBox={MINIMAP_VIEW_BOX}
        preserveAspectRatio="xMidYMid meet"
        className={SVG_CLASS_NAME}
      >
        <title>{summary}</title>
        {MINIMAP_SHAPES.map((shape, index) => (
          <rect
            // A space made of several rects contributes several shapes, so the id alone
            // would not be unique; the list is static, so the index is stable.
            key={`${shape.spaceId}-${String(index)}`}
            aria-hidden
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            vectorEffect={NON_SCALING_STROKE}
            className={
              shape.spaceId === highlightedSpaceId ? CURRENT_ROOM_CLASS_NAME : ROOM_CLASS_NAME
            }
            onClick={handlePick(shape.spaceId)}
          />
        ))}
        <g ref={markerRef} aria-hidden visibility={HIDDEN}>
          <polygon
            points={ARROW_POINTS}
            vectorEffect={NON_SCALING_STROKE}
            className={VIEWER_CLASS_NAME}
          />
        </g>
      </svg>
    </div>
  );
}
