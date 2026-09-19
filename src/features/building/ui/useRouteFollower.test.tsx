import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { getBuiltFloor } from '../domain/builtFloor.ts';
import { getWalkField, makeWalkField } from '../domain/collision.ts';
import type { WalkField } from '../domain/collision.ts';
import { stepEyePose } from '../domain/eyeNavigation.ts';
import type { EyePose, MovementIntent, WalkSurface } from '../domain/eyeNavigation.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import { findSpaceAt, FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import type { FloorSpaceRef } from '../domain/floorSpace.ts';
import type { PlanRect } from '../domain/planGeometry.ts';
import { hasAnyInput } from '../domain/routeFollower.ts';
import { getStairsLayout, getStairwell, getStairwellEnds } from '../domain/stairs.ts';
import { useRouteFollower } from './useRouteFollower.ts';

/** The floor the walks really happen on, as the interior view builds it. */
const FIELD: WalkField = getWalkField(getBuiltFloor(), FLOOR_PLAN.plot);

/** The storey every walk in this file happens on: the lowest, as the plan numbers it. */
const GROUND_FLOOR = 1;

/** How many storeys the stack these walks cross has: the one designed floor, on its own. */
const SINGLE_STOREY = 1;

/** The stair of the typical floor. */
const STAIRS_LAYOUT = getStairsLayout();

/**
 * Tells whether a blocker lies wholly within the stair bay.
 *
 * The bay is a hole through the floor everywhere but the arrival landing, so `getWalkField`
 * fills it with fall cells. Those are exactly the rectangles the bay field must not carry:
 * inside the bay what may be stood on is decided by height, not by a rectangle.
 */
function isInsideBay(rect: PlanRect): boolean {
  const { bay } = STAIRS_LAYOUT;
  return (
    rect.minX >= bay.minX && rect.maxX <= bay.maxX && rect.minZ >= bay.minZ && rect.maxZ <= bay.maxZ
  );
}

/**
 * The storey these walks cross, as the walker meets it underfoot.
 *
 * The plan field is the real one the interior builds; the bay field is that same field with the
 * stair shaft's fall cells taken out, so that inside the bay the stairwell rather than a
 * rectangle says what is standable. The stack is one storey tall, so the stairwell has neither
 * an end above nor one below and offers only the arrival landing: the routes planned here are
 * plan routes across one floor, and no leg of one ever climbs.
 */
const SURFACE: WalkSurface = Object.freeze({
  field: FIELD,
  bayField: makeWalkField(
    FIELD.floor,
    FIELD.blockers.filter((rect) => !isInsideBay(rect)),
  ),
  well: getStairwell(STAIRS_LAYOUT, FLOOR_HEIGHTS, getStairwellEnds(GROUND_FLOOR, SINGLE_STOREY)),
  floorToFloor: FLOOR_HEIGHTS.floorToFloor,
});

/**
 * Where a person arriving up the stairs stands: on the landing that is floor at this level,
 * facing out through its open edge toward the corridor (yaw −π/2 looks toward +x).
 *
 * The landing is floor at this storey's own level, so the body stands on floor 1 with no rise
 * above its finished floor — the same height as anyone standing in a room of it.
 */
const STAIRS_ARRIVAL: EyePose = Object.freeze({
  x: 5.1,
  z: 5.0,
  yaw: -Math.PI / 2,
  pitch: 0,
  floor: GROUND_FLOOR,
  rise: 0,
});

/**
 * A pose inside the wall between the corridor and the guest room: the corridor ends at z 6.00
 * and the guest room starts at z 6.30, so this point lies in no space of the plan — which is
 * what makes `findSpaceRoute` throw rather than answer.
 */
const INSIDE_A_WALL: EyePose = Object.freeze({
  x: 5.1,
  z: 6.15,
  yaw: 0,
  pitch: 0,
  floor: GROUND_FLOOR,
  rise: 0,
});

/** One frame at 60 fps, in seconds: the frame length the interior loop usually hands over. */
const FRAME_SECONDS = 1 / 60;

/**
 * Most frames driven while waiting for a walk to end. At 60 fps this is fifty seconds of
 * walking, far more than crossing this floor takes, so a walk that never ends fails the test
 * instead of hanging it.
 */
