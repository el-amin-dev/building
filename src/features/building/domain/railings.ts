/**
 * Guard railings along the open edges of the floor.
 *
 * Owner answer (2026-09-11, in the line of the ADR-006 owner answers): wherever a
 * walkable surface meets the void with no wall between the two, a railing closes
 * the fall edge at `FLOOR_HEIGHTS.railing` (1.10 m). On the redrawn floor that is
 * the side-B strip, which now reads west to east as control-center balcony · void
 * (west) · balcony slab · void (east) · utility room. Three of those four joins
 * are explicit zero-wall overrides, because balcony and void are the same open-air
 * strip (brief §5.2, `sourceOfTruth/plan.ts`), and each one is railed: the
 * 0.80 m edge at x 4.90, and the 0.80 m edges at x 11.65 and x 15.35. The fourth,
 * void (east) ↔ utility room, keeps the drawn 0.20 m wall (owner, ADR-006), so it
 * is a wall to lean on rather than an edge to fall over. Every other void edge
 * already has a 0.30 m weather-facing wall in front of it — the guest room, the
 * kitchen, the two bathrooms, the laundry — and needs no rail.
 *
 * The rule is derived from the plan rather than drawn: a railing appears on a
 * contact with no gap where exactly one of the two spaces is a `'void'` and the
 * other has a floor. That deliberately excludes the other zero-wall join of the
 * plan, stairs ↔ corridor (brief §4.2): both are circulation with a floor, so
 * there is nothing to fall into.
 *
 * **The stairwell adds no railing, and that is a finding rather than an
 * oversight.** Opening the bay (`slabs.ts`) leaves only the arrival landing as
 * floor at this storey, so the question had to be asked again. The landing,
 * x 4.60–5.60 × z 4.00–6.00, is closed on three sides by 0.30 m walls (the
 * balcony spine, the master bedroom, the guest room) and open on two: east to the
 * corridor, at the same level through the zero join, and west to the bay. That
 * west face is 2.00 m long and the two flights tile it exactly — flight A over
 * z 4.00–5.00, flight B over z 5.00–6.00 — and **both meet it at this storey's
 * level**: flight A rises out of this floor, so its low end is level 0 at the
 * edge, and flight B arrives at this floor, so its top tread sits one 0.1667 m
 * riser below the landing. Stepping west is a step up or a step down onto a
 * stair, which is a doorway, not a drop. A rail there would be a fence across the
 * stairs. The rule that would find a real one — a piece meeting the arrival
 * landing whose surface at that edge is NOT at this storey's level, which is what
 * the head of a flight passing a landing looks like — selects nothing on this
 * plan, so it is written here rather than coded: `stairs.ts` already publishes
 * `atThisLevel` and the surfaces to derive it from, the day a plan needs it.
 *
 * A railing is a rendered guard rail, not structure: its {@link RAILING_THICKNESS}
 * is a rail profile, and it is **not** part of the wall footprint of the floor, so
 * it is excluded from the wall area the source of truth reports (44.12 m² on the
 * redrawn floor). The railings stand on floor area that is already counted in the
 * floor total.
 *
 * Pure geometry, in metres, with the plan conventions of `floorPlan/types.ts`
 * (ADR-005): no rendering, no scene objects, nothing mutated.
 */

import { getNeighbours, getSpace, hasFloor } from './floorPlan/index.ts';
import type { FloorPlan, SpaceContact, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { LENGTH_TOLERANCE, makeRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';

const HALF = 0.5;

/**
 * Thickness of a guard railing on the plan, in metres.
 *
 * A rail profile, not a wall: it is thinner than every thickness of `WALL_SPEC`
 * so that a railing reads as a rail rather than as a parapet, and it is excluded
 * from the wall area of brief §8.
 */
export const RAILING_THICKNESS = 0.05;

/** Distance from the shared edge to either face of the railing, in metres. */
const RAILING_HALF_THICKNESS = RAILING_THICKNESS * HALF;

/** A guard railing closing one fall edge between a walkable surface and a void. */
export interface Railing {
  /**
   * Footprint of the railing: a {@link RAILING_THICKNESS} thick strip centred on
   * the shared edge of the two spaces, running the length of their contact.
   */
  readonly rect: PlanRect;
  /** Height of the handrail above the finished floor level 0, in metres. */
  readonly top: number;
  /** The two spaces the railing stands between: the `'void'` first, then the floored one. */
  readonly spaces: readonly [SpaceId, SpaceId];
}

/**
 * Builds the footprint of a railing on a contact of a void rect.
 *
 * The shared edge lies on the contacted face of the void's rect, displaced by
 * half the gap so that a railing stays centred even on a join that does have a
 * wall; the strip then straddles that edge symmetrically and spans the extent of
 * the contact. Its faces are left unrounded: half of a 0.05 m rail profile falls
 * between two centimetres of the plan grid, and snapping it would make the rail
 * lopsided.
 *
 * @param voidRect - The rect of the void space that carries the contact.
 * @param contact - The contact between that rect and the floored neighbour.
 * @returns A frozen rectangle centred on the shared edge.
 */
function getRailingRect(voidRect: PlanRect, contact: SpaceContact): PlanRect {
  const half = RAILING_HALF_THICKNESS;
  const offset = contact.gap * HALF;
  switch (contact.side) {
    case 'minX': {
      const edge = voidRect.minX - offset;
      return makeRect(edge - half, edge + half, contact.spanMin, contact.spanMax);
    }
    case 'maxX': {
      const edge = voidRect.maxX + offset;
      return makeRect(edge - half, edge + half, contact.spanMin, contact.spanMax);
    }
    case 'minZ': {
      const edge = voidRect.minZ - offset;
      return makeRect(contact.spanMin, contact.spanMax, edge - half, edge + half);
    }
    case 'maxZ': {
      const edge = voidRect.maxZ + offset;
      return makeRect(contact.spanMin, contact.spanMax, edge - half, edge + half);
    }
  }
}

/**
 * Derives the guard railings of a plan.
 *
 * For every space of kind `'void'`, every contact with no wall (a gap within the
 * length tolerance) whose neighbour has a floor becomes a railing. Iterating the
 * voids gives each fall edge exactly once — a void↔void contact has no floored
 * side and is skipped — and lists the railings in plan order: the order of
 * `plan.spaces`, then the contact order of `getNeighbours`.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param heights - Vertical sizes of the floor, in metres; defaults to
 *   {@link FLOOR_HEIGHTS}.
 * @returns A frozen array of frozen railings, each rising from the finished floor
 *   level 0 to `heights.railing`.
 * @throws RangeError naming the value when `heights.railing` is not a finite
 *   positive height.
 */
export function getRailings(
  plan: FloorPlan,
  heights: FloorHeights = FLOOR_HEIGHTS,
): readonly Railing[] {
  const top = heights.railing;
  if (!Number.isFinite(top) || top <= 0) {
    throw new RangeError(`heights.railing must be a finite positive number, got ${String(top)}`);
  }
  return Object.freeze(
    plan.spaces
      .filter((space) => !hasFloor(space.kind))
      .flatMap((space) =>
        getNeighbours(plan, space.id)
          .filter(
            (contact) =>
              contact.gap <= LENGTH_TOLERANCE && hasFloor(getSpace(plan, contact.neighbourId).kind),
          )
          .map((contact) =>
            Object.freeze({
              rect: getRailingRect(space.rects[contact.rectIndex], contact),
              top,
              spaces: Object.freeze([space.id, contact.neighbourId] as const),
            }),
          ),
      ),
  );
}
