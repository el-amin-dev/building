/**
 * Low-poly mannequin standing for the explorer's person in the third-person view.
 *
 * Pure data, independent of three.js: every part is described by a primitive shape, its
 * sizes and the position of its centre, in metres. The mannequin stands with its feet at
 * y 0, centred on the plan origin, and faces −z (yaw 0, as in `eyeNavigation.ts`), so its
 * right hand is on +x. Capsules and cylinders stand upright along y.
 *
 * Every size is a named ratio of the standing height, so the mannequin scales linearly.
 */

import type { EyePose } from '../domain/eyeNavigation.ts';
import { getThirdPersonCamera, shouldHidePersonModel } from '../domain/thirdPersonCamera.ts';
import type { CameraRoomBox, ScenePoint } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';

/** Primitive shape of a mannequin part. */
export type MannequinShape = 'box' | 'capsule' | 'sphere' | 'cylinder';

/** What a part shows: the body itself, or the marker telling where the person faces. */
export type MannequinPartRole = 'body' | 'facingMarker';

/** Fields shared by every mannequin part. */
interface MannequinPartBase {
  /** Name of the part, unique within the mannequin, e.g. `'head'`. */
  readonly name: string;
  /** Whether the part is the body or the facing marker. */
  readonly role: MannequinPartRole;
  /** Centre of the part, in metres. */
  readonly position: ScenePoint;
}

/** Sizes of a box part, metres. */
export interface MannequinBoxSize {
  /** Size along x. */
  readonly width: number;
  /** Size along y. */
  readonly height: number;
  /** Size along z. */
  readonly depth: number;
}

/** An axis-aligned box part. */
export interface MannequinBoxPart extends MannequinPartBase {
  /** Shape discriminant. */
  readonly shape: 'box';
  /** Sizes of the box, in metres. */
  readonly size: MannequinBoxSize;
}

/** An upright capsule part: a cylinder of `length` capped by two half-spheres of `radius`. */
export interface MannequinCapsulePart extends MannequinPartBase {
  /** Shape discriminant. */
  readonly shape: 'capsule';
  /** Radius of the capsule and its caps, in metres. */
  readonly radius: number;
  /** Height of the straight middle section, caps excluded, in metres. */
  readonly length: number;
}

/** A sphere part. */
export interface MannequinSpherePart extends MannequinPartBase {
  /** Shape discriminant. */
  readonly shape: 'sphere';
  /** Radius of the sphere, in metres. */
  readonly radius: number;
}

/** An upright cylinder part. */
export interface MannequinCylinderPart extends MannequinPartBase {
  /** Shape discriminant. */
  readonly shape: 'cylinder';
  /** Radius of the cylinder, in metres. */
  readonly radius: number;
  /** Height of the cylinder, in metres. */
  readonly length: number;
}

/** One primitive of the mannequin. */
export type MannequinPart =
  MannequinBoxPart | MannequinCapsulePart | MannequinSpherePart | MannequinCylinderPart;

const HALF = 0.5;
/** A diameter is two radii: a capsule has two caps, a sphere spans two radii. */
const DIAMETER_PER_RADIUS = 2;
const PLAN_CENTRE = 0;

/** The head is about one eighth of the standing height. */
const HEAD_HEIGHT_RATIO = 1 / 8;
const HEAD_RADIUS_RATIO = HEAD_HEIGHT_RATIO * HALF;
/** Top of the torso, where the neck starts. */
const SHOULDER_HEIGHT_RATIO = 0.82;
/** Bottom of the torso, where the hips start. */
const WAIST_HEIGHT_RATIO = 0.54;
/** Bottom of the hips. */
const HIPS_BOTTOM_HEIGHT_RATIO = 0.44;
/** Top of the legs, hidden inside the hips. */
const LEG_TOP_HEIGHT_RATIO = 0.47;
/** Top of the arms, just below the shoulder line. */
const ARM_TOP_HEIGHT_RATIO = 0.81;
/** Bottom of the arms (the hands). */
const ARM_BOTTOM_HEIGHT_RATIO = 0.44;

const TORSO_WIDTH_RATIO = 0.16;
const TORSO_DEPTH_RATIO = 0.1;
const HIPS_WIDTH_RATIO = 0.15;
const HIPS_DEPTH_RATIO = 0.09;
const NECK_RADIUS_RATIO = 0.025;
const ARM_RADIUS_RATIO = 0.025;
const LEG_RADIUS_RATIO = 0.035;
/** Distance of each leg's axis from the body's centre line. */
const LEG_OFFSET_RATIO = 0.045;

/** Height of the facing marker's centre: the visor sits across the eyes. */
const VISOR_HEIGHT_RATIO = 0.93;
const VISOR_WIDTH_RATIO = 0.04;
const VISOR_THICKNESS_RATIO = 0.02;
const VISOR_DEPTH_RATIO = 0.03;

/** Sign of x on the person's left (−x when facing −z). */
const LEFT_SIDE = -1;
/** Sign of x on the person's right (+x when facing −z). */
const RIGHT_SIDE = 1;
/** Sign of z in front of the person (−z). */
const FRONT = -1;

/**
 * Builds a frozen centre point.
 *
 * @param x - Position along x, in metres.
 * @param y - Height, in metres.
 * @param z - Position along z, in metres.
 * @returns A frozen {@link ScenePoint}.
 */
function point(x: number, y: number, z: number): ScenePoint {
  return Object.freeze({ x, y, z });
}

/**
 * Builds a frozen upright capsule spanning `[bottom, top]` on y.
 *
 * @returns A frozen capsule part whose caps touch `bottom` and `top`.
 */
