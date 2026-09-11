/**
 * Vertical sizes of a floor.
 *
 * This module is the single source of truth for every vertical building
 * dimension: floor-to-floor height, wall height, door height, railing height
 * and the eye height of the interior viewer. Every such dimension must be read
 * from {@link FLOOR_HEIGHTS} rather than redeclared, so that geometry,
 * navigation and camera placement always agree. Presentation offsets, such as
 * anti-z-fighting lifts, light placement or camera framing, are not building
 * dimensions and are not covered by this rule.
 *
 * The values are provisional: the owner brief gives no vertical sizes, so they
 * are taken from the project roadmap until the owner confirms them (Part 1 of
 * `TASKS.md`).
 *
 * All values are expressed in metres.
 */

/** The unified set of vertical sizes of a floor, in metres. */
export interface FloorHeights {
  /** Distance from one finished floor level to the next, slab included. */
  readonly floorToFloor: number;
  /** Height of an interior wall, from the finished floor to its top. */
  readonly wall: number;
  /** Height of a door opening, from the finished floor to the lintel. */
  readonly door: number;
  /** Height of a guard railing, from the finished floor to the handrail. */
  readonly railing: number;
  /** Height of the viewer's eyes above the finished floor. */
  readonly eye: number;
}

/**
 * The vertical sizes shared by the whole floor, in metres. Frozen.
 *
 * Provisional: taken from the project roadmap because the owner brief gives no
 * vertical sizes, until the owner confirms them (Part 1 of `TASKS.md`).
 */
export const FLOOR_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 3.0,
  wall: 2.7,
  door: 2.1,
  railing: 1.1,
  eye: 1.6,
});
