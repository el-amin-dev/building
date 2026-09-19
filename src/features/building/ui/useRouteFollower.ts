/**
 * The route-following step of the interior frame loop: one call per frame that turns the
 * "go to room" command into the same {@link MovementIntent} a held key produces.
 *
 * Everything it needs already exists and this hook is only the wiring: `roomWalkStore.ts`
 * holds the command and its outcome, `reachability.ts` says which spaces to cross,
 * `roomRoute.ts` turns that into waypoints a body fits through, and `routeFollower.ts` steers
 * along them. Nothing here re-derives any of it.
 *
 * ## Read non-reactively, on purpose
 *
 * The walk store is read with `getState()` rather than through the hook's selector, exactly as
 * `EyeCameraControls.tsx` reads the remote control: subscribing a component inside `<Canvas>`
 * to state it consults sixty times a second would re-render the scene sixty times a second
 * (ADR-004, ADR-007). The follower's own progress never reaches React at all — it lives in a
 * ref, because it changes every frame.
 *
 * ## Planning happens on a frame, not in an effect
 *
 * Planning needs the pose, and the pose lives in a ref owned by the frame loop, so the first
 * frame of a new request is the first moment a route can be planned at all. Planning there
 * keeps a single reader of that ref and avoids any question of when an effect runs relative to
 * `useFrame` inside `<Canvas>`.
 *
 * ## What this hook does not do
 *
 * It never reads keys or on-screen pad actions, never cancels a walk on manual input, and
 * never moves the body. The frame loop owns all three: it is the one place that already reads
 * both the held keys and the pad, and it is the one place that calls `stepEyePose`. Adding any
 * of that here would give the interior two movers and two cancel rules to keep in agreement.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import type { EyePose, MovementIntent } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import type { FloorSpaceRef } from '../domain/floorSpace.ts';
import { PORT_SCHEDULE } from '../domain/ports/index.ts';
import { findSpaceRoute } from '../domain/reachability.ts';
import { getRouteWaypoints } from '../domain/roomRoute.ts';
import {
  createRouteFollower,
  isRouteFollowerDone,
  stepRouteFollower,
} from '../domain/routeFollower.ts';
import type { RouteFollowerState } from '../domain/routeFollower.ts';

/**
 * The request id of no walk at all: the store's initial value, which the first `startWalkTo`
 * raises past. Starting there means the first request is planned like any other.
 */
const NO_PLANNED_REQUEST = 0;

/** Length of the route `findSpaceRoute` returns when there is no way to the target at all. */
const UNREACHABLE_ROUTE_LENGTH = 0;

/**
 * Length of the route to the space the viewer already stands in: that space alone. Nothing is
 * walked for it, so the request is answered as an arrival and the body stays where it is.
 */
const ALREADY_THERE_ROUTE_LENGTH = 1;

/**
 * What planning a walk produced: a follower to step, or the outcome to report instead of
 * walking at all.
 */
type RoutePlan =
  | { readonly kind: 'route'; readonly follower: RouteFollowerState }
  | { readonly kind: 'arrived' }
  | { readonly kind: 'unreachable' };

/** The plan for a target the viewer is already standing in. Frozen and shared: it is read only. */
const ARRIVED_PLAN: RoutePlan = Object.freeze({ kind: 'arrived' });

/** The plan for a target there is no walking to. Frozen and shared: it is read only. */
const UNREACHABLE_PLAN: RoutePlan = Object.freeze({ kind: 'unreachable' });

/**
 * Plans the walk from a pose to a room, on the real floor and its real port schedule.
 *
 * Routing is single-floor, and stays that way here: `findSpaceRoute` crosses the one typical
 * plan through its doorways, and nothing in it knows the stair as a way between storeys. A
 * target on another floor is therefore refused outright rather than walked to on this one —
 * "the kitchen" two storeys up is not the kitchen underfoot, and quietly substituting it
 * would take the viewer to a room they did not pick. Reported as unreachable, which is the
 * honest answer and a status the store already carries. Walking the stair under command is a
 * feature of its own: it needs the stair as an edge of the space graph and a 180-degree turn
 * on a 1.00 m landing, neither of which this follower has.
 *
 * Total: every way this can fail comes back as a {@link RoutePlan} rather than as a throw,
 * because the caller is a frame callback.
 *
 * @param pose - Where the body stands now.
 * @param target - The room asked for, storey and all.
 * @returns A follower to step, or the outcome to report instead.
 */
