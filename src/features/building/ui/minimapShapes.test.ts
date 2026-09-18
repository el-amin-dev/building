import { describe, expect, it } from 'vitest';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN, PLOT_RECT } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { makeRect, rectDepth, rectWidth } from '../domain/planGeometry.ts';
import { getSlabs } from '../domain/slabs.ts';
import {
  formatMinimapNumber,
  getFacingSideLabel,
  getMinimapShapes,
  getMinimapViewBox,
  getViewerTransform,
} from './minimapShapes.ts';

/** The `viewBox` of the real plot, as the brief states it. */
const REAL_PLOT_VIEW_BOX = '0 0 22.5 10';

/** The spaces of kind `'void'`: no floor, so nothing to draw. */
const VOID_IDS: readonly SpaceId[] = ['voidWest', 'voidEast'];

/** The stair bay's arrival landing, the only part of the bay that is floor here. */
const LANDING_X = 4.6;
const LANDING_Y = 4;
const LANDING_WIDTH = 1;
const LANDING_HEIGHT = 2;

/** The bay itself, which must NOT be drawn: 4.00 × 2.00 from x 1.60, z 4.00. */
const BAY_WIDTH = 4;

/** The kitchen is not a rectangle: it steps back at its west end (source of truth, R11). */
const KITCHEN_SHAPE_COUNT = 2;

/** How many shapes a space made of one rect contributes. */
const SINGLE_SHAPE = 1;
const NONE = 0;

/** A pose to place the marker at, away from the origin so a missing move would show. */
const MARKER_X = 3;
const MARKER_Z = 4;

/**
 * The height fields of a pose the minimap draws: a body standing on the ground storey.
 *
 * The minimap is a plan, and the typical floor is the same plan at every storey, so the
 * marker is placed from x, z and yaw alone. Every pose here is therefore flat on floor 1 —
 * the lowest storey the plan numbers — with no rise above its finished floor.
 */
const ON_GROUND_STOREY = { floor: 1, rise: 0 };

/** Builds a pose at {@link MARKER_X} / {@link MARKER_Z} with the given yaw. */
function poseFacing(yaw: number): EyePose {
  return { x: MARKER_X, z: MARKER_Z, yaw, pitch: 0, ...ON_GROUND_STOREY };
}

/** The shapes of one space, in shape order. */
function shapesOf(spaceId: SpaceId) {
  return getMinimapShapes(FLOOR_PLAN).filter((shape) => shape.spaceId === spaceId);
}

describe('getMinimapShapes', () => {
  it('draws one shape per floor slab, so the shapes tile the walkable floor', () => {
    const shapes = getMinimapShapes(FLOOR_PLAN);
    const slabs = getSlabs(FLOOR_PLAN);

    expect(shapes).toHaveLength(slabs.length);
    shapes.forEach((shape, index) => {
      const slab = slabs[index];
      expect(shape.spaceId).toBe(slab.spaceId);
      expect(shape.x).toBe(slab.rect.minX);
      expect(shape.y).toBe(slab.rect.minZ);
      expect(shape.width).toBe(rectWidth(slab.rect));
      expect(shape.height).toBe(rectDepth(slab.rect));
    });
  });

  it('maps plan x to SVG x and plan z to SVG y, so z increases down the drawing', () => {
    const [first] = getMinimapShapes(FLOOR_PLAN);
    const [firstSlab] = getSlabs(FLOOR_PLAN);

    expect(first.y).toBe(firstSlab.rect.minZ);
    expect(first.height).toBe(rectDepth(firstSlab.rect));
  });

  it('draws the stair bay as its 1.00 × 2.00 arrival landing and nothing else', () => {
    const stairs = shapesOf('stairs');

    expect(stairs).toHaveLength(SINGLE_SHAPE);
    expect(stairs[0]).toMatchObject({
      x: LANDING_X,
      y: LANDING_Y,
      width: LANDING_WIDTH,
      height: LANDING_HEIGHT,
    });
    // The stairwell is a hole with a stair through it, so the bay is never paved over.
    expect(stairs[0].width).toBeLessThan(BAY_WIDTH);
  });

  it('draws a space that is not a rectangle as several shapes', () => {
    const kitchen = shapesOf('kitchen');

    expect(kitchen).toHaveLength(KITCHEN_SHAPE_COUNT);
    // The west rect is shallower than the east one: that step is the kitchen's shape.
    expect(kitchen[0].height).not.toBe(kitchen[1].height);
    kitchen.forEach((shape) => {
      expect(shape.spaceId).toBe('kitchen');
    });
  });

  it('draws neither void: a void has no floor to stand on', () => {
    for (const voidId of VOID_IDS) {
      expect(shapesOf(voidId)).toHaveLength(NONE);
    }
  });

  it('freezes what it returns', () => {
    const shapes = getMinimapShapes(FLOOR_PLAN);

    expect(Object.isFrozen(shapes)).toBe(true);
    expect(Object.isFrozen(shapes[0])).toBe(true);
  });
});

