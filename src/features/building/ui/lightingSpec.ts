/**
 * Lighting of the whole-floor scene, as pure data.
 *
 * The scene is lit by exactly {@link SCENE_LIGHT_COUNT} lights in every view: a
 * hemisphere fill (sky above, ground bounce below), one directional sun coming from
 * the open side B, and a low ambient term that keeps the faces turned away from the
 * sun from going black. This count is fixed on purpose:
 *
 * - three.js compiles the number of lights into every material's shader program, so
 *   adding or removing a light when the view toggles recompiles every program in the
 *   scene. That is a visible hitch, and it also destabilises the end-to-end tests,
 *   which wait for the canvas to settle before taking their measurements.
 * - a point light per room (16 of them) would be the dominant per-fragment cost in the
 *   headless software WebGL the end-to-end tests run on.
 *
 * The interior and the exterior therefore differ by uniform values only — intensities
 * and fog — never by the number of lights. What reads as "per-room light" is delivered
 * elsewhere, as emissive ceiling panels in the floor material palette: an emissive
 * material costs no light slot and no shader recompilation.
 *
 * The same rule holds against the storey stepper, and is the reason nothing here reads
 * the storey count. The height of the building reaches this module only through the
 * {@link ExteriorFraming} it is handed: the fog range is the framing's own `fogNear` and
 * `fogFar`, and the sun is placed at {@link getSunDistance}, a factor of that same
 * `fogFar`. Both already grow with the stack, so a ten-storey building is lit and fogged
 * correctly with no storey-dependent value — and, crucially, with the same three lights,
 * so pressing the stepper never recompiles a shader.
 *
 * No shadow maps in Part 2 (owner answer, 2026-09-11): shadows would need a light with
 * a shadow camera framing the whole floor, and their cost and quality are revisited in
 * Part 4. Without them the interior would read flat and dark, which is why the interior
 * variant raises the hemisphere and ambient intensities rather than adding a light.
 *
 * Coordinates follow the scene conventions: metres, `y` up, the plan on `x`/`z` (see
 * `domain/floorPlan/types.ts`). Angles are given in degrees at the constants and
 * converted to radians here. Lighting is presentation-only, so its factors live in this
 * UI module rather than in the domain.
 */

import type { ExteriorFraming } from '../domain/exteriorFraming.ts';

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;

/** Which view the scene is lit for. */
export type LightingView = 'exterior' | 'interior';

/**
 * Number of lights in the scene, in every view: the hemisphere fill, the sun and the
 * ambient term. Asserted by the tests of both this module and `SceneLighting`, so that
 * a light added to one view alone fails the suite.
 */
export const SCENE_LIGHT_COUNT = 3;

/**
 * Angle of the sun above the horizontal, in degrees.
 *
 * A late-morning sun: high enough to light the floor slabs and the tops of the walls,
 * low enough that the vertical faces on side B still catch a clearly stronger light than
 * the ones facing away, so the massing of the floor reads as depth rather than as a flat
 * elevation.
 */
export const SUN_ELEVATION_DEGREES = 55;

/**
 * Heading of the sun, in degrees, measured from +z (straight out from the open side B)
 * toward −x (toward side A).
 *
 * Side B is the open side of the floor (brief §1), so the sun comes from +z and reaches
 * inside. The offset toward side A tilts it so that one short end is lit as well as the
 * B faces, instead of lighting one facade head-on and leaving the ends uniformly flat.
 * The same offset as the exterior camera's heading, so the sun never sits exactly behind
 * the viewer (which would flatten the shading) nor exactly in front of it.
 */
export const SUN_AZIMUTH_FROM_B_DEGREES = 25;

/**
 * Factor from the framing's far fog distance to the distance of the sun from the origin.
 *
 * Only the *direction* matters for a directional light: three.js takes the vector from
 * the light's position to its target and ignores its length, so this factor never
 * changes the brightness. Half the fog distance keeps the sun well outside the floor —
 * so the Leva angles read as a sun position rather than as a lamp standing in a room —
 * while staying inside the scene's own scale, which keeps the numbers readable in the
 * debug panel and leaves room for a shadow camera to be framed around it in Part 4.
 */
export const SUN_DISTANCE_FACTOR = 0.5;

/**
 * Colour of the sky: the scene background, the upper half of the hemisphere fill and the
 * fog. The same light blue the exterior view has used from the start.
 */
const SKY_COLOR = '#bfdbfe';

