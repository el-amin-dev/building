import { useMemo } from 'react';
import { getChamberWalls, getClearRect, getOuterRect } from '../domain/chamber.ts';
import type { ChamberSpec } from '../domain/chamber.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import type { PlanRect } from '../domain/planGeometry.ts';

const HALF = 0.5;
const QUARTER_TURN = Math.PI * HALF;
const FACE_UP_ROTATION_X = -QUARTER_TURN;
const FACE_DOWN_ROTATION_X = QUARTER_TURN;
/** Lift of the floor slab above the ground plane, in metres, so the two surfaces never z-fight. */
const FLOOR_SLAB_LIFT = 0.01;
const FLOOR_COLOR = '#d6c7ae';
const CEILING_COLOR = '#f8fafc';
/** Distance of the interior light below the ceiling, in metres. */
const CEILING_LIGHT_DROP = 0.5;
const CEILING_LIGHT_INTENSITY = 4;

/** Centre and size of a plan rectangle, laid out for three.js (x/z). */
interface PlanLayout {
  readonly centerX: number;
  readonly centerZ: number;
  readonly width: number;
  readonly depth: number;
}

/** Computes the centre and size of a plan rectangle. */
function toLayout(rect: PlanRect): PlanLayout {
  return {
    centerX: (rect.minX + rect.maxX) * HALF,
    centerZ: (rect.minZ + rect.maxZ) * HALF,
    width: rect.maxX - rect.minX,
    depth: rect.maxZ - rect.minZ,
  };
}

/** Props of {@link ChamberModel}. */
export interface ChamberModelProps {
  /** Horizontal dimensions of the chamber, centred at the plan origin. */
  readonly spec: ChamberSpec;
  /** Whether the ceiling and its interior light are rendered (interior view only). */
  readonly showCeiling: boolean;
  /** Colour of the walls. */
  readonly wallColor: string;
}

/**
 * 3D model of a single rectangular chamber built from domain data.
 *
 * - A floor slab covers the outer envelope from `getOuterRect` (clear rectangle grown by
 *   the wall thickness), lifted slightly above the ground plane.
 * - One box per wall footprint from `getChamberWalls`, `FLOOR_HEIGHTS.wall` tall.
 * - When `showCeiling` is true, a downward-facing ceiling over the clear rectangle at
 *   wall height and a point light just below it; the exterior view leaves the top open.
 *
 * @param props - {@link ChamberModelProps}
 * @returns The chamber meshes and, in the interior view, its ceiling light.
 */
export function ChamberModel({ spec, showCeiling, wallColor }: ChamberModelProps) {
  const { walls, floor, ceiling } = useMemo(
    () => ({
      walls: getChamberWalls(spec).map(toLayout),
      floor: toLayout(getOuterRect(spec)),
      ceiling: toLayout(getClearRect(spec)),
    }),
    [spec],
  );

  return (
    <group>
      <mesh
        position={[floor.centerX, FLOOR_SLAB_LIFT, floor.centerZ]}
        rotation-x={FACE_UP_ROTATION_X}
      >
        <planeGeometry args={[floor.width, floor.depth]} />
        <meshStandardMaterial color={FLOOR_COLOR} />
      </mesh>

      {walls.map((wall, index) => (
        <mesh key={index} position={[wall.centerX, FLOOR_HEIGHTS.wall * HALF, wall.centerZ]}>
          <boxGeometry args={[wall.width, FLOOR_HEIGHTS.wall, wall.depth]} />
          <meshStandardMaterial color={wallColor} />
        </mesh>
      ))}

      {showCeiling && (
        <>
          <mesh
            position={[ceiling.centerX, FLOOR_HEIGHTS.wall, ceiling.centerZ]}
            rotation-x={FACE_DOWN_ROTATION_X}
          >
            <planeGeometry args={[ceiling.width, ceiling.depth]} />
            <meshStandardMaterial color={CEILING_COLOR} />
          </mesh>
          <pointLight
            position={[ceiling.centerX, FLOOR_HEIGHTS.wall - CEILING_LIGHT_DROP, ceiling.centerZ]}
            intensity={CEILING_LIGHT_INTENSITY}
          />
        </>
      )}
    </group>
  );
}