function uprightCapsule(
  name: string,
  x: number,
  bottom: number,
  top: number,
  radius: number,
): MannequinCapsulePart {
  return Object.freeze({
    name,
    role: 'body',
    shape: 'capsule',
    radius,
    length: top - bottom - DIAMETER_PER_RADIUS * radius,
    position: point(x, (bottom + top) * HALF, PLAN_CENTRE),
  });
}

/**
 * Builds a frozen box part centred on the plan origin and spanning `[bottom, top]` on y.
 *
 * @returns A frozen box part.
 */
function centredBox(
  name: string,
  bottom: number,
  top: number,
  width: number,
  depth: number,
): MannequinBoxPart {
  return Object.freeze({
    name,
    role: 'body',
    shape: 'box',
    size: Object.freeze({ width, height: top - bottom, depth }),
    position: point(PLAN_CENTRE, (bottom + top) * HALF, PLAN_CENTRE),
  });
}

/**
 * Returns the parts of a low-poly mannequin of the given standing height.
 *
 * Legs, hips, torso, arms, neck and head make up the body; a dark visor across the eyes
 * on the front (−z) marks where the person faces. The head is one eighth of the height
 * and its top reaches `height`; the lowest point (the feet) is at y 0.
 *
 * @param height - Standing height, in metres.
 * @returns A frozen array of frozen parts, body first and the facing marker last.
 * @throws RangeError when `height` is not a finite number greater than 0.
 */
export function getMannequinParts(height: number): readonly MannequinPart[] {
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(
      `Mannequin height must be a finite number greater than 0, got ${String(height)}`,
    );
  }

  const headRadius = HEAD_RADIUS_RATIO * height;
  const headBottom = height - DIAMETER_PER_RADIUS * headRadius;
  const shoulder = SHOULDER_HEIGHT_RATIO * height;
  const waist = WAIST_HEIGHT_RATIO * height;
  const hipsBottom = HIPS_BOTTOM_HEIGHT_RATIO * height;
  const legTop = LEG_TOP_HEIGHT_RATIO * height;
  const legRadius = LEG_RADIUS_RATIO * height;
  const legOffset = LEG_OFFSET_RATIO * height;
  const armRadius = ARM_RADIUS_RATIO * height;
  const armOffset = TORSO_WIDTH_RATIO * height * HALF + armRadius;
  const armTop = ARM_TOP_HEIGHT_RATIO * height;
  const armBottom = ARM_BOTTOM_HEIGHT_RATIO * height;
  const visorDepth = VISOR_DEPTH_RATIO * height;

  const parts: readonly MannequinPart[] = [
    uprightCapsule('leftLeg', LEFT_SIDE * legOffset, 0, legTop, legRadius),
    uprightCapsule('rightLeg', RIGHT_SIDE * legOffset, 0, legTop, legRadius),
    centredBox('hips', hipsBottom, waist, HIPS_WIDTH_RATIO * height, HIPS_DEPTH_RATIO * height),
    centredBox('torso', waist, shoulder, TORSO_WIDTH_RATIO * height, TORSO_DEPTH_RATIO * height),
    uprightCapsule('leftArm', LEFT_SIDE * armOffset, armBottom, armTop, armRadius),
    uprightCapsule('rightArm', RIGHT_SIDE * armOffset, armBottom, armTop, armRadius),
    Object.freeze({
      name: 'neck',
      role: 'body',
      shape: 'cylinder',
      radius: NECK_RADIUS_RATIO * height,
      length: headBottom - shoulder,
      position: point(PLAN_CENTRE, (headBottom + shoulder) * HALF, PLAN_CENTRE),
    }),
    Object.freeze({
      name: 'head',
      role: 'body',
      shape: 'sphere',
      radius: headRadius,
      position: point(PLAN_CENTRE, height - headRadius, PLAN_CENTRE),
    }),
    Object.freeze({
      name: 'visor',
      role: 'facingMarker',
      shape: 'box',
      size: Object.freeze({
        width: VISOR_WIDTH_RATIO * height,
        height: VISOR_THICKNESS_RATIO * height,
        depth: visorDepth,
      }),
      position: point(PLAN_CENTRE, VISOR_HEIGHT_RATIO * height, FRONT * headRadius),
    }),
  ];
  return Object.freeze(parts);
}

/**
 * Half of a part's size along each axis, in metres: the part spans
 * `position ± halfExtent` on every axis.
 *
 * @param part - The mannequin part to measure.
 * @returns The half sizes along x, y and z.
 */
export function getMannequinPartHalfExtent(part: MannequinPart): ScenePoint {
  switch (part.shape) {
    case 'box':
      return {
        x: part.size.width * HALF,
        y: part.size.height * HALF,
        z: part.size.depth * HALF,
      };
    case 'capsule':
      return { x: part.radius, y: part.length * HALF + part.radius, z: part.radius };
    case 'sphere':
      return { x: part.radius, y: part.radius, z: part.radius };
    case 'cylinder':
      return { x: part.radius, y: part.length * HALF, z: part.radius };
  }
}

/**
 * Whether the person model is shown: only in the third-person view, and only while the
 * follow camera stands far enough from the person (see `shouldHidePersonModel`). The camera
 * rises above the person when a wall is close behind, so the model stays visible there.
 *
 * @param cameraMode - The current interior camera mode.
 * @param pose - The person's pose. Not mutated.
 * @param roomBox - The box the follow camera stays inside.
 * @returns `true` when the mannequin should be rendered.
 */
export function isPersonModelVisible(
  cameraMode: InteriorCameraMode,
  pose: EyePose,
  roomBox: CameraRoomBox,
): boolean {
  return (
    cameraMode === 'thirdPerson' && !shouldHidePersonModel(getThirdPersonCamera(pose, roomBox))
  );
}
