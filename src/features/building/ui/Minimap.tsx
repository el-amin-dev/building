import { useEffect, useMemo, useRef } from 'react';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import { FLOOR_PLAN, PLOT_RECT, getSpace, getSpaceLabel } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
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

/** Opens every announcement, so the drawing is introduced before it is described. */
const SUMMARY_PREFIX = 'Floor minimap.';

/**
 * Said in the interior view until the first room resolves, a frame or two after
 * entry: short, and true — the pose has not been reported yet.
 */
const UNKNOWN_POSITION_SUMMARY = `${SUMMARY_PREFIX} Your position on the floor is not known yet.`;

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

/** The viewer's arrow: amber like the current room, outlined against it. */
const VIEWER_CLASS_NAME = 'fill-amber-400 stroke-slate-900';

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
 * @param spaceId - The room the explorer is in, or `undefined` before the first
 *   room resolves.
 * @returns e.g. `Floor minimap. You are in R11/KIT · Kitchen, facing toward side
 *   D.`, or {@link UNKNOWN_POSITION_SUMMARY} while the position is unknown. The
 *   heading is left off in the impossible case of a known room with no pose,
 *   rather than guessed at.
 */
function getMinimapSummary(spaceId: SpaceId | undefined): string {
  if (spaceId === undefined) {
    return UNKNOWN_POSITION_SUMMARY;
  }
  const label = getSpaceLabel(getSpace(FLOOR_PLAN, spaceId));
  const pose = useExplorerPoseStore.getState().getLatestPose();
  if (pose === undefined) {
    return `${SUMMARY_PREFIX} You are in ${label}.`;
  }
  return `${SUMMARY_PREFIX} You are in ${label}, facing ${getFacingSideLabel(pose.yaw)}.`;
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
 * **Why it does not re-render.** The pose changes sixty times a second, so the
 * marker is moved by writing attributes on a ref'd `<g>` from one
 * `requestAnimationFrame` loop that samples the non-reactive channel
 * (`getLatestPose`) every {@link MINIMAP_SAMPLE_INTERVAL_MS} and writes only
 * when the transform string actually changed (ADR-004, ADR-007). React renders
 * only when the *room* changes: that is what repaints the highlight and rewrites
 * the summary, a handful of times per walk instead of per degree of yaw — which
 * also keeps the announcement from chattering.
 *
 * @returns The minimap in the interior view at `sm` and wider, otherwise `null`.
 */
export function Minimap() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');
  const currentSpaceId = useExplorerPoseStore((state) => state.currentSpaceId);
  const startWalkTo = useRoomWalkStore((state) => state.startWalkTo);
  const markerRef = useRef<SVGGElement | null>(null);

  // Keyed on the room alone: the heading is read once, when the room changes, so
  // turning in place never rewrites the announcement. Memoised rather than held as
  // state written from an effect, which would add a cascading render to every room
  // change (`react-hooks/set-state-in-effect`) for a value that is purely derived.
  const summary = useMemo(() => getMinimapSummary(currentSpaceId), [currentSpaceId]);

  useEffect(() => {
    if (!isInterior) {
      return undefined;
    }
    /** The last string written, so an unchanged frame touches no attribute at all. */
    let lastTransform: string | undefined;
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

  return (
    <div className={PANEL_CLASS_NAME}>
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
            className={shape.spaceId === currentSpaceId ? CURRENT_ROOM_CLASS_NAME : ROOM_CLASS_NAME}
            onClick={() => {
              startWalkTo(shape.spaceId);
            }}
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
