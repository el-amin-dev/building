import { afterEach, describe, expect, it } from 'vitest';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { FLOOR_PLAN, SPACE_IDS, getSpace, hasFloor } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import type { PlanPoint } from '../domain/planGeometry.ts';
import { PORT_SCHEDULE } from '../domain/ports/index.ts';
import { MAX_FLOOR_COUNT, MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { BUILT_FLOOR } from './floorInstance.ts';
import { ROOM_TARGETS, getRoomTargets } from './roomTargets.ts';

/** The two spaces of the plan with no floor: open to the sky, not places a person can be. */
const VOID_IDS: readonly SpaceId[] = Object.freeze(['voidWest', 'voidEast']);

/** Rooms to offer: the 22 spaces of the plan less the two voids. */
const EXPECTED_TARGET_COUNT = 20;

/** A point in the corridor's main run (x 5.60–20.20, z 4.00–5.50), the far side of a door. */
const IN_CORRIDOR: PlanPoint = Object.freeze({ x: 8.0, z: 4.65 });

/** A point on the walkable side-B balcony slab, the far end of the floor. */
const ON_BALCONY_SLAB: PlanPoint = Object.freeze({ x: 14.45, z: 9.2 });

/** A point inside the side-A wall (x 1.30–1.60), which is no space of the plan. */
const INSIDE_A_WALL: PlanPoint = Object.freeze({ x: 1.45, z: 2.0 });

/**
 * The ids of a list of target spaces.
 *
 * @param targets - The spaces to read.
 * @returns Their ids, in the order given.
 */
function idsOf(targets: readonly { readonly id: SpaceId }[]): readonly SpaceId[] {
  return targets.map((space) => space.id);
}

afterEach(() => {
  useFloorCountStore.setState(useFloorCountStore.getInitialState(), true);
});

describe('getRoomTargets', () => {
  it('offers every floored space of the plan and neither void', () => {
    const floored = SPACE_IDS.filter((id) => hasFloor(getSpace(FLOOR_PLAN, id).kind));

    expect(idsOf(getRoomTargets(FLOOR_PLAN, PORT_SCHEDULE, IN_CORRIDOR))).toEqual(floored);
    expect(floored).toHaveLength(EXPECTED_TARGET_COUNT);
  });

  it('offers the same rooms from two different start points, so a walk cannot reshuffle it', () => {
    const fromCorridor = getRoomTargets(FLOOR_PLAN, PORT_SCHEDULE, IN_CORRIDOR);
    const fromSlab = getRoomTargets(FLOOR_PLAN, PORT_SCHEDULE, ON_BALCONY_SLAB);

    expect(idsOf(fromCorridor)).toEqual(idsOf(fromSlab));
    expect(idsOf(fromCorridor)).toEqual(idsOf(ROOM_TARGETS));
  });

  it('freezes the list it returns', () => {
    expect(Object.isFrozen(getRoomTargets(FLOOR_PLAN, PORT_SCHEDULE, IN_CORRIDOR))).toBe(true);
  });

  it('refuses a point that is no space of the plan', () => {
    expect(() => getRoomTargets(FLOOR_PLAN, PORT_SCHEDULE, INSIDE_A_WALL)).toThrow(RangeError);
  });
});

describe('ROOM_TARGETS', () => {
  it('holds the twenty walkable rooms of the floor', () => {
    expect(ROOM_TARGETS).toHaveLength(EXPECTED_TARGET_COUNT);
  });

  it.each(VOID_IDS)('leaves out %s, which has no floor to stand on', (id) => {
    expect(idsOf(ROOM_TARGETS)).not.toContain(id);
  });

  it('keeps the matricule order of SPACE_IDS', () => {
    const offered = idsOf(ROOM_TARGETS);
    const inPlanOrder = SPACE_IDS.filter((id) => offered.includes(id));

    expect(offered).toEqual(inPlanOrder);
  });

  it('resolves from the shared floor instance, not from a second derivation of the stair', () => {
    const { arrival } = BUILT_FLOOR.stairs;

    expect(idsOf(getRoomTargets(FLOOR_PLAN, PORT_SCHEDULE, arrival))).toEqual(idsOf(ROOM_TARGETS));
  });

  it('carries the matricule and the name of every room it offers', () => {
    ROOM_TARGETS.forEach((space) => {
      expect(space.matricule).not.toBe('');
      expect(space.name).not.toBe('');
    });
  });
});

describe('the floor-agnostic shape of a room target', () => {
  it('answers with plain spaces of the plan, carrying no storey of their own', () => {
    // A guard, not a feature. Every storey repeats the typical floor, so "which rooms can
    // be walked to" has one answer for the whole stack: baking a floor number in here would
    // turn twenty rooms into twenty per storey — 200 at the maximum — for no new fact. The
    // storey belongs to the *identity of a place* (`FloorSpaceRef`) and to the label the HUD
    // asks `getSpaceLabel` for, both of which the caller supplies.
    ROOM_TARGETS.forEach((space) => {
      expect(space).not.toHaveProperty('floor');
      expect(space).not.toHaveProperty('spaceId');
      expect(space).toBe(getSpace(FLOOR_PLAN, space.id));
    });
  });

  it('offers the same twenty rooms however tall the building is', () => {
    // The list is resolved once at module level from one floor's reachability graph, and
    // nothing about the stack reaches it. Asserted through the store the stack's height
    // actually lives in, so a future coupling would fail here rather than in the HUD.
    for (const count of [MIN_FLOOR_COUNT, MAX_FLOOR_COUNT]) {
      useFloorCountStore.getState().setFloorCount(count);

      expect(ROOM_TARGETS).toHaveLength(EXPECTED_TARGET_COUNT);
      expect(idsOf(getRoomTargets(FLOOR_PLAN, PORT_SCHEDULE, IN_CORRIDOR))).toEqual(
        idsOf(ROOM_TARGETS),
      );
    }
  });
});
