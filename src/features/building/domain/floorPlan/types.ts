/**
 * Types of the floor-plan model: spaces, their kinds, and the plan itself.
 *
 * This module holds types and id lists only; the plan data lives elsewhere.
 *
 * Plan coordinates: the origin is the outer corner of sides A and C; `x` runs
 * along A→D (0–22.50) and `z` along C→B (0–10.00), in metres. Every space is
 * described by clear (inner) rectangles, measured between the inside faces of
 * its walls.
 *
 * Space kinds:
 * - `room`: habitable, service and technical rooms;
 * - `circulation`: stairs, corridors;
 * - `openAir`: walkable balconies;
 * - `void`: no floor, open to the sky.
 */
import type { PlanRect, RectSide } from '../planGeometry.ts';

/**
 * Identifiers of every space on the floor, in a stable order. Frozen.
 *
 * The order and the membership are the source of truth's: this is
 * `ROOMS` of `../sourceOfTruth/plan.ts` in matricule order R01…R22. It is
 * written out rather than derived so the ids stay literal types; the derivation
 * in `floorPlanData.ts` fails to typecheck if the two ever disagree.
 *
 * Changed with the new plan: `linkCorridor` is gone, absorbed into the guest
 * room's north strip; `ccBalcony` is new; and the baths and showers are rooms
 * in their own right rather than fittings, which is what gives them walls and
 * doors like everything else on the floor.
 */
export const SPACE_IDS = Object.freeze([
  'balconyA',
  'masterBedroom',
  'livingRoom',
  'bedroomMaleKids',
  'bedroomFemaleKids',
  'stairs',
  'corridor',
  'controlCenter',
  'guestRoom',
  'guestSanitair',
  'kitchen',
  'laundry',
  'mainSanitair',
  'utilityRoom',
  'ccBalcony',
  'balconySlabB',
  'voidWest',
  'voidEast',
  'guestBathCubicle',
  'guestShowerCubicle',
  'mainBathCubicle',
  'mainShowerCubicle',
] as const);

/** Identifier of a space on the floor; one of {@link SPACE_IDS}. */
export type SpaceId = (typeof SPACE_IDS)[number];

/**
 * Every kind of space, in a stable order. Frozen.
 *
 * - `room`: habitable, service and technical rooms;
 * - `circulation`: stairs, corridors;
 * - `openAir`: walkable balconies;
 * - `void`: no floor, open to the sky.
 */
export const SPACE_KINDS = Object.freeze(['room', 'circulation', 'openAir', 'void'] as const);

/** Kind of a space; one of {@link SPACE_KINDS}. */
export type SpaceKind = (typeof SPACE_KINDS)[number];

/** A named area of the floor, made of one or more clear rectangles. */
export interface Space {
  /** Unique identifier of the space. */
  readonly id: SpaceId;
  /** Human-readable name of the space. */
  readonly name: string;
  /** What the space is used for, which drives its walls and floor. */
  readonly kind: SpaceKind;
  /**
   * Clear (inner) rectangles covering the space, in plan coordinates. A
   * non-rectangular space (for example an L shape) uses several rectangles.
   */
  readonly rects: readonly PlanRect[];
}

/**
 * An explicit wall thickness for the join between two spaces, replacing the
 * default thickness that would otherwise follow from their kinds and the
 * `WALL_SPEC` wall thicknesses.
 */
export interface JoinOverride {
  /** The two spaces whose shared wall is overridden. */
  readonly spaces: readonly [SpaceId, SpaceId];
  /** Thickness of the wall between the two spaces, in metres. */
  readonly thickness: number;
  /** Why the default thickness does not apply, for traceability to the brief. */
  readonly reason: string;
}

/** The complete plan of one floor. */
export interface FloorPlan {
  /** Outer boundary of the floor: the outside faces of the exterior walls. */
  readonly plot: PlanRect;
  /** Clear interior of the floor: the inside faces of the exterior walls. */
  readonly interior: PlanRect;
  /** Every space on the floor. */
  readonly spaces: readonly Space[];
  /** Wall thicknesses that deviate from the defaults. */
  readonly joinOverrides: readonly JoinOverride[];
}

/** One face-to-face contact between a rect of a space and a rect of a neighbouring space. */
export interface SpaceContact {
  /** Identifier of the neighbouring space. */
  readonly neighbourId: SpaceId;
  /** Face of the queried space's own rect that faces the neighbour. */
  readonly side: RectSide;
  /** Index into the queried space's `rects`. */
  readonly rectIndex: number;
  /** Index into the neighbouring space's `rects`. */
  readonly neighbourRectIndex: number;
  /** Distance between the facing faces, in metres, rounded with `toPlanLength`. */
  readonly gap: number;
  /**
   * Start of the overlap along the face, in metres: an x coordinate for
   * `minZ`/`maxZ` sides, a z coordinate for `minX`/`maxX` sides.
   */
  readonly spanMin: number;
  /** End of the overlap along the face, on the same axis as {@link SpaceContact.spanMin}. */
  readonly spanMax: number;
}
