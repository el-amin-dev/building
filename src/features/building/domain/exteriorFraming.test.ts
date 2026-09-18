import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_FAR } from '../ui/BuildingScene.tsx';
import { getExteriorFraming } from './exteriorFraming.ts';
import type { ExteriorFraming } from './exteriorFraming.ts';
import { PLOT_RECT } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import { makeRect } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { getSlabThickness } from './slabs.ts';
import { getBuildingTop } from './storeys.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;
const DEGREES_PER_HALF_TURN = 180;
const RADIANS_PER_DEGREE = Math.PI / DEGREES_PER_HALF_TURN;

/** Field of view of the app's camera, in degrees (see `BuildingScene`). */
const FOV_DEGREES = 50;
/** A field of view wider than {@link FOV_DEGREES}, in degrees. */
const WIDE_FOV_DEGREES = 80;
/** Near plane of the app's camera, in metres; the far plane is `BuildingScene`'s own. */
const CAMERA_NEAR = 0.1;

const WIDESCREEN_ASPECT = 16 / 9;
const CLASSIC_ASPECT = 4 / 3;
/** A portrait viewport, narrower than it is tall: 400 × 800 CSS pixels. */
const PHONE_ASPECT = 400 / 800;

/** The single designed floor on its own: the count the app opens on. */
const SINGLE_STOREY = 1;
/** A full stack: the most storeys the owner's stepper can reach, and the tallest case here. */
const TALL_STOREY = 10;
/** Top of the built fabric of a {@link TALL_STOREY} stack, in metres: 9 × 3.00 + 2.70. */
const TALL_TOP_METRES = 29.7;

/** The framing factors of the module, restated so a change of tuning fails a test. */
const EXPECTED_ELEVATION_DEGREES = 40;
const EXPECTED_AZIMUTH_DEGREES = 25;
const EXPECTED_START_MARGIN = 1.1;
const EXPECTED_MIN_DISTANCE_FACTOR = 0.25;
const EXPECTED_MAX_DISTANCE_FACTOR = 2;
const EXPECTED_FOG_FAR_FACTOR = 2;
const EXPECTED_GROUND_SIZE_FACTOR = 2;

/**
 * Distance from the orbit target to the furthest corner of the real floor box, in metres:
 * the radius of the bounding sphere, which the fog range is still offset by.
 */
const EXPECTED_RADIUS_METRES = 12.4211513154;
/** Fit distance of the real floor at {@link FOV_DEGREES} and {@link WIDESCREEN_ASPECT}, in metres. */
const EXPECTED_FIT_DISTANCE_METRES = 21.5638792112;
/**
 * Largest share of the sphere fit the box fit may cost, at {@link WIDESCREEN_ASPECT}.
 *
 * The floor is 22.50 × 10.00 m and 3.00 m tall, so the sphere around it is more than twice
 * as tall as the building: fitting the sphere wastes a quarter of the distance. Measured
 * 0.734 — 21.56 m against 29.39 m.
 */
const MAX_SPHERE_FIT_SHARE = 0.75;
/** Start position of the real floor at {@link FOV_DEGREES} and {@link WIDESCREEN_ASPECT}, in metres. */
const EXPECTED_POSITION_X_METRES = 3.5706970381;
const EXPECTED_POSITION_Y_METRES = 16.5970938111;
const EXPECTED_POSITION_Z_METRES = 21.4683183466;

/** Factor by which the plot and the heights are scaled in the linearity test. */
const SCALE = 2;
/** Number of corners of a box. */
const BOX_CORNER_COUNT = 8;
/** Width of the normalised device coordinate range on one axis: −1 to +1. */
const NDC_SPAN = 2;
/** Largest normalised device coordinate a point strictly inside the frustum may reach. */
const NDC_LIMIT = 1;