const FRAME_LIMIT = 3000;

/** Frames walked before the viewer changes their mind, enough to be well clear of the landing. */
const FRAMES_BEFORE_SWITCHING = 60;

/** Frames of intents compared between a replaced route and a freshly planned one. */
const FRAMES_COMPARED = 30;

/** Frames driven to check that a request answered without a route is planned only once. */
const FRAMES_AFTER_FAILED_PLAN = 10;

/** The storey above the one these walks happen on: the plan repeated, out of routing's reach. */
const UPPER_FLOOR = GROUND_FLOOR + 1;

/** A room of the storey the walks happen on. */
function here(spaceId: SpaceId): FloorSpaceRef {
  return makeFloorSpaceRef(GROUND_FLOOR, spaceId);
}

/** The same room of the plan, one storey up: a place this follower cannot route to. */
function upstairs(spaceId: SpaceId): FloorSpaceRef {
  return makeFloorSpaceRef(UPPER_FLOOR, spaceId);
}

/** The request id of the first walk asked for after the store is reset. */
const FIRST_REQUEST_ID = 1;

/** The request id of the second walk asked for after the store is reset. */
const SECOND_REQUEST_ID = 2;

const ONE_CALL = 1;

/** What the hook hands to the frame loop. */
type Advance = ReturnType<typeof useRouteFollower>;

/** Where a run of frames got to. */
interface WalkRun {
  /** The pose after the last frame driven. */
  readonly pose: EyePose;
  /** Whether the hook stopped asking for anything within the frames driven. */
  readonly done: boolean;
  /** How many frames the hook asked for something on. */
  readonly steps: number;
}

function state() {
  return useRoomWalkStore.getState();
}

function renderFollower(): Advance {
  return renderHook(() => useRouteFollower()).result.current;
}

/**
 * Replaces the store's report actions with spies that still record the outcome.
 *
 * The store drops a repeated report silently — a second one leaves the state untouched and
 * notifies nobody — so a spy is the only way to see that the hook reported exactly once.
 *
 * @returns The three spies, each wrapping the real action.
 */
function spyOnReports() {
  const { reportArrived, reportBlocked, reportUnreachable } = state();
  const spies = {
    reportArrived: vi.fn(reportArrived),
    reportBlocked: vi.fn(reportBlocked),
    reportUnreachable: vi.fn(reportUnreachable),
  };
  useRoomWalkStore.setState(spies);
  return spies;
}

/**
 * Drives frames of the interior loop: hands the pose to the hook and moves the body with the
 * intent it asks for, exactly as the frame loop does, so the follower learns from the next
 * pose what the previous intent achieved.
 *
 * @param advance - The hook's advance function.
 * @param from - Where the body starts.
 * @param frames - How many frames to drive at most.
 * @returns Where the body got to, and whether the hook stopped asking for anything.
 */
function drive(advance: Advance, from: EyePose, frames: number): WalkRun {
  let pose = from;
  for (let frame = 0; frame < frames; frame += 1) {
    const intent = advance(pose, FRAME_SECONDS);
    if (intent === undefined) {
      return { pose, done: true, steps: frame };
    }
    pose = stepEyePose(pose, intent, FRAME_SECONDS, SURFACE).pose;
  }
  return { pose, done: false, steps: frames };
}

/**
 * Collects the intents a hook asks for, frame by frame, moving the body between frames.
 *
 * @returns One entry per frame; `undefined` once the hook is following nothing.
 */
function collectIntents(
  advance: Advance,
  from: EyePose,
  frames: number,
): readonly (MovementIntent | undefined)[] {
  const intents: (MovementIntent | undefined)[] = [];
  let pose = from;
  for (let frame = 0; frame < frames; frame += 1) {
    const intent = advance(pose, FRAME_SECONDS);
    intents.push(intent);
    if (intent !== undefined) {
      pose = stepEyePose(pose, intent, FRAME_SECONDS, SURFACE).pose;
    }
  }
  return intents;
}

