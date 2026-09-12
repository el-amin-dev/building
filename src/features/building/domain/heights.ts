/**
 * Vertical sizes of a floor.
 *
 * This module is the single source of truth for every vertical building
 * dimension shared by the whole floor: floor-to-floor height, wall height, door
 * height and railing height. Every such dimension must be read from
 * {@link FLOOR_HEIGHTS} rather
 * than redeclared, so that geometry, navigation and camera placement always
 * agree. Presentation offsets, such as anti-z-fighting lifts, light placement
 * or camera framing, are not building dimensions and are not covered by this
 * rule.
 *
 * Window sills and heads are NOT here. They were, while every window was the
 * same 1.20 × 1.20 m hole derived one per room per glazeable face. Windows are
 * now chosen per purpose and declared as data in `sourceOfTruth/plan.ts` — an
 * air vent high in a bathroom, a food pass at counter height, a hand-level
 * kitchen window, two big laundry windows — so each one carries its own sill
 * and head and no single pair of constants could describe them. See
 * `windows.ts`.
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
}

/** The vertical sizes shared by the whole floor, confirmed by the owner, in metres. Frozen. */
export const FLOOR_HEIGHTS: FloorHeights = Object.freeze({
  floorToFloor: 3.0,
  wall: 2.7,
  door: 2.1,
  railing: 1.1,
});