/**
 * Distances, as a share of the fit distance, either side of the exact fit.
 *
 * The fit must be the *smallest* distance that frames the whole box: a hair beyond it every
 * corner is in frame, a hair inside it at least one corner is not. The slack on the outer
 * side only keeps a corner that sits exactly on a frustum plane from failing on a rounding
 * error; the inner side is far enough in to be unambiguous.
 */
const JUST_BEYOND_FIT = 1 + 1e-9;
const JUST_INSIDE_FIT = 1 - 1e-6;

/**
 * Smallest share of the tighter axis of the frame the floor box must span at the start pose.
 *
 * This is what keeps the building from drifting back into the middle of an empty frame: a
 * fit that is too conservative shows up here as a smaller span, whichever axis binds. The
 * thresholds sit just under what the box fit measures — 0.690, 0.866 and 0.905 — and the
 * widescreen one is the honest floor rather than a round 0.7: with the orbit target pinned
 * to the centre of the plot and a {@link EXPECTED_START_MARGIN} of breathing room, the near
 * bottom corner of the floor reaches the bottom edge of a 16/9 frame while the far top
 * corner is still well inside the top one, and the two cannot both be pushed to the edges.
 * For comparison, the bounding-sphere fit this replaced measured 0.490, 0.629 and 0.890.
 */
const MIN_FILL_WIDESCREEN = 0.68;
const MIN_FILL_CLASSIC = 0.86;
const MIN_FILL_PHONE = 0.9;

/**
 * Vertical sizes other than {@link FLOOR_HEIGHTS} whose raw difference is noisy too:
 * `3.40 - 3.10` is 0.2999999999999998, while the slab is 0.30 m thick.
 */
const SYNTHETIC_HEIGHTS: FloorHeights = { ...FLOOR_HEIGHTS, floorToFloor: 3.4, wall: 3.1 };

/**
 * Vertical sizes whose raw difference is off the centimetre plan grid: `3.0 - 2.6999` is
 * 0.3001, while `getSlabThickness` snaps the slab to 0.30 m.
 *
 * The noise of {@link SYNTHETIC_HEIGHTS} is 2e-16 m, which the sums of the box fit absorb on
 * a plot 22.50 m wide, so on its own it cannot show *which* underside was framed. A
 * tenth of a millimetre survives, so this is the case that pins the snapping.
 */
const OFF_GRID_HEIGHTS: FloorHeights = { ...FLOOR_HEIGHTS, floorToFloor: 3.0, wall: 2.6999 };

/** How much deeper a slab is made in order to observe that the underside is framed, in metres. */
const DEEPER_SLAB_METRES = 0.01;

const FRAMING = getExteriorFraming(
  PLOT_RECT,
  FLOOR_HEIGHTS,
  FOV_DEGREES,
  WIDESCREEN_ASPECT,
  SINGLE_STOREY,
);

/**
 * The framing of the single designed floor at {@link FOV_DEGREES} and
 * {@link WIDESCREEN_ASPECT}, transcribed from the build in which the storey count did not
 * exist yet.
 *
 * This is the regression pin of the whole stacking change: the app opens on one storey, and
 * teaching the framing to fit a stack must leave that opening frame identical to the
 * pixel — not close to it. Compared with strict equality, so a target that is now derived
 * through `getBuildingTop` rather than from `heights.wall` has to come out at the very same
 * double, and any factor quietly re-tuned for tall buildings fails here first.
 */
const ONE_STOREY_FRAMING: ExteriorFraming = {
  target: { x: 11.25, y: 1.35, z: 5 },
  position: {
    x: 3.5706970380687366,
    y: 16.59709381112522,
    z: 21.468318346551147,
  },
  fitDistance: 21.563879211221305,
  minDistance: 5.390969802805326,
  maxDistance: 43.12775842244261,
  fogNear: 55.54890973784007,
  fogFar: 111.09781947568014,
  groundSize: 222.19563895136028,
};

/** Aspect ratios the storey matrix is swept over: from a tall slot to a wide banner. */
const MATRIX_ASPECTS = [0.25, 0.5, 1, 1.78, 3] as const;