describe('getMinimapViewBox', () => {
  it('derives the viewBox from the plot rectangle', () => {
    const expected = [
      PLOT_RECT.minX,
      PLOT_RECT.minZ,
      rectWidth(PLOT_RECT),
      rectDepth(PLOT_RECT),
    ].join(' ');

    expect(getMinimapViewBox(PLOT_RECT)).toBe(expected);
  });

  it('puts the real plot in user space one-to-one, one unit per metre', () => {
    expect(getMinimapViewBox(PLOT_RECT)).toBe(REAL_PLOT_VIEW_BOX);
  });

  it('follows any other plot, so no size of the floor is written down', () => {
    expect(getMinimapViewBox(makeRect(0, 10, 0, 4))).toBe('0 0 10 4');
  });

  it('reads the origin off the rectangle too, not only its size', () => {
    expect(getMinimapViewBox(makeRect(1, 5, 2, 5))).toBe('1 2 4 3');
  });
});

describe('getViewerTransform', () => {
  it.each([
    ['0 (looking toward −z)', 0, 'translate(3 4) rotate(0)'],
    ['a quarter turn left (toward −x)', Math.PI / 2, 'translate(3 4) rotate(-90)'],
    ['a quarter turn right (toward +x)', -Math.PI / 2, 'translate(3 4) rotate(90)'],
    ['a half turn (toward +z)', Math.PI, 'translate(3 4) rotate(-180)'],
  ])('turns the marker by minus the yaw at yaw %s', (_name, yaw, expected) => {
    expect(getViewerTransform(poseFacing(yaw))).toBe(expected);
  });

  it('puts the marker at the pose, plan x on SVG x and plan z on SVG y', () => {
    expect(getViewerTransform({ x: 12.5, z: 7.25, yaw: 0, pitch: 0, ...ON_GROUND_STOREY })).toBe(
      'translate(12.5 7.25) rotate(0)',
    );
  });

  it('rounds, so a frame that did not really move writes the same string', () => {
    const first = getViewerTransform({ x: 1.23456, z: 2, yaw: 0, pitch: 0, ...ON_GROUND_STOREY });
    const second = getViewerTransform({ x: 1.234561, z: 2, yaw: 0, pitch: 0, ...ON_GROUND_STOREY });

    expect(first).toBe('translate(1.235 2) rotate(0)');
    expect(second).toBe(first);
  });

  it('ignores the pitch, which has no meaning on a plan', () => {
    const level = getViewerTransform({
      x: MARKER_X,
      z: MARKER_Z,
      yaw: 0,
      pitch: 0,
      ...ON_GROUND_STOREY,
    });
    const tilted = getViewerTransform({
      x: MARKER_X,
      z: MARKER_Z,
      yaw: 0,
      pitch: 1,
      ...ON_GROUND_STOREY,
    });

    expect(tilted).toBe(level);
  });

  it.each([
    ['x', { x: Number.NaN, z: MARKER_Z, yaw: 0, pitch: 0, ...ON_GROUND_STOREY }],
    ['z', { x: MARKER_X, z: Number.POSITIVE_INFINITY, yaw: 0, pitch: 0, ...ON_GROUND_STOREY }],
    ['yaw', { x: MARKER_X, z: MARKER_Z, yaw: Number.NaN, pitch: 0, ...ON_GROUND_STOREY }],
  ])('refuses a pose whose %s is not finite', (_name, pose: EyePose) => {
    expect(() => getViewerTransform(pose)).toThrow(RangeError);
  });
});

describe('getFacingSideLabel', () => {
  // The plan's own vocabulary: x runs A→D and z runs C→B, so side A faces −x,
  // side D faces +x, side C faces −z and side B faces +z (`floorPlan/types.ts`).
  it.each([
    ['0', 0, 'toward side C'],
    ['π/4', Math.PI / 4, 'toward sides A and C'],
    ['π/2', Math.PI / 2, 'toward side A'],
    ['3π/4', (3 * Math.PI) / 4, 'toward sides A and B'],
    ['π', Math.PI, 'toward side B'],
    ['−3π/4', (-3 * Math.PI) / 4, 'toward sides B and D'],
    ['−π/2', -Math.PI / 2, 'toward side D'],
    ['−π/4', -Math.PI / 4, 'toward sides C and D'],
  ])('names the side the eye faces at yaw %s', (_name, yaw, expected) => {
    expect(getFacingSideLabel(yaw)).toBe(expected);
  });

  it('names one side just inside a cardinal sector and two just outside it', () => {
    const justInside = getFacingSideLabel(Math.PI / 8 - Math.PI / 180);
    const justOutside = getFacingSideLabel(Math.PI / 8 + Math.PI / 180);

    expect(justInside).toBe('toward side C');
    expect(justOutside).toBe('toward sides A and C');
  });

  it('reads an unwrapped yaw the same as its wrapped equivalent', () => {
    expect(getFacingSideLabel(2 * Math.PI)).toBe(getFacingSideLabel(0));
    expect(getFacingSideLabel(-3 * Math.PI)).toBe(getFacingSideLabel(Math.PI));
  });

  it('refuses a yaw that is not finite', () => {
    expect(() => getFacingSideLabel(Number.NaN)).toThrow(RangeError);
    expect(() => getFacingSideLabel(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatMinimapNumber', () => {
  it('rounds to three decimals and drops trailing zeros', () => {
    expect(formatMinimapNumber(1.23456)).toBe('1.235');
    expect(formatMinimapNumber(22.5)).toBe('22.5');
    expect(formatMinimapNumber(10)).toBe('10');
  });

  it('prints a negative zero as zero, so the attribute string is stable', () => {
    expect(formatMinimapNumber(-0)).toBe('0');
    expect(formatMinimapNumber(-0.0001)).toBe('0');
  });
});
