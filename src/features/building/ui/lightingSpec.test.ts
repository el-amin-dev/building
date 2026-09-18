import { describe, expect, it } from 'vitest';
import { getExteriorFraming } from '../domain/exteriorFraming.ts';
import type { ExteriorFraming } from '../domain/exteriorFraming.ts';
import { PLOT_RECT } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import {
  getLightingSpec,
  getSunDistance,
  getSunPosition,
  SCENE_LIGHT_COUNT,
  SUN_AZIMUTH_FROM_B_DEGREES,
  SUN_DISTANCE_FACTOR,
  SUN_ELEVATION_DEGREES,
} from './lightingSpec.ts';
import type { LightingSpec, LightingView } from './lightingSpec.ts';

/** Decimal digits two lengths must share to count as equal (sub-nanometre). */
const PRECISION_DIGITS = 9;

/** Field of view and aspect of the app's camera (see `BuildingScene`). */
const FOV_DEGREES = 50;
const WIDESCREEN_ASPECT = 16 / 9;

/** The single designed floor on its own: the count the app opens on. */
const SINGLE_STOREY = 1;

const FRAMING = getExteriorFraming(
  PLOT_RECT,
  FLOOR_HEIGHTS,
  FOV_DEGREES,
  WIDESCREEN_ASPECT,
  SINGLE_STOREY,
);
const SUN_DISTANCE = getSunDistance(FRAMING);

/** Both views, so every property is checked on each of them. */
const VIEWS: readonly LightingView[] = ['exterior', 'interior'];

/**
 * The intensity fields of the spec: exactly one per light. Their count is therefore the
 * number of lights the spec describes, and it must equal {@link SCENE_LIGHT_COUNT}.
 */
const INTENSITY_KEYS = ['sunIntensity', 'hemisphereIntensity', 'ambientIntensity'] as const;

const STRAIGHT_UP_DEGREES = 90;
const HORIZON_DEGREES = 0;
/** Straight out from side B, with no offset toward side A. */
const FROM_B_DEGREES = 0;
/** A round distance, so the expected coordinates are easy to read. */
const TEST_DISTANCE_METRES = 10;
const ORIGIN_COORDINATE = 0;

const NOT_A_NUMBER = Number.NaN;
const INFINITE = Number.POSITIVE_INFINITY;
const NEGATIVE_INFINITE = Number.NEGATIVE_INFINITY;
const ZERO_DISTANCE = 0;
const NEGATIVE_DISTANCE = -TEST_DISTANCE_METRES;
/** A view value that is neither of the two supported ones, as it could arrive at runtime. */
const UNKNOWN_VIEW = 'overhead' as unknown as LightingView;

const EXTERIOR = getLightingSpec('exterior', FRAMING);
const INTERIOR = getLightingSpec('interior', FRAMING);

/**
 * Collects every number the spec holds, including the sun's coordinates, with a readable
 * path for each, so a table test can check them all at once.
 *
 * @param spec - The spec to flatten.
 * @returns One `[path, value]` pair per numeric field.
 */
function numbersOf(spec: LightingSpec): readonly [string, number][] {
  const { sunPosition, ...fields } = spec;
  const flat: [string, unknown][] = [
    ...Object.entries(fields),
    ['sunPosition.x', sunPosition.x],
    ['sunPosition.y', sunPosition.y],
    ['sunPosition.z', sunPosition.z],
  ];
  return flat.filter((entry): entry is [string, number] => typeof entry[1] === 'number');
}

