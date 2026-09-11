import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useControls } from 'leva';

const CAMERA_FOV_DEGREES = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;
const CAMERA_INITIAL_POSITION: [number, number, number] = [14, 10, 18];
const SCENE_BACKGROUND_COLOR = '#bfdbfe';
const SCENE_DESCRIPTION =
  '3D view of the building. The camera moves by dragging and scrolling; keyboard camera controls are not available yet.';

const GROUND_SIZE = 120;
const GROUND_COLOR = '#86efac';
const GROUND_ROTATION_X = -Math.PI / 2;
const BUILDING_WIDTH = 8;
const BUILDING_HEIGHT = 12;
const BUILDING_DEPTH = 6;
const BUILDING_COLOR = '#e2e8f0';
const AMBIENT_LIGHT_INTENSITY = 0.6;
const SUN_INTENSITY = 1.8;
const SUN_INTENSITY_MAX = 5;
const SUN_INTENSITY_STEP = 0.1;
const SUN_POSITION: [number, number, number] = [20, 30, 15];
const ORBIT_MIN_DISTANCE = 6;
const ORBIT_MAX_DISTANCE = 80;
const ORBIT_GROUND_CLEARANCE_RADIANS = 0.05;
const ORBIT_MAX_POLAR_ANGLE = Math.PI / 2 - ORBIT_GROUND_CLEARANCE_RADIANS;

function SceneContent() {
  const { buildingColor, sunIntensity } = useControls('Scene', {
    buildingColor: BUILDING_COLOR,
    sunIntensity: {
      value: SUN_INTENSITY,
      min: 0,
      max: SUN_INTENSITY_MAX,
      step: SUN_INTENSITY_STEP,
    },
  });

  return (
    <>
      <color attach="background" args={[SCENE_BACKGROUND_COLOR]} />
      <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
      <directionalLight position={SUN_POSITION} intensity={sunIntensity} />

      <mesh rotation-x={GROUND_ROTATION_X}>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial color={GROUND_COLOR} />
      </mesh>

      <mesh position-y={BUILDING_HEIGHT / 2}>
        <boxGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color={buildingColor} />
      </mesh>

      <OrbitControls
        makeDefault
        target={[0, BUILDING_HEIGHT / 2, 0]}
        minDistance={ORBIT_MIN_DISTANCE}
        maxDistance={ORBIT_MAX_DISTANCE}
        maxPolarAngle={ORBIT_MAX_POLAR_ANGLE}
      />
    </>
  );
}

/**
 * Full-size 3D canvas with the placeholder building scene: ground plane, lights, a box
 * standing in for the building, and orbit camera controls (pointer only for now, see ADR-002).
 * A visually hidden description tells assistive technology what the canvas shows.
 *
 * @returns The scene description and canvas.
 */
export function BuildingScene() {
  return (
    <>
      <p className="sr-only">{SCENE_DESCRIPTION}</p>
      <Canvas
        className="absolute inset-0"
        camera={{
          fov: CAMERA_FOV_DEGREES,
          near: CAMERA_NEAR,
          far: CAMERA_FAR,
          position: CAMERA_INITIAL_POSITION,
        }}
      >
        <SceneContent />
      </Canvas>
    </>
  );
}
