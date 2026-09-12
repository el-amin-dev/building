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
 * It lives in `ui/` rather than in `domain/` because it is an instance, not a
 * rule: the derivation belongs to the modules imported here, and this file only
 * says "once, here, for the whole page". Nothing may re-derive any of these for
 * the live floor — consume the constants.
 */

import { getBuiltFloor } from '../domain/builtFloor.ts';
import type { BuiltFloor } from '../domain/builtFloor.ts';
import { getWalkField } from '../domain/collision.ts';
import type { WalkField } from '../domain/collision.ts';
import { createArrivalPose } from '../domain/eyeNavigation.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { createCameraField } from '../domain/thirdPersonCamera.ts';
import type { CameraField } from '../domain/thirdPersonCamera.ts';

/** Every solid of the floor: walls, slabs, railings, windows, stairs and the TV panel. */
export const BUILT_FLOOR: BuiltFloor = getBuiltFloor();

/** Where a body may stand and what stops it, swept from {@link BUILT_FLOOR} over the plot. */
export const WALK_FIELD: WalkField = getWalkField(BUILT_FLOOR, FLOOR_PLAN.plot);

/**
 * Where the third-person camera may go: the walk field's blockers, plus the
 * vertical range between the floor and the ceiling at the wall height.
 */
export const CAMERA_FIELD: CameraField = createCameraField(WALK_FIELD, FLOOR_HEIGHTS.wall);

/**
 * Where the explorer starts inside the building: the stairs arrival, looking level.
 *
 * Entry to the floor is through the stairs (ADR-006). This is the one pose the
 * interior explorer starts from and the one the exterior→interior transition ends
 * at, shared as a single object so the two cannot disagree.
 */
export const INTERIOR_START_POSE: EyePose = createArrivalPose(BUILT_FLOOR.stairs.arrival);
