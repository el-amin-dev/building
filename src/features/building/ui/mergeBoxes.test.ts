import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeBox } from '../domain/planBox.ts';
import type { PlanBox } from '../domain/planBox.ts';
import { makeRect } from '../domain/planGeometry.ts';
import { createMergedBoxGeometry, toBoxProps } from './mergeBoxes.ts';

/** A `BoxGeometry` has four vertices on each of its six faces. */
const VERTICES_PER_BOX = 24;
/** Decimal digits two lengths must share to count as equal (sub-nanometre). */
const LENGTH_PRECISION_DIGITS = 9;
/**
 * Decimal digits a merged geometry's bounds share with the plan (sub-micrometre): its
 * vertices are stored as 32-bit floats, which carry about seven decimal digits.
 */
const GEOMETRY_PRECISION_DIGITS = 6;
/** Side of the grid of boxes used to check that many boxes still merge into one geometry. */
const MANY_BOXES_SIDE = 20;
/** Number of boxes in that grid: enough to stand for a whole floor's worth of walls. */
const MANY_BOXES = MANY_BOXES_SIDE * MANY_BOXES_SIDE;
/** Size and spacing of each box of that grid, in metres. */
const GRID_STEP = 1;
/** Top of each box of that grid, in metres. */
const GRID_TOP = 2;
/** Groups a merged geometry carries: none, since the boxes share one material. */
const NO_GROUPS = 0;

/** The box used for the known-values check: x 1–3, z 2–6, from −0.30 to 2.70. */
const KNOWN_BOX = makeBox(makeRect(1, 3, 2, 6), -0.3, 2.7);
const EXPECTED_KNOWN_POSITION = [2, 1.2, 4];
const EXPECTED_KNOWN_ARGS = [2, 3, 4];

/** A wall-like box and a slab-like box that overlap on neither axis. */
const WALL_BOX = makeBox(makeRect(0, 4, 0, 0.2), 0, 3);
const SLAB_BOX = makeBox(makeRect(-1, 5, -1, 6), -0.2, 0);

/** Boxes that cannot be drawn; built as plain objects, since `makeBox` rejects some of them. */
const INVALID_BOXES: readonly (readonly [string, PlanBox])[] = [
  ['a NaN plan coordinate', { rect: makeRect(0, Number.NaN, 0, 1), bottom: 0, top: 1 }],
  [
    'an infinite plan coordinate',
    { rect: makeRect(0, 1, Number.NEGATIVE_INFINITY, 1), bottom: 0, top: 1 },
  ],
  ['a NaN top level', { rect: makeRect(0, 1, 0, 1), bottom: 0, top: Number.NaN }],
  ['zero width', { rect: makeRect(1, 1, 0, 1), bottom: 0, top: 1 }],
  ['zero depth', { rect: makeRect(0, 1, 2, 2), bottom: 0, top: 1 }],
  ['zero height', { rect: makeRect(0, 1, 0, 1), bottom: 1, top: 1 }],
  ['a negative height', { rect: makeRect(0, 1, 0, 1), bottom: 1, top: 0 }],
];

/** The union of the boxes' extents, as three.js sees them. */
function unionOf(boxes: readonly PlanBox[]): Box3 {
  const union = new Box3();
  for (const box of boxes) {
    union.union(
      new Box3(
        new Vector3(box.rect.minX, box.bottom, box.rect.minZ),
        new Vector3(box.rect.maxX, box.top, box.rect.maxZ),
      ),
    );
  }
  return union;
}

/** A square grid of unit boxes, one metre apart, all one metre wide. */
function gridBoxes(): readonly PlanBox[] {
  const boxes: PlanBox[] = [];
  for (let column = 0; column < MANY_BOXES_SIDE; column += 1) {
    for (let row = 0; row < MANY_BOXES_SIDE; row += 1) {
      const x = column * GRID_STEP;
      const z = row * GRID_STEP;
      boxes.push(makeBox(makeRect(x, x + GRID_STEP, z, z + GRID_STEP), 0, GRID_TOP));
    }
  }
  return boxes;
}

function expectBoundingBoxEquals(actual: Box3, expected: Box3): void {
  expect(actual.min.x).toBeCloseTo(expected.min.x, GEOMETRY_PRECISION_DIGITS);
  expect(actual.min.y).toBeCloseTo(expected.min.y, GEOMETRY_PRECISION_DIGITS);
  expect(actual.min.z).toBeCloseTo(expected.min.z, GEOMETRY_PRECISION_DIGITS);
  expect(actual.max.x).toBeCloseTo(expected.max.x, GEOMETRY_PRECISION_DIGITS);
  expect(actual.max.y).toBeCloseTo(expected.max.y, GEOMETRY_PRECISION_DIGITS);
  expect(actual.max.z).toBeCloseTo(expected.max.z, GEOMETRY_PRECISION_DIGITS);
}

describe('toBoxProps', () => {
  it('centres a known box and returns its sizes', () => {
    const { position, args } = toBoxProps(KNOWN_BOX);

    position.forEach((coordinate, axis) => {
      expect(coordinate).toBeCloseTo(EXPECTED_KNOWN_POSITION[axis], LENGTH_PRECISION_DIGITS);
    });
    args.forEach((size, axis) => {
      expect(size).toBeCloseTo(EXPECTED_KNOWN_ARGS[axis], LENGTH_PRECISION_DIGITS);
    });
  });

  it.each(INVALID_BOXES)('rejects a box with %s', (_description, box) => {
    expect(() => toBoxProps(box)).toThrow(RangeError);
  });
});

describe('createMergedBoxGeometry', () => {
  it('holds the vertices of one box', () => {
    const geometry = createMergedBoxGeometry([WALL_BOX]);

    expect(geometry.getAttribute('position').count).toBe(VERTICES_PER_BOX);
  });

  it('holds the vertices of every box in a single geometry', () => {
    const boxes = [WALL_BOX, SLAB_BOX, KNOWN_BOX];

    const geometry = createMergedBoxGeometry(boxes);

    expect(geometry.getAttribute('position').count).toBe(VERTICES_PER_BOX * boxes.length);
    expect(geometry.groups).toHaveLength(NO_GROUPS);
  });

  it('spans exactly the union of the boxes it was given', () => {
    const boxes = [WALL_BOX, SLAB_BOX, KNOWN_BOX];

    const geometry = createMergedBoxGeometry(boxes);
    geometry.computeBoundingBox();

    expect(geometry.boundingBox).not.toBeNull();
    expectBoundingBoxEquals(geometry.boundingBox ?? new Box3(), unionOf(boxes));
  });

  it('merges a whole floor worth of boxes into one geometry', () => {
    const boxes = gridBoxes();
    expect(boxes).toHaveLength(MANY_BOXES);

    const geometry = createMergedBoxGeometry(boxes);
    geometry.computeBoundingBox();

    expect(geometry.getAttribute('position').count).toBe(VERTICES_PER_BOX * MANY_BOXES);
    expect(geometry.groups).toHaveLength(NO_GROUPS);
    expectBoundingBoxEquals(geometry.boundingBox ?? new Box3(), unionOf(boxes));
  });

  it('returns an empty geometry, with no position attribute, for no box at all', () => {
    const geometry = createMergedBoxGeometry([]);

    expect(geometry.hasAttribute('position')).toBe(false);
    expect(geometry.index).toBeNull();
  });

  it.each(INVALID_BOXES)('rejects a box with %s', (_description, box) => {
    expect(() => createMergedBoxGeometry([WALL_BOX, box])).toThrow(RangeError);
  });
});
