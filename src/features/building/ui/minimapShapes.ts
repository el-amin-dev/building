/**
 * Pure presentation rules of the SVG minimap: the rectangles it draws, its
 * `viewBox`, the transform of the viewer marker, and the words for a heading.
 *
 * **The SVG user unit IS the metre, and there is deliberately no scale
 * constant.** The `viewBox` is the plot itself ({@link getMinimapViewBox}) and
 * CSS sizes the element, so the size of the plot lives in the plan and nowhere
 * else. A scale factor here would be a second place to edit the day the plot
 * changes, and the drawing would be wrong in exactly the way nobody checks.
 *
 * Mapping: plan `x` → SVG `x`, plan `z` → SVG `y`. The plan's `z` therefore
 * increases *down* the screen, which is how the drawing already reads (`x` runs
 * A→D, `z` runs C→B; `floorPlan/types.ts`).
 *
 * The shapes come from `getSlabs`, not from `Space.rects`, because the slabs
 * already tile the walkable floor: an L-shaped space falls out as several
 * rectangles, a `'void'` is absent because it has no floor, and the 4.00 × 2.00
 * stair bay contributes only its 1.00 × 2.00 arrival landing instead of a
 * paved-over stairwell. Anything the body cannot stand on is not drawn as floor.
 *
 * No DOM, no React, no three: numbers and strings only.
 */

import type { EyePose } from '../domain/eyeNavigation.ts';
import type { FloorPlan, SpaceId } from '../domain/floorPlan/index.ts';
import { rectDepth, rectWidth } from '../domain/planGeometry.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { getSlabs } from '../domain/slabs.ts';

/** Decimal places every number written into an SVG attribute is rounded to. */
const MINIMAP_PRECISION_DIGITS = 3;

/** Factor implementing {@link MINIMAP_PRECISION_DIGITS} for `Math.round`. */
const MINIMAP_PRECISION_SCALE = 10 ** MINIMAP_PRECISION_DIGITS;

/** Degrees in a half turn: the numerator of the radian-to-degree conversion. */
const DEGREES_PER_HALF_TURN = 180;

/** Degrees in one radian, for the marker's `rotate()`. */
const DEGREES_PER_RADIAN = DEGREES_PER_HALF_TURN / Math.PI;

/** A quarter turn, in radians: the angle to a side that is exactly abeam. */
const QUARTER_TURN = Math.PI / 2;

/**
 * Headings {@link getFacingSideLabel} distinguishes: the four cardinals and the
 * four diagonals of the plan's own side vocabulary.
 */
const HEADING_COUNT = 8;

/** Half the angle one heading covers, in radians: 360° / 8 / 2 = 22.5°. */
const HEADING_HALF_WIDTH = Math.PI / HEADING_COUNT;

/**
 * Smallest dot product between the forward vector and a side's outward normal
 * that still counts as facing that side: `cos(90° − 22.5°) = cos 67.5°`.
 *
 * Derived rather than written down, so the eight headings stay evenly spaced. A
 * cardinal heading clears it for one side only (the other two score ~0), and an
 * exact diagonal clears it for two (each scores ~0.707), which is what makes a
 * diagonal read as two sides.
 */
const FACING_DOT_THRESHOLD = Math.cos(QUARTER_TURN - HEADING_HALF_WIDTH);

/**
 * How often the minimap resamples the viewer's pose, in milliseconds.
 *
 * The pose changes every frame, the marker only has to keep up with the eye.
 * Ten samples a second is smooth to look at and leaves the other fifty frames
 * of a second untouched — the point of reading the pose off a non-reactive
 * channel in the first place (`explorerPoseStore.ts`, ADR-004, ADR-007).
 */
export const MINIMAP_SAMPLE_INTERVAL_MS = 100;

/** One rectangle of walkable floor, in SVG user units, which are metres. */
export interface MinimapShape {
  /** The space this piece of floor belongs to. */
  readonly spaceId: SpaceId;
  /** Left edge, from the plan's `minX`. */
  readonly x: number;
  /** Top edge, from the plan's `minZ`. */
  readonly y: number;
  /** Width along x. */
  readonly width: number;
  /** Height along y, which is the plan's depth along z. */
  readonly height: number;
}