/**
 * Colour of the lower half of the hemisphere fill: the light bouncing up off everything
 * below the horizon, and the **only** light a downward-facing face receives.
 *
 * That last part is why this constant is not a green. A directional light never touches a
 * face whose normal points away from it, and there are no shadow maps and no point lights,
 * so the light reaching a soffit — the underside of a slab, of a lintel, of a stair flight —
 * is this colour times the hemisphere intensity, plus the small white ambient term and
 * nothing else. Whatever hue is written here is painted onto every one of those faces
 * undiluted.
 *
 * Below the top storey the ceiling of a room *is* the slab of the storey above
 * (`ui/FloorModel.tsx`), so that soffit is the largest overhead surface in the building and
 * the most visible one in every interior view but the last. Lit by the muted sage this
 * constant used to hold, it measured `#7c7656` looking straight up in the circulation of a
 * three-storey stack — a dirty khaki at hue 51°, where the very same concrete seen underfoot
 * measures `#c0b9a9` at hue 42°. Nine degrees of green is the difference between a slab
 * soffit and olive paint.
 *
 * A pale warm concrete grey instead, near-neutral and light. It is still a bounce colour and
 * still dimmer and less saturated than what it bounces off; what changed is *which* surface
 * it is taken to bounce off. A hemisphere fill is one global approximation with no notion of
 * being indoors, and the faces that actually depend on it are inside the building, where the
 * light arriving at a soffit came off the screed underfoot (`ui/floorMaterials.ts`), not off
 * the lawn. The sage was never the lawn either: the ground plane is a deep `#166534`
 * (`ui/BuildingScene.tsx`), whose real bounce would be far darker and far greener than the
 * sage ever was — the constant was simply green because the ground is.
 *
 * Measured with the same reading that found the defect, looking straight up in a stack of
 * three: the soffit goes `#7c7656` → `#8e8066`, hue 51° → 39° against the screed's 42°, and
 * 0.65 → 0.74 of the screed's value, so it reads as that concrete in shadow rather than as a
 * colour of its own. The screed underfoot does not move by a single bit — `#c0b9a9` before
 * and after — because a face whose normal points straight up takes none of the ground half at
 * all, which is what makes this constant the surgical lever for the defect: it moves a face
 * only as far as that face tips below the horizontal. The top storey's ceiling, the one
 * overhead surface that is real ceiling white, comes with it, `#a3a99c` → `#b3b2ad`: it was
 * green for exactly the same reason.
 *
 * What is left over is the material's own chroma, not the light's: at a soffit's luminance
 * the same concrete is simply more saturated than it is underfoot, where the sun and the
 * tone mapping wash it out. Chasing the screed's saturation from here would mean lighting the
 * soffit almost as brightly as the floor, which is no longer a surface in shadow.
 *
 * It stays one colour for both views, and a constant: the `Sky` folder of the debug panel
 * seeds a colour picker from it, and ADR-009 allows a control to be seeded only from a value
 * that does not change for the life of the page.
 */
const GROUND_BOUNCE_COLOR = '#cdc6b8';

/** Colour of the sun: white with a trace of warmth, so lit faces read as daylight. */
const SUN_COLOR = '#fff6e5';

/**
 * Intensity of the sun, in both views: it is the same sun, and the interior is roofed
 * rather than moved to another time of day. Holding it constant also keeps the exterior
 * faces seen through the open side B lit consistently across a view change.
 */
const SUN_INTENSITY = 1.8;

/** Hemisphere fill outside: enough to open up the shaded faces without washing them out. */
const EXTERIOR_HEMISPHERE_INTENSITY = 0.6;

/** Ambient term outside: the last resort against black faces; the fill does the work. */
const EXTERIOR_AMBIENT_INTENSITY = 0.25;

/**
 * Hemisphere fill inside. Doubled, because a roofed interior with no shadow maps and no
 * point lights receives almost nothing from the sun: the fill and the ambient term are
 * what makes the rooms readable.
 */
const INTERIOR_HEMISPHERE_INTENSITY = 1.2;

/** Ambient term inside: raised with the fill, so ceilings and inner corners stay legible. */
const INTERIOR_AMBIENT_INTENSITY = 0.6;

/** A position, or the direction it stands for, in scene space; metres. */
export interface SunDirection {
  /** Coordinate along the plan width, in metres. */
  readonly x: number;
  /** Height above the finished floor, in metres. */
  readonly y: number;
  /** Coordinate along the plan depth, in metres. */
  readonly z: number;
}

/** Every value the scene lighting needs, for one view. */
export interface LightingSpec {
  /** Background, upper hemisphere and fog colour, as a CSS colour string. */
  readonly skyColor: string;
  /** Lower hemisphere colour — the ground bounce — as a CSS colour string. */
  readonly groundColor: string;
  /** Colour of the directional sun, as a CSS colour string. */
  readonly sunColor: string;
  /** Intensity of the directional sun. */
  readonly sunIntensity: number;
  /** Intensity of the hemisphere fill. */
  readonly hemisphereIntensity: number;
  /** Intensity of the ambient term. */
  readonly ambientIntensity: number;
  /** Where the sun stands; only its direction from the origin is used. */
  readonly sunPosition: SunDirection;
  /** Distance at which the fog starts, in metres; from the exterior framing. */
  readonly fogNear: number;
  /** Distance at which the fog is opaque, in metres; from the exterior framing. */
  readonly fogFar: number;
}

