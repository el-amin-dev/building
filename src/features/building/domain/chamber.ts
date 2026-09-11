/**
 * Plan geometry of a single rectangular chamber.
 *
 * The chamber is centred at the plan origin: `x` runs along its width and `z`
 * along its depth, all values in metres. Vertical sizes are not handled here;
 * they live in the `FLOOR_HEIGHTS` module.
 */
import { makeRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';

/** Horizontal dimensions of a rectangular chamber, in metres. */
export interface ChamberSpec {
  /** Width along x, measured between the inside faces of the walls. */
  readonly clearWidth: number;
  /** Depth along z, measured between the inside faces of the walls. */
  readonly clearDepth: number;
  /** Thickness of every wall surrounding the chamber. */
  readonly wallThickness: number;
}

/**
 * The shared base of the master and kids bedrooms: 5.00 × 3.40 m clear.
 *
 * The uniform 0.20 m walls are a demo simplification: the drawing uses 0.30 m
 * exterior walls, and the full floor model replaces this spec later. Frozen.
 */
export const BASE_CHAMBER_SPEC: ChamberSpec = Object.freeze({
  clearWidth: 5.0,
  clearDepth: 3.4,
  wallThickness: 0.2,
});

const HALF = 0.5;

const SPEC_FIELDS: readonly (keyof ChamberSpec)[] = Object.freeze([
  'clearWidth',
  'clearDepth',
  'wallThickness',
]);

/**
 * Checks that a number is finite and strictly positive.
 *
 * @param value - The number to check.
 * @returns `true` when the value is finite and greater than zero.
 */
function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Validates a chamber spec.
 *
 * @param spec - The chamber dimensions to validate.
 * @returns The same spec, unchanged, when every field is valid.
 * @throws RangeError naming the offending field when a value is not finite or
 *   is less than or equal to zero.
 */
export function validateChamberSpec(spec: ChamberSpec): ChamberSpec {
  for (const field of SPEC_FIELDS) {
    if (!isPositiveFinite(spec[field])) {
      throw new RangeError(
        `ChamberSpec.${field} must be a finite number greater than 0, got ${String(spec[field])}`,
      );
    }
  }
  return spec;
}

/**
 * Returns the clear (inside) rectangle of a chamber, centred at the origin.
 *
 * @param spec - The chamber dimensions.
 * @returns A frozen rectangle spanning ±clearWidth/2 on x and ±clearDepth/2 on z.
 * @throws RangeError when the spec is invalid (see {@link validateChamberSpec}).
 */
export function getClearRect(spec: ChamberSpec): PlanRect {
  const { clearWidth, clearDepth } = validateChamberSpec(spec);
  const halfWidth = clearWidth * HALF;
  const halfDepth = clearDepth * HALF;
  return makeRect(-halfWidth, halfWidth, -halfDepth, halfDepth);
}

/**
 * Returns the outer envelope of a chamber, centred at the origin.
 *
 * The envelope is the clear rectangle grown by `wallThickness` on every side,
 * i.e. the outside faces of the walls: 5.40 × 3.80 m for
 * {@link BASE_CHAMBER_SPEC}. It equals the bounding box of
 * {@link getChamberWalls}.
 *
 * @param spec - The chamber dimensions.
 * @returns A frozen rectangle spanning ±(clearWidth/2 + wallThickness) on x
 *   and ±(clearDepth/2 + wallThickness) on z.
 * @throws RangeError when the spec is invalid (see {@link validateChamberSpec}).
 */
export function getOuterRect(spec: ChamberSpec): PlanRect {
  const clear = getClearRect(spec);
  const thickness = spec.wallThickness;
  return makeRect(
    clear.minX - thickness,
    clear.maxX + thickness,
    clear.minZ - thickness,
    clear.maxZ + thickness,
  );
}

/**
 * Returns the footprints of the four walls surrounding a chamber.
 *
 * Every wall lies outside the clear rectangle and is `wallThickness` thick.
 * The two walls running along x (at −z and +z) span the full outer width
 * `clearWidth + 2 · wallThickness`, closing the corners; the two walls running
 * along z (at −x and +x) span only `clearDepth`, so no two walls overlap.
 *
 * @param spec - The chamber dimensions.
 * @returns A frozen array of four frozen rectangles, in the order −z, +z, −x, +x.
 * @throws RangeError when the spec is invalid (see {@link validateChamberSpec}).
 */
export function getChamberWalls(spec: ChamberSpec): readonly PlanRect[] {
  const clear = getClearRect(spec);
  const outer = getOuterRect(spec);
  const walls: readonly PlanRect[] = [
    makeRect(outer.minX, outer.maxX, outer.minZ, clear.minZ),
    makeRect(outer.minX, outer.maxX, clear.maxZ, outer.maxZ),
    makeRect(outer.minX, clear.minX, clear.minZ, clear.maxZ),
    makeRect(clear.maxX, outer.maxX, clear.minZ, clear.maxZ),
  ];
  return Object.freeze(walls);
}

/**
 * Returns the area a body of the given radius can occupy inside a chamber.
 *
 * @param spec - The chamber dimensions.
 * @param bodyRadius - Radius of the walking body, in metres.
 * @returns A frozen rectangle equal to the clear rectangle shrunk by
 *   `bodyRadius` on every side.
 * @throws RangeError when the spec is invalid, or when `bodyRadius` is not
 *   finite, is negative, or is at least half the smaller clear dimension
 *   (leaving no walkable area).
 */
export function getWalkableBounds(spec: ChamberSpec, bodyRadius: number): PlanRect {
  const clear = getClearRect(spec);
  const maxRadius = Math.min(spec.clearWidth, spec.clearDepth) * HALF;
  if (!Number.isFinite(bodyRadius) || bodyRadius < 0 || bodyRadius >= maxRadius) {
    throw new RangeError(
      `bodyRadius must be a finite number in [0, ${String(maxRadius)}), got ${String(bodyRadius)}`,
    );
  }
  return makeRect(
    clear.minX + bodyRadius,
    clear.maxX - bodyRadius,
    clear.minZ + bodyRadius,
    clear.maxZ - bodyRadius,
  );
}