/**
 * The lengths the framing publishes, every one of which must grow with the building.
 *
 * `target` and `position` are deliberately left out: the target's `y` rises with the stack
 * and is asserted on its own, while the start position swings around the building as it
 * gets taller — its `x` goes from 3.57 m to −2.86 m — so it is not a quantity that has a
 * direction to be monotonic in.
 */
const PUBLISHED_LENGTHS = [
  'fitDistance',
  'minDistance',
  'maxDistance',
  'fogNear',
  'fogFar',
  'groundSize',
] as const;

/** A storey count below the one storey that is always built. */
const NO_STOREYS = 0;
/** A storey count that is not a whole storey. */
const PART_STOREY = 1.5;

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
 * Builds the box the building occupies: the plot on the plan, the underside of storey 1's
 * slab to the top of the topmost storey's walls. Derived here independently of the module
 * under test.
 *
 * @param plot - Outer boundary of the floor.
 * @param heights - Vertical sizes of the typical floor.
 * @param storeyCount - How many storeys are stacked; one by default.
 * @returns The building box in scene coordinates.
 */
function floorBox(plot: PlanRect, heights: FloorHeights, storeyCount = SINGLE_STOREY): Box3 {
  // The underside comes from `slabs.ts`, the one place that level is computed, rather than
  // from subtracting the two heights again, which yields -0.2999999999999998; the top comes
  // from `storeys.ts`, the one place the height of a stack is computed.
  return new Box3(
    new Vector3(plot.minX, -getSlabThickness(heights), plot.minZ),
    new Vector3(plot.maxX, getBuildingTop(heights, storeyCount), plot.maxZ),
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
 * Places a camera on the orbit direction of a framing, at a chosen distance from its target.
 *
 * The direction is taken from the framing's own start position, so the camera looks along
 * the framing's view direction whatever distance it is put at.
 *
 * @param framing - The framing to place the camera with.
 * @param aspect - Aspect ratio of the canvas.
 * @param fovDegrees - Vertical field of view, in degrees.
 * @param distance - Distance from the orbit target, in metres.
 * @returns A camera with its matrices up to date.
 */
function cameraAt(
  framing: ExteriorFraming,
  aspect: number,
  fovDegrees: number,
  distance: number,
): PerspectiveCamera {
  const target = new Vector3(framing.target.x, framing.target.y, framing.target.z);
  const direction = new Vector3(framing.position.x, framing.position.y, framing.position.z)
    .sub(target)
    .normalize();
  const camera = new PerspectiveCamera(fovDegrees, aspect, CAMERA_NEAR, CAMERA_FAR);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/**
 * Builds the view frustum of a camera.
 *
 * @param camera - The camera, with its matrices up to date.
 * @returns Its frustum.
 */
function frustumOf(camera: PerspectiveCamera): Frustum {
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

/**
 * Measures how much of the frame the floor box spans at the start pose of a framing.
 *
 * The corners are projected with a real `three` camera placed by the framing, so what is
 * measured is what the app draws, not a repeat of the module's arithmetic.
 *
 * @param framing - The framing to measure.
 * @param aspect - Aspect ratio of the canvas.
 * @param fovDegrees - Vertical field of view, in degrees.
 * @returns The share of each axis of the frame the box spans, and the corners that fall
 *   outside the frustum.
 */
function frameFill(
  framing: ExteriorFraming,
  aspect: number,
  fovDegrees: number,
): { readonly x: number; readonly y: number; readonly outside: readonly Vector3[] } {
  const camera = cameraAt(framing, aspect, fovDegrees, startDistance(framing));
  const projected = cornersOf(floorBox(PLOT_RECT, FLOOR_HEIGHTS)).map((corner) =>
    corner.clone().project(camera),
  );
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  return {
    x: (Math.max(...xs) - Math.min(...xs)) / NDC_SPAN,
    y: (Math.max(...ys) - Math.min(...ys)) / NDC_SPAN,
    outside: projected.filter(
      (point) =>
        Math.abs(point.x) >= NDC_LIMIT ||
        Math.abs(point.y) >= NDC_LIMIT ||
        Math.abs(point.z) >= NDC_LIMIT,
    ),
  };
}

/**
 * Fit distance the module owes a floor box with a given underside, at {@link FOV_DEGREES}
 * and {@link WIDESCREEN_ASPECT}.
 *
 * Repeats the arithmetic of the module in the same order, so the result can be compared
 * with `toBe`: a framing built on a different underside fails rather than rounding into
 * place within nine digits. The top and the orbit target come from `getBuildingTop` at one
 * storey, as the module's own do, so what varies between the cases below is the underside
 * alone.
 *
 * @param plot - Outer boundary of the floor.
 * @param heights - Vertical sizes of the floor.
 * @param underside - Level the floor box starts at, in metres.
 * @returns The fit distance, in metres.
 */
function fitDistanceFor(plot: PlanRect, heights: FloorHeights, underside: number): number {
  const top = getBuildingTop(heights, SINGLE_STOREY);
  const target = new Vector3(
    (plot.minX + plot.maxX) * HALF,
    top * HALF,
    (plot.minZ + plot.maxZ) * HALF,
  );
  const elevation = EXPECTED_ELEVATION_DEGREES * RADIANS_PER_DEGREE;
  const azimuth = EXPECTED_AZIMUTH_DEGREES * RADIANS_PER_DEGREE;
  const forward = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    -Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  );
  const right = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  const up = new Vector3(
    Math.sin(azimuth) * Math.sin(elevation),
    Math.cos(elevation),
    -Math.cos(azimuth) * Math.sin(elevation),
  );
  const tanHalfVertical = Math.tan(FOV_DEGREES * HALF * RADIANS_PER_DEGREE);
  const tanHalfHorizontal = tanHalfVertical * WIDESCREEN_ASPECT;
  const box = new Box3(
    new Vector3(plot.minX, underside, plot.minZ),
    new Vector3(plot.maxX, top, plot.maxZ),
  );

  let fitDistance = 0;
  for (const corner of cornersOf(box)) {
    const offset = corner.clone().sub(target);
    const depth = offset.dot(forward);
    fitDistance = Math.max(
      fitDistance,
      Math.abs(offset.dot(right)) / tanHalfHorizontal - depth,
      Math.abs(offset.dot(up)) / tanHalfVertical - depth,
    );
  }
  return fitDistance;
}

/**
 * Distance at which the bounding *sphere* of the real floor fits the frame: the
 * conservative fit the box fit replaced.
 *
 * @param aspect - Aspect ratio of the canvas.
 * @returns The sphere fit distance, in metres.
 */
function sphereFitDistance(aspect: number): number {
  const box = floorBox(PLOT_RECT, FLOOR_HEIGHTS);
  const target = new Vector3(FRAMING.target.x, FRAMING.target.y, FRAMING.target.z);
  const radius = Math.max(...cornersOf(box).map((corner) => corner.distanceTo(target)));
  const halfFovVertical = FOV_DEGREES * HALF * RADIANS_PER_DEGREE;
  const halfFovHorizontal = Math.atan(Math.tan(halfFovVertical) * aspect);
  return radius / Math.sin(Math.min(halfFovVertical, halfFovHorizontal));
}

describe('exteriorFraming', () => {
  describe('getExteriorFraming for the real floor', () => {
    it('frames one storey exactly as it did before the building could be stacked', () => {
      expect(FRAMING).toStrictEqual(ONE_STOREY_FRAMING);
    });

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

    it('fits the floor at the smallest distance that keeps its whole box in frame', () => {
      const corners = cornersOf(floorBox(PLOT_RECT, FLOOR_HEIGHTS));
      const atFit = frustumOf(
        cameraAt(FRAMING, WIDESCREEN_ASPECT, FOV_DEGREES, FRAMING.fitDistance * JUST_BEYOND_FIT),
      );
      const tooClose = frustumOf(
        cameraAt(FRAMING, WIDESCREEN_ASPECT, FOV_DEGREES, FRAMING.fitDistance * JUST_INSIDE_FIT),
      );

      expect(corners).toHaveLength(BOX_CORNER_COUNT);
      for (const corner of corners) {
        expect(atFit.containsPoint(corner)).toBe(true);
      }
      expect(corners.some((corner) => !tooClose.containsPoint(corner))).toBe(true);
      expect(FRAMING.fitDistance).toBeCloseTo(EXPECTED_FIT_DISTANCE_METRES, PRECISION_DIGITS);
    });

    it('fits the box far more closely than the sphere around it', () => {
      const box = floorBox(PLOT_RECT, FLOOR_HEIGHTS);
      const target = new Vector3(FRAMING.target.x, FRAMING.target.y, FRAMING.target.z);
      const radius = Math.max(...cornersOf(box).map((corner) => corner.distanceTo(target)));

      expect(radius).toBeCloseTo(EXPECTED_RADIUS_METRES, PRECISION_DIGITS);
      expect(FRAMING.fitDistance).toBeLessThan(sphereFitDistance(WIDESCREEN_ASPECT));
      expect(FRAMING.fitDistance / sphereFitDistance(WIDESCREEN_ASPECT)).toBeLessThan(
        MAX_SPHERE_FIT_SHARE,
      );
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

    it('keeps the closest orbit distance above the top of the walls', () => {
      const height =
        FRAMING.target.y +
        Math.sin(EXPECTED_ELEVATION_DEGREES * RADIANS_PER_DEGREE) * FRAMING.minDistance;

      expect(height).toBeGreaterThan(FLOOR_HEIGHTS.wall);
    });

    it('starts the fog past the floor at the furthest allowed zoom', () => {
      const furthestCorner = Math.max(
        ...cornersOf(floorBox(PLOT_RECT, FLOOR_HEIGHTS)).map((corner) =>
          corner.distanceTo(
            cameraAt(FRAMING, WIDESCREEN_ASPECT, FOV_DEGREES, FRAMING.maxDistance).position,
          ),
        ),
      );

      expect(FRAMING.fogNear).toBeCloseTo(
        FRAMING.maxDistance + EXPECTED_RADIUS_METRES,
        PRECISION_DIGITS,
      );
      expect(FRAMING.fogNear).toBeGreaterThan(FRAMING.maxDistance);
      // The building is entirely clear of the fog even at the furthest allowed zoom.
      expect(FRAMING.fogNear).toBeGreaterThan(furthestCorner);
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
      const framing = getExteriorFraming(
        PLOT_RECT,
        FLOOR_HEIGHTS,
        FOV_DEGREES,
        aspect,
        SINGLE_STOREY,
      );
      const frustum = frustumOf(cameraAt(framing, aspect, FOV_DEGREES, startDistance(framing)));
      const corners = cornersOf(floorBox(PLOT_RECT, FLOOR_HEIGHTS));

      expect(corners).toHaveLength(BOX_CORNER_COUNT);
      for (const corner of corners) {
        expect(frustum.containsPoint(corner)).toBe(true);
      }
    });

    it.each([
      ['widescreen', WIDESCREEN_ASPECT, MIN_FILL_WIDESCREEN],
      ['classic', CLASSIC_ASPECT, MIN_FILL_CLASSIC],
      ['portrait phone', PHONE_ASPECT, MIN_FILL_PHONE],
    ] as const)(
      'fills the tighter axis of a %s frame with the floor',
      (_label, aspect, minimumFill) => {
        const framing = getExteriorFraming(
          PLOT_RECT,
          FLOOR_HEIGHTS,
          FOV_DEGREES,
          aspect,
          SINGLE_STOREY,
        );
        const fill = frameFill(framing, aspect, FOV_DEGREES);

        expect(Math.max(fill.x, fill.y)).toBeGreaterThanOrEqual(minimumFill);
        // Filling the frame must not crop the building: every corner is strictly inside.
        expect(fill.outside).toHaveLength(0);
      },
    );

    it('pulls the camera further back on a portrait viewport than on a widescreen one', () => {
      const portrait = getExteriorFraming(
        PLOT_RECT,
        FLOOR_HEIGHTS,
        FOV_DEGREES,
        PHONE_ASPECT,
        SINGLE_STOREY,
      );

      expect(portrait.fitDistance).toBeGreaterThan(FRAMING.fitDistance);
    });

    it('needs a smaller distance with a wider field of view', () => {
      const wide = getExteriorFraming(
        PLOT_RECT,
        FLOOR_HEIGHTS,
        WIDE_FOV_DEGREES,
        WIDESCREEN_ASPECT,
        SINGLE_STOREY,
      );

      expect(wide.fitDistance).toBeLessThan(FRAMING.fitDistance);
    });

    it('scales linearly with the size of the building', () => {
      const doubled = getExteriorFraming(
        scaleRect(PLOT_RECT, SCALE),
        scaleHeights(FLOOR_HEIGHTS, SCALE),
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        SINGLE_STOREY,
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

  describe('getExteriorFraming starts the floor box at the underside of the slab', () => {
    it.each([
      ['the default heights', FLOOR_HEIGHTS],
      ['injected heights', SYNTHETIC_HEIGHTS],
      ['off-grid heights', OFF_GRID_HEIGHTS],
    ] as const)('frames the box the slab ends at, with %s', (_label, heights) => {
      const framing = getExteriorFraming(
        PLOT_RECT,
        heights,
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        SINGLE_STOREY,
      );

      // Exact equality, not toBeCloseTo: the framing must fit a box whose underside is the
      // level `slabs.ts` owns, so the camera and the building agree bit for bit.
      expect(framing.fitDistance).toBe(
        fitDistanceFor(PLOT_RECT, heights, -getSlabThickness(heights)),
      );
    });

    it('frames the snapped underside, not the raw difference of the two heights', () => {
      const framing = getExteriorFraming(
        PLOT_RECT,
        OFF_GRID_HEIGHTS,
        FOV_DEGREES,
        WIDESCREEN_ASPECT,
        SINGLE_STOREY,
      );
      const snapped = -getSlabThickness(OFF_GRID_HEIGHTS);
      const unsnapped = -(OFF_GRID_HEIGHTS.floorToFloor - OFF_GRID_HEIGHTS.wall);

      expect(unsnapped).not.toBe(snapped);
      expect(framing.fitDistance).toBe(fitDistanceFor(PLOT_RECT, OFF_GRID_HEIGHTS, snapped));
      expect(framing.fitDistance).not.toBe(fitDistanceFor(PLOT_RECT, OFF_GRID_HEIGHTS, unsnapped));
    });

    it('is the underside that binds the fit: a deeper slab needs more distance', () => {
      const underside = -getSlabThickness(FLOOR_HEIGHTS);

      expect(
        fitDistanceFor(PLOT_RECT, FLOOR_HEIGHTS, underside - DEEPER_SLAB_METRES),
      ).toBeGreaterThan(FRAMING.fitDistance);
      expect(FRAMING.fitDistance).toBe(fitDistanceFor(PLOT_RECT, FLOOR_HEIGHTS, underside));
    });
  });

  describe('getExteriorFraming for a stack of storeys', () => {
    const tall = getExteriorFraming(
      PLOT_RECT,
      FLOOR_HEIGHTS,
      FOV_DEGREES,
      WIDESCREEN_ASPECT,
      TALL_STOREY,
    );

    it('pivots at half the height of the whole stack, not half a wall', () => {
      // Exact equality: 29.70 / 2 is representable, so there is nothing to round here, and
      // the one-storey case must still land on the 1.35 the regression pin holds.
      expect(getBuildingTop(FLOOR_HEIGHTS, TALL_STOREY)).toBe(TALL_TOP_METRES);
      expect(tall.target.y).toBe(TALL_TOP_METRES * HALF);
      expect(tall.target.x).toBe(FRAMING.target.x);
      expect(tall.target.z).toBe(FRAMING.target.z);
    });

    it('fits the box that ends at the top of the topmost storey', () => {
      const box = floorBox(PLOT_RECT, FLOOR_HEIGHTS, TALL_STOREY);
      const corners = cornersOf(box);
      const atFit = frustumOf(
        cameraAt(tall, WIDESCREEN_ASPECT, FOV_DEGREES, tall.fitDistance * JUST_BEYOND_FIT),
      );
      const tooClose = frustumOf(
        cameraAt(tall, WIDESCREEN_ASPECT, FOV_DEGREES, tall.fitDistance * JUST_INSIDE_FIT),
      );

      expect(box.max.y).toBe(TALL_TOP_METRES);
      // The underside is storey 1's slab whatever is stacked above it.
      expect(box.min.y).toBe(-getSlabThickness(FLOOR_HEIGHTS));
      expect(corners).toHaveLength(BOX_CORNER_COUNT);
      for (const corner of corners) {
        expect(atFit.containsPoint(corner)).toBe(true);
      }
      expect(corners.some((corner) => !tooClose.containsPoint(corner))).toBe(true);
    });

    it('pulls the camera back for the taller building', () => {
      expect(tall.fitDistance).toBeGreaterThan(FRAMING.fitDistance);
    });
  });

  describe('getExteriorFraming over every storey count and canvas shape', () => {
    it.each(MATRIX_ASPECTS)(
      'brackets and grows the framing at every count on an aspect of %s',
      (aspect) => {
        let previous: ExteriorFraming | undefined;

        for (let storeys = SINGLE_STOREY; storeys <= TALL_STOREY; storeys += 1) {
          const framing = getExteriorFraming(
            PLOT_RECT,
            FLOOR_HEIGHTS,
            FOV_DEGREES,
            aspect,
            storeys,
          );

          expect(framing.minDistance, `minDistance at ${String(storeys)} storeys`).toBeGreaterThan(
            0,
          );
          expect(framing.minDistance).toBeLessThan(framing.fitDistance);
          expect(framing.fitDistance).toBeLessThan(framing.maxDistance);
          // The fog must stay inside the camera's far plane, or the ground plane is clipped
          // away before it has finished fading and the horizon shows as a hard edge.
          expect(framing.fogFar, `fogFar at ${String(storeys)} storeys`).toBeLessThan(CAMERA_FAR);

          if (previous !== undefined) {
            for (const key of PUBLISHED_LENGTHS) {
              expect(framing[key], `${key} at ${String(storeys)} storeys`).toBeGreaterThanOrEqual(
                previous[key],
              );
            }
            expect(framing.target.y).toBeGreaterThanOrEqual(previous.target.y);
          }
          previous = framing;
        }
      },
    );
  });

  describe('getExteriorFraming rejections', () => {
    it.each([
      ['a storey count of zero', NO_STOREYS],
      ['a fractional storey count', PART_STOREY],
      ['a non-finite storey count', NOT_A_NUMBER],
      ['an infinite storey count', INFINITE],
      ['a negative storey count', -TALL_STOREY],
    ] as const)('rejects %s', (_label, storeyCount) => {
      const framing = () =>
        getExteriorFraming(VALID_PLOT, FLOOR_HEIGHTS, FOV_DEGREES, WIDESCREEN_ASPECT, storeyCount);

      expect(framing).toThrow(RangeError);
      expect(framing).toThrow('storeyCount');
    });

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
      expect(() => getExteriorFraming(plot, heights, fovDegrees, aspect, SINGLE_STOREY)).toThrow(
        RangeError,
      );
      expect(() => getExteriorFraming(plot, heights, fovDegrees, aspect, SINGLE_STOREY)).toThrow(
        named,
      );
    });
  });
});
