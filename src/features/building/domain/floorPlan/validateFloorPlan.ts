/**
 * Structural validation of a {@link FloorPlan}.
 *
 * Validation is pure: it reads the plan and either returns it unchanged or
 * throws a `RangeError` naming the offending field, space ids and rect index.
 */
import { isOnPlanGrid, rectContainsRect, rectsOverlap, toPlanLength } from '../planGeometry.ts';
import type { PlanRect } from '../planGeometry.ts';
import type { FloorPlan, SpaceId } from './types.ts';

/** The four coordinates of a rect, in a stable order. */
const RECT_FIELDS: readonly (keyof PlanRect)[] = Object.freeze(['minX', 'maxX', 'minZ', 'maxZ']);

/** The two boundary rects of a plan, in the order they are checked. */
const BOUNDARY_FIELDS: readonly ('plot' | 'interior')[] = Object.freeze(['plot', 'interior']);

/** Separator between the two ids of an unordered override pair key. */
const PAIR_KEY_SEPARATOR = '|';

/** One rect of one space, with where it came from. */
interface LocatedRect {
  /** Identifier of the space the rect belongs to. */
  readonly spaceId: SpaceId;
  /** Index of the rect in the space's `rects`. */
  readonly rectIndex: number;
  /** The rect itself. */
  readonly rect: PlanRect;
}

/**
 * Formats a rect for an error message.
 *
 * @param rect - The rect to format.
 * @returns The coordinates as `[minX, maxX, minZ, maxZ]`.
 */
function formatRect(rect: PlanRect): string {
  return `[${RECT_FIELDS.map((field) => String(rect[field])).join(', ')}]`;
}

/**
 * Formats the location of a rect for an error message.
 *
 * @param located - The rect and its origin.
 * @returns A label such as `space "kitchen" rects[0]`.
 */
function formatLocation(located: LocatedRect): string {
  return `space "${located.spaceId}" rects[${String(located.rectIndex)}]`;
}

/**
 * Checks that the plot and interior rects are finite and not inverted, and
 * that the plot contains the interior.
 *
 * @param plan - The plan to check.
 * @throws RangeError naming `plot` or `interior` when a check fails.
 */
function checkBoundaries(plan: FloorPlan): void {
  for (const boundary of BOUNDARY_FIELDS) {
    const rect = plan[boundary];
    for (const field of RECT_FIELDS) {
      if (!Number.isFinite(rect[field])) {
        throw new RangeError(
          `FloorPlan.${boundary}.${field} must be a finite number, got ${String(rect[field])}`,
        );
      }
    }
    if (rect.minX > rect.maxX || rect.minZ > rect.maxZ) {
      throw new RangeError(
        `FloorPlan.${boundary} must not be inverted (min greater than max), got ${formatRect(rect)}`,
      );
    }
  }
  if (!rectContainsRect(plan.plot, plan.interior)) {
    throw new RangeError(
      `FloorPlan.interior ${formatRect(plan.interior)} must lie within FloorPlan.plot ${formatRect(plan.plot)}`,
    );
  }
}

/**
 * Checks that no two spaces share an id.
 *
 * @param plan - The plan to check.
 * @throws RangeError naming the duplicated id.
 */
function checkUniqueIds(plan: FloorPlan): void {
  const seen = new Set<SpaceId>();
  for (const space of plan.spaces) {
    if (seen.has(space.id)) {
      throw new RangeError(`space id "${space.id}" appears more than once`);
    }
    seen.add(space.id);
  }
}

/**
 * Checks that every space has at least one rect.
 *
 * @param plan - The plan to check.
 * @throws RangeError naming the space without rects.
 */
function checkNonEmptySpaces(plan: FloorPlan): void {
  for (const space of plan.spaces) {
    if (space.rects.length === 0) {
      throw new RangeError(`space "${space.id}" must have at least one rect`);
    }
  }
}

/**
 * Lists every rect of every space, in plan order.
 *
 * @param plan - The plan whose rects to list.
 * @returns Each rect with its space id and rect index.
 */
function locateRects(plan: FloorPlan): readonly LocatedRect[] {
  return plan.spaces.flatMap((space) =>
    space.rects.map((rect, rectIndex) => ({ spaceId: space.id, rectIndex, rect })),
  );
}

/**
 * Checks that every coordinate is finite and on the centimetre grid, and that
 * no rect is inverted or empty once its coordinates are snapped to the grid.
 *
 * @param rects - The located rects to check.
 * @throws RangeError naming the space id, rect index and coordinate.
 */
