import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getExteriorFraming } from './exteriorFraming.ts';
import type { ExteriorFraming } from './exteriorFraming.ts';
import { PLOT_RECT } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;

/** Field of view of the app's camera, in degrees (see `BuildingScene`). */
const FOV_DEGREES = 50;
/** A field of view wider than {@link FOV_DEGREES}, in degrees. */
const WIDE_FOV_DEGREES = 80;
/** Near and far planes of the app's camera, in metres (see `BuildingScene`). */
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;

const WIDESCREEN_ASPECT = 16 / 9;
const CLASSIC_ASPECT = 4 / 3;
/** A portrait viewport, narrower than it is tall: 400 × 800 CSS pixels. */
const PHONE_ASPECT = 400 / 800;

/** The framing factors of the module, restated so a change of tuning fails a test. */
const EXPECTED_ELEVATION_DEGREES = 40;
const EXPECTED_AZIMUTH_DEGREES = 25;
const EXPECTED_START_MARGIN = 1.1;
const EXPECTED_MIN_DISTANCE_FACTOR = 0.25;
const EXPECTED_MAX_DISTANCE_FACTOR = 2;
const EXPECTED_FOG_FAR_FACTOR = 2;
const EXPECTED_GROUND_SIZE_FACTOR = 2;

/** Distance from the orbit target to the furthest corner of the real floor box, in metres. */
const EXPECTED_RADIUS_METRES = 12.4211513154;
/** Fit distance of the real floor at {@link FOV_DEGREES} and {@link WIDESCREEN_ASPECT}, in metres. */
const EXPECTED_FIT_DISTANCE_METRES = 29.3909479071;
/** Start position of the real floor at {@link FOV_DEGREES} and {@link WIDESCREEN_ASPECT}, in metres. */
const EXPECTED_POSITION_X_METRES = 0.7833306635;
const EXPECTED_POSITION_Y_METRES = 22.1313508668;
const EXPECTED_POSITION_Z_METRES = 27.4458448269;

/** Factor by which the plot and the heights are scaled in the linearity test. */
const SCALE = 2;
/** Number of corners of a box. */
const BOX_CORNER_COUNT = 8;

const FRAMING = getExteriorFraming(PLOT_RECT, FLOOR_HEIGHTS, FOV_DEGREES, WIDESCREEN_ASPECT);

/** A plot with a positive width and depth, used as the base of the rejection cases. */
const VALID_PLOT = PLOT_RECT;
const INVERTED_PLOT_X: PlanRect = makeRect(PLOT_RECT.maxX, PLOT_RECT.minX, 0, PLOT_RECT.maxZ);
const INVERTED_PLOT_Z: PlanRect = makeRect(0, PLOT_RECT.maxX, PLOT_RECT.maxZ, PLOT_RECT.minZ);
const FLAT_PLOT_X: PlanRect = makeRect(0, 0, 0, PLOT_RECT.maxZ);
const NOT_A_NUMBER = Number.NaN;
const INFINITE = Number.POSITIVE_INFINITY;
const NEGATIVE_HEIGHT = -1;
const ZERO_HEIGHT = 0;
const NEGATIVE_ASPECT = -1;
const ZERO_ASPECT = 0;

/**
 * Scales a rectangle about the plan origin.
 *
 * @param rect - The rectangle to scale.
 * @param factor - The scale factor.
 * @returns A new frozen rectangle.
 */
function scaleRect(rect: PlanRect, factor: number): PlanRect {
  return makeRect(rect.minX * factor, rect.maxX * factor, rect.minZ * factor, rect.maxZ * factor);
}

/**
 * Scales the vertical sizes the framing is built from, leaving the others as they are.
 *
 * Only the floor-to-floor and wall heights bound the floor box, so scaling those two
 * scales the whole box; the remaining sizes are never read by the framing.
 *
 * @param heights - The heights to scale.
 * @param factor - The scale factor.
 * @returns New heights.
 */
function scaleHeights(heights: FloorHeights, factor: number): FloorHeights {
  return {
    ...heights,
    floorToFloor: heights.floorToFloor * factor,
    wall: heights.wall * factor,
  };
}

/**
 * Builds the box the floor occupies: the plot on the plan, the slab bottom to the wall top
 * vertically. Derived here independently of the module under test.
 *
 * @param plot - Outer boundary of the floor.
 * @param heights - Vertical sizes of the floor.
 * @returns The floor box in scene coordinates.
 */