/**
 * Rejects an angle that is not a finite number.
 *
 * @param name - Name of the argument, for the error message.
 * @param degrees - The angle to check, in degrees.
 * @throws RangeError naming the argument when `degrees` is not finite.
 */
function assertFiniteAngle(name: string, degrees: number): void {
  if (!Number.isFinite(degrees)) {
    throw new RangeError(`${name} must be a finite number of degrees, got ${String(degrees)}`);
  }
}

/**
 * Places the sun on the sphere of radius `distance` around the origin.
 *
 * `elevationDegrees` is measured from the horizontal plane: 0 puts the sun on the
 * horizon, 90 straight overhead. `azimuthDegrees` is measured from +z — straight out
 * from the open side B — toward −x, matching the exterior camera's heading convention,
 * so the same angle means the same side of the building for the camera and for the sun.
 *
 * @param elevationDegrees - Angle above the horizontal, in degrees.
 * @param azimuthDegrees - Heading from +z toward −x, in degrees.
 * @param distance - Distance from the origin, in metres; only the direction is used by a
 *   directional light, but it must be a real length so the direction is defined.
 * @returns A frozen position at `distance` from the origin.
 * @throws RangeError naming the offending argument when `elevationDegrees` or
 *   `azimuthDegrees` is not finite, or when `distance` is not a finite positive number.
 */
export function getSunPosition(
  elevationDegrees: number,
  azimuthDegrees: number,
  distance: number,
): SunDirection {
  assertFiniteAngle('elevationDegrees', elevationDegrees);
  assertFiniteAngle('azimuthDegrees', azimuthDegrees);
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new RangeError(`distance must be a finite positive number, got ${String(distance)}`);
  }

  const elevation = elevationDegrees * RADIANS_PER_DEGREE;
  const azimuth = azimuthDegrees * RADIANS_PER_DEGREE;
  const horizontal = Math.cos(elevation) * distance;

  return Object.freeze({
    x: -Math.sin(azimuth) * horizontal,
    y: Math.sin(elevation) * distance,
    z: Math.cos(azimuth) * horizontal,
  });
}

/**
 * Distance at which the sun is placed for a given framing.
 *
 * Exported so that the debug panel can rebuild the sun's position from its own angles at
 * the very distance {@link getLightingSpec} used, instead of restating the factor.
 *
 * Derived from the framing's `fogFar`, so it scales with the building: a ten-storey stack
 * pushes the sun proportionally further out and it stays outside the fabric, exactly as it
 * does over the single floor. Nothing here has to know how many storeys there are.
 *
 * @param framing - The exterior framing of the building.
 * @returns The distance from the origin to the sun, in metres.
 */
export function getSunDistance(framing: ExteriorFraming): number {
  return framing.fogFar * SUN_DISTANCE_FACTOR;
}

/**
 * Returns the lighting of one view.
 *
 * Both views carry the same three lights, the same colours and the same sun direction;
 * the interior raises the hemisphere and ambient intensities, because a roofed interior
 * with no shadow maps and no point lights would otherwise read flat and dark. Fog comes
 * from the framing, which already derives a range that never touches the building at any
 * storey count.
 *
 * @param view - Which view the scene is lit for.
 * @param framing - The exterior framing of the building, for the fog range and the scale
 *   at which the sun is placed; it carries the height of the stack, so nothing here reads
 *   the storey count.
 * @returns A frozen spec, with a frozen sun position.
 * @throws RangeError when `view` is neither `'exterior'` nor `'interior'`, or when the
 *   framing's `fogFar` is not a finite positive number.
 */
export function getLightingSpec(view: LightingView, framing: ExteriorFraming): LightingSpec {
  if (view !== 'exterior' && view !== 'interior') {
    throw new RangeError(`view must be 'exterior' or 'interior', got ${String(view)}`);
  }
  const isInterior = view === 'interior';

  return Object.freeze({
    skyColor: SKY_COLOR,
    groundColor: GROUND_BOUNCE_COLOR,
    sunColor: SUN_COLOR,
    sunIntensity: SUN_INTENSITY,
    hemisphereIntensity: isInterior ? INTERIOR_HEMISPHERE_INTENSITY : EXTERIOR_HEMISPHERE_INTENSITY,
    ambientIntensity: isInterior ? INTERIOR_AMBIENT_INTENSITY : EXTERIOR_AMBIENT_INTENSITY,
    sunPosition: getSunPosition(
      SUN_ELEVATION_DEGREES,
      SUN_AZIMUTH_FROM_B_DEGREES,
      getSunDistance(framing),
    ),
    fogNear: framing.fogNear,
    fogFar: framing.fogFar,
  });
}
