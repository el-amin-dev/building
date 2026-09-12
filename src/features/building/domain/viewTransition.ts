/**
 * Rules of the animated exterior↔interior camera transition.
 *
 * Stepping inside the building and back out moves the camera between two places
 * that have nothing in common: an orbit position tens of metres away looking at
 * the centre of the plot, and an eye — or a follow camera — inside a room. Cutting
 * between them tells the viewer nothing about how the two are related, so the
 * camera travels between them over {@link VIEW_TRANSITION_SECONDS}.
 *
 * A transition is expressed as a pair of {@link CameraPose}s and interpolated as
 * **a position and a look-at target**, never as a rotation: lerping two points and
 * pointing the camera from one at the other keeps it upright the whole way, with
 * no quaternion, no roll and no up-vector flip half way through — the same
 * `position` + `lookAt` pair the third-person camera and the orbit camera already
 * hand the renderer. The eased parameter is what makes it read as a movement
 * rather than a slide: it starts and ends at rest ({@link easeInOutCubic}).
 *
 * Pure geometry, in metres and radians, with the conventions of
 * `eyeNavigation.ts`: `y` up, the plan on `x`/`z`, yaw 0 looking toward −z and
 * forward on the plan `(−sin yaw, −cos yaw)`. No React, no three, nothing mutated.
 */

import type { EyePose } from './eyeNavigation.ts';
import type { Vector3Like } from './exteriorFraming.ts';
import { PERSON_SPEC } from './person.ts';

/**
 * How long the exterior↔interior camera travel takes, in seconds.
 *
 * Long enough to read the camera entering or leaving the building — under about
 * half a second the eased travel is indistinguishable from a cut — and short
 * enough that a viewer switching views repeatedly is never kept waiting. Under
 * `prefers-reduced-motion` no transition is started at all and the switch is
 * instant (`application/viewStore.ts`), so this duration is never imposed on a
 * viewer who asked for less motion.
 */
export const VIEW_TRANSITION_SECONDS = 0.9;

/**
 * Where a camera is and what it looks at: the one shape both endpoints of a
 * transition are expressed in.
 *
 * `Vector3Like` is reused from `exteriorFraming.ts` rather than respelled, so the
 * framing's `position`/`target`, the third-person camera's `position`/`target` and
 * a transition endpoint are all the same kind of point.
 */
export interface CameraPose {
  /** Where the camera sits, in metres. */
  readonly position: Vector3Like;
  /** The point the camera looks at, in metres. */
  readonly target: Vector3Like;
}

/** Start of the eased travel: nothing of the way covered. */
const TWEEN_START = 0;
/** End of the eased travel: all of the way covered. */
const TWEEN_END = 1;
/** Half way: where {@link easeInOutCubic} switches from accelerating to decelerating. */
const TWEEN_MIDPOINT = 0.5;
/** The cubic of the easing: the power the remaining travel is raised to. */
const EASE_EXPONENT = 3;
/**
 * Scale of the cubic, so that the two halves meet at the midpoint: at `t` = 1/2 the
 * accelerating half must already have covered half the way, and `4 · (1/2)³ = 1/2`.
 */
const EASE_SCALE = 4;

/**
 * How far a person looks ahead in first person, in metres.
 *
 * The eye has an orientation rather than a point it looks at, so a look-at target
 * has to be put somewhere along its gaze. Any positive distance gives the same
 * orientation, so one metre is chosen for being the simplest: it is a unit step
 * along the plan forward vector.
 */
const EYE_LOOK_AHEAD_METRES = 1;

/**
 * Cubic ease-in-out of a travel parameter: starts at rest, ends at rest.
 *
 * Symmetric about the midpoint — the second half is the first half read backwards —
 * so the camera accelerates out of the pose it starts in and decelerates into the
 * one it ends in. A camera that started and stopped abruptly would read as a cut
 * with a delay rather than as a movement.
 *
 * @param t - The raw travel parameter; clamped into [0, 1], so a caller need not
 *   sanitise a frame that overshot the duration.
 * @returns The eased fraction of the way covered, in [0, 1], increasing in `t`,
 *   with `easeInOutCubic(0) === 0` and `easeInOutCubic(1) === 1`.
 */
export function easeInOutCubic(t: number): number {
  const clamped = clampTween(t);
  if (clamped < TWEEN_MIDPOINT) {
    return EASE_SCALE * clamped ** EASE_EXPONENT;
  }
  const remaining = TWEEN_END - clamped;
  return TWEEN_END - EASE_SCALE * remaining ** EASE_EXPONENT;
}

/**
 * The camera pose part way through a transition.
 *
 * The position and the look-at target are each interpolated on the *eased*
 * parameter (see {@link easeInOutCubic}), which is what keeps the camera upright:
 * two points moving between two points can never roll, whatever the two endpoints'
 * orientations were.
 *
 * @param from - The pose the transition starts at. Not mutated.
 * @param to - The pose it ends at. Not mutated.
 * @param t - The travel parameter; clamped into [0, 1].
 * @returns A fresh pose: `from` at `t` ≤ 0 and `to` at `t` ≥ 1, both exactly.
 */
export function getTransitionPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const eased = easeInOutCubic(t);
  return {
    position: mix(from.position, to.position, eased),
    target: mix(from.target, to.target, eased),
  };
}

/**
 * The first-person endpoint of a transition: the camera in the person's eyes.
 *
 * The camera sits at eye height over the plan position, and looks one metre along
 * the plan forward vector `(−sin yaw, −cos yaw)` at the same height. The pose's
 * `pitch` is deliberately ignored: a transition endpoint is a level gaze, and the
 * interior explorer's start pose is level anyway (`createArrivalPose`). The eye
 * height is `PERSON_SPEC.eyeHeight`, the same one the first-person camera itself
 * uses, so the transition lands exactly where the control that mounts after it
 * puts the camera.
 *
 * @param pose - The interior pose to look through. Not mutated.
 * @returns A fresh pose, level: its `position` and `target` are at the same height.
 */
export function getEyeCameraPose(pose: EyePose): CameraPose {
  const eyeHeight = PERSON_SPEC.eyeHeight;
  return {
    position: { x: pose.x, y: eyeHeight, z: pose.z },
    target: {
      x: pose.x - Math.sin(pose.yaw) * EYE_LOOK_AHEAD_METRES,
      y: eyeHeight,
      z: pose.z - Math.cos(pose.yaw) * EYE_LOOK_AHEAD_METRES,
    },
  };
}

/** Restricts a travel parameter to [0, 1]; `NaN` is treated as the start. */
function clampTween(t: number): number {
  if (!(t > TWEEN_START)) {
    return TWEEN_START;
  }
  return Math.min(t, TWEEN_END);
}

/**
 * Linear blend of two points: `from` at `fraction` 0, `to` at 1. A fresh object.
 *
 * Written as the weighted sum `(1 − f) · from + f · to` rather than as the cheaper
 * `from + (to − from) · f`, because only the weighted form reproduces the endpoints
 * *exactly*: at `f` = 1 the first term is a true zero and the result is `to` to the
 * last bit. The transition ends where the control mounting after it will place the
 * camera, so an endpoint that is merely within rounding of the right place would
 * leave a sub-millimetre jump at the hand-off.
 */
function mix(from: Vector3Like, to: Vector3Like, fraction: number): Vector3Like {
  const remaining = TWEEN_END - fraction;
  return {
    x: remaining * from.x + fraction * to.x,
    y: remaining * from.y + fraction * to.y,
    z: remaining * from.z + fraction * to.z,
  };
}