describe('getSunPosition', () => {
  it('puts the sun straight overhead at 90° of elevation, whatever the azimuth', () => {
    const position = getSunPosition(
      STRAIGHT_UP_DEGREES,
      SUN_AZIMUTH_FROM_B_DEGREES,
      TEST_DISTANCE_METRES,
    );

    expect(position.x).toBeCloseTo(ORIGIN_COORDINATE, PRECISION_DIGITS);
    expect(position.z).toBeCloseTo(ORIGIN_COORDINATE, PRECISION_DIGITS);
    expect(position.y).toBeCloseTo(TEST_DISTANCE_METRES, PRECISION_DIGITS);
  });

  it('puts the sun on +z, straight out from side B, at the horizon and azimuth 0', () => {
    const position = getSunPosition(HORIZON_DEGREES, FROM_B_DEGREES, TEST_DISTANCE_METRES);

    expect(position.x).toBeCloseTo(ORIGIN_COORDINATE, PRECISION_DIGITS);
    expect(position.y).toBeCloseTo(ORIGIN_COORDINATE, PRECISION_DIGITS);
    expect(position.z).toBeCloseTo(TEST_DISTANCE_METRES, PRECISION_DIGITS);
  });

  it('tilts the default azimuth toward −x while keeping +z dominant', () => {
    const straight = getSunPosition(SUN_ELEVATION_DEGREES, FROM_B_DEGREES, TEST_DISTANCE_METRES).z;
    const position = getSunPosition(
      SUN_ELEVATION_DEGREES,
      SUN_AZIMUTH_FROM_B_DEGREES,
      TEST_DISTANCE_METRES,
    );

    expect(position.x).toBeLessThan(ORIGIN_COORDINATE);
    expect(position.y).toBeGreaterThan(ORIGIN_COORDINATE);
    expect(position.z).toBeGreaterThan(ORIGIN_COORDINATE);
    expect(Math.abs(position.x)).toBeLessThan(position.z);
    expect(position.z).toBeLessThan(straight);
  });

  it.each([
    ['the horizon straight out from side B', HORIZON_DEGREES, FROM_B_DEGREES],
    ['the default sun', SUN_ELEVATION_DEGREES, SUN_AZIMUTH_FROM_B_DEGREES],
    ['the zenith', STRAIGHT_UP_DEGREES, FROM_B_DEGREES],
    ['a low sun behind side A', 12, -170],
    ['a sun over side A', 30, 180],
  ])('keeps the vector length at the distance for %s', (_label, elevation, azimuth) => {
    const position = getSunPosition(elevation, azimuth, TEST_DISTANCE_METRES);

    expect(Math.hypot(position.x, position.y, position.z)).toBeCloseTo(
      TEST_DISTANCE_METRES,
      PRECISION_DIGITS,
    );
  });

  it('freezes the position', () => {
    expect(
      Object.isFrozen(
        getSunPosition(SUN_ELEVATION_DEGREES, SUN_AZIMUTH_FROM_B_DEGREES, TEST_DISTANCE_METRES),
      ),
    ).toBe(true);
  });

  it.each([
    ['a NaN elevation', NOT_A_NUMBER, FROM_B_DEGREES, TEST_DISTANCE_METRES, 'elevationDegrees'],
    ['an infinite elevation', INFINITE, FROM_B_DEGREES, TEST_DISTANCE_METRES, 'elevationDegrees'],
    ['a NaN azimuth', SUN_ELEVATION_DEGREES, NOT_A_NUMBER, TEST_DISTANCE_METRES, 'azimuthDegrees'],
    [
      'an infinite azimuth',
      SUN_ELEVATION_DEGREES,
      NEGATIVE_INFINITE,
      TEST_DISTANCE_METRES,
      'azimuthDegrees',
    ],
    ['a NaN distance', SUN_ELEVATION_DEGREES, FROM_B_DEGREES, NOT_A_NUMBER, 'distance'],
    ['an infinite distance', SUN_ELEVATION_DEGREES, FROM_B_DEGREES, INFINITE, 'distance'],
    ['a zero distance', SUN_ELEVATION_DEGREES, FROM_B_DEGREES, ZERO_DISTANCE, 'distance'],
    ['a negative distance', SUN_ELEVATION_DEGREES, FROM_B_DEGREES, NEGATIVE_DISTANCE, 'distance'],
  ])('rejects %s', (_label, elevation, azimuth, distance, argument) => {
    expect(() => getSunPosition(elevation, azimuth, distance)).toThrow(RangeError);
    expect(() => getSunPosition(elevation, azimuth, distance)).toThrow(String(argument));
  });
});

