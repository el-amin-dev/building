/**
 * Vertical extrusion of a plan rectangle: the shared 3D primitive.
 *
 * A {@link PlanBox} pairs a `PlanRect` from `planGeometry.ts` with a bottom and
 * a top level `y`, in metres above the finished floor of the storey. Walls,
 * slabs, ports, windows and the stairs are all described this way, so that
 * geometry, volume checks and tests share one primitive instead of each module
 * carrying its own triplet of coordinates. Vertical levels come from
 * `FLOOR_HEIGHTS` (`heights.ts`, ADR-006).
 *
 * Plan coordinates stay on the centimetre grid, but vertical levels are **not**
 * snapped to it: a straight flight rising the 3.00 m floor-to-floor height in 17
 * steps has a 0.17647… m riser, which is not a whole number of centimetres.
 * Rounding such a level would either lose the last step or overshoot the slab.
 */
import { LENGTH_TOLERANCE, rectArea } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';

/** An axis-aligned box: a plan rectangle between two vertical levels, in metres. */
export interface PlanBox {
  /** Footprint of the box on the floor plan. */
  readonly rect: PlanRect;
  /** Level of the underside of the box, in metres; may be negative (a slab below the floor). */
  readonly bottom: number;
  /** Level of the top of the box, in metres; always above {@link PlanBox.bottom}. */
  readonly top: number;
}

/**
 * Builds a frozen box from a footprint and two vertical levels.
 *
 * The rectangle is stored as given: it arrives frozen from `makeRect`. The
 * levels are stored unrounded, because vertical sizes such as a stair riser do
 * not lie on the centimetre plan grid.
 *
 * @param rect - Footprint of the box, in plan coordinates.
 * @param bottom - Level of the underside, in metres; negative is allowed.
 * @param top - Level of the top, in metres.
 * @returns A frozen {@link PlanBox}.
 * @throws RangeError when `bottom` or `top` is not finite, or when the height
 *   `top - bottom` does not exceed {@link LENGTH_TOLERANCE}; the message names
 *   the offending value.
 */
export function makeBox(rect: PlanRect, bottom: number, top: number): PlanBox {
  if (!Number.isFinite(bottom)) {
    throw new RangeError(`bottom must be a finite number, got ${String(bottom)}`);
  }
  if (!Number.isFinite(top)) {
    throw new RangeError(`top must be a finite number, got ${String(top)}`);
  }
  if (top - bottom <= LENGTH_TOLERANCE) {
    throw new RangeError(
      `top ${String(top)} must lie above bottom ${String(bottom)} by more than the length tolerance`,
    );
  }
  return Object.freeze({ rect, bottom, top });
}

/**
 * Returns the volume of a box.
 *
 * @param box - The box to measure.
 * @returns The footprint area times the height, in cubic metres, not rounded.
 */
export function boxVolume(box: PlanBox): number {
  return rectArea(box.rect) * (box.top - box.bottom);
}