function checkRectShapes(rects: readonly LocatedRect[]): void {
  for (const located of rects) {
    const { rect } = located;
    for (const field of RECT_FIELDS) {
      if (!isOnPlanGrid(rect[field])) {
        throw new RangeError(
          `${formatLocation(located)}.${field} must be a finite number on the centimetre grid, got ${String(rect[field])}`,
        );
      }
    }
    // Compare the grid-snapped values: raw values within LENGTH_TOLERANCE of
    // each other would otherwise pass as a non-empty rect.
    if (
      toPlanLength(rect.minX) >= toPlanLength(rect.maxX) ||
      toPlanLength(rect.minZ) >= toPlanLength(rect.maxZ)
    ) {
      throw new RangeError(
        `${formatLocation(located)} must have minX < maxX and minZ < maxZ, got ${formatRect(rect)}`,
      );
    }
  }
}

/**
 * Checks that every rect lies within the plan interior.
 *
 * @param rects - The located rects to check.
 * @param interior - The clear interior of the plan.
 * @throws RangeError naming the space id and rect index.
 */
function checkRectsInInterior(rects: readonly LocatedRect[], interior: PlanRect): void {
  for (const located of rects) {
    if (!rectContainsRect(interior, located.rect)) {
      throw new RangeError(
        `${formatLocation(located)} ${formatRect(located.rect)} must lie within FloorPlan.interior ${formatRect(interior)}`,
      );
    }
  }
}

/**
 * Checks that no two rects overlap, whether they belong to two spaces or to
 * the same space.
 *
 * @param rects - The located rects to check.
 * @throws RangeError naming both space ids and rect indices.
 */
function checkNoOverlaps(rects: readonly LocatedRect[]): void {
  rects.forEach((located, index) => {
    for (const other of rects.slice(index + 1)) {
      if (rectsOverlap(located.rect, other.rect)) {
        throw new RangeError(
          `${formatLocation(located)} ${formatRect(located.rect)} overlaps ${formatLocation(other)} ${formatRect(other.rect)}`,
        );
      }
    }
  });
}

/**
 * Checks every join override: two distinct known ids, a non-negative
 * thickness on the grid, and no unordered pair listed twice.
 *
 * @param plan - The plan to check.
 * @throws RangeError naming the override index and its space ids.
 */
function checkJoinOverrides(plan: FloorPlan): void {
  const knownIds = new Set<SpaceId>(plan.spaces.map((space) => space.id));
  const seenPairs = new Set<string>();
  plan.joinOverrides.forEach((override, index) => {
    const [first, second] = override.spaces;
    const label = `joinOverrides[${String(index)}] ("${first}" ↔ "${second}")`;
    for (const id of override.spaces) {
      if (!knownIds.has(id)) {
        throw new RangeError(`${label} references space "${id}", which is not in the plan`);
      }
    }
    if (first === second) {
      throw new RangeError(`${label} must join two distinct spaces`);
    }
    if (!isOnPlanGrid(override.thickness) || override.thickness < 0) {
      throw new RangeError(
        `${label} thickness must be a finite number >= 0 on the centimetre grid, got ${String(override.thickness)}`,
      );
    }
    const pairKey =
      first < second
        ? `${first}${PAIR_KEY_SEPARATOR}${second}`
        : `${second}${PAIR_KEY_SEPARATOR}${first}`;
    if (seenPairs.has(pairKey)) {
      throw new RangeError(`${label} repeats a pair that is already overridden`);
    }
    seenPairs.add(pairKey);
  });
}

/**
 * Validates the structure of a floor plan.
 *
 * Checks, in order:
 * 1. `plot` and `interior` are finite and not inverted, and `plot` contains
 *    `interior`;
 * 2. space ids are unique;
 * 3. every space has at least one rect;
 * 4. every rect coordinate is finite and on the centimetre grid, with
 *    `minX < maxX` and `minZ < maxZ` after snapping to the grid;
 * 5. every rect lies within `interior`;
 * 6. no two rects overlap, across spaces or within one space (touching edges
 *    are allowed);
 * 7. every join override references two distinct ids present in the plan, has
 *    a finite thickness `>= 0` on the grid, and no unordered pair is listed
 *    twice.
 *
 * The plan does not need to contain every id of `SPACE_IDS`, so partial plans
 * validate.
 *
 * @param plan - The plan to validate.
 * @returns The same plan reference, unchanged, when every check passes.
 * @throws RangeError naming the offending field, space ids and rect index for
 *   the first failing check.
 */
export function validateFloorPlan(plan: FloorPlan): FloorPlan {
  checkBoundaries(plan);
  checkUniqueIds(plan);
  checkNonEmptySpaces(plan);
  const rects = locateRects(plan);
  checkRectShapes(rects);
  checkRectsInInterior(rects, plan.interior);
  checkNoOverlaps(rects);
  checkJoinOverrides(plan);
  return plan;
}