describe('getSunDistance', () => {
  it('places the sun at its factor of the framing’s far fog distance', () => {
    expect(SUN_DISTANCE).toBeCloseTo(FRAMING.fogFar * SUN_DISTANCE_FACTOR, PRECISION_DIGITS);
    expect(SUN_DISTANCE).toBeGreaterThan(FRAMING.maxDistance);
  });
});

describe('getLightingSpec', () => {
  it.each(VIEWS)('freezes the %s spec and its sun position', (view) => {
    const spec = getLightingSpec(view, FRAMING);

    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.sunPosition)).toBe(true);
  });

  it('describes the same three lights in both views', () => {
    expect(INTENSITY_KEYS).toHaveLength(SCENE_LIGHT_COUNT);
    expect(Object.keys(INTERIOR)).toStrictEqual(Object.keys(EXTERIOR));
    for (const key of INTENSITY_KEYS) {
      expect(EXTERIOR[key]).toBeGreaterThan(0);
      expect(INTERIOR[key]).toBeGreaterThan(0);
    }
  });

  it('keeps the same sun and the same colours in both views', () => {
    const expected = getSunPosition(
      SUN_ELEVATION_DEGREES,
      SUN_AZIMUTH_FROM_B_DEGREES,
      SUN_DISTANCE,
    );

    expect(EXTERIOR.sunPosition).toStrictEqual(expected);
    expect(INTERIOR.sunPosition).toStrictEqual(EXTERIOR.sunPosition);
    expect(INTERIOR.sunIntensity).toBe(EXTERIOR.sunIntensity);
    expect(INTERIOR.sunColor).toBe(EXTERIOR.sunColor);
    expect(INTERIOR.skyColor).toBe(EXTERIOR.skyColor);
    expect(INTERIOR.groundColor).toBe(EXTERIOR.groundColor);
  });

  it('puts the real floor’s sun above the horizon, out past side B and toward side A', () => {
    const { x, y, z } = EXTERIOR.sunPosition;

    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
    expect(x).toBeLessThan(0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(SUN_DISTANCE, PRECISION_DIGITS);
    expect(y).toBeGreaterThan(FLOOR_HEIGHTS.wall);
  });

  it('brightens the fill inside, where there is neither a shadow nor a point light', () => {
    expect(INTERIOR.hemisphereIntensity).toBeGreaterThan(EXTERIOR.hemisphereIntensity);
    expect(INTERIOR.ambientIntensity).toBeGreaterThan(EXTERIOR.ambientIntensity);
  });

  it.each(VIEWS)('takes the fog range of the %s view from the framing', (view) => {
    const spec = getLightingSpec(view, FRAMING);

    expect(spec.fogNear).toBe(FRAMING.fogNear);
    expect(spec.fogFar).toBe(FRAMING.fogFar);
    expect(spec.fogNear).toBeLessThan(spec.fogFar);
  });

  it('rejects an unknown view', () => {
    expect(() => getLightingSpec(UNKNOWN_VIEW, FRAMING)).toThrow(RangeError);
    expect(() => getLightingSpec(UNKNOWN_VIEW, FRAMING)).toThrow('view');
  });

  it.each([
    ['NaN', NOT_A_NUMBER],
    ['infinite', INFINITE],
    ['zero', ZERO_DISTANCE],
  ])('rejects a framing whose far fog distance is %s', (_label, fogFar) => {
    const framing: ExteriorFraming = { ...FRAMING, fogFar };

    expect(() => getLightingSpec('exterior', framing)).toThrow(RangeError);
  });

  it.each(VIEWS)('holds no NaN anywhere in the %s spec', (view) => {
    const spec = getLightingSpec(view, FRAMING);

    for (const [path, value] of numbersOf(spec)) {
      expect(Number.isFinite(value), path).toBe(true);
    }
  });
});
