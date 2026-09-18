/**
 * The stack of storeys: how many there are, and at what level each one sits.
 *
 * One typical floor is designed (`sourceOfTruth/plan.ts`), and a building is
 * that floor repeated upwards: storey 2 is storey 1 lifted by one
 * floor-to-floor height, storey 3 by two, and so on. This module owns the
 * arithmetic of that repetition — the bounds of the count, the level of each
 * storey, the inverse question "which storey is this level on?", and the top of
 * the built fabric — so that the stepper the owner reads, the levels the scene
 * stacks at and the labels the HUD prints can never disagree.
 *
 * Floors are numbered 1…N: floor 0 is not designed (ADR-006) and `FLOOR_NUMBER`
 * already stamps `F1-…` into every wall matricule, so the lowest storey is
 * floor 1 and its finished floor is the level everything else is measured from.
 *
 * Every vertical size is injected as {@link FloorHeights}, defaulting to
 * {@link FLOOR_HEIGHTS}, exactly as `getSlabThickness` and `getStairsLayout`
 * take theirs: the pitch of the stack is the floor-to-floor height of the floor
 * being stacked, derived from it rather than transcribed, so a change to the
 * section moves the whole building.
 *
 * Levels are metres above the finished floor of storey 1, snapped onto the
 * centimetre plan grid by {@link toPlanLength} so that sums over ten storeys
 * still compare exactly (`planGeometry.ts`).
 *
 * Pure arithmetic and labels: no React, no three, nothing mutated.
 */

import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { toPlanLength } from './planGeometry.ts';

/** Fewest storeys the building can show: the typical floor on its own. */
export const MIN_FLOOR_COUNT = 1;

/** Most storeys the building can show, capped by the owner at ten. */
export const MAX_FLOOR_COUNT = 10;

/** Storeys shown before the owner steps the count: the single designed floor. */
export const INITIAL_FLOOR_COUNT = 1;

/** Storeys one press of the stepper adds or removes. */
export const FLOOR_COUNT_STEP = 1;

/** Digits the stepper shows, so the reading is `01` rather than `1`. */
export const FLOOR_COUNT_DIGITS = 2;

/** Level of the finished floor of storey {@link MIN_FLOOR_COUNT}: the datum of the stack. */
const GROUND_STOREY_LEVEL = 0;

/** Character the stepper reading is padded with to reach {@link FLOOR_COUNT_DIGITS}. */
const FLOOR_COUNT_PAD = '0';

/** Word every floor label starts with. */
const FLOOR_LABEL_PREFIX = 'Floor';

/**
 * How far, in storeys, a level may sit from an exact storey boundary and still
 * count as being on it. A level is a sum of floating-point pitches, so the top
 * of storey 4 can divide out as `2.9999999999999996` storeys; without this the
 * floor of that ratio would answer with the storey below.
 */
const STOREY_INDEX_TOLERANCE = 1e-6;

/**
 * Rejects a floor-to-floor height that cannot space a stack.
 *
 * @param heights - The vertical sizes the stack is derived from.
 * @throws RangeError naming the value when `heights.floorToFloor` is not a
 *   finite positive number.
 */
function assertPitch(heights: FloorHeights): void {
  if (!Number.isFinite(heights.floorToFloor) || heights.floorToFloor <= 0) {
    throw new RangeError(
      `heights.floorToFloor must be a finite positive number, got ${String(heights.floorToFloor)}`,
    );
  }
}

/**
 * Rejects anything that is not a floor number of the 1…N numbering.
 *
 * There is deliberately no upper bound: a floor's level is well defined however
 * high it is, and how many floors are *shown* is the business of
 * {@link clampFloorCount} alone.
 *
 * @param floor - The floor number to check.
 * @throws RangeError naming the value when it is not an integer, or is below
 *   {@link MIN_FLOOR_COUNT}.
 */
function assertFloor(floor: number): void {
  if (!Number.isInteger(floor) || floor < MIN_FLOOR_COUNT) {
    throw new RangeError(
      `floor must be an integer of at least ${String(MIN_FLOOR_COUNT)}, got ${String(floor)}`,
    );
  }
}

/**
 * Rounds a requested storey count and clamps it into the shown range.
 *
 * The one place the bounds are applied: the stepper, the store and the level
 * table all come through here, so none of them can hold a count the others
 * would refuse.
 *
 * @param count - A requested number of storeys, whole or not.
 * @returns The count rounded to the nearest whole storey (halves up) and
 *   clamped into `[MIN_FLOOR_COUNT, MAX_FLOOR_COUNT]`.
 * @throws RangeError naming the value when it is not finite.
 */
export function clampFloorCount(count: number): number {
  if (!Number.isFinite(count)) {
    throw new RangeError(`floor count must be a finite number, got ${String(count)}`);
  }
  const whole = Math.round(count);
  return Math.min(MAX_FLOOR_COUNT, Math.max(MIN_FLOOR_COUNT, whole));
}

/**
 * Formats a storey count the way the stepper reads it.
 *
 * @param count - A number of storeys; clamped as {@link clampFloorCount} does.
 * @returns The count padded to {@link FLOOR_COUNT_DIGITS} digits, `'01'`…`'10'`.
 * @throws RangeError when `count` is not finite.
 */
export function formatFloorCount(count: number): string {
  return String(clampFloorCount(count)).padStart(FLOOR_COUNT_DIGITS, FLOOR_COUNT_PAD);
}