/**
 * The intents a hook asks for when the walk to `target` is the first thing it is ever handed,
 * from `pose`.
 *
 * This is what makes "the route was replaced" checkable: a hook that re-planned from `pose`
 * asks for exactly what a hook planning that walk for the first time from `pose` asks for,
 * whereas one that kept or extended its old route steers along the old waypoints instead.
 */
function collectFreshIntents(
  target: FloorSpaceRef,
  pose: EyePose,
  frames: number,
): readonly (MovementIntent | undefined)[] {
  useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
  state().startWalkTo(target);
  return collectIntents(renderFollower(), pose, frames);
}

describe('useRouteFollower', () => {
  beforeEach(() => {
    useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
  });

  it('asks for nothing while no walk has been requested', () => {
    const advance = renderFollower();

    expect(advance(STAIRS_ARRIVAL, FRAME_SECONDS)).toBeUndefined();
    expect(state().status).toBe('idle');
  });

  it('hands the same advance function back on every render', () => {
    const { result, rerender } = renderHook(() => useRouteFollower());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('asks for something and keeps walking when the room asked for can be reached', () => {
    state().startWalkTo(here('kitchen'));
    const advance = renderFollower();

    const intent = advance(STAIRS_ARRIVAL, FRAME_SECONDS);

    expect(intent).toBeDefined();
    expect(hasAnyInput(intent as MovementIntent)).toBe(true);
    expect(state().status).toBe('walking');
    expect(state().target).toEqual(here('kitchen'));
  });

  it('reports a space with no floor unreachable and follows nothing', () => {
    state().startWalkTo(here('voidWest'));
    const liveId = state().requestId;
    const advance = renderFollower();

    const intent = advance(STAIRS_ARRIVAL, FRAME_SECONDS);

    expect(intent).toBeUndefined();
    expect(state().status).toBe('unreachable');
    expect(state().requestId).toBe(liveId);
    expect(liveId).toBe(FIRST_REQUEST_ID);
  });

  it('reports arrival without moving when the room asked for is the one it stands in', () => {
    state().startWalkTo(here('stairs'));
    const advance = renderFollower();

    const run = drive(advance, STAIRS_ARRIVAL, FRAMES_AFTER_FAILED_PLAN);

    expect(run.steps).toBe(0);
    expect(run.pose).toBe(STAIRS_ARRIVAL);
    expect(state().status).toBe('arrived');
  });

  it('reports arrival exactly once and then asks for nothing', () => {
    const reports = spyOnReports();
    state().startWalkTo(here('corridor'));
    const advance = renderFollower();

    const run = drive(advance, STAIRS_ARRIVAL, FRAME_LIMIT);

    expect(run.done).toBe(true);
    expect(state().status).toBe('arrived');
    expect(findSpaceAt(FLOOR_PLAN, run.pose)?.id).toBe('corridor');
    expect(reports.reportArrived).toHaveBeenCalledTimes(ONE_CALL);
    expect(reports.reportArrived).toHaveBeenCalledWith(FIRST_REQUEST_ID);
    expect(reports.reportBlocked).not.toHaveBeenCalled();

    expect(drive(advance, run.pose, FRAMES_AFTER_FAILED_PLAN).steps).toBe(0);
    expect(reports.reportArrived).toHaveBeenCalledTimes(ONE_CALL);
  });

  it('walks the guest room and the kitchen, each through its own doorways', () => {
    const reachable = ['guestRoom', 'kitchen'] as const satisfies readonly SpaceId[];

    reachable.forEach((target) => {
      useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
      state().startWalkTo(here(target));

      const run = drive(renderFollower(), STAIRS_ARRIVAL, FRAME_LIMIT);

      expect(state().status).toBe('arrived');
      expect(findSpaceAt(FLOOR_PLAN, run.pose)?.id).toBe(target);
    });
  });

  it('replaces the route when another room is chosen mid-walk', () => {
    state().startWalkTo(here('guestRoom'));
    const advance = renderFollower();
    const midway = drive(advance, STAIRS_ARRIVAL, FRAMES_BEFORE_SWITCHING).pose;

    state().startWalkTo(here('kitchen'));
    const switched = collectIntents(advance, midway, FRAMES_COMPARED);

    expect(state().requestId).toBe(SECOND_REQUEST_ID);
    expect(switched[0]).toBeDefined();
    expect(switched).toEqual(collectFreshIntents(here('kitchen'), midway, FRAMES_COMPARED));
  });

  it('re-plans when the same room is chosen twice', () => {
    state().startWalkTo(here('kitchen'));
    const advance = renderFollower();
    const midway = drive(advance, STAIRS_ARRIVAL, FRAMES_BEFORE_SWITCHING).pose;

    state().startWalkTo(here('kitchen'));
    const replanned = collectIntents(advance, STAIRS_ARRIVAL, FRAMES_COMPARED);

    // Planned from the stairs again, not continued from `midway`: the second request is a new
    // walk, so the route is the one a hook handed that request from this pose would follow.
    expect(midway).not.toEqual(STAIRS_ARRIVAL);
    expect(replanned).toEqual(
      collectFreshIntents(here('kitchen'), STAIRS_ARRIVAL, FRAMES_COMPARED),
    );
  });

  it('abandons the walk when it unmounts', () => {
    state().startWalkTo(here('kitchen'));
    const { unmount } = renderHook(() => useRouteFollower());

    unmount();

    expect(state().status).toBe('idle');
    expect(state().target).toBeUndefined();
  });

  it('reports unreachable instead of throwing when the body stands inside a wall', () => {
    const reports = spyOnReports();
    state().startWalkTo(here('kitchen'));
    const advance = renderFollower();

    expect(() => advance(INSIDE_A_WALL, FRAME_SECONDS)).not.toThrow();

    expect(state().status).toBe('unreachable');
    expect(reports.reportUnreachable).toHaveBeenCalledTimes(ONE_CALL);
    expect(reports.reportUnreachable).toHaveBeenCalledWith(FIRST_REQUEST_ID);
  });

  it('plans a request it cannot route only once, however many frames follow', () => {
    const reports = spyOnReports();
    state().startWalkTo(here('voidWest'));
    const advance = renderFollower();

    const run = drive(advance, STAIRS_ARRIVAL, FRAMES_AFTER_FAILED_PLAN);

    expect(run.steps).toBe(0);
    expect(reports.reportUnreachable).toHaveBeenCalledTimes(ONE_CALL);
    expect(reports.reportArrived).not.toHaveBeenCalled();
    expect(reports.reportBlocked).not.toHaveBeenCalled();
  });

  it('refuses a room on another storey rather than walking to the one on this floor', () => {
    // Routing is single-floor. The kitchen upstairs is a real room and a perfectly good
    // target — just not one this follower can reach — so it is refused outright rather than
    // answered with the kitchen underfoot, which is not the room the viewer picked.
    const reports = spyOnReports();
    state().startWalkTo(upstairs('kitchen'));
    const advance = renderFollower();

    const run = drive(advance, STAIRS_ARRIVAL, FRAMES_AFTER_FAILED_PLAN);

    expect(run.steps).toBe(0);
    expect(run.pose).toBe(STAIRS_ARRIVAL);
    expect(state().status).toBe('unreachable');
    expect(reports.reportUnreachable).toHaveBeenCalledTimes(ONE_CALL);
    expect(reports.reportUnreachable).toHaveBeenCalledWith(FIRST_REQUEST_ID);
    expect(reports.reportArrived).not.toHaveBeenCalled();
  });

  it('refuses the very room it stands in when it is asked for on another storey', () => {
    // The strongest form of the same rule: `stairs` from the stairs is an arrival on this
    // floor, so a follower that dropped the storey would report `arrived` here.
    state().startWalkTo(upstairs('stairs'));
    const advance = renderFollower();

    expect(advance(STAIRS_ARRIVAL, FRAME_SECONDS)).toBeUndefined();
    expect(state().status).toBe('unreachable');
    expect(state().target).toEqual(upstairs('stairs'));
  });

  it('walks a room of the storey the body is actually on', () => {
    // The mirror of the two above: same room id, reachable once the storeys agree.
    state().startWalkTo(here('kitchen'));

    const run = drive(renderFollower(), STAIRS_ARRIVAL, FRAME_LIMIT);

    expect(state().status).toBe('arrived');
    expect(findSpaceAt(FLOOR_PLAN, run.pose)?.id).toBe('kitchen');
  });
});