function planRoute(pose: EyePose, target: FloorSpaceRef): RoutePlan {
  if (target.floor !== pose.floor) {
    return UNREACHABLE_PLAN;
  }
  try {
    const route = findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, pose, target.spaceId);
    if (route.length === UNREACHABLE_ROUTE_LENGTH) {
      return UNREACHABLE_PLAN;
    }
    if (route.length === ALREADY_THERE_ROUTE_LENGTH) {
      return ARRIVED_PLAN;
    }
    const waypoints = getRouteWaypoints(FLOOR_PLAN, PORT_SCHEDULE, route, pose);
    return { kind: 'route', follower: createRouteFollower(waypoints, pose) };
  } catch (error) {
    // `findSpaceRoute` throws a `RangeError` when the start point lies in no space of the plan
    // — a wall, a gap between spaces, outside the plot — or in one with no floor to stand on,
    // and `getRouteWaypoints` throws one for a crossing or a space the body does not fit
    // through. A body straddling a doorjamb genuinely stands inside a wall for a frame or two,
    // so this is a state the viewer can reach by walking, and a throw escaping into `useFrame`
    // would take the whole scene down with it. So it is reported as what it amounts to from
    // the viewer's side: that room cannot be walked to from here. Anything else is a bug and
    // keeps propagating.
    if (error instanceof RangeError) {
      return UNREACHABLE_PLAN;
    }
    throw error;
  }
}

/**
 * Follows the room walk asked for in `roomWalkStore.ts`, one frame at a time.
 *
 * The returned function is what the interior frame loop calls. Per call it:
 *
 * 1. plans a route for a `requestId` it has not planned yet, recording the id whether the plan
 *    succeeded or not, so a failed plan is not retried on every following frame;
 * 2. steps the follower it holds and hands back its intent;
 * 3. reports the outcome exactly once when the follower arrives or gives up, and then drops
 *    it: the report goes to the store with the `requestId` it belongs to, so a walk the viewer
 *    has already cancelled cannot be resurrected by it.
 *
 * Unmounting — which is what leaving the interior view does — cancels the walk, so nothing is
 * left claiming to be on its way to a room while no frame loop is stepping it.
 *
 * @returns An advance function taking the body's pose this frame and the elapsed time in
 *   seconds, and giving back the intent to apply, or `undefined` when no walk is being
 *   followed. Stable for the life of the hook: it reads the store and its own refs, so it
 *   never needs to be rebuilt.
 */
export function useRouteFollower(): (
  pose: EyePose,
  dtSeconds: number,
) => MovementIntent | undefined {
  const followerRef = useRef<RouteFollowerState | undefined>(undefined);
  const plannedRequestIdRef = useRef(NO_PLANNED_REQUEST);

  useEffect(
    () => () => {
      useRoomWalkStore.getState().cancelWalk();
    },
    [],
  );

  return useCallback((pose: EyePose, dtSeconds: number): MovementIntent | undefined => {
    const { target, status, requestId, reportArrived, reportBlocked, reportUnreachable } =
      useRoomWalkStore.getState();

    if (status !== 'walking' || target === undefined) {
      // Idle, cancelled, or an outcome already recorded: nothing is being followed any more.
      followerRef.current = undefined;
      return undefined;
    }

    if (requestId !== plannedRequestIdRef.current) {
      // The id is recorded before the plan is used, so a request whose plan failed — and a
      // request answered without walking — is planned once and not once per frame.
      plannedRequestIdRef.current = requestId;
      const plan = planRoute(pose, target);
      followerRef.current = plan.kind === 'route' ? plan.follower : undefined;
      if (plan.kind === 'arrived') {
        reportArrived(requestId);
      } else if (plan.kind === 'unreachable') {
        reportUnreachable(requestId);
      }
    }

    const follower = followerRef.current;
    if (follower === undefined) {
      return undefined;
    }

    const { state, intent } = stepRouteFollower(follower, pose, dtSeconds);
    if (isRouteFollowerDone(state)) {
      followerRef.current = undefined;
      if (state.phase === 'arrived') {
        reportArrived(requestId);
      } else {
        reportBlocked(requestId);
      }
      return undefined;
    }
    followerRef.current = state;
    return intent;
  }, []);
}