/**
 * Returns the level of a storey's finished floor.
 *
 * @param floor - Floor number, 1…N.
 * @param heights - Vertical sizes the pitch is read from; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns `(floor − 1) × heights.floorToFloor`, in metres above storey 1's
 *   finished floor, on the centimetre grid.
 * @throws RangeError when `floor` is not an integer of at least
 *   {@link MIN_FLOOR_COUNT}, or when the pitch is not finite and positive.
 */
export function getStoreyLevel(floor: number, heights: FloorHeights = FLOOR_HEIGHTS): number {
  assertFloor(floor);
  assertPitch(heights);
  return toPlanLength(GROUND_STOREY_LEVEL + (floor - MIN_FLOOR_COUNT) * heights.floorToFloor);
}

/**
 * Returns the finished-floor levels of a whole stack, lowest first.
 *
 * @param count - How many storeys the stack has; clamped as
 *   {@link clampFloorCount} does.
 * @param heights - Vertical sizes the pitch is read from; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns A frozen array of `count` levels, `[0, 3, 6, …]` at the typical
 *   floor's 3.00 m pitch.
 * @throws RangeError when `count` is not finite, or when the pitch is not
 *   finite and positive.
 */
export function getStoreyLevels(
  count: number,
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly number[] {
  const storeys = clampFloorCount(count);
  return Object.freeze(
    Array.from({ length: storeys }, (_unused, index) =>
      getStoreyLevel(index + MIN_FLOOR_COUNT, heights),
    ),
  );
}

/**
 * Returns the storey a level belongs to: the inverse of {@link getStoreyLevel}.
 *
 * A level between two finished floors belongs to the storey below it — you
 * stand on the floor you walked in on. Below storey 1's finished floor there is
 * no designed storey, so the answer clamps to floor 1 rather than going to
 * floor 0 (ADR-006). There is no upper clamp: how far the stack actually
 * reaches is a question about the count, not about a level.
 *
 * @param level - Metres above storey 1's finished floor.
 * @param heights - Vertical sizes the pitch is read from; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns The floor number the level lies on, at least {@link MIN_FLOOR_COUNT}.
 * @throws RangeError when `level` is not finite, or when the pitch is not
 *   finite and positive.
 */
export function getStoreyAt(level: number, heights: FloorHeights = FLOOR_HEIGHTS): number {
  if (!Number.isFinite(level)) {
    throw new RangeError(`level must be a finite number, got ${String(level)}`);
  }
  assertPitch(heights);
  const storeysUp = (level - GROUND_STOREY_LEVEL) / heights.floorToFloor;
  const nearest = Math.round(storeysUp);
  const index =
    Math.abs(storeysUp - nearest) <= STOREY_INDEX_TOLERANCE ? nearest : Math.floor(storeysUp);
  return Math.max(MIN_FLOOR_COUNT, index + MIN_FLOOR_COUNT);
}

/**
 * Returns the top of the built fabric of a stack.
 *
 * The walls of the topmost storey stop a wall height above their own finished
 * floor, so the stack is as tall as the pitch repeated under the last storey
 * plus that storey's walls — never `count × floorToFloor`, which would be the
 * top of a slab that is not poured.
 *
 * Takes its heights first and required, as `getExteriorFraming` does, because
 * the exterior framing is its first caller.
 *
 * @param heights - Vertical sizes the stack is derived from.
 * @param count - How many storeys the stack has; clamped as
 *   {@link clampFloorCount} does.
 * @returns `(count − 1) × heights.floorToFloor + heights.wall`, in metres above
 *   storey 1's finished floor, on the centimetre grid.
 * @throws RangeError when `count` is not finite, when the pitch is not finite
 *   and positive, or when `heights.wall` is not finite and positive.
 */
export function getBuildingTop(heights: FloorHeights, count: number): number {
  const storeys = clampFloorCount(count);
  assertPitch(heights);
  if (!Number.isFinite(heights.wall) || heights.wall <= 0) {
    throw new RangeError(
      `heights.wall must be a finite positive number, got ${String(heights.wall)}`,
    );
  }
  return toPlanLength(getStoreyLevel(storeys, heights) + heights.wall);
}

/**
 * Returns the label of one floor.
 *
 * @param floor - Floor number, 1…N.
 * @returns e.g. `'Floor 3'`.
 * @throws RangeError when `floor` is not an integer of at least
 *   {@link MIN_FLOOR_COUNT}.
 */
export function getFloorLabel(floor: number): string {
  assertFloor(floor);
  return `${FLOOR_LABEL_PREFIX} ${String(floor)}`;
}

/**
 * Returns the label placing one floor within the stack.
 *
 * One wording, written once: the stepper and the minimap both say it, so they
 * cannot drift into two ways of reading the same fact.
 *
 * @param floor - Floor number, 1…N.
 * @param count - How many storeys the stack has; clamped as
 *   {@link clampFloorCount} does.
 * @returns e.g. `'Floor 3 of 7'`.
 * @throws RangeError when `floor` is not an integer of at least
 *   {@link MIN_FLOOR_COUNT}, or when `count` is not finite.
 */
export function getFloorsLabel(floor: number, count: number): string {
  return `${getFloorLabel(floor)} of ${String(clampFloorCount(count))}`;
}
