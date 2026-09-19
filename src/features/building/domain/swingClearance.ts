/**
 * The floor a door leaf needs in front of it, derived once for both sides.
 *
 * `scripts/source-of-truth/verify.mjs` check 9 used to build this rectangle
 * inline, in a four-branch ternary over a derived wall's `side`, and the
 * TypeScript side had no equivalent at all. Rather than write the derivation a
 * second time for the fixture checks and for `ports/queries.ts`, it lives here
 * and both sides call it.
 *
 * **Import rule (ADR-010).** `verify.mjs` runs with no toolchain whatsoever —
 * plain `node`, types stripped natively — and imports this module directly. So
 * this module may import **only** `./planGeometry.ts`, and may contain no
 * TypeScript-only runtime construct: no `enum`, no `namespace`, no parameter
 * properties, no decorators. Adding an import here, or any of those constructs,
 * breaks `pnpm verify:plan` rather than the type-check, so it will not be caught
 * by `pnpm typecheck`.
 *
 * **Which way is inward.** A face is named after the coordinate it lies on, as
 * {@link RectSide} names the faces of a rect, and "inward" is into the room whose
 * face it is. The derived walls of `walls.mjs` use compass names instead, and the
 * two vocabularies line up like this — checked against the ternary at
 * `verify.mjs:1559-1566`, because this mapping is the one thing a reader will
 * want to verify:
 *
 * | wall side | face here | `at` is the room's | inward |
 * | --------- | --------- | ------------------ | ------ |
 * | `north`   | `minZ`    | `minZ`             | `+z`   |
 * | `south`   | `maxZ`    | `maxZ`             | `-z`   |
 * | `east`    | `maxX`    | `maxX`             | `-x`   |
 * | `west`    | `minX`    | `minX`             | `+x`   |
 *
 * Plan coordinates are metres on the centimetre grid; every edge this module
 * computes is snapped back onto it with {@link toPlanLength}, exactly as the
 * script's `cm(...)` does, so a rect built here compares equal to one built there
 * instead of missing by a float hair.
 */
import { makeRect, toPlanLength } from './planGeometry.ts';
import type { PlanRect, RectSide } from './planGeometry.ts';

/** One face of a room, as both the plan model and the derived wall register can describe it. */
export interface ClearanceFace {
  /** Which face of the room's rect the leaf is hung in, named by the coordinate it lies on. */
  readonly side: RectSide;
  /** The coordinate that face lies on, in metres. */
  readonly at: number;
  /** Start of the opening along the face, in metres (x for a minZ/maxZ face, z for a minX/maxX face). */
  readonly spanMin: number;
  /** Clear width of the opening along the face, in metres. */
  readonly width: number;
}

/**
 * Checks that a face carries numbers a rectangle can be built from.
 *
 * @param face - The face to validate.
 * @throws RangeError when `at` or `spanMin` is not finite, or when `width` is not
 *   a finite positive number; the message names the offending value.
 */
function assertFace(face: ClearanceFace): void {
  if (!Number.isFinite(face.at)) {
    throw new RangeError(`at must be a finite number, got ${String(face.at)}`);
  }
  if (!Number.isFinite(face.spanMin)) {
    throw new RangeError(`spanMin must be a finite number, got ${String(face.spanMin)}`);
  }
  if (!Number.isFinite(face.width) || face.width <= 0) {
    throw new RangeError(`width must be a finite positive number, got ${String(face.width)}`);
  }
}

/**
 * Returns the floor that must stay clear inward of a face, to a stated depth.
 *
 * The rectangle covers the opening along the face, from `spanMin` to
 * `spanMin + width`, and reaches `depth` into the room from `at`. Which way that
 * is depends on the face: see the table in the module docstring.
 *
 * @param face - The face the opening sits in.
 * @param depth - How far into the room the floor must stay clear, in metres.
 * @returns A frozen {@link PlanRect} whose every edge lies on the centimetre grid.
 * @throws RangeError when `face.at` or `face.spanMin` is not finite, when
 *   `face.width` is not a finite positive number, or when `depth` is not a finite
 *   positive number; the message names the offending value.
 */
export function getClearanceRect(face: ClearanceFace, depth: number): PlanRect {
  assertFace(face);
  if (!Number.isFinite(depth) || depth <= 0) {
    throw new RangeError(`depth must be a finite positive number, got ${String(depth)}`);
  }
  const spanMin = toPlanLength(face.spanMin);
  const spanMax = toPlanLength(face.spanMin + face.width);
  const at = toPlanLength(face.at);
  // The far edge, `depth` inward of the face. Both signs are computed here so
  // that each branch below is one `makeRect` and nothing else.
  const inward = toPlanLength(face.at + depth);
  const outward = toPlanLength(face.at - depth);
  switch (face.side) {
    // north: the face is the room's minZ, so the room lies at greater z.
    case 'minZ':
      return makeRect(spanMin, spanMax, at, inward);
    // south: the face is the room's maxZ, so the room lies at smaller z.
    case 'maxZ':
      return makeRect(spanMin, spanMax, outward, at);
    // west: the face is the room's minX, so the room lies at greater x.
    case 'minX':
      return makeRect(at, inward, spanMin, spanMax);
    // east: the face is the room's maxX, so the room lies at smaller x.
    case 'maxX':
      return makeRect(outward, at, spanMin, spanMax);
  }
}

/**
 * Returns the floor a swinging leaf needs: its own width square, measured inward
 * from the face.
 *
 * A leaf has to be able to stand at 90° with nothing under it, so the depth is
 * the leaf's own width — which is why this is {@link getClearanceRect} called
 * with `face.width` rather than a second derivation.
 *
 * @param face - The face the leaf is hung in.
 * @returns A frozen {@link PlanRect} `face.width` wide and `face.width` deep.
 * @throws RangeError under the same conditions as {@link getClearanceRect}.
 */
export function getSwingRect(face: ClearanceFace): PlanRect {
  return getClearanceRect(face, face.width);
}
