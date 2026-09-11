import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { RefObject } from 'react';
import type { Group } from 'three';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { PERSON_SPEC } from '../domain/person.ts';
import type { CameraRoomBox } from '../domain/thirdPersonCamera.ts';
import type { InteriorCameraMode } from '../domain/viewMode.ts';
import { getMannequinParts, isPersonModelVisible } from './personModelParts.ts';
import type { MannequinPart } from './personModelParts.ts';

/** Body colour: a mid slate, distinct from the light walls, the beige floor and the green ground. */
const BODY_COLOR = '#64748b';
/** Facing marker colour: a much darker slate, so the front of the head reads at a glance. */
const FACING_MARKER_COLOR = '#0f172a';
/** Feet on the finished floor. */
const FLOOR_LEVEL = 0;
/** Radial faces of capsules and cylinders: few, for a faceted low-poly look. */
const RADIAL_SEGMENTS = 8;
/** Curve segments of each capsule cap. */
const CAP_SEGMENTS = 3;
/** Horizontal faces of the head sphere. */
const SPHERE_WIDTH_SEGMENTS = 10;
/** Vertical faces of the head sphere. */
const SPHERE_HEIGHT_SEGMENTS = 7;

/** The mannequin of the 1.80 m person, computed once. */
const MANNEQUIN_PARTS = getMannequinParts(PERSON_SPEC.height);

/** Props of {@link PersonModel}. */
export interface PersonModelProps {
  /** The person's pose, stepped every frame by the interior camera controls. */
  readonly poseRef: RefObject<EyePose>;
  /** The box the third-person camera stays inside. */
  readonly roomBox: CameraRoomBox;
  /** The current interior camera mode; the model only shows in third person. */
  readonly cameraMode: InteriorCameraMode;
}

/**
 * Props of {@link MannequinGeometry}.
 */
interface MannequinGeometryProps {
  /** The part whose geometry is rendered. */
  readonly part: MannequinPart;
}

/** The three.js geometry matching a mannequin part's shape and sizes. */
function MannequinGeometry({ part }: MannequinGeometryProps) {
  switch (part.shape) {
    case 'box':
      return <boxGeometry args={[part.size.width, part.size.height, part.size.depth]} />;
    case 'capsule':
      return <capsuleGeometry args={[part.radius, part.length, CAP_SEGMENTS, RADIAL_SEGMENTS]} />;
    case 'sphere':
      return <sphereGeometry args={[part.radius, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS]} />;
    case 'cylinder':
      return <cylinderGeometry args={[part.radius, part.radius, part.length, RADIAL_SEGMENTS]} />;
  }
}

/**
 * Low-poly, flat-shaded mannequin of the 1.80 m person, shown in the third-person view.
 *
 * Built from `getMannequinParts(PERSON_SPEC.height)`: a neutral body and a darker visor on
 * the front of the head. Every frame it copies the pose from `poseRef` into its group
 * (feet on the floor at the pose's plan position, turned by the yaw; never pitched) and
 * sets the group's visibility with `isPersonModelVisible`: hidden in first person and
 * whenever the follow camera is pulled in too close. No React state changes per frame.
 *
 * @param props - {@link PersonModelProps}
 * @returns The mannequin group.
 */
export function PersonModel({ poseRef, roomBox, cameraMode }: PersonModelProps) {
  const groupRef = useRef<Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }
    const pose = poseRef.current;
    group.position.set(pose.x, FLOOR_LEVEL, pose.z);
    group.rotation.y = pose.yaw;
    group.visible = isPersonModelVisible(cameraMode, pose, roomBox);
  });

  return (
    <group ref={groupRef}>
      {MANNEQUIN_PARTS.map((part) => (
        <mesh key={part.name} position={[part.position.x, part.position.y, part.position.z]}>
          <MannequinGeometry part={part} />
          <meshStandardMaterial
            color={part.role === 'facingMarker' ? FACING_MARKER_COLOR : BODY_COLOR}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}
