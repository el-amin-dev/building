/**
 * The finished-floor levels of every storey count the stepper can ask for, derived once and
 * shared by identity.
 *
 * `domain/storeys.ts` already answers "where does storey *n* sit?", and `getStoreyLevels`
 * would answer the whole question on its own — except that it builds a *new* array each
 * time it is called. That is fatal here, and for exactly the reason `floorInstance.ts`
 * spells out: the scene bakes its solids into one merged geometry per material and rebuilds
 * it whenever the array it is handed changes identity (ADR-008). A level array rebuilt per
 * render would be handed to `MergedBoxesMesh` as a fresh object every frame, and any memo
 * that watched it would re-merge every wall, slab and step of the building.
 *
 * So the table below is built once, at module load: one frozen array per legal
 * count, indexed by `count − MIN_FLOOR_COUNT`. Ten arrays, 55 numbers between them. A press
 * of the stepper then changes only *which* of these ten arrays is handed to a mesh — never
 * what is in one — so the geometry memo, keyed on the boxes alone, is never invalidated.
 *
 * This is the same house rule `floorInstance.ts` states: **derived once, shared by
 * identity**. Nothing may re-derive these for the live building; consume the constants, or
 * the two accessors that index them.
 *
 * Pure arithmetic: no React, no three, nothing mutated.
 */

import {
  clampFloorCount,
  getStoreyLevels,
  MAX_FLOOR_COUNT,
  MIN_FLOOR_COUNT,
} from '../domain/storeys.ts';

/** How many legal storey counts there are: `MIN_FLOOR_COUNT`…`MAX_FLOOR_COUNT` inclusive. */
const FLOOR_COUNT_RANGE = MAX_FLOOR_COUNT - MIN_FLOOR_COUNT + 1;

/** How many levels back from the end of a stack its top storey sits. */
const LAST_INDEX_OFFSET = 1;

/**
 * The finished-floor levels of every storey count, indexed by `count − MIN_FLOOR_COUNT`.
 *
 * Entry 0 is a one-storey building, `[0]`; the last entry is a ten-storey one,
 * `[0, 3, 6, … 27]` at the typical floor's 3.00 m pitch. Every array is frozen, and every
 * array keeps its identity for the whole life of the page.
 */
export const STOREY_LEVELS_BY_COUNT: readonly (readonly number[])[] = Object.freeze(
  Array.from({ length: FLOOR_COUNT_RANGE }, (_unused, index) =>
    getStoreyLevels(index + MIN_FLOOR_COUNT),
  ),
);

/**
 * Just the top storey's level of every count, each as a one-element array.
 *
 * A one-element array rather than a number, so that it is the same shape as
 * {@link STOREY_LEVELS_BY_COUNT}: what is drawn only under the roof — the ceilings — is
 * then a level *list* like everything else, and the mesh that draws it needs no second
 * code path. Built here, with the same identity guarantee, for the same reason.
 */
export const TOP_STOREY_LEVELS_BY_COUNT: readonly (readonly number[])[] = Object.freeze(
  STOREY_LEVELS_BY_COUNT.map((levels) =>
    Object.freeze([levels[levels.length - LAST_INDEX_OFFSET]]),
  ),
);

/**
 * Reads one entry of a level table, by storey count.
 *
 * @param table - The table to read: one entry per legal count, lowest first.
 * @param count - The storey count wanted; clamped as `clampFloorCount` does, so a count
 *   outside the shown range reads the nearest legal one rather than falling off the table.
 * @returns The table's entry for that count.
 * @throws RangeError when the table is shorter than the legal range, which would mean it
 *   was not built from {@link FLOOR_COUNT_RANGE}.
 */
function levelsAt(table: readonly (readonly number[])[], count: number): readonly number[] {
  const index = clampFloorCount(count) - MIN_FLOOR_COUNT;
  const levels: readonly number[] | undefined = table[index];
  if (levels === undefined) {
    throw new RangeError(`no levels are tabulated for a building of ${String(count)} storeys`);
  }
  return levels;
}

/**
 * Returns the finished-floor levels of a stack, lowest first.
 *
 * The array is the shared one out of {@link STOREY_LEVELS_BY_COUNT}: two calls with the
 * same count return the *same object*, which is what lets the scene hand it to a mesh
 * without rebuilding any geometry.
 *
 * @param count - How many storeys are stacked; clamped as `clampFloorCount` does.
 * @returns The frozen, shared array of `count` levels, `[0, 3, 6, …]`.
 * @throws RangeError when `count` is not finite (see `clampFloorCount`).
 */
export function getStoreyLevelsFor(count: number): readonly number[] {
  return levelsAt(STOREY_LEVELS_BY_COUNT, count);
}

/**
 * Returns the top storey's finished-floor level of a stack, as a one-element level list.
 *
 * What the ceilings are drawn at: below the top storey the overhead surface is the slab of
 * the storey above, so only the topmost storey is given a ceiling of its own
 * (`FloorModel.tsx`).
 *
 * @param count - How many storeys are stacked; clamped as `clampFloorCount` does.
 * @returns The frozen, shared one-element array holding the top storey's level.
 * @throws RangeError when `count` is not finite (see `clampFloorCount`).
 */
export function getTopStoreyLevelFor(count: number): readonly number[] {
  return levelsAt(TOP_STOREY_LEVELS_BY_COUNT, count);
}
