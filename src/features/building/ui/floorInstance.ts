/**
 * The floor of the page, derived exactly once and shared by identity.
 *
 * Everything below is pure data of the plan and the vertical sizes, so it could
 * be recomputed anywhere. It deliberately is not, and the rule this module exists
 * to enforce is **derived once, shared by identity**:
 *
 * - `FloorModel` bakes the solids into one merged geometry per material and
 *   rebuilds it whenever the array it is handed changes identity (ADR-008), so a
 *   floor derived per render — or per frame — would re-merge every wall, slab and
 *   step and re-upload the buffers to the GPU. A module-scope constant gives each
 *   array one identity for the whole life of the page, which no `useMemo`
 *   dependency can accidentally invalidate;
 * - the camera transition's interior endpoint and the interior explorer's own
 *   start pose must be the *same object*, not two equal computations, so the
 *   camera lands exactly where the control mounting after it places it. Equality
 *   of two separate derivations is an accident that a future change to either
 *   caller can break silently; one shared object cannot drift.
 *
 * ## One floor, a stack of storeys
 *
 * The building is the typical floor repeated upwards (`domain/storeys.ts`), so
 * the *plan* is the same on every storey and there are only ever **two** plan
 * fields for the whole stack: {@link WALK_FIELD}, in which the stair bay is a
 * hole to be stopped at, and {@link STAIR_WALK_FIELD}, in which the stair's own
 * footprints are floor. Nothing here is offset per storey, and that is a rule
 * rather than an economy: `collision.ts` classifies a box as floor by comparing
 * its top against a module constant — the finished floor level — so a solid
 * lifted to storey 3 would be floor to nothing at all, the swept floor set would
 * come out empty and the sweep would call the whole plot a fall.
 *
 * What genuinely differs between storeys is where the *stair* can be walked to,
 * and only at the ends of the stack: the bottom storey has nothing below it and
 * the top storey nothing above (`getStairwellEnds`). That is four cappings in
 * all — lone, bottom, middle, top — so four {@link WalkSurface}s serve a stack of
 * any height, and {@link getWalkSurfaces} hands out one frozen list per storey
 * count, memoised by count so repeated calls return the identical list.
 *
 * It lives in `ui/` rather than in `domain/` because it is an instance, not a
 * rule: the derivation belongs to the modules imported here, and this file only
 * says "once, here, for the whole page". Nothing may re-derive any of these for
 * the live floor — consume the constants.
 */