/**
 * The outward normal of one side of the plot, on the plan.
 *
 * The letters are the plan's own (`floorPlan/types.ts`): the origin is the outer
 * corner of sides A and C, `x` runs A→D and `z` runs C→B. So side A faces −x,
 * side D faces +x, side C faces −z and side B faces +z. Naming the vectors and
 * deriving the words from them means the four cardinals and the four diagonals
 * cannot disagree with each other, which eight hard-coded strings against magic
 * angles could.
 */
interface PlanSide {
  /** The letter the plan calls this side by. */
  readonly letter: string;
  /** Component of the outward normal along x. */
  readonly x: number;
  /** Component of the outward normal along z. */
  readonly z: number;
}

/**
 * The four sides of the plot with their outward normals, in letter order.
 *
 * The order is what puts a diagonal's two letters in alphabetical order, so a
 * heading between B and D reads `toward sides B and D`.
 */
const PLAN_SIDES: readonly PlanSide[] = Object.freeze([
  Object.freeze({ letter: 'A', x: -1, z: 0 }),
  Object.freeze({ letter: 'B', x: 0, z: 1 }),
  Object.freeze({ letter: 'C', x: 0, z: -1 }),
  Object.freeze({ letter: 'D', x: 1, z: 0 }),
]);

/** Introduces a heading that names one side. */
const TOWARD_ONE_SIDE = 'toward side';

/** Introduces a heading between two sides. */
const TOWARD_TWO_SIDES = 'toward sides';

/** Joins the two letters of a diagonal heading. */
const SIDE_JOINER = ' and ';

/** Number of letters in a cardinal heading. */
const SINGLE_SIDE_COUNT = 1;

/**
 * Rounds a number for an SVG attribute.
 *
 * The single rounding rule of the minimap, so the marker's `transform` and its
 * `data-*` attributes are written to the same precision: a stable attribute
 * string is what lets the frame loop skip a write that would change nothing,
 * and what lets an end-to-end test poll a value instead of a moving target.
 *
 * @param value - A finite number, in metres or degrees or radians. Callers
 *   validate; this rounds.
 * @returns The value rounded to {@link MINIMAP_PRECISION_DIGITS} decimals, with
 *   no trailing zeros and with `-0` printed as `0`.
 */
export function formatMinimapNumber(value: number): string {
  const rounded = Math.round(value * MINIMAP_PRECISION_SCALE) / MINIMAP_PRECISION_SCALE;
  // `${-0}` is already `'0'`; the addition of zero also normalises `-0` for `String`.
  return String(rounded + 0);
}

/**
 * Derives the rectangles of walkable floor the minimap draws.
 *
 * One shape per floor slab, in slab order, so the shapes tile the walkable floor
 * without overlapping and a space made of several rects contributes several
 * shapes (see the module note on why this reads slabs rather than `Space.rects`).
 *
 * @param plan - The floor plan to draw. Not mutated.
 * @returns A frozen array of frozen shapes, in SVG user units (metres).
 * @throws RangeError when the plan's stair bay cannot hold its stair, which is
 *   `getSlabs`' own error propagated unchanged.
 */
export function getMinimapShapes(plan: FloorPlan): readonly MinimapShape[] {
  return Object.freeze(
    getSlabs(plan).map((slab) =>
      Object.freeze({
        spaceId: slab.spaceId,
        x: slab.rect.minX,
        y: slab.rect.minZ,
        width: rectWidth(slab.rect),
        height: rectDepth(slab.rect),
      }),
    ),
  );
}

/**
 * Builds the `viewBox` that puts the plot in the SVG's user space one-to-one.
 *
 * Every number is read off the rectangle, including the origin, so a plot that
 * does not start at 0 still maps correctly and no size of the floor is written
 * down here.
 *
 * @param plot - The plot rectangle, normally `PLOT_RECT`.
 * @returns `min-x min-y width height`, e.g. `0 0 22.5 10` for the real plot.
 */
