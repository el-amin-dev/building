/**
 * Public API of the floor-plan model (ADR-005): the space types and id lists,
 * the typical floor data, its validation, the read-only queries and the join
 * thickness rule.
 *
 * Import from this module rather than from the individual files. The model is
 * pure TypeScript and depends only on the plan geometry and wall spec modules.
 */
export { SPACE_IDS, SPACE_KINDS } from './types.ts';
export type { FloorPlan, JoinOverride, Space, SpaceContact, SpaceId, SpaceKind } from './types.ts';
export { FLOOR_PLAN, INTERIOR_RECT, PLOT_RECT } from './floorPlanData.ts';
export { validateFloorPlan } from './validateFloorPlan.ts';
export {
  findSpaceAt,
  getNeighbours,
  getSpace,
  getSpaceArea,
  getSpaceBounds,
  hasFloor,
} from './queries.ts';
export { getJoinThickness } from './joins.ts';
