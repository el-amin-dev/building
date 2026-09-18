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

/**
 * Neutral value of every intensity factor: the spec of the current view, unscaled.
 *
 * This is the seed of all three factors, in both views — see the note on Leva's store in
 * {@link SceneLighting} for why no control may be seeded from a view-dependent value.
 */
const NEUTRAL_FACTOR = 1;
/** Smallest factor: the light fully off, to check the others on their own. */
const FACTOR_MIN = 0;
/** Largest factor: well past blown-out, to find the ceiling of a light. */
const FACTOR_MAX = 3;
const FACTOR_STEP = 0.05;

/** The sun stays above the horizon: below it, the whole floor is unlit. */
const ELEVATION_MIN_DEGREES = 0;
/** Straight overhead. */
const ELEVATION_MAX_DEGREES = 90;
const ELEVATION_STEP_DEGREES = 1;

/** A full turn around the floor, so the sun can be tried on every side. */
const AZIMUTH_MIN_DEGREES = -180;
const AZIMUTH_MAX_DEGREES = 180;
const AZIMUTH_STEP_DEGREES = 1;

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
 * sun and the ambient term — exactly `SCENE_LIGHT_COUNT` lights, in both views and at
 * every storey count. A view change alters intensities only, and a storey change alters
 * nothing at all here: the number of lights is compiled into every material's shader, so
 * adding or removing one would recompile every program in the scene — on a stepper, once
 * per press (see `lightingSpec.ts` for the full reasoning, including why per-room light is
 * delivered as emissive ceiling panels instead of point lights, and why shadows wait for
 * Part 4).
 *
 * The building's height reaches this component only through the `framing` prop: the fog
 * range and the sun's distance are the framing's own, so a taller stack is lit and fogged
 * correctly without a single storey-dependent value being read here.
 *
 * The fog is coloured like the sky, so the ground plane fades into the horizon instead of
 * ending at a visible edge.
 *
 * Every intensity is `getLightingSpec(view)` times a factor from the debug panel, so the
 * rendered lighting is a function of `view` alone until a developer drags a control, and
 * the spec of the current view is applied on every view change. The factors are what the
 * panel owns, rather than the intensities themselves, because of how Leva's store works:
 *
 * - a control's value is created from its seed the first time the control is rendered and
 *   is never re-seeded afterwards. `addData` strips `value` out of the properties it
 *   overrides, even when a changed dependency array asks it to override, and
 *   `useValuesForPath` lets the store win over the fresh seed.
 * - a plain number input also survives unmounting: `disposePaths` only deletes special
 *   inputs, so the value outlives the component for the whole lifetime of the page.
 *
 * Seeding a control from a view-dependent intensity therefore pinned whichever view
 * rendered first onto the other one: entering the interior kept the exterior fill and
 * ambient term, and the same scene rendered with two different shadings depending only on
 * which view had mounted first — one stable image per page load, neither converging. All
 * three factors seed at {@link NEUTRAL_FACTOR} in both views, which removes that failure
 * mode by construction rather than repairing it after the fact: there is no view-dependent
 * value for the store to pin. `SceneLighting.test.tsx` holds that seeds stay
 * view-independent, against a mock that reproduces Leva's store faithfully.
 *
 * Two Leva folders tweak the lighting live: `Sun` (a factor on the sun and its two angles)
 * and `Sky` (the two hemisphere colours, both view-independent, and a factor on each fill).
 * A factor of {@link FACTOR_MIN} darkens a light completely but never removes it, so no
 * control can change the number of lights.
 *
 * @param props - {@link SceneLightingProps}
 * @returns The background, the fog and the three lights.
 */
export function SceneLighting({ view, framing }: SceneLightingProps) {
  const spec = getLightingSpec(view, framing);
  const sunDistance = getSunDistance(framing);

  // Both schemas are functions, which is what makes `useControls` return the
  // `[values, set, get]` tuple rather than the values alone, and both are deliberately given
  // no dependency list: nothing they seed depends on the view, so there is nothing to re-seed.
  const [sun] = useControls('Sun', () => ({
    intensityFactor: {
      value: NEUTRAL_FACTOR,
      min: FACTOR_MIN,
      max: FACTOR_MAX,
      step: FACTOR_STEP,
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
  }));

  const [sky] = useControls('Sky', () => ({
    skyColor: spec.skyColor,
    groundColor: spec.groundColor,
    hemisphereFactor: {
      value: NEUTRAL_FACTOR,
      min: FACTOR_MIN,
      max: FACTOR_MAX,
      step: FACTOR_STEP,
    },
    ambientFactor: {
      value: NEUTRAL_FACTOR,
      min: FACTOR_MIN,
      max: FACTOR_MAX,
      step: FACTOR_STEP,
    },
  }));

  const sunPosition = getSunPosition(sun.elevationDegrees, sun.azimuthDegrees, sunDistance);

  return (
    <>
      <color attach="background" args={[sky.skyColor]} />
      <fog attach="fog" args={[sky.skyColor, spec.fogNear, spec.fogFar]} />
      <hemisphereLight
        color={sky.skyColor}
        groundColor={sky.groundColor}
        intensity={spec.hemisphereIntensity * sky.hemisphereFactor}
      />
      <directionalLight
        position={[sunPosition.x, sunPosition.y, sunPosition.z]}
        color={spec.sunColor}
        intensity={spec.sunIntensity * sun.intensityFactor}
      />
      <ambientLight intensity={spec.ambientIntensity * sky.ambientFactor} />
    </>
  );
}