export function getMinimapViewBox(plot: PlanRect): string {
  const origin = `${formatMinimapNumber(plot.minX)} ${formatMinimapNumber(plot.minZ)}`;
  const size = `${formatMinimapNumber(rectWidth(plot))} ${formatMinimapNumber(rectDepth(plot))}`;
  return `${origin} ${size}`;
}

/**
 * Places and aims the viewer marker.
 *
 * **Why the rotation is `−yaw`.** On the plan the forward unit vector is
 * `(−sin yaw, −cos yaw)` (`eyeNavigation.ts`). The minimap maps plan `(x, z)` to
 * SVG `(sx, sy)`, so that same forward direction is `(−sin yaw, −cos yaw)` in
 * SVG user space. A marker drawn pointing toward −y and turned by `rotate(θ)`
 * ends up pointing at `(sin θ, −cos θ)`, because SVG's rotation is clockwise on
 * screen in its y-down space. Equating the two:
 *
 *     sin θ = −sin yaw   and   cos θ = cos yaw   ⟹   θ = −yaw
 *
 * so the marker is rotated by minus the yaw, converted to degrees. At yaw 0 the
 * eye looks toward −z and the marker points straight up the drawing, which is
 * the check to make by eye if this is ever doubted.
 *
 * @param pose - Where the eye is and which way it faces. Only `x`, `z` and `yaw`
 *   are read; `pitch` has no meaning on a plan.
 * @returns `translate(x z) rotate(degrees)`, rounded to
 *   {@link MINIMAP_PRECISION_DIGITS} decimals so the string is stable between
 *   frames that did not really move.
 * @throws RangeError naming the offending values when `x`, `z` or `yaw` is not
 *   finite: a non-finite pose is a bug upstream, not a place to draw a marker.
 */
export function getViewerTransform(pose: EyePose): string {
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.z) || !Number.isFinite(pose.yaw)) {
    throw new RangeError(
      `the minimap needs a finite pose, got x = ${String(pose.x)}, z = ${String(pose.z)}, yaw = ${String(pose.yaw)}`,
    );
  }
  const position = `${formatMinimapNumber(pose.x)} ${formatMinimapNumber(pose.z)}`;
  const degrees = formatMinimapNumber(-pose.yaw * DEGREES_PER_RADIAN);
  return `translate(${position}) rotate(${degrees})`;
}

/**
 * Puts a heading into the plan's own side vocabulary.
 *
 * A dot on a map tells a screen-reader user nothing, and neither does an angle
 * in radians. The floor already has four named sides, and the walls, windows and
 * balconies are described by them throughout the plan and the brief, so a
 * heading is best said as the side it points at.
 *
 * The answer is computed from {@link PLAN_SIDES} and the forward vector rather
 * than looked up: a heading names every side whose outward normal is within
 * 67.5° of forward, which is one side for a cardinal heading and two for a
 * diagonal (see {@link FACING_DOT_THRESHOLD}).
 *
 * @param yaw - Rotation about +y, in radians. Any value is accepted, wrapped or
 *   not, since only its sine and cosine are used.
 * @returns e.g. `toward side C` at yaw 0 (forward −z), `toward side A` at
 *   yaw π/2 (forward −x), `toward side D` at yaw −π/2 (forward +x), `toward
 *   side B` at yaw ±π (forward +z), and `toward sides B and D` between the last
 *   two.
 * @throws RangeError naming the value when `yaw` is not finite.
 */
export function getFacingSideLabel(yaw: number): string {
  if (!Number.isFinite(yaw)) {
    throw new RangeError(`the minimap needs a finite yaw, got ${String(yaw)}`);
  }
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const letters = PLAN_SIDES.filter(
    (side) => forwardX * side.x + forwardZ * side.z >= FACING_DOT_THRESHOLD,
  ).map((side) => side.letter);

  if (letters.length === SINGLE_SIDE_COUNT) {
    return `${TOWARD_ONE_SIDE} ${letters[0]}`;
  }
  return `${TOWARD_TWO_SIDES} ${letters.join(SIDE_JOINER)}`;
}