function floorBox(plot: PlanRect, heights: FloorHeights): Box3 {
  return new Box3(
    new Vector3(plot.minX, -(heights.floorToFloor - heights.wall), plot.minZ),
    new Vector3(plot.maxX, heights.wall, plot.maxZ),
  );
}

/**
 * Lists the eight corners of a box.
 *
 * @param box - The box.
 * @returns Its corners, in no particular order.
 */
function cornersOf(box: Box3): readonly Vector3[] {
  const corners: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corners.push(new Vector3(x, y, z));
      }
    }
  }
  return corners;
}

/**
 * Builds the view frustum of a camera placed by a framing.
 *
 * @param framing - The framing to place the camera with.
 * @param aspect - Aspect ratio of the canvas.
 * @param fovDegrees - Vertical field of view, in degrees.
 * @returns The frustum of that camera.
 */
function frustumOf(framing: ExteriorFraming, aspect: number, fovDegrees: number): Frustum {
  const camera = new PerspectiveCamera(fovDegrees, aspect, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(framing.position.x, framing.position.y, framing.position.z);
  camera.lookAt(framing.target.x, framing.target.y, framing.target.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

/**
 * Distance from the orbit target to the start position.
 *
 * @param framing - The framing to measure.
 * @returns The Euclidean length of position − target, in metres.
 */
function startDistance(framing: ExteriorFraming): number {
  const { position, target } = framing;
  return Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
}

describe('exteriorFraming', () => {
  describe('getExteriorFraming for the real floor', () => {
    it('targets the centre of the plot at half the wall height', () => {
      expect(FRAMING.target.x).toBeCloseTo(
        (PLOT_RECT.minX + PLOT_RECT.maxX) * HALF,
        PRECISION_DIGITS,
      );
      expect(FRAMING.target.y).toBeCloseTo(FLOOR_HEIGHTS.wall * HALF, PRECISION_DIGITS);
      expect(FRAMING.target.z).toBeCloseTo(
        (PLOT_RECT.minZ + PLOT_RECT.maxZ) * HALF,
        PRECISION_DIGITS,
      );
    });

    it('fits the floor at the distance its bounding radius and field of view require', () => {
      const box = floorBox(PLOT_RECT, FLOOR_HEIGHTS);
      const target = new Vector3(FRAMING.target.x, FRAMING.target.y, FRAMING.target.z);
      const radius = Math.max(...cornersOf(box).map((corner) => corner.distanceTo(target)));
      const halfFovVertical = FOV_DEGREES * HALF * RADIANS_PER_DEGREE;
      const halfFovHorizontal = Math.atan(Math.tan(halfFovVertical) * WIDESCREEN_ASPECT);
      const expected = radius / Math.sin(Math.min(halfFovVertical, halfFovHorizontal));

      expect(radius).toBeCloseTo(EXPECTED_RADIUS_METRES, PRECISION_DIGITS);
      expect(FRAMING.fitDistance).toBeCloseTo(expected, PRECISION_DIGITS);
      expect(FRAMING.fitDistance).toBeCloseTo(EXPECTED_FIT_DISTANCE_METRES, PRECISION_DIGITS);
    });

    it('starts above and beside the open side B, a margin beyond the fit distance', () => {
      const offsetX = FRAMING.position.x - FRAMING.target.x;
      const offsetY = FRAMING.position.y - FRAMING.target.y;
      const offsetZ = FRAMING.position.z - FRAMING.target.z;
      const elevation = Math.atan2(offsetY, Math.hypot(offsetX, offsetZ));
      const azimuth = Math.atan2(-offsetX, offsetZ);

      expect(startDistance(FRAMING)).toBeCloseTo(
        FRAMING.fitDistance * EXPECTED_START_MARGIN,
        PRECISION_DIGITS,
      );
      expect(elevation).toBeCloseTo(
        EXPECTED_ELEVATION_DEGREES * RADIANS_PER_DEGREE,
        PRECISION_DIGITS,
      );
      expect(azimuth).toBeCloseTo(EXPECTED_AZIMUTH_DEGREES * RADIANS_PER_DEGREE, PRECISION_DIGITS);
      expect(FRAMING.position.x).toBeCloseTo(EXPECTED_POSITION_X_METRES, PRECISION_DIGITS);
      expect(FRAMING.position.y).toBeCloseTo(EXPECTED_POSITION_Y_METRES, PRECISION_DIGITS);
      expect(FRAMING.position.z).toBeCloseTo(EXPECTED_POSITION_Z_METRES, PRECISION_DIGITS);
    });

    it('brackets the fit distance with the zoom limits', () => {
      expect(FRAMING.minDistance).toBeCloseTo(
        FRAMING.fitDistance * EXPECTED_MIN_DISTANCE_FACTOR,
        PRECISION_DIGITS,
      );
      expect(FRAMING.maxDistance).toBeCloseTo(
        FRAMING.fitDistance * EXPECTED_MAX_DISTANCE_FACTOR,
        PRECISION_DIGITS,
      );
      expect(FRAMING.minDistance).toBeLessThan(FRAMING.fitDistance);
      expect(FRAMING.fitDistance).toBeLessThan(FRAMING.maxDistance);
    });

    it('starts the fog past the floor at the furthest allowed zoom', () => {
      expect(FRAMING.fogNear).toBeCloseTo(
        FRAMING.maxDistance + EXPECTED_RADIUS_METRES,
        PRECISION_DIGITS,
      );
      expect(FRAMING.fogNear).toBeGreaterThan(FRAMING.maxDistance);
      expect(FRAMING.fogFar).toBeCloseTo(
        FRAMING.fogNear * EXPECTED_FOG_FAR_FACTOR,
        PRECISION_DIGITS,
      );
      expect(FRAMING.groundSize).toBeCloseTo(
        FRAMING.fogFar * EXPECTED_GROUND_SIZE_FACTOR,
        PRECISION_DIGITS,
      );
      expect(FRAMING.groundSize).toBeGreaterThan(FRAMING.fogFar);
    });

    it('is deeply frozen', () => {
      expect(Object.isFrozen(FRAMING)).toBe(true);
      expect(Object.isFrozen(FRAMING.target)).toBe(true);
      expect(Object.isFrozen(FRAMING.position)).toBe(true);
    });
  });

  describe('getExteriorFraming keeps the whole floor in frame', () => {
    it.each([
      ['widescreen', WIDESCREEN_ASPECT],
      ['classic', CLASSIC_ASPECT],
      ['portrait phone', PHONE_ASPECT],
    ] as const)('shows every corner of the floor on a %s viewport', (_label, aspect) => {
      const framing = getExteriorFraming(PLOT_RECT, FLOOR_HEIGHTS, FOV_DEGREES, aspect);
      const frustum = frustumOf(framing, aspect, FOV_DEGREES);
      const corners = cornersOf(floorBox(PLOT_RECT, FLOOR_HEIGHTS));

      expect(corners).toHaveLength(BOX_CORNER_COUNT);
      for (const corner of corners) {
        expect(frustum.containsPoint(corner)).toBe(true);
      }
    });

    it('pulls the camera further back on a portrait viewport than on a widescreen one', () => {
      const portrait = getExteriorFraming(PLOT_RECT, FLOOR_HEIGHTS, FOV_DEGREES, PHONE_ASPECT);

      expect(portrait.fitDistance).toBeGreaterThan(FRAMING.fitDistance);
    });

    it('needs a smaller distance with a wider field of view', () => {
      const wide = getExteriorFraming(
        PLOT_RECT,
        FLOOR_HEIGHTS,
        WIDE_FOV_DEGREES,
        WIDESCREEN_ASPECT,
      );

      expect(wide.fitDistance).toBeLessThan(FRAMING.fitDistance);
    });

    it('scales linearly with the size of the building', () => {
      const doubled = getExteriorFraming(
        scaleRect(PLOT_RECT, SCALE),
        scaleHeights(FLOOR_HEIGHTS, SCALE),
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
      );

      expect(doubled.fitDistance).toBeCloseTo(FRAMING.fitDistance * SCALE, PRECISION_DIGITS);
      expect(doubled.minDistance).toBeCloseTo(FRAMING.minDistance * SCALE, PRECISION_DIGITS);
      expect(doubled.maxDistance).toBeCloseTo(FRAMING.maxDistance * SCALE, PRECISION_DIGITS);
      expect(doubled.fogNear).toBeCloseTo(FRAMING.fogNear * SCALE, PRECISION_DIGITS);
      expect(doubled.fogFar).toBeCloseTo(FRAMING.fogFar * SCALE, PRECISION_DIGITS);
      expect(doubled.groundSize).toBeCloseTo(FRAMING.groundSize * SCALE, PRECISION_DIGITS);
      expect(doubled.target.x).toBeCloseTo(FRAMING.target.x * SCALE, PRECISION_DIGITS);
      expect(doubled.target.y).toBeCloseTo(FRAMING.target.y * SCALE, PRECISION_DIGITS);
      expect(doubled.target.z).toBeCloseTo(FRAMING.target.z * SCALE, PRECISION_DIGITS);
      expect(doubled.position.x).toBeCloseTo(FRAMING.position.x * SCALE, PRECISION_DIGITS);
      expect(doubled.position.y).toBeCloseTo(FRAMING.position.y * SCALE, PRECISION_DIGITS);
      expect(doubled.position.z).toBeCloseTo(FRAMING.position.z * SCALE, PRECISION_DIGITS);
    });
  });

  describe('getExteriorFraming rejections', () => {
    it.each([
      [
        'an inverted plot on x',
        INVERTED_PLOT_X,
        FLOOR_HEIGHTS,
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'plot',
      ],
      [
        'an inverted plot on z',
        INVERTED_PLOT_Z,
        FLOOR_HEIGHTS,
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'plot',
      ],
      ['a plot of zero width', FLAT_PLOT_X, FLOOR_HEIGHTS, FOV_DEGREES, WIDESCREEN_ASPECT, 'plot'],
      [
        'a non-finite plot coordinate',
        { ...VALID_PLOT, minX: NOT_A_NUMBER },
        FLOOR_HEIGHTS,
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'plot',
      ],
      [
        'an infinite plot coordinate',
        { ...VALID_PLOT, maxZ: INFINITE },
        FLOOR_HEIGHTS,
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'plot',
      ],
      [
        'a non-finite wall height',
        VALID_PLOT,
        { ...FLOOR_HEIGHTS, wall: NOT_A_NUMBER },
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'heights',
      ],
      [
        'a non-finite floor-to-floor height',
        VALID_PLOT,
        { ...FLOOR_HEIGHTS, floorToFloor: INFINITE },
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'heights',
      ],
      [
        'a wall height of zero',
        VALID_PLOT,
        { ...FLOOR_HEIGHTS, wall: ZERO_HEIGHT },
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'heights.wall',
      ],
      [
        'a negative wall height',
        VALID_PLOT,
        { ...FLOOR_HEIGHTS, wall: NEGATIVE_HEIGHT },
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'heights.wall',
      ],
      ['a field of view of zero', VALID_PLOT, FLOOR_HEIGHTS, 0, WIDESCREEN_ASPECT, 'fovDegrees'],
      [
        'a field of view of half a turn',
        VALID_PLOT,
        FLOOR_HEIGHTS,
        DEGREES_PER_HALF_TURN,
        WIDESCREEN_ASPECT,
        'fovDegrees',
      ],
      [
        'a negative field of view',
        VALID_PLOT,
        FLOOR_HEIGHTS,
        -FOV_DEGREES,
        WIDESCREEN_ASPECT,
        'fovDegrees',
      ],
      [
        'a non-finite field of view',
        VALID_PLOT,
        FLOOR_HEIGHTS,
        NOT_A_NUMBER,
        WIDESCREEN_ASPECT,
        'fovDegrees',
      ],
      ['an aspect of zero', VALID_PLOT, FLOOR_HEIGHTS, FOV_DEGREES, ZERO_ASPECT, 'aspect'],
      ['a negative aspect', VALID_PLOT, FLOOR_HEIGHTS, FOV_DEGREES, NEGATIVE_ASPECT, 'aspect'],
      ['a non-finite aspect', VALID_PLOT, FLOOR_HEIGHTS, FOV_DEGREES, NOT_A_NUMBER, 'aspect'],
      ['an infinite aspect', VALID_PLOT, FLOOR_HEIGHTS, FOV_DEGREES, INFINITE, 'aspect'],
    ] as const)('rejects %s', (_label, plot, heights, fovDegrees, aspect, named) => {
      expect(() => getExteriorFraming(plot, heights, fovDegrees, aspect)).toThrow(RangeError);
      expect(() => getExteriorFraming(plot, heights, fovDegrees, aspect)).toThrow(named);
    });
  });
});
