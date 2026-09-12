/**
 * Vertical sizes of a floor.
 *
 * This module is the single source of truth for every vertical building
 * dimension: floor-to-floor height, wall height, door height, railing height
 * and the window sill and head. Every such dimension must be read from
 * {@link FLOOR_HEIGHTS} rather
 * than redeclared, so that geometry, navigation and camera placement always
 * agree. Presentation offsets, such as anti-z-fighting lifts, light placement
 * or camera framing, are not building dimensions and are not covered by this
 * rule.
 *
 * Body sizes of the explorer, including the eye height the cameras use, are
 * not building dimensions: they live in `PERSON_SPEC` (`person.ts`).
 *
 * The values are confirmed by the owner. All values are expressed in metres.
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
  /**
   * Height of a window sill above the finished floor: the bottom of the glazed
   * opening. Windows are 1.20 × 1.20 m everywhere (owner answer, ADR-006).
   */
  readonly windowSill: number;
  /**
   * Height of the top of a window opening above the finished floor, i.e. the
   * sill plus the 1.20 m window height (owner answer, ADR-006). It happens to
   * equal {@link FloorHeights.door}, but it means the head of a window, not of
   * a door: both are kept as separate fields so that changing one window
   * dimension never moves a door.
   */
  readonly windowHead: number;
}

/** The vertical sizes shared by the whole floor, confirmed by the owner, in metres. Frozen. */
export const FLOOR_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 3.0,
  wall: 2.7,
  door: 2.1,
  railing: 1.1,
  windowSill: 0.9,
  windowHead: 2.1,
});