import { getBuiltFloor } from '../domain/builtFloor.ts';
import type { BuiltFloor } from '../domain/builtFloor.ts';
import { getWalkField } from '../domain/collision.ts';
import type { WalkField, WalkFieldSolids } from '../domain/collision.ts';
import { createArrivalPose } from '../domain/eyeNavigation.ts';
import type { EyePose, WalkSurface } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { makeBox } from '../domain/planBox.ts';
import { SLAB_THICKNESS } from '../domain/slabs.ts';
import { getStairwell, getStairwellEnds, THIS_STOREY_PLACEMENT } from '../domain/stairs.ts';
import type { StairwellEnds } from '../domain/stairs.ts';
import { clampFloorCount, MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { createCameraField } from '../domain/thirdPersonCamera.ts';
import type { CameraField } from '../domain/thirdPersonCamera.ts';

/** How many legal storey counts there are: `MIN_FLOOR_COUNT`…`MAX_FLOOR_COUNT` inclusive. */
const FLOOR_COUNT_RANGE = MAX_FLOOR_COUNT - MIN_FLOOR_COUNT + 1;

/** The storey the viewer enters the building on: the lowest one designed (ADR-006). */
const FIRST_FLOOR = MIN_FLOOR_COUNT;

/** Every solid of the floor: walls, slabs, railings, windows, stairs and the TV panel. */
export const BUILT_FLOOR: BuiltFloor = getBuiltFloor();

/** Where a body may stand and what stops it, swept from {@link BUILT_FLOOR} over the plot. */
export const WALK_FIELD: WalkField = getWalkField(BUILT_FLOOR, FLOOR_PLAN.plot);

/**
 * The solids of the floor with the stair's own footprints released as floor.
 *
 * The stair pieces that are not floor at this storey — every piece but the
 * arrival landing — are handed to the sweep as slabs topping out at exactly the
 * finished floor. That is the whole trick, and it needs no change to
 * `collision.ts`: a box whose top is the finished floor is floor to `isFloorBox`
 * and, overlapping the body's span by exactly zero, is *not* solid to
 * `isSolidAtBodyHeight` — the same pair of rules that already makes a door
 * threshold walkable and a window sill a wall. The module's mutual-exclusivity
 * argument survives verbatim, and every injected face is a face of a stair piece,
 * already on the centimetre plan grid.
 *
 * What the injection buys is a field in which the shaft is not a fall: inside the
 * bay the flights and landings are real surfaces and *height* decides what may be
 * stood on (`stairwell.ts`), which is a question a plan rectangle cannot answer.
 * Outside the bay nothing changes, and the two fields are chosen between by
 * `getSurfaceField` on the plan position alone.
 */
const STAIR_WALK_SOLIDS: WalkFieldSolids = {
  walls: BUILT_FLOOR.walls,
  slabs: [
    ...BUILT_FLOOR.slabs,
    ...BUILT_FLOOR.stairs.pieces
      .filter((piece) => !piece.atThisLevel)
      .map((piece) =>
        makeBox(
          piece.rect,
          THIS_STOREY_PLACEMENT.level - SLAB_THICKNESS,
          THIS_STOREY_PLACEMENT.level,
        ),
      ),
  ],
  railings: BUILT_FLOOR.railings,
};

/** {@link WALK_FIELD} with the stairwell's footprints released as floor (see above). */
export const STAIR_WALK_FIELD: WalkField = getWalkField(STAIR_WALK_SOLIDS, FLOOR_PLAN.plot);

/** One storey of the stack as its walker and its follow camera see it. */
interface StoreyInstance {
  /** What the storey offers underfoot: the two plan fields, its stairwell and the pitch. */
  readonly surface: WalkSurface;
  /** Where the follow camera may go on that storey. */
  readonly cameraField: CameraField;
}

/**
 * Derives the one storey instance of a capping of the stack.
 *
 * @param ends - Which neighbouring storeys the stair continues into.
 * @returns A frozen surface over the two shared plan fields, with the stairwell
 *   capped as `ends` says, and the camera field built on it.
 */
function createStorey(ends: StairwellEnds): StoreyInstance {
  const surface: WalkSurface = Object.freeze({
    field: WALK_FIELD,
    bayField: STAIR_WALK_FIELD,
    well: getStairwell(BUILT_FLOOR.stairs, FLOOR_HEIGHTS, ends),
    floorToFloor: FLOOR_HEIGHTS.floorToFloor,
  });
  return Object.freeze({
    surface,
    cameraField: createCameraField(surface, FLOOR_HEIGHTS.wall),
  });
}

/** The only storey of a one-storey building: no flight may be walked either way. */
const LONE_STOREY: StoreyInstance = createStorey({ hasBelow: false, hasAbove: false });

/** The bottom of a taller stack: a flight up, and nothing below. */
const BOTTOM_STOREY: StoreyInstance = createStorey({ hasBelow: false, hasAbove: true });

/** A storey with a storey either side of it: the stair runs right through. */
const MIDDLE_STOREY: StoreyInstance = createStorey({ hasBelow: true, hasAbove: true });

/** The top of the stack: a flight down, and nothing above. */
const TOP_STOREY: StoreyInstance = createStorey({ hasBelow: true, hasAbove: false });

/**
 * Picks the storey instance a capping asks for: one of four objects, never a new one.
 *
 * @param ends - Which neighbouring storeys the stair continues into.
 * @returns The shared instance for that capping.
 */
function storeyFor(ends: StairwellEnds): StoreyInstance {
  if (ends.hasBelow) {
    return ends.hasAbove ? MIDDLE_STOREY : TOP_STOREY;
  }
  return ends.hasAbove ? BOTTOM_STOREY : LONE_STOREY;
}

/**
 * The storeys of every legal count, indexed by `count − MIN_FLOOR_COUNT`, lowest storey first.
 *
 * Ten lists, 55 entries between them, and every entry is one of the four shared
 * storey instances: a stepper press changes only *which* list is handed down,
 * never what is in one.
 */
const STOREYS_BY_COUNT: readonly (readonly StoreyInstance[])[] = Object.freeze(
  Array.from({ length: FLOOR_COUNT_RANGE }, (_unused, index) => {
    const count = index + MIN_FLOOR_COUNT;
    return Object.freeze(
      Array.from({ length: count }, (_entry, storey) =>
        storeyFor(getStairwellEnds(storey + MIN_FLOOR_COUNT, count)),
      ),
    );
  }),
);

/** The walking surfaces of every legal count, indexed by `count − MIN_FLOOR_COUNT`. */
const WALK_SURFACES_BY_COUNT: readonly (readonly WalkSurface[])[] = Object.freeze(
  STOREYS_BY_COUNT.map((storeys) => Object.freeze(storeys.map((storey) => storey.surface))),
);

/** The camera fields of every legal count, indexed by `count − MIN_FLOOR_COUNT`. */
const CAMERA_FIELDS_BY_COUNT: readonly (readonly CameraField[])[] = Object.freeze(
  STOREYS_BY_COUNT.map((storeys) => Object.freeze(storeys.map((storey) => storey.cameraField))),
);

/**
 * Reads one entry of a per-count table.
 *
 * @param table - The table to read: one entry per legal count, lowest first.
 * @param count - The storey count wanted; clamped as `clampFloorCount` does, so a
 *   count outside the shown range reads the nearest legal one rather than
 *   falling off the table.
 * @returns The table's entry for that count, the shared object rather than a copy.
 * @throws RangeError when the table is shorter than the legal range, which would
 *   mean it was not built from {@link FLOOR_COUNT_RANGE}.
 */
function entryAt<T>(table: readonly T[], count: number): T {
  const index = clampFloorCount(count) - MIN_FLOOR_COUNT;
  const entry: T | undefined = table[index];
  if (entry === undefined) {
    throw new RangeError(`nothing is tabulated for a building of ${String(count)} storeys`);
  }
  return entry;
}

/**
 * Returns the walking surface of every storey of a stack, lowest first.
 *
 * Memoised by count: two calls with the same count return the *same* list, and
 * every entry of every list is one of the four shared surfaces, so the frame loop
 * can index this per frame without deriving anything.
 *
 * @param floorCount - How many storeys are stacked; clamped as `clampFloorCount` does.
 * @returns The frozen, shared list of `floorCount` surfaces.
 * @throws RangeError when `floorCount` is not finite (see `clampFloorCount`).
 */
export function getWalkSurfaces(floorCount: number): readonly WalkSurface[] {
  return entryAt(WALK_SURFACES_BY_COUNT, floorCount);
}

/**
 * Returns the follow camera's field on every storey of a stack, lowest first.
 *
 * Shared and memoised exactly as {@link getWalkSurfaces} is, and built on those
 * very surfaces, so a camera and the body it follows can never be bounded by two
 * different readings of the same storey.
 *
 * @param floorCount - How many storeys are stacked; clamped as `clampFloorCount` does.
 * @returns The frozen, shared list of `floorCount` camera fields.
 * @throws RangeError when `floorCount` is not finite (see `clampFloorCount`).
 */
export function getCameraFields(floorCount: number): readonly CameraField[] {
  return entryAt(CAMERA_FIELDS_BY_COUNT, floorCount);
}

/**
 * One camera field for the reader that is not walking a stack: the person model's
 * own visibility rule (`personModelParts.ts`), which asks where the follow camera
 * ends up and nothing else.
 *
 * A single field rather than the storey's own is right there, because the four
 * per-storey fields differ *only* in how their stairwell is capped at the ends of
 * the stack, and the follow camera never reads the stairwell: it reads the plan
 * field — which every storey shares, since the bay is at the same place on all of
 * them — and a vertical range that is storey-relative and therefore the same on
 * every storey. What the capping decides is where a *walker* may climb, which is
 * `EyeCameraControls`' business and is handed to it per storey.
 */
export const CAMERA_FIELD: CameraField = LONE_STOREY.cameraField;

/**
 * Where the explorer starts inside the building: the stairs arrival on the first
 * floor, looking level.
 *
 * Entry to the floor is through the stairs (ADR-006). This is the one pose the
 * interior explorer starts from and the one the exterior→interior transition ends
 * at, shared as a single object so the two cannot disagree. The storey is stated
 * rather than defaulted: the same landing exists on every storey of the stack, and
 * the viewer walks in at the bottom of it.
 */
export const INTERIOR_START_POSE: EyePose = createArrivalPose(
  BUILT_FLOOR.stairs.arrival,
  FIRST_FLOOR,
);
