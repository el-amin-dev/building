import { useControls } from 'leva';
import type { ExteriorFraming } from '../domain/exteriorFraming.ts';
import {
  getLightingSpec,
  getSunDistance,
  getSunPosition,
  SUN_AZIMUTH_FROM_B_DEGREES,
  SUN_ELEVATION_DEGREES,
} from './lightingSpec.ts';
import type { LightingView } from './lightingSpec.ts';

/** Smallest sun intensity the panel allows: fully off, to check the fill on its own. */
const SUN_INTENSITY_MIN = 0;
/** Largest sun intensity the panel allows: well past blown-out, to find the ceiling. */
const SUN_INTENSITY_MAX = 5;
const SUN_INTENSITY_STEP = 0.1;

/** The sun stays above the horizon: below it, the whole floor is unlit. */
const ELEVATION_MIN_DEGREES = 0;
/** Straight overhead. */
const ELEVATION_MAX_DEGREES = 90;
const ELEVATION_STEP_DEGREES = 1;

/** A full turn around the floor, so the sun can be tried on every side. */
const AZIMUTH_MIN_DEGREES = -180;
const AZIMUTH_MAX_DEGREES = 180;
const AZIMUTH_STEP_DEGREES = 1;

/** Fill intensities: off, up to well past the interior value. */
const FILL_INTENSITY_MIN = 0;
const FILL_INTENSITY_MAX = 3;
const FILL_INTENSITY_STEP = 0.05;

/** Props of {@link SceneLighting}. */
export interface SceneLightingProps {
  /** Which view is active; it changes intensities only, never the number of lights. */
  readonly view: LightingView;
  /** Exterior framing of the floor, for the fog range and the scale of the sun. */
  readonly framing: ExteriorFraming;
}

/**
 * Background, fog and the three lights of the whole-floor scene.
 *
 * Renders, in order: the scene background, the fog, the hemisphere fill, the directional
 * sun and the ambient term — exactly `SCENE_LIGHT_COUNT` lights, in both views. A view
 * change alters intensities only: the number of lights is compiled into every material's
 * shader, so adding or removing one would recompile every program in the scene (see
 * `lightingSpec.ts` for the full reasoning, including why per-room light is delivered as
 * emissive ceiling panels instead of point lights, and why shadows wait for Part 4).
 *
 * The fog is coloured like the sky, so the ground plane fades into the horizon instead of
 * ending at a visible edge.
 *
 * Two Leva folders tweak the lighting live: `Sun` (intensity and the two angles) and
 * `Sky` (the two hemisphere colours and the two fill intensities). Each control is seeded
 * from the spec of the current view — the schemas are functions with the seeds as
 * dependencies, so a view change re-seeds the panel rather than pinning the interior to
 * the exterior values — and each overrides exactly one uniform. No control can add or
 * remove a light.
 *
 * @param props - {@link SceneLightingProps}
 * @returns The background, the fog and the three lights.
 */
export function SceneLighting({ view, framing }: SceneLightingProps) {
  const spec = getLightingSpec(view, framing);
  const sunDistance = getSunDistance(framing);

  const [sun] = useControls(
    'Sun',
    () => ({
      intensity: {
        value: spec.sunIntensity,
        min: SUN_INTENSITY_MIN,
        max: SUN_INTENSITY_MAX,
        step: SUN_INTENSITY_STEP,
      },
      elevationDegrees: {
        value: SUN_ELEVATION_DEGREES,
        min: ELEVATION_MIN_DEGREES,
        max: ELEVATION_MAX_DEGREES,
        step: ELEVATION_STEP_DEGREES,
      },
      azimuthDegrees: {
        value: SUN_AZIMUTH_FROM_B_DEGREES,
        min: AZIMUTH_MIN_DEGREES,
        max: AZIMUTH_MAX_DEGREES,
        step: AZIMUTH_STEP_DEGREES,
      },
    }),
    [spec.sunIntensity],
  );

  const [sky] = useControls(
    'Sky',
    () => ({
      skyColor: spec.skyColor,
      groundColor: spec.groundColor,
      hemisphereIntensity: {
        value: spec.hemisphereIntensity,
        min: FILL_INTENSITY_MIN,
        max: FILL_INTENSITY_MAX,
        step: FILL_INTENSITY_STEP,
      },
      ambientIntensity: {
        value: spec.ambientIntensity,
        min: FILL_INTENSITY_MIN,
        max: FILL_INTENSITY_MAX,
        step: FILL_INTENSITY_STEP,
      },
    }),
    [spec.skyColor, spec.groundColor, spec.hemisphereIntensity, spec.ambientIntensity],
  );

  const sunPosition = getSunPosition(sun.elevationDegrees, sun.azimuthDegrees, sunDistance);

  return (
    <>
      <color attach="background" args={[sky.skyColor]} />
      <fog attach="fog" args={[sky.skyColor, spec.fogNear, spec.fogFar]} />
      <hemisphereLight
        color={sky.skyColor}
        groundColor={sky.groundColor}
        intensity={sky.hemisphereIntensity}
      />
      <directionalLight
        position={[sunPosition.x, sunPosition.y, sunPosition.z]}
        color={spec.sunColor}
        intensity={sun.intensity}
      />
      <ambientLight intensity={sky.ambientIntensity} />
    </>
  );
}
